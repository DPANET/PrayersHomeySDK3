# Changelog

All notable changes to Prayers Alert are documented here.

---

## [3.1.0] — 2026-06-30

### Added
- **Interactive Telegram buttons on every assistant message** — verse (Prev/Next, Asbab), hadith (Explain), hadith-explained (Summarize), dua (Rest of set), fatwa (Summarize), and search results (numbered pick-list, Next 5) all now carry inline buttons matched to content type
- **Summarize button** for fatwa and hadith-explained cards — asks Claude for a 2–3 sentence summary of the exact item shown
- **Buttons on scheduled/Flow-triggered sends** — the "generate & send" action card (used by presets like Daily Surprise) now attaches the same inline buttons as a live reply; previously scheduled sends were text-only
- **Deterministic button handling** — More, single-result auto-pick, search-result paging, and item selection now resolve entirely in code with no Claude round-trip, for a near-instant response
- **Id-targeted Explain / Summarize** — these buttons now carry the specific hadith/fatwa id, so tapping one on an older, scrolled-back message still acts on that exact item instead of whatever was shown most recently
- **Re-selectable search menus** — picking one result from a search list no longer invalidates the list; subsequent picks from the same menu keep working

### Fixed
- **Silent dead-taps** — every button failure path (expired list, transient fetch error) now returns a localized (Arabic/English) message instead of the tap silently doing nothing

---

## [3.0.0] — 2026-06-27

### Added
- **AI Islamic assistant** powered by Claude — two Flow action cards: **Ask Islamic assistant** (free-text Q&A) and **Run Islamic assistant preset** (scheduled content from a library)
- **Prompt library** — built-in presets (Morning briefing, Daily surprise, Verse + reflection, Sunnah of the day, Dua of the day, Next prayer countdown, Fatwa of the day, adhkar sets) plus a settings-page editor to add, edit, and reorder presets
- **Content tools**: `get_prayer_data`, `get_quran`, `get_tafsir`, `get_hadith`, `get_hadith_explained`, `get_dua`, `get_fatwa`, plus `search_*` variants for browsing multiple results
- **Telegram delivery** — built-in bot listener (no Flow required) or classic Flow-card delivery; long messages split at paragraph boundaries; Markdown sanitized for Telegram's formatting subset
- **Settings → AI Assistant tab** — Anthropic API key, Telegram bot token + chat ID, allowed chats, language (Arabic/English/Bilingual), persona instructions, prompt library editor
- **Performance**: MCP session caching (30 s TTL), parallel bilingual Quran fetch, prompt caching on the system block, pure-relay presets that bypass Claude entirely, placeholder layout-delegation so Claude never re-emits scripture text it already fetched

### Changed
- Settings migrated automatically from v2.x (migrations V1–V13 + persona migrations); HomeyScript-based setup removed in favor of the built-in assistant cards

---

## [2.4.5] — 2026-06-25

### Fixed
- **Prayer Times settings page** — the six prayer tiles double-applied the fine-tune offset, so a tile (e.g. Asr `15:44`) could disagree with the matching row in the 5-day preview table (`15:46`). Tiles now load the raw calculated time and apply the stepper offset exactly once, so tile and table always agree.

### Changed
- The 5-day preview table now refreshes live (debounced) as you move the `−` / `+` steppers — no need to press **Preview** to see the table catch up.

---

## [2.4.2] — 2026-06-23

### Fixed
- **Widget preview images** replaced with abstract, text-free representations to comply with Homey App Store guideline §1.10 — previous previews were rejected for containing text (prayer names, times, city, date) and a non-transparent background

### Changed
- **Default full adhan** updated to `https://cdn.aladhan.com/audio/adhans/a1.mp3` (Makkah adhan, Al-Ghamdi)

---

## [2.2.1] — 2026-06-21

### Added
- `README.txt` for Homey App Store listing

## [2.2.0] — 2026-06-21

