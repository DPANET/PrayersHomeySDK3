'use strict';

const Homey            = require('homey');
const adhan            = require('adhan-extended');
const PrayerScheduler  = require('./lib/PrayerScheduler');
const HijriScheduler   = require('./lib/HijriScheduler');
const AudioRouter      = require('./lib/AudioRouter');
const HijriCalendar    = require('./lib/HijriCalendar');
const triggerMatches   = require('./lib/triggerMatch');
const Logger           = require('./lib/Logger');
const IslamicAssistantCard  = require('./lib/IslamicAssistantCard');
const PromptLibrary         = require('./lib/PromptLibrary');
const TelegramBotListener   = require('./lib/TelegramBotListener');
const { sendTelegramMessage } = require('./lib/TelegramBotListener');
const { buildParams, resolveCoords } = require('./lib/calc');

class App extends Homey.App {
  async onInit() {
    this.logger = new Logger(this.homey);
    this.logger.log('Prayers Alert: onInit starting…');

    this._migrateSettings();

    this.audioRouter     = new AudioRouter(this.homey);
    this.scheduler       = new PrayerScheduler(this.homey);
    this.hijriScheduler  = new HijriScheduler(this.homey);

    this._registerTriggers();
    this._registerConditions();

    this._assistantCard = new IslamicAssistantCard(this.homey).register();
    this._registerAssistantSendCard();

    // Register the settings watcher ONCE, unconditionally, so saving the bot
    // token / toggling Enable restarts the listener without an app restart.
    this.homey.settings.on('set', (key) => {
      if (key === 'assistant') this._startTelegramListener();
    });
    this._startTelegramListener();

    this.logger.log('Action cards registered: assistant_scheduled, assistant_reply, assistant_send');

    await this.scheduler.init();
    this.logger.debug('PrayerScheduler ready');

    await this.hijriScheduler.init();
    this.logger.debug('HijriScheduler ready');

    const appEnv = process.env.APP_ENV ? JSON.parse(process.env.APP_ENV) : (Homey.env || this.homey.env || {});
    const mapsKey = appEnv.GOOGLE_MAPS_KEY || appEnv.GOOGLE_PLACE_KEY || appEnv.GOOGLE_API_KEY || '';
    if (mapsKey) this.homey.settings.set('googleMapsKey', mapsKey);

    this.logger.log('Prayers Alert v2 started');
  }

  async getWidgetData() {
    try {
    this.logger.log('Widget: getWidgetData called');
    const loc  = this.homey.settings.get('location')    || {};
    const calc = this.homey.settings.get('calculation') || {};
    const adj  = this.homey.settings.get('adjustments') || {};

    const params = buildParams(calc);
    const coords = resolveCoords(this.homey);
    const tz     = this.homey.clock.getTimezone();
    const now    = new Date();
    const nowMs  = now.getTime();

    // Compute prayer times for the user's LOCAL calendar day (per `tz`), not the
    // container's. The container clock is UTC, so just after local midnight in a
    // positive-offset zone (e.g. Asia/Dubai, UTC+4) `new Date()` is still on the
    // PREVIOUS UTC date — which made adhan compute yesterday's times and mark every
    // prayer "passed". Derive Y/M/D in `tz` and build a local-noon date so adhan
    // reads the correct day.
    const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    const [ly, lm, ld] = ymd.split('-').map(Number);
    const localDay = new Date(ly, lm - 1, ld, 12, 0, 0);

    const pt = new adhan.PrayerTimes(coords, localDay, params);

    const adjTime = (d, prayer) => d ? new Date(d.getTime() + (adj[prayer] || 0) * 60000) : null;
    const fmt = d => d
      ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz })
      : '--:--';

    const todayPrayers = [
      { name: 'Fajr',    time: adjTime(pt.fajr,    'Fajr')    },
      { name: 'Sunrise', time: adjTime(pt.sunrise,  'Sunrise') },
      { name: 'Dhuhr',   time: adjTime(pt.dhuhr,    'Dhuhr')   },
      { name: 'Asr',     time: adjTime(pt.asr,      'Asr')     },
      { name: 'Maghrib', time: adjTime(pt.maghrib,  'Maghrib') },
      { name: 'Isha',    time: adjTime(pt.isha,      'Isha')    },
    ];

    const nextIdx = todayPrayers.findIndex(p => p.time && p.time.getTime() > nowMs);

