#!/usr/bin/env python3
"""Move migration, nineteenth slice: the two protect_negate pieces that
turned out achievable with what already exists, once actually designed --
see move-effects-schema.md's own updated `block_attack` section for the
full reasoning on both, and why the rest (Wide Guard, Spiky Shield,
Nature's Embrace, Lucky Chant, Feint) still isn't.

  - Parry: reuses `block_attack` as-is, just not auto-offered -- `when:
    {type: "special"}` (the vocab's existing "human judges this entirely"
    catch-all) makes it show unchecked in the effects popup instead of
    pre-selected, since using it correctly requires the player to have
    already declared they won the contested roll. No new code.
  - `ignoresProtect` (a new top-level field next to reactionTrigger/
    reactionRange): the other half of "Protect and Detect reactions may
    not be used when hit by this attack" -- routes_combat.py's
    _eligible_reactors now drops any candidate's block_attack move from
    the eligible set (not the whole participant) when the ATTACKING move
    carries this flag. Set on the seven moves whose own text says exactly
    that: Aqua Phase, Astral Jet, Fly, Hyperspace Hole, Phantom Force,
    Phantom Tendril, Shadow Force. None of these get `effects` here --
    this is a pure top-level flag, independent of whatever each move's own
    (still unmigrated, for its own separate reasons) effects eventually are.

    python migrate_effects_v21.py            # dry run
    python migrate_effects_v21.py --apply
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


PARRY_META = {'trigger': 'targeted', 'range': 0}
PARRY_EFFECTS = [
    {'kind': 'block_attack', 'when': {'type': 'special'}, 'target': 'self', 'ends': [{'type': 'instant'}],
     'note': 'Only if you already won the contested STR/DEX roll (natural 19-20 always succeeds).'},
]

IGNORES_PROTECT = {
    'Aqua Phase', 'Astral Jet', 'Fly', 'Hyperspace Hole', 'Phantom Force',
    'Phantom Tendril', 'Shadow Force',
}


def main():
    apply_it = '--apply' in sys.argv
    data = json.loads(FILE.read_text(encoding='utf-8'))
    moves = data['moves']
    by_name = {m['name']: m for m in moves}

    missing = [n for n in ({'Parry'} | IGNORES_PROTECT) if n not in by_name]
    if missing:
        print('ERROR -- unknown move names:', missing)
        sys.exit(1)
    if by_name['Parry'].get('effects'):
        print('ERROR -- Parry already has effects (would overwrite)')
        sys.exit(1)
    if by_name['Parry'].get('reactionTrigger'):
        print('ERROR -- Parry already has reaction metadata (would overwrite)')
        sys.exit(1)
    already_flagged = [n for n in IGNORES_PROTECT if by_name[n].get('ignoresProtect')]
    if already_flagged:
        print('ERROR -- already flagged ignoresProtect:', already_flagged)
        sys.exit(1)

    print(f'Parry (trigger={PARRY_META["trigger"]}, range={PARRY_META["range"]}ft):')
    for e in PARRY_EFFECTS:
        print('   ', json.dumps(e, ensure_ascii=False))
    print(f'\n{len(IGNORES_PROTECT)} moves getting ignoresProtect=true:')
    for name in sorted(IGNORES_PROTECT):
        print(f'  - {name}')

    if not apply_it:
        return
    parry = by_name['Parry']
    parry['reactionTrigger'] = PARRY_META['trigger']
    parry['reactionRange'] = PARRY_META['range']
    parry['effects'] = PARRY_EFFECTS
    parry['categories'] = rebuild_categories(parry['categories'], PARRY_EFFECTS)
    for name in IGNORES_PROTECT:
        by_name[name]['ignoresProtect'] = True
    FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
    print('\nwritten')


if __name__ == '__main__':
    main()
