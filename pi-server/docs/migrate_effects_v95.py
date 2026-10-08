"""Rework pass (2026-10-08), the user's answers to the open questions.

1) "Can't flee or be switched out" only blocks switching: Mean Look, Fairy Lock, Spirit Shackle, Thousand Waves, Cursed Gaze use
   the condition `switch_locked` (`noSwitch`) instead of `trapped` (which also blocks moving -- Ingrain keeps it). No Retreat and
   Dawn Burst ("not able to ... be recalled until the end of your next turn") get it too; Graviton Beam's speed debuff carries it.
2) (server) A normal switch-out clears stat changes and passing effects; burned / poisoned / asleep / paralyzed / frozen stay.
3) `slowed` is Temporal Fang's slow only (half speed, disadvantage on attacks and saves, attacks against it have advantage --
   conditions.py / condition-rules.js). Every other "speed halved" move becomes a speed x0.5 stat: Graviton Beam, Land's Wrath,
   Pack Frost, Thermal Shock, Slowing Ray, Vertigo Blast.
4) Dragon Tail: `force_switch` -- the target's trainer picks the replacement; a wild creature moves half its speed away instead.
5) Environments: Chill (cold), Superheat (hot), Stormwind (windy) set the whole map's environment for 5 rounds (`set_environment`).
   Thermal Shock reads it through `env` on its effects: hot doubles its dice (damage_note `self_environment`), cold freezes a 10ft
   patch into difficult terrain, anything else is temperate (CON save or speed halved).
6) Song of the Deep is tagged unknown (manual, effects removed). Transfusion heals the damage dealt; its text is reworded.
7) Sing is automated (`sleep_pool`): roll the dice + MOVE, then creatures within 30ft fall asleep from the lowest current HP up
   while their HP fits in what is left.
"""
import json
import sys
from pathlib import Path

DOCS = Path(__file__).parent
FILE = DOCS / 'DnD_moves_categorized_draft.json'
RAW = DOCS / 'DnD_moves.json'
INSTANT = [{'type': 'instant'}]
UNTIL_END_NEXT = [{'type': 'until_turn', 'whose': 'holder', 'point': 'end'}]
OLD_TEXT = 'You regain of the damage dealt as HP.'
NEW_TEXT = 'You regain HP equal to the damage dealt.'


def half_speed(when, ends, **extra):
    return {'kind': 'stat', 'stat': 'speed', 'amount': {'multiplier': 0.5}, 'when': when, 'ends': ends, **extra}


