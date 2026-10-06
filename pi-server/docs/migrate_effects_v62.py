"""Move migration, sixty-second slice (continuing section 1 of unmigrated_moves.md).

**Fell Stinger** -- "if this attack causes the target to faint, double your
ability modifier for attack rolls and damage on your next turn." Three new
pieces: a `target_fainted` `when` type (the server's `_apply_damage_to_target`
now returns `targetFainted`, HP <= 0, threaded into the effect ctx), a
`stat` amount sentinel `{moveModifier: true}` (resolved client-side to the
move's own best modifier -- "double" = add it once more), and a live
`damage_rolls` consumer (`damageRollBonusOf` -> `computeMoveData`'s new
`damageRollBonus` param, WIP-bridged like `stabMultiplier`). The consumer
also finally backs `damage_rolls` for Artifact Light's un-applied damage half
(not migrated here: that one is a proficiency amount, not a flat number).
Ends at the end of the holder's next turn.
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
    'Fell Stinger': {
        'effects': [
            {'kind': 'stat', 'stat': 'attack_rolls', 'amount': {'moveModifier': True}, 'when': {'type': 'target_fainted'}, 'target': 'self',
             'ends': [{'type': 'until_turn', 'whose': 'holder', 'point': 'end', 'count': 1}]},
            {'kind': 'stat', 'stat': 'damage_rolls', 'amount': {'moveModifier': True}, 'when': {'type': 'target_fainted'}, 'target': 'self',
             'ends': [{'type': 'until_turn', 'whose': 'holder', 'point': 'end', 'count': 1}]},
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
