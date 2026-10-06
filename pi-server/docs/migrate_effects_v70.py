"""Move migration, seventieth slice.

**Wing Command** -- allies in range get a bonus to attack rolls of 1d6 + the caster's CHA modifier
until the caster's next turn starts. Existing dice-bonus mechanism (`stat:'attack_rolls'`, `amount:
{dice}` -- the player rolls it and types the total when spending it), plus `moveMod:true` which now
folds the caster's modifier into the dice label ("1d6+3"). Caster-and-allies dual-effect shape as
Tailwind (the caster isn't listed in the text, so only the ally-picked effect is authored). "Can see
you" is a human judgment. Ends at the start of the CASTER's next turn (`whose:'source'`).
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
    'Wing Command': {
        'effects': [
            {'kind': 'stat', 'stat': 'attack_rolls', 'amount': {'dice': '1d6', 'moveMod': True}, 'when': ALWAYS,
             'ends': [{'type': 'until_turn', 'whose': 'source', 'point': 'start', 'count': 1}],
             'note': 'Allies in range that can see the caster.'},
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
