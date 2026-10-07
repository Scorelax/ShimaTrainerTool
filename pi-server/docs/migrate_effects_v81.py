"""Move migration, eighty-first slice: Purgatory, and height on the map.

**Height.** Every battle-map token now has an altitude `z` (feet above the ground, 5ft steps, 0 = on the ground):

- Only a creature that can leave the ground can climb -- a flying/hovering speed, Levitate, Magnet Rise, an airborne state
  (not `is_grounded`), or no `speeds` on record at all (a DM's freeform enemy is untracked, same convention as the
  movement budget). The map popup's toolbar shows ▲ ▼ only for those.
- Climbing and descending cost 1ft of movement per foot; a diagonal costs the larger of its horizontal and vertical parts
  (Chebyshev, like every other distance here). `move-token` takes an optional `z`; the server and the map popup share one
  cost rule (routes_combat.py's `_move_cost_ft` / move-effects.js's `moveCostFt`, checked equal on 600 random moves).
- A zone can have a `height` (ft above the ground it reaches): `terrains_affecting` / `terrainsAffecting` only count it for a
  creature at or below that altitude. No `height` = every altitude. Difficult terrain (Fissure) only slows a move that ENDS on
  the ground, so a flyer overhead isn't slowed.
- A flyer is drawn lifted off its tile with a ground shadow and an "↑15ft" badge (popup, picker and kiosk).

**Spikes** now has `height: 0` -- it sits on the floor, so a creature flying above it isn't hit (previously any non-immune
creature entering the zone was, flying or not).

**Purgatory** ("a 10ft. radius, 40ft. high cylinder from a point within range ... CON save: on a success lose 4d12 + MOVE VP,
on a failure the same and all stat changes are removed"): the VP damage and the save are the existing `damage_vp` /
`multi_hit_aoe` / `trigger_saving_throw` flow; the only thing left was "all stat changes are removed", the existing
`stat_transfer` `dispel` mode (Clear Smog, Haze), here on a failed CON save. And the cylinder is what the multi-target
picker's new **"Select from the map"** button uses: the caster marks the blast on the map (the circle stamp, sized from the
range text) and every creature whose token overlaps it AND is at or below 40ft (read from "40ft. high" in the description) is
ticked for them to adjust. That button appears for every move with a circular area ("Self (20ft. radius)", "50ft., 10ft.
radius"); lines and cones aren't supported yet.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from migrate_effects_v76 import rebuild_categories, INSTANT

FILE = Path(__file__).with_name('DnD_moves_categorized_draft.json')

PURGATORY = [{'kind': 'stat_transfer', 'mode': 'dispel', 'when': {'type': 'save_fail', 'ability': 'CON'}, 'ends': INSTANT}]


def main():
    apply_it = '--apply' in sys.argv
    data = json.loads(FILE.read_text(encoding='utf-8'))
    by_name = {m['name']: m for m in data['moves']}
    purgatory, spikes = by_name['Purgatory'], by_name['Spikes']
    if purgatory.get('effects'):
        print('ERROR -- Purgatory already has effects')
        sys.exit(1)
    spike_zone = next(e for e in spikes['effects'] if e.get('kind') == 'set_terrain')
    print('## Purgatory'); [print('   ', json.dumps(e)) for e in PURGATORY]
    print('## Spikes: set_terrain height ->', 0, '(was', spike_zone.get('height'), ')')
    if not apply_it:
        return
    purgatory['effects'] = PURGATORY
    purgatory['categories'] = rebuild_categories(purgatory['categories'], PURGATORY)
    spike_zone['height'] = 0
    FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
    print('written;', purgatory['name'], '->', purgatory['categories'])


if __name__ == '__main__':
    main()