### Added
- **Dashboard widget** — Prayer Times widget for the Homey dashboard, showing next prayer with live countdown, full day schedule, location, and Hijri date
- **Widget auto-refresh** — data refreshes every 60 seconds; overnight handling shows tomorrow's Fajr after Isha
- **`adhkar_morning` / `adhkar_evening` tags** — split from a single adhkar tag; each carries its own default Alafasy recording (archive.org)
- **`custom2` / `custom3` URL tags** — two additional custom audio URL slots on all prayer triggers

### Changed
- **Volume token type** changed from string to **number (0–1)** — now compatible with Homey's built-in Set Volume action for Chromecast and other devices
- **Widget height** increased to 250 px; all font sizes increased for dashboard readability
- **Audio settings** — URL fields now default to blank (placeholder text shows the built-in default); saving settings no longer permanently stores default URLs

### Fixed
- Widget data not populating — widget API now uses promise-based `await homey.api()` (widget SDK requires promise, not callback)
- Volume tag not appearing in Chromecast Set Volume action picker (type mismatch: was string, now number)
- Settings pre-fill bug: opening Settings and saving immediately would overwrite user URLs with built-in defaults
- Tag example text replaced with plain descriptions (no URLs) to keep the Flow tag picker readable

---

## [2.1.0] — 2026-05-01

### Added
- **Hijri calendar triggers** (6 new cards):
  - *On day of each Hijri month* — e.g. white days (13, 14, 15)
  - *On specific Hijri date* — fires once a year on a given day + month
  - *Hijri month event* — fires when any or a specific Hijri month starts or ends
  - *Before / After Hijri date* — N days or weeks before or after a fixed anchor date
  - *Islamic occasion event* — Ramadan, Eid Al-Fitr, Eid Al-Adha, Arafah, Ashura, Mawlid Al-Nabi, Laylah Al-Qadr
  - *Before / After Islamic occasion* — N days or weeks before or after a named occasion
- **`Prayer name is` condition** — branch by prayer inside an "At any prayer time" flow
- **`Islamic occasion is / is not` condition** — gate flows on current Islamic date
- **Hijri calendar settings tab** — choose calculation method (Umm Al-Qura, ISNA, Diyanet, Egyptian, Global Crescent) and add a ±1 day fine-tune offset
- **Audio token model** — prayer triggers now carry audio URL tags (`adhan_full`, `adhan_short`, `adhkar_morning`, `adhkar_evening`, `quran`, `reciter`, `custom`) and a `volume` token; users wire these to speaker/cast actions in Flow
- **3 custom URL slots** in Audio settings; per-prayer volume (0–1) stored per prayer name
- **Quran surah picker** — choose any of 114 surahs; URL built dynamically per reciter from mp3quran.net
- **Boot-time spurious event guard** — 90-second post-init cooldown prevents stale reconcile triggers on Homey startup
- **Rolling 3-day schedule horizon** — timers armed up to 3 days ahead for resilience across restarts

### Changed
- **Speaker group model removed** — audio is now delivered entirely through Flow tokens; users cast audio themselves using existing Homey actions (no proprietary speaker control)
- **Night mode removed** — volume control is now handled per-prayer via the `volume` token
- Audio defaults updated to reliable CDN sources (cdn.aladhan.com, everyayah.com, archive.org, mp3quran.net, assabile.com)

---

## [2.0.0] — 2025-12-01

### Added
- Full rewrite to **Homey SDK 3** (Node.js, CommonJS)
- **12 prayer calculation methods** via `adhan-extended` library
- **Madhab selection** for Asr (Shafi/Hanafi)
- **High latitude rules** (Middle of Night, Seventh of Night, Twilight Angle)
- **Per-prayer time adjustments** (±60 min) with live 5-day preview
- **City search** using OpenStreetMap Nominatim (Google Maps optional)
- **Settings migration** from v1.x (`prayerConfig` / `locationConfig` → new schema)
- **Before / After prayer trigger** card with seconds, minutes, or hours offset
- **`prayer_trigger_all`** and **`prayer_trigger_specific`** trigger cards

### Compatibility
- All v1.x Flow card IDs and argument names preserved — no Flow rebuilding required
- Requires Homey firmware ≥ 12.1.0

---

## [1.1.18] and earlier

Legacy v1 releases. Built on Homey SDK 2. Core feature: prayer time scheduling with the original `athan_action` card.
