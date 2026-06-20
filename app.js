'use strict';

const Homey           = require('homey');
const { HomeyAPI }    = require('homey-api');
const PrayerScheduler = require('./lib/PrayerScheduler');
const AudioRouter     = require('./lib/AudioRouter');
const HijriCalendar   = require('./lib/HijriCalendar');
const triggerMatches  = require('./lib/triggerMatch');
const Logger          = require('./lib/Logger');

class App extends Homey.App {
  async onInit() {
    this.logger = new Logger(this.homey);

    this._migrateSettings();

    // homey-api: cross-app device access (requires "homey:manager:api" permission)
    this.homeyApi = await HomeyAPI.createAppAPI({ homey: this.homey });

    this.audioRouter = new AudioRouter(this.homey);
    this.scheduler   = new PrayerScheduler(this.homey);

    this._registerTriggers();
    this._registerConditions();
    this._registerActions();
    await this.scheduler.init();

    const appEnv = process.env.APP_ENV ? JSON.parse(process.env.APP_ENV) : (this.homey.env || {});
    const mapsKey = appEnv.GOOGLE_MAPS_KEY || '';
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
  }

  _registerConditions() {
    const hijri = new HijriCalendar();

    this.homey.flow.getConditionCard('is_ramadan')
      .registerRunListener(() => hijri.isRamadan());

    this.homey.flow.getConditionCard('is_laylah_al_qadr')
      .registerRunListener(() => hijri.isLaylahAlQadr());
  }

  _registerActions() {
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
