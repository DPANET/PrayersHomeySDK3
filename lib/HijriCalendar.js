'use strict';

const { toHijri } = require('hijri-date/lib/safe');

// Typical day offsets relative to hijri-date's tabular (Kuwaiti) algorithm.
// These are approximate baselines — the user ±1 offset handles remaining drift.
const METHOD_OFFSETS = {
  'Umm al-Qura':     0,   // Saudi Arabia (default)
  'ISNA':           -1,   // North America — typically 1 day earlier
  'Diyanet':         0,   // Turkey
  'Egyptian':        0,   // Egyptian General Authority
  'Global Crescent': 1,   // Actual moon sighting — tends to be 1 day later
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
    const base = toHijri(new Date());
    return this._totalOffset === 0 ? base : base.addDays(this._totalOffset);
  }

  isRamadan()      { return this._h().getMonth() === 9;  }
  isShawwal()      { return this._h().getMonth() === 10; }
  isDhulHijjah()   { return this._h().getMonth() === 12; }
  isLaylahAlQadr() {
    const h = this._h();
    return h.getMonth() === 9 && [21, 23, 25, 27, 29].includes(h.getDate());
  }
  isEidAlFitr()  { const h = this._h(); return h.getMonth() === 10 && h.getDate() === 1;  }
  isEidAlAdha()  { const h = this._h(); return h.getMonth() === 12 && h.getDate() === 10; }

  todayInfo() {
    const h = this._h();
    return {
      day:            h.getDate(),
      month:          h.getMonth(),
      year:           h.getFullYear(),
      isRamadan:      this.isRamadan(),
      isLaylahAlQadr: this.isLaylahAlQadr(),
      isEidAlFitr:    this.isEidAlFitr(),
      isEidAlAdha:    this.isEidAlAdha(),
    };
  }

  static getMethods() {
    return Object.keys(METHOD_OFFSETS);
  }
}

module.exports = HijriCalendar;
