#!/usr/bin/env python3
"""Move migration, twenty-seventh slice: Heavy Slam. "Add an additional
bonus to damage equal to your MOVE modifier for each size level you are
above a creature." (Sizes: Tiny, Small, Medium, Large, Huge, Gigantic.)

Two new pieces in move-effects.js, both target-conditional:
  - `attacker_size_above_target` condition -- Heavy Slam's own size scale
    (a new _sizeRank/_SIZE_RANK, not footprintForSize's cruder grid-
    footprint split), blank/unrecognized (every trainer, who carries no
    `size` at all) defaults to Medium.
  - `scalingBonus` now works target-conditionally too (previously only
    combat.js's self-conditional side had it, for Trump Card/Frustration/
    Return) -- its magnitude here is however many size levels the attacker
    outranks the target by, via the new _targetConditionMagnitude.

    python migrate_effects_v27.py            # dry run
    python migrate_effects_v27.py --apply
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


OVERRIDES = {
    'Heavy Slam': [
        {'kind': 'damage_note', 'condition': {'type': 'attacker_size_above_target'},
         'scalingBonus': {'amountPerUnit': 'moveModifier'}, 'note': '+MOVE mod per size level above the target'},
    ],
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
