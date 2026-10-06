"""Move migration, seventy-third slice: the `movement` category.

- **Teleport** -- "reappear at an unoccupied point within range" (40ft): the `reposition_near` effect
  built for Pasta Portal (`anchor:'self'`), which bypasses the movement budget via the reposition
  picker. Not modeled: the wild-battle group-flee success, and the 20VP bonus-action variant (a cost
  choice, noted).
- **Phase** -- "move up to 30ft through solid matter": the same effect, 30ft. "Through solid matter"
  and "no opportunity attacks" are moot (no walls or opportunity attacks in this app); "may not end
  inside solid matter" has nothing to check.
- **Quick Attack, Extreme Speed, Splash** need no effect at all -- recorded in
  generate_unmigrated_moves.py's HANDLED_OUTSIDE_SCHEMA with reasons (user confirmed Extreme Speed is
  Quick Attack with more movement).
- **Retaliate** is NOT done: its trigger ("a creature causes an ally to faint") needs a
  participant-fainted reaction trigger that doesn't exist (same gap as Cactus Bloom).
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
    'Teleport': {
        'effects': [
            {'kind': 'reposition_near', 'anchor': 'self', 'maxFt': 40, 'when': ALWAYS, 'target': 'self', 'ends': [{'type': 'instant'}],
             'note': 'The wild-battle group-flee success and the 20VP bonus-action variant are not modeled.'},
        ],
    },
    'Phase': {
        'effects': [
            {'kind': 'reposition_near', 'anchor': 'self', 'maxFt': 30, 'when': ALWAYS, 'target': 'self', 'ends': [{'type': 'instant'}],
             'note': 'Through solid matter / no opportunity attacks: neither exists in this app.'},
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