    let overrideNext = null;
    if (nextIdx === -1) {
      const tmr = new Date(localDay);
      tmr.setDate(tmr.getDate() + 1);
      const tmrFajr = adjTime(new adhan.PrayerTimes(coords, tmr, params).fajr, 'Fajr');
      overrideNext  = { name: 'Fajr', time: fmt(tmrFajr), timeMs: tmrFajr ? tmrFajr.getTime() : null };
    }

    const hijri = new HijriCalendar(this.homey.settings.get('hijriConfig') || {});

    const prayers = todayPrayers.map((p, i) => ({
      name:   p.name,
      time:   fmt(p.time),
      timeMs: p.time ? p.time.getTime() : null,
      passed: p.time ? p.time.getTime() <= nowMs : false,
      isNext: i === nextIdx,
    }));

    // Pre-compute the countdown so Claude never needs to do ms arithmetic.
    const nextP = prayers.find(p => p.isNext) || overrideNext;
    const nextMs = nextP && nextP.timeMs ? nextP.timeMs : null;
    const minutesUntilNext = nextMs ? Math.round((nextMs - nowMs) / 60000) : null;

    const result = {
      city:        loc.city    || null,
      country:     loc.country || null,
      hijriDate:   hijri.todayInfo(),
      overrideNext,
      prayers,
      nextPrayer:      nextP ? { name: nextP.name, time: nextP.time } : null,
      minutesUntilNext,
    };
    const nextPrayer = result.prayers.find(p => p.isNext);
    this.logger.log(`Widget: returning ${result.prayers.length} prayers, next=${nextPrayer ? nextPrayer.name + '@' + nextPrayer.time : 'none'}, city=${result.city}`);
    return result;
    } catch (e) {
      this.logger.error('Widget: getWidgetData ERROR:', e.message);
      throw e;
    }
  }

  // ── Combined "generate & send" action card ────────────────────────────────
  // One card: runs the assistant in schedule mode, then sends the reply straight
  // to a Telegram chat via the built-in bot — no Advanced Flow, no spkes app.
  _registerAssistantSendCard() {
    const card = this.homey.flow.getActionCard('assistant_send');

    if (card.registerArgumentAutocompleteListener) {
      card.registerArgumentAutocompleteListener('preset', async (query) =>
        PromptLibrary.search(this.homey.settings.get('promptLibrary'), query));
    }

    card.registerRunListener(async (args) => {
      const result = await this._assistantCard.run({
        preset: args.preset,
        custom: args.custom,
        mode:   'schedule',
      });

      const cfg    = this.homey.settings.get('assistant') || {};
      const token  = (cfg.telegramBotToken || '').trim();
      const chatId = (cfg.defaultChatId    || '').trim();
      if (result.assistant_success && result.assistant_reply) {
        if (!token) {
          this.logger.warn('assistant_send: no bot token in settings — cannot send');
        } else if (!chatId) {
          this.logger.warn('assistant_send: no default chat ID in settings — cannot send');
        } else {
          const sent = await sendTelegramMessage({
            token, chatId, text: result.assistant_reply, logger: this.logger,
          });
          this.logger.log(`assistant_send: ${sent ? 'sent' : 'send failed'} to ${chatId}`);
        }
      }

      // Still return the tokens so the card composes in Advanced Flows too.
      return result;
    });
  }

  // ── Telegram built-in listener ────────────────────────────────────────────
  _startTelegramListener() {
    const cfg   = this.homey.settings.get('assistant') || {};
    const token = (cfg.telegramBotToken || '').trim();

    // Stop any existing listener first (restart on settings change).
    if (this._telegramListener) {
      this._telegramListener.stop();
      this._telegramListener = null;
    }

    if (!token) {
      this.logger.log('TelegramBotListener: not started — no bot token set');
      return;
    }
    if (cfg.enabled !== true) {
      this.logger.log('TelegramBotListener: not started — assistant is disabled');
      return;
    }

    const card = this._assistantCard;
    this._telegramListener = new TelegramBotListener({
      token,
      logger: this.logger,
      onMessage: async (text, chatId) => {
        const result = await card.run({ text, sender: chatId, mode: 'reply' });
        if (!result || !result.assistant_success) {
          this.logger.log(`TelegramBotListener: no reply for ${chatId} `
            + `(success=${result && result.assistant_success})`);
          return null;
        }
        return result.assistant_reply || null;
      },
    });
    this._telegramListener.start();
  }

  // Convert old app (1.x) settings keys to new format on first run.
  _migrateSettings() {
    // v3.0.0 — assistant default config + prompt library. Runs before the v1.x
    // early-return below so it applies on every upgrade, not just from v1.x.
    // The Anthropic API key now lives in app settings (anthropicKey); the v2.5.0
    // HomeyScript/Logic-variable setup is gone. hadithTime removed (daily hadith
    // is now a user-scheduled Flow using the assistant card + a preset).
    if (!this.homey.settings.get('assistant')) {
      this.homey.settings.set('assistant', {
        enabled:            false,
        anthropicKey:       '',
        telegramBotToken:   '',
        defaultChatId:      '',
        allowedNumbers:     [],
        fallbackMessage:    'Prayer Assistant is currently unavailable.',
        model:              'claude-sonnet-4-6',
        customInstructions: 'Tone: warm, conversational, family-friendly. Always match the language the user wrote in.',
        rateLimitSeconds:   10,
        dailyCap:           50,
        maxTokens:          2000,
        language:           'both',
        translit:           false,
      });
      this.logger.log('Settings migration: assistant defaults written');
    }
    if (!this.homey.settings.get('promptLibrary')) {
      this.homey.settings.set('promptLibrary', PromptLibrary.DEFAULT_PRESETS);
      this.logger.log('Settings migration: prompt library seeded');
    } else if (!this.homey.settings.get('promptLibraryDuasSeeded')) {
      // One-time top-up: add the new Hisn al-Muslim dua presets to libraries
      // seeded before they existed, without disturbing the user's own edits.
      const lib   = this.homey.settings.get('promptLibrary') || [];
      const ids   = new Set(lib.map(p => p && p.id));
      const added = PromptLibrary.DEFAULT_PRESETS.filter(p => /adhkar|dua/.test(p.id) && !ids.has(p.id));
      if (added.length) {
        this.homey.settings.set('promptLibrary', lib.concat(added));
        this.logger.log(`Settings migration: added ${added.length} dua preset(s) to prompt library`);
      }
      this.homey.settings.set('promptLibraryDuasSeeded', true);
    }
    if (!this.homey.settings.get('promptLibraryV2Seeded')) {
      const lib   = this.homey.settings.get('promptLibrary') || [];
      const ids   = new Set(lib.map(p => p && p.id));
      const newIds = ['adhkar_random', 'dua_for_sick', 'new_hijri_month', 'weekly_reminder'];
      const added = PromptLibrary.DEFAULT_PRESETS.filter(p => newIds.includes(p.id) && !ids.has(p.id));
      if (added.length) {
        this.homey.settings.set('promptLibrary', lib.concat(added));
        this.logger.log(`Settings migration: added ${added.length} new preset(s) to prompt library`);
      }
      this.homey.settings.set('promptLibraryV2Seeded', true);
    }
    if (!this.homey.settings.get('promptLibraryV3Seeded')) {
      const lib = this.homey.settings.get('promptLibrary') || [];
      const ids = new Set(lib.map(p => p && p.id));
      const added = PromptLibrary.DEFAULT_PRESETS.filter(p => p.id === 'fatwa_random' && !ids.has(p.id));
      if (added.length) {
        this.homey.settings.set('promptLibrary', lib.concat(added));
        this.logger.log(`Settings migration: added ${added.length} fatwa preset(s) to prompt library`);
      }
      this.homey.settings.set('promptLibraryV3Seeded', true);
    }
    if (!this.homey.settings.get('promptLibraryV4Seeded')) {
      const lib = this.homey.settings.get('promptLibrary') || [];
      const ids = new Set(lib.map(p => p && p.id));
      const added = PromptLibrary.DEFAULT_PRESETS.filter(p => p.id === 'daily_surprise' && !ids.has(p.id));
      if (added.length) {
        this.homey.settings.set('promptLibrary', lib.concat(added));
        this.logger.log(`Settings migration: added ${added.length} surprise preset(s) to prompt library`);
      }
      this.homey.settings.set('promptLibraryV4Seeded', true);
    }
    if (!this.homey.settings.get('promptLibraryV5Seeded')) {
      // Retire three over-specific presets and add three broad, tool-grounded
      // replacements. Drop the old ids; append any new ones not already present.
      const retired = ['dua_for_sick', 'new_hijri_month', 'weekly_reminder'];
      const newIds  = ['dua_of_the_day', 'verse_reflection', 'sunnah_of_the_day'];
      const lib   = (this.homey.settings.get('promptLibrary') || []).filter(p => p && !retired.includes(p.id));
      const ids   = new Set(lib.map(p => p.id));
      const added = PromptLibrary.DEFAULT_PRESETS.filter(p => newIds.includes(p.id) && !ids.has(p.id));
      this.homey.settings.set('promptLibrary', lib.concat(added));
      this.logger.log(`Settings migration: swapped ${retired.length} legacy preset(s) for ${added.length} new one(s)`);
      this.homey.settings.set('promptLibraryV5Seeded', true);
    }
    if (!this.homey.settings.get('promptLibraryV6Seeded')) {
      // Remove three redundant presets superseded by better equivalents.
      const retired = ['daily_hadith', 'quran_verse', 'evening_adhkar'];
      const lib = (this.homey.settings.get('promptLibrary') || []).filter(p => p && !retired.includes(p.id));
      this.homey.settings.set('promptLibrary', lib);
      this.logger.log('Settings migration: removed 3 redundant presets from prompt library');
      this.homey.settings.set('promptLibraryV6Seeded', true);
    }
    if (!this.homey.settings.get('promptLibraryV7Seeded')) {
      // Re-sort existing library to match the priority order in DEFAULT_PRESETS.
      // User-added custom presets (ids not in DEFAULT_PRESETS) are appended after.
      const orderMap = new Map(PromptLibrary.DEFAULT_PRESETS.map((p, i) => [p.id, i]));
      const lib = (this.homey.settings.get('promptLibrary') || []).slice();
      lib.sort((a, b) => {
        const ai = orderMap.has(a.id) ? orderMap.get(a.id) : Infinity;
        const bi = orderMap.has(b.id) ? orderMap.get(b.id) : Infinity;
        return ai - bi;
      });
      this.homey.settings.set('promptLibrary', lib);
      this.logger.log('Settings migration: reordered prompt library by usage priority');
      this.homey.settings.set('promptLibraryV7Seeded', true);
    }
    if (!this.homey.settings.get('promptLibraryV8Seeded')) {
      // Overwrite prompt text of presets that were revised after initial seeding.
      // Seeding only adds new entries; it never updates existing ones — this fixes that.
      const revisedIds = ['daily_surprise', 'morning_briefing', 'morning_evening_adhkar',
        'after_prayer_adhkar', 'before_sleep_adhkar',
        'adhkar_random', 'dua_of_the_day', 'verse_reflection', 'sunnah_of_the_day'];
      const promptMap = new Map(PromptLibrary.DEFAULT_PRESETS.map(p => [p.id, p.prompt]));
      const lib = (this.homey.settings.get('promptLibrary') || []).map(p => {
        if (p && revisedIds.includes(p.id) && promptMap.has(p.id)) {
          return { ...p, prompt: promptMap.get(p.id) };
        }
        return p;
      });
      this.homey.settings.set('promptLibrary', lib);
      this.logger.log('Settings migration: refreshed prompt text for revised presets');
      this.homey.settings.set('promptLibraryV8Seeded', true);
    }
    if (!this.homey.settings.get('promptLibraryV9Seeded')) {
      // Remove 4 seasonal/conditional presets and re-sort so fatwa_random sits in the daily group.
      const retired = ['friday_reminder', 'travel_dua', 'occasion_greeting', 'ramadan_schedule'];
      const orderMap = new Map(PromptLibrary.DEFAULT_PRESETS.map((p, i) => [p.id, i]));
      const lib = (this.homey.settings.get('promptLibrary') || [])
        .filter(p => p && !retired.includes(p.id))
        .sort((a, b) => {
          const ai = orderMap.has(a.id) ? orderMap.get(a.id) : Infinity;
          const bi = orderMap.has(b.id) ? orderMap.get(b.id) : Infinity;
          return ai - bi;
        });
      this.homey.settings.set('promptLibrary', lib);
      this.logger.log('Settings migration: removed 4 seasonal presets, moved fatwa to daily group');
      this.homey.settings.set('promptLibraryV9Seeded', true);
    }
    if (!this.homey.settings.get('promptLibraryV10Seeded')) {
      // Fatwa source switched to IslamQA.info — refresh the prompt text of presets
      // that reference it (seeding only adds, never updates existing entries).
      const revisedIds = ['fatwa_random', 'daily_surprise'];
      const promptMap = new Map(PromptLibrary.DEFAULT_PRESETS.map(p => [p.id, p.prompt]));
      const lib = (this.homey.settings.get('promptLibrary') || []).map(p =>
        (p && revisedIds.includes(p.id) && promptMap.has(p.id)) ? { ...p, prompt: promptMap.get(p.id) } : p);
      this.homey.settings.set('promptLibrary', lib);
      this.logger.log('Settings migration: refreshed fatwa prompts for IslamQA source');
      this.homey.settings.set('promptLibraryV10Seeded', true);
    }
    if (!this.homey.settings.get('promptLibraryV11Seeded')) {
      // morning_briefing and verse_reflection updated to use get_quran query mode
      // instead of hardcoded verse references / Claude's memory recall.
      const revisedIds = ['morning_briefing', 'verse_reflection'];
      const promptMap = new Map(PromptLibrary.DEFAULT_PRESETS.map(p => [p.id, p.prompt]));
      const lib = (this.homey.settings.get('promptLibrary') || []).map(p =>
        (p && revisedIds.includes(p.id) && promptMap.has(p.id)) ? { ...p, prompt: promptMap.get(p.id) } : p);
      this.homey.settings.set('promptLibrary', lib);
      this.logger.log('Settings migration: refreshed morning_briefing and verse_reflection for query-mode get_quran');
      this.homey.settings.set('promptLibraryV11Seeded', true);
    }
    if (!this.homey.settings.get('promptLibraryV12Seeded')) {
      // Content tools now append their block automatically; the model only writes a
      // short intro. Refresh every preset that used the old "relay the block verbatim"
      // wording so the library text matches the new contract (and the pure-relay
      // presets stay byte-identical to the defaults so the Claude-bypass still fires).
      const revisedIds = [
        'morning_briefing', 'daily_surprise', 'verse_reflection', 'sunnah_of_the_day',
        'dua_of_the_day', 'fatwa_random', 'morning_evening_adhkar', 'after_prayer_adhkar',
        'before_sleep_adhkar', 'adhkar_random',
      ];
      const promptMap = new Map(PromptLibrary.DEFAULT_PRESETS.map(p => [p.id, p.prompt]));
      const lib = (this.homey.settings.get('promptLibrary') || []).map(p =>
        (p && revisedIds.includes(p.id) && promptMap.has(p.id)) ? { ...p, prompt: promptMap.get(p.id) } : p);
      this.homey.settings.set('promptLibrary', lib);
      this.logger.log('Settings migration: refreshed presets for auto-append content tools');
      this.homey.settings.set('promptLibraryV12Seeded', true);
    }
    if (!this.homey.settings.get('promptLibraryV13Seeded')) {
      // Content tools now return a placeholder token the model positions (it owns
      // layout); refresh all presets that referenced the old "appended automatically"
      // wording so they match — and so pure-relay presets stay byte-identical to the
      // defaults (keeping the Claude-bypass fast path firing).
      const revisedIds = [
        'morning_briefing', 'daily_surprise', 'verse_reflection', 'sunnah_of_the_day',
        'dua_of_the_day', 'fatwa_random', 'morning_evening_adhkar', 'after_prayer_adhkar',
        'before_sleep_adhkar', 'adhkar_random',
      ];
      const promptMap = new Map(PromptLibrary.DEFAULT_PRESETS.map(p => [p.id, p.prompt]));
      const lib = (this.homey.settings.get('promptLibrary') || []).map(p =>
        (p && revisedIds.includes(p.id) && promptMap.has(p.id)) ? { ...p, prompt: promptMap.get(p.id) } : p);
      this.homey.settings.set('promptLibrary', lib);
      this.logger.log('Settings migration: refreshed presets for placeholder-positioned content');
      this.homey.settings.set('promptLibraryV13Seeded', true);
    }
    if (!this.homey.settings.get('promptLibraryV14Seeded')) {
      // daily_surprise rewritten for true per-run randomness: the prompt now carries
      // a {{RANDOM4}} selector (substituted with a fresh 0–3 roll at run time) and an
      // explicit mod-4 mapping, with every option calling its tool with NO input so the
      // tools self-randomise. Refresh the stored copy so the new text actually ships.
      const promptMap = new Map(PromptLibrary.DEFAULT_PRESETS.map(p => [p.id, p.prompt]));
      const lib = (this.homey.settings.get('promptLibrary') || []).map(p =>
        (p && p.id === 'daily_surprise' && promptMap.has(p.id)) ? { ...p, prompt: promptMap.get(p.id) } : p);
      this.homey.settings.set('promptLibrary', lib);
      this.logger.log('Settings migration: refreshed daily_surprise preset for per-run randomness');
      this.homey.settings.set('promptLibraryV14Seeded', true);
    }
    if (!this.homey.settings.get('promptLibraryV15Seeded')) {
      // Removed presets: morning_briefing, after_prayer_adhkar, before_sleep_adhkar,
      // adhkar_random. Refreshed for per-run randomness ({{RANDOM:N}} selector):
      // dua_of_the_day, verse_reflection. Drop the retired rows from the stored copy
      // and overwrite the two refreshed prompts with the current defaults.
      const retired   = ['morning_briefing', 'after_prayer_adhkar', 'before_sleep_adhkar', 'adhkar_random'];
      const refreshed = ['dua_of_the_day', 'verse_reflection'];
      const promptMap = new Map(PromptLibrary.DEFAULT_PRESETS.map(p => [p.id, p.prompt]));
      const lib = (this.homey.settings.get('promptLibrary') || [])
        .filter(p => p && !retired.includes(p.id))
        .map(p => (refreshed.includes(p.id) && promptMap.has(p.id)) ? { ...p, prompt: promptMap.get(p.id) } : p);
      this.homey.settings.set('promptLibrary', lib);
      this.logger.log('Settings migration: removed 4 presets, refreshed dua_of_the_day + verse_reflection');
      this.homey.settings.set('promptLibraryV15Seeded', true);
    }
    if (!this.homey.settings.get('assistantPersonaV4Seeded')) {
      // Prior default persona said the fatwa answer is "appended automatically"; it is
      // now positioned via a placeholder. Clear that stale default so the corrected
      // code default applies; genuine user edits are left untouched.
      const cfg = this.homey.settings.get('assistant') || {};
      const persona = (cfg.customInstructions || '');
      if (/is appended to your reply\s*automatically/.test(persona)) {
        cfg.customInstructions = '';
        this.homey.settings.set('assistant', cfg);
        this.logger.log('Settings migration: cleared prior default persona (placeholder contract)');
      }
      this.homey.settings.set('assistantPersonaV4Seeded', true);
    }
    if (!this.homey.settings.get('assistantPersonaV3Seeded')) {
      // The previous default persona said "relay the published answer as your whole
      // reply" — accurate before, but content is now auto-appended. If the saved
      // customInstructions is that prior default, clear it so the corrected code
      // default applies. Genuine user edits are left untouched.
      const cfg = this.homey.settings.get('assistant') || {};
      const persona = (cfg.customInstructions || '');
      if (/relay the published answer as your whole/.test(persona)) {
        cfg.customInstructions = '';
        this.homey.settings.set('assistant', cfg);
        this.logger.log('Settings migration: cleared prior default persona (auto-append contract)');
      }
      this.homey.settings.set('assistantPersonaV3Seeded', true);
    }
    if (!this.homey.settings.get('assistantPersonaV2Seeded')) {
      // The old default persona told Claude to "give the general principle" for fiqh,
      // causing it to add its own answer on top of the grounded fatwa. If the saved
      // customInstructions is that old default, clear it so the corrected code default
      // applies. Genuine user edits (without that phrase) are left untouched.
      const cfg = this.homey.settings.get('assistant') || {};
      const persona = (cfg.customInstructions || '');
      if (/give the general\s+principle if one exists/.test(persona)) {
        cfg.customInstructions = '';
        this.homey.settings.set('assistant', cfg);
        this.logger.log('Settings migration: cleared stale default persona (fatwa double-answer fix)');
      }
      this.homey.settings.set('assistantPersonaV2Seeded', true);
    }

    const oldPrayer = this.homey.settings.get('prayerConfig');
    const oldLoc    = this.homey.settings.get('locationConfig');
    if (!oldPrayer && !oldLoc) return;
    this.logger.log('Migrating v1.x settings…');

    if (oldPrayer) {
      const calc = this.homey.settings.get('calculation') || {};
      if (!calc.method && oldPrayer.calculationMethod) calc.method = oldPrayer.calculationMethod;
      if (!calc.madhab && oldPrayer.madhab)            calc.madhab = oldPrayer.madhab;
      this.homey.settings.set('calculation', calc);
      this.homey.settings.unset('prayerConfig');
    }

    if (oldLoc) {
      const loc = this.homey.settings.get('location') || {};
      if (!loc.lat && oldLoc.lat)   loc.lat = String(oldLoc.lat);
      if (!loc.lng && oldLoc.lng)   loc.lng = String(oldLoc.lng);
      if (!loc.city && oldLoc.city) loc.city = oldLoc.city;
      loc.useHomeyLoc = false;
      this.homey.settings.set('location', loc);
      this.homey.settings.unset('locationConfig');
    }
    this.logger.log('Settings migration complete');
  }

  _registerTriggers() {
    this.logger.debug('Registering trigger run listeners…');

    // prayer_trigger_all — fires for every prayer, no condition needed.
    this.homey.flow.getTriggerCard('prayer_trigger_all')
      .registerRunListener(async () => true);

    // prayer_trigger_specific — state carries { prayerName }, arg must match.
    this.homey.flow.getTriggerCard('prayer_trigger_specific')
      .registerRunListener(async (args, state) => args.prayerName === state.prayerName);

    // prayer_trigger_before_after_specific — full match on old arg names.
    this.homey.flow.getTriggerCard('prayer_trigger_before_after_specific')
      .registerRunListener(async (args, state) => triggerMatches(args, state));

    // ── Hijri calendar triggers ───────────────────────────────────────────────
    this.homey.flow.getTriggerCard('hijri_month_event')
      .registerRunListener(async (args, state) =>
        (args.month === 'any' || args.month === String(state.month)) &&
        args.event === state.event
      );

    this.homey.flow.getTriggerCard('hijri_day_of_month')
      .registerRunListener(async (args, state) => Number(args.day) === state.hijriDay);

    this.homey.flow.getTriggerCard('hijri_specific_date')
      .registerRunListener(async (args, state) =>
        Number(args.day) === state.hijriDay && String(args.month) === String(state.hijriMonth)
      );

    this.homey.flow.getTriggerCard('hijri_date_offset')
      .registerRunListener(async (args, state) =>
        args.beforeAfter === state.beforeAfter &&
        Number(args.day)  === state.day &&
        String(args.month) === String(state.month) &&
        Number(args.when) === state.when &&
        args.type         === state.type
      );

    this.homey.flow.getTriggerCard('islamic_occasion_event')
      .registerRunListener(async (args, state) =>
        args.occasion === state.occasion && args.event === state.event
      );

    this.homey.flow.getTriggerCard('islamic_occasion_offset')
      .registerRunListener(async (args, state) =>
        args.occasion    === state.occasion &&
        args.beforeAfter === state.beforeAfter &&
        Number(args.when) === state.when &&
        args.type        === state.type
      );

    this.logger.debug('Trigger run listeners registered');
  }

  _registerConditions() {
    this.logger.debug('Registering condition run listeners…');

    this.homey.flow.getConditionCard('is_islamic_occasion')
      .registerRunListener((args) => {
        const cfg    = this.homey.settings.get('hijriConfig') || {};
        const result = new HijriCalendar(cfg).isOccasion(args.occasion);
        this.logger.debug(`Condition is_islamic_occasion [${args.occasion}] → ${result}`);
        return result;
      });

    this.homey.flow.getConditionCard('prayer_name_is')
      .registerRunListener((args, state) => {
        // Use the resolved prayer: for the "Before/After Any prayer" trigger,
        // state.prayerName is "Any" while the concrete prayer is in
        // _resolvedPrayer. For prayer_trigger_all/_specific there is no
        // _resolvedPrayer, so fall back to state.prayerName (already concrete).
        const prayer = state._resolvedPrayer || state.prayerName;
        const result = prayer === args.prayerName;
        this.logger.debug(`Condition prayer_name_is [${args.prayerName}] state=[${prayer}] → ${result}`);
        return result;
      });

    this.logger.debug('Condition run listeners registered');
  }

}

module.exports = App;
