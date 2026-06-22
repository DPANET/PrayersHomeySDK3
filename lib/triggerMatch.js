'use strict';

// Matches prayer_trigger_before_after_specific flow instances.
// Args (from the flow card) use the old names: prayerAfterBefore, prayerName,
// prayerDurationTime, prayerDurationType. The scheduler arms ONE timer per
// (direction, prayer, offset, day) regardless of whether it originated from an
// "Any" flow or an explicit-prayer flow; `state._resolvedPrayer` is the concrete
// prayer that timer represents. A flow matches when its direction + offset match
// and it targets either that concrete prayer or "Any". Matching on the resolved
// prayer (not state.prayerName) prevents an explicit-prayer flow from firing
// twice when an overlapping "Any" flow shares the same timer.
function triggerMatches(args, state) {
  if (!args || !state) return false;
  const resolved = state._resolvedPrayer || state.prayerName;
  return args.prayerAfterBefore === state.prayerAfterBefore
    && (args.prayerName === 'Any' || args.prayerName === resolved)
    && Number(args.prayerDurationTime || 0) === Number(state.prayerDurationTime || 0)
    && args.prayerDurationType === state.prayerDurationType;
}

module.exports = triggerMatches;
