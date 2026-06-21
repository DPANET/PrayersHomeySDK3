# Prayers Alert

> Islamic prayer times, adhan audio, Quran recitation and adhkar for Homey Pro

[![Homey SDK](https://img.shields.io/badge/Homey_SDK-3-blue?style=flat-square)](https://apps.developer.homey.app)
[![Platform](https://img.shields.io/badge/platform-local-informational?style=flat-square)](https://homey.app)
[![Version](https://img.shields.io/badge/version-2.1.0-brightgreen?style=flat-square)](https://github.com/DPANET/PrayersHomeySDK3)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)

Prayers Alert is a Homey Pro app that calculates accurate Islamic prayer times for your location and delivers audio URLs as **Flow tags** at each prayer time. Your Flow picks which audio to cast — the app never touches a speaker directly, giving you full control over every speaker, volume, and sequence.

> **v2.1.0** extends the audio token model with per-prayer volume, three custom URL slots, Adhkar URL, and a searchable Surah picker. All existing Flow card IDs and argument names remain unchanged from v1.x.

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
- Sunrise included as a schedulable prayer time (can be excluded in Advanced)

### 🔊 Audio Tag Model

At each prayer time the app fires a trigger card carrying **audio URL tags**. Your Flow's "cast a URL" action uses whichever tag you want — the app is a pure URL provider and never touches a speaker itself.

| Tag | What it contains |
|-----|-----------------|
| `adhan_full` | Full adhan URL (default: islamcan.com azan1) |
| `adhan_short` | Short adhan URL (default: islamcan.com azan2) |
| `adhkar` | Adhkar / dhikr URL (default: Ayat al-Kursi, Alafasy) |
| `quran` | Full-surah Quran URL — chosen reciter + surah |
| `reciter` | Reciter name string |
| `custom` | Custom URL 1 (user-defined) |
| `custom2` | Custom URL 2 (user-defined) |
| `custom3` | Custom URL 3 (user-defined) |
| `volume` | Per-prayer volume % as a string (`"70"`) or `""` for device default |

**7 Quran reciters** via mp3quran.net:
- Mishary Al-Afasy
- Abdul Basit
- Maher Al-Muaiqly
- Saud Al-Shuraim
- Nasser Al-Qatami
- Hani Ar-Rifai
- Mohammed Al-Minshawi

### ⚡ Homey Flow Integration

| Card type | Card ID | Description |
|-----------|---------|-------------|
| **Trigger** | `prayer_trigger_all` | Fires at every prayer — tokens: all 9 audio tags + `prayerName`, `prayerTime` |
| **Trigger** | `prayer_trigger_specific` | Fires for one chosen prayer — same tokens, filtered by name |
| **Trigger** | `prayer_trigger_before_after_specific` | Fires before/after a chosen prayer — tokens: `prayerName`, `prayerTimeCalculated` |
| **Condition** | `is_ramadan` | True during the month of Ramadan |
| **Condition** | `is_laylah_al_qadr` | True on the 27th of Ramadan |

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
- Stale-event guard — skips trigger if fired significantly late (device was asleep)
- Double-fire prevention via occurrence key tracking
- DST-safe scheduling using calendar-date stepping
- Settings migration from v1.x on first run

---

## Requirements

- **Homey Pro** running Homey firmware ≥ 12.1.0
- A Homey-compatible smart speaker (for audio playback via Flow)
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

### Tab 4 — Audio

Configure the URLs that prayer trigger tags will carry. All fields pre-fill with working defaults — only change what you want to customise.

| Field | Description |
|-------|-------------|
| Full adhan URL | Played via the `adhan_full` tag |
| Short adhan URL | Played via the `adhan_short` tag |
| Quran reciter | Dropdown — selects the mp3quran.net server |
| Surah | Searchable by name or number — sets the `quran` tag URL |
| Adhkar URL | Played via the `adhkar` tag (defaults to Ayat al-Kursi) |
| Custom URL 1–3 | Free-form URLs passed via `custom`, `custom2`, `custom3` tags |
| **Prayer Volume** | Per-prayer volume slider (0–100%) — drag to override, × to use device default |

**Surah search** — type a surah name (e.g. "ya") or number (e.g. "36") and pick from the filtered list. The selected surah name is shown; the number is stored and used to build the CDN URL at fire time.

**Per-prayer volume** — each prayer (Fajr through Isha + Sunrise) has an independent slider. A greyed-out slider means "use device default" — the `volume` tag will be blank. An active slider emits the configured percentage so your Flow can call "Set Volume" before casting.

### Tab 5 — Advanced

- **App enabled** toggle — pause all scheduling without uninstalling
- **Exclude Sunrise** — suppress audio and Flow triggers at Sunrise
- **Audio freshness** — maximum seconds late an audio trigger is allowed to fire (guards against playback after a long sleep)

---

## Flow Examples

### Play full adhan at any prayer time

```
WHEN  Any prayer time   [Full adhan URL] → Cast on living room speaker
```

### Set volume then cast — using per-prayer volume tag

```
WHEN  Any prayer time
THEN  Set volume to [Volume %]
THEN  Cast URL [Full adhan URL] on living room speaker
```

### Play different audio per prayer

```
WHEN  Specific Prayer → Fajr
THEN  Cast URL [Adhkar URL] on bedroom speaker

WHEN  Specific Prayer → Dhuhr
THEN  Cast URL [Quran URL] on living room speaker
```

### Turn on bedroom light at Fajr only during Ramadan

```
WHEN  Prayer time — 0 minutes Before Fajr
AND   It is Ramadan
THEN  Turn on Bedroom light
```

### Send a notification 15 minutes before Dhuhr

```
WHEN  Prayer time — Before / After — 15 minutes Before Dhuhr
THEN  Send notification "Dhuhr in 15 minutes"
```

---

## Development

```bash
# Run the standalone test suite (no Homey hardware required)
npm test
```

The test suite (`test/run-tests.js`) runs **93 checks** against the real library code using a mocked Homey environment with a mutable clock, in-memory settings store, and Flow trigger simulation. Coverage includes:

- Prayer time math (5 calc methods, Hanafi/Shafi Asr, ordering, bad-method fallback)
- Scheduling: rolling 2-day window, additive heartbeat, before/after Flow triggers
- Legacy trigger card firing (all three card IDs with original arg/token names)
- Edge cases: end-of-month roll-over, midnight boundary, stale-event suppression, double-fire prevention
- Hijri calendar: method offsets, user offset, Ramadan/Laylah/Eid predicates
- Audio token model: all 9 tags, per-prayer volume (0 valid, >100 rejected), custom URLs, adhkar default fallback, whitespace trimming, disabled-app blanking
- API endpoints: `/previewTimes` (1-day and 5-day), `/status`, `/stopAudio`
- Merge-integrity audit: audio_requested trigger removed, all 9 audio tokens declared, obsolete cards absent

---

## Upgrading from v1.x

No action required. On first launch after update, `_migrateSettings()` automatically converts the old `prayerConfig` and `locationConfig` settings keys to the new schema. All existing Flow cards continue to work without modification.

The `athan_action` action card has been removed — the app no longer plays audio directly. If you had Flows using that card, replace them with a "cast URL" action using the `adhan_full` or `adhan_short` tag from the prayer trigger.

---

## License

MIT © [dpanet](https://github.com/DPANET)
