#!/usr/bin/env python3
"""Move migration, thirty-sixth slice: Haze -- a real miss from
migrate_effects_v35.py, caught by the user asking for a plain yes/no on
what was actually implemented. Haze was identified during that pass as
fitting the same stat_transfer mechanism (it's a broader "remove
everything" version of Clear Smog's dispel), but never actually migrated
or flagged as excluded -- a gap in that commit's own reporting, not a
deliberate call.

New `dispel_all` mode (alongside `stat_transfer`'s existing dispel/copy/
swap/steal, see combat-wip.js's `_handleStatTransfer`) -- Haze's own text
("stat bonuses or modifiers, status effects, shields or other outside
forces ... are removed") is broader than plain `dispel`, which only ever
touched `kind:'stat'`; this removes EVERY status regardless of kind.

Haze is also the first move authored with a `target:'self'` stat_transfer
effect -- it hits everyone in its own 30ft blast, caster included ("all
creatures in a 30ft circle, centered on you"). That exposed a real bug in
_offerMoveEffects's own call site: it was reading `targetId`/`attackerId`
straight from its enclosing closure instead of `pick.targetId`, which
happened to work for Clear Smog/Psych Up/Heart Swap/Spectral Thief only
because none of them are ever self-targeted (pick.targetId and the closure
targetId were always equal for those four). Fixed by reading
`pick.targetId` instead -- it resolves to attackerId for a target:'self'
effect and to the real target otherwise, so a single-participant mode
(dispel/dispel_all/copy/steal) now correctly reaches self too. `swap`
(the only two-participant mode) is unaffected -- it already read
attackerId from the closure on top of whatever targetId it's given.

Two effects on Haze: one `target:'self'` (the caster's own blast-radius
hit) and one target-unset (offered through the existing multi-target
picker -- `_handleEffectsOnly` already runs that loop for any move with a
non-self effect, no new wiring needed, same path Soothing Breeze's own AoE
heal already uses). A human picks who else was actually in the 30ft circle
-- this app has no positional AoE-radius detection at all, same
established limit as every other AoE move.

    python migrate_effects_v36.py            # dry run
    python migrate_effects_v36.py --apply
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
    'Haze': [
        {'kind': 'stat_transfer', 'mode': 'dispel_all', 'target': 'self', 'when': ALWAYS, 'ends': INSTANT},
        {'kind': 'stat_transfer', 'mode': 'dispel_all', 'when': ALWAYS, 'ends': INSTANT},
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
        print(f'## {name}  ({len(effects)} effect(s))')
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
