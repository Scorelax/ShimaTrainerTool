#!/usr/bin/env python3
"""v102: moves that silently did nothing in the shared battle (the user's audit, 2026-11-10 -- found after Bubble's
multi-attack had never been built):

- Outrage, Disarming Voice, Hyperspace Fury, Dream Eater: their damage is worded "automatically hits for 2d8", "deals
  3d10", "inflict 2d8", which the app's dice reader (pokemon-types.js parseDamageDice) doesn't take -- so there was no
  damage step at all (Dream Eater's half-the-damage heal healed 0). `baseDamageDice` gives it to them; the "At higher
  levels" text still scales it. (Not by widening the reader: Powder's reaction text "automatically deals 3d10" would
  have turned that manual move into an attack.)
- Struggle: "damage equal to 2 + MOVE" -- a flat 2 (`baseDamageDice: "2"`, pre-filled on the damage step).
- Disarming Voice hits "any opponent in range": an area move (multi_hit_aoe) -- each creature picked takes its own
  automatic hit.
- Dream Eater: "Instantly inflict" -- no attack roll (guaranteed_hit).
- Sheer Cold: the same "on a 20 the target faints, fails if it's 10+ levels higher" as Guillotine and Horn Drill, but
  it never got their `faint_on_roll` effect.
- Rage Powder: a WIS save in a 15ft cone was in its text but nowhere in its data. Built like Follow Me: taunted on a
  failed save, for the minute or until the creature passes its end-of-turn save.

    python migrate_effects_v102.py            # dry run
    python migrate_effects_v102.py --apply
"""
import json
import sys
from pathlib import Path

FILE = Path(__file__).with_name('DnD_moves_categorized_draft.json')

BASE_DICE = {
    'Outrage': '2d8',
    'Disarming Voice': '1d4',
    'Hyperspace Fury': '3d10',
    'Dream Eater': '2d8',
    'Struggle': '2',
}


def add_tags(move, *tags):
    cats = move.setdefault('categories', [])
    for t in tags:
        if t not in cats:
            cats.append(t)


def main(apply):
    data = json.loads(FILE.read_text(encoding='utf-8'))
    by_name = {m['name']: m for m in data['moves']}

    for name, dice in BASE_DICE.items():
        by_name[name]['baseDamageDice'] = dice

    add_tags(by_name['Disarming Voice'], 'multi_hit_aoe')
    add_tags(by_name['Dream Eater'], 'guaranteed_hit')

    sheer = by_name['Sheer Cold']
    sheer['effects'] = [{'kind': 'faint_on_roll', 'min': 20, 'levelGap': 10, 'when': {'type': 'always'},
                         'ends': [{'type': 'instant'}]}]
    add_tags(sheer, 'faint_on_roll')

    rage = by_name['Rage Powder']
    rage['effects'] = [{
        'kind': 'condition', 'apply': 'taunted', 'when': {'type': 'save_fail', 'ability': 'WIS'},
        'ends': [{'type': 'rounds', 'n': 10}, {'type': 'save', 'ability': 'WIS', 'timing': 'end_of_turn'}],
        'note': 'every creature in the cone; it can only use damaging moves that target you',
    }]
    add_tags(rage, 'trigger_saving_throw', 'multi_hit_aoe', 'potential_status_condition_taunted')

    for name in [*BASE_DICE, 'Sheer Cold', 'Rage Powder']:
        m = by_name[name]
        print(f"{name}: categories {m.get('categories')}, baseDamageDice {m.get('baseDamageDice')}, "
              f"effects {[e['kind'] for e in m.get('effects') or []]}")
    if apply:
        FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
        print('written')


if __name__ == '__main__':
    main('--apply' in sys.argv)
