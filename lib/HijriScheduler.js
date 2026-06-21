'use strict';

const HijriCalendar = require('./HijriCalendar');

const LOOKAHEAD_DAYS       = 40;
const RECONCILE_INTERVAL_MS = 30 * 60 * 1000;
const EARLY_TOLERANCE_MS   = 60 * 1000;
const FLOW_FRESHNESS_MS    = 6 * 3600 * 1000;

const MONTHS    = HijriCalendar.getMonths();
const OCCASIONS = HijriCalendar.getOccasions();

class HijriScheduler {
  constructor(homey) {
    this.homey     = homey;
    this._timers   = new Map();
    this._heartbeat = null;
    this._debounce  = null;
    this._running   = false;
    this._rerun     = false;
    this._cards     = {};
  }

  async init() {
    const ids = [
      'hijri_new_year', 'hijri_month_event', 'hijri_day_of_month',
      'hijri_specific_date', 'hijri_date_offset',
      'ramadan_starts', 'ramadan_ends',
      'islamic_occasion_starts', 'islamic_occasion_offset',
    ];
    for (const id of ids) this._cards[id] = this.homey.flow.getTriggerCard(id);

    this.homey.settings.on('set', (key) => {
      if (key === 'hijriConfig') this._scheduleReschedule();
    });

    await this.reschedule();
  }

  _scheduleReschedule(delay = 500) {
    if (this._debounce) this.homey.clearTimeout(this._debounce);
    this._debounce = this.homey.setTimeout(() => {
      this._debounce = null;
      this.reschedule();
    }, delay);
  }

  reschedule() { return this._run(); }

  async _run() {
    if (this._running) { this._rerun = true; return; }
    this._running = true;
    try {
      do { this._rerun = false; await this._reconcile(); }
      while (this._rerun);
    } finally { this._running = false; }
  }

  async _reconcile() {
    if (this._heartbeat) { this.homey.clearTimeout(this._heartbeat); this._heartbeat = null; }
    this._clearAll();

    const hijriCfg = this.homey.settings.get('hijriConfig') || {};
    const cal      = new HijriCalendar(hijriCfg);
    const now      = Date.now();

    // ── Per-day checks ────────────────────────────────────────────────────────
    for (let off = 0; off <= LOOKAHEAD_DAYS; off++) {
      const gregDay = this._dayStart(off);
      const fireAt  = gregDay.getTime();
      if (fireAt <= now) continue;

      const h    = cal._hForDate(gregDay);
      const day  = h.getDate();
      const month = h.getMonth();
      const year  = h.getFullYear();
      const monthName    = MONTHS[month] || '';
      const gregDateStr  = `${gregDay.getFullYear()}-${String(gregDay.getMonth()+1).padStart(2,'0')}-${String(gregDay.getDate()).padStart(2,'0')}`;

      const baseTokens = { hijriDay: day, hijriMonth: month, hijriMonthName: monthName, hijriYear: year, gregorianDate: gregDateStr };

      // hijri_new_year — 1 Muharram
      if (day === 1 && month === 1) {
        this._arm('hijri_new_year', `new_year@${year}`, fireAt, { hijriYear: year });
      }

      // hijri_month_event — starts on day 1
      if (day === 1) {
        const t = { hijriMonth: month, hijriMonthName: monthName, hijriYear: year };
        this._armState('hijri_month_event', `month_starts@${month}@${year}`, fireAt, t, { month: String(month), event: 'starts' });
      }
      // hijri_month_event — ends: tomorrow is day 1 of the next month
      if (off < LOOKAHEAD_DAYS) {
        const hTmrw = cal._hForDate(this._dayStart(off + 1));
        if (hTmrw.getDate() === 1) {
          const t = { hijriMonth: month, hijriMonthName: monthName, hijriYear: year };
          this._armState('hijri_month_event', `month_ends@${month}@${year}`, fireAt, t, { month: String(month), event: 'ends' });
        }
      }

      // ramadan_starts — 1 Ramadan
      if (day === 1 && month === 9) {
        this._arm('ramadan_starts', `ramadan_starts@${year}`, fireAt, { hijriYear: year, gregorianDate: gregDateStr });
      }
      // ramadan_ends — 1 Shawwal
      if (day === 1 && month === 10) {
        this._arm('ramadan_ends', `ramadan_ends@${year}`, fireAt, { hijriYear: year, gregorianDate: gregDateStr });
      }

      // hijri_day_of_month — run listener matches day number
      this._armState('hijri_day_of_month', `day_of_month@${day}@${month}@${year}`, fireAt, baseTokens, { day });

      // hijri_specific_date — run listener matches day + month
      this._armState('hijri_specific_date', `specific_date@${day}@${month}@${year}`, fireAt, baseTokens, { day, month: String(month) });

      // islamic_occasion_starts
      for (const [id, occ] of Object.entries(OCCASIONS)) {
        let matches = false;
        if (occ.nights) {
          matches = month === occ.month && occ.nights.includes(day);
        } else {
          matches = month === occ.month && day === occ.day;
        }
        if (!matches) continue;
        const occTokens = {
          occasionName:  occ.name,
          hijriDate:     `${day} ${monthName} ${year}`,
          gregorianDate: gregDateStr,
        };
        this._armState('islamic_occasion_starts', `occasion_starts@${id}@${year}@${day}`, fireAt, occTokens, { occasion: id });
      }
    }

    // ── Offset triggers ───────────────────────────────────────────────────────
    await this._scheduleOffsets(cal, now);

    this._armHeartbeat();
  }

