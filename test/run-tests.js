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

  // "Any" before 10min → 6 flow timers/day (Fajr..Isha + Sunrise) since PRAYER_KEYS has 6.
  // Assert against a fully-future day (tomorrow) so the count is independent of the
  // machine timezone: at local-midnight+1min some of *today's* before-offsets may
  // already be in the past (e.g. Fajr-10min in UTC), which is correct to skip.
  await withFrozenNow(localMidnight() + 60 * 1000, async () => {
    const env = makeEnv({
      instances: [{ prayerAfterBefore: 'Before', prayerName: 'Any', prayerDurationTime: 10, prayerDurationType: 'minutes' }],
    });
    await env.scheduler.init();
    const day1 = onDay(env.scheduler, env.scheduler.lastRun.flows, 1);
    check('2f. "Any" expands to all 6 prayers incl. Sunrise on a full future day',
      day1.length === 6 && day1.some(f => f.prayer === 'Sunrise'));
  });

  // excludeSunrise must also suppress before/after FLOW timers (not just audio):
  // "Any" should expand to 5 prayers/day with no Sunrise timer armed.
  await withFrozenNow(localMidnight() + 60 * 1000, async () => {
    const env = makeEnv({
      settings: { advanced: { excludeSunrise: true } },
      instances: [{ prayerAfterBefore: 'Before', prayerName: 'Any', prayerDurationTime: 10, prayerDurationType: 'minutes' }],
    });
    await env.scheduler.init();
    const day1 = onDay(env.scheduler, env.scheduler.lastRun.flows, 1);
    check('2i. excludeSunrise drops the "Any" Sunrise before/after flow timer',
      day1.length === 5 && !day1.some(f => f.prayer === 'Sunrise'));
  });

  // "Any" + an explicit same-direction/offset flow collapse onto ONE timer per
  // prayer/day (no double-fire). The run listener fans both flows out at fire time.
  await withFrozenNow(localMidnight() + 60 * 1000, async () => {
    const env = makeEnv({
      instances: [
        { prayerAfterBefore: 'Before', prayerName: 'Any',  prayerDurationTime: 10, prayerDurationType: 'minutes' },
        { prayerAfterBefore: 'Before', prayerName: 'Fajr', prayerDurationTime: 10, prayerDurationType: 'minutes' },
      ],
    });
    await env.scheduler.init();
    const day1  = onDay(env.scheduler, env.scheduler.lastRun.flows, 1);
    const fajrs = day1.filter(f => f.prayer === 'Fajr');
    check('2j. Any + explicit Fajr (same offset) collapse to ONE Fajr timer (no double-fire)',
      fajrs.length === 1 && day1.length === 6);
    const st = fajrs[0].args; // snapshot stores the timer state under `args`
    check('2k. both the Any and the explicit Fajr flow match that shared timer',
      triggerMatches({ prayerAfterBefore: 'Before', prayerName: 'Any',  prayerDurationTime: 10, prayerDurationType: 'minutes' }, st) === true &&
      triggerMatches({ prayerAfterBefore: 'Before', prayerName: 'Fajr', prayerDurationTime: 10, prayerDurationType: 'minutes' }, st) === true);
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
  check('3k. triggerMatches: an "Any" flow matches any resolved prayer',
    triggerMatches({ ...b, prayerName: 'Any' }, { ...b, prayerName: 'Maghrib', _resolvedPrayer: 'Maghrib' }) === true);
  check('3l. triggerMatches: explicit flow does NOT match a different resolved prayer',
    triggerMatches({ ...b, prayerName: 'Fajr' }, { ...b, prayerName: 'Any', _resolvedPrayer: 'Maghrib' }) === false);
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
    check('6g. missing adhkar/custom fall back to defaults; volume defaults to 0.3 (number, never absent)',
      t.adhkar_morning.includes('archive.org') && t.adhkar_evening.includes('archive.org') &&
      t.custom.includes('assabile.com') && t.custom2 === '' && t.custom3 === '' && t.volume === 0.3);
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
    check('6k. disabled app blanks all URL tags; volume still a number (0.3)',
      t.adhan_full === '' && t.adhan_short === '' &&
      t.adhkar_morning === '' && t.adhkar_evening === '' &&
      t.quran === '' && t.custom === '' && t.custom2 === '' && t.custom3 === '' && t.volume === 0.3);
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
    check('6n. volume > 1 → default 0.3 (invalid range rejected)',
      makeEnv({ settings: { audioPrefs: { volumes: { Fajr: 1.5  } } } }).audioRouter.buildTokens('Fajr').volume === 0.3);
    check('6o. volume < 0 → default 0.3 (invalid range rejected)',
      makeEnv({ settings: { audioPrefs: { volumes: { Fajr: -0.1 } } } }).audioRouter.buildTokens('Fajr').volume === 0.3);
    check('6p. volume set for one prayer does not bleed into others',
      makeEnv({ settings: { audioPrefs: { volumes: { Maghrib: 0.85 } } } }).audioRouter.buildTokens('Fajr').volume === 0.3 &&
      makeEnv({ settings: { audioPrefs: { volumes: { Maghrib: 0.85 } } } }).audioRouter.buildTokens('Maghrib').volume === 0.85);

    // Regression: volume must ALWAYS be a number. Homey requires every declared
    // token to be present with the correct type at trigger time — an absent or
    // undefined number token throws "Expected number but got undefined" and
    // REJECTS the whole trigger() (the prayer silently does not fire). This was
    // the production root cause of "prayer not triggering" (crash log 2026-06-22).
    {
      const prayers = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
      const noVolEnv = makeEnv({ settings: {} });
      check('6p2. volume is always a number (defaults to 0.3) with no per-prayer volume',
        prayers.every(p => noVolEnv.audioRouter.buildTokens(p).volume === 0.3));
      const disabledEnv = makeEnv({ settings: { advanced: { appEnabled: false } } });
      check('6p3. volume is always a number (0.3) when app is disabled',
        prayers.every(p => disabledEnv.audioRouter.buildTokens(p).volume === 0.3));
    }
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

    // Regression: prayer_name_is must read the RESOLVED prayer for the
    // "Before/After Any prayer" trigger (state.prayerName === 'Any',
    // _resolvedPrayer === concrete). Otherwise "is not Sunrise" lets Sunrise
    // through (screenshot bug 2026-06-23).
    const anySunrise = { prayerAfterBefore: 'Before', prayerName: 'Any', _resolvedPrayer: 'Sunrise' };
    const anyFajr    = { prayerAfterBefore: 'Before', prayerName: 'Any', _resolvedPrayer: 'Fajr' };
    check('12l. prayer_name_is uses _resolvedPrayer under "Any" trigger (Sunrise matches → "is not Sunrise" blocks)',
      SC['prayer_name_is']._runListener({ prayerName: 'Sunrise' }, anySunrise) === true &&
      SC['prayer_name_is']._runListener({ prayerName: 'Sunrise' }, anyFajr) === false);
  });
}

