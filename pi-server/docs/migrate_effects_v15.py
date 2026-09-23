#!/usr/bin/env python3
"""Move migration, thirteenth slice: pure category cleanup, no `effects` at
all -- the "ten moves whose own fixed 'crits on 19-20' is already fully
handled by the existing base_crit tag (no effects needed at all)" the
schema doc's own "Not covered yet" section already named. They were still
sitting in unmigrated_moves.md's "fits the schema, just not migrated" bucket
because that bucket only checks for a RETIRED_V3 tag (`crit_range_mod` is
one) -- it has no way to know some of those moves need a category swap
instead of an OVERRIDES entry.

Two groups:
  - Already has `base_crit` (the ACTUAL mechanism -- see combat-wip.js's
    critThreshold call) alongside the stale `crit_range_mod` tag: just drop
    the stale tag. Crabhammer, Cut, Leaf Blade, Psycho Cut, Razor Leaf,
    Shadow Claw, Slash.
  - Has `crit_range_mod` WITHOUT `base_crit` yet -- same fixed "crits on
    19-20" text, just never got the real tag: add `base_crit`, drop
    `crit_range_mod`. Air Cutter, Drill Peck, Karate Chop.

    python migrate_effects_v15.py            # dry run
    python migrate_effects_v15.py --apply
"""
import json
import sys
from pathlib import Path

FILE = Path(__file__).with_name('DnD_moves_categorized_draft.json')

DROP_ONLY = {'Crabhammer', 'Cut', 'Leaf Blade', 'Psycho Cut', 'Razor Leaf', 'Shadow Claw', 'Slash'}
ADD_BASE_CRIT = {'Air Cutter', 'Drill Peck', 'Karate Chop'}
ALL_NAMES = DROP_ONLY | ADD_BASE_CRIT


def main():
    apply_it = '--apply' in sys.argv
    data = json.loads(FILE.read_text(encoding='utf-8'))
    by_name = {m['name']: m for m in data['moves']}

    missing = [n for n in ALL_NAMES if n not in by_name]
    if missing:
        print('ERROR -- unknown move names:', missing)
        sys.exit(1)
    wrong_shape = [n for n in ALL_NAMES if 'crit_range_mod' not in by_name[n]['categories']]
    if wrong_shape:
        print('ERROR -- missing crit_range_mod tag (already cleaned up?):', wrong_shape)
        sys.exit(1)

    for name in sorted(ALL_NAMES):
        cats = by_name[name]['categories']
        action = 'add base_crit, drop crit_range_mod' if name in ADD_BASE_CRIT else 'drop crit_range_mod'
        print(f'## {name}  ({action})  -- currently {cats}')

    if not apply_it:
        return
    for name in ALL_NAMES:
        m = by_name[name]
        cats = [c for c in m['categories'] if c != 'crit_range_mod']
        if name in ADD_BASE_CRIT and 'base_crit' not in cats:
            cats.append('base_crit')
        m['categories'] = cats
    FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
    print('\nwritten')


if __name__ == '__main__':
    main()
