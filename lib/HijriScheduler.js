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
      'hijri_month_event', 'hijri_day_of_month',
      'hijri_specific_date', 'hijri_date_offset',
      'islamic_occasion_event', 'islamic_occasion_offset',
    ];
    for (const id of ids) this._cards[id] = this.homey.flow.getTriggerCard(id);

    this.homey.settings.on('set', (key) => {
      if (key === 'hijriConfig') {
        this.homey.app.logger.log('HijriScheduler: hijriConfig changed → rescheduling');
        this._scheduleReschedule();
      }
    });

    this.homey.app.logger.debug('HijriScheduler: init — loading cards and scheduling');
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

    // Fetch Flow instances for all per-day card types in parallel.
    // Only arm a card type when at least one Flow actually uses it.
    const [monthEventInst, dayOfMonthInst, specificDateInst, occasionEventInst] = await Promise.all([
      this._getInstances('hijri_month_event'),
      this._getInstances('hijri_day_of_month'),
      this._getInstances('hijri_specific_date'),
      this._getInstances('islamic_occasion_event'),
    ]);

    // Build targeted lookup sets — skip days/occasions not wired in any Flow.
    const targetDays      = new Set(dayOfMonthInst.map(a => Number(a.day)));
    const targetDates     = specificDateInst.map(a => ({ day: Number(a.day), month: Number(a.month) }));
    const targetOccasions = new Set(occasionEventInst.map(a => a.occasion));

    // ── Per-day checks ────────────────────────────────────────────────────────
    for (let off = 0; off <= LOOKAHEAD_DAYS; off++) {
      const gregDay = this._dayStart(off);
      const fireAt  = gregDay.getTime();
      if (fireAt <= now) continue;

      const h         = cal._hForDate(gregDay);
      const day       = h.getDate();
      const month     = h.getMonth();
      const year      = h.getFullYear();
      const monthName    = MONTHS[month] || '';
      const gregDateStr  = `${gregDay.getFullYear()}-${String(gregDay.getMonth()+1).padStart(2,'0')}-${String(gregDay.getDate()).padStart(2,'0')}`;

      const baseTokens = { hijriDay: day, hijriMonth: month, hijriMonthName: monthName, hijriYear: year, gregorianDate: gregDateStr };

      // hijri_month_event — only if any Flow uses this card
      if (monthEventInst.length > 0) {
        if (day === 1) {
          const t = { hijriMonth: month, hijriMonthName: monthName, hijriYear: year };
          this._armState('hijri_month_event', `month_starts@${month}@${year}`, fireAt, t, { month: String(month), event: 'starts' });
        }
        if (off < LOOKAHEAD_DAYS) {
          const hTmrw = cal._hForDate(this._dayStart(off + 1));
          if (hTmrw.getDate() === 1) {
            const t = { hijriMonth: month, hijriMonthName: monthName, hijriYear: year };
            this._armState('hijri_month_event', `month_ends@${month}@${year}`, fireAt, t, { month: String(month), event: 'ends' });
          }
        }
      }

      // hijri_day_of_month — only arm days that appear in configured Flows
      if (targetDays.has(day)) {
        this._armState('hijri_day_of_month', `day_of_month@${day}@${month}@${year}`, fireAt, baseTokens, { hijriDay: day });
      }

      // hijri_specific_date — only arm day+month combos configured in Flows
      if (targetDates.some(td => td.day === day && td.month === month)) {
        this._armState('hijri_specific_date', `specific_date@${day}@${month}@${year}`, fireAt, baseTokens, { hijriDay: day, hijriMonth: month });
      }

      // islamic_occasion_event — only arm occasions configured in Flows
      if (targetOccasions.size > 0) {
        // Yesterday's Hijri date drives single-day occasion "ends": the occasion
        // ends at the rollover INTO this day, so we arm it from the day-AFTER
        // slot. That keeps "starts" and "ends" a full day apart and gives the
        // ends timer a fireAt equal to this per-day slot, so it survives the
        // heartbeat's clear-and-rebuild (a same-day-later fireAt would be
        // orphaned once this day's midnight passes and the slot is skipped).
        const hYest   = off >= 1 ? cal._hForDate(this._dayStart(off - 1)) : null;
        const gYest   = off >= 1 ? this._dayStart(off - 1) : null;
        const yestStr = gYest ? `${gYest.getFullYear()}-${String(gYest.getMonth()+1).padStart(2,'0')}-${String(gYest.getDate()).padStart(2,'0')}` : '';

        for (const [id, occ] of Object.entries(OCCASIONS)) {
          if (!targetOccasions.has(id)) continue;

          const occTokens = {
            occasionName:  occ.name,
            hijriDate:     `${day} ${monthName} ${year}`,
            gregorianDate: gregDateStr,
          };

          const matchesStart = occ.nights
            ? month === occ.month && occ.nights.includes(day)
            : month === occ.month && day === occ.day;

          if (matchesStart) {
            this._armState('islamic_occasion_event', `occ_starts@${id}@${year}@${day}`, fireAt, occTokens, { occasion: id, event: 'starts' });
          }

          if (occ.isMonth) {
            // Month-long occasion (Ramadan): "ends" on the last day of the month.
            if (off < LOOKAHEAD_DAYS && month === occ.month) {
              const hTmrw = cal._hForDate(this._dayStart(off + 1));
              if (hTmrw.getDate() === 1 && hTmrw.getMonth() !== occ.month) {
                this._armState('islamic_occasion_event', `occ_ends@${id}@${year}`, fireAt, occTokens, { occasion: id, event: 'ends' });
              }
            }
          } else if (hYest) {
            // Single-day / per-night occasion: "ends" fires at THIS day's 00:01
            // when YESTERDAY was the occasion day — i.e. a full day after "starts".
            const yDay = hYest.getDate(), yMonth = hYest.getMonth(), yYear = hYest.getFullYear();
            const matchesEnd = occ.nights
              ? yMonth === occ.month && occ.nights.includes(yDay)
              : yMonth === occ.month && yDay === occ.day;
            if (matchesEnd) {
              const endTokens = {
                occasionName:  occ.name,
                hijriDate:     `${yDay} ${MONTHS[yMonth] || ''} ${yYear}`,
                gregorianDate: yestStr,
              };
              this._armState('islamic_occasion_event', `occ_ends@${id}@${yYear}@${yDay}`, fireAt, endTokens, { occasion: id, event: 'ends' });
            }
          }
        }
      }
    }

    // ── Offset triggers ───────────────────────────────────────────────────────
    await this._scheduleOffsets(cal, now);

    this._armHeartbeat();

    const count   = this._timers.size;
    const nextT   = [...this._timers.values()].sort((a, b) => a.fireAt - b.fireAt)[0];
    const nextLbl = nextT ? `next in ${Math.round((nextT.fireAt - Date.now()) / 3600000)}h` : 'none upcoming';
    this.homey.app.logger.log(`HijriScheduler: reconcile done — ${count} timers armed (${nextLbl})`);
  }

  _getInstances(cardId) {
    return this._cards[cardId].getArgumentValues()
      .then(r => Array.isArray(r) ? r : [])
      .catch(() => []);
  }

  async _scheduleOffsets(cal, now) {
    // hijri_date_offset
    let instances = await this._getInstances('hijri_date_offset');
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
    instances = await this._getInstances('islamic_occasion_offset');
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

  // Node.js setTimeout max: 2^31-1 ms (~24.8 days). Larger delays overflow to 1ms.
  // We cap and rely on _fire()'s early-guard to re-arm until within range.
  _clampDelay(fireAt) {
    return Math.min(Math.max(0, fireAt - Date.now()), 0x7FFFFFFF);
  }

  // Arm a timer whose run listener filters by state.
  _armState(cardId, key, fireAt, tokens, state) {
    if (this._timers.has(key)) return;
    const id = this.homey.setTimeout(() => this._fire(cardId, key, fireAt, tokens, state), this._clampDelay(fireAt));
    this._timers.set(key, { id, fireAt });
  }

  async _fire(cardId, key, fireAt, tokens, state) {
    const now = Date.now();
    if (now < fireAt - EARLY_TOLERANCE_MS) {
      this.homey.app.logger.debug(`HijriScheduler: ${cardId} fired early by ${Math.round((fireAt - now) / 1000)}s — re-arming`);
      this._timers.delete(key);
      this._armState(cardId, key, fireAt, tokens, state);
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
      const label = tokens.occasionName || tokens.hijriMonthName || cardId;
      this.homey.app.logger.log(`HijriScheduler: ▶ ${cardId} fired — ${label} (${tokens.gregorianDate || ''})`);
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
