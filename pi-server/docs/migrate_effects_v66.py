"""Move migration, sixty-sixth slice: attack-roll scoping.

- **Nasty Plot** -- advantage on attacks with a Wisdom move power: a `roll` effect with `ability:
  'WIS'`, which `attackRollContext` now honors for attack rolls (the move's own stat list, via
  target-picker's injected `setMoveAbilityResolver`, must include it). The "target has disadvantage
  on a WIS save against your move" half: a `saves_against_its_moves` disadvantage, now also
  ability-scoped (`_abilityMatches`).
- **Study** -- advantage on attack rolls against ONE chosen target: a new `against` status field
  (the picked target's id, applied to the caster; `attackRollContext` skips it for any other target).
  The ability-check half has no consumer (this app has no ability-check roll).
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
    'Nasty Plot': {
        'effects': [
            {'kind': 'roll', 'roll': 'advantage', 'on': 'attack_rolls', 'ability': 'WIS', 'when': ALWAYS, 'target': 'self',
             'ends': [{'type': 'rounds', 'n': 10}, {'type': 'concentration'}]},
            {'kind': 'roll', 'roll': 'disadvantage', 'on': 'saves_against_its_moves', 'ability': 'WIS', 'when': ALWAYS, 'target': 'self',
             'ends': [{'type': 'rounds', 'n': 10}, {'type': 'concentration'}]},
        ],
    },
    'Study': {
        'effects': [
            {'kind': 'roll', 'roll': 'advantage', 'on': 'attack_rolls', 'against': True, 'when': ALWAYS,
             'ends': [{'type': 'rounds', 'n': 10}, {'type': 'concentration'}],
             'note': 'Ability-check advantage is not enforced (no ability-check roll exists in this app).'},
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
