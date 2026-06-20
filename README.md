# Prayers Alert

> Islamic prayer times, adhan audio, Quran recitation and adhkar for Homey Pro

[![Homey SDK](https://img.shields.io/badge/Homey_SDK-3-blue?style=flat-square)](https://apps.developer.homey.app)
[![Platform](https://img.shields.io/badge/platform-local-informational?style=flat-square)](https://homey.app)
[![Version](https://img.shields.io/badge/version-2.0.0-brightgreen?style=flat-square)](https://github.com/DPANET/PrayersHomeySDK3)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)

Prayers Alert is a Homey Pro app that calculates accurate Islamic prayer times for your location and plays audio through any speaker in your home — adhan, Quran recitation, or adhkar playlists. Fully integrated with Homey Flow for automation.

> **v2.0.0** is a full rewrite to Homey SDK 3. All existing user flows built against v1.x are fully preserved — the original Flow card IDs and argument names are unchanged.

---

## Features

### 🕌 Prayer Times
- Accurate calculation using the [`adhan-extended`](https://github.com/msarhan/adhan-extended) library
- **12 calculation methods** — Dubai, Muslim World League, ISNA, Egyptian, Umm Al-Qura, Karachi, Kuwait, Qatar, Singapore, Moonsighting Committee, Tehran, Turkey (Diyanet)
- Madhab selection for Asr time: **Shafi / Maliki / Hanbali** or **Hanafi**
- High latitude rules: Middle of Night, Seventh of Night, Twilight Angle
- Per-prayer **±60 minute fine-tune adjustments**
- Live **5-day preview** with adjustments applied
- City search powered by OpenStreetMap Nominatim or manual coordinate entry
- Hijri calendar display with automatic detection of Ramadan, Laylah Al-Qadr, Eid Al-Fitr, Eid Al-Adha

### 🔊 Audio
- **Full adhan** and **Short adhan** playback
- **Quran recitation** — 7 reciters with automatic CDN failover:
  - Mishary Al-Afasy
  - Abdul Basit
  - Maher Al-Muaiqly
  - Saud Al-Shuraim
  - Nasser Al-Qatami
  - Hani Ar-Rifai
  - Mohammed Al-Minshawi
- **Morning adhkar** playlist (after Fajr) — Ayatul Kursi, Al-Ikhlas
- **Evening adhkar** playlist (after Asr) — Al-Falaq, An-Nas
- Configurable delay before adhkar playback
- **Night mode** — automatic volume reduction during configurable quiet hours
- Per-prayer volume and reciter overrides
- Direct Chromecast cast via Homey Web API — no Flow wiring needed for Google Cast devices

### 📐 Speaker Groups
- Multiple independent speaker groups — different rooms, different speakers, different content
- Per-group: one or more speakers, content type, volume, and surah number for Quran
- **Silent (Flow only)** mode — trigger Flows without playing audio

### ⚡ Homey Flow Integration

| Card type | Card ID | Description |
|-----------|---------|-------------|
| **Trigger** | `prayer_trigger_all` | Fires at every prayer time (tokens: `prayerName`, `prayerTime`) |
| **Trigger** | `prayer_trigger_specific` | Fires for a chosen prayer (same tokens, filtered by name) |
| **Trigger** | `prayer_trigger_before_after_specific` | Fires before or after a chosen prayer (tokens: `prayerName`, `prayerTimeCalculated`) |
| **Condition** | `is_ramadan` | True during the month of Ramadan |
| **Condition** | `is_laylah_al_qadr` | True on the 27th of Ramadan |
| **Action** | `athan_action` | Plays Full or Short adhan on all enabled speaker groups |

> All card IDs and argument names are identical to v1.x — existing user flows require no changes.

### 📊 Dashboard Widget
- **Prayer Times widget** — add to any Homey dashboard
- Left panel: next prayer name, time, and live countdown
- Right panel: full day schedule with passed / active / upcoming states
- Location, Hijri date, and overnight handling (shows tomorrow's Fajr after Isha)
- Refreshes every 60 seconds

### 🛡️ Reliability
- Rolling 3-day schedule horizon — survives Homey restarts and sleep
- Heartbeat reconciler every 30 minutes to self-heal missing timers
- Stale-event guard — skips audio if fired significantly late (device was asleep)
- Double-fire prevention via occurrence key tracking
- DST-safe scheduling using calendar-date stepping
- Settings migration from v1.x (`prayerConfig` → `calculation`, `locationConfig` → `location`) on first run

---

## Requirements

- **Homey Pro** running Homey firmware ≥ 12.1.0
- A Homey-compatible smart speaker (for audio playback)
- Internet access for audio CDN and city search

---

## Installation

### Sideload (Developer)

```bash
# 1. Clone the repo
git clone https://github.com/DPANET/PrayersHomeySDK3.git
cd PrayersHomeySDK3

# 2. Install dependencies
npm install

# 3. Create env.json with your secrets (gitignored)
# See env.json format below

# 4. Deploy to Homey Pro
homey app install
```

**`env.json`** (never commit this file — it is in `.gitignore`):

```json
{
  "GOOGLE_MAPS_KEY": ""
}
```

A Google Maps key is optional. If omitted, city search falls back to OpenStreetMap Nominatim (no API key required).

---

## Configuration

Open the app settings in the Homey app or at **homey.local** → Apps → Prayers Alert → Settings.

### Tab 1 — Prayer Times

The main overview. Shows today's six prayer times in a live grid.

- **ADJ badge** appears on any prayer that has a non-zero adjustment
- **Fine-tune section** — use `−` / `+` steppers to offset any prayer by up to ±60 minutes
- **Preview** — reloads the 5-day forecast below with your current (unsaved) adjustments
- **Save** — persists adjustments and immediately re-schedules all timers

### Tab 2 — Location

- **City search** — type any city name and select from suggestions; coordinates fill automatically
- **Use Homey GPS** — toggle to use the location Homey already knows
- **Manual entry** — enter latitude, longitude, city, and country directly

### Tab 3 — Calculation

| Setting | Options |
|---------|---------|
| Method | Dubai · Muslim World League · ISNA · Egyptian · Umm Al-Qura · Karachi · Kuwait · Qatar · Singapore · Moonsighting Committee · Tehran · Turkey |
| Madhab | Shafi / Maliki / Hanbali · Hanafi |
| High latitude rule | None · Angle based · Middle of night · One-seventh of night |

Saving recalculates the full schedule immediately.

### Tab 4 — Speaker Groups & Audio

Add one group per room. Each group maps one or more **speakers** to a **content type**:

| Content type | What plays |
|--------------|-----------|
| Full adhan | Standard adhan recording |
| Short adhan | Shorter adhan recording |
| Quran recitation | The surah number you specify, with the configured reciter |
| Morning adhkar | Ayatul Kursi + Al-Ikhlas, played after Fajr |
| Evening adhkar | Al-Falaq + An-Nas, played after Asr |
| Silent (Flow only) | No audio — only fires the Flow trigger cards |

### Tab 5 — Per-Prayer

Override volume or reciter for individual prayers. Also sets the **Global reciter** used for all Quran groups unless overridden.

### Tab 6 — Advanced

- **Night mode** — reduce volume to a quiet level between configurable hours (e.g. 22:00–06:00)
- **Morning adhkar** — enable auto-play after Fajr with an optional delay in minutes
- **Evening adhkar** — enable auto-play after Asr with an optional delay in minutes
- **App enabled** toggle — pause all scheduling without uninstalling

---

## Flow Examples

### Play adhan at Fajr
```
WHEN  Prayer time (any) — tokens: prayerName = Fajr
THEN  (Prayers Alert handles playback automatically via speaker group config)
```

### Turn on bedroom light at Fajr only during Ramadan
```
WHEN  Prayer time — 0 minutes Before Fajr
AND   It is Ramadan
THEN  Turn on Bedroom light
```

### Lower thermostat after Isha
```
WHEN  Prayer time — 0 minutes After Isha
THEN  Set thermostat to 19°C
```

### Send a notification 15 minutes before Dhuhr
```
WHEN  Prayer time — Before / After — 15 minutes — Dhuhr
THEN  Send notification "Dhuhr in 15 minutes"
```

---

## Development

```bash
# Run the standalone test suite (no Homey hardware required)
npm test
```

The test suite (`test/run-tests.js`) runs 86 checks against the real library code using a mocked Homey environment with a mutable clock, in-memory settings store, and Flow trigger simulation. It covers:

- Prayer time math (5 calc methods, Hanafi/Shafi Asr, ordering, bad-method fallback)
- Scheduling: rolling 2-day window, additive heartbeat, before/after Flow triggers
- Legacy trigger card firing (all three card IDs with original arg/token names)
- Edge cases: end-of-month roll-over, midnight boundary, stale-event suppression, double-fire prevention
- Hijri calendar: method offsets, user offset, Ramadan/Laylah/Eid predicates
- Audio/UI: all 6 content types, volume, night mode, disabled groups
- API endpoints: `/previewTimes`, `/status`, `/stopAudio`
- Merge-integrity audit: verifies all 5 previously identified bugs are resolved

---

## Upgrading from v1.x

No action required. On first launch after update, `_migrateSettings()` automatically converts the old `prayerConfig` and `locationConfig` settings keys to the new schema. All existing Flow cards continue to work without modification.

---

## License

MIT © [dpanet](https://github.com/DPANET)
