#!/usr/bin/env python3
"""Move migration, thirty-second slice: 4 of the 13 `potential_damage_increase`
moves (damage that scales on a condition -- the unread sibling category to
`conditional_damage`, which turned out to need almost nothing new once
actually read). Same story here, partially: read all 13 full descriptions
first -- 4 fit cleanly with SMALL, genuinely new (but well-scoped, reusable)
additions to the existing damage_note mechanism, not a whole new effect kind.

  - **Charge Beam**: "if the natural attack roll is 10+ (and it hits), add
    proficiency to the damage" -- new `attack_roll_at_least` damage_note
    condition (the natural roll was already known by the damage-roll step,
    just never threaded into targetDamageNoteResult before -- now is),
    existing `flatBonus: 'proficiency'` result.
  - **Power Trip**: "add an additional damage die for each positive stat
    change affecting you" -- new `self_active_buff_count` condition (counts
    the holder's own active `kind:'stat'` statuses with a positive amount,
    via new `activeBuffCount()` in move-effects.js) + a genuinely new result
    field, `extraDice: {amountPerUnit}` (new `addDiceString()` helper).
    Deliberately NOT `scalingBonus` (the existing per-unit mechanism) --
    that adds a flat NUMBER per unit, which would silently substitute a
    fixed number for real extra dice and distort both the average and the
    variance, especially for a small die like this move's own d4. Needed a
    small bridging addition too: the self-conditional evaluator
    (combat.js's _evaluateDamageNotes) only ever sees the LOCAL merged
    combatant, which has no raw `.statuses` list to count from (unlike the
    target-conditional side, which already reads the raw session
    participant directly) -- fixed the same way Archive Blast's own
    witnessedMoveTypes did, a WIP-only field
    (`merged.activeBuffCount`) bridged onto the combatant in
    combat-wip.js's _syncLocalCombatState.
  - **Punishment**: "+1d10 damage for each effect currently boosting the
    target's attack, damage, or AC" -- Power Trip's own target-conditional
    mirror, `target_active_buff_count` (same activeBuffCount(), filtered to
    `['attack_rolls', 'damage_rolls', 'ac']`) + the same new `extraDice`
    result field, this time surfaced as a reminder in target-picker.js's
    damage-roll step (that popup never had a live dice-override slot to
    begin with, same treatment diceMultiplier already gets there).
  - **Eruption**: "if at full health, roll damage with advantage" -- the
    self-conditional evaluator was MISSING an "at or above X% HP" case
    entirely (only self_hp_below/at_or_below existed; the target-
    conditional side already had its own target_hp_at_or_above for Wring
    Out) -- added `self_hp_at_or_above`. `advantage` itself already existed
    as a target-conditional result field (Cross Poison/Hex) but had never
    been wired into the self-conditional side or its combat.js display --
    added there too (shows as a plain noteText banner, same slot
    totalMultiplier's own note already uses). Eruption's OTHER clause
    ("double your STAB bonus") is NOT migrated -- STAB doubling is a
    standing, already-documented gap (increase_stab has no backing
    mechanism anywhere).

NOT migrated in this pass (each needs something genuinely different, not
sharing a mechanism worth building alongside these four):
  - **Avalanche, Payback**: "if the target damaged you [since your last
    turn / earlier this round]" -- needs a battle-log scan (feasible, same
    pattern as Bide/Archive Blast, WIP-only) but a real new condition type
    with its own time-window semantics; left for its own slice.
  - **Fusion Bolt**: "if Fusion Bolt or Fusion Flare was already used this
    round [by anyone]" -- also a log-scan condition, same reasoning.
  - **Stomping Tantrum**: "if your last attack missed" -- also a log-scan
    condition (was the most recent attack-roll entry a miss).
  - **Fury Cutter, Ice Ball, Rollout**: cumulative same-move-consecutive-
    turn-use stacking (doubling per hit, capped at 8x/5 attacks, VP cost
    climbing each use, resetting on a miss/incapacitation/speed-0) -- a
    real resource-tracking mini-system shared by all three, closer in
    spirit to Stockpile's own stacking than to anything damage_note
    already does. A bigger, dedicated future slice, not a damage_note
    condition at all.
  - **Echoed Voice**: a shared, cross-creature stacking multiplier (any
    OTHER creature using this same move can keep doubling a shared counter)
    -- genuinely novel, no existing tracking for coordinated multi-
    combatant state like this.
  - **Round**: an ally's REACTION adds a damage die to this move's own
    in-progress roll -- the reaction system as built lets a reactor apply
    an effect to THEMSELVES, not inject a bonus into someone else's already-
    rolling attack; a real, different reaction shape.

    python migrate_effects_v32.py            # dry run
    python migrate_effects_v32.py --apply
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
    'Charge Beam': [
        {
            'kind': 'damage_note',
            'condition': {'type': 'attack_roll_at_least', 'min': 10},
            'flatBonus': 'proficiency',
        },
    ],
    'Power Trip': [
        {
            'kind': 'damage_note',
            'condition': {'type': 'self_active_buff_count'},
            'extraDice': {'amountPerUnit': 1},
        },
    ],
    'Punishment': [
        {
            'kind': 'damage_note',
            # attack_rolls_or_saving_throws included -- Growth/Helping Hand's
            # own dual-purpose bonus (see move-effects-schema.md's stat-field
            # list) boosts attack rolls same as a plain 'attack_rolls' entry
            # would, and Punishment's rule text has no reason to exclude it.
            # Missing from the original migration (found on review).
            'condition': {'type': 'target_active_buff_count', 'statFields': ['attack_rolls', 'damage_rolls', 'ac', 'attack_rolls_or_saving_throws']},
            'extraDice': {'amountPerUnit': 1},
        },
    ],
    'Eruption': [
        {
            'kind': 'damage_note',
            'condition': {'type': 'self_hp_at_or_above', 'fraction': 1.0},
            'advantage': True,
            'note': "Also doubles your STAB bonus -- not migrated, STAB doubling has no backing mechanism anywhere in this schema (increase_stab is a standing gap).",
        },
    ],
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
    for name, effects in OVERRIDES.items():
        print(f'## {name}  ({len(effects)} effect(s))')
        for e in effects:
            print('   ', json.dumps(e, ensure_ascii=False))

    if not apply_it:
        return
    for name, effects in OVERRIDES.items():
        m = by_name[name]
        m['effects'] = effects
        m['categories'] = rebuild_categories(m['categories'], effects)
    FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
    print('\nwritten')


if __name__ == '__main__':
    main()
