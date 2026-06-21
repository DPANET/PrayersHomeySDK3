'use strict';

/**
 * Test battery for the MERGED PrayersHomeySDK3 app.
 * Loads the REAL lib/* modules and drives them through mockHomey.js under a
 * controllable clock.  Sections 1-7 assert correct behaviour (should be green).
 * Section 8 is a merge-integrity audit: a FAIL there = a real issue to fix.
 *
 * Run:  node test/run-tests.js
 */

const fs   = require('fs');
const path = require('path');
const LIB  = path.join(__dirname, '..', 'lib');
const ROOT = path.join(__dirname, '..');

const adhan           = require('adhan-extended');
// In this repo `require('homey')` resolves to the homey-cli (package main is
// bin/homey.js), which runs a yargs parser and exits 1 on load. The real SDK
// (Homey.App / Homey.env) is injected by the Homey runtime on-device. For the
// onInit replay in section 12, pre-seed the require cache with a stub so that
// app.js's `require('homey')` returns it instead of executing the CLI.
const _homeyPath = require.resolve('homey');
require.cache[_homeyPath] = { id: _homeyPath, filename: _homeyPath, loaded: true, exports: { App: class {}, env: {} } };
const PrayerScheduler = require(path.join(LIB, 'PrayerScheduler'));
const HijriScheduler  = require(path.join(LIB, 'HijriScheduler'));
const AudioRouter     = require(path.join(LIB, 'AudioRouter'));
const HijriCalendar   = require(path.join(LIB, 'HijriCalendar'));
const triggerMatches  = require(path.join(LIB, 'triggerMatch'));
const apiHandlers     = require(path.join(ROOT, 'api'));
const App             = require(path.join(ROOT, 'app'));
const { createMockHomey, withFrozenNow, MockDevice } = require('./mockHomey');

// ── assert framework ──────────────────────────────────────────────────────────
let pass = 0, fail = 0; const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail++; failures.push(name); console.log(`  \x1b[31m✗ ${name}\x1b[0m${detail ? ' — ' + detail : ''}`); }
}
function section(t) { console.log(`\n\x1b[1m\x1b[36m${t}\x1b[0m`); }
function note(t) { console.log(`  \x1b[90m• ${t}\x1b[0m`); }

const PRAYER_NAMES = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
const DUBAI = new adhan.Coordinates(24.45, 54.37);

