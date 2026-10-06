"""Move migration, seventy-second slice.

**Power-Up Punch** -- each hit adds a stack (max = the caster's proficiency): a stackable `power_up`
condition (the server now allows `stacks` on this one condition; `stacks.max:'proficiency'` is
resolved from the caster at apply time). Each stack adds 1d6 to the holder's MELEE damage rolls
(combat.js appends a `Nd6` term from the WIP-bridged `powerUpStacks`) and +1 VP to every melee
move's cost (folded into `vpCostOverride`). Applying any incapacitating condition strips the stacks
(`_apply_status`). Ends with the encounter, per "lost at the end of combat".
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
    'Power-Up Punch': {
        'effects': [
            {'kind': 'condition', 'apply': 'power_up', 'stacks': {'max': 'proficiency'}, 'when': {'type': 'on_hit'}, 'target': 'self',
             'ends': [{'type': 'encounter'}]},
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
