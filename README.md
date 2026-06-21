# Prayers Alert

> Islamic prayer times, adhan audio, Quran recitation and adhkar for Homey Pro

[![Homey SDK](https://img.shields.io/badge/Homey_SDK-3-blue?style=flat-square)](https://apps.developer.homey.app)
[![Platform](https://img.shields.io/badge/platform-local-informational?style=flat-square)](https://homey.app)
[![Version](https://img.shields.io/badge/version-2.2.0-brightgreen?style=flat-square)](https://github.com/DPANET/PrayersHomeySDK3)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)

Prayers Alert is a Homey Pro app that calculates accurate Islamic prayer times for your location and delivers audio URLs as **Flow tags** at each prayer time. Your Flow picks which audio to cast — the app never touches a speaker directly, giving you full control over every speaker, volume, and sequence.

> **v2.2.0** splits Adhkar into separate **Morning** and **Evening** tags, ships working defaults for every audio slot, switches the volume tag to a **0–1 fraction** (matching Homey's volume capability), fixes the Prayer Times **dashboard widget** registration, fixes the **`prayer_name_is`** condition for Any‑prayer Flows, and adds a **Debug logging** toggle. All existing Flow card IDs and argument names remain unchanged from v1.x.

---

## Features

### 🕌 Prayer Times
- Accurate calculation using the [`adhan-extended`](https://github.com/msarhan/adhan-extended) library
- **12 calculation methods** — Dubai, Muslim World League, ISNA, Egyptian, Umm Al-Qura, Karachi, Kuwait, Qatar, Singapore, Moonsighting Committee, Tehran, Turkey (Diyanet)
- Madhab selection for Asr time: **Shafi / Maliki / Hanbali** or **Hanafi**
- High latitude rules: Middle of Night, Seventh of Night, Twilight Angle
- Per-prayer **±60 minute fine-tune adjustments**
- Live **5-day preview** with adjustments applied
- City search powered by OpenStreetMap Nominatim (or Google Places if a key is set), or manual coordinate entry
- Hijri calendar display with automatic detection of Ramadan, Laylah Al-Qadr, Eid Al-Fitr, Eid Al-Adha
- Sunrise included as a schedulable prayer time (can be excluded in Advanced)

### 🔊 Audio Tag Model

At each prayer time the app fires a trigger card carrying **audio URL tags**. Your Flow's "cast a URL" action uses whichever tag you want — the app is a pure URL provider and never touches a speaker itself.

| Tag | What it contains | Default |
|-----|------------------|---------|
| `adhan_full` | Full adhan URL | Mansour Al-Zahrani (aladhan.com) |
| `adhan_short` | Short adhan URL | Al-Fatiha, Alafasy (everyayah.com) |
| `adhkar_morning` | Morning adhkar URL | Adhkar of the Morning, Alafasy (archive.org) |
| `adhkar_evening` | Evening adhkar URL | Adhkar of the Evening, Alafasy (archive.org) |
| `quran` | Full-surah Quran URL | chosen reciter + surah |
| `reciter` | Reciter name string | Mishary Al-Afasy |
| `custom` | Custom URL 1 | Assabile adhan (editable) |
| `custom2` | Custom URL 2 | _(empty)_ |
| `custom3` | Custom URL 3 | _(empty)_ |
| `volume` | Per-prayer volume as a **0–1** string (`"0.7"`) or `""` for device default | _device default_ |

Every URL slot ships with a working default, so the app produces playable audio out of the box — change only what you want to customise.

**7 Quran reciters** via mp3quran.net:
- Mishary Al-Afasy
- Abdul Basit
- Maher Al-Muaiqly
- Saud Al-Shuraim
- Nasser Al-Qatami
- Hani Ar-Rifai
- Mohammed Al-Minshawi

### ⚡ Homey Flow Integration

#### Prayer triggers

| Card ID | Title | Tokens |
|---------|-------|--------|
| `prayer_trigger_all` | At any prayer time | `prayerName`, `prayerTime`, + 10 audio tags (see below) |
| `prayer_trigger_specific` | Specific Prayer | Same tokens, filtered by chosen prayer |
| `prayer_trigger_before_after_specific` | Before or After Prayer | `prayerName`, `prayerTimeCalculated` |

Audio tokens on `prayer_trigger_all` and `prayer_trigger_specific`:

| Token | Example value |
|-------|---------------|
| `adhan_full` | `https://cdn.aladhan.com/audio/adhans/a11-mansour-al-zahrani.mp3` |
| `adhan_short` | `https://everyayah.com/data/Alafasy_128kbps/001001.mp3` |
| `adhkar_morning` | `https://archive.org/download/.../Adhkar of the Morning_Mishary Alafasi.mp3` |
| `adhkar_evening` | `https://archive.org/download/.../Adhkar of the Evening_Mishary Alafasi.mp3` |
| `quran` | `https://server8.mp3quran.net/afs/001.mp3` |
| `reciter` | `Mishary Al-Afasy` |
| `custom` | `https://media.assabile.com/...` |
| `custom2` | user-defined |
| `custom3` | user-defined |
| `volume` | `"0.7"` or `""` (device default) |

> **Volume is a 0–1 fraction**, not a percentage — it maps directly onto Homey's `volume_set` capability. The settings UI shows it as a percentage for convenience but stores/emits `0.0`–`1.0`.

#### Hijri calendar triggers

| Card ID | Title | Tokens |
|---------|-------|--------|
| `hijri_month_event` | Hijri month starts / ends | `hijriMonthName`, `hijriMonth`, `hijriYear` |
| `hijri_day_of_month` | On day N of each Hijri month | `hijriDay`, `hijriMonthName`, `hijriMonth`, `hijriYear` |
| `hijri_specific_date` | On Hijri date (day + month, yearly) | `hijriDay`, `hijriMonthName`, `hijriYear`, `gregorianDate` |
| `hijri_date_offset` | Before / after Hijri date | `hijriDate`, `gregorianDate`, `anchorName` |

#### Islamic occasion triggers

| Card ID | Title | Tokens |
|---------|-------|--------|
| `islamic_occasion_event` | Islamic occasion starts / ends | `occasionName`, `hijriDate`, `gregorianDate` |
| `islamic_occasion_offset` | Before / after Islamic occasion | `occasionName`, `hijriDate`, `gregorianDate` |

Occasions covered: Ramadan, Eid Al-Fitr, Eid Al-Adha, Day of Arafah, Ashura, Mawlid Al-Nabi, Laylah Al-Qadr.

> Hijri timers are armed only for the cards you actually use in a Flow — wiring nothing arms nothing, keeping the timer count minimal.

#### Conditions

| Card ID | Title |
|---------|-------|
| `prayer_name_is` | Prayer name is / is not `[prayer]` — branch by name inside an **Any prayer** Flow |
| `is_islamic_occasion` | It is / is not `[occasion]` — Ramadan, Last 10 nights, Laylah Al-Qadr, Eid Al-Fitr, Eid Al-Adha, Arafah, Ashura, Mawlid |

> All prayer card IDs and argument names are identical to v1.x — existing user flows require no changes.

### 📊 Dashboard Widget
- **Prayer Times widget** — add to any Homey dashboard
- Left panel: next prayer name, time, and live countdown
- Right panel: full day schedule with passed / active / upcoming states
- Location, Hijri date, and overnight handling (shows tomorrow's Fajr after Isha)
- Refreshes every 60 seconds

### 🛡️ Reliability
- Rolling 3-day prayer / 40-day Hijri schedule horizon — survives Homey restarts and sleep
- Heartbeat reconciler every 30 minutes to self-heal missing timers
- Stale-event guard — skips a trigger if fired significantly late (device was asleep)
- Double-fire prevention via occurrence-key tracking (persisted across restarts)
- DST-safe scheduling using calendar-date stepping
- Settings migration from v1.x on first run
- Optional Sentry error reporting (set `SENTRY_DSN` in `env.json`)

---

## Requirements

- **Homey Pro** running Homey firmware ≥ 12.1.0
- A Homey-compatible smart speaker (for audio playback via Flow)
- Internet access for audio CDN and city search

The app requests a single permission: `homey:manager:geolocation` (to read Homey's GPS for prayer-time calculation).

---

## Installation

### Sideload (Developer)

```bash
# 1. Clone the repo
git clone https://github.com/DPANET/PrayersHomeySDK3.git
cd PrayersHomeySDK3

# 2. Install dependencies
npm install

# 3. (Optional) Create env.json with your secrets (gitignored) — see format below

# 4. Deploy to Homey Pro
homey app install
```

**`env.json`** (optional, never commit — it is in `.gitignore`):

```json
{
  "GOOGLE_MAPS_KEY": "",
  "SENTRY_DSN": ""
}
```

- **`GOOGLE_MAPS_KEY`** — optional. If omitted, city search falls back to OpenStreetMap Nominatim (no API key required).
- **`SENTRY_DSN`** — optional. If set, errors are forwarded to Sentry; otherwise error reporting is disabled with zero overhead.

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
- **Manual entry** — enter latitude, longitude, city, and country directly (non-numeric coordinates fall back to a safe default)

### Tab 3 — Calculation

| Setting | Options |
|---------|---------|
| Method | Dubai · Muslim World League · ISNA · Egyptian · Umm Al-Qura · Karachi · Kuwait · Qatar · Singapore · Moonsighting Committee · Tehran · Turkey |
| Madhab | Shafi / Maliki / Hanbali · Hanafi |
| High latitude rule | None · Angle based · Middle of night · One-seventh of night |
| Hijri method / offset | Umm al-Qura · ISNA · Diyanet · Egyptian · Global Crescent, plus a −1/0/+1 day fine-tune |

Saving recalculates the full schedule immediately.

### Tab 4 — Audio

Configure the URLs that prayer trigger tags will carry. All fields pre-fill with working defaults — only change what you want to customise.

| Field | Tag |
|-------|-----|
| Full adhan URL | `adhan_full` |
| Short adhan URL | `adhan_short` |
| Quran reciter | sets the mp3quran.net server for `quran` |
| Surah | searchable by name or number — sets the `quran` URL |
| Morning Adhkar URL | `adhkar_morning` |
| Evening Adhkar URL | `adhkar_evening` |
| Custom URL 1–3 | `custom`, `custom2`, `custom3` |
| **Prayer Volume** | per-prayer `volume` tag (0–100% in the UI, emitted as a 0–1 fraction) |

**Surah search** — type a surah name (e.g. "ya") or number (e.g. "36") and pick from the filtered list. The selected surah name is shown; the number is stored and used to build the CDN URL at fire time.

**Per-prayer volume** — each prayer (Fajr through Isha + Sunrise) has an independent slider. A greyed-out slider means "use device default" — the `volume` tag is blank. An active slider emits the configured fraction (e.g. `0.7`) so your Flow can call "Set Volume" before casting.

### Tab 5 — Advanced

- **App enabled** toggle — pause all scheduling without uninstalling
- **Exclude Sunrise** — suppress audio and Flow triggers at Sunrise (no timer is even armed)
- **Debug logging** — verbose per-timer / per-reconcile tracing in the app log; off by default so production logs stay readable

---

## Flow Examples

### Play full adhan at any prayer time

```
WHEN  Any prayer time   [Full adhan URL] → Cast on living room speaker
```

### Set volume then cast — using the per-prayer volume tag

```
WHEN  Any prayer time
THEN  Set volume to [Volume]            ← 0–1 fraction tag
THEN  Cast URL [Full adhan URL] on living room speaker
```

### Branch by prayer inside an Any-prayer Flow

```
WHEN  Any prayer time
AND   Prayer name is Fajr
THEN  Cast URL [Morning Adhkar URL] on bedroom speaker
```

### Play different audio per prayer

```
WHEN  Specific Prayer → Fajr
THEN  Cast URL [Morning Adhkar URL] on bedroom speaker

WHEN  Specific Prayer → Maghrib
THEN  Cast URL [Evening Adhkar URL] on living room speaker
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

# Build + validate the app manifest the way the store does
homey app validate --level publish
```

The test suite (`test/run-tests.js`) runs **104 checks** against the real library code using a mocked Homey environment with a mutable clock, in-memory settings store, and Flow trigger simulation. Coverage includes:

- Prayer time math (calc methods, Hanafi/Shafi Asr, ordering, bad-method fallback)
- Scheduling: rolling window, additive heartbeat, before/after Flow triggers
- Legacy trigger card firing (all three card IDs with original arg/token names)
- Condition state propagation — `prayer_trigger_all` passes `prayerName` so `prayer_name_is` works in Any-prayer Flows
- Hijri scheduler: flow-usage gating (no flows → no timers), day-of-month/occasion targeting, correct trigger state keys
- Edge cases: end-of-month roll-over, midnight boundary, stale-event suppression, double-fire prevention
- Hijri calendar: method offsets, user offset, Ramadan/Laylah/Eid predicates
- Audio token model: all 10 tags, split morning/evening adhkar, per-prayer volume (0–1 range, 0 valid, >1 rejected), custom URLs, default fallbacks, whitespace trimming, disabled-app blanking
- API endpoints: `previewTimes` (1-day and 5-day), `searchCity` guard, `widgetData` shape, `status`
- Merge-integrity audit: all audio tokens declared on the cards, obsolete cards absent

### Project layout

```
app.js                      App entry — registers triggers/conditions, wires schedulers
api.js                      HTTP API (preview, city search, status, widget data)
lib/
  calc.js                   Shared calculation params + coordinate resolution
  PrayerScheduler.js        Rolling-horizon prayer audio + before/after Flow timers
  HijriScheduler.js         Hijri / occasion timers (armed only for used Flow cards)
  HijriCalendar.js          Hijri date math + occasion predicates
  AudioRouter.js            buildTokens() — the audio URL tag model
  Logger.js                 Homey log + optional Sentry; debug gated by a setting
settings/index.html         Self-contained settings UI (5 tabs)
widgets/prayer_times/       Dashboard widget (widget.compose.json + public/index.html)
test/                       Mock Homey harness + 104-check suite
```

---

## Upgrading

### From v2.1.x

No action required. The single `adhkar` audio tag is replaced by `adhkar_morning` and `adhkar_evening`; if you used the old `adhkar` tag in a Flow, re-pick one of the new tags. The `volume` tag is now a 0–1 fraction (was a percentage) — update any Flow that consumed it as a number.

### From v1.x

On first launch after update, `_migrateSettings()` automatically converts the old `prayerConfig` and `locationConfig` settings keys to the new schema. All existing Flow cards continue to work without modification.

The `athan_action` action card has been removed — the app no longer plays audio directly. Replace any Flow that used it with a "cast URL" action using the `adhan_full` or `adhan_short` tag from a prayer trigger.

---

## License

MIT © [dpanet](https://github.com/DPANET)
