#!/usr/bin/env python3
"""Move migration, fourth slice continued: Guard Split -- held back from
migrate_effects_v5.py over a suspected routing gap (a self-target effect
gated on an ENEMY's save) that turned out not to apply here. Guard Split
already carries the trigger_saving_throw tag from an earlier categorization
pass (predating the effects system), which routes it to combat-wip.js's
_handleSaveTriggered -- that handler already picks a save target, rolls
their save, and offers the self effect with the outcome already known (see
its own pickSaveTarget/_offerMoveEffects call), no engine change needed
beyond the {avgWithTarget} resolver already built for it in
migrate_effects_v5.py's own slice. Confirmed no other move currently has
this self+enemy-save shape WITHOUT that tag (checked directly against the
live data), so the speculative _handleEffectsOnly fix drafted alongside
this was reverted rather than shipped unused.

    python migrate_effects_v6.py            # dry run
    python migrate_effects_v6.py --apply
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
                out.extend(derived)
                placed = True
            continue
        out.append(c)
    if not placed:
        out.extend(derived)
    return out


OVERRIDES = {
    # "your AC changes to become an average of your current AC and the target's,
    # rounded down" -- resolved against the target at apply time (see
    # combat-wip.js's _resolveSetValue), applied to the caster.
    'Guard Split': [{
        'kind': 'stat', 'stat': 'ac', 'when': {'type': 'save_fail', 'ability': 'CHA'},
        'set': {'avgWithTarget': 'ac'}, 'target': 'self',
        'ends': [{'type': 'rounds', 'n': 10}, {'type': 'concentration'}],
    }],
}


def main():
    apply_it = '--apply' in sys.argv
    data = json.loads(FILE.read_text(encoding='utf-8'))
    moves = data['moves']
    by_name = {m['name']: m for m in moves}

    missing = [n for n in OVERRIDES if n not in by_name]
    already = [n for n in OVERRIDES if by_name.get(n, {}).get('effects')]
    if missing:
        print('ERROR -- unknown move names:', missing)
        sys.exit(1)
    if already:
        print('ERROR -- already have effects (would overwrite):', already)
        sys.exit(1)

    print(f'{len(OVERRIDES)} moves, {sum(len(v) for v in OVERRIDES.values())} effects')
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
