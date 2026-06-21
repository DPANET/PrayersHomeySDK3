'use strict';

const adhan = require('adhan-extended');
const { buildParams, resolveCoords } = require('./calc');

const MULTIPLIER = { seconds: 1000, minutes: 60000, hours: 3600000 };

const PRAYER_KEYS = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];

// ── Rolling-horizon tuning ──────────────────────────────────────────────────
// Schedule occurrences for today + the next LOOKAHEAD_DAYS calendar days, so the
// schedule survives a full day (or more) of downtime/sleep without depending on
// a punctual midnight recompute. A periodic, ADDITIVE heartbeat keeps the window
// full and self-heals after the device wakes.
const LOOKAHEAD_DAYS        = 2;                 // today + 2 days
const RECONCILE_INTERVAL_MS = 30 * 60 * 1000;    // heartbeat cadence
const AUDIO_FRESHNESS_MS    = 120 * 1000;        // don't blast adhan if it fires this late
const FLOW_FRESHNESS_MS     = 300 * 1000;        // don't fire stale Flow reminders this late
const EARLY_TOLERANCE_MS    = 60 * 1000;         // timer that fires this early → re-arm (clock jump)
const FIRED_TTL_MS          = 3 * 24 * 3600 * 1000;
const FIRED_CAP             = 200;

class PrayerScheduler {
  constructor(homey) {
    this.homey = homey;

    // Occurrence maps: key → { id, prayer, fireAt, dayEpoch[, state] }.
    // These are the source of truth; the heartbeat reconciles against them and
    // is ADDITIVE — it never clears a future timer it didn't just create.
    this._audio = new Map();
    this._flows = new Map();

    this._heartbeat = null;
    this._debounce  = null;
    this._cardAll      = null;
    this._cardSpecific = null;
    this._cardBA       = null;

    this._running = false;           // re-entrancy guard
    this._rerun = false;             // coalesces a request arriving mid-run
    this._pendingDestructive = false; // a coalesced request asked for a full rebuild
    this._readyAt = 0;               // epoch ms after which event-driven reschedules are allowed

    this.lastRun = {
      enabled: true, horizonDays: LOOKAHEAD_DAYS, audio: [], flows: [], nextReconcileAt: 0,
    };
  }

  async init() {
    // Legacy card IDs — must match the IDs stored in existing user flows.
    this._cardAll      = this.homey.flow.getTriggerCard('prayer_trigger_all');
    this._cardSpecific = this.homey.flow.getTriggerCard('prayer_trigger_specific');
    this._cardBA       = this.homey.flow.getTriggerCard('prayer_trigger_before_after_specific');
    // Flow set changed → rebuild.
    this._cardBA.on('update',       () => this._scheduleReschedule());
    this._cardSpecific.on('update', () => this._scheduleReschedule());
    this.homey.settings.on('set', (key) => this._onSettingChanged(key));
    this.homey.geolocation.on('location', () => this._scheduleReschedule());
    await this.reschedule();
    // Suppress event-driven reschedules for 90 s after boot — Homey fires
    // spurious 'update' and 'location' events while syncing its internal state.
    this._readyAt = Date.now() + 90_000;
  }

  _onSettingChanged(key) {
    if (key === 'location' || key === 'calculation' || key === 'advanced' || key === 'adjustments') {
      this.homey.app.logger.log(`PrayerScheduler: setting changed [${key}] → rescheduling`);
      this._scheduleReschedule();
    }
    if (key === 'audioPrefs') {
      this.homey.app.logger.log('PrayerScheduler: audioPrefs updated — new URLs take effect at next prayer fire');
    }
  }

  // Debounced, destructive entry point used by event listeners (bursty saves).
  _scheduleReschedule(delay = 500) {
    if (Date.now() < this._readyAt) return; // ignore spurious boot-time events
    if (this._debounce) this.homey.clearTimeout(this._debounce);
    this._debounce = this.homey.setTimeout(() => {
      this._debounce = null;
      this.reschedule();
    }, delay);
  }

  // Public, awaitable, DESTRUCTIVE rebuild (init / API / settings change).
  reschedule() { return this._run(true); }

  // Heartbeat tick — ADDITIVE reconcile only.
  _heartbeatTick() { return this._run(false); }