function localMidnight(realDateMs) {
  const d = realDateMs != null ? new Date(realDateMs) : new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function castSpeaker(id) {
  return new MockDevice(id, 'Cast ' + id, ['volume_set', 'speaker_playing'],
    { ownerUri: 'homey:app:com.google.chromecast' });
}
function group(over = {}) {
  return Object.assign({
    id: 'g1', name: 'Living', enabled: true, volume: 70, contentType: 'Full adhan',
    speakers: [{ speakerId: 'sp1', speakerName: 'Cast sp1' }],
  }, over);
}
function makeEnv({ settings = {}, instances = [], devices = {}, geo, timezone } = {}) {
  const homey = createMockHomey({ settings, devices, geo, timezone });
  const audioRouter = new AudioRouter(homey);
  const scheduler   = new PrayerScheduler(homey);
  homey.app.audioRouter = audioRouter;
  homey.app.scheduler   = scheduler;
  const ba = homey.flow.getTriggerCard('prayer_trigger_before_after_specific');
  ba.setArgumentValues(instances);
  return { homey, audioRouter, scheduler, t: homey._test, ba };
}
// Audio is now delivered as URL tags on prayer_trigger_all. "An adhan fired" =
// prayer_trigger_all fired carrying a non-empty Full adhan URL tag.
const castUrls = t => (t.triggerCards['prayer_trigger_all']?.triggerCalls || [])
  .map(c => c.tokens?.adhan_full).filter(Boolean);
const onDay   = (s, arr, off) => arr.filter(x => x.dayEpoch === s._dayEpoch(off));
const findOcc = (arr, prayer, dayEpoch) => arr.find(a => a.prayer === prayer && a.dayEpoch === dayEpoch);

async function main() {

// ============================================================================
section('1. Prayer-time calculation — methods, madhab, ordering, adjustments');
// ============================================================================
{
  const date = new Date(2026, 5, 20);
  const ptFor = (method, madhab = 'Shafi') => {
    const p = adhan.CalculationMethod[method]();
    p.madhab = madhab === 'Hanafi' ? adhan.Madhab.Hanafi : adhan.Madhab.Shafi;
    return new adhan.PrayerTimes(DUBAI, date, p);
  };
  const dubai = ptFor('Dubai'), mwl = ptFor('MuslimWorldLeague'), egy = ptFor('Egyptian'), kar = ptFor('Karachi');

  check('1a. Dubai vs MuslimWorldLeague produce different Fajr', dubai.fajr.getTime() !== mwl.fajr.getTime());
  check('1b. Egyptian vs Karachi produce different Isha', egy.isha.getTime() !== kar.isha.getTime());
  check('1c. all four methods give a valid (ordered) day',
    [dubai, mwl, egy, kar].every(pt =>
      pt.fajr < pt.sunrise && pt.sunrise < pt.dhuhr && pt.dhuhr < pt.asr &&
      pt.asr < pt.maghrib && pt.maghrib < pt.isha));

  const shafi = ptFor('Dubai', 'Shafi'), hanafi = ptFor('Dubai', 'Hanafi');
  check('1d. Hanafi Asr is later than Shafi Asr', hanafi.asr.getTime() > shafi.asr.getTime());
  check('1e. madhab does not change Fajr/Maghrib',
    shafi.fajr.getTime() === hanafi.fajr.getTime() && shafi.maghrib.getTime() === hanafi.maghrib.getTime());

  // Scheduler buildParams: invalid method falls back to Dubai; Hanafi honored.
  const env = makeEnv({ settings: { calculation: { method: 'Nonsense', madhab: 'Hanafi' } } });
  const p = env.scheduler._buildParams();
  check('1f. scheduler._buildParams falls back gracefully on bad method (no throw)', !!p);
  check('1g. scheduler._buildParams honors Hanafi madhab', p.madhab === adhan.Madhab.Hanafi);
}

// ============================================================================
section('2. Scheduler — rolling 2-day window with legacy before/after card');
// ============================================================================
{
  const base = localMidnight() + 60 * 1000;   // just after local midnight → all today future
  await withFrozenNow(base, async () => {
    const env = makeEnv({
      instances: [{ prayerAfterBefore: 'After', prayerName: 'Fajr', prayerDurationTime: 5, prayerDurationType: 'minutes' }],
    });
    await env.scheduler.init();
    check('2a. audio scheduled for all 3 days (6×3 = 18)', env.scheduler.lastRun.audio.length === 18);
    check('2b. today has 6 audio occurrences', onDay(env.scheduler, env.scheduler.lastRun.audio, 0).length === 6);
    check('2c. 1 before/after flow timer per day (3 total)', env.scheduler.lastRun.flows.length === 3);
    const pt = env.scheduler.getPrayerTimes();
    const todayFlow = findOcc(env.scheduler.lastRun.flows, 'Fajr', env.scheduler._dayEpoch(0));
    check('2d. flow fireAt = Fajr + 5min', !!todayFlow && Math.abs(todayFlow.fireAt - (pt.fajr.getTime() + 5 * 60000)) < 1000);
    const todayAudio = findOcc(env.scheduler.lastRun.audio, 'Fajr', env.scheduler._dayEpoch(0));
    check('2e. audio fireAt = exact Fajr (no offset)', !!todayAudio && Math.abs(todayAudio.fireAt - pt.fajr.getTime()) < 1000);
  });

  // "Any" before 10min → 6 flow timers/day (Fajr..Isha + Sunrise) since PRAYER_KEYS_FLOW has 6.
  await withFrozenNow(localMidnight() + 60 * 1000, async () => {
    const env = makeEnv({
      instances: [{ prayerAfterBefore: 'Before', prayerName: 'Any', prayerDurationTime: 10, prayerDurationType: 'minutes' }],
    });
    await env.scheduler.init();
    check('2f. "Any" expands to 6 prayers incl. Sunrise → 6 flows/day (18 total)', env.scheduler.lastRun.flows.length === 18);
  });

  // After all prayers (just before next local midnight): today empty, future full.
  await withFrozenNow(localMidnight() + (24 * 60 - 1) * 60 * 1000, async () => {
    const env = makeEnv({ instances: [] });
    await env.scheduler.init();
    check('2g. late at night: today has 0 audio', onDay(env.scheduler, env.scheduler.lastRun.audio, 0).length === 0);
    check('2h. tomorrow + day-after still scheduled (12 audio)', env.scheduler.lastRun.audio.length === 12);
  });
}

// ============================================================================
section('3. Legacy trigger firing — the merge core (all / specific / before-after)');
// ============================================================================
{
  const base = localMidnight() + 60 * 1000;
  await withFrozenNow(base, async (clock) => {
    const env = makeEnv({
      settings: { speakerGroups: [group()] },
      devices: { sp1: castSpeaker('sp1') },
      instances: [{ prayerAfterBefore: 'After', prayerName: 'Dhuhr', prayerDurationTime: 1, prayerDurationType: 'minutes' }],
    });
    env.audioRouter._reachable = async () => true;
    await env.scheduler.init();

    // Fire Dhuhr audio occurrence.
    const dhuhrAudio = findOcc(env.scheduler.lastRun.audio, 'Dhuhr', env.scheduler._dayEpoch(0));
    clock.now = dhuhrAudio.fireAt;
    await env.t.timers.fireById(dhuhrAudio.id);

    const cardAll      = env.t.triggerCards['prayer_trigger_all'];
    const cardSpecific = env.t.triggerCards['prayer_trigger_specific'];
    check('3a. _fireAudio dispatched adhan once (cast)', castUrls(env.t).filter(Boolean).length === 1);
    check('3b. prayer_trigger_all fired with prayerName+prayerTime',
      cardAll.triggerCalls.length === 1 && cardAll.triggerCalls[0].tokens.prayerName === 'Dhuhr'
      && /^\d{2}:\d{2}$/.test(cardAll.triggerCalls[0].tokens.prayerTime));
    check('3c. prayer_trigger_specific fired with state {prayerName}',
      cardSpecific.triggerCalls.length === 1 && cardSpecific.triggerCalls[0].state.prayerName === 'Dhuhr');

    // Fire the before/after flow occurrence.
    const dhuhrFlow = findOcc(env.scheduler.lastRun.flows, 'Dhuhr', env.scheduler._dayEpoch(0));
    clock.now = dhuhrFlow.fireAt;
    await env.t.timers.fireById(dhuhrFlow.id);
    const cardBA = env.t.triggerCards['prayer_trigger_before_after_specific'];
    check('3d. before/after fired old tokens {prayerName, prayerTimeCalculated}',
      cardBA.triggerCalls.length === 1
      && cardBA.triggerCalls[0].tokens.prayerName === 'Dhuhr'
      && typeof cardBA.triggerCalls[0].tokens.prayerTimeCalculated === 'string');
    check('3e. before/after state carries old arg names',
      cardBA.triggerCalls[0].state.prayerAfterBefore === 'After'
      && cardBA.triggerCalls[0].state.prayerDurationType === 'minutes');
  });

  // triggerMatches predicate (old arg names)
  const b = { prayerAfterBefore: 'Before', prayerName: 'Fajr', prayerDurationTime: 10, prayerDurationType: 'minutes' };
  check('3f. triggerMatches: identical → true', triggerMatches(b, { ...b }) === true);
  check('3g. triggerMatches: different prayer → false', triggerMatches(b, { ...b, prayerName: 'Isha' }) === false);
  check('3h. triggerMatches: different offset → false', triggerMatches(b, { ...b, prayerDurationTime: 5 }) === false);
  check('3i. triggerMatches: 0 vs "0" coerced equal',
    triggerMatches({ ...b, prayerDurationTime: 0 }, { ...b, prayerDurationTime: '0' }) === true);
  check('3j. triggerMatches: matches via _resolvedPrayer when arg is concrete',
    triggerMatches({ ...b, prayerName: 'Fajr' }, { ...b, prayerName: 'Any', _resolvedPrayer: 'Fajr' }) === true);
}

// ============================================================================
section('4. Edge cases — end of month, midnight boundary, freshness, early-fire');
// ============================================================================
{
  // End of month: Jan 31 → Feb 1 → Feb 2 (2026, non-leap).
  const jan31 = new Date(2026, 0, 31, 0, 1).getTime();
  await withFrozenNow(jan31, async () => {
    const env = makeEnv({ instances: [] });
    await env.scheduler.init();
    const d0 = env.scheduler._dayEpoch(0), d1 = env.scheduler._dayEpoch(1), d2 = env.scheduler._dayEpoch(2);
    check('4a. day+1 rolls Jan→Feb (month boundary)', new Date(d1).getMonth() === 1 && new Date(d1).getDate() === 1);
    check('4b. day+2 is Feb 2', new Date(d2).getMonth() === 1 && new Date(d2).getDate() === 2);
    check('4c. each day across the boundary has 6 audio occurrences',
      onDay(env.scheduler, env.scheduler.lastRun.audio, 0).length === 6 &&
      onDay(env.scheduler, env.scheduler.lastRun.audio, 1).length === 6 &&
      onDay(env.scheduler, env.scheduler.lastRun.audio, 2).length === 6);
    const f0 = findOcc(env.scheduler.lastRun.audio, 'Fajr', d0);
    const f1 = findOcc(env.scheduler.lastRun.audio, 'Fajr', d1);
    check('4d. Fajr time differs day-to-day across month end', f0.fireAt !== f1.fireAt);
  });

  // Feb 28 → Mar 1 (non-leap 2026).
  const feb28 = new Date(2026, 1, 28, 0, 1).getTime();
  await withFrozenNow(feb28, async () => {
    const env = makeEnv({ instances: [] });
    await env.scheduler.init();
    const d1 = env.scheduler._dayEpoch(1);
    check('4e. Feb 28 → day+1 is Mar 1 (no Feb 29 in 2026)', new Date(d1).getMonth() === 2 && new Date(d1).getDate() === 1);
  });

  // Midnight boundary: at 23:30-ish tomorrow's Fajr is scheduled and fires across midnight.
  await withFrozenNow(localMidnight() + (23 * 60 + 30) * 60 * 1000, async (clock) => {
    const env = makeEnv({ settings: { speakerGroups: [group()] }, devices: { sp1: castSpeaker('sp1') } });
    env.audioRouter._reachable = async () => true;
    await env.scheduler.init();
    const tomFajr = findOcc(env.scheduler.lastRun.audio, 'Fajr', env.scheduler._dayEpoch(1));
    check('4f. tomorrow Fajr scheduled while today is 23:30', !!tomFajr);
    clock.now = tomFajr.fireAt;
    await env.t.timers.fireById(tomFajr.id);
    check('4g. Fajr fires across midnight (cast once)', castUrls(env.t).filter(Boolean).length === 1);
  });

  // Freshness: device slept, timer fires 200s late → adhan suppressed.
  await withFrozenNow(localMidnight() + 60 * 1000, async (clock) => {
    const env = makeEnv({ settings: { speakerGroups: [group()] }, devices: { sp1: castSpeaker('sp1') } });
    env.audioRouter._reachable = async () => true;
    await env.scheduler.init();
    const fajr = findOcc(env.scheduler.lastRun.audio, 'Fajr', env.scheduler._dayEpoch(0));
    clock.now = fajr.fireAt + 200 * 1000;
    await env.t.timers.fireById(fajr.id);
    check('4h. stale adhan (200s late) suppressed', castUrls(env.t).filter(Boolean).length === 0);
    check('4i. staleness logged', env.t.logs.some(l => /stale Fajr adhan/i.test(l)));
  });

  // On-time-ish (30s late) still plays.
  await withFrozenNow(localMidnight() + 60 * 1000, async (clock) => {
    const env = makeEnv({ settings: { speakerGroups: [group()] }, devices: { sp1: castSpeaker('sp1') } });
    env.audioRouter._reachable = async () => true;
    await env.scheduler.init();
    const fajr = findOcc(env.scheduler.lastRun.audio, 'Fajr', env.scheduler._dayEpoch(0));
    clock.now = fajr.fireAt + 30 * 1000;
    await env.t.timers.fireById(fajr.id);
    check('4j. 30s-late fire still plays', castUrls(env.t).filter(Boolean).length === 1);
  });

  // Early-fire guard: clock jumped back 5 min → re-arm, no dispatch.
  await withFrozenNow(localMidnight() + 60 * 1000, async (clock) => {
    const env = makeEnv({ settings: { speakerGroups: [group()] }, devices: { sp1: castSpeaker('sp1') } });
    env.audioRouter._reachable = async () => true;
    await env.scheduler.init();
    const fajr = findOcc(env.scheduler.lastRun.audio, 'Fajr', env.scheduler._dayEpoch(0));
    clock.now = fajr.fireAt - 300 * 1000;
    await env.t.timers.fireById(fajr.id);
    check('4k. early fire does NOT dispatch', castUrls(env.t).filter(Boolean).length === 0);
    check('4l. occurrence re-armed (still scheduled)',
      [...env.scheduler._audio.values()].some(a => a.prayer === 'Fajr' && a.dayEpoch === env.scheduler._dayEpoch(0)));
  });

  // Heartbeat idempotency: additive reconcile adds no duplicates.
  await withFrozenNow(localMidnight() + 60 * 1000, async (clock) => {
    const env = makeEnv({ settings: { speakerGroups: [group()] }, devices: { sp1: castSpeaker('sp1') } });
    await env.scheduler.init();
    const before = env.scheduler._audio.size;
    const idsBefore = [...env.scheduler._audio.values()].map(v => v.id).sort();
    clock.now += 60 * 1000;
    await env.t.timers.fireById(env.scheduler._heartbeat);
    const idsAfter = [...env.scheduler._audio.values()].map(v => v.id).sort();
    check('4m. heartbeat adds no duplicate timers', env.scheduler._audio.size === before);
    check('4n. existing timers untouched (same ids)', JSON.stringify(idsBefore) === JSON.stringify(idsAfter));
  });

  // Fired-occurrence persistence: a recorded future key is skipped.
  await withFrozenNow(localMidnight() + 60 * 1000, async () => {
    const env = makeEnv({ settings: { speakerGroups: [group()] }, devices: { sp1: castSpeaker('sp1') } });
    const firedKey = `Fajr@${env.scheduler._dayEpoch(1)}`;
    env.homey.settings.set('firedOccurrences', [{ k: firedKey, t: Date.now() }]);
    await env.scheduler.init();
    check('4o. recorded-fired occurrence skipped', !findOcc(env.scheduler.lastRun.audio, 'Fajr', env.scheduler._dayEpoch(1)));
    check('4p. other occurrences that day still scheduled', !!findOcc(env.scheduler.lastRun.audio, 'Dhuhr', env.scheduler._dayEpoch(1)));
  });

  // Settings routing: only time-affecting keys schedule a rebuild.
  await withFrozenNow(localMidnight() + 60 * 1000, async () => {
    const env = makeEnv();
    env.scheduler._onSettingChanged('speakerGroups');
    check('4q. speakerGroups change does NOT schedule rebuild', env.scheduler._debounce === null);
    env.scheduler._onSettingChanged('location');
    check('4r. location change DOES schedule rebuild', env.scheduler._debounce !== null);
  });

  // Post-boot events are honored, never dropped. The old 90s boot cooldown
  // swallowed the flow-card 'update' Homey emits once it finishes loading flow
  // arguments — so before/after timers were never registered ("scheduled but
  // never triggers"). Now every change source funnels into one debounced,
  // idempotent rebuild with no suppression window.
  await withFrozenNow(localMidnight() + 60 * 1000, async (clock) => {
    const env = makeEnv({ settings: {} });
    await env.scheduler.init();
    // Clean boot: schedule built in one idempotent pass, nothing left pending,
    // no legacy cooldown/catch-up machinery.
    check('4s. boot leaves no cooldown/catch-up timer pending',
      env.scheduler._bootCatchup === undefined && env.scheduler._readyAt === undefined &&
      env.scheduler._debounce === null);

    // Regression guard: a post-boot flow-card 'update' arms a rebuild (registers
    // the before/after flow timers) instead of being dropped.
    env.ba.emit('update');
    check('4t. post-boot flow update arms a rebuild (not dropped by a cooldown)',
      env.scheduler._debounce !== null);

    // A post-boot setting change is likewise honored (re-arms the same debounce).
    env.scheduler._onSettingChanged('location');
    check('4u. post-boot setting change arms a rebuild', env.scheduler._debounce !== null);

    // Bursty events collapse into exactly one destructive rebuild when it fires.
    let destructiveRuns = 0;
    const origRun = env.scheduler._run.bind(env.scheduler);
    env.scheduler._run = (d) => { if (d) destructiveRuns++; return origRun(d); };
    env.ba.emit('update');
    env.scheduler._onSettingChanged('location');
    await env.t.timers.fireById(env.scheduler._debounce);
    check('4v. bursty post-boot events collapse into one rebuild', destructiveRuns === 1);
  });
}

// ============================================================================
section('5. HijriCalendar — method offsets (end-of-month fix) + predicates');
// ============================================================================
{
  check('5a. Umm al-Qura offset = 0', new HijriCalendar({ method: 'Umm al-Qura' })._totalOffset === 0);
  check('5b. ISNA offset = -1', new HijriCalendar({ method: 'ISNA' })._totalOffset === -1);
  check('5c. Global Crescent offset = +1', new HijriCalendar({ method: 'Global Crescent' })._totalOffset === 1);
  check('5d. user offset is additive to method', new HijriCalendar({ method: 'Global Crescent', offset: 1 })._totalOffset === 2);
  check('5e. user offset can cancel method (ISNA +1 = 0)', new HijriCalendar({ method: 'ISNA', offset: 1 })._totalOffset === 0);
  check('5f. unknown method → 0 offset', new HijriCalendar({ method: 'Whatever' })._totalOffset === 0);
  check('5g. getMethods() exposes all 5 authorities', HijriCalendar.getMethods().length === 5
    && HijriCalendar.getMethods().includes('Umm al-Qura'));

  // A non-zero offset changes the reported Hijri day — the mechanism that lets a
  // user reconcile the "end of month differs by city/authority" complaint.
  // (boundary-safe: 2 consecutive Hijri days always have a different date number)
  const d0 = new HijriCalendar({ offset: 0 }).todayInfo().day;
  const d2 = new HijriCalendar({ offset: 2 }).todayInfo().day;
  check('5h. a 2-day method/offset spread changes the reported Hijri day', d0 !== d2);

  // Predicate logic via mocked _h (date-math independent).
  const hc = (month, date) => { const c = new HijriCalendar(); c._h = () => ({ getMonth: () => month, getDate: () => date, getFullYear: () => 1448 }); return c; };
  check('5i. month 9 → isRamadan', hc(9, 15).isRamadan() === true);
  check('5j. Ramadan 27th → Laylah al-Qadr', hc(9, 27).isLaylahAlQadr() === true);
  check('5k. Ramadan 28th → not Laylah', hc(9, 28).isLaylahAlQadr() === false);
  check('5l. Shawwal 1st → Eid al-Fitr', hc(10, 1).isOccasion('eid_al_fitr') === true);
  check('5m. Dhul-Hijjah 10th → Eid al-Adha', hc(12, 10).isOccasion('eid_al_adha') === true);
}

// ============================================================================
section('6. AudioRouter.buildTokens — URL tags the prayer triggers carry');
// ============================================================================
{
  const prefs = {
    fullUrl:    'https://example.com/full.mp3',
    shortUrl:   'https://example.com/short.mp3',
    reciter:    'Abdul Basit',
    surah:      67,
    adhkarMorningUrl: 'https://example.com/adhkar-morning.mp3',
    adhkarEveningUrl: 'https://example.com/adhkar-evening.mp3',
    customUrl:  'https://example.com/custom.mp3',
    customUrl2: 'https://example.com/custom2.mp3',
    customUrl3: 'https://example.com/custom3.mp3',
    volumes:    { Fajr: 0.3, Sunrise: 0.5, Dhuhr: 0.7, Asr: 0.65, Maghrib: 0.8, Isha: 0.4 },
  };

  // Configured URLs are echoed verbatim into the matching tags.
  {
    const env = makeEnv({ settings: { audioPrefs: prefs } });
    const t = env.audioRouter.buildTokens('Dhuhr');
    check('6a. full/short/custom tags echo the configured URLs',
      t.adhan_full === prefs.fullUrl && t.adhan_short === prefs.shortUrl &&
      t.custom === prefs.customUrl && t.custom2 === prefs.customUrl2 && t.custom3 === prefs.customUrl3);
    check('6b. quran tag built from reciter + zero-padded surah', t.quran === 'https://server7.mp3quran.net/basit/067.mp3');
    check('6c. reciter tag carries the configured reciter name', t.reciter === 'Abdul Basit');
  }

  // Adhkar single URL + per-prayer volume tag.
  {
    const env = makeEnv({ settings: { audioPrefs: prefs } });
    check('6d. adhkar_morning/evening tags echo configured URLs',
      env.audioRouter.buildTokens('Fajr').adhkar_morning === prefs.adhkarMorningUrl &&
      env.audioRouter.buildTokens('Asr').adhkar_evening  === prefs.adhkarEveningUrl);
    check('6e. volume tag = configured 0-1 value for each prayer',
      env.audioRouter.buildTokens('Fajr').volume    === 0.3 &&
      env.audioRouter.buildTokens('Sunrise').volume === 0.5 &&
      env.audioRouter.buildTokens('Dhuhr').volume   === 0.7 &&
      env.audioRouter.buildTokens('Isha').volume    === 0.4);
  }

  // Empty prefs → adhan falls back to islamcan defaults; optional tags blank.
  {
    const env = makeEnv({ settings: {} });
    const t = env.audioRouter.buildTokens('Dhuhr');
    check('6f. missing full/short fall back to default adhan',
      t.adhan_full.includes('cdn.aladhan.com') && t.adhan_short.includes('001001.mp3'));
    check('6g. missing adhkar/custom fall back to defaults; volume is null (device default)',
      t.adhkar_morning.includes('archive.org') && t.adhkar_evening.includes('archive.org') &&
      t.custom.includes('assabile.com') && t.custom2 === '' && t.custom3 === '' && t.volume === null);
    check('6h. default reciter → Afasy surah 001', t.quran === 'https://server8.mp3quran.net/afs/001.mp3');
  }

  // Unknown reciter falls back to the default server; surah is clamped 1..114.
  {
    const env = makeEnv({ settings: { audioPrefs: { reciter: 'Nobody', surah: 999 } } });
    const t = env.audioRouter.buildTokens('Isha');
    check('6i. unknown reciter → default Afasy server', t.quran.startsWith('https://server8.mp3quran.net/afs/'));
    check('6j. out-of-range surah clamps to 114', t.quran.endsWith('/114.mp3'));
  }

  // App disabled → every URL tag blanked (global mute), reciter name retained.
  {
    const env = makeEnv({ settings: { advanced: { appEnabled: false }, audioPrefs: prefs } });
    const t = env.audioRouter.buildTokens('Dhuhr');
    check('6k. disabled app blanks all URL tags; volume is null',
      t.adhan_full === '' && t.adhan_short === '' &&
      t.adhkar_morning === '' && t.adhkar_evening === '' &&
      t.quran === '' && t.custom === '' && t.custom2 === '' && t.custom3 === '' && t.volume === null);
  }

  // clearScheduled is a harmless no-op (no timed follow-ups in this model).
  {
    const env = makeEnv({ settings: {} });
    env.audioRouter.clearScheduled();
    check('6l. clearScheduled does not throw and schedules nothing', env.t.timers.pending().length === 0);
  }

  // ── New-feature logic tests ────────────────────────────────────────────────

  // volume edge cases: 0 is valid, out-of-range rejected, per-prayer independence.
  {
    check('6m. volume=0 is a valid override (not falsy)',
      makeEnv({ settings: { audioPrefs: { volumes: { Fajr: 0    } } } }).audioRouter.buildTokens('Fajr').volume === 0);
    check('6n. volume > 1 → null',
      makeEnv({ settings: { audioPrefs: { volumes: { Fajr: 1.5  } } } }).audioRouter.buildTokens('Fajr').volume === null);
    check('6o. volume < 0 → null',
      makeEnv({ settings: { audioPrefs: { volumes: { Fajr: -0.1 } } } }).audioRouter.buildTokens('Fajr').volume === null);
    check('6p. volume set for one prayer does not bleed into others',
      makeEnv({ settings: { audioPrefs: { volumes: { Maghrib: 0.85 } } } }).audioRouter.buildTokens('Fajr').volume === null &&
      makeEnv({ settings: { audioPrefs: { volumes: { Maghrib: 0.85 } } } }).audioRouter.buildTokens('Maghrib').volume === 0.85);
  }

  // custom2/custom3 are independent slots — setting one never populates another.
  {
    const env = makeEnv({ settings: { audioPrefs: { customUrl: 'https://t.com/c.mp3' } } });
    const t = env.audioRouter.buildTokens('Fajr');
    check('6q. custom2/custom3 empty when only custom is set',
      t.custom === 'https://t.com/c.mp3' && t.custom2 === '' && t.custom3 === '');
  }

  // adhkar_morning and adhkar_evening are independent tokens on every prayer.
  {
    const env = makeEnv({ settings: { audioPrefs: {
      adhkarMorningUrl: 'https://t.com/morning.mp3',
      adhkarEveningUrl: 'https://t.com/evening.mp3',
    } } });
    const prayers = ['Fajr','Sunrise','Dhuhr','Asr','Maghrib','Isha'];
    check('6r. adhkar_morning URL consistent across all prayers',
      prayers.every(p => env.audioRouter.buildTokens(p).adhkar_morning === 'https://t.com/morning.mp3'));
    check('6r2. adhkar_evening URL consistent across all prayers',
      prayers.every(p => env.audioRouter.buildTokens(p).adhkar_evening === 'https://t.com/evening.mp3'));
  }

  // URL whitespace handling: blank → empty, padded → trimmed.
  {
    const env = makeEnv({ settings: { audioPrefs: {
      adhkarMorningUrl: '   ',
      adhkarEveningUrl: '   ',
      customUrl2:       '  https://t.com/c2.mp3  ',
    } } });
    const t = env.audioRouter.buildTokens('Dhuhr');
    check('6s. whitespace-only adhkar_morning falls back to default', t.adhkar_morning.includes('archive.org'));
    check('6s2. whitespace-only adhkar_evening falls back to default', t.adhkar_evening.includes('archive.org'));
    check('6t. URL with surrounding whitespace is trimmed', t.custom2 === 'https://t.com/c2.mp3');
  }

  // End-to-end: buildTokens result propagates into prayer_trigger_all at fire time.
  await withFrozenNow(localMidnight() + 60 * 1000, async (clock) => {
    const audioPrefs = {
      fullUrl:    'https://t.com/full.mp3',
      adhkarMorningUrl: 'https://t.com/morning.mp3',
      adhkarEveningUrl: 'https://t.com/evening.mp3',
      customUrl2: 'https://t.com/c2.mp3',
      volumes:    { Dhuhr: 0.65 },
    };
    const env = makeEnv({ settings: { audioPrefs } });
    await env.scheduler.init();
    const occ = findOcc(env.scheduler.lastRun.audio, 'Dhuhr', env.scheduler._dayEpoch(0));
    clock.now = occ.fireAt;
    await env.t.timers.fireById(occ.id);
    const tok = env.t.triggerCards['prayer_trigger_all'].triggerCalls[0]?.tokens || {};
    check('6u. prayer_trigger_all carries adhan_full at fire time',  tok.adhan_full === 'https://t.com/full.mp3');
    check('6v. prayer_trigger_all carries adhkar_morning at fire time', tok.adhkar_morning === 'https://t.com/morning.mp3');
    check('6v2. prayer_trigger_all carries adhkar_evening at fire time', tok.adhkar_evening === 'https://t.com/evening.mp3');
    check('6w. prayer_trigger_all carries custom2 at fire time',     tok.custom2   === 'https://t.com/c2.mp3');
    check('6x. prayer_trigger_all carries volume tag at fire time',  tok.volume    === 0.65);
  });
}

// ============================================================================
section('7. API endpoint logic (what the settings UI calls)');
// ============================================================================
{
  await withFrozenNow(new Date(2026, 5, 20, 12, 0).getTime(), async () => {
    const homey = createMockHomey({ settings: { calculation: { method: 'Dubai' }, location: { useHomeyLoc: true } } });

    const flat = await apiHandlers.previewTimes({ homey, query: {} });
    check('7a. previewTimes (days=1) returns flat object w/ all 6 rows',
      ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].every(k => /^\d{2}:\d{2}$/.test(flat[k])));

    const multi = await apiHandlers.previewTimes({ homey, query: { days: '5' } });
    check('7b. previewTimes (days=5) returns a 5-element array with date labels',
      Array.isArray(multi) && multi.length === 5 && typeof multi[0].date === 'string');

    // Adjustments via ?adj shift the printed time by the offset.
    const baseFajr = (await apiHandlers.previewTimes({ homey, query: {} })).Fajr;
    const adjFajr  = (await apiHandlers.previewTimes({ homey, query: { adj: JSON.stringify({ Fajr: 30 }) } })).Fajr;
    check('7c. previewTimes honors ?adj offset (Fajr +30 changes the value)', baseFajr !== adjFajr);

    // Different method changes the times.
    const homeyEgy = createMockHomey({ settings: { calculation: { method: 'Egyptian' }, location: { useHomeyLoc: true } } });
    const egyFajr = (await apiHandlers.previewTimes({ homey: homeyEgy, query: {} })).Fajr;
    check('7d. switching method (Dubai→Egyptian) changes Fajr', baseFajr !== egyFajr);
  });

  // getStatus surfaces hijri methods + flags.
  {
    const homey = createMockHomey({ settings: { hijriConfig: { method: 'Umm al-Qura', offset: 0 } } });
    homey.app.audioRouter = new AudioRouter(homey);
    const status = await apiHandlers.getStatus({ homey });
    check('7e. getStatus returns hijriMethods list', Array.isArray(status.hijriMethods) && status.hijriMethods.length === 5);
    check('7f. getStatus returns hijriInfo with day/month/year', status.hijriInfo && 'day' in status.hijriInfo && 'month' in status.hijriInfo);
    check('7g. getStatus reports appEnabled true by default', status.appEnabled === true);
  }
}

// ============================================================================
section('8. MERGE-INTEGRITY AUDIT — a FAIL here is a real issue to fix');
// ============================================================================
{
  const composeFlow = path.join(ROOT, '.homeycompose', 'flow');
  const exists = p => fs.existsSync(p);

  // 8a. The obsolete audio_requested trigger must be fully gone (card + registration).
  {
    const cardGone = !exists(path.join(composeFlow, 'triggers', 'audio_requested.json'));
    const appSrc = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
    const arSrc  = fs.readFileSync(path.join(LIB, 'AudioRouter.js'), 'utf8');
    const unreferenced = !appSrc.includes('audio_requested') && !arSrc.includes('audio_requested');
    check('8a. audio_requested trigger removed (folded into prayer triggers)', cardGone && unreferenced,
      'audio_requested still exists as a card or is still referenced — audio tags now live on prayer_trigger_all/specific');
  }

  // 8b. Both prayer triggers must declare the audio URL tags the scheduler attaches.
  {
    const TAGS = ['adhan_full', 'adhan_short', 'adhkar_morning', 'adhkar_evening', 'quran', 'reciter', 'custom', 'custom2', 'custom3', 'volume'];
    const cardHasTags = name => {
      const j = JSON.parse(fs.readFileSync(path.join(composeFlow, 'triggers', name), 'utf8'));
      const names = (j.tokens || []).map(t => t.name);
      return TAGS.every(t => names.includes(t));
    };
    check('8b. prayer_trigger_all + _specific declare all 9 audio tags',
      cardHasTags('prayer_trigger_all.json') && cardHasTags('prayer_trigger_specific.json'),
      'A tag the scheduler passes is not declared on the card → Homey drops it');
  }

  // 8c. prayer_trigger_specific on Sunrise should fire (Sunrise is in the dropdown).
  await withFrozenNow(localMidnight() + 60 * 1000, async (clock) => {
    const env = makeEnv({ settings: {} });
    await env.scheduler.init();
    const cardSpecific = env.t.triggerCards['prayer_trigger_specific'];
    // Fire every audio occurrence today; check whether a Sunrise specific trigger ever fires.
    for (const occ of env.scheduler.lastRun.audio.filter(a => a.dayEpoch === env.scheduler._dayEpoch(0))) {
      clock.now = occ.fireAt;
      await env.t.timers.fireById(occ.id);
    }
    const sunriseFired = cardSpecific.triggerCalls.some(c => c.state?.prayerName === 'Sunrise');
    check('8c. Sunrise is reachable for prayer_trigger_specific', sunriseFired,
      'Sunrise is offered in the dropdown but the audio loop (which fires prayer_trigger_specific) skips Sunrise → never triggers');
  });

  // 8d. AudioRouter must NOT reference the removed speaker-group / volume model.
  {
    const arSrc = fs.readFileSync(path.join(LIB, 'AudioRouter.js'), 'utf8');
    const hasDeadModel = /speakerGroups|_dispatchToGroup|playGroup|stopGroup|_setVolume|_requestPlayback/.test(arSrc);
    check('8d. AudioRouter is free of the old speaker-group/volume model', !hasDeadModel,
      'AudioRouter still references speakerGroups / group playback / volume — the new model is buildTokens()');
  }

  // 8e. settings entry should serve the NEW UI, not redirect to the old settings.html.
  {
    const idx = fs.readFileSync(path.join(ROOT, 'settings', 'index.html'), 'utf8');
    const redirectsToOld = /settings\.html/.test(idx) && /location\.replace/.test(idx);
    check('8e. settings/index.html serves the new UI (no redirect to old settings.html)', !redirectsToOld,
      'settings/index.html still redirects to the old 2023 settings.html; the new 1421-line UI sits unused at settings/settings/index.html');
  }

  // 8f. No obsolete group-based action cards should remain in compose.
  {
    const actionsDir = path.join(composeFlow, 'actions');
    const leftover = fs.existsSync(actionsDir)
      ? fs.readdirSync(actionsDir).filter(f => /athan_action|play_audio_on_group|stop_audio_on_group/.test(f))
      : [];
    check('8f. obsolete group action cards removed from compose', leftover.length === 0,
      'athan_action / play_audio_on_group / stop_audio_on_group still exist — the new model has no group playback actions');
  }
}

// ============================================================================
section('9. prayer_name_is condition — state from prayer_trigger_all (regression)');
// ============================================================================
{
  // prayer_trigger_all must pass { prayerName } as state so the prayer_name_is
  // condition can branch in Any-prayer flows (it reads state.prayerName).
  await withFrozenNow(localMidnight() + 60 * 1000, async (clock) => {
    const env = makeEnv({ settings: {} });
    await env.scheduler.init();
    const occ = findOcc(env.scheduler.lastRun.audio, 'Dhuhr', env.scheduler._dayEpoch(0));
    clock.now = occ.fireAt;
    await env.t.timers.fireById(occ.id);
    const call = env.t.triggerCards['prayer_trigger_all'].triggerCalls[0];
    check('9a. prayer_trigger_all passes state.prayerName (condition can branch)',
      !!call && call.state && call.state.prayerName === 'Dhuhr',
      'prayer_trigger_all fired without state → prayer_name_is can never match in Any-prayer flows');
  });
}

// ============================================================================
section('10. HijriScheduler — flow-usage gating + correct trigger state keys');
// ============================================================================
{
  function makeHijri(settings = {}, argMap = {}) {
    const homey = createMockHomey({ settings });
    const hijri = new HijriScheduler(homey);
    for (const [id, vals] of Object.entries(argMap)) {
      homey.flow.getTriggerCard(id).setArgumentValues(vals);
    }
    return { homey, hijri, t: homey._test };
  }
  const keysOf = h => [...h._timers.keys()];

  await withFrozenNow(new Date(2026, 5, 20, 12, 0).getTime(), async (clock) => {
    // No flows wired → per-day loop arms nothing (the optimization).
    const a = makeHijri({ hijriConfig: {} });
    await a.hijri.init();
    check('10a. no Hijri flows → zero timers armed (gating works)', a.hijri._timers.size === 0);

    // Only hijri_day_of_month=13 wired → only day-13 timers armed.
    const b = makeHijri({ hijriConfig: {} }, { hijri_day_of_month: [{ day: 13 }] });
    await b.hijri.init();
    const bKeys = keysOf(b.hijri);
    check('10b. day_of_month=13 wired → only day-13 timers armed',
      bKeys.length > 0 && bKeys.every(k => k.startsWith('day_of_month@13@')));

    // Fire one day-13 timer → state must carry hijriDay (matches app.js listener).
    const entry = [...b.hijri._timers.values()][0];
    clock.now = entry.fireAt;
    await b.t.timers.fireById(entry.id);
    const call = b.t.triggerCards['hijri_day_of_month'].triggerCalls[0];
    check('10c. hijri_day_of_month fires with state.hijriDay (not bare day)',
      !!call && call.state && call.state.hijriDay === 13);
  });

  // Occasion gating: wire one occasion near its date → only occasion timers armed.
  const ashura = new HijriCalendar({}).nextOccurrence(1, 10);   // Muharram 10
  await withFrozenNow(ashura.getTime() - 5 * 86400000, async () => {
    const c = makeHijri({ hijriConfig: {} }, { islamic_occasion_event: [{ occasion: 'ashura', event: 'starts' }] });
    await c.hijri.init();
    const cKeys = keysOf(c.hijri);
    check('10d. occasion wired → only occasion timers (no day/specific/month leak)',
      cKeys.length > 0 && cKeys.every(k => k.startsWith('occ_')));
  });

  // Finding 2 fix: a single-day occasion fires "starts" and "ends" a full day
  // apart (was: same instant at 00:01 on the anchor day).
  const eid = new HijriCalendar({}).nextOccurrence(12, 10);   // Eid al-Adha (single day)
  await withFrozenNow(eid.getTime() - 3 * 86400000, async () => {
    const d = makeHijri({ hijriConfig: {} }, { islamic_occasion_event: [{ occasion: 'eid_al_adha', event: 'ends' }] });
    await d.hijri.init();
    const entries = [...d.hijri._timers.entries()];
    const starts = entries.find(([k]) => k.startsWith('occ_starts@eid_al_adha'));
    const ends   = entries.find(([k]) => k.startsWith('occ_ends@eid_al_adha'));
    check('10e. single-day occasion arms both starts and ends', !!starts && !!ends);
    check('10f. starts and ends are a full day apart (not the same instant)',
      !!starts && !!ends && (ends[1].fireAt - starts[1].fireAt) > 12 * 3600000,
      starts && ends ? `delta=${Math.round((ends[1].fireAt - starts[1].fireAt) / 3600000)}h` : 'missing timer');
  });
}

// ============================================================================
section('11. API — searchCity guard + widgetData shape');
// ============================================================================
{
  const empty = await apiHandlers.searchCity({ query: {} });
  check('11a. searchCity with empty query returns [] (no network call)',
    Array.isArray(empty) && empty.length === 0);

  await withFrozenNow(new Date(2026, 5, 20, 12, 0).getTime(), async () => {
    const homey = createMockHomey({ settings: { calculation: { method: 'Dubai' }, location: { useHomeyLoc: true } } });
    const w = await apiHandlers.widgetData({ homey });
    check('11b. widgetData returns 6 prayers with time + flags',
      Array.isArray(w.prayers) && w.prayers.length === 6 &&
      w.prayers.every(p => /^\d{2}:\d{2}$/.test(p.time) && 'passed' in p && 'isNext' in p));
    check('11c. widgetData includes hijriDate info', w.hijriDate && 'day' in w.hijriDate);
  });
}

// ============================================================================
section('12. onInit integration — full boot sequence wires & fires end-to-end');
// ============================================================================
{
  // Replays the REAL app.js onInit against the mock so the whole sequence is
  // covered: migrate → instantiate → register run-listeners → scheduler.init →
  // hijri.init → googleMapsKey. Then a prayer time arrives and a flow fires.
  function bootApp(homey) {
    const app = Object.create(App.prototype);
    app.homey = homey;
    app.log   = (...a) => homey._test.logs.push(a.join(' '));
    app.error = (...a) => homey._test.errors.push(a.join(' '));
    app.manifest = { id: 'com.prayerssapp', version: '2.2.1' };
    homey.app = app;
    return app;
  }

  await withFrozenNow(localMidnight() + 60 * 1000, async (clock) => {
    const homey = createMockHomey({
      settings: {
        prayerConfig:   { calculationMethod: 'Egyptian', madhab: 'Hanafi' }, // v1 keys
        locationConfig: { lat: 21.4225, lng: 39.8262, city: 'Makkah' },      // v1 keys
        audioPrefs:     { fullUrl: 'https://t.com/full.mp3', volumes: { Dhuhr: 0.6 } },
      },
      geo: { lat: 21.4225, lng: 39.8262 },
    });
    const app = bootApp(homey);
    homey.flow.getTriggerCard('prayer_trigger_before_after_specific')
      .setArgumentValues([{ prayerAfterBefore: 'After', prayerName: 'Dhuhr', prayerDurationTime: 5, prayerDurationType: 'minutes' }]);

    await app.onInit();   // ── the real boot sequence ──

    const s = app.scheduler, TC = homey._test.triggerCards, SC = homey._test.simpleCards;

    // Migration ran before scheduling, using the migrated values.
    const calc = homey.settings.get('calculation');
    check('12a. v1 settings migrated before first schedule (Egyptian/Hanafi, Makkah)',
      calc.method === 'Egyptian' && calc.madhab === 'Hanafi' &&
      homey.settings.get('location').city === 'Makkah' &&
      homey.settings.get('prayerConfig') === undefined);

    // Prayer events initialized.
    check('12b. 18 audio + 3 before/after timers armed at boot',
      s.lastRun.audio.length === 18 && s.lastRun.flows.length === 3);
    check('12c. heartbeat armed, no boot-cooldown machinery', !!s._heartbeat && s._bootCatchup === undefined);

    // Events wired: all trigger + condition run-listeners registered.
    check('12d. all 9 trigger cards + 2 condition cards have run-listeners',
      ['prayer_trigger_all','prayer_trigger_specific','prayer_trigger_before_after_specific',
       'hijri_month_event','hijri_day_of_month','hijri_specific_date','hijri_date_offset',
       'islamic_occasion_event','islamic_occasion_offset'].every(id => !!TC[id]._runListener) &&
      !!SC['is_islamic_occasion']._runListener && !!SC['prayer_name_is']._runListener);

    check('12e. HijriScheduler initialized (heartbeat armed)', !!app.hijriScheduler._heartbeat);
    check('12f. boot is stable — googleMapsKey set did not arm a reschedule', s._debounce === null);

    // After init: a prayer time arrives → prayer_trigger_all + _specific fire correctly.
    const dhuhr = s.lastRun.audio.find(a => a.prayer === 'Dhuhr' && a.dayEpoch === s._dayEpoch(0));
    clock.now = dhuhr.fireAt;
    await homey._test.timers.fireById(dhuhr.id);
    const callAll = TC['prayer_trigger_all'].triggerCalls.find(c => c.tokens.prayerName === 'Dhuhr');
    check('12g. prayer_trigger_all fired with audio token + state.prayerName',
      !!callAll && callAll.tokens.adhan_full === 'https://t.com/full.mp3' && callAll.state.prayerName === 'Dhuhr');
    check('12h. prayer_trigger_specific fired with state{prayerName}',
      TC['prayer_trigger_specific'].triggerCalls.some(c => c.state.prayerName === 'Dhuhr'));

    // The flow WOULD actually run: evaluate run-listeners the way Homey does.
    check('12i. Dhuhr flow runs, Asr flow does not (run-listener filtering)',
      (await TC['prayer_trigger_specific']._runListener({ prayerName: 'Dhuhr' }, { prayerName: 'Dhuhr' })) === true &&
      (await TC['prayer_trigger_specific']._runListener({ prayerName: 'Asr' },  { prayerName: 'Dhuhr' })) === false);
    check('12j. prayer_name_is condition branches on carried state',
      SC['prayer_name_is']._runListener({ prayerName: 'Dhuhr' }, callAll.state) === true);

    // Before/After offset flow fires with legacy tokens.
    const baOcc = s.lastRun.flows.find(f => f.prayer === 'Dhuhr' && f.dayEpoch === s._dayEpoch(0));
    clock.now = baOcc.fireAt;
    await homey._test.timers.fireById(baOcc.id);
    const baCall = TC['prayer_trigger_before_after_specific'].triggerCalls[0];
    check('12k. before/after offset flow fires at Dhuhr+5min with legacy tokens',
      !!baCall && baCall.tokens.prayerName === 'Dhuhr' &&
      Math.abs(baOcc.fireAt - (dhuhr.fireAt + 5 * 60000)) < 1000);
  });
}

  // ── summary ──────────────────────────────────────────────────────────────────
  console.log(`\n\x1b[1m${'─'.repeat(64)}\x1b[0m`);
  console.log(`\x1b[1mRESULTS:\x1b[0m \x1b[32m${pass} passed\x1b[0m, ` +
    (fail ? `\x1b[31m${fail} failed\x1b[0m` : `\x1b[32m0 failed\x1b[0m`));
  if (fail) { console.log('\x1b[31mFailed:\x1b[0m\n  - ' + failures.join('\n  - ')); process.exitCode = 1; }
}

main().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
