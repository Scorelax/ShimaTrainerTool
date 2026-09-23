#!/usr/bin/env python3
"""Move migration, twelfth slice: Ingrain's own "may not move or be switched
out" clause -- migrate_effects_v13.py gave it a real heal-over-time effect
but never modeled this half at all, a gap the user noticed directly.

Unlike every prior script here, this one ADDS an effect to a move that
already has some (Ingrain's own heal-over-time from v13) rather than
setting `effects` fresh -- so its own guard is "does it already have a
`trapped` condition", not "does it already have effects at all".

Reuses the EXISTING `trapped` condition (no new vocabulary needed) --
migrate_effects_v2.py's own OTHER_TO_CONDITION already defines it as
"cannot flee or be switched out", and Thousand Waves already uses it, so it
already covers Ingrain's "switched out" half by definition. The "move"
half is new, real enforcement: routes_combat.py's `_move_token` now rejects
outright for a mover with any condition in `_MOVEMENT_BLOCKING_CONDITIONS`
(just `trapped` for now) -- the first condition in this whole schema to get
actual mechanical teeth, everything else is still just a badge (see
move-effects-schema.md's own "Not applied yet" note). Switching itself
still isn't blocked anywhere in the SHARED system -- there's no shared
switch-Pokemon mechanic at all yet, only the legacy combat.js engine has
one (and its own separate, already-working Ingrain-specific lock, keyed
off its own local state, not this) -- deliberately left alone; scoped
here to `_move_token`, everything else about movement/positioning
(distance limits, terrain, the shared switch mechanic, the other 20-ish
movement/positioning-tagged moves) stays exactly as out of scope as it was.

    python migrate_effects_v14.py            # dry run
    python migrate_effects_v14.py --apply
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from migrate_effects_v2 import tag_for
from migrate_effects_v3 import RETIRED_V3

FILE = Path(__file__).with_name('DnD_moves_categorized_draft.json')


def rebuild_categories(cats, effects):
    # Same splice-into-RETIRED_V3-or-append logic as every migration script
    # since v9, with one real fix: `effects` here is the move's FULL list
    # (old + new, since this script ADDS to Ingrain's existing effects
    # rather than setting them fresh), so a tag already present (self_heal,
    # from Ingrain's own existing heal effect) needs to be SKIPPED, not
    # re-appended -- every prior script's version of this function only
    # ever ran against a move's FIRST set of effects, so `derived` and
    # `cats` never actually overlapped and this bug never manifested; it's
    # real here, caught before landing (an earlier draft of this script
    # produced a duplicate "self_heal" entry).
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


ADDED_EFFECT = {
    'kind': 'condition', 'apply': 'trapped', 'when': {'type': 'always'}, 'target': 'self',
    'ends': [{'type': 'rounds', 'n': 3}],
    'note': "Also covers this move's own \"cannot be switched out\" -- trapped already means "
            "exactly that. Movement is enforced server-side (_move_token); switching isn't, "
            "since the shared system has no switch-Pokemon mechanic of its own yet.",
}


def main():
    apply_it = '--apply' in sys.argv
    data = json.loads(FILE.read_text(encoding='utf-8'))
    by_name = {m['name']: m for m in data['moves']}

    m = by_name.get('Ingrain')
    if not m:
        print('ERROR -- Ingrain not found')
        sys.exit(1)
    existing = m.get('effects') or []
    if any(e.get('kind') == 'condition' and e.get('apply') == 'trapped' for e in existing):
        print('ERROR -- Ingrain already has a trapped condition effect')
        sys.exit(1)

    new_effects = existing + [ADDED_EFFECT]
    print('## Ingrain -- adding:')
    print('   ', json.dumps(ADDED_EFFECT, ensure_ascii=False))
    print(f'   (keeping {len(existing)} existing effect(s) as-is)')

    if not apply_it:
        return
    m['effects'] = new_effects
    m['categories'] = rebuild_categories(m['categories'], new_effects)
    FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
    print('\nwritten')


if __name__ == '__main__':
    main()
