#!/usr/bin/env python3
"""Move migration, sixtieth slice: `positioning` (5 moves). Read all 5
fresh, same "don't trust the coarse label" discipline as every category
this project has worked through:

- **Strafe** ("fly to a position within 30ft. of the target" after a hit,
  "ignoring your flying speed and any opportunity attacks") and
  **Pasta Portal**'s own self-reposition half ("disappear ... and
  reappear at an unoccupied point within range") share one real shape: a
  GRANTED reposition explicitly OUTSIDE the normal movement budget, not
  ordinary budgeted movement at all. Previously deferred (see this file's
  own `protect_negate`-era entry in move-effects-schema.md) specifically
  because the only existing map-click flow, `battle-map-popup.js`'s own
  stage/confirm movement UI, is a live, heavily-used tool built for
  ordinary budgeted movement -- retrofitting a bypass mode directly into
  it risked a blind refactor of something already working (the same
  reasoning Teleport was deferred for).

  Built properly this pass instead of deferring again: a brand new,
  entirely separate module, `utils/reposition-picker.js` -- reuses
  `battle-map-grid.js`'s own pure rendering helpers (the same ones
  `battle-map-popup.js` itself uses) but owns its own DOM/state, so
  nothing about ordinary movement can regress. Shows the board read-only,
  highlights every unoccupied cell within a given `maxFt` of a given
  anchor point, and resolves via `CombatAPI.setTokenPosition` -- the SAME
  unrestricted DM/setup action Ally Switch's own `teleport_swap` already
  reuses, since this genuinely isn't a `move-token` call either. New
  `kind:"reposition_near"` effect (`anchor:"target"|"self"` picks whose
  CURRENT position the radius is measured from -- Strafe's own "near the
  target" vs Pasta Portal's own "near wherever I currently stand"),
  `_handleRepositionNear` (combat-wip.js).

  Pasta Portal ships PARTIAL (the self-reposition half only, same
  "partial, flagged, not guessed" precedent as Acid Armor/Elemental
  Surge) -- its own lingering portal pair (a 3-turn, DEX-save-or-Crunch
  hazard for anyone ELSE passing through) needs a persistent MAP HAZARD
  system this app has nowhere (no wall/collision/trap system at all), and
  its own "counts as a success in a group DEX check to flee" PvE clause
  needs a group-flee-check mechanic that also doesn't exist. Both are
  genuinely separate, bigger systems, not a small increment on the
  reposition piece.

- **Quick Attack** ("as a bonus action, you can immediately move up to
  10ft and make a melee attack... without taking an attack of
  opportunity") needs NOTHING -- opportunity attacks aren't automated
  anywhere in this app, and the move's own bonus-action nature is already
  shown via its own `action` field text every time its popup opens, same
  "nothing hidden that needs surfacing" reasoning Round/Dig/U-turn/Volt
  Switch already got. The move IS tagged `movement`, not `positioning`,
  but confirmed here anyway since it came up by name.

- **U-turn** / **Volt Switch** ("move up to half your movement speed away
  ... not provoking opportunity attacks, OR your trainer must switch you
  out") also need nothing beyond what already exists: the "move away"
  half is ORDINARY budgeted movement (the existing battle-map-popup.js
  flow already covers it in full, opportunity attacks still not
  automated), and the "switch out" alternative is blocked on the same
  already-documented "no switch-Pokemon mechanic in the shared system"
  gap cited everywhere else it comes up (U-turn's own `switch` category
  tag is the same marker). Already-decided precedent (see Dig/U-turn/Volt
  Switch named explicitly in an earlier `heal_target_or_aoe`-era entry) --
  confirmed still correct on a fresh read, not re-litigated.

- **Block** ("if an opponent attempts to flee or switch out, stop it")
  has nothing to hook into at all -- there's no flee/switch-out ACTION
  anywhere in the shared system for a reaction window to trigger off of
  (the same missing switch mechanic U-turn/Volt Switch are blocked on).
  Stays unmigrated.

    python migrate_effects_v60.py            # dry run
    python migrate_effects_v60.py --apply
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
    'Strafe': {
        'effects': [
            {'kind': 'reposition_near', 'anchor': 'target', 'maxFt': 30, 'when': {'type': 'on_hit'}, 'target': 'self', 'ends': INSTANT},
        ],
    },
    'Pasta Portal': {
        'effects': [
            {
                'kind': 'reposition_near', 'anchor': 'self', 'maxFt': 40, 'when': {'type': 'always'}, 'target': 'self', 'ends': INSTANT,
                'note': 'Self-reposition only -- the lingering portal hazard and the group-flee-check clause both need separate systems this app has nowhere.',
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

    print('\nConfirmed needing NOTHING (no effects change) -- Quick Attack, U-turn, Volt Switch, Block')

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
