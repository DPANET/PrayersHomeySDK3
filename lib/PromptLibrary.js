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
    id: 'daily_surprise',
    name: 'Daily surprise (random content)',
    prompt: 'A random selector for THIS run is: {{RANDOM4}} (0 = hadith, 1 = Quran, 2 = dua, 3 = fatwa). '
      + 'Execute ONLY the option whose number equals {{RANDOM4}} — do NOT choose for yourself:\n'
      + '0 → an explained hadith (grade + scholarly commentary) via get_hadith_explained with NO input;\n'
      + '1 → an uplifting Quran verse via get_quran with NO input (its tafsir is bundled automatically — do NOT also call get_tafsir);\n'
      + '2 → adhkar via get_dua with NO input;\n'
      + '3 → a published fatwa from IslamQA.info via get_fatwa with NO input.\n'
      + 'Call only the SINGLE tool for the selected option and place its returned placeholder where it belongs, '
      + 'with one short warm line before the content (but for option 3, the fatwa, output only its placeholder '
      + 'with no words). Do not write the content yourself or explain why you picked it.',
  },
  {
    id: 'verse_reflection',
    name: 'Verse + reflection',
    prompt: 'A random selector for THIS run is {{RANDOM:8}}. Use the life theme whose number equals it:\n'
      + '0 = patience, 1 = gratitude, 2 = trust in Allah, 3 = justice, 4 = mercy, 5 = forgiveness, '
      + '6 = steadfastness, 7 = humility.\n'
      + 'Call get_quran with that theme as the query (its tafsir is bundled into the same placeholder — '
      + 'do NOT also call get_tafsir). Write one short lead-in line, place the verse placeholder, then add '
      + 'ONE short practical reflection the family can apply today. Do not write the verse or tafsir yourself.',
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
    prompt: 'A random selector for THIS run is {{RANDOM:7}}. Use the spiritual state whose number equals it:\n'
      + '0 = seeking forgiveness, 1 = reliance on Allah (tawakkul), 2 = guidance, 3 = gratitude, '
      + '4 = contentment, 5 = protection from worry and grief, 6 = steadfastness.\n'
      + 'Call get_dua with that state as the query. Open with one short line naming the theme and when to say it, '
      + 'then place the dua placeholder. Do not write the dua yourself.',
  },
  {
    id: 'next_prayer',
    name: 'Next prayer countdown',
    prompt: 'Call get_prayer_data and read its nextPrayer and minutesUntilNext fields directly. State the next '
      + 'prayer name, its time, and the remaining time in one short sentence. Convert minutesUntilNext into a '
      + 'natural phrase (e.g. "in about 2 hours and 15 minutes") — never show raw minutes arithmetic or '
      + 'milliseconds. Do NOT call get_current_time.',
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
