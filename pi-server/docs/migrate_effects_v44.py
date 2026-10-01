#!/usr/bin/env python3
"""Move migration, forty-fourth slice: `steal_disrupt` (18 moves), the next
category after `protect_negate` was fully closed out. Starting with the
genuinely easy ones, same "start easy, then push on what's actually
buildable" instruction as the protect_negate re-pass.

- **Defog** ("sweeps away any area of effect moves still active"): this app
  models weather/terrain as a single freeform {name, effect} pair EACH (not
  a stack of named effects -- see routes_combat.py's own state comment), so
  "clear every active field effect" is just clearing both to null. New
  `kind: "clear_field"`, special-cased in `_offerMoveEffects` to call the
  already-client-exposed `CombatAPI.setWeather('', '')`/`setTerrain('', '')`
  -- no new server action needed at all.

- **Guard Swap** / **Speed Swap** / **Power Swap**: a new `stat_transfer`
  mode, `"swap_value"` -- unlike the existing `"swap"` mode (which moves
  WHOLE `kind:'stat'` STATUS ENTRIES, built for Heart Swap's own stat-buff
  exchange), this swaps the CURRENT EFFECTIVE VALUE of one named field
  (`effectiveStats(p)[field]`, reading base stats AND active statuses both),
  since AC/speed/an ability score's current value can come from either --
  `"swap"`'s own move-status-entries approach has no way to capture that.
  Applies a `set`-override status to EACH side holding the OTHER's current
  value; the overlay model's existing snapshot-at-apply/restore-at-expiry
  behavior (`set` section, move-effects-schema.md) handles "for the
  duration" with no new code.

  Guard Swap (`field:"ac"`) and Speed Swap (`field:"speed"`) name their own
  stat directly, no choice needed. Power Swap's own text ("swap a SINGLE
  ability score... for purposes of attack and damage rolls") doesn't name
  one, so it ships with `field: null` -- effects-popup.js gets a new
  stat-choice dropdown (`_needsStatChoice`/`_statChoiceInput`, mirroring the
  EXISTING type-choice dropdown `type_changed`/`resistance_upgrade` already
  use) scoped to the six ability scores, asked ONCE per use (not per
  participant -- the swap is computed and applied to both sides inside one
  handler call, so there's no risk of the caster's and target's own pick
  ending up on two different fields, which two independent dropdowns on two
  sibling effects could never have guaranteed).

  This directly unblocks the EXACT gap move-effects-schema.md already
  flagged for a different category: "Power Trick (swap AC with an ability
  score) and Power Split (replace a CHOSEN score with an average) both also
  need a 'player picks which stat' mechanic that doesn't exist yet" -- it
  now does, for whenever those get migrated.

    python migrate_effects_v44.py            # dry run
    python migrate_effects_v44.py --apply
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
CONCENTRATION = [{'type': 'concentration'}]

OVERRIDES = {
    'Defog': {
        'effects': [
            {'kind': 'clear_field', 'when': ALWAYS, 'ends': INSTANT},
        ],
    },
    'Guard Swap': {
        'effects': [
            {'kind': 'stat_transfer', 'mode': 'swap_value', 'field': 'ac', 'when': {'type': 'save_fail', 'ability': 'CHA'}, 'ends': CONCENTRATION},
        ],
    },
    'Speed Swap': {
        'effects': [
            {'kind': 'stat_transfer', 'mode': 'swap_value', 'field': 'speed', 'when': {'type': 'save_fail', 'ability': 'CHA'}, 'ends': CONCENTRATION},
        ],
    },
    'Power Swap': {
        'effects': [
            {
                'kind': 'stat_transfer', 'mode': 'swap_value', 'field': None, 'when': {'type': 'save_fail', 'ability': 'WIS'},
                'ends': [{'type': 'until_turn', 'whose': 'holder', 'point': 'end', 'count': 1}],
            },
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
