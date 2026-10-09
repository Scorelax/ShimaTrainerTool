#!/usr/bin/env python3
"""v96: the trainers' basic **Attack** (the user's call, 2026-10-09).

Trainers have no moves, so the shared battle card gives them an Attack button
that runs this entry through the normal move popup: a melee attack roll, 1d6 +
STR typeless damage on a hit, no VP. Typeless (empty type) rather than Normal,
so it isn't stopped by a Ghost-type's immunity -- the server treats an empty
type as neutral (routes_combat.py's _type_multiplier). Using it spends the
trainer's action (routes_combat.py's TRAINER_ATTACK_MOVE).

    python migrate_effects_v96.py            # dry run
    python migrate_effects_v96.py --apply
"""
import json
import sys
from pathlib import Path

FILE = Path(__file__).with_name('DnD_moves_categorized_draft.json')

ATTACK = {
    'name': 'Attack',
    'type': '',
    'action': '1 action',
    'range': 'Melee',
    'duration': {'raw': 'Instantaneous', 'rounds': 0, 'concentration': False, 'varies': False},
    'reaction': False,
    'categories': ['damage'],
    'description': "A trainer's basic attack -- describe how it looks however you like. Make a melee attack roll "
                   'against a creature, doing 1d6 + MOVE typeless damage on a hit.',
    'moveStat': 'STR',
    'vpCost': '0',
    'scaling': '',
}


def main(apply):
    data = json.loads(FILE.read_text(encoding='utf-8'))
    if any(m['name'] == ATTACK['name'] for m in data['moves']):
        print('Attack already present -- nothing to do')
        return
    data['moves'].append(ATTACK)
    print('adding Attack')
    if apply:
        FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
        print('written')


if __name__ == '__main__':
    main('--apply' in sys.argv)
