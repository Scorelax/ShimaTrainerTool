#!/usr/bin/env python3
"""Bugfix slice: Speed Swap never actually worked.

migrate_effects_v44.py (steal_disrupt) shipped Speed Swap as
`stat_transfer`/`swap_value` with `field:"speed"`, modeled on Guard Swap's
own `field:"ac"`. That assumption was wrong: `effectiveStats(p).speed` is
always `undefined` -- `speed` was never one of the flat scalar fields
`effectiveStats` resolves (only `ac`/`crit`/the six ability scores are, see
move-effects.js's own `_FLAT_KEYS`/`_SCORE_KEYS`). A participant's actual
movement lives in `speeds`, a whole ARRAY of `{type, ft}` entries (walking/
flying/swimming/...), a different shape `swap_value`'s whole design assumes
away. In practice this meant Speed Swap's own handler always hit the
"couldn't read AC/SPEED for both sides" fallback and never swapped
anything -- caught while reading every move in `movement` (Ascension/Phase
also touch `speeds`, which is what surfaced this).

Fixed with a new `stat_transfer` mode, `"swap_fastest_speed"`
(combat-wip.js's own `_handleStatTransfer`): reads each side's own FASTEST
recorded speed (`maxSpeed`, exported from move-effects.js -- the same
helper Electro Ball's own comparison already used internally) as a
reasonable approximation of "their speed" rather than attempting a full
per-type array swap, and carries the swapped value as a new
`apply:"speed_override"` CONDITION instead of a `kind:'stat'` one (nothing
reads a stat-kind "speed" field either). `_movement_budget`
(routes_combat.py) now checks for it and, when present, replaces the
holder's entire `speeds` list with just that one overridden number for the
duration -- the existing status `ends` machinery handles expiry with no
extra code, same as every other temporary condition here.

This script OVERWRITES Speed Swap's existing (broken) effect -- the only
reason `--apply` doesn't hit the usual "already have effects" guard is that
this file explicitly allows it for names in `FORCE_OVERWRITE`.

    python migrate_effects_v52.py            # dry run
    python migrate_effects_v52.py --apply
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from migrate_effects_v2 import tag_for
from migrate_effects_v3 import RETIRED_V3

FILE = Path(__file__).with_name('DnD_moves_categorized_draft.json')

FORCE_OVERWRITE = {'Speed Swap'}


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
    'Speed Swap': {
        'effects': [
            {'kind': 'stat_transfer', 'mode': 'swap_fastest_speed', 'when': {'type': 'save_fail', 'ability': 'CHA'}, 'ends': [{'type': 'concentration'}]},
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
    already = [n for n in OVERRIDES if by_name.get(n, {}).get('effects') and n not in FORCE_OVERWRITE]
    if already:
        print('ERROR -- already have effects (would overwrite):', already)
        sys.exit(1)

    print(f'{len(OVERRIDES)} moves getting effects (bugfix overwrite)')
    for name, spec in OVERRIDES.items():
        effects = spec['effects']
        old = by_name[name].get('effects')
        print(f'## {name}  OLD={json.dumps(old, ensure_ascii=False)}')
        for e in effects:
            print(f'## {name}  NEW=', json.dumps(e, ensure_ascii=False))

    if not apply_it:
        return
    for name, spec in OVERRIDES.items():
        m = by_name[name]
        # This is an OVERWRITE, not a first migration -- the categories list
        # already carries tags DERIVED from the old (broken) effects, which
        # rebuild_categories's own RETIRED_V3 matching has no way to
        # recognize (it only knows the ORIGINAL hand-categorization tags).
        # Strip exactly those stale derived tags first, so the new ones
        # don't just pile up alongside them.
        stale = {tag_for(e) for e in (m.get('effects') or [])}
        m['categories'] = [c for c in m['categories'] if c not in stale]
        effects = spec['effects']
        m['effects'] = effects
        m['categories'] = rebuild_categories(m['categories'], effects)
    FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
    print('\nwritten')


if __name__ == '__main__':
    main()
