# Changelog

All notable changes to Prayers Alert are documented here.

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
