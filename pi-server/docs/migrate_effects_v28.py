#!/usr/bin/env python3
"""Move migration, twenty-eighth slice: Self-Destruct's damage aspect (the
user's own explicit call: leave the forced-death-save/no-potions/recovery-
days mechanic out entirely, only the self-faint and the AoE damage).

Self-faint: a new, generic self_faint handler in combat.js's own onUseMove
(shared by both the legacy and WIP engines, since that callback already
runs for every move-use either way) -- 0 HP, nothing else, for any move
carrying the self_faint category (Lunar Dance, Memento, Final Gambit,
Self-Destruct, Healing Wish), not just this one.

AoE damage: "If your creature has at least half its hit points left,
anyone in range takes 4d12 + MOVE normal damage on a fail, or half as much
on a success. If less than half, halved for a failed save, quartered for a
success." This app's save-triggered flow only ever asked for a damage roll
on a FAIL before now (a passed save always closed with zero damage) --
save-picker.js gained an opt-in `damageOnPass` (default false, every other
save-triggered move keeps dealing zero damage on a pass) so a passed save
can carry a damage roll too, specifically for Self-Destruct
(combat-wip.js's own _handleMultiHitAoe, gated by move name). Once that
exists, "half as much on a success" is just the SAME assumption every
other save-triggered move in this app already makes by not automating it
(the human enters half when they roll it on a pass, same manual-arithmetic
convention as everywhere else) -- the only thing THIS move's damage_note
needs to add is the low-HP tier's own further halving, layered on top of
whichever of fail/pass the human is entering: totalMultiplier: 0.5 below
50% HP, the exact same shape Water Spout already uses (migrate_effects_v23.py).

    python migrate_effects_v28.py            # dry run
    python migrate_effects_v28.py --apply
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
    'Self-Destruct': [
        {'kind': 'damage_note', 'condition': {'type': 'self_hp_below', 'fraction': 0.5},
         'totalMultiplier': 0.5,
         'note': 'Below 50% HP -- halve the total damage after rolling, whether the target failed or passed its save (not the dice)'},
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
