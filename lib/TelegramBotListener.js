'use strict';

/**
 * TelegramBotListener — long-polls the Telegram Bot API and handles both
 * text messages and inline button callbacks.
 *
 * Uses native `node:https` (avoids initialising undici/fetch which adds ~6 MB
 * RSS). The poll loop receives both message and callback_query updates.
 *
 * Usage:
 *   const listener = new TelegramBotListener({ token, onMessage, onCallback, logger });
 *   listener.start();   // begins polling + registers slash commands
 *   listener.stop();    // graceful shutdown
 */

const https = require('node:https');

const TG_BASE      = 'https://api.telegram.org';
const POLL_TIMEOUT = 25;   // seconds (Telegram long-poll window)
const RETRY_DELAY  = 5000; // ms between error retries

/**
 * Minimal HTTPS request on Node's core `node:https` (HTTP/1.1).
 * Avoids initialising undici — Node's fetch implementation adds ~6 MB RSS
 * the first time fetch() is called. node:https + TLS are already loaded.
 *
 * @param {object} opts
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
 * resort.
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
    for (const line of para.split('\n')) {
      if (line.length <= max) { push(line, '\n'); continue; }
      flush();
      let rest = line;
      while (rest.length > max) {
        let cut = rest.lastIndexOf(' ', max);
        if (cut <= 0) cut = max;
        out.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).replace(/^\s+/, '');
      }
      if (rest) buf = rest;
    }
  }
  flush();
  return out.length ? out : [String(text).slice(0, max)];
}

/**
 * Build a Telegram inline_keyboard from the content-type metadata returned by
 * IslamicAssistantCard._extractMeta(). Returns null when no buttons apply.
 *
 * Compact callback_data tokens (all ≤ 64 bytes):
 *   tf|S:A   — get_tafsir surah S ayah A
 *   ab|S:A   — get_tafsir asbab:true surah S ayah A
 *   qa|S:A   — get_quran surah S ayah A (verse again)
 *   mr       — "more on this topic" (synthetic "more" via Claude, reuses history)
 *   ex|h     — explain the last hadith (via Claude)
 *   dm|cat|N — rest of dua set, category=cat, offset=N
 *   nf|cat   — another fatwa on this category (first 40 chars)
 *   px       — prayer times (via Claude)
 *   mc       — open /menu grid
 *   mi|X     — menu item shortcut (hadith/quran/dua/fatwa/prayer)
 */
function buildReplyMarkup(meta) {
  if (!meta || !meta.type) return null;
  const rows = [];
  const { type } = meta;

  if (type === 'verse') {
    const ref = `${meta.surahNum}:${meta.ayahNum}`;
    rows.push([
      { text: '📖 Tafsir',     callback_data: `tf|${ref}` },
      { text: '🕋 Asbab',      callback_data: `ab|${ref}` },
    ]);
    rows.push([{ text: '➡️ More', callback_data: 'mr' }]);
  } else if (type === 'tafsir') {
    const ref = `${meta.surahNum}:${meta.ayahNum}`;
    rows.push([
      { text: '🕋 Asbab',       callback_data: `ab|${ref}` },
      { text: '🔁 Verse again', callback_data: `qa|${ref}` },
    ]);
  } else if (type === 'hadith') {
    rows.push([
      { text: '💡 Explain',  callback_data: 'ex|h' },
      { text: '➡️ More',     callback_data: 'mr'   },
    ]);
  } else if (type === 'hadith_explained') {
    rows.push([{ text: '➡️ More', callback_data: 'mr' }]);
  } else if (type === 'dua') {
    const row = [];
    if (meta.nextOffset < meta.total) {
      const catData = `dm|${meta.category}|${meta.nextOffset}`;
      row.push({ text: '➕ Rest of set', callback_data: catData });
    }
    row.push({ text: '➡️ More', callback_data: 'mr' });
    rows.push(row);
  } else if (type === 'fatwa') {
    if (meta.categories && meta.categories.length) {
      const cat = String(meta.categories[0]).slice(0, 40);
      rows.push([{ text: '➡️ More', callback_data: `nf|${cat}` }]);
    }
  } else if (type === 'menu') {
    rows.push([
      { text: '📿 Hadith',   callback_data: 'mi|hadith' },
      { text: '📖 Quran',    callback_data: 'mi|quran'  },
    ]);
    rows.push([
      { text: '🤲 Dua',      callback_data: 'mi|dua'    },
      { text: '⚖️ Fatwa',    callback_data: 'mi|fatwa'  },
    ]);
    rows.push([
      { text: '🕌 Prayer times', callback_data: 'px' },
    ]);
  } else if (type === 'search') {
    // Numbered pick-list — let the user page to the next results with one tap
    // (same `mr` synthetic-"more" the breadcrumb invites). Only when more remain.
    if (meta.hasMore) rows.push([{ text: '➡️ More', callback_data: 'mr' }]);
  }

  return rows.length ? { inline_keyboard: rows } : null;
}

