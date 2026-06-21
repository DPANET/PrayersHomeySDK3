Prayers Alert

Islamic prayer times, adhan audio, Quran recitation, Hijri calendar and Flow automation for Homey Pro.

Prayers Alert calculates accurate Islamic prayer times for your location and delivers audio URLs, volume, and Hijri calendar data directly into your Homey Flows. Cast adhan, Quran recitation, or adhkar to any Chromecast, Sonos, or smart speaker — all wired in Flow without a single line of code.


FEATURES

Prayer Times
- Accurate calculation using the adhan-extended library
- 12 calculation methods: Dubai, Muslim World League, ISNA, Egyptian, Umm Al-Qura, Karachi, Kuwait, Qatar, Singapore, Moonsighting Committee, Tehran, Turkey (Diyanet)
- Madhab selection for Asr: Shafi / Maliki / Hanbali or Hanafi
- High latitude rules: Middle of Night, Seventh of Night, Twilight Angle
- Per-prayer +/- 60 minute fine-tune adjustments
- Live 5-day preview with adjustments applied in real time
- City search (OpenStreetMap or Google Maps), GPS, or manual coordinates


Audio via Flow Tokens

Every prayer trigger carries ready-to-use audio URL tags. Wire any tag to a Cast a URL or Play media action in your Flow — the app handles the content, you choose the device.

- adhan_full       Full adhan (default: Mansour Al-Zahrani)
- adhan_short      Short adhan / Al-Fatiha (default: Alafasy)
- adhkar_morning   Morning adhkar (default: Alafasy)
- adhkar_evening   Evening adhkar (default: Alafasy)
- quran            Full-surah Quran recitation (mp3quran.net)
- reciter          Reciter name
- custom / custom2 / custom3   Your own URLs, set in Settings
- volume           Volume level 0-1 — wire to Set Volume before Cast

Supported reciters: Mishary Al-Afasy, Abdul Basit, Maher Al-Muaiqly, Saud Al-Shuraim, Nasser Al-Qatami, Hani Ar-Rifai, Mohammed Al-Minshawi


Hijri Calendar
- Hijri date on the dashboard widget
- Methods: Umm Al-Qura, ISNA, Diyanet, Egyptian, Global Crescent
- User +/- 1 day offset for moon sighting preferences
- Automatic detection of Ramadan, Laylah Al-Qadr, Eid Al-Fitr, Eid Al-Adha, Arafah, Ashura, Mawlid Al-Nabi


Dashboard Widget

Add the Prayer Times widget to any Homey dashboard:
- Left panel: next prayer name, time, and live countdown
- Right panel: full day schedule (passed / next / upcoming)
- Location city and Hijri date
- Overnight handling: shows tomorrow's Fajr after all today's prayers pass
- Auto-refreshes every 60 seconds


FLOW CARDS

Triggers:
- At any prayer time (carries all audio URL tokens)
- At a specific prayer
- Before / After a prayer (N seconds, minutes or hours)
- Hijri month event (starts or ends)
- On day of each Hijri month (white days: 13, 14, 15)
- On specific Hijri date (once a year)
- Before / After Hijri date (N days or weeks)
- Islamic occasion event (Ramadan, Eid Al-Fitr, Eid Al-Adha, Arafah, Ashura, Mawlid, Laylah Al-Qadr)
- Before / After Islamic occasion (N days or weeks)

Conditions:
- Prayer name is / is not
- Islamic occasion is / is not (Ramadan, Eid, Arafah, Ashura, Mawlid, Laylah Al-Qadr, Last 10 nights)


EXAMPLE FLOWS

Cast full adhan at Fajr via Chromecast:
  WHEN  At a specific prayer — Fajr
  THEN  Set volume on Chromecast to [volume token]
  THEN  Cast a URL on Chromecast — [adhan_full token]

Morning adhkar 10 minutes after Fajr:
  WHEN  Before / After prayer — 10 minutes After Fajr
  THEN  Cast a URL on Speaker — [adhkar_morning token]

Reminder 3 days before Eid Al-Adha:
  WHEN  Before / After Islamic occasion — 3 days Before Eid Al-Adha
  THEN  Send notification "Eid Al-Adha in 3 days"

White days reminder:
  WHEN  On day of each Hijri month — day 13
  THEN  Send notification "White days begin today"


CONFIGURATION

Open Settings from the Homey app: Apps > Prayers Alert > Settings.

- Prayer Times tab: view today's times, fine-tune per prayer, preview 5-day schedule
- Location tab: city search, Homey GPS, or manual coordinates
- Calculation tab: method, madhab, high latitude rule
- Audio tab: custom URLs for each audio category, reciter, surah, per-prayer volume
- Hijri tab: calendar method and day offset
- Advanced tab: app enabled toggle


REQUIREMENTS

- Homey Pro running Homey firmware >= 12.1.0
- A Homey-compatible smart speaker or Chromecast device (for audio)
- Internet access for audio CDN and city search


UPGRADING FROM v1.x

No action required. Settings are migrated automatically on first launch. All existing v1.x Flow cards continue to work unchanged.
