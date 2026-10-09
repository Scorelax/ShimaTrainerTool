#!/usr/bin/env python3
"""v97: `attackRoll` on every move -- whether using it makes an attack roll (the user's call, 2026-10-09: the shared
battle's move popup shows the attack modifier only for moves that actually roll one, the same way it already shows
no damage for non-damaging moves).

True when the text makes an attack in any of the ways the move list words it ("make a melee attack", "roll a ranged
attack", "make a melee roll", "on a hit", "attack roll against"...), unless the move is tagged guaranteed_hit. A move
the heuristic gets wrong is fixed by editing its `attackRoll` in the data (OVERRIDES below for the ones found now).
routes_combat.py's list-move-categories turns `attackRoll: false` into the client flag `noAttackRoll`.

    python migrate_effects_v97.py            # dry run: prints the borderline cases
    python migrate_effects_v97.py --apply
"""
import json
import re
import sys
from pathlib import Path

FILE = Path(__file__).with_name('DnD_moves_categorized_draft.json')

ATTACK = re.compile(
    r"\bmakes? (?:a|an|one|two|three|four|five|\d+|as many)(?: separate| single| additional)?"
    r" (?:melee |ranged |spell |weapon )?(?:or (?:melee|ranged) )?(?:attacks?|roll)\b"
    r"|\broll(?:s)? an? (?:melee |ranged )?attack\b"
    r"|\battack rolls? (?:against|on)\b"
    r"|\b(?:melee|ranged) attack roll"
    r"|\bon a (?:successful )?hit\b",
    re.I)

# Checked by hand where the wording misleads the pattern.
OVERRIDES = {
    'Struggle Bug': True,   # "retaliate with a melee attack"
    'Weather Ball': True,   # a thrown ball; the battle flow rolls an attack for it (no save tag)
}


def has_attack_roll(move):
    if move['name'] in OVERRIDES:
        return OVERRIDES[move['name']]
    if 'guaranteed_hit' in move.get('categories', []):
        return False
    return bool(ATTACK.search(move.get('description', '')))


def main(apply):
    data = json.loads(FILE.read_text(encoding='utf-8'))
    dice = re.compile(r'\d+d\d+')
    changed = 0
    borderline = []
    for m in data['moves']:
        value = has_attack_roll(m)
        if m.get('attackRoll') != value:
            m['attackRoll'] = value
            changed += 1
        cats = m.get('categories', [])
        if not value and 'damage' in cats and dice.search(m['description']) \
                and not any(c in cats for c in ('trigger_saving_throw', 'guaranteed_hit', 'multi_hit_aoe', 'unknown')):
            borderline.append(m['name'])
    total = sum(1 for m in data['moves'] if m['attackRoll'])
    print(f'attack roll: {total} of {len(data["moves"])} moves ({changed} changed)')
    print(f'damaging, no attack roll, no save/auto-hit tag ({len(borderline)}): {", ".join(borderline)}')
    if apply:
        FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
        print('written')


if __name__ == '__main__':
    main('--apply' in sys.argv)
