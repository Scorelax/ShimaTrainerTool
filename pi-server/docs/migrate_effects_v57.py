#!/usr/bin/env python3
"""Move migration, fifty-seventh slice: `remove_item_on_target` (3 moves,
the last of the size-ordered `drain`-and-smaller categories). All three
reuse the `item` field + `update-item` action built earlier for Covet/Thief
(`steal_disrupt`), just with two new shapes that field already supports
fine but `steal_item`'s own handler doesn't:

- **Knock Off** ("any held item of the target falls to the ground...
  for the rest of battle"): new `kind:"drop_item"` -- nothing moves to the
  attacker at all, the item is just gone. `_handleDropItem` (combat-wip.js)
  clears the target's own `item` field, no gate on the attacker's state
  (unlike steal_item, Knock Off doesn't care whether they're already
  holding something).

- **Switcheroo** (DEX save, "take their held item and replace it with your
  own; if you do not have one, you simply take theirs without
  replacement") and **Trick** (melee attack roll, "swapping held items...
  on a hit"): new `kind:"swap_item"` -- a full two-way exchange of the
  WHOLE `item` string on each side (not steal_item's "only if empty-handed,
  take just their first-listed item" shape -- there's no one-item
  constraint on a straight swap). `_handleSwapItem` covers Switcheroo's own
  "without replacement" clause for free: swapping an empty string into the
  target IS "no replacement given", no special-casing needed. Same
  "permanent, no duration, no restore-on-expiry" shape steal_item already
  established -- just two already-built mechanisms (a field clear, a field
  swap) over the same already-populated `item` data, no new infrastructure
  beyond the two small kinds.

This closes `remove_item_on_target` (3/3) and finishes the size-ordered
`drain`-and-smaller run entirely -- what remains unmigrated now is all
leftover one-offs flagged as genuinely novel inside categories already
visited (Echoed Voice/Round from `potential_damage_increase`, Cactus Bloom
from `heal_target_or_aoe`, Stored Power from `conditional_damage`, Throat
Chop from `attack_suppression`), plus the larger not-yet-touched
categories (`field_terrain`/`field_weather`, `positioning` remainder,
`protect_negate` remainder, `steal_disrupt` remainder) and the 32 "unknown"
moves needing manual review.

    python migrate_effects_v57.py            # dry run
    python migrate_effects_v57.py --apply
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
    'Knock Off': {
        'effects': [
            {'kind': 'drop_item', 'when': {'type': 'on_hit'}, 'ends': [{'type': 'instant'}]},
        ],
    },
    'Switcheroo': {
        'effects': [
            {'kind': 'swap_item', 'when': {'type': 'save_fail', 'ability': 'DEX'}, 'ends': [{'type': 'instant'}]},
        ],
    },
    'Trick': {
        'effects': [
            {'kind': 'swap_item', 'when': {'type': 'on_hit'}, 'ends': [{'type': 'instant'}]},
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
