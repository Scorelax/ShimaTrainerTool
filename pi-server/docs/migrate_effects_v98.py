#!/usr/bin/env python3
"""v98: Bug Buzz and Chaos Beam are area save moves ("All creatures within 20 feet ... must make a CON save",
"All creatures caught in the line have to succeed a DEX saving throw") but had neither the save tag nor the area tag,
so the battle offered them as single-target attacks. Tagged trigger_saving_throw + multi_hit_aoe like Hyper Beam /
Discharge (the user's call, 2026-10-09).

    python migrate_effects_v98.py            # dry run
    python migrate_effects_v98.py --apply
"""
import json
import sys
from pathlib import Path

FILE = Path(__file__).with_name('DnD_moves_categorized_draft.json')
ADD = {'Bug Buzz': ['trigger_saving_throw', 'multi_hit_aoe'], 'Chaos Beam': ['trigger_saving_throw', 'multi_hit_aoe']}


def main(apply):
    data = json.loads(FILE.read_text(encoding='utf-8'))
    for m in data['moves']:
        for tag in ADD.get(m['name'], []):
            if tag not in m['categories']:
                m['categories'].append(tag)
                print(f"{m['name']}: + {tag}")
    if apply:
        FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
        print('written')


if __name__ == '__main__':
    main('--apply' in sys.argv)
