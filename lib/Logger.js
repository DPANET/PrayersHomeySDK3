'use strict';

/**
 * Logger for Homey SDK3 — Homey native only.
 *
 * this.log() / this.error() always fire; output is visible in Homey Developer
 * Tools and the Homey mobile app. No external error-reporting dependency: the
 * previous optional Sentry layer was removed to keep the app's memory footprint
 * minimal (@sentry/node v7 added ~7.7 MB RSS once loaded).
 *
 * The error()/capture() signatures are preserved so existing callers keep
 * working — any `extra`/`context` is appended to the native error line.
 */

class Logger {
  constructor(homey) {
    this._homey = homey;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  log(...args)   { this._homey.app.log(...args); }
  warn(...args)  { this._homey.app.log('[WARN]', ...args); }

  // Verbose per-timer/per-reconcile tracing. Off by default so production logs
  // stay readable; enable via the Advanced settings "Debug logging" toggle.
  debug(...args) {
    if ((this._homey.settings.get('advanced') || {}).debugLogging === true) {
      this._homey.app.log('[DBG]', ...args);
    }
  }

  /**
   * Log an error to Homey's native error stream.
   * @param {string} label  Short context label, e.g. 'AudioRouter.dispatch'
   * @param {Error|string} err
   * @param {object} [extra]  Optional key/value context, appended to the line.
   */
  error(label, err, extra) {
    const msg = err instanceof Error ? err.message : String(err ?? '');
    if (extra && Object.keys(extra).length) {
      this._homey.app.error(`[${label}]`, msg, extra);
    } else {
      this._homey.app.error(`[${label}]`, msg);
    }
  }

  /**
   * Capture an exception you handled but still want surfaced in the logs.
   * @param {Error} err
   * @param {object} [context]
   */
  capture(err, context = {}) {
    const e = err instanceof Error ? err : new Error(String(err));
    if (context && Object.keys(context).length) {
      this._homey.app.error('[capture]', e.message, context);
    } else {
      this._homey.app.error('[capture]', e.message);
    }
  }
}

module.exports = Logger;
