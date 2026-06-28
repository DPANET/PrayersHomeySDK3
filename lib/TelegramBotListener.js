'use strict';

/**
 * TelegramBotListener — long-polls the Telegram Bot API directly inside the
 * Homey app so the Islamic Assistant can reply to messages without any Flow
 * configuration. The user supplies a bot token in app settings; this class
 * handles the full receive → Claude → send cycle autonomously.
 *
 * Uses native fetch (Node 22+). No extra npm dependency.
 *
 * Usage:
 *   const listener = new TelegramBotListener({ token, onMessage, logger });
 *   listener.start();   // begins polling loop
 *   listener.stop();    // graceful shutdown
 */

const https = require('node:https');

const TG_BASE = 'https://api.telegram.org';
const POLL_TIMEOUT = 25;   // seconds (Telegram long-poll window)
const RETRY_DELAY  = 5000; // ms between error retries

/**
 * Minimal HTTPS request on Node's core `node:https` (HTTP/1.1) instead of the
 * global `fetch()`. This deliberately avoids initialising undici — Node's fetch
 * implementation, whose core + llhttp WASM parser + http2 dependency add ~6 MB
 * RSS the first time fetch() is ever called. The poll loop is the app's first
 * network call, so using fetch here would pay that cost the moment the assistant
 * is enabled. node:https + the TLS stack are already loaded by the runtime.
 *
 * @param {object} opts
 * @param {string}        opts.url
 * @param {string}        [opts.method='GET']
 * @param {object}        [opts.headers]
 * @param {string}        [opts.body]
 * @param {AbortSignal}   [opts.signal]
 * @returns {Promise<{ ok:boolean, status:number, json:()=>Promise<any>, text:string }>}
 */
function httpsRequest({ url, method = 'GET', headers = {}, body = null, signal = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          text,
          json: async () => JSON.parse(text || '{}'),
        });
      });
    });
    req.on('error', reject);
    if (signal) {
      if (signal.aborted) { req.destroy(new Error('aborted')); }
      else signal.addEventListener('abort', () => req.destroy(new Error('aborted')), { once: true });
    }
    if (body) req.write(body);
    req.end();
  });
}

// Telegram rejects any message over 4096 chars. Stay a little under to leave
// headroom for Markdown and the splitter's whitespace handling.
const TG_MAX_CHARS = 3900;

/**
 * Split text into Telegram-sized chunks, preferring paragraph (\n\n) then line
 * (\n) boundaries, and only hard-splitting a single oversized line as a last
 * resort. Verbatim scripture/fatwa blocks can exceed the 4096-char limit, which
 * Telegram rejects outright (400 "message is too long") — so every send goes
 * through here.
 * @param {string} text
 * @param {number} [max]
 * @returns {string[]}
 */
function splitForTelegram(text, max = TG_MAX_CHARS) {
  const out = [];
  let buf = '';
  const flush = () => { if (buf.trim()) out.push(buf.trim()); buf = ''; };
  const push = (piece, sep) => {
    if (!buf) { buf = piece; return; }
    if (buf.length + sep.length + piece.length <= max) { buf += sep + piece; return; }
    flush();
    buf = piece;
  };
  for (const para of String(text).split(/\n\n+/)) {
    if (para.length <= max) { push(para, '\n\n'); continue; }
    // Paragraph itself too big → break by lines.
    for (const line of para.split('\n')) {
      if (line.length <= max) { push(line, '\n'); continue; }
      // A single line too big → break on word boundaries (snap to the last space
      // before the limit) so a word is never split across two messages. Only cut
      // mid-word if there is no space at all in the window.
      flush();
      let rest = line;
      while (rest.length > max) {
        let cut = rest.lastIndexOf(' ', max);
        if (cut <= 0) cut = max; // no space in window → hard cut
        out.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).replace(/^\s+/, '');
      }
      if (rest) buf = rest; // carry the tail so it can merge with the next para
    }
  }
  flush();
  return out.length ? out : [String(text).slice(0, max)];
}

/**
 * Send a Telegram message via the Bot API, automatically splitting any text over
 * the 4096-char limit into multiple ordered messages. Standalone so callers (e.g.
 * a Flow action card) can send without a running poll loop. Tries Markdown first,
 * falls back to plain text on a parse error. Returns true if all parts sent.
 * @param {object} opts
 * @param {string} opts.token   bot token
 * @param {string|number} opts.chatId
 * @param {string} opts.text
 * @param {object} [opts.logger]
 * @returns {Promise<boolean>}
 */
async function sendTelegramMessage({ token, chatId, text, logger } = {}) {
  const log = logger || { warn() {}, error() {} };
  if (!token || !chatId || !text) return false;
  const parts = splitForTelegram(text);
  let ok = true;
  for (const part of parts) {
    // Send sequentially so the parts arrive in order.
    // eslint-disable-next-line no-await-in-loop
    ok = (await sendOneMessage({ token, chatId, text: part, log })) && ok;
  }
  return ok;
}