/**
 * Send a Telegram message via the Bot API, automatically splitting any text
 * over the limit into multiple ordered messages. Buttons (reply_markup) are
 * attached only to the final chunk. Returns true if all parts sent.
 * @param {object} opts
 * @param {string} opts.token
 * @param {string|number} opts.chatId
 * @param {string} opts.text
 * @param {object} [opts.logger]
 * @param {object} [opts.replyMarkup]   Telegram inline_keyboard object
 * @returns {Promise<boolean>}
 */
async function sendTelegramMessage({ token, chatId, text, logger, replyMarkup } = {}) {
  const log = logger || { warn() {}, error() {} };
  if (!token || !chatId || !text) return false;
  const parts = splitForTelegram(text);
  let ok = true;
  for (let i = 0; i < parts.length; i++) {
    const isLast = i === parts.length - 1;
    // eslint-disable-next-line no-await-in-loop
    ok = (await sendOneMessage({ token, chatId, text: parts[i], log,
      replyMarkup: isLast ? replyMarkup : null })) && ok;
  }
  return ok;
}

// Send exactly one (already size-bounded) message. Markdown first, plain on retry.
async function sendOneMessage({ token, chatId, text, log, replyMarkup }) {
  const url = `${TG_BASE}/bot${token}/sendMessage`;
  const buildBody = (parseMode) => {
    const obj = { chat_id: chatId, text };
    if (parseMode) obj.parse_mode = parseMode;
    if (replyMarkup) obj.reply_markup = replyMarkup;
    return JSON.stringify(obj);
  };
  try {
    const res = await httpsRequest({
      url, method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: buildBody('Markdown'),
    });
    if (res.ok) return true;
    // Markdown parse failure — retry as plain text (preserve buttons).
    const plain = await httpsRequest({
      url, method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: buildBody(null),
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

// Fast slash commands that bypass Claude — map slash name → callback_data token.
const FAST_SLASH_MAP = {
  menu:   'mc',
  hadith: 'mi|hadith',
  quran:  'mi|quran',
  dua:    'mi|dua',
  fatwa:  'mi|fatwa',
};

class TelegramBotListener {
  /**
   * @param {object} opts
   * @param {string}   opts.token       Telegram bot token
   * @param {Function} opts.onMessage   async (text, chatId) => {text, meta}|string|null
   * @param {Function} [opts.onCallback] async (data, chatId, messageId) => {text, meta}|string|null
   * @param {object}   [opts.logger]
   */
  constructor({ token, onMessage, onCallback, logger } = {}) {
    this._token      = token;
    this._onMessage  = onMessage;
    this._onCallback = onCallback || null;
    this._logger     = logger || { log() {}, debug() {}, warn() {}, error() {} };
    this._offset     = 0;
    this._running    = false;
    this._abortCtrl  = null;
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._logger.log('TelegramBotListener: polling started');
    this._setCommands().catch(() => {});
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
          if (upd.callback_query) {
            this._dispatchCallback(upd.callback_query).catch(e =>
              this._logger.error('TelegramBotListener callback dispatch error', e));
            continue;
          }
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

    // Fast-path: known slash commands that bypass Claude (no rate-limit, no
    // API key needed). Anything not in FAST_SLASH_MAP falls through to Claude.
    const fastToken = this._fastSlash(text);
    if (fastToken && this._onCallback) {
      await this._deliverCallback(fastToken, chatId, null);
      return;
    }

    this._sendTyping(chatId).catch(() => {});
    const typingInterval = setInterval(() => this._sendTyping(chatId).catch(() => {}), 4000);
    let result;
    try {
      result = await this._onMessage(text, chatId);
    } catch (e) {
      this._logger.error('TelegramBotListener onMessage error', e);
      clearInterval(typingInterval);
      return;
    }
    clearInterval(typingInterval);

    if (result) {
      const replyText   = typeof result === 'object' ? result.text   : result;
      const meta        = typeof result === 'object' ? result.meta   : null;
      const replyMarkup = buildReplyMarkup(meta);
      if (replyText) {
        this._logger.log(`TelegramBotListener: sending reply to ${chatId} (${replyText.length} chars)`);
        await this._sendMessage(chatId, replyText, replyMarkup);
      }
    } else {
      this._logger.log(`TelegramBotListener: no reply produced for ${chatId}`);
    }
  }

  // Return the callback_data token for a known fast slash command, or null.
  _fastSlash(text) {
    const m = (text || '').match(/^\/([a-zA-Z]+)(?:\s|$)/);
    if (!m) return null;
    return FAST_SLASH_MAP[m[1].toLowerCase()] || null;
  }

  async _dispatchCallback(callbackQuery) {
    const chatId    = String(callbackQuery.message && callbackQuery.message.chat
      ? callbackQuery.message.chat.id : 0);
    const messageId = callbackQuery.message && callbackQuery.message.message_id;
    const data      = callbackQuery.data || '';

    // Answer immediately — clears the spinner on the button regardless of outcome.
    await this.answerCallbackQuery(callbackQuery.id);

    if (!this._onCallback) return;
    await this._deliverCallback(data, chatId, messageId);
  }

  async _deliverCallback(data, chatId, messageId) {
    this._logger.log(`TelegramBotListener: callback from ${chatId}: ${data}`);
    this._sendTyping(chatId).catch(() => {});
    const typingInterval = setInterval(() => this._sendTyping(chatId).catch(() => {}), 4000);

    let result;
    try {
      result = await this._onCallback(data, chatId, messageId);
    } catch (e) {
      this._logger.error('TelegramBotListener onCallback error', e);
    } finally {
      clearInterval(typingInterval);
    }

    if (result) {
      const replyText   = typeof result === 'object' ? result.text   : result;
      const meta        = typeof result === 'object' ? result.meta   : null;
      const replyMarkup = buildReplyMarkup(meta);
      if (replyText) {
        await this._sendMessage(chatId, replyText, replyMarkup);
      }
    }
  }

  async answerCallbackQuery(callbackQueryId, text = '') {
    try {
      await httpsRequest({
        url:     `${TG_BASE}/bot${this._token}/answerCallbackQuery`,
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ callback_query_id: callbackQueryId, text }),
      });
    } catch (e) {
      this._logger.warn('answerCallbackQuery error', e.message);
    }
  }

  async _setCommands() {
    try {
      await httpsRequest({
        url:     `${TG_BASE}/bot${this._token}/setMyCommands`,
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          commands: [
            { command: 'menu',   description: 'Main menu' },
            { command: 'hadith', description: 'Random hadith' },
            { command: 'quran',  description: 'Random Quran verse' },
            { command: 'dua',    description: 'Random dua (adhkar)' },
            { command: 'fatwa',  description: 'Random fatwa' },
          ],
        }),
      });
      this._logger.log('TelegramBotListener: slash commands registered');
    } catch (e) {
      this._logger.warn('TelegramBotListener: setMyCommands failed: ' + e.message);
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
    const allowed = encodeURIComponent('["message","callback_query"]');
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

  async _sendMessage(chatId, text, replyMarkup) {
    return sendTelegramMessage({
      token: this._token, chatId, text, logger: this._logger, replyMarkup,
    });
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = TelegramBotListener;
module.exports.sendTelegramMessage = sendTelegramMessage;
module.exports.splitForTelegram    = splitForTelegram;
module.exports.buildReplyMarkup    = buildReplyMarkup;
module.exports.TG_MAX_CHARS        = TG_MAX_CHARS;
