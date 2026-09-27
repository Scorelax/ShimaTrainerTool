// Mechanical rules for named status conditions (the campaign's own rulebook,
// not move-authored `roll`/`stat` effects -- see move-effects-schema.md).
// Read by move-effects.js's attackRollContext/saveRollContext so a condition
// grants its advantage/disadvantage purely from being HELD, whether it got
// there via a move's authored effect or a DM's manual apply-status pick --
// neither path needs to separately author a `roll` sub-effect for this.
//
// `advantageOn`/`disadvantageOn` reuse the exact same roll-target vocabulary
// authored `roll` effects already use (move-effects-schema.md's `on`):
// 'attack_rolls' (the holder's own attacks), 'attacks_against' (attacks made
// AT the holder), 'saving_throws' (the holder's own saves). Only entries
// this app can actually auto-enforce today belong here -- there is no
// ability-check roll anywhere in this app (only attack rolls and saves have
// a popup at all), so a rule clause like "auto-fails a sight-based ability
// check" has nowhere to hook into and stays in `note` as advisory text
// instead, same trust-the-human treatment this app already gives Charmed's
// targeting restriction or a `damage_note`'s reminder.
export const CONDITION_RULES = {
  blinded: {
    disadvantageOn: ['attack_rolls'],
    advantageOn: ['attacks_against'],
    note: "Can't see — auto-fails any ability check that requires sight (advisory only: this app has no ability-check roll to auto-fail).",
  },
  invisible: {
    advantageOn: ['attack_rolls'],
    disadvantageOn: ['attacks_against'],
    note: 'Impossible to see without magic or a special sense; heavily obscured for hiding. Detectable by any noise it makes or tracks it leaves.',
  },
  deafened: {
    note: "Can't hear — auto-fails any ability check that requires hearing (advisory only: this app has no ability-check roll to auto-fail).",
  },
  flinched: {
    disadvantageOn: ['attack_rolls', 'saving_throws'],
    note: 'Also disadvantage on skill checks (advisory only, no skill-check roll exists in this app). If it activates a move that requires a saving throw before this ends, the target has advantage on that save (advisory only).',
  },
  frightened: {
    disadvantageOn: ['attack_rolls'],
    note: "Also disadvantage on ability checks (advisory only), and only while the fear source is within line of sight; can't willingly move closer to it (not enforced — no line-of-sight tracking exists in this app).",
  },
  charmed: {
    note: "Can't attack the charmer or target them with harmful abilities/effects (not enforced — no move-targeting restriction exists in this app). The charmer has advantage on ability checks to interact with it socially.",
  },
  grappled: {
    speedMultiplier: 0,
    note: "Speed becomes 0 and can't benefit from any bonus to speed. Ends if the grappler is incapacitated, or if an effect removes this creature from the grappler's reach (e.g. hurled away by Thunder Wave) — neither is auto-detected, remove the status by hand when it applies.",
  },
  restrained: {
    // Restrained's own "disadvantage on DEX saves" is narrower than a plain
    // saving_throws entry (see _entryMatches in move-effects.js) -- every
    // OTHER ability's save is unaffected, only DEX.
    disadvantageOn: ['attack_rolls', { on: 'saving_throws', ability: 'DEX' }],
    advantageOn: ['attacks_against'],
    speedMultiplier: 0,
    note: "Speed becomes 0 and can't benefit from any bonus to speed.",
  },
};