// Send exactly one (already size-bounded) message. Markdown first, plain on retry.
async function sendOneMessage({ token, chatId, text, log }) {
  const url = `${TG_BASE}/bot${token}/sendMessage`;
  try {
    const res = await httpsRequest({
      url,
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    });
    if (res.ok) return true;
    // Markdown parse failure — retry as plain text.
    const plain = await httpsRequest({
      url,
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chat_id: chatId, text }),
    });
    if (!plain.ok) {
      let body = '';
      try { body = JSON.stringify(await plain.json()); } catch (_) { /* ignore */ }
      log.warn('sendTelegramMessage failed: ' + plain.status + ' ' + body);
      return false;
    }
    return true;
  } catch (e) {
    log.error('sendTelegramMessage error', e);
    return false;
  }
}

class TelegramBotListener {
  /**
   * @param {object} opts
   * @param {string}   opts.token      Telegram bot token
   * @param {Function} opts.onMessage  async (text, chatId) => string|null — return reply text or null for silence
   * @param {object}   [opts.logger]
   */
  constructor({ token, onMessage, logger } = {}) {
    this._token     = token;
    this._onMessage = onMessage;
    this._logger    = logger || { log() {}, debug() {}, warn() {}, error() {} };
    this._offset    = 0;
    this._running   = false;
    this._abortCtrl = null;
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._logger.log('TelegramBotListener: polling started');
    this._loop().catch(e => this._logger.error('TelegramBotListener loop fatal', e));
  }

  stop() {
    this._running = false;
    if (this._abortCtrl) this._abortCtrl.abort();
    this._logger.log('TelegramBotListener: stopped');
  }

  async _loop() {
    while (this._running) {
      try {
        const updates = await this._getUpdates();
        for (const upd of updates) {
          this._offset = upd.update_id + 1;
          const msg = upd.message || upd.channel_post;
          if (!msg || !msg.text) continue;
          this._dispatch(String(msg.chat.id), msg.text).catch(e =>
            this._logger.error('TelegramBotListener dispatch error', e));
        }
      } catch (e) {
        if (!this._running) break;
        this._logger.warn('TelegramBotListener poll error:', e.message);
        await this._sleep(RETRY_DELAY);
      }
    }
  }

  async _dispatch(chatId, text) {
    this._logger.log(`TelegramBotListener: message from ${chatId}: ${text.slice(0, 80)}`);
    // Show "typing…" immediately, then repeat every 4 s so it stays visible
    // for the full generation time (Telegram clears it after 5 s otherwise).
    this._sendTyping(chatId).catch(() => {});
    const typingInterval = setInterval(() => this._sendTyping(chatId).catch(() => {}), 4000);
    let reply;
    try {
      reply = await this._onMessage(text, chatId);
    } catch (e) {
      this._logger.error('TelegramBotListener onMessage error', e);
      clearInterval(typingInterval);
      return;
    }
    clearInterval(typingInterval);
    if (reply) {
      this._logger.log(`TelegramBotListener: sending reply to ${chatId} (${reply.length} chars)`);
      await this._sendMessage(chatId, reply);
    } else {
      this._logger.log(`TelegramBotListener: no reply produced for ${chatId}`);
    }
  }

  async _sendTyping(chatId) {
    await httpsRequest({
      url:     `${TG_BASE}/bot${this._token}/sendChatAction`,
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chat_id: chatId, action: 'typing' }),
    });
  }

  async _getUpdates() {
    this._abortCtrl = new AbortController();
    const allowed = encodeURIComponent('["message"]');
    const url = `${TG_BASE}/bot${this._token}/getUpdates`
      + `?offset=${this._offset}&timeout=${POLL_TIMEOUT}&allowed_updates=${allowed}`;
    const res = await httpsRequest({ url, signal: this._abortCtrl.signal });
    if (!res.ok) {
      let body = '';
      try { body = JSON.stringify(await res.json()); } catch (_) { /* ignore */ }
      throw new Error('Telegram getUpdates HTTP ' + res.status + ' ' + body);
    }
    const data = await res.json();
    if (!data.ok) throw new Error('Telegram error: ' + JSON.stringify(data));
    return data.result || [];
  }

  async _sendMessage(chatId, text) {
    return sendTelegramMessage({ token: this._token, chatId, text, logger: this._logger });
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = TelegramBotListener;
module.exports.sendTelegramMessage = sendTelegramMessage;
module.exports.splitForTelegram = splitForTelegram;
module.exports.TG_MAX_CHARS = TG_MAX_CHARS;