  // Serialises overlapping runs so a late run can't clear timers a newer run
  // just created. A coalesced destructive request wins over an additive one.
  async _run(destructive) {
    if (this._running) {
      this._rerun = true;
      if (destructive) this._pendingDestructive = true;
      return;
    }
    this._running = true;
    try {
      do {
        this._rerun = false;
        let d = destructive || this._pendingDestructive;
        this._pendingDestructive = false;
        destructive = false;
        await this._reconcile(d);
      } while (this._rerun);
    } finally {
      this._running = false;
    }
  }

  async _reconcile(destructive) {
    if (this._heartbeat) { this.homey.clearTimeout(this._heartbeat); this._heartbeat = null; }

    const adv     = this.homey.settings.get('advanced') || {};
    const enabled = adv.appEnabled !== false;

    // Destructive rebuild wipes everything; additive keeps existing future timers.
    if (destructive) this._clearAll();

    if (!enabled) {
      if (!destructive) this._clearAll();   // make sure nothing stays scheduled
      this._snapshot(false);
      this._armHeartbeat();
      return;
    }

    const now    = Date.now();
    const params = this._buildParams();
    const coords = this._coords();
    const adj    = this.homey.settings.get('adjustments') || {};
    const calc   = this.homey.settings.get('calculation') || {};
    this.homey.app.logger.debug(`PrayerScheduler: reconcile — method=${calc.method || 'Dubai'} lat=${coords.latitude.toFixed(4)} lng=${coords.longitude.toFixed(4)} destructive=${destructive}`);

    for (let off = 0; off <= LOOKAHEAD_DAYS; off++) {
      const dayStart = this._dayStart(off);     // local midnight + off days (DST-safe)
      const dayEpoch = dayStart.getTime();
      const pt = new adhan.PrayerTimes(coords, dayStart, params);
      const PRAYERS = {
        Fajr: pt.fajr, Sunrise: pt.sunrise,
        Dhuhr: pt.dhuhr, Asr: pt.asr, Maghrib: pt.maghrib, Isha: pt.isha,
      };

      // 1) AUDIO — one occurrence per prayer per day. Sunrise is included unless
      //    excluded in Advanced settings (skipped below before a timer is armed).
      for (const name of PRAYER_KEYS) {
        const t = PRAYERS[name];
        if (!t) continue;
        if (name === 'Sunrise' && adv.excludeSunrise) {
          this.homey.app.logger.debug('PrayerScheduler: Sunrise timer skipped (excludeSunrise=true)');
          continue;
        }
        const fireAt = t.getTime() + (adj[name] || 0) * 60000;
        if (fireAt <= now) continue;
        const key = `${name}@${dayEpoch}`;
        if (this._audio.has(key) || this._firedHas(key)) continue;
        this._scheduleAudio(name, key, fireAt, dayEpoch);
      }

      // 2) FLOW TRIGGERS — prayer_trigger_before_after_specific (old arg names).
      let instancesBA = [];
      try { instancesBA = await this._cardBA.getArgumentValues(); } catch (_) {}
      for (const args of instancesBA) {
        const concrete = args.prayerName === 'Any' ? PRAYER_KEYS : [args.prayerName];
        for (const name of concrete) {
          const t = PRAYERS[name];
          if (!t) continue;
          const basePrayerMs = t.getTime() + (adj[name] || 0) * 60000;
          const offset = (args.prayerDurationTime || 0) * (MULTIPLIER[args.prayerDurationType] || 60000);
          const fireAt = args.prayerAfterBefore === 'After' ? basePrayerMs + offset : basePrayerMs - offset;
          if (fireAt <= now) continue;
          const key = `${this._stateHash(args)}@${name}@${dayEpoch}`;
          if (this._flows.has(key) || this._firedHas(key)) continue;
          this._scheduleFlow(args, name, key, fireAt, dayEpoch);
        }
      }
    }

    this._snapshot(true);
    this._armHeartbeat();

    const audioCount = this._audio.size;
    const flowCount  = this._flows.size;
    const nextAudio  = [...this._audio.values()].sort((a, b) => a.fireAt - b.fireAt)[0];
    const nextLabel  = nextAudio ? `next: ${nextAudio.prayer} @ ${this._fmt(new Date(nextAudio.fireAt))}` : 'no upcoming';
    this.homey.app.logger.log(`PrayerScheduler: reconcile done — ${audioCount} audio, ${flowCount} flow timers (${nextLabel})`);
  }

