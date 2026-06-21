'use strict';

const Homey = require('homey');

/**
 * Two-layer logger for Homey SDK3.
 *
 * Layer 1 — Homey native: this.log() / this.error() always fire.
 *   Output is visible in Homey Developer Tools and the Homey mobile app.
 *
 * Layer 2 — Sentry (optional): errors are forwarded when SENTRY_DSN is set
 *   in env.json. Uses @sentry/node v7 with ALL auto-instrumentation disabled
 *   to avoid bundle bloat and process-hook conflicts with the Homey runtime.
 *
 * DSN setup:
 *   1. Create env.json at the app root (add to .gitignore):
 *      { "SENTRY_DSN": "https://<key>@sentry.io/<project>" }
 *   2. npm install @sentry/node@7
 *   3. That's it — Logger initialises Sentry lazily on first error.
 */

let _sentry = null;   // false = init was attempted, no DSN; object = ready

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
   * Log an error to Homey and (if DSN configured) capture in Sentry.
   * @param {string} label  Short context label, e.g. 'AudioRouter.dispatch'
   * @param {Error|string} err
   * @param {object} [extra]  Key/value pairs attached to the Sentry event
   */
  error(label, err, extra) {
    const msg = err instanceof Error ? err.message : String(err ?? '');
    this._homey.app.error(`[${label}]`, msg);

    const S = this._sentry();
    if (!S) return;

    S.withScope(scope => {
      scope.setTag('label', label);
      if (extra) scope.setContext('extra', extra);
      if (err instanceof Error) {
        S.captureException(err);
      } else {
        S.captureMessage(`[${label}] ${msg}`, 'error');
      }
    });
  }

  /**
   * Explicitly capture an exception (e.g. in a try/catch that you handle but
   * still want tracked in Sentry).
   * @param {Error} err
   * @param {object} [context]
   */
  capture(err, context = {}) {
    const S = this._sentry();
    if (!S) return;
    S.withScope(scope => {
      Object.entries(context).forEach(([k, v]) => scope.setContext(k, v));
      S.captureException(err instanceof Error ? err : new Error(String(err)));
    });
  }

  // ── Sentry lazy init ────────────────────────────────────────────────────────

  _sentry() {
    if (_sentry !== null) return _sentry || null;

    try {
      const _env = this._homey.env || Homey.env || {};
      const dsn = _env.SENTRY_DSN || _env.DSN;
      if (!dsn) { _sentry = false; return null; }

      const S = require('@sentry/node');
      S.init({
        dsn,
        release:           `${this._homey.app.manifest.id}@${this._homey.app.manifest.version}`,
        environment:       'production',
        integrations:      [],    // no HTTP, Express, or any other auto-integration
        tracesSampleRate:  0,     // performance tracing OFF
        sampleRate:        1.0,
      });
      _sentry = S;
      this._homey.app.log('Sentry initialised');
    } catch (e) {
      this._homey.app.error('Sentry init failed:', e.message);
      _sentry = false;
    }

    return _sentry || null;
  }
}

module.exports = Logger;
