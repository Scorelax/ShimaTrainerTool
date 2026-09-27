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
  // Incapacitation family -- "can't take actions or reactions" (and, for
  // these three, "can't move" too) is enforced server-side (routes_combat.py's
  // _apply_move/_reaction_start/_move_token, see conditions.py's
  // INCAPACITATING_CONDITIONS). autoFailSaves is read by saveRollContext's
  // sibling saveAutoFails() below, not attackRollContext/saveRollContext
  // themselves -- an auto-fail isn't a roll MODIFIER, it overrides the
  // outcome regardless of what's rolled.
  incapacitated: {
    note: "Can't take actions or reactions.",
  },
  stunned: {
    advantageOn: ['attacks_against'],
    autoFailSaves: ['STR', 'DEX'],
    note: "Incapacitated, can't move, and can only speak falteringly.",
  },
  unconscious: {
    advantageOn: ['attacks_against'],
    autoFailSaves: ['STR', 'DEX'],
    note: "Incapacitated, can't move or speak, unaware of its surroundings, drops whatever it's holding and falls prone (apply Prone separately by hand -- not auto-chained). Any attack that hits it from within 5ft is an automatic critical hit (not auto-enforced yet -- needs a range check at hit resolution).",
  },
  petrified: {
    advantageOn: ['attacks_against'],
    autoFailSaves: ['STR', 'DEX'],
    note: 'Transformed to stone (weight ×10, stops aging), unaware of its surroundings. Resistant to all damage, and immune to poison/disease (any existing poison/disease is suspended, not neutralized) -- damage resistance and the poison/disease interaction are not auto-enforced yet.',
  },
  // Turn-boundary damage-over-time -- `turnDamage` is read server-side
  // (conditions.py's mirror of this entry, applied automatically in
  // _advance_turn since the amount is deterministic, no dice/human input
  // needed, unlike a repeat `heal` status or a repeat save). `immuneTypes`
  // is read client-side, right before a condition is actually applied (see
  // combat-wip.js's _confirmNotImmune) -- advisory only, never a hard
  // block, same "trust the human" philosophy as everywhere else in this app.
  burned: {
    turnDamage: { timing: 'start', amount: 'proficiency' },
    immuneTypes: ['Fire'],
    note: 'Rolls all damage rolls twice and takes the LOWER result (bypasses and does not cancel out with other damage-roll modifiers) -- not auto-enforced yet, no damage-roll-mode banner exists for this. Takes damage equal to proficiency bonus at the start of each of its turns until fainted or cured (auto-applied). Fire types are immune.',
  },
  poisoned: {
    disadvantageOn: ['attack_rolls'],
    turnDamage: { timing: 'end', amount: 'proficiency' },
    immuneTypes: ['Poison', 'Steel'],
    note: 'Also disadvantage on all ability checks (advisory only, no ability-check roll exists in this app). Takes damage equal to proficiency bonus at the end of each of its turns until fainted or cured (auto-applied). Poison and Steel types are immune.',
  },
};