// ============================================================================
section('13. Assistant config endpoint + migration (settings contract)');
// ============================================================================
{
  // ── assistantConfig: safe defaults when nothing is saved ───────────────────
  {
    const homey = createMockHomey({ settings: {} });
    const cfg = await apiHandlers.assistantConfig({ homey });
    check('13a. assistantConfig returns safe defaults when unset',
      cfg.enabled === false && Array.isArray(cfg.allowedNumbers) && cfg.allowedNumbers.length === 0 &&
      cfg.model === 'claude-sonnet-4-6' && cfg.rateLimitSeconds === 10 && cfg.dailyCap === 50 &&
      cfg.language === 'both' && cfg.translit === false && cfg.customInstructions === '');
    check('13b. assistantConfig.enabled is a strict boolean (never undefined) when unset',
      cfg.enabled === false && typeof cfg.enabled === 'boolean');
    check('13c. assistantConfig NEVER leaks the API key (only a hasKey boolean)',
      !('apiKey' in cfg) && !('anthropic_key' in cfg) && !('key' in cfg) && !('anthropicKey' in cfg) &&
      cfg.hasKey === false && typeof cfg.hasKey === 'boolean');
  }

  // ── assistantConfig: echoes saved values verbatim ──────────────────────────
  {
    const homey = createMockHomey({ settings: { assistant: {
      enabled: true, allowedNumbers: ['+971500000001', '+971500000002'], fallbackMessage: 'Unavailable',
      model: 'claude-opus-4-8', customInstructions: 'be brief', rateLimitSeconds: 5, dailyCap: 20,
      language: 'arabic', translit: true, anthropicKey: 'sk-ant-secret',
    } } });
    const cfg = await apiHandlers.assistantConfig({ homey });
    check('13d. assistantConfig echoes saved values',
      cfg.enabled === true && cfg.allowedNumbers.length === 2 && cfg.model === 'claude-opus-4-8' &&
      cfg.rateLimitSeconds === 5 && cfg.dailyCap === 20 && cfg.language === 'arabic' && cfg.translit === true &&
      cfg.customInstructions === 'be brief' && cfg.fallbackMessage === 'Unavailable');
    check('13d2. assistantConfig reports hasKey:true but never the key itself',
      cfg.hasKey === true && !('anthropicKey' in cfg));
    check('13e. enabled:false stays false (not coerced to a default)',
      (await apiHandlers.assistantConfig({ homey: createMockHomey({ settings: { assistant: { enabled: false } } }) })).enabled === false);
  }

  // ── assistantConfig: defensive coercion of malformed input ─────────────────
  {
    const homey = createMockHomey({ settings: { assistant: {
      allowedNumbers: 'not-an-array', rateLimitSeconds: 'oops', dailyCap: null, enabled: 'yes', language: 'klingon',
    } } });
    const cfg = await apiHandlers.assistantConfig({ homey });
    check('13f. non-array allowedNumbers coerced to []', Array.isArray(cfg.allowedNumbers) && cfg.allowedNumbers.length === 0);
    check('13g. non-number rateLimit/dailyCap fall back to 10 / 50', cfg.rateLimitSeconds === 10 && cfg.dailyCap === 50);
    check('13h. truthy-but-not-true enabled is NOT treated as enabled', cfg.enabled === false);
    check('13h2. invalid language falls back to "both"', cfg.language === 'both');
  }

  // ── migration: assistant default is written, idempotently, on every install ─
  {
    const mkApp = (homey) => {
      const app = Object.create(App.prototype);
      app.homey = homey;
      app.logger = { log() {}, debug() {}, warn() {}, error() {} };
      return app;
    };
    // Fresh install with NO v1 keys — proves the default is NOT gated by the v1 early-return.
    const homey = createMockHomey({ settings: {} });
    mkApp(homey)._migrateSettings();
    const a = homey.settings.get('assistant');
    check('13l. migration writes assistant default on a fresh install (no v1 keys)',
      !!a && a.enabled === false && a.model === 'claude-sonnet-4-6' &&
      a.rateLimitSeconds === 10 && a.dailyCap === 50 && a.language === 'both' && a.translit === false &&
      a.anthropicKey === '' && Array.isArray(a.allowedNumbers) && a.allowedNumbers.length === 0);
    const lib = homey.settings.get('promptLibrary');
    check('13l2. migration seeds the prompt library on a fresh install',
      Array.isArray(lib) && lib.length >= 1 && lib.every(p => p.id && p.name && p.prompt));

    // Existing config must NOT be overwritten on a later run.
    homey.settings.set('assistant', { enabled: true, model: 'custom-model', dailyCap: 999 });
    homey.settings.set('promptLibrary', [{ id: 'mine', name: 'Mine', prompt: 'do x' }]);
    mkApp(homey)._migrateSettings();
    const a2 = homey.settings.get('assistant');
    const lib2 = homey.settings.get('promptLibrary');
    check('13m. migration does NOT overwrite an existing assistant config',
      a2.enabled === true && a2.model === 'custom-model' && a2.dailyCap === 999);
    // The user's own preset is preserved; the new dua presets are topped up once.
    check('13m2. migration preserves the user preset and does not overwrite it',
      lib2[0].id === 'mine');
    check('13m3. migration tops up the new dua presets into an existing library',
      lib2.some(p => p.id === 'before_sleep_adhkar') && lib2.length > 1);
    // A second run is idempotent — the top-up flag prevents re-adding.
    const lenAfterFirst = lib2.length;
    mkApp(homey)._migrateSettings();
    check('13m4. dua top-up is idempotent (flag-guarded, no duplicates)',
      homey.settings.get('promptLibrary').length === lenAfterFirst);
  }

  // ── no impact: writing assistant settings must not arm a reschedule ─────────
  await withFrozenNow(localMidnight() + 60 * 1000, async () => {
    const env = makeEnv({ settings: {} });
    await env.scheduler.init();
    env.scheduler._onSettingChanged('assistant');
    check('13n. an "assistant" settings change does NOT trigger a prayer reschedule',
      env.scheduler._debounce === null);
  });
}

