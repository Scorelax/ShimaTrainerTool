#!/usr/bin/env python3
"""Move migration, twenty-fifth slice: five more `conditional_damage`
moves generate_unmigrated_moves.py had been silently hiding as "nothing
to do" (see that script's own history -- the same wrong assumption the
user corrected back on Facade/Flail/Water Spout, never carried over to
these). Two shapes:

  - Solvent Spray / Wring Out: fit the existing target-conditional
    damage_note mechanism (move-effects-schema.md) as-is, with two new
    condition types -- `target_type` (Solvent Spray: double vs. Poison-
    type targets) and `target_hp_at_or_above` (Wring Out: double your
    OWN move modifier, not the dice, when the target's at 50% HP or
    more -- flatBonus: 'moveModifier', new alongside the existing
    'proficiency'/number sources).

  - Trump Card / Frustration / Return: a genuinely new damage_note shape
    -- `scalingBonus`, a bonus that scales with a COUNTED value rather
    than a fixed amount (see move-effects.js's _evaluateDamageNotes and
    combat.js's own copy): VP spent in 10s (Trump Card, capped at +10)
    or Loyalty Chart distance from zero (Frustration/Return, no cap
    stated). All three are self-conditional -- knowable before a target
    is picked, same as Facade/Flail/Water Spout.

Stored Power (also `conditional_damage`, "+1 die per active attack/
damage/AC buff") is deliberately NOT in this batch -- counting active
buffs needs the self-conditional evaluator to see `statuses`, which
`c` doesn't carry at all today (only the target-conditional side has
structured status data). A separate slice once that's plumbed through.

    python migrate_effects_v25.py            # dry run
    python migrate_effects_v25.py --apply
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
    'Solvent Spray': [
        {'kind': 'damage_note', 'condition': {'type': 'target_type', 'any': ['poison']},
         'diceMultiplier': 2, 'note': 'Target is Poison-type'},
    ],
    'Wring Out': [
        {'kind': 'damage_note', 'condition': {'type': 'target_hp_at_or_above', 'fraction': 0.5},
         'flatBonus': 'moveModifier', 'note': 'Target at 50% HP or more -- double your move modifier'},
    ],
    'Trump Card': [
        {'kind': 'damage_note', 'condition': {'type': 'self_vp_spent_per', 'per': 10},
         'scalingBonus': {'amountPerUnit': 'moveModifier', 'cap': 10},
         'note': '+MOVE mod per 10VP spent this battle, capped at +10'},
    ],
    'Frustration': [
        {'kind': 'damage_note', 'condition': {'type': 'self_loyalty_below_zero'},
         'scalingBonus': {'amountPerUnit': 1},
         'note': '+1 per level below 0 on the Loyalty Chart -- also add this to your attack roll'},
    ],
    'Return': [
        {'kind': 'damage_note', 'condition': {'type': 'self_loyalty_above_zero'},
         'scalingBonus': {'amountPerUnit': 1},
         'note': '+1 per level above 0 on the Loyalty Chart -- also add this to your attack roll'},
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
        print(f'## {name}')
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
