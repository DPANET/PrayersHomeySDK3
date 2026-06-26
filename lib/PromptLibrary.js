'use strict';

/**
 * Prompt library for the Islamic assistant — schedule-mode presets.
 *
 * Pure helpers (no Homey dependency) so they unit-test directly. The card
 * reads/writes the live array from `homey.settings.get('promptLibrary')`.
 *
 * Each preset: { id, name, prompt }.
 *  - id     stable slug used by the Flow card to reference the preset
 *  - name   shown in the autocomplete dropdown
 *  - prompt the instruction handed to Claude in schedule mode
 */

// Ordered by expected usage: daily content first, routine adhkar next,
// then weekly / conditional / seasonal presets last.
const DEFAULT_PRESETS = [
  // ── Daily content (the everyday drivers) ──────────────────────────────────
  {
    id: 'morning_briefing',
    name: 'Morning briefing',
    prompt: "Get today's prayer times and the Hijri date via get_prayer_data, then choose ONE of these "
      + 'at random to accompany the briefing (vary it daily): '
      + '(A) a hadith via get_hadith; '
      + '(B) a morning verse via get_quran with query "morning" or "dawn" (semantic search finds one); '
      + '(C) morning adhkar via get_dua with query "waking up". '
      + 'Write a short warm opening line (one sentence) that mentions the Hijri date and next prayer time, '
      + 'then place the chosen content\'s placeholder right below it. Do not write the content yourself or explain your choice.',
  },
  {
    id: 'daily_surprise',
    name: 'Daily surprise (random content)',
    prompt: 'Choose ONE of these four at random (vary it each day — do not repeat the same choice): '
      + '(1) an explained hadith (with grade and scholarly commentary) via get_hadith_explained; '
      + '(2) a random uplifting Quran verse via get_quran, then its tafsir via get_tafsir for the same surah and ayah; '
      + '(3) adhkar on a random situation via get_dua; '
      + '(4) a random published fatwa from IslamQA.info via get_fatwa (no input). '
      + 'Call only the tool(s) for your chosen option and place each returned placeholder where it belongs, '
      + 'with one short warm line before the content (but for option 4, the fatwa, output only its placeholder '
      + 'with no words). Do not write the content yourself or explain why you picked it.',
  },
  {
    id: 'verse_reflection',
    name: 'Verse + reflection',
    prompt: 'Pick a life theme at random (patience, gratitude, trust in Allah, justice, mercy, forgiveness, '
      + 'steadfastness, humility — vary it daily). Call get_quran with that theme as the query so quran.com finds '
      + 'a matching verse. Then call get_tafsir for the same surah and ayah it returned. Write one short lead-in '
      + 'line, then place the verse placeholder, then the tafsir placeholder, and finally ONE short practical '
      + 'reflection the family can apply today. Do not write the verse or tafsir yourself.',
  },
  {
    id: 'sunnah_of_the_day',
    name: 'Sunnah of the day',
    prompt: 'Call get_hadith. Write a one-line introduction, place the hadith placeholder, then ONE short line '
      + 'on how to apply this sunnah in daily life. Do not write the hadith yourself.',
  },
  {
    id: 'dua_of_the_day',
    name: 'Dua of the day',
    prompt: 'Pick ONE spiritual state at random (vary it daily — do not repeat): seeking forgiveness, reliance on Allah '
      + '(tawakkul), guidance, gratitude, contentment, protection from worry and grief, or steadfastness. '
      + 'Call get_dua with that state as the query. Open with one short line naming the theme and when to say it, '
      + 'then place the dua placeholder. Do not write the dua yourself.',
  },
  {
    id: 'next_prayer',
    name: 'Next prayer countdown',
    prompt: 'Get the next upcoming prayer and how many minutes remain until it, then state it in one short sentence.',
  },
  {
    id: 'fatwa_random',
    name: 'Fatwa of the day',
    prompt: 'Call get_fatwa with no input to retrieve a random published fatwa from IslamQA.info. '
      + 'Output only the returned placeholder — write nothing else.',
  },
  // ── Routine adhkar (scheduled at fixed times of day) ──────────────────────
  {
    id: 'morning_evening_adhkar',
    name: 'Morning & evening adhkar',
    prompt: 'Call get_dua with the query "morning and evening". Output only the returned placeholder — write nothing else.',
  },
  {
    id: 'after_prayer_adhkar',
    name: 'After-prayer adhkar',
    prompt: 'Call get_dua with the query "after prayer". Output only the returned placeholder — write nothing else.',
  },
  {
    id: 'before_sleep_adhkar',
    name: 'Before-sleep adhkar',
    prompt: 'Call get_dua with the query "before sleep". Output only the returned placeholder — write nothing else.',
  },
  {
    id: 'adhkar_random',
    name: 'Adhkar: random',
    prompt: 'Pick one topic at random from this list and call get_dua for it: '
      + 'waking up, entering the home, leaving the home, eating, drinking, entering the mosque, leaving the mosque, '
      + 'rain, wind, thunder, sneezing, anger, anxiety, istikharah, visiting the sick, breaking the fast, '
      + 'dressing, looking in the mirror, travelling. Output only the returned placeholder — write nothing else '
      + 'and do not explain your choice.',
  },
];

/**
 * Resolve the prompt text for a selected preset.
 * @param {Array}  library    the promptLibrary array from settings (or undefined)
 * @param {object|string} presetArg  the Flow autocomplete value ({id,name,prompt}) or an id string
 * @returns {string|null}  the prompt text, or null if it cannot be resolved
 */
function resolve(library, presetArg) {
  const list = Array.isArray(library) ? library : [];

  // The autocomplete value carries the full object; prefer its own prompt
  // so a Flow keeps working even if the library entry was later edited.
  if (presetArg && typeof presetArg === 'object') {
    if (typeof presetArg.prompt === 'string' && presetArg.prompt.trim()) return presetArg.prompt.trim();
    const byId = list.find(p => p.id === presetArg.id || p.name === presetArg.name);
    return byId && byId.prompt ? byId.prompt.trim() : null;
  }

  if (typeof presetArg === 'string' && presetArg.trim()) {
    const byId = list.find(p => p.id === presetArg || p.name === presetArg);
    return byId && byId.prompt ? byId.prompt.trim() : null;
  }

  return null;
}

/**
 * Filter the library for the autocomplete dropdown.
 * @returns {Array<{id,name,prompt,description}>}
 */
function search(library, query) {
  const list = Array.isArray(library) && library.length ? library : DEFAULT_PRESETS;
  const q = (query || '').toLowerCase();
  return list
    .filter(p => !q || p.name.toLowerCase().includes(q))
    .map(p => ({
      id:          p.id,
      name:        p.name,
      prompt:      p.prompt,
      description: p.prompt.length > 60 ? p.prompt.slice(0, 57) + '…' : p.prompt,
    }));
}

module.exports = { DEFAULT_PRESETS, resolve, search };
