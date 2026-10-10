#!/usr/bin/env python3
"""v99: the Protect family's rising cost. The first use in a battle works automatically; "On future instances of this
move in the same combat, you must roll higher than a 15 on a d20 roll for the reaction to be successful." Protect,
Detect and Spiky Shield add "Unless the successful roll is 20, the damage you take instead drains your VP for half the
damage amount." New top-level `repeatUse` (sent to the client as a flag; combat-wip.js's _repeatUseCheck):

    "repeatUse": {"die": "d20", "min": 16, "vpHalfUnlessNatural20": true}

The user's call, 2026-10-11: track the rising cost on the Protect-family moves.

    python migrate_effects_v99.py            # dry run
    python migrate_effects_v99.py --apply
"""
import json
import sys
from pathlib import Path

FILE = Path(__file__).with_name('DnD_moves_categorized_draft.json')
VP_HALF = {'Protect', 'Detect', 'Spiky Shield'}
PLAIN = {"King's Shield", 'Endure', 'Shield Guardian'}


def main(apply):
    data = json.loads(FILE.read_text(encoding='utf-8'))
    for m in data['moves']:
        if m['name'] in VP_HALF | PLAIN:
            m['repeatUse'] = {'die': 'd20', 'min': 16, **({'vpHalfUnlessNatural20': True} if m['name'] in VP_HALF else {})}
            print(f"{m['name']}: repeatUse {m['repeatUse']}")
    if apply:
        FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
        print('written')


if __name__ == '__main__':
    main('--apply' in sys.argv)