def main():
    apply_it = '--apply' in sys.argv
    data = json.loads(FILE.read_text(encoding='utf-8'))
    by = {m['name']: m for m in data['moves']}

    def fx(n):
        return by[n].setdefault('effects', [])

    # 1) switch lock
    for n in ('Mean Look', 'Fairy Lock', 'Spirit Shackle', 'Thousand Waves', 'Cursed Gaze'):
        for e in fx(n):
            if e.get('apply') == 'trapped':
                e['apply'] = 'switch_locked'
                e['noSwitch'] = True
                e.pop('note', None)
        by[n]['categories'] = [c.replace('status_condition_trapped', 'status_condition_switch_locked') for c in by[n]['categories']]
    fx('No Retreat').append({'kind': 'condition', 'apply': 'switch_locked', 'noSwitch': True, 'when': {'type': 'always'}, 'target': 'self',
                             'ends': [{'type': 'encounter'}]})
    fx('Dawn Burst').append({'kind': 'condition', 'apply': 'switch_locked', 'noSwitch': True, 'when': {'type': 'always'}, 'target': 'self',
                             'ends': [{'type': 'until_turn', 'whose': 'holder', 'point': 'end', 'count': 1}],
                             'note': 'also cannot use attack moves until the end of your next turn'})

    # 3) speed halved
    for n in ('Graviton Beam', "Land's Wrath", 'Pack Frost', 'Thermal Shock', '4. Slowing Ray', 'Vertigo Blast'):
        effects = fx(n)
        for i, e in enumerate(effects):
            if e.get('apply') == 'slowed':
                new = half_speed(e['when'], e.get('ends') or [{'type': 'encounter'}])
                note = e.get('note', '').replace('speed halved; ', '').replace('speed halved', '').replace('movement speed halved', '').strip('; ')
                if note and n == '4. Slowing Ray':
                    new['note'] = note
                if n == 'Graviton Beam':
                    new['noSwitch'] = True
                    new['note'] = "can't leave the ground or be switched out while slowed"
                effects[i] = new
        by[n]['categories'] = [c.replace('potential_status_condition_slowed', 'potential_stat_debuff_speed') for c in by[n]['categories']]

    # 4) Dragon Tail
    fx('Dragon Tail').append({'kind': 'force_switch', 'when': {'type': 'save_fail', 'ability': 'CON', 'requires': 'hit'}, 'ends': INSTANT,
                              'note': 'trainer battles: its trainer switches it out; wild battles: it moves half its speed away'})
    for e in fx('Dragon Tail'):
        if e.get('apply') == 'frightened':
            e['note'] = 'too frightened to remain in battle'

    # 5) environments + Thermal Shock
    for n, env, name in (('Chill', 'cold', 'Freezing Cold'), ('Superheat', 'hot', 'Intense Heat'), ('Stormwind', 'windy', 'Strong Winds')):
        by[n]['effects'] = [{'kind': 'set_environment', 'name': name, 'env': env, 'rounds': 5, 'when': {'type': 'always'}, 'target': 'self', 'ends': INSTANT}]
        if 'field_environment' not in by[n]['categories']:
            by[n]['categories'].append('field_environment')
    ts = fx('Thermal Shock')
    for e in ts:
        if e.get('kind') == 'stat' and e.get('stat') == 'speed':
            e['when'] = {'type': 'save_fail', 'ability': 'CON', 'requires': 'hit'}
            e['ends'] = UNTIL_END_NEXT
            e['env'] = ['temperate']
            e['note'] = 'temperate environment'
    ts.append({'kind': 'damage_note', 'condition': {'type': 'self_environment', 'any': ['hot']}, 'diceMultiplier': 2,
               'note': 'Hot environment: double the damage dice'})
    ts.append({'kind': 'set_terrain', 'name': 'Frozen ground', 'description': 'Difficult terrain: the moisture froze instantly.',
               'radiusFt': 10, 'center': 'point', 'difficult': True, 'env': ['cold'], 'when': {'type': 'on_hit'}, 'ends': INSTANT, 'target': 'self'})
    for c in ('damage_note', 'set_terrain'):
        if c not in by['Thermal Shock']['categories']:
            by['Thermal Shock']['categories'].append(c)

    # 6) Song of the Deep, Transfusion
    by['Song of the Deep']['effects'] = []
    by['Song of the Deep']['categories'] = ['unknown'] + [c for c in by['Song of the Deep']['categories'] if c not in ('unknown', 'trigger_saving_throw')]
    tr = by['Transfusion']
    tr['description'] = tr['description'].replace(OLD_TEXT, NEW_TEXT)
    fx('Transfusion').insert(0, {'kind': 'heal', 'amount': {'fractionOfDamage': 1.0}, 'when': {'type': 'on_hit'}, 'target': 'self', 'ends': INSTANT})
    if 'drain' not in tr['categories']:
        tr['categories'].append('drain')

    # 7) Sing
    sing = by['Sing']
    sing['categories'] = [c for c in sing['categories'] if c not in ('unknown', 'multi_hit_aoe')]
    sing['noCastDamage'] = True
    sing['effects'] = [{'kind': 'sleep_pool', 'diceTiers': [[1, '5d8'], [5, '7d8'], [10, '6d12'], [17, '11d8']], 'addMove': True, 'radiusFt': 30,
                        'when': {'type': 'always'}, 'target': 'self', 'ends': INSTANT}]

    left = [m['name'] for m in data['moves'] for e in m.get('effects') or [] if e.get('apply') == 'slowed']
    print('still slowed:', left)
    print('still trapped:', [m['name'] for m in data['moves'] for e in m.get('effects') or [] if e.get('apply') == 'trapped'])
    if apply_it:
        FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
        raw = RAW.read_text(encoding='utf-8')
        if OLD_TEXT in raw:
            RAW.write_text(raw.replace(OLD_TEXT, NEW_TEXT), encoding='utf-8')
        print('written')


if __name__ == '__main__':
    main()
