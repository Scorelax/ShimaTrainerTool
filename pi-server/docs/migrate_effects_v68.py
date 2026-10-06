"""Move migration, sixty-eighth slice.

**Thunderstorm Dance** -- "all electric type moves are guaranteed to hit" for the concentration: a
standing `guaranteed_hit_type` condition (value = the move type), read by `_guaranteedHitFor`
alongside the one-shot guaranteed_next_hit/crit flags but NEVER consumed.
**Silent Approach** -- advantage on stealth checks / disadvantage to locate you are ability-check
shapes this app has no roll for; shipped as a reminder-only condition `silent_approach` (a badge
with the note), same advisory precedent as Blinded/Deafened's ability-check clauses.
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
    'Thunderstorm Dance': {
        'effects': [
            {'kind': 'condition', 'apply': 'guaranteed_hit_type', 'value': 'Electric', 'when': ALWAYS, 'target': 'self',
             'ends': [{'type': 'rounds', 'n': 10}, {'type': 'concentration'}]},
        ],
    },
    'Silent Approach': {
        'effects': [
            {'kind': 'condition', 'apply': 'silent_approach', 'when': ALWAYS, 'target': 'self',
             'ends': [{'type': 'rounds', 'n': 100}, {'type': 'concentration'}],
             'note': 'Advantage on stealth checks; others have disadvantage locating you by sight, smell or hearing. Reminder only -- no ability-check roll exists in this app.'},
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
