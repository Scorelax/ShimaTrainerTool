"""Rework pass (2026-10-08), batch F: damage notes, target gates, self-damage / self-faint, half-HP, Acid Armor.

Damage notes (target side, read in the damage step of the target picker):
- new conditions `target_damaged_this_round` (Assurance), `target_adjacent_allies` (Beat Up: +1d6 per ally next to the target on
  the map, max 4), `target_size_at_least` (Grass Knot: Large or bigger), `target_size_above` (Seismic Toss: +2d6 per size above
  Small); `flatBonus: 'level'` (Night Shade).
- target_status: Al Dente (frightened), Ether Flame (burned -- "critical damage"), Vital Throw (grappled), Wake-Up Slap (asleep,
  with advantage, and it wakes the target). Heat Crash gets Heavy Slam's size scaling. Reversal gets Flail's HP tiers (x2 below
  50%, x3 at 25% or less).
`targetRequiresStatus: 'asleep'` (top-level): Dream Eater, Dream Rush, Dream Seal, Nightmare, Cerulean Haunt only offer sleeping
targets.
Self damage (`recoil` bases): Belly Drum (`max_hp`, half), Dawn Dance (`dice` 2d12), High Jump Kick / Jump Kick (`max_damage`,
half, on the new `on_miss` trigger -- their self-prone moves to `on_miss` too), Radiant Hope (`heal_rolled`).
`self_faint` (new kind): Self-Destruct, Memento, Final Gambit. `hp_fraction_loss` (new kind): Nature's Madness.
Acid Armor: Fire Shield's retaliation_on_melee_hit, 1d6 poison, CON save (the prompt says so).
"""
import json
import sys
from pathlib import Path

FILE = Path(__file__).with_name('DnD_moves_categorized_draft.json')
INSTANT = [{'type': 'instant'}]
ALWAYS = {'type': 'always'}


def note(cond, **kw):
    return {'kind': 'damage_note', 'condition': cond, **kw}


def main():
    apply_it = '--apply' in sys.argv
    data = json.loads(FILE.read_text(encoding='utf-8'))
    by = {m['name']: m for m in data['moves']}

    def fx(n):
        return by[n].setdefault('effects', [])

    def add_note(n, e):
        fx(n).append(e)
        if 'damage_note' not in by[n]['categories']:
            by[n]['categories'].append('damage_note')

    add_note('Assurance', note({'type': 'target_damaged_this_round'}, diceMultiplier=2, note='The target already took damage this round'))
    add_note('Beat Up', note({'type': 'target_adjacent_allies'}, extraDice={'amountPerUnit': 1, 'cap': 4}, note='+1d6 per ally next to the target'))
    add_note('Al Dente', note({'type': 'target_status', 'any': ['frightened']}, diceMultiplier=2, note='The target is frightened'))
    add_note('Ether Flame', note({'type': 'target_status', 'any': ['burned']}, diceMultiplier=2, note='Burning target: critical damage'))
    add_note('Vital Throw', note({'type': 'target_status', 'any': ['grappled']}, diceMultiplier=2, note='You are grappling the target'))
    add_note('Wake-Up Slap', note({'type': 'target_status', 'any': ['asleep']}, diceMultiplier=2, advantage=True, note='The target is asleep'))
    fx('Wake-Up Slap').append({'kind': 'stat_transfer', 'mode': 'cure_named', 'names': ['asleep'], 'when': {'type': 'on_hit'}, 'ends': INSTANT,
                               'note': 'the target automatically wakes up'})
    add_note('Grass Knot', note({'type': 'target_size_at_least', 'size': 'large'}, diceMultiplier=2, note='Large or bigger target'))
    add_note('Seismic Toss', note({'type': 'target_size_above', 'size': 'small'}, extraDice={'amountPerUnit': 2}, note='+2d6 per size above Small'))
    add_note('Heat Crash', note({'type': 'attacker_size_above_target'}, scalingBonus={'amountPerUnit': 'moveModifier'}, note='+MOVE mod per size level above the target'))
    add_note('Night Shade', note({'type': 'target_present'}, flatBonus='level', note="Adds the user's level"))
    add_note('Reversal', note({'type': 'self_hp_below', 'fraction': 0.5}, diceMultiplier=2, note='Below 50% HP'))
    add_note('Reversal', note({'type': 'self_hp_at_or_below', 'fraction': 0.25}, diceMultiplier=3, note='At 25% HP or below'))

    for n in ('Dream Eater', 'Dream Rush', 'Dream Seal', 'Nightmare', 'Cerulean Haunt'):
        by[n]['targetRequiresStatus'] = 'asleep'

    fx('Belly Drum').append({'kind': 'recoil', 'basis': 'max_hp', 'fraction': 0.5, 'damageType': '', 'when': ALWAYS, 'target': 'self', 'ends': INSTANT,
                             'note': 'You take damage equal to half your maximum HP.'})
    fx('Dawn Dance').append({'kind': 'recoil', 'basis': 'dice', 'dice': '2d12', 'damageType': '', 'when': ALWAYS, 'target': 'self', 'ends': INSTANT,
                             'note': 'Using this move drains 2d12 of your HP.'})
    for n in ('High Jump Kick', 'Jump Kick'):
        for e in fx(n):
            if e.get('apply') == 'prone':
                e['when'] = {'type': 'on_miss'}
                e.pop('note', None)
        fx(n).append({'kind': 'recoil', 'basis': 'max_damage', 'fraction': 0.5, 'damageType': '', 'when': {'type': 'on_miss'}, 'target': 'self',
                      'ends': INSTANT, 'note': 'On a miss you take half the maximum damage of this move.'})
    for e in fx('Radiant Hope'):
        if e.get('kind') == 'roll':
            e.pop('note', None)
    fx('Radiant Hope').append({'kind': 'recoil', 'basis': 'heal_rolled', 'fraction': 1, 'damageType': '', 'when': ALWAYS, 'target': 'self', 'ends': INSTANT,
                               'note': 'You take as much damage as the move healed each ally.'})
    for n in ('Self-Destruct', 'Memento', 'Final Gambit'):
        fx(n).append({'kind': 'self_faint', 'when': ALWAYS, 'target': 'self', 'ends': INSTANT})
    fx("Nature's Madness").append({'kind': 'hp_fraction_loss', 'fraction': 0.5, 'min': 1, 'when': {'type': 'save_fail', 'ability': 'CON'}, 'ends': INSTANT})
    fx('Acid Armor').append({'kind': 'condition', 'apply': 'retaliation_on_melee_hit', 'value': 'Poison', 'value2': '1d6', 'ability': 'CON', 'when': ALWAYS,
                             'target': 'self', 'ends': [{'type': 'rounds', 'n': 10}, {'type': 'concentration'}]})

    for n in ('Beat Up', 'High Jump Kick', 'Memento', 'Acid Armor'):
        print(n, [e['kind'] + ':' + str((e.get('when') or {}).get('type')) for e in by[n]['effects']])
    if apply_it:
        FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
        print('written')


if __name__ == '__main__':
    main()
