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
  full:   'https://www.islamcan.com/audio/adhan/azan1.mp3',
  short:  'https://www.islamcan.com/audio/adhan/azan2.mp3',
  adhkar: 'https://everyayah.com/data/Alafasy_128kbps/002255.mp3', // Ayat al-Kursi
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
   * Returns one string per category; the Flow chooses which to cast.
   * `volume` is the per-prayer volume % (as a string like "70") or "" = use
   * device default. When the app is disabled, every URL and volume tag is
   * blanked so wired Flows cast nothing without having to be deleted.
   */
  buildTokens(prayerName) {
    const a = this.homey.settings.get('audioPrefs') || {};
    const reciter = a.reciter || DEFAULT_RECITER;

    if (!this._enabled()) {
      return { adhan_full: '', adhan_short: '', adhkar: '', quran: '', reciter, custom: '', custom2: '', custom3: '', volume: '' };
    }

    const clean = (v, fallback = '') => (typeof v === 'string' && v.trim()) ? v.trim() : fallback;
    const vol = (a.volumes || {})[prayerName];
    const volume = (typeof vol === 'number' && vol >= 0 && vol <= 100) ? String(vol) : '';

    return {
      adhan_full:  clean(a.fullUrl,  DEFAULTS.full),
      adhan_short: clean(a.shortUrl, DEFAULTS.short),
      adhkar:      clean(a.adhkarUrl, DEFAULTS.adhkar),
      quran:       this._quranUrl(reciter, a.surah),
      reciter,
      custom:      clean(a.customUrl),
      custom2:     clean(a.customUrl2),
      custom3:     clean(a.customUrl3),
      volume,
    };
  }
}

module.exports = AudioRouter;
