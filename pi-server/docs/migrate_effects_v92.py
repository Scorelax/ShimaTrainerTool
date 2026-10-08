"""Rework pass (2026-10-08), batch D: altitude and grounding on the map.

- `ground_target` (new kind): the creature comes down to the ground (token altitude 0, set-token-altitude); `fallDice` +
  `fallMax` = "1d6 fall damage per 10 feet fallen, to a maximum of 20d6", rolled by the table.
  Smack Down (on a hit, + `grounded` until the end of your next turn, which the text gives too), Graviton Beam (on a hit, with
  fall damage), Thousand Arrows (failed save; it already applied `grounded`), Roost (yourself; grounded until your next turn).
- `set_altitude` (new kind): Skyward Soar -- "if this causes the attack to miss, you're now 60ft up" (offered unticked).
- Gravity becomes a zone (40ft around you, concentration) with `rule: 'gravity'`: everyone standing in it is grounded (Electric/
  Misty/Psychic Terrain read that), flyers in it land, and nothing can fly up inside it.
- `affectsGroundedOnly` (top-level): Earthquake, Bulldoze, Land's Wrath, Devastating Tremors, Earth Power hide creatures that
  aren't grounded (flying speed, Levitate, Magnet Rise, or simply up in the air on the map) from their target pickers.
- `doubleDamageVsAirborne` (top-level): Cyclone Charge -- "creatures in range that are not grounded or in the invulnerable stage
  of Fly or Bounce take double damage" (it can also hit them: hitsStates airborne).
"""
import json
import sys
from pathlib import Path

FILE = Path(__file__).with_name('DnD_moves_categorized_draft.json')
INSTANT = [{'type': 'instant'}]
FALL = {'fallDice': '1d6', 'fallMax': 20}


def main():
    apply_it = '--apply' in sys.argv
    data = json.loads(FILE.read_text(encoding='utf-8'))
    by = {m['name']: m for m in data['moves']}

    def fx(n):
        return by[n].setdefault('effects', [])

    for e in fx('Smack Down'):
        if e.get('apply') == 'prone':
            e.pop('note', None)
    fx('Smack Down').append({'kind': 'condition', 'apply': 'grounded', 'when': {'type': 'on_hit'},
                             'ends': [{'type': 'until_turn', 'whose': 'source', 'point': 'end'}],
                             'note': 'loses any flying speed and its ground-type immunity'})
    fx('Smack Down').append({'kind': 'ground_target', **FALL, 'when': {'type': 'on_hit'}, 'ends': INSTANT})
    fx('Graviton Beam').append({'kind': 'ground_target', **FALL, 'when': {'type': 'on_hit'}, 'ends': INSTANT})
    fx('Thousand Arrows').append({'kind': 'ground_target', 'when': {'type': 'save_fail', 'ability': 'DEX'}, 'ends': INSTANT})
    fx('Roost').append({'kind': 'condition', 'apply': 'grounded', 'when': {'type': 'always'}, 'target': 'self',
                        'ends': [{'type': 'until_turn', 'whose': 'holder', 'point': 'start', 'count': 1}],
                        'note': 'also loses its ground-type resistance; it cannot move again this turn'})
    fx('Roost').append({'kind': 'ground_target', 'when': {'type': 'always'}, 'target': 'self', 'ends': INSTANT})
    fx('Skyward Soar').append({'kind': 'set_altitude', 'z': 60, 'when': {'type': 'special'}, 'target': 'self', 'ends': INSTANT,
                               'note': 'only if the AC boost made the attack miss'})

    by['Gravity']['effects'] = [{
        'kind': 'set_terrain', 'name': 'Gravity', 'description': 'Everyone inside is grounded: no flying or hovering, Levitate suppressed.',
        'radiusFt': 40, 'center': 'caster', 'rounds': 10, 'concentration': True, 'rule': 'gravity',
        'when': {'type': 'always'}, 'ends': INSTANT, 'target': 'self'}]
    by['Gravity']['categories'] += [c for c in ('field_terrain', 'set_terrain') if c not in by['Gravity']['categories']]

    for n in ('Earthquake', 'Bulldoze', "Land's Wrath", 'Devastating Tremors', 'Earth Power'):
        by[n]['affectsGroundedOnly'] = True
    cc = by['Cyclone Charge']
    cc['doubleDamageVsAirborne'] = True
    cc['hitsStates'] = sorted(set(cc.get('hitsStates') or []) | {'airborne'})
    cc['doubleDamageVsStates'] = sorted(set(cc.get('doubleDamageVsStates') or []) | {'airborne'})

    for n in ('Smack Down', 'Roost', 'Gravity', 'Skyward Soar'):
        print(n, [e['kind'] + ':' + str(e.get('apply', '')) for e in by[n]['effects']])
    if apply_it:
        FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
        print('written')


if __name__ == '__main__':
    main()
