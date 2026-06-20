'use strict';

// Matches prayer_trigger_before_after_specific flow instances.
// Args (from the flow card) and state (from the scheduled timer) both use the
// old arg names: prayerAfterBefore, prayerName, prayerDurationTime, prayerDurationType.
function triggerMatches(args, state) {
  if (!args || !state) return false;
  return args.prayerAfterBefore === state.prayerAfterBefore
    && (args.prayerName === state.prayerName || args.prayerName === state._resolvedPrayer)
    && Number(args.prayerDurationTime || 0) === Number(state.prayerDurationTime || 0)
    && args.prayerDurationType === state.prayerDurationType;
}

module.exports = triggerMatches;
