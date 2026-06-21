'use strict';

const Homey            = require('homey');
const { HomeyAPI }     = require('homey-api');
const PrayerScheduler  = require('./lib/PrayerScheduler');
const HijriScheduler   = require('./lib/HijriScheduler');
const AudioRouter      = require('./lib/AudioRouter');
const HijriCalendar    = require('./lib/HijriCalendar');
const triggerMatches   = require('./lib/triggerMatch');
const Logger           = require('./lib/Logger');

class App extends Homey.App {
  async onInit() {
    this.logger = new Logger(this.homey);

    this._migrateSettings();

    // homey-api: cross-app device access (requires "homey:manager:api" permission)
    this.homeyApi = await HomeyAPI.createAppAPI({ homey: this.homey });

    this.audioRouter     = new AudioRouter(this.homey);
    this.scheduler       = new PrayerScheduler(this.homey);
    this.hijriScheduler  = new HijriScheduler(this.homey);

    this._registerTriggers();
    this._registerConditions();
    this._registerActions();
    await this.scheduler.init();
    await this.hijriScheduler.init();

    const appEnv = process.env.APP_ENV ? JSON.parse(process.env.APP_ENV) : (Homey.env || this.homey.env || {});
    const mapsKey = appEnv.GOOGLE_MAPS_KEY || appEnv.GOOGLE_PLACE_KEY || appEnv.GOOGLE_API_KEY || '';
    if (mapsKey) this.homey.settings.set('googleMapsKey', mapsKey);

    this.logger.log('Prayers Alert v2 started');
  }

  // Convert old app (1.x) settings keys to new format on first run.
  _migrateSettings() {
    const oldPrayer = this.homey.settings.get('prayerConfig');
    const oldLoc    = this.homey.settings.get('locationConfig');
    if (!oldPrayer && !oldLoc) return;

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
  }

  _registerTriggers() {
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
    this.homey.flow.getTriggerCard('hijri_new_year')
      .registerRunListener(async () => true);

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

    this.homey.flow.getTriggerCard('ramadan_starts')
      .registerRunListener(async () => true);

    this.homey.flow.getTriggerCard('ramadan_ends')
      .registerRunListener(async () => true);

    this.homey.flow.getTriggerCard('islamic_occasion_starts')
      .registerRunListener(async (args, state) => args.occasion === state.occasion);

    this.homey.flow.getTriggerCard('islamic_occasion_offset')
      .registerRunListener(async (args, state) =>
        args.occasion    === state.occasion &&
        args.beforeAfter === state.beforeAfter &&
        Number(args.when) === state.when &&
        args.type        === state.type
      );
  }

  _registerConditions() {
    this.homey.flow.getConditionCard('is_islamic_occasion')
      .registerRunListener((args) => {
        const cfg = this.homey.settings.get('hijriConfig') || {};
        return new HijriCalendar(cfg).isOccasion(args.occasion);
      });

    this.homey.flow.getConditionCard('prayer_name_is')
      .registerRunListener((args, state) => state.prayerName === args.prayerName);
  }

  _registerActions() {
    // play_audio_on_group — plays whatever the group is configured for.
    const playGroupCard = this.homey.flow.getActionCard('play_audio_on_group');
    playGroupCard.registerRunListener(async (args) => {
      const groups = this.homey.settings.get('speakerGroups') || [];
      const group = groups.find(g => g.id === args.group.id);
      if (!group) throw new Error(`Speaker group not found: ${args.group.name}`);
      await this.audioRouter.playGroup(group);
    });
    playGroupCard.getArgument('group').registerAutocompleteListener(async (query) => {
      const groups = this.homey.settings.get('speakerGroups') || [];
      return groups
        .filter(g => !query || g.name.toLowerCase().includes(query.toLowerCase()))
        .map(g => ({ id: g.id, name: g.name, description: g.contentType || '' }));
    });

    // stop_audio_on_group — stops playback on the selected group.
    const stopGroupCard = this.homey.flow.getActionCard('stop_audio_on_group');
    stopGroupCard.registerRunListener(async (args) => {
      const groups = this.homey.settings.get('speakerGroups') || [];
      const group = groups.find(g => g.id === args.group.id);
      if (!group) throw new Error(`Speaker group not found: ${args.group.name}`);
      await this.audioRouter.stopGroup(group);
    });
    stopGroupCard.getArgument('group').registerAutocompleteListener(async (query) => {
      const groups = this.homey.settings.get('speakerGroups') || [];
      return groups
        .filter(g => !query || g.name.toLowerCase().includes(query.toLowerCase()))
        .map(g => ({ id: g.id, name: g.name, description: g.contentType || '' }));
    });

    // athan_action — plays adhan on all enabled speaker groups.
    this.homey.flow.getActionCard('athan_action')
      .registerRunListener(async (args) => {
        const athanType = args.athan_dropdown === 'athan_full' ? 'Full adhan' : 'Short adhan';
        const groups = (this.homey.settings.get('speakerGroups') || []).filter(g => g.enabled !== false);
        for (const group of groups) {
          try { await this.audioRouter.playAdhan(group, athanType, group.volume || 70); }
          catch (e) { this.logger.error('athan_action', e, { group: group.name }); }
        }
      });
  }
}

module.exports = App;
