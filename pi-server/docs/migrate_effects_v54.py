#!/usr/bin/env python3
"""Move migration, fifty-fourth slice: `potential_damage_increase` (6
moves). This category's own coverage-report note flagged it as possibly
needing "a damage_note reminder for most of its moves" the way
`conditional_damage` did -- true for 4 of the 6, all via two new conditions
reusing the EXISTING `damage_note`/`diceMultiplier` machinery end to end
(no new result field, just two new ways to decide whether it applies):

- **Avalanche** / **Payback** ("if the target has damaged you [since the end
  of your last turn / earlier this round], double the damage"): a new
  TARGET-conditional type, `"target_damaged_me_this_round"`
  (move-effects.js's `_targetConditionMet`). Unlike every other target-
  conditional check so far, this needs the shared battle LOG, which
  `_targetConditionMet`/`targetDamageNoteResult` deliberately never reach
  into themselves (they're pure functions over explicit params) -- resolved
  by the CALLER instead: target-picker.js now keeps its own one-time
  snapshot of `log`/`round` (captured alongside `_attacker`, same "taken
  once at pickTarget's own start" limitation those already have) and passes
  a plain computed boolean through. Avalanche's own "since the end of your
  last turn" is approximated as "this round" -- correct in the standard
  case of each combatant acting once per round, called out as a documented
  simplification rather than tracking exact turn boundaries per
  participant.

- **Fusion Bolt** / **Fusion Flare** ("if Fusion Bolt or Fusion Flare was
  already used this round, double the damage"): a new SELF-conditional
  type, `"self_move_used_this_round"` (`{anyOf: [...]}`, combat.js's own
  `_evaluateDamageNotes`), backed by a new WIP-bridged field,
  `movesUsedThisRound` (combat-wip.js's `_movesUsedThisRound` -- every move
  name used by ANYONE this round, straight off 'move-used' log entries,
  same bridging pattern `lastHitMoveStreak`/`witnessedMoveTypes` already
  use). Fusion Flare wasn't even tagged `potential_damage_increase` in the
  original hand-categorization (it has `fixed_special_damage` instead) --
  caught migrating its sibling, since it's the identical clause word for
  word; both get the same effect.

- **Stomping Tantrum** ("if your last attack missed, double the dice"):
  another new self-conditional type, `"self_last_attack_missed"`, backed by
  a new WIP-bridged field, `lastAttackMissed` (combat-wip.js's
  `_didLastAttackMiss` -- walks the log backward for this participant's own
  most recent 'damage' or 'miss' entry, whichever comes first, not bounded
  by round since "your last attack" means whenever that actually was).

**Round** ("If an ally in range also knows this move, they can join in the
song as a reaction to add an additional damage dice") needs NO effects
entry at all -- the reminder is already fully visible in the move's own
description text shown on the move-popup every time, the same "nothing
hidden that needs surfacing" reasoning Dig/Dive/U-turn/Volt Switch already
get. The REAL automation (a live reaction injecting a bonus die into
someone ELSE's in-progress damage roll, mid-flow) would need a new
mechanism this app doesn't have anywhere -- the existing dice-bonus-button
machinery (Sharpen/Growth/Helping Hand) only ever augments the roll's OWN
holder, on an attack or save roll specifically, never a THIRD PARTY's
subsequent damage roll -- but there's nothing actually hidden here for a
reminder to prevent forgetting, so building that isn't needed for the
"don't let the table forget a damage bonus" goal `damage_note` exists for.

**Echoed Voice** ("if any OTHER creature in range uses this move, they may
double their damage dice on a hit... stacks to 8x, resetting on a miss")
stays unmigrated -- a genuinely different, multi-part shape from everything
else in this category: a CROSS-CREATURE streak (unlike Fury Cutter/Ice
Ball/Rollout's own same-caster-only counter), gated by a TIME WINDOW tied
to the ORIGINAL caster's own next turn (which has to be tracked somewhere,
since the shared log alone has no notion of "is this window still open" --
a 'move-used' entry doesn't carry who opened what window or when it
closes). Would need either a new top-level session field (parallel to
`pendingReaction`) tracking the window's owner/expiry/current multiplier,
or a stored per-participant status every potential user has to carry and
check -- real new infrastructure, not a small increment on
`_lastHitMoveStreak`.

    python migrate_effects_v54.py            # dry run
    python migrate_effects_v54.py --apply
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from migrate_effects_v2 import tag_for
from migrate_effects_v3 import RETIRED_V3

FILE = Path(__file__).with_name('DnD_moves_categorized_draft.json')


def rebuild_categories(cats, effects):
    derived = []
    for e in effects:
        t = tag_for(e)
        if t not in derived:
            derived.append(t)
    out, placed = [], False
    for c in cats:
        if c in RETIRED_V3:
            if not placed:
                for t in derived:
                    if t not in out:
                        out.append(t)
                placed = True
            continue
        out.append(c)
    if not placed:
        for t in derived:
            if t not in out:
                out.append(t)
    return out


OVERRIDES = {
    'Avalanche': {
        'effects': [
            {
                'kind': 'damage_note', 'condition': {'type': 'target_damaged_me_this_round'}, 'diceMultiplier': 2,
                'note': 'Approximates "since the end of your last turn" as "this round" -- correct when each combatant acts once per round.',
            },
        ],
    },
    'Payback': {
        'effects': [
            {'kind': 'damage_note', 'condition': {'type': 'target_damaged_me_this_round'}, 'diceMultiplier': 2},
        ],
    },
    'Fusion Bolt': {
        'effects': [
            {'kind': 'damage_note', 'condition': {'type': 'self_move_used_this_round', 'anyOf': ['Fusion Bolt', 'Fusion Flare']}, 'diceMultiplier': 2},
        ],
    },
    'Fusion Flare': {
        'effects': [
            {'kind': 'damage_note', 'condition': {'type': 'self_move_used_this_round', 'anyOf': ['Fusion Bolt', 'Fusion Flare']}, 'diceMultiplier': 2},
        ],
    },
    'Stomping Tantrum': {
        'effects': [
            {'kind': 'damage_note', 'condition': {'type': 'self_last_attack_missed'}, 'diceMultiplier': 2},
        ],
    },
}


def main():
    apply_it = '--apply' in sys.argv
    data = json.loads(FILE.read_text(encoding='utf-8'))
    moves = data['moves']
    by_name = {m['name']: m for m in moves}

    missing = [n for n in OVERRIDES if n not in by_name]
    if missing:
        print('ERROR -- unknown move names:', missing)
        sys.exit(1)
    already = [n for n in OVERRIDES if by_name.get(n, {}).get('effects')]
    if already:
        print('ERROR -- already have effects (would overwrite):', already)
        sys.exit(1)

    print(f'{len(OVERRIDES)} moves getting effects')
    for name, spec in OVERRIDES.items():
        effects = spec['effects']
        print(f'## {name}  ({len(effects)} effect(s))')
        for e in effects:
            print('   ', json.dumps(e, ensure_ascii=False))

    if not apply_it:
        return
    for name, spec in OVERRIDES.items():
        m = by_name[name]
        effects = spec['effects']
        m['effects'] = effects
        m['categories'] = rebuild_categories(m['categories'], effects)
    FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
    print('\nwritten')


if __name__ == '__main__':
    main()
