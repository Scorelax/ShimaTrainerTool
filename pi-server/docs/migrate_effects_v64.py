"""Move migration, sixty-fourth slice: one shared "ignore type immunities" mechanism.

`_type_multiplier` (routes_combat.py) now takes the attacker too; a 0x chart result is treated as
neutral per defending type when `_immunity_ignored` says so (a type that's immune counts as 1x, the
other type still applies -- "it follows the secondary type"):
- **Foresight** -- attacker-side `ignore_immunities` condition (value = "Ghost,Normal,Fighting"),
  one move: a `uses` end, spent by `_consume_ignore_immunities` (binds to the first matching
  move + round so every AoE target benefits; any other matching move spends it).
- **Odor Sleuth** -- the same condition as a duration aura (no `uses`). NOT modeled: the target's
  "can't use AC-raising moves" clause (no move-category gate for that exists), and the range limit
  on whose immunities are lifted (applies to everyone the caster hits).
- **Miracle Eye** -- on a failed WIS save: a new `dispel_ac` stat_transfer mode (resets every AC
  modifier) plus a target-side `immunities_relinquished` condition. The "only if Dark/Ghost"
  clause is a human judgment (a note), since for any other type it has nothing to lift anyway.
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
    'Foresight': {
        'effects': [
            {'kind': 'condition', 'apply': 'ignore_immunities', 'value': 'Ghost,Normal,Fighting', 'when': ALWAYS, 'target': 'self', 'ends': [{'type': 'uses', 'n': 1}]},
        ],
    },
    'Odor Sleuth': {
        'effects': [
            {'kind': 'condition', 'apply': 'ignore_immunities', 'value': 'Ghost,Normal,Fighting', 'when': ALWAYS, 'target': 'self',
             'ends': [{'type': 'rounds', 'n': 10}, {'type': 'concentration'}],
             'note': "The target's inability to use AC-raising moves, and the range limit, are not enforced."},
        ],
    },
    'Miracle Eye': {
        'effects': [
            {'kind': 'stat_transfer', 'mode': 'dispel_ac', 'when': {'type': 'save_fail', 'ability': 'WIS'}, 'ends': [{'type': 'instant'}]},
            {'kind': 'condition', 'apply': 'immunities_relinquished', 'when': {'type': 'save_fail', 'ability': 'WIS'}, 'ends': [{'type': 'rounds', 'n': 10}],
             'note': 'Only meaningful if the target is Dark or Ghost type.'},
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