  // ── Timer creation / firing ────────────────────────────────────────────────
  _scheduleAudio(name, key, fireAt, dayEpoch) {
    const delay = Math.max(0, fireAt - Date.now());
    const inMin  = Math.round(delay / 60000);
    this.homey.app.logger.debug(`PrayerScheduler: queued ${name} audio @ ${this._fmt(new Date(fireAt))} (in ${inMin}m)`);
    const id = this.homey.setTimeout(() => this._fireAudio(name, key, fireAt, dayEpoch), delay);
    this._audio.set(key, { id, prayer: name, fireAt, dayEpoch });
  }

  async _fireAudio(name, key, fireAt, dayEpoch) {
    const now = Date.now();
    // Fired suspiciously early (system clock jumped back / timer misfire) → re-arm.
    if (now < fireAt - EARLY_TOLERANCE_MS) {
      this.homey.app.logger.debug(`PrayerScheduler: ${name} fired early by ${Math.round((fireAt - now) / 1000)}s — re-arming`);
      this._audio.delete(key);
      this._scheduleAudio(name, key, fireAt, dayEpoch);
      return;
    }
    this._audio.delete(key);
    this._recordFired(key);
    const late = now - fireAt;
    if (late > this._audioFreshnessMs()) {
      this.homey.app.logger.warn(`PrayerScheduler: stale ${name} adhan skipped (${Math.round(late / 1000)}s late)`);
      return;
    }

    const prayerTime = this._fmt(new Date(fireAt));

    // Audio URL tags this prayer carries; the user's Flow picks which to cast.
    let audio = {};
    try { audio = this.homey.app.audioRouter.buildTokens(name); }
    catch (e) { this.homey.app.logger.error('PrayerScheduler.buildTokens', e, { prayer: name }); }

    // Skip flow triggers for Sunrise when the user has opted out in Advanced settings.
    const adv = this.homey.settings.get('advanced') || {};
    if (name === 'Sunrise' && adv.excludeSunrise) {
      this.homey.app.logger.debug(`PrayerScheduler: Sunrise excluded (excludeSunrise=true)`);
      return;
    }

    this.homey.app.logger.log(`PrayerScheduler: ▶ ${name} @ ${prayerTime} — adhan_full=${audio.adhan_full || '—'} volume=${audio.volume || 'device default'}`);

    // Fire prayer_trigger_all (no filter — fires for every prayer). State carries
    // prayerName so downstream condition cards (e.g. prayer_name_is) can branch.
    try {
      await this._cardAll.trigger({ prayerName: name, prayerTime, ...audio }, { prayerName: name });
      this.homey.app.logger.debug(`PrayerScheduler: prayer_trigger_all fired for ${name}`);
    } catch (e) { this.homey.app.logger.error('PrayerScheduler.triggerAll', e); }

    // Fire prayer_trigger_specific (state-filtered by prayerName).
    try {
      await this._cardSpecific.trigger({ prayerName: name, prayerTime, ...audio }, { prayerName: name });
      this.homey.app.logger.debug(`PrayerScheduler: prayer_trigger_specific fired for ${name}`);
    } catch (e) { this.homey.app.logger.error('PrayerScheduler.triggerSpecific', e); }
  }

  _scheduleFlow(args, name, key, fireAt, dayEpoch) {
    // Preserve old arg names so the run listener in app.js can match them.
    const state = {
      prayerAfterBefore:  args.prayerAfterBefore,
      prayerName:         args.prayerName,
      prayerDurationTime: args.prayerDurationTime || 0,
      prayerDurationType: args.prayerDurationType,
      _resolvedPrayer:    name,
    };
    const delay  = Math.max(0, fireAt - Date.now());
    const inMin  = Math.round(delay / 60000);
    this.homey.app.logger.debug(`PrayerScheduler: queued flow ${args.prayerAfterBefore} ${name} ${args.prayerDurationTime}${args.prayerDurationType} @ ${this._fmt(new Date(fireAt))} (in ${inMin}m)`);
    const id = this.homey.setTimeout(() => this._fireFlow(name, key, fireAt, dayEpoch, state), delay);
    this._flows.set(key, { id, prayer: name, fireAt, dayEpoch, state });
  }

