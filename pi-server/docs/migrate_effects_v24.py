#!/usr/bin/env python3
"""Move migration, twenty-second slice: the target-conditional half of
`conditional_damage` -- the `damage_note` kind's own second condition family
(move-effects-schema.md's own section has the full mechanism writeup),
evaluated by target-picker.js's own damage-roll step once a target is
actually picked, instead of combat.js's move-popup (self-conditional,
migrate_effects_v23.py).

  - Brine: doubles if the TARGET is below 50% HP.
  - Crush Grip: adds the caster's own proficiency bonus if the TARGET is
    ABOVE 50% HP -- flatBonus, not a dice multiplier (the move's own text:
    "add your proficiency bonus to the damage roll", not "double").
  - Cross Poison, Hex: "damage is rolled with advantage" if the target is
    poisoned (Cross Poison) / has ANY status condition (Hex) -- shown as
    its own advantage banner, not a dice-count change (this schema's `roll`
    kind has no damage_rolls target at all; damage_note's own `advantage`
    field is what covers a damage roll instead).
  - Gyro Ball: doubles if the ATTACKER's own DEX score is lower than the
    TARGET's -- the one move needing `attacker_stat_below_target` instead
    of a target_* condition.
  - Smelling Salts, Venoshock: double if the target is paralyzed / poisoned
    (respectively) -- the plain target_status case.

    python migrate_effects_v24.py            # dry run
    python migrate_effects_v24.py --apply
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
    'Brine': [
        {'kind': 'damage_note', 'condition': {'type': 'target_hp_below', 'fraction': 0.5},
         'diceMultiplier': 2, 'note': 'Target below 50% HP'},
    ],
    'Crush Grip': [
        {'kind': 'damage_note', 'condition': {'type': 'target_hp_above', 'fraction': 0.5},
         'flatBonus': 'proficiency', 'note': 'Target above 50% HP -- add your proficiency bonus'},
    ],
    'Cross Poison': [
        {'kind': 'damage_note', 'condition': {'type': 'target_status', 'any': ['poisoned']},
         'advantage': True, 'note': 'Target is poisoned'},
    ],
    'Gyro Ball': [
        {'kind': 'damage_note', 'condition': {'type': 'attacker_stat_below_target', 'stat': 'dex'},
         'diceMultiplier': 2, 'note': "Your DEX is lower than the target's"},
    ],
    'Hex': [
        {'kind': 'damage_note', 'condition': {'type': 'target_has_any_status'},
         'advantage': True, 'note': 'Target has a status condition'},
    ],
    'Smelling Salts': [
        {'kind': 'damage_note', 'condition': {'type': 'target_status', 'any': ['paralyzed']},
         'diceMultiplier': 2, 'note': 'Target is paralyzed'},
    ],
    'Venoshock': [
        {'kind': 'damage_note', 'condition': {'type': 'target_status', 'any': ['poisoned']},
         'diceMultiplier': 2, 'note': 'Target is poisoned'},
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
