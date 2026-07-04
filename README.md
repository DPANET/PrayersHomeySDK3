# Prayers Alert

> Islamic prayer times, adhan audio, Quran recitation, Hijri calendar, Flow automation and AI Islamic assistant for Homey Pro

[![Homey SDK](https://img.shields.io/badge/Homey_SDK-3-blue?style=flat-square)](https://apps.developer.homey.app)
[![Platform](https://img.shields.io/badge/platform-local-informational?style=flat-square)](https://homey.app)
[![Version](https://img.shields.io/badge/version-3.1.0-brightgreen?style=flat-square)](https://github.com/DPANET/PrayersHomeySDK3)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)

Prayers Alert calculates accurate Islamic prayer times for your location and delivers audio URLs, volume, and Hijri calendar data directly into your Homey Flows. Cast adhan, Quran recitation, or adhkar to any Chromecast, Sonos, or smart speaker — all wired in Flow without a single line of code.

**v3.0** adds an AI Islamic assistant powered by Claude: schedule daily Islamic content, answer fiqh questions, fetch Quranic verses and tafsir, and deliver everything to Telegram — automatically.

**v3.1** adds interactive Telegram buttons on every assistant message — More, Explain, Summarize, verse navigation, and pick-lists — most of which resolve instantly in code with no Claude round-trip, and now also appear on scheduled/Flow-triggered sends (e.g. Daily Surprise), not just live replies.

---

## Features

### 🕌 Prayer Times
- Accurate calculation using the [`adhan-extended`](https://github.com/msarhan/adhan-extended) library
- **12 calculation methods** — Dubai, Muslim World League, ISNA, Egyptian, Umm Al-Qura, Karachi, Kuwait, Qatar, Singapore, Moonsighting Committee, Tehran, Turkey (Diyanet)
- Madhab selection for Asr: **Shafi / Maliki / Hanbali** or **Hanafi**
- High latitude rules: Middle of Night, Seventh of Night, Twilight Angle
- Per-prayer **±60 minute fine-tune adjustments**
- Live **5-day preview** with adjustments applied in real time
- City search (OpenStreetMap Nominatim or Google Maps), GPS, or manual coordinates

### 🔊 Audio via Flow Tokens
Every prayer trigger carries ready-to-use audio URL tags. Wire any tag to a **Cast a URL** or **Play media** action in your Flow — the app handles the content, you choose the device.

| Token | Content |
|-------|---------|
| `adhan_full` | Full adhan (default: Mansour Al-Zahrani via cdn.aladhan.com) |
| `adhan_short` | Short adhan / Al-Fatiha (default: Alafasy) |
| `adhkar_morning` | Morning adhkar (default: Alafasy — archive.org) |
| `adhkar_evening` | Evening adhkar (default: Alafasy — archive.org) |
| `quran` | Full-surah Quran recitation from mp3quran.net |
| `reciter` | Reciter name string |
| `custom` / `custom2` / `custom3` | Your own URLs, set in Settings |
| `volume` | Volume level 0–1 (number) — wire to **Set Volume** before Cast |

All URLs are resolved at trigger time from your Audio settings. Leave a field blank in settings to use the built-in default.

**Supported reciters (Quran):**
Mishary Al-Afasy · Abdul Basit · Maher Al-Muaiqly · Saud Al-Shuraim · Nasser Al-Qatami · Hani Ar-Rifai · Mohammed Al-Minshawi

### 📅 Hijri Calendar
- Hijri date shown on the dashboard widget
- Calculation methods: Umm Al-Qura, ISNA, Diyanet, Egyptian, Global Crescent
- User ±1 day fine-tune offset for moon sighting preferences
- Automatic detection of **Ramadan**, **Laylah Al-Qadr**, **Eid Al-Fitr**, **Eid Al-Adha**, **Arafah**, **Ashura**, **Mawlid Al-Nabi**

### 📊 Dashboard Widget
Add the **Prayer Times** widget to any Homey dashboard:
- **Left panel** — next prayer name, time, and live countdown
- **Right panel** — full day schedule with passed / next / upcoming states
- Location city and Hijri date displayed
- Overnight handling: shows tomorrow's Fajr after all today's prayers have passed
- Timezone-aware: correctly handles midnight rollover for locations where the Homey container's UTC date differs from the local calendar day
- Auto-refreshes every 60 seconds

### 🤖 Islamic AI Assistant (v3.0)
A Claude-powered action card that delivers Islamic content on demand or on a schedule, with results sent to Telegram.

**Two modes:**

**Schedule mode** — pick a preset from the library and run it automatically via Flow:
- *Morning briefing* — prayer times, Hijri date, and a random morning content (hadith, verse, or adhkar)
- *Daily surprise* — random pick from hadith with explanation, verse + tafsir, adhkar, or fatwa
- *Verse + reflection* — random life theme → matching Quran verse → tafsir → one-line reflection
- *Sunnah of the day* — hadith with a short practical application
- *Dua of the day* — thematic dua with context
- *Next prayer countdown* — one-line time-until-next-prayer
- *Fatwa of the day* — random published fatwa from IslamQA.info
- *Morning & evening adhkar*, *After-prayer adhkar*, *Before-sleep adhkar*, *Adhkar: random*

**Ask mode** — free-text prompt forwarded to Claude with full tool access.

**Content tools (via MCP):**

| Tool | Source |
|------|--------|
| `get_prayer_data` | Local adhan calculation |
| `get_quran` | quran.com — semantic verse search or direct surah:ayah lookup |
| `get_tafsir` | quran.com — Ibn Kathir tafsir |
| `get_hadith` | Sunnah.com hadith collections, with authenticity grade (via hadith-mcp.org) |
| `get_hadith_explained` | HadeethEnc.com — hadith + grade + scholarly explanation |
| `get_dua` | Hisn al-Muslim — bundled locally, no network call |
| `get_fatwa` | IslamQA.info — published fatwa, Arabic or bilingual |

**Performance features:**
- MCP session caching with 30-second TTL — subsequent tool calls within a session reuse the same connection (e.g. `get_tafsir` after `get_quran`: ~185 ms instead of ~1,500 ms)
- Parallel bilingual Quran fetch (Arabic + translation in one round)
- Prompt caching on the system block (~1,500 tokens cached across calls)
- Pure-relay schedule presets bypass Claude entirely for zero-overhead delivery
- Placeholder layout-delegation: Claude positions verbatim scripture blocks without re-emitting them, cutting response time from ~26 s to ~5 s for content-heavy presets

**Telegram delivery:**
- Configured bot token + chat ID in Settings → AI Assistant
- Long messages automatically split at paragraph boundaries (Telegram 4,096-char limit)
- Arabic fatwa answers preferred when language is set to Arabic or Bilingual
- Markdown sanitization prevents parse failures from special characters in source text
- Tafsir HTML (headings, paragraphs) converted to Telegram-compatible bold + line breaks
- Telegram formatting rule enforced: no tables, headings, or blockquotes — prayer times and lists rendered as plain lines

**Interactive buttons (v3.1):**

Every content message arrives with inline buttons matched to its type:

| Content | Buttons |
|---------|---------|
| Verse | ⬅️ Prev / ➡️ Next, 🕋 Asbab, ➡️ More |
| Hadith | 💡 Explain, ➡️ More |
| Hadith (explained) | 📝 Summarize, ➡️ More |
| Dua | ➕ Rest of set, ➡️ More |
| Fatwa | 📝 Summarize, ➡️ More |
| Search results | numbered pick-list, ⬇️ Next 5 |

Most of these resolve **without a Claude call at all** — More, picking a search result, paging results, and auto-resolving a single search hit are handled entirely in code for a near-instant response. Explain and Summarize target the *exact* item shown on that card (by id), so tapping either one after scrolling back to an older message still acts on the right content, not whatever was shown most recently. Search pick-lists stay live after a selection, so you can tap several results from the same list. Buttons are attached on both live replies and scheduled/Flow-triggered sends (e.g. Daily Surprise). Every tap always gets a response — if a list has expired or a fetch fails, the bot replies with a localized (Arabic/English) message instead of going silent.

---

### ⚡ Homey Flow Cards

#### Triggers

| Card | Description |
|------|-------------|
| **At any prayer time** | Fires at every prayer (Fajr, Sunrise, Dhuhr, Asr, Maghrib, Isha). Carries all audio URL tokens. |
| **At a specific prayer** | Fires only for the chosen prayer. Same tokens. |
| **Before / After a prayer** | Fires N seconds, minutes, or hours before or after the chosen prayer. |
| **Hijri month event** | Fires when a Hijri month starts or ends. Choose a specific month or "any". |
| **On day of each Hijri month** | Fires on the same Hijri day number every month — use 13, 14, 15 for white days. |
| **On specific Hijri date** | Fires once a year on a fixed Hijri day + month. |
| **Before / After Hijri date** | Fires N days or weeks before or after a specific Hijri anchor date. |
| **Islamic occasion event** | Fires when Ramadan, Eid Al-Fitr, Eid Al-Adha, Arafah, Ashura, Mawlid, or Laylah Al-Qadr starts or ends. |
| **Before / After Islamic occasion** | Fires N days or weeks before or after a named Islamic occasion. |

#### Conditions

| Card | Description |
|------|-------------|
| **Prayer name is** | True if the current prayer matches the selected name. Use with "At any prayer time" to branch per-prayer. |
| **Islamic occasion is / is not** | True if today falls on a named Islamic occasion (Ramadan, Eid, Arafah, Ashura, Mawlid, Laylah Al-Qadr, Last 10 nights). |

#### Actions

| Card | Description |
|------|-------------|
| **Ask Islamic assistant** | Free-text prompt sent to Claude with full content-tool access. Result delivered to Telegram. |
| **Run Islamic assistant preset** | Pick a preset from the library. Claude (or direct relay for pure-content presets) assembles and sends the bulletin to Telegram. |

---

## Configuration

Open Settings from the Homey app: **Apps → Prayers Alert → Settings**.

### Prayer Times tab
Today's six prayer times in a live grid. Use the `−` / `+` steppers to fine-tune any prayer (±60 min). **Preview** shows a 5-day forecast with unsaved adjustments. **Save** commits and re-schedules immediately.

### Location tab
- **City search** — type a city name and pick from suggestions (coordinates fill automatically)
- **Use Homey GPS** — use the location Homey already knows
- **Manual entry** — enter latitude, longitude, city, country directly

### Calculation tab

| Setting | Options |
|---------|---------|
| Method | Dubai · MWL · ISNA · Egyptian · Umm Al-Qura · Karachi · Kuwait · Qatar · Singapore · Moonsighting · Tehran · Turkey |
| Madhab (Asr) | Shafi/Maliki/Hanbali · Hanafi |
| High latitude | None · Twilight Angle · Middle of Night · Seventh of Night |

### Audio tab
Set custom URLs for any audio category. Leave blank to use the built-in default. Also configure:
- **Global Quran reciter** and **Surah number** (1–114)
- **Per-prayer volume** — 0–1 fraction sent as the `volume` Flow token

### Hijri tab
- **Calculation method** — choose the Hijri calendar convention for your region
- **Day offset** — fine-tune ±1 day for local moon sighting

### AI Assistant tab
- **Anthropic API key** — required for the Islamic assistant cards
- **Telegram Bot Token** and **Chat ID** — where assistant replies are sent
- **Language** — Arabic, English, or Bilingual (affects fatwa language)
- **Persona instructions** — optional custom personality prompt appended to the system message
- **Prompt library** — view, add, edit, and reorder schedule presets

### Advanced tab
- **App enabled** toggle — pause all scheduling without uninstalling

---

## Flow Examples

### Cast full adhan at Fajr (Chromecast)
```
WHEN   At a specific prayer — Fajr
THEN   Set volume on [Chromecast] to [volume token]
THEN   Cast a URL on [Chromecast] — [adhan_full token]
```

### Cast short adhan at every prayer, full adhan at Fajr only
```
WHEN   At any prayer time
IF     Prayer name is Fajr
THEN   Cast a URL on [Speaker] — [adhan_full token]
ELSE   Cast a URL on [Speaker] — [adhan_short token]
```

### Morning adhkar 10 minutes after Fajr
```
WHEN   Before / After prayer — 10 minutes After Fajr
THEN   Cast a URL on [Speaker] — [adhkar_morning token]
```

### Send a notification 15 minutes before Dhuhr
```
WHEN   Before / After prayer — 15 minutes Before Dhuhr
THEN   Send notification "Dhuhr in 15 minutes"
```

### Turn on the living room light on the first day of Ramadan
```
WHEN   Islamic occasion event — Ramadan starts
THEN   Turn on Living Room light
```

### Reminder 3 days before Eid Al-Adha
```
WHEN   Before / After Islamic occasion — 3 days Before Eid Al-Adha
THEN   Send notification "Eid Al-Adha in 3 days"
```

### White days reminder (13th of every Hijri month)
```
WHEN   On day of each Hijri month — day 13
THEN   Send notification "White days begin today"
```

### Send morning briefing to Telegram every day after Fajr
```
WHEN   Before / After prayer — 10 minutes After Fajr
THEN   Run Islamic assistant preset — Morning briefing
```

### Answer an Islamic question from a Homey virtual button
```
WHEN   Virtual button pressed
THEN   Ask Islamic assistant — "What is the ruling on praying Witr?"
```

---

## Requirements

- **Homey Pro** running Homey firmware ≥ 12.1.0
- A Homey-compatible smart speaker or Chromecast device (for audio playback)
- Internet access for audio CDN and city search
- **Anthropic API key** (for the AI assistant cards — free-tier sufficient for personal use)
- **Telegram Bot Token + Chat ID** (for AI assistant delivery)

---

## Installation

### From the Homey App Store
Search for **Prayers Alert** in the Homey app.

### Sideload (Developer)

```bash
git clone https://github.com/DPANET/PrayersHomeySDK3.git
cd PrayersHomeySDK3
npm install
homey app install
```

**`env.json`** (gitignored — never commit):
```json
{
  "GOOGLE_API_KEY": "",
  "GOOGLE_PLACE_KEY": ""
}
```
Both keys are optional. Without them, city search uses OpenStreetMap Nominatim (no key required).

---

## Development

```bash
npm test
```

The suite (`test/run-tests.js`) runs checks against the real library code using a mocked Homey environment with a mutable clock, in-memory settings store, and Flow trigger simulation. It covers prayer time math, scheduler correctness, Hijri calendar logic, audio token model, Islamic occasion detection, AI assistant tool dispatch, schedule bypass, Telegram message splitting, and content sanitization.

---

## Upgrading from v1.x / v2.x

**From v1.x:** No action required. On first launch `_migrateSettings()` automatically converts `prayerConfig` → `calculation` and `locationConfig` → `location`. All existing v1.x Flow cards continue to work unchanged.

**From v2.x:** Settings are migrated automatically (migrations V1–V13 + persona migrations). The AI assistant prompt library and persona are refreshed to the v3 contract on first launch.

---

## License

MIT © [dpanet](https://github.com/DPANET)
