#!/usr/bin/env python3
"""v101: Wrap is a hold move too (the user, 2026-10-14) -- "As long as the target is grappled on your subsequent turns,
this move can be activated again as a bonus action with an automatic hit, dealing 1d4 normal damage." Same `twoStage`
hold shape as Bind (migrate_effects_v100.py): the follow-up is a fresh damage roll every time, once per round, from the
turn after the grab.

    python migrate_effects_v101.py            # dry run
    python migrate_effects_v101.py --apply
"""
import json
import sys
from pathlib import Path

FILE = Path(__file__).with_name('DnD_moves_categorized_draft.json')


def main(apply):
    data = json.loads(FILE.read_text(encoding='utf-8'))
    move = next(m for m in data['moves'] if m['name'] == 'Wrap')
    move['twoStage'] = {'stage': 'hold', 'holdCondition': 'grappled', 'release': 'bonus', 'addMove': False}
    print(f"Wrap: twoStage {move['twoStage']}")
    if apply:
        FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
        print('written')


if __name__ == '__main__':
    main('--apply' in sys.argv)
