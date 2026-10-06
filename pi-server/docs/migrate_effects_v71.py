"""Move migration, seventy-first slice: the two moves held back since category 2/3.

Both turned out to fit the existing `swap_value` family with one new `stat_transfer` mode each (a
chosen field via effects-popup.js's stat dropdown, now with a per-mode option list):
- **Power Trick** -- `swap_own_ac`: the caster's AC and a chosen ability score (CON excluded) become
  `set` overrides holding each other's current value, until the end of the caster's next turn.
- **Power Split** -- `average_value`: on a failed CHA save, the caster's chosen score (STR/DEX/WIS)
  is overridden with the average (rounded down) of theirs and the target's, for the concentration.
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
INSTANT = [{'type': 'instant'}]

OVERRIDES = {
    'Power Trick': {
        'effects': [
            {'kind': 'stat_transfer', 'mode': 'swap_own_ac', 'field': None, 'target': 'self', 'when': ALWAYS,
             'ends': [{'type': 'until_turn', 'whose': 'holder', 'point': 'end', 'count': 1}]},
        ],
    },
    'Power Split': {
        'effects': [
            {'kind': 'stat_transfer', 'mode': 'average_value', 'field': None, 'when': {'type': 'save_fail', 'ability': 'CHA'},
             'ends': [{'type': 'rounds', 'n': 10}, {'type': 'concentration'}]},
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
