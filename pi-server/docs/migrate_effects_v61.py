"""Move migration, sixty-first slice: the second half of the "fits the
schema already" list, taken from the top (see unmigrated_moves.md section 1).

**Blood Shield** -- "a shield equal to the melee damage you dealt since the
beginning of your last turn; will not stack if used consecutively." A
`temp_hp` effect whose amount is a new sentinel `{meleeDamageSinceLastTurn:
true}`, resolved client-side in combat-wip.js's `_offerMoveEffects` by
`_meleeDamageSinceLastTurn` (sums this participant's logged 'damage'
entries from the previous round on, keeping only moves whose range is
Melee -- the log has no range field, so each is looked up via findMoveRow).
"Won't stack" needs no code: re-applying a temp_hp status already REPLACES
the pool outright (_apply_status).
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
    'Blood Shield': {
        'effects': [
            {'kind': 'temp_hp', 'amount': {'meleeDamageSinceLastTurn': True}, 'when': ALWAYS, 'target': 'self', 'ends': [{'type': 'encounter'}]},
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
