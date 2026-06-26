'use strict';

/**
 * ClaudeClient — minimal Anthropic Messages API client over fetch.
 *
 * Matches the house style of api.js (plain HTTP, no SDK). Node 22 provides a
 * global fetch; `fetchImpl` is injectable so the test suite drives the 2-call
 * tool loop with canned responses and never hits the network.
 *
 * The tool loop runs up to DEFAULT_MAX_TOOL_ROUNDS round-trips, which lets a
 * single reply chain several tools (e.g. prayer data + a hadith) while still
 * bounding latency and token spend with a hard ceiling.
 */

const API_URL          = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL    = 'claude-sonnet-4-6';
const DEFAULT_MAX_TOKENS = 2000;
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_TOOL_ROUNDS = 5;

function defaultFetch() {
  if (typeof fetch === 'function') return fetch;
  throw new Error('No fetch implementation available');
}

class ClaudeClient {
  /**
   * @param {object} opts
   * @param {string} opts.apiKey
   * @param {string} [opts.model]
   * @param {Function} [opts.fetchImpl]
   * @param {number} [opts.timeoutMs]
   * @param {number} [opts.maxTokens]
   */
  constructor({ apiKey, model, fetchImpl, timeoutMs, maxTokens, maxToolRounds, logger } = {}) {
    this.apiKey        = apiKey;
    this.model         = model || DEFAULT_MODEL;
    this.fetchImpl     = fetchImpl || defaultFetch();
    this.timeoutMs     = timeoutMs || DEFAULT_TIMEOUT_MS;
    this.maxTokens     = maxTokens || DEFAULT_MAX_TOKENS;
    this.maxToolRounds = typeof maxToolRounds === 'number' ? maxToolRounds : DEFAULT_MAX_TOOL_ROUNDS;
    this.logger        = logger || null;
  }

  async _post(body, round) {
    const ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), this.timeoutMs) : null;
    const t0 = Date.now();
    try {
      const res = await this.fetchImpl(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         this.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
        signal: ctrl ? ctrl.signal : undefined,
      });
      if (!res || !res.ok) throw new Error('Claude HTTP ' + (res ? res.status : 'no-response'));
      const json = await res.json();
      if (this.logger) {
        const u = (json && json.usage) || {};
        this.logger.log('[timing] claude round ' + round + ': ' + (Date.now() - t0) + 'ms'
          + ' (in=' + (u.input_tokens || 0)
          + ' cacheRead=' + (u.cache_read_input_tokens || 0)
          + ' cacheWrite=' + (u.cache_creation_input_tokens || 0)
          + ' out=' + (u.output_tokens || 0) + ')');
      }
      return json;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Run a completion, resolving up to `maxToolRounds` tool round-trips. Each
   * round runs every tool_use block the model emitted (parallel tool calls are
   * supported) before asking the model to continue.
   * @param {object} opts
   * @param {Array}  opts.messages   initial message array
   * @param {string} opts.system
   * @param {Array}  [opts.tools]
   * @param {Function} [opts.runTool] async (name, input) => result; required if tools given
   * @returns {Promise<string>}  the assistant's text reply
   */
  async complete({ messages, system, tools, runTool }) {
    const base = { model: this.model, max_tokens: this.maxTokens };
    // Send system as a single cached text block. The cache breakpoint here covers
    // the whole static prefix (tools + system, ~1.5k tokens, above the 1024 min),
    // so every tool-loop round after the first is a cache read (~10% input cost).
    if (system) base.system = [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }];
    if (tools && tools.length) base.tools = tools;

    let convo = messages.slice();
    let data = await this._post({ ...base, messages: convo }, 1);

    let rounds = 0;
    while (data.stop_reason === 'tool_use'
        && typeof runTool === 'function'
        && rounds < this.maxToolRounds) {
      const toolBlocks = (data.content || []).filter(b => b.type === 'tool_use');
      if (!toolBlocks.length) break;

      const results = [];
      for (const tb of toolBlocks) {
        let result;
        try {
          result = await runTool(tb.name, tb.input || {});
        } catch (e) {
          result = { error: String(e && e.message ? e.message : e) };
        }
        results.push({ type: 'tool_result', tool_use_id: tb.id, content: JSON.stringify(result) });
      }

      convo = [
        ...convo,
        { role: 'assistant', content: data.content },
        { role: 'user', content: results },
      ];
      rounds++;
      data = await this._post({ ...base, messages: convo }, rounds + 1);
    }

    const textBlock = (data.content || []).find(b => b.type === 'text');
    return textBlock && textBlock.text ? textBlock.text : '';
  }
}

module.exports = ClaudeClient;
module.exports.DEFAULT_MODEL = DEFAULT_MODEL;
