'use strict';

const adhan = require('adhan-extended');
const https = require('https');
const { buildParams, resolveCoords } = require('./lib/calc');

module.exports = {

  // GET /previewTimes[?days=N]
  // days=1 (default) → flat object for today (backward-compatible).
  // days=N → array of N day objects with adjustments applied.
  async previewTimes({ homey, query }) {
    const days   = Math.min(Math.max(parseInt(query.days) || 1, 1), 7);
    const calc   = homey.settings.get('calculation') || {};
    // Allow caller to pass unsaved adjustments via ?adj=JSON (e.g. Preview button)
    const adj    = query.adj
      ? (() => { try { return JSON.parse(query.adj); } catch (_) { return {}; } })()
      : (homey.settings.get('adjustments') || {});

    const params = buildParams(calc);
    const coords = resolveCoords(homey);
    const tz = homey.clock.getTimezone();

    function fmtAdj(d, prayer) {
      if (!d) return '--:--';
      const offsetMs = (adj[prayer] || 0) * 60000;
      return new Date(d.getTime() + offsetMs)
        .toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz });
    }

    if (days === 1) {
      // Flat object — backward-compatible with existing UI code.
      const pt = new adhan.PrayerTimes(coords, new Date(), params);
      return {
        Fajr:    fmtAdj(pt.fajr,    'Fajr'),
        Sunrise: fmtAdj(pt.sunrise, 'Sunrise'),
        Dhuhr:   fmtAdj(pt.dhuhr,   'Dhuhr'),
        Asr:     fmtAdj(pt.asr,     'Asr'),
        Maghrib: fmtAdj(pt.maghrib, 'Maghrib'),
        Isha:    fmtAdj(pt.isha,    'Isha'),
      };
    }

    // Multi-day array.
    const result = [];
    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + i);
      const pt    = new adhan.PrayerTimes(coords, d, params);
      const label = d.toLocaleDateString('en-GB', {
        weekday: 'short', day: '2-digit', month: 'short', timeZone: tz,
      });
      result.push({
        date:    label,
        Fajr:    fmtAdj(pt.fajr,    'Fajr'),
        Sunrise: fmtAdj(pt.sunrise, 'Sunrise'),
        Dhuhr:   fmtAdj(pt.dhuhr,   'Dhuhr'),
        Asr:     fmtAdj(pt.asr,     'Asr'),
        Maghrib: fmtAdj(pt.maghrib, 'Maghrib'),
        Isha:    fmtAdj(pt.isha,    'Isha'),
      });
    }
    return result;
  },

  // GET /searchCity?q=...
  // Calls Nominatim (OpenStreetMap) — no API key required.
  async searchCity({ query }) {
    const q = (query.q || '').trim();
    if (!q) return [];

    return new Promise((resolve) => {
      const url = 'https://nominatim.openstreetmap.org/search?'
        + 'q=' + encodeURIComponent(q)
        + '&format=json&limit=5&addressdetails=1';

      const req = https.request(url, {
        headers: { 'User-Agent': 'QuranAdhanHub/1.0 (homey-app)' },
      }, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const items = JSON.parse(data);
            const mapped = items.map(r => {
              const addr = r.address || {};
              const city = addr.city || addr.town || addr.village || addr.municipality || r.name || '';
              const country = addr.country || '';
              const countryCode = (addr.country_code || '').toUpperCase();
              const parts = r.display_name.split(',').slice(0, 3).map(s => s.trim()).filter(Boolean);
              return {
                display:     parts.join(', '),
                city,
                country,
                countryCode,
                lat:  parseFloat(r.lat).toFixed(4),
                lng:  parseFloat(r.lon).toFixed(4),
              };
            });
            resolve(mapped);
          } catch (_) {
            resolve([]);
          }
        });
      });
      req.on('error', () => resolve([]));
      req.setTimeout(6000, () => { req.destroy(); resolve([]); });
      req.end();
    });
  },

  // GET /location
  async getLocation({ homey }) {
    return {
      lat:      homey.geolocation.getLatitude(),
      lng:      homey.geolocation.getLongitude(),
      timezone: homey.clock.getTimezone(),
    };
  },

  // GET /status
  async getStatus({ homey }) {
    const HijriCalendar = require('./lib/HijriCalendar');
    const hijri = new HijriCalendar(homey.settings.get('hijriConfig') || {});
    return {
      isRamadan:  hijri.isRamadan(),
      hijriInfo:  hijri.todayInfo(),
      hijriMethods: HijriCalendar.getMethods(),
      appEnabled: homey.settings.get('advanced')?.appEnabled !== false,
    };
  },

  // POST /reschedule
  async reschedule({ homey }) {
    await homey.app.scheduler.reschedule();
    return { ok: true };
  },

  // GET /widgetData — single call returning everything the prayer-times widget needs
  async widgetData({ homey }) {
    const HijriCalendar = require('./lib/HijriCalendar');

    const loc  = homey.settings.get('location')    || {};
    const calc = homey.settings.get('calculation') || {};
    const adj  = homey.settings.get('adjustments') || {};

    const params = buildParams(calc);
    const coords  = resolveCoords(homey);
    const tz      = homey.clock.getTimezone();
    const now     = new Date();
    const nowMs   = now.getTime();

    const pt = new adhan.PrayerTimes(coords, now, params);

    function adjTime(d, prayer) {
      if (!d) return null;
      return new Date(d.getTime() + (adj[prayer] || 0) * 60000);
    }
    function fmt(d) {
      if (!d) return '--:--';
      return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz });
    }

    const todayPrayers = [
      { name: 'Fajr',    time: adjTime(pt.fajr,    'Fajr')    },
      { name: 'Sunrise', time: adjTime(pt.sunrise, 'Sunrise') },
      { name: 'Dhuhr',   time: adjTime(pt.dhuhr,   'Dhuhr')   },
      { name: 'Asr',     time: adjTime(pt.asr,      'Asr')     },
      { name: 'Maghrib', time: adjTime(pt.maghrib, 'Maghrib') },
      { name: 'Isha',    time: adjTime(pt.isha,     'Isha')    },
    ];

    const nextIdx = todayPrayers.findIndex(p => p.time && p.time.getTime() > nowMs);

    // All today's prayers done — look up tomorrow's Fajr
    let overrideNext = null;
    if (nextIdx === -1) {
      const tmr = new Date(now);
      tmr.setDate(tmr.getDate() + 1);
      tmr.setHours(0, 0, 0, 0);
      const tmrPt    = new adhan.PrayerTimes(coords, tmr, params);
      const tmrFajr  = adjTime(tmrPt.fajr, 'Fajr');
      overrideNext   = {
        name:   'Fajr',
        time:   fmt(tmrFajr),
        timeMs: tmrFajr ? tmrFajr.getTime() : null,
      };
    }

    const hijri = new HijriCalendar(homey.settings.get('hijriConfig') || {});

    return {
      city:        loc.city    || null,
      country:     loc.country || null,
      hijriDate:   hijri.todayInfo(),
      overrideNext,
      prayers: todayPrayers.map((p, i) => ({
        name:   p.name,
        time:   fmt(p.time),
        timeMs: p.time ? p.time.getTime() : null,
        passed: p.time ? p.time.getTime() <= nowMs : false,
        isNext: i === nextIdx,
      })),
    };
  },

  // GET /assistantConfig
  // Returns the assistant settings for the settings UI. NEVER returns the
  // Anthropic API key — it is read directly by the in-app card, never exposed.
  async assistantConfig({ homey }) {
    const a = homey.settings.get('assistant') || {};
    return {
      // Strict boolean: true only when explicitly enabled. (`a.enabled` is
      // undefined before the migration default runs — return false, not undefined.)
      enabled:            a.enabled === true,
      allowedNumbers:     Array.isArray(a.allowedNumbers) ? a.allowedNumbers : [],
      fallbackMessage:    a.fallbackMessage    || 'Prayer Assistant is currently unavailable.',
      model:              a.model              || 'claude-sonnet-4-6',
      customInstructions: a.customInstructions || '',
      rateLimitSeconds:   typeof a.rateLimitSeconds === 'number' ? a.rateLimitSeconds : 10,
      dailyCap:           typeof a.dailyCap         === 'number' ? a.dailyCap         : 50,
      language:           ['arabic', 'english', 'both'].includes(a.language) ? a.language : 'both',
      translit:           a.translit === true,
      hasKey:             typeof a.anthropicKey === 'string' && a.anthropicKey.startsWith('sk-'),
    };
  },

  // POST /validateAssistantKey  { key }
  // Server-side ping to the Anthropic API so the settings page (a browser
  // context that cannot call Anthropic directly) can verify a key on save.
  async validateAssistantKey({ homey, body }) {
    const key = (body && body.key) || (homey.settings.get('assistant') || {}).anthropicKey || '';
    if (!key || !key.startsWith('sk-')) return { ok: false, error: 'Key must start with sk-' };

    const model = (homey.settings.get('assistant') || {}).model || 'claude-sonnet-4-6';
    return new Promise((resolve) => {
      const payload = JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] });
      const req = https.request('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         key,
          'anthropic-version': '2023-06-01',
          'Content-Length':    Buffer.byteLength(payload),
        },
      }, (res) => {
        let data = '';
        res.on('data', c => { data += c; });
        res.on('end', () => {
          if (res.statusCode === 200) return resolve({ ok: true });
          let msg = 'HTTP ' + res.statusCode;
          try { const j = JSON.parse(data); if (j.error && j.error.message) msg = j.error.message; } catch (_) { /* ignore */ }
          resolve({ ok: false, error: msg });
        });
      });
      req.on('error', e => resolve({ ok: false, error: e.message }));
      req.setTimeout(10000, () => { req.destroy(); resolve({ ok: false, error: 'Timed out' }); });
      req.end(payload);
    });
  },
};
