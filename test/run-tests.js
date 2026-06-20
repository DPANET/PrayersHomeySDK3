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
const PrayerScheduler = require(path.join(LIB, 'PrayerScheduler'));
const AudioRouter     = require(path.join(LIB, 'AudioRouter'));
const HijriCalendar   = require(path.join(LIB, 'HijriCalendar'));
const triggerMatches  = require(path.join(LIB, 'triggerMatch'));
const apiHandlers     = require(path.join(ROOT, 'api'));
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
const castUrls = t => t.castCalls.map(c => c.args?.url);
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
  check('5l. Shawwal 1st → Eid al-Fitr', hc(10, 1).isEidAlFitr() === true);
  check('5m. Dhul-Hijjah 10th → Eid al-Adha', hc(12, 10).isEidAlAdha() === true);
}

// ============================================================================
section('6. AudioRouter — content-type selection (UI selections) + volume');
// ============================================================================
{
  const noon = localMidnight() + 12 * 3600 * 1000;

  // Full adhan → azan1
  await withFrozenNow(noon, async () => {
    const env = makeEnv({ settings: { speakerGroups: [group({ contentType: 'Full adhan' })] }, devices: { sp1: castSpeaker('sp1') } });
    await env.audioRouter.dispatch('Dhuhr');
    check('6a. Full adhan casts azan1.mp3', /azan1\.mp3$/.test(castUrls(env.t)[0] || ''));
  });
  // Short adhan → azan2
  await withFrozenNow(noon, async () => {
    const env = makeEnv({ settings: { speakerGroups: [group({ contentType: 'Short adhan' })] }, devices: { sp1: castSpeaker('sp1') } });
    await env.audioRouter.dispatch('Dhuhr');
    check('6b. Short adhan casts azan2.mp3', /azan2\.mp3$/.test(castUrls(env.t)[0] || ''));
  });
  // Quran recitation → surah-padded URL
  await withFrozenNow(noon, async () => {
    const env = makeEnv({
      settings: { speakerGroups: [group({ contentType: 'Quran recitation', surahNumber: 67 })], audioConfig: { globalReciter: 'Abdul Basit' } },
      devices: { sp1: castSpeaker('sp1') },
    });
    env.audioRouter._reachable = async () => true;
    await env.audioRouter.dispatch('Maghrib');
    check('6c. Quran recitation casts surah-067 for chosen reciter', /basit\/067\.mp3$/.test(castUrls(env.t)[0] || ''));
  });
  // Custom URL → group.customUrl
  await withFrozenNow(noon, async () => {
    const custom = 'https://media.assabile.com/assabile/adhan_3435370/f30b7631d625.mp3';
    const env = makeEnv({ settings: { speakerGroups: [group({ contentType: 'Custom URL', customUrl: custom })] }, devices: { sp1: castSpeaker('sp1') } });
    await env.audioRouter.dispatch('Isha');
    check('6d. Custom URL casts the configured custom mp3', castUrls(env.t)[0] === custom);
  });
  // Silent (Flow only) → no cast
  await withFrozenNow(noon, async () => {
    const env = makeEnv({
      settings: { speakerGroups: [group()], prayerAudio: { Fajr: { adhanType: 'Silent (Flow only)' } } },
      devices: { sp1: castSpeaker('sp1') },
    });
    await env.audioRouter.dispatch('Fajr');
    check('6e. Silent (Flow only) casts nothing', castUrls(env.t).filter(Boolean).length === 0);
  });
  // Morning adhkar: Fajr schedules 2 follow-ups; non-Fajr does nothing.
  await withFrozenNow(localMidnight() + 5 * 3600 * 1000, async () => {
    const env = makeEnv({
      settings: { speakerGroups: [group({ contentType: 'Morning adhkar', volume: 50 })], morningAdhkar: { enabled: true, delayMin: 0 } },
      devices: { sp1: castSpeaker('sp1') },
    });
    await env.audioRouter.dispatch('Fajr');
    check('6f. Morning adhkar on Fajr schedules 2 timers', env.t.timers.pending().length === 2);
    env.audioRouter.clearScheduled();
    check('6g. clearScheduled cancels them', env.t.timers.pending().length === 0);
    const env2 = makeEnv({
      settings: { speakerGroups: [group({ contentType: 'Morning adhkar' })], morningAdhkar: { enabled: true, delayMin: 0 } },
      devices: { sp1: castSpeaker('sp1') },
    });
    await env2.audioRouter.dispatch('Dhuhr');
    check('6h. Morning adhkar does nothing on Dhuhr', env2.t.timers.pending().length === 0);
  });
  // Evening adhkar on Asr, distinct playlist.
  await withFrozenNow(localMidnight() + 16 * 3600 * 1000, async () => {
    const env = makeEnv({
      settings: { speakerGroups: [group({ contentType: 'Evening adhkar', volume: 50 })], eveningAdhkar: { enabled: true, delayMin: 0 } },
      devices: { sp1: castSpeaker('sp1') },
    });
    await env.audioRouter.dispatch('Asr');
    check('6i. Evening adhkar on Asr schedules 2 timers', env.t.timers.pending().length === 2);
  });
  // Disabled group + speaker-less group skipped.
  await withFrozenNow(noon, async () => {
    const env = makeEnv({
      settings: { speakerGroups: [
        group({ id: 'off', enabled: false }),
        group({ id: 'nospk', speakers: [] }),
      ] },
      devices: { sp1: castSpeaker('sp1') },
    });
    await env.audioRouter.dispatch('Dhuhr');
    check('6j. disabled + speaker-less groups cast nothing', castUrls(env.t).filter(Boolean).length === 0);
  });

  // Volume precedence: per-prayer → group → default; cast also sets volume_set.
  await withFrozenNow(noon, async () => {
    const sp = castSpeaker('sp1');
    const env = makeEnv({
      settings: { speakerGroups: [group({ volume: 90 })], prayerAudio: { Fajr: { volume: 55 } } },
      devices: { sp1: sp },
    });
    await env.audioRouter.dispatch('Fajr');
    check('6k. per-prayer volume (55) overrides group (90) → 0.55', sp.capValues.volume_set === 0.55);
  });
  await withFrozenNow(noon, async () => {
    const sp = castSpeaker('sp1');
    const env = makeEnv({ settings: { speakerGroups: [group({ volume: 90 })] }, devices: { sp1: sp } });
    await env.audioRouter.dispatch('Fajr');
    check('6l. no per-prayer → group volume (90) → 0.90', sp.capValues.volume_set === 0.9);
  });

  // Night-mode volume resolution.
  const cfg = { nightMode: true, quietStart: '22:00', quietEnd: '06:00', quietVol: 25 };
  await withFrozenNow(localMidnight() + 23 * 3600 * 1000, async () => {
    check('6m. 23:00 inside quiet window → 25', makeEnv().audioRouter._resolveVolume(70, cfg) === 25);
  });
  await withFrozenNow(localMidnight() + 5 * 3600 * 1000, async () => {
    check('6n. 05:00 inside overnight window → 25', makeEnv().audioRouter._resolveVolume(70, cfg) === 25);
  });
  await withFrozenNow(noon, async () => {
    check('6o. 12:00 outside window → 70', makeEnv().audioRouter._resolveVolume(70, cfg) === 70);
    check('6p. nightMode off → 70', makeEnv().audioRouter._resolveVolume(70, { nightMode: false }) === 70);
  });

  // appEnabled gating.
  await withFrozenNow(noon, async () => {
    const env = makeEnv({ settings: { advanced: { appEnabled: false }, speakerGroups: [group()] }, devices: { sp1: castSpeaker('sp1') } });
    await env.audioRouter.dispatch('Dhuhr');
    check('6q. dispatch is a no-op while app disabled', castUrls(env.t).filter(Boolean).length === 0);
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

  // 8a. audio_requested trigger referenced by AudioRouter must exist as a card.
  const audioReqReferenced = fs.readFileSync(path.join(LIB, 'AudioRouter.js'), 'utf8').includes("getTriggerCard('audio_requested')");
  const audioReqCardExists = exists(path.join(composeFlow, 'triggers', 'audio_requested.json'));
  check('8a. audio_requested card exists (AudioRouter fallback references it)',
    !audioReqReferenced || audioReqCardExists,
    'AudioRouter calls getTriggerCard(\'audio_requested\') but no such card is registered → non-cast fallback throws');

  // 8b. athan_action Short selection should play the SHORT adhan, not Full.
  await withFrozenNow(localMidnight() + 12 * 3600 * 1000, async () => {
    const env = makeEnv({ settings: { speakerGroups: [group()] }, devices: { sp1: castSpeaker('sp1') } });
    // app.js now maps athan_full→'Full adhan', else→'Short adhan' and calls playAdhan(group, athanType,…)
    await env.audioRouter.playAdhan(group(), 'Short adhan', 70);
    check('8b. athan_action "Short adhan" plays azan2 (short)', /azan2\.mp3$/.test(castUrls(env.t)[0] || ''),
      'playAdhan("Short adhan") should resolve to azan2.mp3 via ADHAN_URLS');
  });

  // 8c. prayer_trigger_specific on Sunrise should fire (Sunrise is in the dropdown).
  await withFrozenNow(localMidnight() + 60 * 1000, async (clock) => {
    const env = makeEnv({ settings: { speakerGroups: [group()] }, devices: { sp1: castSpeaker('sp1') } });
    env.audioRouter._reachable = async () => true;
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

  // 8d. stopAudio should operate on the new speakerGroups model, not legacy `zones`.
  {
    const stopSrc = fs.readFileSync(path.join(ROOT, 'api.js'), 'utf8');
    const stopUsesLegacyZones = /async stopAudio[\s\S]*?homey\.settings\.get\('zones'\)/.test(stopSrc);
    check('8d. stopAudio uses speakerGroups (not legacy zones model)', !stopUsesLegacyZones,
      'api.stopAudio reads settings.get(\'zones\') + zone.speakerId — the new model is speakerGroups[].speakers[]');
  }

  // 8e. settings entry should serve the NEW UI, not redirect to the old settings.html.
  {
    const idx = fs.readFileSync(path.join(ROOT, 'settings', 'index.html'), 'utf8');
    const redirectsToOld = /settings\.html/.test(idx) && /location\.replace/.test(idx);
    check('8e. settings/index.html serves the new UI (no redirect to old settings.html)', !redirectsToOld,
      'settings/index.html still redirects to the old 2023 settings.html; the new 1421-line UI sits unused at settings/settings/index.html');
  }

  // 8f. app.js athan_action source should map to ADHAN_URLS keys correctly.
  {
    const appSrc = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
    const mapsToAdhanKey = /athan_full[\s\S]*?'Full adhan'|'Full adhan'[\s\S]*?athan_full/.test(appSrc);
    check('8f. app.js maps athan dropdown to "Full adhan"/"Short adhan" keys', mapsToAdhanKey,
      'app.js produces "Full"/"Short" which do not match ADHAN_URLS keys');
  }
}

  // ── summary ──────────────────────────────────────────────────────────────────
  console.log(`\n\x1b[1m${'─'.repeat(64)}\x1b[0m`);
  console.log(`\x1b[1mRESULTS:\x1b[0m \x1b[32m${pass} passed\x1b[0m, ` +
    (fail ? `\x1b[31m${fail} failed\x1b[0m` : `\x1b[32m0 failed\x1b[0m`));
  if (fail) { console.log('\x1b[31mFailed:\x1b[0m\n  - ' + failures.join('\n  - ')); process.exitCode = 1; }
}

main().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
