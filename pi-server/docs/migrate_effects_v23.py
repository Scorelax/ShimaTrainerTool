#!/usr/bin/env python3
"""Move migration, twenty-first slice: the self-conditional damage-dice
reminder slice of `conditional_damage` -- a new `damage_note` effect kind
(move-effects-schema.md's own section has the full mechanism writeup and
the correction of migrate_effects_v22.py's own "nothing to model" call).
Three moves, all self-conditional (knowable before a target is even
picked, so this shows in the move-popup itself, no target needed):

  - Facade: doubles the dice if the user is poisoned, paralyzed, or burned.
  - Flail: two tiers -- doubles below 50% HP, triples at 10% HP or below
    (resolves to whichever's met with the highest multiplier, never both).
  - Water Spout: halves the TOTAL damage (not the dice) below 50% HP --
    shown as a note, not a recomputed dice string, since those aren't the
    same thing (see the schema doc's own reasoning).

Target-conditional moves under this same tag (Brine, Crush Grip, Cross
Poison, Gyro Ball, Hex, Smelling Salts, Venoshock) are deliberately NOT
in this batch -- they need the same idea wired into target-picker.js's
own damage-roll step instead, once a target is actually known, not the
move-popup. A later slice.

    python migrate_effects_v23.py            # dry run
    python migrate_effects_v23.py --apply
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
    'Facade': [
        {'kind': 'damage_note', 'condition': {'type': 'self_status', 'any': ['Poison', 'Paralysis', 'Burn']},
         'diceMultiplier': 2, 'note': 'You are poisoned, paralyzed, or burned'},
    ],
    'Flail': [
        {'kind': 'damage_note', 'condition': {'type': 'self_hp_below', 'fraction': 0.5},
         'diceMultiplier': 2, 'note': 'Below 50% HP'},
        {'kind': 'damage_note', 'condition': {'type': 'self_hp_at_or_below', 'fraction': 0.1},
         'diceMultiplier': 3, 'note': 'At 10% HP or below'},
    ],
    'Water Spout': [
        {'kind': 'damage_note', 'condition': {'type': 'self_hp_below', 'fraction': 0.5},
         'totalMultiplier': 0.5, 'note': 'Below 50% HP -- halve the total damage after rolling (not the dice)'},
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
