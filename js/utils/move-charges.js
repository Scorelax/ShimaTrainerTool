// Level-scaled charge counts for the few recharge moves whose text grants more attempts at higher
// levels. The recharge system reads a static "N charges" out of a move's `action` text (combat.js,
// trainer-card.js's rest reset, continue-journey.js's KnownMoves sync), which can't depend on the
// holder's level -- those three sites call this instead of using the parsed count directly.

// [minLevel, charges] pairs, highest level first.
const CHARGE_SCALING = {
  // "At level 10, this move may be attempted twice per long rest, and three times at level 18."
  Explosion: [[18, 3], [10, 2]],
};

/** Max charges for `moveName` at `level`: the scaled value when the move has a scaling table and
 * `level` reaches a tier, otherwise `baseCharges` (what the action text parsed to). */
export function scaledMaxCharges(moveName, baseCharges, level) {
  const tiers = CHARGE_SCALING[moveName];
  if (!tiers) return baseCharges;
  const tier = tiers.find(([minLevel]) => (Number(level) || 1) >= minLevel);
  return tier ? Math.max(baseCharges, tier[1]) : baseCharges;
}
