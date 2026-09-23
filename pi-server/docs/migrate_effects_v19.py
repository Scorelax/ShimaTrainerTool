#!/usr/bin/env python3
"""Move migration, seventeenth slice: the core of `protect_negate` -- a new
`block_attack` effect kind (move-effects-schema.md's own section has the
full mechanism writeup: a new block-pending-attack server action, a new
reactionBlock session field, and target-picker.js/reaction-window.js now
actually able to cancel an attack before it resolves) plus the four moves
that fit it cleanly:

  - Protect, King's Shield: self only (reactionRange 0). King's Shield's
    own "blocks ALL damage until your next turn" (not just the one attack
    that opened the window) is left manual -- only the immediate block is
    modeled, same partial-implementation precedent as everywhere else.
  - Shield Guardian: reactionRange 5ft ("a creature next to you") --
    protects an ADJACENT ALLY, same mechanism Sentinel Strike/Baby-Doll
    Eyes already use for "someone else within range reacts on the
    anchor's behalf". No special handling needed for the ally case at all
    -- see the schema doc's own note on why.
  - Quick Guard: reactionRange 30ft (its own stated range). "First round
    of combat only" is already situational_use-tagged -- left manual.

Every one of these four ALSO has its own escalating "roll over 15 on a
d20" cost after the first use in an encounter -- no resource-tracking
mechanism for that yet, left manual same as everywhere else. Endure and
the rest of protect_negate are NOT in this batch -- see this file's own
module docstring... no, see move-effects-schema.md's `block_attack`
section for the full list of what's still excluded and why (custom math
on top of blocking, a third reaction timing, bypassing Protect
specifically -- meaningless until this exists, which it now does, but
isn't wired up on the attacking side yet).

    python migrate_effects_v19.py            # dry run
    python migrate_effects_v19.py --apply
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


def block_attack():
    return [{'kind': 'block_attack', 'when': ALWAYS, 'target': 'self', 'ends': [{'type': 'instant'}]}]


REACTION_META = {
    'Protect': {'trigger': 'targeted', 'range': 0},
    "King's Shield": {'trigger': 'targeted', 'range': 0},
    'Shield Guardian': {'trigger': 'targeted', 'range': 5},
    'Quick Guard': {'trigger': 'targeted', 'range': 30},
}

OVERRIDES = {name: block_attack() for name in REACTION_META}


def main():
    apply_it = '--apply' in sys.argv
    data = json.loads(FILE.read_text(encoding='utf-8'))
    moves = data['moves']
    by_name = {m['name']: m for m in moves}

    missing = [n for n in REACTION_META if n not in by_name]
    if missing:
        print('ERROR -- unknown move names:', missing)
        sys.exit(1)
    already = [n for n in OVERRIDES if by_name.get(n, {}).get('effects')]
    if already:
        print('ERROR -- already have effects (would overwrite):', already)
        sys.exit(1)
    already_meta = [n for n in REACTION_META if by_name.get(n, {}).get('reactionTrigger')]
    if already_meta:
        print('ERROR -- already have reaction metadata (would overwrite):', already_meta)
        sys.exit(1)

    print(f'{len(REACTION_META)} moves getting reaction metadata + block_attack effects')
    for name, meta in REACTION_META.items():
        print(f'## {name}  (trigger={meta["trigger"]}, range={meta["range"]}ft)')
        for e in OVERRIDES[name]:
            print('   ', json.dumps(e, ensure_ascii=False))

    if not apply_it:
        return
    for name, meta in REACTION_META.items():
        m = by_name[name]
        m['reactionTrigger'] = meta['trigger']
        m['reactionRange'] = meta['range']
        m['effects'] = OVERRIDES[name]
        m['categories'] = rebuild_categories(m['categories'], OVERRIDES[name])
    FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
    print('\nwritten')


if __name__ == '__main__':
    main()
