#!/usr/bin/env python3
"""Move migration, twenty-sixth slice: Electro Ball, the last of the
conditional_damage batch that fits a (lightly extended) damage_note rather
than needing its own real sub-system. "Compare the target and user's
highest speed type... if the user's speed is higher, roll the next level
tier's damage dice. If the user is level 17 or higher, double the damage
dice."

Two new pieces, both in move-effects.js:
  - `attacker_max_speed_above_target` condition -- compares the FASTEST of
    each participant's own movement types (the new `speeds` field from this
    session's movement-tracking work), not a single flat stat.
  - `nextTierOrDouble` result field -- swaps in the move's own NEXT damage
    tier (pokemon-types.js's new nextTierDamageDice, threaded through as
    computedData.nextTierDice) when one exists, or falls back to doubling
    the current (already top-tier) dice once level 17+ means there isn't
    one -- the move's own two sentences turn out to be the SAME rule, just
    with a different mechanic depending on whether a higher tier exists.

    python migrate_effects_v26.py            # dry run
    python migrate_effects_v26.py --apply
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
    'Electro Ball': [
        {'kind': 'damage_note', 'condition': {'type': 'attacker_max_speed_above_target'},
         'nextTierOrDouble': True, 'note': "Your speed is higher than the target's"},
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