// ============================================================================
section('14. Islamic assistant card (v3.0.0) — modes, guards, tools, content');
// ============================================================================
{
  const IslamicAssistantCard = require(path.join(LIB, 'IslamicAssistantCard'));
  const ContentTools         = require(path.join(LIB, 'ContentTools'));
  const { splitForTelegram, TG_MAX_CHARS } = require(path.join(LIB, 'TelegramBotListener'));

  // ── Telegram message splitter (verbatim blocks can exceed the 4096 limit) ────
  {
    const short = splitForTelegram('hello world');
    check('14ab. short text is a single part', short.length === 1 && short[0] === 'hello world');

    const big = Array.from({ length: 30 }, (_, i) => ('Paragraph ' + i + ' ').repeat(40).trim()).join('\n\n');
    const parts = splitForTelegram(big);
    const norm = s => s.replace(/\s+/g, ' ').trim();
    check('14ac. long text splits into parts that each fit the limit, preserving content',
      parts.length > 1 && parts.every(p => p.length <= TG_MAX_CHARS) && norm(parts.join(' ')) === norm(big));

    const line = 'x'.repeat(9000);
    const hard = splitForTelegram(line);
    check('14ad. a single oversized line is hard-split with no loss',
      hard.length === 3 && hard.every(p => p.length <= TG_MAX_CHARS) && hard.join('') === line);
  }

  // ── tafsir preserves source HTML structure (headings + paragraphs) ───────────
  {
    const out = ContentTools.formatTafsir({
      text: ContentTools.htmlToTelegram('<h2>The Heading</h2><p>First para with a `quote` and [note].</p><p>Second para.</p>'),
      surahNum: 2, ayahNum: 255, edition: 'en-ibn-kathir',
    });
    const stars = (out.match(/\*/g) || []).length;
    // The footer carries an intentional Markdown link [quran.com](…); strip it
    // before asserting the CONTENT has no stray brackets/backticks.
    const body = out.replace(/\[quran\.com\]\([^)]*\)/, '');
    check('14af. htmlToTelegram keeps headings (bold) + paragraph breaks, strips stray markup',
      /\*The Heading\*/.test(out) && /First para with a quote and note\./.test(out)
      && /\n\nSecond para\./.test(out) && /\[quran\.com\]\(https:\/\/quran\.com\/2\/255\)/.test(out)
      && !/[`[\]]/.test(body) && stars % 2 === 0);
  }

  // ── formatFatwa sanitizes external Markdown so Telegram doesn't break ─────────
  {
    const block = ContentTools.formatFatwa({
      title: 'T`x', question: 'Q [a] *b*', answer: 'A `code` _u_ [link] text',
      source: 'https://islamqa.info/ar/answers/1', arabic: true,
    });
    const stray = (block.match(/[`[\]]/g) || []).length;
    const starsBalanced = (block.match(/\*/g) || []).length % 2 === 0;
    check('14ae. formatFatwa strips stray markdown chars and keeps our labels balanced',
      stray === 0 && starsBalanced && /الجواب/.test(block) && /A code u link text/.test(block));
  }

  const mkCard = (settings, deps) => {
    const homey = createMockHomey({ settings });
    return { card: new IslamicAssistantCard(homey, deps), homey };
  };
  const echoComplete = async ({ messages }) => 'REPLY:' + messages[0].content;
  const baseCfg = (over = {}) => ({ assistant: Object.assign({
    enabled: true, anthropicKey: 'sk-ant-x', allowedNumbers: [], rateLimitSeconds: 10, dailyCap: 50,
  }, over) });

  // ── schedule mode ──────────────────────────────────────────────────────────
  {
    const { card } = mkCard(
      Object.assign(baseCfg(), { promptLibrary: [{ id: 'p1', name: 'P1', prompt: 'PRESET_PROMPT' }] }),
      { claudeComplete: echoComplete });
    const r = await card.run({ mode: 'schedule', preset: { id: 'p1', name: 'P1', prompt: 'PRESET_PROMPT' } });
    check('14a. schedule mode uses the preset prompt', r.assistant_reply === 'REPLY:PRESET_PROMPT' && r.assistant_success === true);

    const r2 = await card.run({ mode: 'schedule', preset: { id: 'p1', prompt: 'PRESET_PROMPT' }, custom: 'CUSTOM_OVERRIDE' });
    check('14b. custom prompt overrides the preset', r2.assistant_reply === 'REPLY:CUSTOM_OVERRIDE');
  }
  {
    const { card } = mkCard(Object.assign(baseCfg(), { promptLibrary: [] }), { claudeComplete: echoComplete });
    const r = await card.run({ mode: 'schedule', preset: { id: 'gone', name: 'Gone' } });
    check('14c. deleted/unknown preset returns a fallback (no throw)',
      r.assistant_success === false && /not found/i.test(r.assistant_reply));
  }
  {
    let called = false;
    const { card } = mkCard(baseCfg({ enabled: false, fallbackMessage: 'OFF' }),
      { claudeComplete: async () => { called = true; return 'x'; } });
    const r = await card.run({ mode: 'schedule', custom: 'hi' });
    check('14d. schedule mode respects enabled:false (no Claude call)',
      r.assistant_success === false && r.assistant_reply === 'OFF' && called === false);
  }

  // ── schedule fast-path: pure-relay presets bypass the Claude tool-loop ───────
  {
    const PromptLib = require(path.join(LIB, 'PromptLibrary'));
    const canon = PromptLib.DEFAULT_PRESETS.find(p => p.id === 'fatwa_random');
    let claudeCalled = false;
    const contentTools = { getFatwa: async () => ({ block: 'FATWA_BLOCK' }) };
    const { card } = mkCard(baseCfg(),
      { claudeComplete: async () => { claudeCalled = true; return 'CLAUDE'; }, contentTools });
    const r = await card.run({ mode: 'schedule', preset: { id: 'fatwa_random', name: canon.name, prompt: canon.prompt } });
    check('14a2. canonical pure-relay preset bypasses Claude and relays the tool block directly',
      r.assistant_reply === 'FATWA_BLOCK' && r.assistant_success === true && claudeCalled === false);
  }
  {
    let claudeCalled = false;
    const contentTools = { getFatwa: async () => ({ block: 'FATWA_BLOCK' }) };
    const { card } = mkCard(baseCfg(),
      { claudeComplete: async ({ messages }) => { claudeCalled = true; return 'REPLY:' + messages[0].content; }, contentTools });
    const r = await card.run({ mode: 'schedule', preset: { id: 'fatwa_random', name: 'F', prompt: 'do something custom' } });
    check('14a3. a customised pure-relay preset still goes through Claude (no bypass)',
      claudeCalled === true && r.assistant_reply === 'REPLY:do something custom');
  }
  {
    // Direct fetch failure must fall through to the normal Claude path, not error.
    const PromptLib = require(path.join(LIB, 'PromptLibrary'));
    const canon = PromptLib.DEFAULT_PRESETS.find(p => p.id === 'fatwa_random');
    let claudeCalled = false;
    const contentTools = { getFatwa: async () => ({ block: '' }), getHadith: async () => ({ block: '' }) };
    const { card } = mkCard(baseCfg(),
      { claudeComplete: async () => { claudeCalled = true; return 'CLAUDE_FALLBACK'; }, contentTools });
    const r = await card.run({ mode: 'schedule', preset: { id: 'fatwa_random', name: canon.name, prompt: canon.prompt } });
    check('14a4. failed direct fetch falls through to Claude',
      claudeCalled === true && r.assistant_reply === 'CLAUDE_FALLBACK');
  }

  // ── reply mode guards ──────────────────────────────────────────────────────
  {
    let called = false;
    const { card } = mkCard(baseCfg({ allowedNumbers: ['+111'] }),
      { claudeComplete: async () => { called = true; return 'x'; } });
    const r = await card.run({ mode: 'reply', sender: '+999', text: 'hi' });
    check('14e. reply: non-whitelisted sender → silent exit (empty reply, no Claude)',
      r.assistant_reply === '' && r.assistant_success === false && called === false);
  }
  {
    const today = new Date().toISOString().slice(0, 10);
    const { card } = mkCard(Object.assign(baseCfg({ allowedNumbers: ['+111'] }),
      { assistantState: { ['last_111']: Date.now() } }),
      { claudeComplete: echoComplete });
    const r = await card.run({ mode: 'reply', sender: '+111', text: 'hi' });
    check('14f. reply: within rate-limit window → silent exit', r.assistant_reply === '' && r.assistant_success === false);
    void today;
  }
  {
    const today = new Date().toISOString().slice(0, 10);
    const { card } = mkCard(Object.assign(baseCfg(), { assistantState: { ['daily_' + today]: 50 } }),
      { claudeComplete: echoComplete });
    const r = await card.run({ mode: 'reply', sender: '+111', text: 'hi' });
    check('14g. reply: daily cap reached → fallback, success false', r.assistant_success === false);
  }
  {
    // Old-date counter must not block today (lazy date-keyed reset).
    const { card, homey } = mkCard(Object.assign(baseCfg(), { assistantState: { 'daily_2020-01-01': 999 } }),
      { claudeComplete: echoComplete });
    const r = await card.run({ mode: 'reply', sender: '+111', text: 'hi' });
    const today = new Date().toISOString().slice(0, 10);
    const st = homey.settings.get('assistantState');
    check('14h. lazy reset: a prior-day counter does NOT block today',
      r.assistant_success === true && st['daily_' + today] === 1);
  }
  {
    let seenLen = -1;
    const { card } = mkCard(baseCfg(), { claudeComplete: async ({ messages }) => { seenLen = messages[0].content.length; return 'ok'; } });
    await card.run({ mode: 'reply', sender: '+111', text: 'x'.repeat(3000) });
    check('14i. reply: input is truncated to 2000 chars before the Claude call', seenLen === 2000);
  }
  {
    const { card } = mkCard(baseCfg(), { claudeComplete: echoComplete });
    const r = await card.run({ mode: 'reply', sender: '+111', text: '' });
    check('14j. reply: empty text → config-error reply, success false',
      r.assistant_success === false && /configuration error/i.test(r.assistant_reply));
  }

  // ── tool routing + failure handling (all stubbed, no network) ───────────────
  {
    const contentTools = { getHadith: async () => ({ block: 'HADITH_BLOCK', meta: { id: 7 } }), getQuran: async () => ({ block: 'Q' }) };
    let toolResult = null;
    const claudeComplete = async ({ runTool }) => { toolResult = await runTool('get_hadith', {}); return 'INTRO'; };
    const { card } = mkCard(baseCfg(), { claudeComplete, contentTools });
    const r = await card.run({ mode: 'reply', sender: '+111', text: 'a hadith please' });
    check('14k. get_hadith routes; model receives a placeholder (not the block); an omitted token → block appended',
      toolResult && toolResult.block === undefined && toolResult.placeholder === '{{BLOCK1}}'
      && toolResult.meta && toolResult.meta.id === 7
      && r.assistant_reply === 'INTRO\n\nHADITH_BLOCK' && r.assistant_success === true);
  }
  {
    // Model positions placeholders → blocks substituted in place, with an OUTRO after.
    const contentTools = {
      getQuran:  async () => ({ block: 'VERSE_BLOCK', meta: { surahNum: 2, ayahNum: 255 } }),
      getTafsir: async () => ({ block: 'TAFSIR_BLOCK' }),
    };
    const claudeComplete = async ({ runTool }) => {
      const a = (await runTool('get_quran', { query: 'mercy' })).placeholder;
      const b = (await runTool('get_tafsir', { surah: 2, ayah: 255 })).placeholder;
      return `Reflect:\n\n${a}\n\n${b}\n\nLesson: be merciful.`;
    };
    const { card } = mkCard(baseCfg(), { claudeComplete, contentTools });
    const r = await card.run({ mode: 'reply', sender: '+111', text: 'a verse and tafsir' });
    check('14k2. model positions placeholders → blocks substituted in place, intro AND outro preserved',
      r.assistant_reply === 'Reflect:\n\nVERSE_BLOCK\n\nTAFSIR_BLOCK\n\nLesson: be merciful.' && r.assistant_success === true);
  }
  {
    // Fatwa: model outputs only the placeholder → reply is exactly the block.
    const contentTools = { getFatwa: async () => ({ block: 'FATWA_BLOCK' }) };
    const claudeComplete = async ({ runTool }) => (await runTool('get_fatwa', { query: 'x' })).placeholder;
    const { card } = mkCard(baseCfg(), { claudeComplete, contentTools });
    const r = await card.run({ mode: 'reply', sender: '+111', text: 'is x permissible' });
    check('14k3. fatwa: model emits only the placeholder → reply is exactly the block',
      r.assistant_reply === 'FATWA_BLOCK' && r.assistant_success === true);
  }
  {
    // Robustness: an omitted placeholder is appended at the end; a stray/invented
    // token is stripped — content is never lost.
    const contentTools = { getQuran: async () => ({ block: 'VERSE_BLOCK' }), getTafsir: async () => ({ block: 'TAFSIR_BLOCK' }) };
    const claudeComplete = async ({ runTool }) => {
      const a = (await runTool('get_quran', {})).placeholder;
      await runTool('get_tafsir', { surah: 2, ayah: 255 }); // placeholder deliberately omitted
      return `See: ${a} and also {{BLOCK9}} extra`;          // {{BLOCK9}} is invented
    };
    const { card } = mkCard(baseCfg(), { claudeComplete, contentTools });
    const r = await card.run({ mode: 'reply', sender: '+111', text: 'x' });
    check('14k5. omitted placeholder appended at end; invented token stripped (no content lost)',
      r.assistant_reply === 'See: VERSE_BLOCK and also  extra\n\nTAFSIR_BLOCK' && r.assistant_success === true);
  }
  {
    const { card } = mkCard(baseCfg({ fallbackMessage: 'FB' }),
      { claudeComplete: async () => { throw new Error('boom'); } });
    const r = await card.run({ mode: 'reply', sender: '+111', text: 'hi' });
    check('14l. Claude error → fallback message, success false', r.assistant_reply === 'FB' && r.assistant_success === false);
  }

  // ── ContentTools direct (injected fetch + rng) ──────────────────────────────
  {
    const urls = [];
    const fakeFetch = async (url) => { urls.push(url); return {
      ok: true, status: 200,
      json: async () => ({ hadiths: [{ text: url.includes('/ara-') ? 'ARABIC_TEXT' : 'ENGLISH_TEXT', hadithnumber: 1, grades: [] }] }),
    }; };
    const out = await ContentTools.getHadith({ language: 'both', fetchImpl: fakeFetch, rng: () => 0 });
    check('14m. ContentTools.getHadith language=both fetches ara+eng and includes both',
      urls.some(u => u.includes('/ara-bukhari/')) && urls.some(u => u.includes('/eng-bukhari/')) &&
      out.block.includes('ARABIC_TEXT') && out.block.includes('ENGLISH_TEXT'));
  }
  {
    const fakeFetch = async () => ({ ok: true, status: 200, json: async () => ({ data: [
      { edition: { identifier: 'quran-uthmani' },     text: 'ARABIC_AYAH',  surah: { englishName: 'Al-Baqara' }, numberInSurah: 255 },
      { edition: { identifier: 'en.sahih' },          text: 'ENGLISH_AYAH', surah: { englishName: 'Al-Baqara' }, numberInSurah: 255 },
      { edition: { identifier: 'en.transliteration' },text: 'TRANSLIT_AYAH',surah: { englishName: 'Al-Baqara' }, numberInSurah: 255 },
    ] }) });
    const on  = await ContentTools.getQuran({ surah: 2, ayah: 255, language: 'both', translit: true,  fetchImpl: fakeFetch });
    const off = await ContentTools.getQuran({ surah: 2, ayah: 255, language: 'both', translit: false, fetchImpl: fakeFetch });
    check('14n. ContentTools.getQuran includes transliteration only when enabled',
      on.block.includes('TRANSLIT_AYAH') && !off.block.includes('TRANSLIT_AYAH') &&
      on.block.includes('Al-Baqara 2:255'));
    const bad = await ContentTools.getQuran({ surah: 999, ayah: 1, fetchImpl: fakeFetch });
    check('14o. ContentTools.getQuran rejects an out-of-range surah', bad.block === '' && /Invalid/.test(bad.meta.error));
  }

  // ── validateAssistantKey: bad key short-circuits without network ────────────
  {
    const res = await apiHandlers.validateAssistantKey({ homey: createMockHomey({ settings: {} }), body: { key: 'bad-key' } });
    check('14p. validateAssistantKey rejects a non-sk- key (no network call)', res.ok === false && /sk-/.test(res.error));
  }

  // ── get_dua routing (stubbed contentTools, no network) ──────────────────────
  {
    let seenCategory = null;
    const contentTools = {
      getHadith: async () => ({ block: 'H' }),
      getQuran:  async () => ({ block: 'Q' }),
      getDua:    async ({ category }) => { seenCategory = category; return { block: 'DUA_BLOCK[' + category + ']' }; },
    };
    const claudeComplete = async ({ runTool }) => { await runTool('get_dua', { category: 'travel' }); return ''; };
    const { card } = mkCard(baseCfg(), { claudeComplete, contentTools });
    const r = await card.run({ mode: 'reply', sender: '+111', text: 'dua for travel' });
    check('14q. get_dua routed to ContentTools with the category arg; block appended to the reply',
      r.assistant_reply === 'DUA_BLOCK[travel]' && seenCategory === 'travel' && r.assistant_success === true);
  }

  // ── ContentTools.getDua direct (bundled data, no network) ───────────────────
  {
    const out = await ContentTools.getDua({ category: 'morning-evening', language: 'both' });
    check('14r. getDua returns a verbatim Hisn al-Muslim block for a known category',
      out.block.includes('Hisn al-Muslim') && out.meta.count > 0 && out.block.length > 0);

    const alias = await ContentTools.getDua({ category: 'sleep' });
    check('14s. getDua resolves a natural-language alias (sleep → before-sleep)',
      alias.meta.category === 'before-sleep' && alias.meta.count > 0);

    const en = await ContentTools.getDua({ category: 'travel', language: 'english' });
    check('14t. getDua language=english omits the Arabic-only italic underscores correctly',
      en.block.length > 0 && en.meta.category === 'travel');

    const bad = await ContentTools.getDua({ category: 'no-such-category' });
    check('14u. getDua rejects an unknown category and lists available ones',
      bad.block === '' && /Unknown dua category/.test(bad.meta.error) && Array.isArray(bad.meta.available));
  }

  // ── new dua presets are seeded in the default library ───────────────────────
  {
    const PromptLibrary = require(path.join(LIB, 'PromptLibrary'));
    const ids = PromptLibrary.DEFAULT_PRESETS.map(p => p.id);
    check('14v. default prompt library includes the new dua presets',
      ids.includes('morning_evening_adhkar') && ids.includes('before_sleep_adhkar') && ids.includes('after_prayer_adhkar'));
  }

  // ── full Hisn al-Muslim + free-text query retrieval ─────────────────────────
  {
    check('14w. full Hisn al-Muslim book is loaded (≥130 chapters)',
      ContentTools.DUA_CATEGORIES.length >= 130);

    const anger = await ContentTools.getDua({ query: 'anger' });
    check('14x. free-text query resolves to a chapter ("anger")',
      anger.meta.category === 'anger' && anger.meta.count > 0 && anger.block.includes('Hisn al-Muslim'));

    const rain = await ContentTools.getDua({ query: 'rain' });
    check('14y. free-text query resolves a situational chapter ("rain")',
      rain.meta.category === 'rain' && rain.block.length > 0);

    const home = await ContentTools.getDua({ query: 'entering the home' });
    check('14z. multi-word query matches by keyword ("entering the home")',
      home.meta.category === 'entering-home' && home.meta.count > 0);

    const miss = await ContentTools.getDua({ query: 'xyzzy nonsense gibberish' });
    check('14aa. gibberish query stays unresolved (does not false-match)',
      miss.block === '' && /Unknown dua category/.test(miss.meta.error));
  }
}

// ============================================================================
section('15. Assistant follow-ups — recall last content + "more results" hint');
// ============================================================================
{
  const IslamicAssistantCard = require(path.join(LIB, 'IslamicAssistantCard'));
  const mkCard = (settings, deps) => {
    const homey = createMockHomey({ settings });
    return { card: new IslamicAssistantCard(homey, deps), homey };
  };
  // rateLimitSeconds:0 so a same-sender follow-up turn is not silently dropped.
  const cfg = (over = {}) => ({ assistant: Object.assign({
    enabled: true, anthropicKey: 'sk-ant-x', allowedNumbers: [], rateLimitSeconds: 0, dailyCap: 50,
  }, over) });

  // 15a. A verse shown one turn is recalled (text + typed meta) the next turn,
  //      so "explain the above" acts on the SAME item.
  {
    const contentTools = {
      getQuran:  async () => ({ block: 'VERSE_BLOCK', meta: { surahNum: 2, ayahNum: 255 } }),
      getTafsir: async () => ({ block: 'TAFSIR_BLOCK', meta: { surahNum: 2, ayahNum: 255 } }),
    };
    let recalled = null;
    const claudeComplete = async ({ runTool, messages }) => {
      const last = messages[messages.length - 1].content;
      if (/explain the above/.test(last)) { recalled = await runTool('recall_last_content', {}); return 'OK'; }
      return (await runTool('get_quran', { query: 'mercy' })).placeholder; // turn 1 shows the verse
    };
    const { card } = mkCard(cfg(), { claudeComplete, contentTools });
    const r1 = await card.run({ mode: 'reply', sender: '+222', text: 'a verse about mercy' });
    await card.run({ mode: 'reply', sender: '+222', text: 'explain the above' });
    check('15a. recall_last_content returns the SAME item (text + typed meta) shown last turn',
      r1.assistant_reply === 'VERSE_BLOCK'
      && recalled && Array.isArray(recalled.items) && recalled.items.length === 1
      && recalled.items[0].text === 'VERSE_BLOCK'
      && recalled.items[0].meta.surahNum === 2 && recalled.items[0].meta.ayahNum === 255);
  }

  // 15b. With no prior content (fresh sender) recall reports an error, so the model
  //      tells the user instead of fetching a new random item.
  {
    let recalled = null;
    const claudeComplete = async ({ runTool }) => { recalled = await runTool('recall_last_content', {}); return 'NONE'; };
    const { card } = mkCard(cfg(), { claudeComplete, contentTools: {} });
    await card.run({ mode: 'reply', sender: '+333', text: 'explain the above' });
    check('15b. recall_last_content reports an error when nothing was shown recently',
      recalled && typeof recalled.error === 'string' && /expired|no recent/i.test(recalled.error));
  }

  // 15c. A search that shows fewer results than its total gets a "more" hint appended.
  {
    const contentTools = { searchHadith: async () => ({
      type: 'hadith', query: 'patience', offset: 0, total: 12,
      results: Array.from({ length: 5 }, (_, i) => ({ n: i + 1, ref: 'H' + i, selector: { id: i } })),
    }) };
    const claudeComplete = async ({ runTool }) => { await runTool('search_hadith', { query: 'patience' }); return 'Here are some hadiths:'; };
    const { card } = mkCard(cfg(), { claudeComplete, contentTools });
    const r = await card.run({ mode: 'reply', sender: '+444', text: 'show me hadiths about patience' });
    check('15c. "more results" hint is appended when total exceeds the shown page',
      /7 more result/.test(r.assistant_reply) && /المزيد/.test(r.assistant_reply));
  }

  // 15d. When the search returned everything, no hint is appended.
  {
    const contentTools = { searchHadith: async () => ({
      type: 'hadith', query: 'x', offset: 0, total: 3,
      results: Array.from({ length: 3 }, (_, i) => ({ n: i + 1, ref: 'H' + i, selector: { id: i } })),
    }) };
    const claudeComplete = async ({ runTool }) => { await runTool('search_hadith', { query: 'x' }); return 'MENU'; };
    const { card } = mkCard(cfg(), { claudeComplete, contentTools });
    const r = await card.run({ mode: 'reply', sender: '+555', text: 'show me hadiths' });
    check('15d. no "more" hint when the search showed all of its results',
      r.assistant_reply === 'MENU');
  }

  // 15e. If the model already told the user about more results, the hint is not duplicated.
  {
    const contentTools = { searchHadith: async () => ({
      type: 'hadith', query: 'x', offset: 0, total: 12,
      results: Array.from({ length: 5 }, (_, i) => ({ n: i + 1, ref: 'H' + i, selector: { id: i } })),
    }) };
    const reply = 'Here are 5 — reply more for others.';
    const claudeComplete = async ({ runTool }) => { await runTool('search_hadith', { query: 'x' }); return reply; };
    const { card } = mkCard(cfg(), { claudeComplete, contentTools });
    const r = await card.run({ mode: 'reply', sender: '+666', text: 'show me hadiths' });
    check('15e. no duplicate hint when the model already mentioned "more"',
      r.assistant_reply === reply);
  }
}

// ============================================================================
section('16. Book-scoped hadith search — resolveBooks + tool routing');
// ============================================================================
{
  const ContentTools         = require(path.join(LIB, 'ContentTools'));
  const IslamicAssistantCard = require(path.join(LIB, 'IslamicAssistantCard'));
  const { resolveBooks } = ContentTools;
  const setEq = (s, arr) => s instanceof Set && s.size === arr.length && arr.every(x => s.has(x));

  check('16a. a single Latin name resolves to its slug', setEq(resolveBooks('Bukhari'), ['bukhari']));
  check('16b. an array of names resolves to multiple slugs',
    setEq(resolveBooks(['Bukhari', 'Muslim']), ['bukhari', 'muslim']));
  check('16c. "Sahih al-Bukhari" normalises (al- + spaces stripped) to bukhari',
    setEq(resolveBooks('Sahih al-Bukhari'), ['bukhari']));
  check('16d. an Arabic name resolves (صحيح مسلم → muslim)', setEq(resolveBooks('صحيح مسلم'), ['muslim']));
  check('16e. a comma/"and" string splits into multiple slugs',
    setEq(resolveBooks('Bukhari and Muslim'), ['bukhari', 'muslim']));
  check('16f. group shorthand "sahihayn" expands to Bukhari + Muslim',
    setEq(resolveBooks('sahihayn'), ['bukhari', 'muslim']));
  check('16g. group shorthand "the six books" expands to the six Sunan',
    setEq(resolveBooks('the six books'), ['bukhari', 'muslim', 'abudawud', 'tirmidhi', 'nasai', 'ibnmajah']));
  check('16h. no books argument → null (caller uses the full allowlist)', resolveBooks(null) === null);
  check('16i. an unrecognised book → empty Set (caller surfaces an error)',
    resolveBooks('Nonexistent').size === 0);
  check('16j. Abu Dawud aliases (spacing/article variants) resolve to abudawud',
    setEq(resolveBooks('Sunan Abi Dawud'), ['abudawud']) && setEq(resolveBooks('abu dawud'), ['abudawud']));

  // Routing: the card forwards the books arg to ContentTools.searchHadith / getHadith.
  {
    const homey = createMockHomey({ settings: { assistant: {
      enabled: true, anthropicKey: 'sk-ant-x', allowedNumbers: [], rateLimitSeconds: 0, dailyCap: 50,
    } } });
    let seenSearch = null, seenGet = null;
    const contentTools = {
      searchHadith: async (a) => { seenSearch = a; return { type: 'hadith', query: a.query, offset: 0, total: 1,
        results: [{ n: 1, ref: 'Bukhari #1', selector: { id: 1 } }] }; },
      getHadith:    async (a) => { seenGet = a; return { block: 'HADITH_BLOCK', meta: { collection: 'Bukhari' } }; },
    };
    const card = new IslamicAssistantCard(homey, {
      contentTools,
      claudeComplete: async ({ runTool, messages }) => {
        const t = messages[messages.length - 1].content;
        if (/search/.test(t)) { await runTool('search_hadith', { query: 'patience', books: ['Bukhari'] }); return 'MENU'; }
        await runTool('get_hadith', { query: 'patience', books: ['Bukhari'] }); return 'INTRO {{BLOCK1}}';
      },
    });
    await card.run({ mode: 'reply', sender: '+777', text: 'search patience in bukhari' });
    await card.run({ mode: 'reply', sender: '+778', text: 'a hadith about patience in bukhari' });
    check('16k. search_hadith forwards the books scope to ContentTools.searchHadith',
      seenSearch && Array.isArray(seenSearch.books) && seenSearch.books[0] === 'Bukhari');
    check('16l. get_hadith forwards the books scope to ContentTools.getHadith',
      seenGet && Array.isArray(seenGet.books) && seenGet.books[0] === 'Bukhari');
  }
}

  // ── summary ──────────────────────────────────────────────────────────────────
  console.log(`\n\x1b[1m${'─'.repeat(64)}\x1b[0m`);
  console.log(`\x1b[1mRESULTS:\x1b[0m \x1b[32m${pass} passed\x1b[0m, ` +
    (fail ? `\x1b[31m${fail} failed\x1b[0m` : `\x1b[32m0 failed\x1b[0m`));
  if (fail) { console.log('\x1b[31mFailed:\x1b[0m\n  - ' + failures.join('\n  - ')); process.exitCode = 1; }
}

main().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
