#!/usr/bin/env python3
"""Move migration, forty-eighth slice: Covet and Thief -- item theft,
previously written off as blocked on "no held-item field anywhere in this
app." That was wrong: `item` is a real, populated, DISPLAYED per-participant
field (a comma-separated freeform string, same shape as `abilities` --
routes_combat.py's own `_add_participant`), rendered on the combat card
(combat.js's `renderItemForCombat`). What was actually missing was a WRITE
path -- `item` was only ever set once, at participant-creation time from
the sheet's own data, with no action to change it during combat at all.

Fixed with a new `_update_item` (`update-item` action), a plain client-
authoritative field sync -- same trust model `_update_stats` already uses
for HP/VP. Unlike the ability-swap group (Entrainment/Role Play/Simple
Beam/Skill Swap, still unmigrated -- see move-effects-schema.md's own "not
covered yet" note), an item transfer is PERMANENT, not "for a duration",
so there's no restore-on-expiry problem to design around at all.

New `kind: "steal_item"` effect, handled by `_handleStealItem`: checks the
ATTACKER's own "not currently holding one" gate (both Covet's and Thief's
own version of it) inside the handler rather than via the generic `when`
vocabulary -- neither reads naturally as an attack-roll/save condition,
they're both about the attacker's own unrelated state. If the target holds
more than one item, takes the first-listed one -- a documented
simplification rather than a new "choose which item" picker, since this
app's own data rarely populates more than one anyway.

- **Covet** ("On a successful attack, you steal the opponent's held item
  if you are not currently holding one"): `when: {type:"on_hit"}`.
- **Thief** ("the target must make a DEX save... or have their item
  stolen"): `when: {type:"save_fail", ability:"DEX", requires:"hit"}` --
  the save only happens after the attack roll hits, matching the move's own
  text exactly.

    python migrate_effects_v48.py            # dry run
    python migrate_effects_v48.py --apply
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


INSTANT = [{'type': 'instant'}]

OVERRIDES = {
    'Covet': {
        'effects': [
            {'kind': 'steal_item', 'when': {'type': 'on_hit'}, 'ends': INSTANT},
        ],
    },
    'Thief': {
        'effects': [
            {'kind': 'steal_item', 'when': {'type': 'save_fail', 'ability': 'DEX', 'requires': 'hit'}, 'ends': INSTANT},
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
