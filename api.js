'use strict';

const adhan = require('adhan-extended');
const https = require('https');

const HIGH_LAT_RULES = {
  TwilightAngle:     adhan.HighLatitudeRule.TwilightAngle,
  MiddleOfTheNight:  adhan.HighLatitudeRule.MiddleOfTheNight,
  SeventhOfTheNight: adhan.HighLatitudeRule.SeventhOfTheNight,
};

function buildParams(calc) {
  const params = (adhan.CalculationMethod[calc.method || 'Dubai']
    || adhan.CalculationMethod.Dubai)();
  params.madhab = calc.madhab === 'Hanafi' ? adhan.Madhab.Hanafi : adhan.Madhab.Shafi;
  if (calc.highLat && HIGH_LAT_RULES[calc.highLat]) {
    params.highLatitudeRule = HIGH_LAT_RULES[calc.highLat];
  }
  return params;
}

module.exports = {

  // GET /previewTimes[?days=N]
  // days=1 (default) → flat object for today (backward-compatible).
  // days=N → array of N day objects with adjustments applied.
  async previewTimes({ homey, query }) {
    const days   = Math.min(Math.max(parseInt(query.days) || 1, 1), 7);
    const loc    = homey.settings.get('location')    || {};
    const calc   = homey.settings.get('calculation') || {};
    // Allow caller to pass unsaved adjustments via ?adj=JSON (e.g. Preview button)
    const adj    = query.adj
      ? (() => { try { return JSON.parse(query.adj); } catch (_) { return {}; } })()
      : (homey.settings.get('adjustments') || {});

    const lat = loc.useHomeyLoc !== false
      ? homey.geolocation.getLatitude()
      : parseFloat(loc.lat  || 24.45);
    const lng = loc.useHomeyLoc !== false
      ? homey.geolocation.getLongitude()
      : parseFloat(loc.lng  || 54.37);

    const params = buildParams(calc);
    const coords = new adhan.Coordinates(lat, lng);
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

  // GET /speakers — lists ALL speakers across ALL apps via homey-api
  async getSpeakers({ homey }) {
    const devices = await homey.app.homeyApi.devices.getDevices();
    return Object.values(devices)
      .filter(d => d.capabilities?.some(c => ['volume_set', 'speaker_playing', 'speaker_next'].includes(c)))
      .map(d => ({ id: d.id, name: d.name, zone: d.zone?.name || d.zone || '' }));
  },

  // GET /location
  async getLocation({ homey }) {
    return {
      lat:      homey.geolocation.getLatitude(),
      lng:      homey.geolocation.getLongitude(),
      timezone: homey.clock.getTimezone(),
    };
  },

  // GET /reciters
  async getReciters({ homey }) {
    return homey.app.audioRouter.getReciterNames();
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

  // POST /testAudio
  async testAudio({ homey, body }) {
    const groups = homey.settings.get('speakerGroups') || [];
    const group  = groups.find(g => g.id === body.groupId);
    if (!group?.speakers?.length) throw new Error('Speaker group has no speakers configured');
    const prayerName  = body.prayer || 'Fajr';
    const prayerAudio = homey.settings.get('prayerAudio') || {};
    const audioConfig = homey.settings.get('audioConfig')  || {};
    const pCfg        = prayerAudio[prayerName] || {};
    for (const speaker of group.speakers) {
      if (speaker.speakerId) {
        await homey.app.audioRouter._dispatchToGroup(group, speaker, prayerName, pCfg, audioConfig);
      }
    }
    return { ok: true };
  },

  // GET /diagnosePlayback
  // Inspects each configured speaker and reports which "play a URL / cast"
  // action cards its owning app exposes — the raw material for auto-wiring a
  // bridge Flow. Read-only; needs the homey:manager:flow permission.
  async diagnosePlayback({ homey }) {
    const api = homey.app.homeyApi;

    const devices = await api.devices.getDevices();
    const groups  = homey.settings.get('speakerGroups') || [];
    const speakerIds = [...new Set(
      groups.flatMap(g => (g.speakers || []).map(s => s.speakerId)).filter(Boolean),
    )];

    // All action-card definitions across every installed app.
    let cardsRaw;
    try {
      cardsRaw = await api.flow.getFlowCardActions();
    } catch (e) {
      return { error: 'Could not read flow action cards: ' + e.message };
    }
    const cards = Array.isArray(cardsRaw) ? cardsRaw : Object.values(cardsRaw || {});

    const looksLikeUrlCard = c => {
      const hay = `${c.id || ''} ${JSON.stringify(c.title || '')}`.toLowerCase();
      return /url|stream|cast|media|http/.test(hay);
    };
    const summarizeCard = c => ({
      id:    c.id,
      uri:   c.uri,
      title: c.title,
      args:  (c.args || []).map(a => ({ name: a.name, type: a.type, title: a.title })),
    });

    const speakers = speakerIds.map(id => {
      const d = devices[id];
      if (!d) return { speakerId: id, found: false };

      const appUri  = d.driverUri || d.ownerUri || '';        // e.g. homey:app:com.google.cast
      const appPart = appUri.split(':').slice(0, 3).join(':'); // homey:app:com.google.cast

      const ownCards = cards
        .filter(c => (c.uri || '').startsWith(appPart) && appPart)
        .map(summarizeCard);
      const urlCards = ownCards.filter(looksLikeUrlCard);

      return {
        speakerId:    id,
        name:         d.name,
        driverUri:    d.driverUri,
        ownerUri:     d.ownerUri,
        capabilities: d.capabilities,
        appUri:       appPart,
        urlCards,                        // best candidates for auto-wiring
        allAppCards:  ownCards,          // everything this app exposes, for reference
      };
    });

    // Global fallback: any card anywhere that looks URL-capable, in case the
    // device's app uri doesn't match cleanly.
    const globalUrlCards = cards.filter(looksLikeUrlCard).map(summarizeCard);

    return { speakers, globalUrlCards };
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

    const lat = loc.useHomeyLoc !== false
      ? homey.geolocation.getLatitude()
      : parseFloat(loc.lat || 24.45);
    const lng = loc.useHomeyLoc !== false
      ? homey.geolocation.getLongitude()
      : parseFloat(loc.lng || 54.37);

    const params = buildParams(calc);
    const coords  = new adhan.Coordinates(lat, lng);
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

  // POST /stopAudio
  async stopAudio({ homey, body }) {
    const groups = homey.settings.get('speakerGroups') || [];
    const group  = groups.find(g => g.id === body.groupId);
    if (!group) return { ok: false };
    await homey.app.audioRouter.stopGroup(group);
    return { ok: true };
  },
};
