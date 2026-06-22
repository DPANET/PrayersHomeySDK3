'use strict';

// Quran reciters → mp3quran.net full-surah server. URL = `${server}${surah}.mp3`
// (surah zero-padded to 3 digits, e.g. afs/001.mp3). Verified reachable.
const RECITERS = {
  'Mishary Al-Afasy':     'https://server8.mp3quran.net/afs/',
  'Abdul Basit':          'https://server7.mp3quran.net/basit/',
  'Maher Al-Muaiqly':     'https://server12.mp3quran.net/maher/',
  'Saud Al-Shuraim':      'https://server7.mp3quran.net/shur/',
  'Nasser Al-Qatami':     'https://server6.mp3quran.net/qtm/',
  'Hani Ar-Rifai':        'https://server8.mp3quran.net/hani/',
  'Mohammed Al-Minshawi': 'https://server10.mp3quran.net/minsh/',
};

const DEFAULT_RECITER = 'Mishary Al-Afasy';

// Fallback recordings used when the user hasn't set a URL.
const DEFAULTS = {
  full:           'https://cdn.aladhan.com/audio/adhans/a11-mansour-al-zahrani.mp3',
  short:          'https://everyayah.com/data/Alafasy_128kbps/001001.mp3',
  adhkar_morning: 'https://archive.org/download/adhkar-of-the-morning-mishary-alafasi/Adhkar%20of%20the%20Morning_Mishary%20Alafasi%20.mp3',
  adhkar_evening: 'https://archive.org/download/adhkar-of-the-evening-mishary-alafasi/Adhkar%20of%20the%20Evening_Mishary%20Alafasi%20.mp3',
  custom:         'https://media.assabile.com/assabile/adhan_3435370/f30b7631d625.mp3',
};

/**
 * AudioRouter (token model).
 *
 * The app owns NO speakers, volume, or playback. At each prayer time the
 * scheduler asks for `buildTokens(prayer)` and attaches the result to the
 * prayer trigger cards as tags. The user's Flow picks whichever tag (Full
 * adhan, Short adhan, Adhkar, Quran, Custom…) to cast — the app never touches
 * a speaker (Homey blocks apps from invoking other apps' action cards).
 */
class AudioRouter {
  constructor(homey) {
    this.homey = homey;
  }

  _enabled() {
    return (this.homey.settings.get('advanced') || {}).appEnabled !== false;
  }

  // No timed follow-ups in this model; kept because the scheduler calls it
  // on every reschedule.
  clearScheduled() {}

  getReciterNames() {
    return Object.keys(RECITERS);
  }

  // Build the full-surah Quran URL for a reciter + surah number.
  _quranUrl(reciterName, surahNumber) {
    const server = RECITERS[reciterName] || RECITERS[DEFAULT_RECITER];
    const surah = String(Math.min(114, Math.max(1, parseInt(surahNumber, 10) || 1))).padStart(3, '0');
    return `${server}${surah}.mp3`;
  }

  /**
   * Compute the audio-URL tags carried by a prayer trigger.
   * Returns one string per URL category and a number (0-1) for volume.
   * IMPORTANT: Homey requires every token declared on a trigger card to be
   * present with the correct type at trigger time. A number-typed token that is
   * absent/undefined throws "Invalid value for token volume. Expected number but
   * got undefined" and REJECTS THE WHOLE TRIGGER (the prayer would not fire).
   * So `volume` is ALWAYS emitted as a number; "device default" (unset) falls
   * back to 1 (full). Flows that don't wire the volume tag are unaffected.
   * When the app is disabled, every URL tag is blanked so wired Flows cast nothing.
   */
  buildTokens(prayerName) {
    const a = this.homey.settings.get('audioPrefs') || {};
    const reciter = a.reciter || DEFAULT_RECITER;

    if (!this._enabled()) {
      return { adhan_full: '', adhan_short: '', adhkar_morning: '', adhkar_evening: '', quran: '', reciter, custom: '', custom2: '', custom3: '', volume: 1 };
    }

    const clean = (v, fallback = '') => (typeof v === 'string' && v.trim()) ? v.trim() : fallback;
    const vol = (a.volumes || {})[prayerName];
    const volume = (typeof vol === 'number' && vol >= 0 && vol <= 1) ? vol : 1;

    return {
      adhan_full:  clean(a.fullUrl,  DEFAULTS.full),
      adhan_short: clean(a.shortUrl, DEFAULTS.short),
      adhkar_morning: clean(a.adhkarMorningUrl, DEFAULTS.adhkar_morning),
      adhkar_evening: clean(a.adhkarEveningUrl, DEFAULTS.adhkar_evening),
      quran:       this._quranUrl(reciter, a.surah),
      reciter,
      custom:      clean(a.customUrl, DEFAULTS.custom),
      custom2:     clean(a.customUrl2),
      custom3:     clean(a.customUrl3),
      volume,
    };
  }
}

module.exports = AudioRouter;
