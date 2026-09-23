#!/usr/bin/env python3
"""Move migration, fifteenth slice: Hammer Arm and Ice Hammer -- the two
moves from the "fits schema already" batch (migrate_effects_v16.py) that
were blocked on a real, small, reusable gap: "disadvantage on DEX saves"
needs to scope to ONE ability, but a plain `roll`/`stat` effect on
`saving_throws` always applied to every save. Fixed with a new optional
`ability` field (move-effects-schema.md's own vocab section) -- unset still
applies broadly, so nothing else changes. Both moves' own "speed is halved"
clause is still deferred (movement, same call as every other move this
whole effort has left alone).

    python migrate_effects_v17.py            # dry run
    python migrate_effects_v17.py --apply
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


ALWAYS = {'type': 'always'}
ON_HIT = {'type': 'on_hit'}
UNTIL_HOLDER_END = [{'type': 'until_turn', 'whose': 'holder', 'point': 'end'}]

OVERRIDES = {
    # Self-inflicted overcommit cost -- applies regardless of whether the
    # hit lands, until the end of the caster's own next turn.
    'Hammer Arm': [
        {'kind': 'roll', 'roll': 'disadvantage', 'on': 'saving_throws', 'ability': 'DEX',
         'when': ALWAYS, 'target': 'self', 'ends': UNTIL_HOLDER_END},
    ],
    # On-hit consequence for the target, until the end of ITS own next turn
    # (target left unset -- defaults to whoever got hit).
    'Ice Hammer': [
        {'kind': 'roll', 'roll': 'disadvantage', 'on': 'saving_throws', 'ability': 'DEX',
         'when': ON_HIT, 'ends': UNTIL_HOLDER_END},
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