  async _scheduleOffsets(cal, now) {
    // hijri_date_offset
    let instances = [];
    try { instances = await this._cards['hijri_date_offset'].getArgumentValues(); } catch (_) {}
    for (const args of instances) {
      const day   = Number(args.day);
      const month = Number(args.month);
      const anchorGreg = cal.nextOccurrence(month, day);
      if (!anchorGreg) continue;
      const whenMs = Number(args.when) * (args.type === 'weeks' ? 7 : 1) * 86400000;
      const fireAt = args.beforeAfter === 'Before'
        ? anchorGreg.getTime() - whenMs
        : anchorGreg.getTime() + whenMs;
      if (fireAt <= now) continue;
      const h = cal._hForDate(anchorGreg);
      const tokens = {
        hijriDate:     `${h.getDate()} ${MONTHS[h.getMonth()]} ${h.getFullYear()}`,
        gregorianDate: `${anchorGreg.getFullYear()}-${String(anchorGreg.getMonth()+1).padStart(2,'0')}-${String(anchorGreg.getDate()).padStart(2,'0')}`,
        anchorName:    `${day} ${MONTHS[month]}`,
      };
      const key = `date_offset@${day}@${month}@${args.beforeAfter}@${args.when}@${args.type}`;
      this._armState('hijri_date_offset', key, fireAt, tokens, {
        day, month: String(month), beforeAfter: args.beforeAfter, when: Number(args.when), type: args.type,
      });
    }

    // islamic_occasion_offset (Laylah Al-Qadr excluded — ambiguous anchor)
    instances = [];
    try { instances = await this._cards['islamic_occasion_offset'].getArgumentValues(); } catch (_) {}
    for (const args of instances) {
      const occ = OCCASIONS[args.occasion];
      if (!occ || occ.nights) continue;
      const anchorGreg = cal.nextOccurrence(occ.month, occ.day);
      if (!anchorGreg) continue;
      const whenMs = Number(args.when) * (args.type === 'weeks' ? 7 : 1) * 86400000;
      const fireAt = args.beforeAfter === 'Before'
        ? anchorGreg.getTime() - whenMs
        : anchorGreg.getTime() + whenMs;
      if (fireAt <= now) continue;
      const tokens = {
        occasionName:  occ.name,
        hijriDate:     `${occ.day} ${MONTHS[occ.month]}`,
        gregorianDate: `${anchorGreg.getFullYear()}-${String(anchorGreg.getMonth()+1).padStart(2,'0')}-${String(anchorGreg.getDate()).padStart(2,'0')}`,
      };
      const key = `occasion_offset@${args.occasion}@${args.beforeAfter}@${args.when}@${args.type}`;
      this._armState('islamic_occasion_offset', key, fireAt, tokens, {
        occasion: args.occasion, beforeAfter: args.beforeAfter, when: Number(args.when), type: args.type,
      });
    }
  }

  // Fire with no state (all-match cards: new year, ramadan starts/ends)
  _arm(cardId, key, fireAt, tokens) {
    if (this._timers.has(key)) return;
    const delay = Math.max(0, fireAt - Date.now());
    const id = this.homey.setTimeout(() => this._fire(cardId, key, fireAt, tokens, null), delay);
    this._timers.set(key, { id, fireAt });
  }

  // Fire with state (run listener filters by state)
  _armState(cardId, key, fireAt, tokens, state) {
    if (this._timers.has(key)) return;
    const delay = Math.max(0, fireAt - Date.now());
    const id = this.homey.setTimeout(() => this._fire(cardId, key, fireAt, tokens, state), delay);
    this._timers.set(key, { id, fireAt });
  }

  async _fire(cardId, key, fireAt, tokens, state) {
    const now = Date.now();
    if (now < fireAt - EARLY_TOLERANCE_MS) {
      this._timers.delete(key);
      state ? this._armState(cardId, key, fireAt, tokens, state) : this._arm(cardId, key, fireAt, tokens);
      return;
    }
    this._timers.delete(key);
    if (now - fireAt > FLOW_FRESHNESS_MS) {
      this.homey.app.logger.warn(`HijriScheduler: stale ${cardId} skipped`);
      return;
    }
    try {
      state
        ? await this._cards[cardId].trigger(tokens, state)
        : await this._cards[cardId].trigger(tokens);
    } catch (e) {
      this.homey.app.logger.error(`HijriScheduler.${cardId}`, e);
    }
  }

  _dayStart(offsetDays = 0) {
    const d = new Date();
    d.setHours(0, 1, 0, 0);
    d.setDate(d.getDate() + offsetDays);
    return d;
  }

  _armHeartbeat() {
    this._heartbeat = this.homey.setTimeout(() => this._run(), RECONCILE_INTERVAL_MS);
  }

  _clearAll() {
    for (const { id } of this._timers.values()) this.homey.clearTimeout(id);
    this._timers.clear();
  }
}

module.exports = HijriScheduler;
