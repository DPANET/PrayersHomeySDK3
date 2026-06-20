'use strict';

/**
 * Mock Homey harness for the MERGED PrayersHomeySDK3 app.
 *
 * Differs from the source-repo harness:
 *   - exposes homey.app.logger  (Logger interface: log/debug/warn/error/capture)
 *   - exposes homey.app.homeyApi.flow.runFlowCardAction + getFlowCardActions
 *   - device .ownerUri / .driverUri so the Chromecast direct-cast path can be tested
 *   - new legacy trigger card IDs are created on demand
 *
 * Captures every observable side-effect so tests can assert on them.
 */

// ── Controllable virtual timers ───────────────────────────────────────────────
class VirtualTimers {
  constructor() { this.timers = []; this._seq = 1; }
  set(fn, ms) { const id = this._seq++; this.timers.push({ id, fn, ms, fired: false }); return id; }
  clear(id) { this.timers = this.timers.filter(t => t.id !== id); }
  pending() { return this.timers.filter(t => !t.fired).sort((a, b) => a.ms - b.ms); }
  async fire(timer) { timer.fired = true; await timer.fn(); }
  async fireById(id) { const t = this.timers.find(x => x.id === id && !x.fired); if (t) await this.fire(t); return !!t; }
  reset() { this.timers = []; this._seq = 1; }
}

// ── Mock Flow cards ───────────────────────────────────────────────────────────
class MockTriggerCard {
  constructor(id) {
    this.id = id;
    this._listeners = {};
    this._argumentValues = [];
    this.triggerCalls = [];
    this._runListener = null;
  }
  on(event, cb) { (this._listeners[event] = this._listeners[event] || []).push(cb); return this; }
  emit(event, ...a) { (this._listeners[event] || []).forEach(cb => cb(...a)); }
  registerRunListener(fn) { this._runListener = fn; return this; }
  setArgumentValues(arr) { this._argumentValues = arr; }
  async getArgumentValues() { return this._argumentValues; }
  async trigger(tokens, state) { this.triggerCalls.push({ tokens, state }); }
  // Evaluate the run listener the way Homey would, against a candidate state.
  async runMatches(args, state) { return this._runListener ? this._runListener(args, state) : true; }
}

class MockSimpleCard {
  constructor(id) { this.id = id; this._runListener = null; this._autocompletes = {}; }
  registerRunListener(fn) { this._runListener = fn; return this; }
  registerArgumentAutocompleteListener(name, fn) { this._autocompletes[name] = fn; return this; }
  async run(args, state) { return this._runListener ? this._runListener(args, state) : true; }
}

// ── Mock devices (homey-api surface) ──────────────────────────────────────────
class MockDevice {
  constructor(id, name, capabilities, opts = {}) {
    this.id = id; this.name = name; this.capabilities = capabilities;
    this.ownerUri  = opts.ownerUri  || '';
    this.driverUri = opts.driverUri || '';
    this.zoneName  = opts.zoneName  || '';
    this.capValues = {};
    this.setCalls = [];
  }
  async setCapabilityValue(cap, val) { this.capValues[cap] = val; this.setCalls.push({ cap, val }); }
}

// ── The mock Homey object ─────────────────────────────────────────────────────
function createMockHomey(opts = {}) {
  const timers = new VirtualTimers();
  const settingsStore = { ...(opts.settings || {}) };
  const settingsListeners = [];
  const realtimeCalls = [];
  const logs = [];
  const errors = [];
  const devices = opts.devices || {};
  const castCalls = [];           // runFlowCardAction invocations
  const flowActionDefs = opts.flowActionDefs || [];

  const triggerCards = {};
  const simpleCards = {};

  const homey = {
    settings: {
      get: (k) => (k in settingsStore ? settingsStore[k] : undefined),
      set: (k, v) => { settingsStore[k] = v; settingsListeners.forEach(cb => cb(k)); },
      unset: (k) => { delete settingsStore[k]; settingsListeners.forEach(cb => cb(k)); },
      on: (event, cb) => { if (event === 'set') settingsListeners.push(cb); },
      _store: settingsStore,
    },
    flow: {
      getTriggerCard: (id) => (triggerCards[id] = triggerCards[id] || new MockTriggerCard(id)),
      getConditionCard: (id) => (simpleCards[id] = simpleCards[id] || new MockSimpleCard(id)),
      getActionCard: (id) => (simpleCards[id] = simpleCards[id] || new MockSimpleCard(id)),
    },
    geolocation: {
      getLatitude: () => (opts.geo ? opts.geo.lat : 24.45),
      getLongitude: () => (opts.geo ? opts.geo.lng : 54.37),
      on: () => {},
    },
    clock: { getTimezone: () => opts.timezone || 'Asia/Dubai' },
    setTimeout: (fn, ms) => timers.set(fn, ms),
    clearTimeout: (id) => timers.clear(id),
    api: { realtime: async (event, payload) => { realtimeCalls.push({ event, payload }); } },
    env: opts.env || {},
  };

  // homey.app surface
  homey.app = {
    log: (...a) => logs.push(a.join(' ')),
    error: (...a) => errors.push(a.join(' ')),
    manifest: { id: 'com.prayerssapp', version: '2.0.0' },
    logger: {
      log:   (...a) => logs.push(a.join(' ')),
      debug: (...a) => logs.push('[DBG] ' + a.join(' ')),
      warn:  (...a) => logs.push('[WARN] ' + a.join(' ')),
      error: (label, err, extra) => errors.push(`[${label}] ${err instanceof Error ? err.message : String(err ?? '')}`),
      capture: () => {},
    },
    homeyApi: {
      devices: { getDevices: async () => devices },
      flow: {
        runFlowCardAction: async (props) => { castCalls.push(props); },
        getFlowCardActions: async () => flowActionDefs,
      },
    },
  };

  homey._test = {
    timers, settingsStore, realtimeCalls, logs, errors, devices,
    triggerCards, simpleCards, castCalls,
  };

  return homey;
}

// ── Controllable clock ────────────────────────────────────────────────────────
async function withClock(clock, fn) {
  const RealDate = Date;
  class MockDate extends RealDate {
    constructor(...args) { if (args.length === 0) { super(clock.now); } else { super(...args); } }
    static now() { return clock.now; }
  }
  // eslint-disable-next-line no-global-assign
  global.Date = MockDate;
  try { return await fn(); } finally { global.Date = RealDate; }
}

async function withFrozenNow(epochMs, fn) {
  const clock = { now: epochMs };
  return withClock(clock, () => fn(clock));
}

module.exports = {
  createMockHomey, withFrozenNow, withClock,
  VirtualTimers, MockDevice, MockTriggerCard, MockSimpleCard,
};
