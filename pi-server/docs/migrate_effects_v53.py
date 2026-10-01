#!/usr/bin/env python3
"""Move migration, fifty-third slice: `movement` (8 moves), the next
category after `heal_target_or_aoe`. Built alongside migrate_effects_v52.py's
Speed Swap bugfix, which this category's own reading surfaced.

- **Ascension** ("their flight speed becomes 30ft for the duration"): a new
  `apply:"granted_flight_speed"` condition, checked generically by
  `_movement_budget` (routes_combat.py) -- ADDS a `{type:"flying", ft}`
  entry alongside the target's own recorded `speeds` rather than replacing
  them (the opposite of Speed Swap's own `speed_override`, see
  migrate_effects_v52.py), since this is a genuinely NEW movement type the
  target didn't have before, not a replacement of an existing one. Works
  even for a participant with no `speeds` recorded at all. `target` unset
  (grants to a chosen creature), `ends:{rounds, n:10}` (the move's own
  stated "1 minute").

- **Ally Switch** ("switching places on the battlefield"): a new
  `kind:"teleport_swap"` effect, `_handleTeleportSwap` (combat-wip.js) --
  reads both tokens' CURRENT board positions and swaps them via two
  `set-token-position` calls (the same unrestricted reposition the DM's own
  board editor already uses, "NOT turn-gated" by design). No new cell to
  PICK at all here -- both destinations are already known (wherever the
  OTHER creature stands), which is exactly what makes this buildable while
  Teleport (below) isn't.

The remaining 6 are NOT migrated this pass:
- **Teleport** ("reappear at an unoccupied point within range") needs the
  human to pick an ARBITRARY new cell, and the battle-map's own grid has no
  coordinate labels anywhere (`gridCellsHtml` renders blank clickable
  squares) -- there's nothing a text prompt could ask for that the human
  could read back off the actual physical display. Would need a real
  "teleport mode" added to battle-map-popup.js's own existing stage/confirm
  click flow (skip the distance check, call set-token-position instead of
  move-token) -- a live, heavily-used tool this pass isn't risking a blind
  refactor of. Also references the same unbuilt "flee the whole encounter"
  group-check mechanic Pasta Portal's own deferral already named.
- **Extreme Speed** / **Quick Attack** ("you can immediately move up to
  Xft... without taking an attack of opportunity") need no new effect at
  all -- opportunity attacks aren't automated anywhere in this app, and the
  movement itself is ordinary budgeted movement a player can already use
  via the existing map UI, same reasoning U-turn/Volt Switch already got.
- **Phase** ("move up to 30ft through solid matter... no opportunity
  attacks while phasing") -- "through solid matter" is moot on its own
  terms: this app has no wall/collision system at all (confirmed for Shield
  Dome's own deferral), so normal movement already passes through anything.
  Its own 30ft figure plausibly exceeds a plain walker's normal speed,
  which WOULD need a temporary speed grant like Ascension's -- but unlike
  Ascension granting a named, real movement type (flight) to another
  creature, Phase's own "phasing" has no distinct mechanical identity
  separate from ordinary movement once walls are moot, so there's nothing
  for a `granted_X_speed`-style condition to meaningfully name here. Left
  unmigrated rather than overreaching a generic "+30ft" grant onto a
  condition name that wouldn't mean anything.
- **Splash** ("you can leap up to 50 feet in the air") -- flavor-only; this
  app's grid has no vertical/altitude dimension for a leap to interact with
  at all.
- **Retaliate** ("When a creature causes an ally to faint, you may move...
  and attack") -- reacts to a "participant just fainted" event, the exact
  same unbuilt reaction trigger Cactus Bloom's own deferral already named
  (see heal_target_or_aoe's own update note) -- nothing like it exists
  anywhere in this app's reaction model.

    python migrate_effects_v53.py            # dry run
    python migrate_effects_v53.py --apply
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
    'Ascension': {
        'effects': [
            {'kind': 'condition', 'apply': 'granted_flight_speed', 'value': 30, 'when': ALWAYS, 'ends': [{'type': 'rounds', 'n': 10}]},
        ],
    },
    'Ally Switch': {
        'effects': [
            {'kind': 'teleport_swap', 'when': ALWAYS, 'ends': INSTANT},
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