  async _fireFlow(name, key, fireAt, dayEpoch, state) {
    const now = Date.now();
    if (now < fireAt - EARLY_TOLERANCE_MS) {
      this.homey.app.logger.debug(`PrayerScheduler: flow ${name} fired early by ${Math.round((fireAt - now) / 1000)}s — re-arming`);
      this._flows.delete(key);
      this._scheduleFlow(state, name, key, fireAt, dayEpoch);
      return;
    }
    this._flows.delete(key);
    this._recordFired(key);
    if (now - fireAt > FLOW_FRESHNESS_MS) {
      this.homey.app.logger.warn(`PrayerScheduler: stale ${name} flow trigger skipped`);
      return;
    }
    // Use old token names: prayerName + prayerTimeCalculated.
    const prayerTimeCalculated = this._fmt(new Date(fireAt));
    try {
      await this._cardBA.trigger({ prayerName: name, prayerTimeCalculated }, state);
      this.homey.app.logger.log(`PrayerScheduler: ▶ flow ${state.prayerAfterBefore} ${name} @ ${prayerTimeCalculated}`);
    } catch (e) {
      this.homey.app.logger.error('PrayerScheduler.fireFlow', e, { prayer: name });
    }
  }

  _armHeartbeat() {
    this._heartbeat = this.homey.setTimeout(() => this._heartbeatTick(), RECONCILE_INTERVAL_MS);
  }

  _clearAll() {
    for (const v of this._audio.values()) this.homey.clearTimeout(v.id);
    for (const v of this._flows.values()) this.homey.clearTimeout(v.id);
    this._audio.clear();
    this._flows.clear();
    // Cancel any in-flight adhkar follow-ups from a previous schedule.
    if (this.homey.app.audioRouter?.clearScheduled) {
      this.homey.app.audioRouter.clearScheduled();
    }
  }

  // ── Fired-occurrence persistence (defense-in-depth vs double-fire) ──────────
  // The `fireAt <= now` filter already prevents re-adding past occurrences, so
  // this is a secondary guard for the marginal case where a fresh recompute
  // yields a still-future fireAt for something we already fired (rounding / clock
  // adjustment). Pruned by age + cap so it can't grow unbounded.
  _firedKeys() {
    const v = this.homey.settings.get('firedOccurrences');
    return Array.isArray(v) ? v : [];
  }

  _firedHas(key) {
    return this._firedKeys().some(e => e && e.k === key);
  }

  _recordFired(key) {
    const now = Date.now();
    const cutoff = now - FIRED_TTL_MS;
    let list = this._firedKeys().filter(e => e && e.t > cutoff && e.k !== key);
    list.push({ k: key, t: now });
    if (list.length > FIRED_CAP) list = list.slice(-FIRED_CAP);
    this.homey.settings.set('firedOccurrences', list);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  _snapshot(enabled) {
    const map = m => [...m.values()].map(v => ({
      prayer: v.prayer, fireAt: v.fireAt, dayEpoch: v.dayEpoch, id: v.id, args: v.state,
    }));
    this.lastRun = {
      enabled,
      horizonDays: LOOKAHEAD_DAYS,
      audio: map(this._audio),
      flows: map(this._flows),
      nextReconcileAt: Date.now() + RECONCILE_INTERVAL_MS,
    };
  }

  _audioFreshnessMs() {
    const adv = this.homey.settings.get('advanced') || {};
    const s = Number(adv.audioFreshnessSec);
    return Number.isFinite(s) && s > 0 ? s * 1000 : AUDIO_FRESHNESS_MS;
  }

  _stateHash(args) {
    return `${args.prayerAfterBefore}|${args.prayerName}|${args.prayerDurationTime || 0}|${args.prayerDurationType}`;
  }

  // Local midnight for (today + off days). Stepping by calendar date (not by
  // adding 24h in ms) keeps prayer-time computation correct across DST changes.
  _dayStart(off) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + off);
    return d;
  }

  _dayEpoch(off = 0) { return this._dayStart(off).getTime(); }

  _fmt(date) {
    return date.toLocaleTimeString('en-GB', {
      hour: '2-digit', minute: '2-digit',
      timeZone: this.homey.clock.getTimezone(),
    });
  }

  _buildParams() {
    return buildParams(this.homey.settings.get('calculation') || {});
  }

  _coords() {
    return resolveCoords(this.homey);
  }

  // Today's prayer times (API preview / diagnostics).
  getPrayerTimes() {
    return new adhan.PrayerTimes(this._coords(), new Date(), this._buildParams());
  }
}

module.exports = PrayerScheduler;
