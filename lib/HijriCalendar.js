'use strict';

const { toHijri } = require('hijri-date/lib/safe');
const HijriDate    = require('hijri-date').default;

// Typical day offsets relative to hijri-date's tabular (Kuwaiti) algorithm.
const METHOD_OFFSETS = {
  'Umm al-Qura':     0,
  'ISNA':           -1,
  'Diyanet':         0,
  'Egyptian':        0,
  'Global Crescent': 1,
};

const HIJRI_MONTHS = [
  '', 'Muharram', 'Safar', 'Rabi Al-Awwal', 'Rabi Al-Thani',
  'Jumada Al-Awwal', 'Jumada Al-Thani', 'Rajab', "Sha'ban",
  'Ramadan', 'Shawwal', "Dhul Qa'dah", 'Dhul Hijjah',
];

// Named occasions: fixed Hijri anchor dates.
// Laylah Al-Qadr uses 'nights' (multiple days) instead of a single day.
const OCCASIONS = {
  eid_al_fitr:    { day: 1,  month: 10, name: 'Eid Al-Fitr' },
  eid_al_adha:    { day: 10, month: 12, name: 'Eid Al-Adha' },
  arafah:         { day: 9,  month: 12, name: 'Day of Arafah' },
  ashura:         { day: 10, month: 1,  name: 'Ashura' },
  mawlid:         { day: 12, month: 3,  name: 'Mawlid Al-Nabi' },
  laylah_al_qadr: { nights: [21, 23, 25, 27, 29], month: 9, name: 'Laylah Al-Qadr' },
};

class HijriCalendar {
  /**
   * @param {object} [cfg]
   * @param {string} [cfg.method]  — one of the keys in METHOD_OFFSETS
   * @param {number} [cfg.offset]  — user fine-tune: -1 | 0 | 1
   */
  constructor(cfg = {}) {
    const methodOffset = METHOD_OFFSETS[cfg.method] ?? 0;
    const userOffset   = Number(cfg.offset) || 0;
    this._totalOffset  = methodOffset + userOffset;
  }

  _h() {
    return this._hForDate(new Date());
  }

  _hForDate(gregDate) {
    const base = toHijri(gregDate);
    return this._totalOffset === 0 ? base : base.addDays(this._totalOffset);
  }

  // Convert a Hijri year/month/day to a Gregorian Date, respecting totalOffset.
  // The offset shifts the apparent Hijri date forward, so the Gregorian anchor
  // for a target Hijri date is: tabularGreg(day, month, year) - totalOffset days.
  hijriToGregorian(year, month, day) {
    const hd = new HijriDate(year, month, day);
    const ms = hd.getTime() - this._totalOffset * 86400000;
    return new Date(ms);
  }

  // Find the next Gregorian date on which a given Hijri month+day will fall.
  nextOccurrence(hijriMonth, hijriDay) {
    const h    = this._h();
    let   year = h.getFullYear();
    let   greg = this.hijriToGregorian(year, hijriMonth, hijriDay);
    if (greg.getTime() < Date.now() - 30 * 86400000) {
      greg = this.hijriToGregorian(year + 1, hijriMonth, hijriDay);
    }
    return greg;
  }

  isOccasion(id) {
    const h     = this._h();
    const month = h.getMonth();
    const day   = h.getDate();
    switch (id) {
      case 'ramadan':        return month === 9;
      case 'last_10_nights': return month === 9 && day >= 21;
      case 'laylah_al_qadr': return month === 9 && [21, 23, 25, 27, 29].includes(day);
      case 'eid_al_fitr':    return month === 10 && day === 1;
      case 'eid_al_adha':    return month === 12 && day === 10;
      case 'arafah':         return month === 12 && day === 9;
      case 'ashura':         return month === 1  && day === 10;
      case 'mawlid':         return month === 3  && day === 12;
      default:               return false;
    }
  }

  isRamadan()      { return this.isOccasion('ramadan'); }
  isLaylahAlQadr() { return this.isOccasion('laylah_al_qadr'); }

  todayInfo() {
    const h = this._h();
    return {
      day:            h.getDate(),
      month:          h.getMonth(),
      year:           h.getFullYear(),
      isRamadan:      this.isOccasion('ramadan'),
      isLaylahAlQadr: this.isOccasion('laylah_al_qadr'),
      isEidAlFitr:    this.isOccasion('eid_al_fitr'),
      isEidAlAdha:    this.isOccasion('eid_al_adha'),
    };
  }

  static getMethods()   { return Object.keys(METHOD_OFFSETS); }
  static getMonths()    { return HIJRI_MONTHS; }
  static getOccasions() { return OCCASIONS; }
}

module.exports = HijriCalendar;
