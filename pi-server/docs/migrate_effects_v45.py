#!/usr/bin/env python3
"""Move migration, forty-fifth slice: Psycho Shift and Searing Flame --
`steal_disrupt`'s "choose which status" pair, the category's own version of
the "player picks which stat" gap migrate_effects_v44.py just closed for
numeric stats.

Both need the human to pick ONE status from a participant's CURRENT list --
a dynamic set with no fixed vocabulary (unlike a stat name or a Pokémon
type), so a new small popup, `pickOneStatus` (js/utils/status-picker.js),
lists whatever's actually live right now as clickable options instead of a
dropdown of pre-known choices.

Two new `stat_transfer` modes (reusing `_handleStatTransfer`'s existing
`remove`/`recreate` helpers -- the only new piece either needs is the
picker call):

- **Psycho Shift** ("Choose a willing ally (or yourself) and a creature in
  range... a status affecting the ally (or you) is transferred to the
  target instead"): `mode: "transfer_condition"`, shipped self-only as a
  documented simplification -- this app has no mechanism to pick a THIRD
  participant (the ally) on top of the caster and the save-target, and the
  move's own text already treats "yourself" as the always-available case.
  Moves one `kind:'condition'` status from the caster to the target.

- **Searing Flame** ("burns away one positive effect on a hostile target,
  or one negative effect if used on an ally"): `mode: "dispel_one"`. This
  app has no team/faction concept to tell hostile from ally itself (the
  same documented gap `blocking_shield` already has for Mist/Safeguard), so
  rather than guess, the picker shows the target's WHOLE current list (stat
  AND condition statuses both) and trusts the human to pick the one that
  actually fits their own hostile-or-ally use.

    python migrate_effects_v45.py            # dry run
    python migrate_effects_v45.py --apply
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
    'Psycho Shift': {
        'effects': [
            {
                'kind': 'stat_transfer', 'mode': 'transfer_condition', 'when': {'type': 'save_fail', 'ability': 'WIS'}, 'ends': INSTANT,
                'note': "Self-only -- this app can't pick a third ('willing ally') participant, only the caster and the save-target.",
            },
        ],
    },
    'Searing Flame': {
        'effects': [
            {'kind': 'stat_transfer', 'mode': 'dispel_one', 'when': {'type': 'on_hit'}, 'ends': INSTANT},
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
