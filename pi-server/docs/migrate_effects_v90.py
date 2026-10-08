"""Rework pass (2026-10-08), batch B: lingering zones and damage-over-time ticks on the hazard machinery Spikes/Uproar use.

The hazard popup (hazard-popup.js) and resolve-hazard now take, on a zone's `hazard` or a status's `tick`:
`onSave` ('half' default / 'none' = a pass takes nothing / 'full' = the damage lands regardless), `condition` ({apply, ends,
failBy} on a failed save), `pool: 'VP'` and `drain` (fraction of the damage healed by the source). A `tick` also has `timing`
('start'/'end' of the holder's turn) -- routes_combat.py's _queue_status_ticks queues it.

Zones (cast only places them -- "a creature that enters the area or starts its turn there", so nothing is saved at cast time;
the cast-time save/damage categories go and `noCastDamage` is set where the text has dice):
- Gravity Well: 30ft radius at a point, difficult, until your next turn; STR save or prone.
- Constricting Vines: 20ft around you, difficult, 3 rounds (concentration); DEX save or restrained until the end of its next turn.
- Quicksand Trap: 20ft at a point, difficult, 1 minute (concentration); STR save or restrained until the end of its next turn.
- Magma Storm: 20ft at a point, 15ft tall, 1 minute (concentration); CON save, 3d10 + MOVE fire (half on a pass).
- Poison Gas: 10ft at a point, 1 minute (concentration); start of turn only, CON save, 1d6 + MOVE poison (half), poisoned on a fail by 5+.
- Sludge Bomb: on a hit, 5ft around the target until your next turn; CON save or poisoned (replaces the direct poison on the target).
- Smog: 15ft at a point, difficult, until your next turn, `rule: 'smog'` (attacks from inside at disadvantage); start of turn only,
  1d4 + MOVE poison regardless, CON save or poisoned.
- Earthquake: the 10ft around you becomes difficult terrain. Devastating Tremors: 100ft difficult, plus a 15ft hazardous patch
  (2d6 typeless when moving through it, no save).
Ticks: Infestation (start, CON save or 1d4 + MOVE bug), Fire Spin (end, 1d10 fire, 3 rounds/concentration), Leech Seed (end,
1d4 grass, half healed by the seeder), Stone Maw (start, 1d12 rock while swallowed), Spike Protein (end, 4d12 VP).
"""
import json
import sys
from pathlib import Path

FILE = Path(__file__).with_name('DnD_moves_categorized_draft.json')
ALWAYS = {'type': 'always'}
INSTANT = [{'type': 'instant'}]
UNTIL_END_NEXT = [{'type': 'until_turn', 'whose': 'holder', 'point': 'end'}]
CAST_CATS = ('damage', 'trigger_saving_throw', 'multi_hit_aoe')


def zone(name, desc, radius, center, **kw):
    e = {'kind': 'set_terrain', 'name': name, 'description': desc, 'radiusFt': radius, 'center': center}
    e.update(kw)
    e.setdefault('when', ALWAYS)
    e['ends'] = INSTANT
    e['target'] = 'self'
    return e


def main():
    apply_it = '--apply' in sys.argv
    data = json.loads(FILE.read_text(encoding='utf-8'))
    by = {m['name']: m for m in data['moves']}

    def set_zone(name, effects, strip=True, no_cast=False):
        m = by[name]
        m['effects'] = effects
        if strip:
            m['categories'] = [c for c in m['categories'] if c not in CAST_CATS]
        for c in ('field_terrain', 'set_terrain'):
            if c not in m['categories']:
                m['categories'].append(c)
        if no_cast:
            m['noCastDamage'] = True

    set_zone('Gravity Well', [zone('Gravity Well', 'Difficult terrain; a creature that enters or starts its turn here makes a STR save or falls prone.',
                                   30, 'point', difficult=True, untilSourceTurn=True,
                                   hazard={'ability': 'STR', 'condition': {'apply': 'prone'}})])
    set_zone('Constricting Vines', [zone('Constricting Vines', 'Difficult terrain; enter or start a turn here: DEX save or restrained until the end of its next turn.',
                                         20, 'caster', rounds=3, concentration=True, difficult=True,
                                         hazard={'ability': 'DEX', 'condition': {'apply': 'restrained', 'ends': UNTIL_END_NEXT}})])
    set_zone('Quicksand Trap', [zone('Quicksand Trap', 'Difficult terrain; enter or start a turn here: STR save or restrained until the end of its next turn.',
                                     20, 'point', rounds=10, concentration=True, difficult=True,
                                     hazard={'ability': 'STR', 'condition': {'apply': 'restrained', 'ends': UNTIL_END_NEXT}})])
    set_zone('Magma Storm', [zone('Magma Storm', 'Enter or start a turn here: CON save, fire damage (half on a pass).',
                                  20, 'point', rounds=10, concentration=True, height=15,
                                  hazard={'damageType': 'Fire', 'ability': 'CON', 'addMove': True,
                                          'diceTiers': [[1, '3d10'], [5, '5d8'], [10, '6d10'], [17, '10d8']]})], no_cast=True)
    set_zone('Poison Gas', [zone('Poison Gas', 'Start a turn here: CON save, poison damage (half on a pass); poisoned on a fail by 5 or more.',
                                 10, 'point', rounds=10, concentration=True,
                                 hazard={'damageType': 'Poison', 'ability': 'CON', 'addMove': True, 'only': 'start',
                                         'diceTiers': [[1, '1d6'], [5, '2d4'], [10, '3d4'], [17, '4d6']],
                                         'condition': {'apply': 'poisoned', 'failBy': 5}})], no_cast=True)
    by['Sludge Bomb']['effects'] = [zone('Sludge', 'Covered in sludge until the caster\'s next turn; enter or start a turn here: CON save or poisoned.',
                                         5, 'point', untilSourceTurn=True, when={'type': 'on_hit'},
                                         hazard={'ability': 'CON', 'condition': {'apply': 'poisoned'}})]
    by['Sludge Bomb']['categories'] += [c for c in ('field_terrain', 'set_terrain') if c not in by['Sludge Bomb']['categories']]
    set_zone('Smog', [zone('Smog', 'Difficult terrain, attacks made from inside are at disadvantage; start a turn here: poison damage and a CON save or poisoned.',
                           15, 'point', untilSourceTurn=True, difficult=True, rule='smog',
                           hazard={'damageType': 'Poison', 'ability': 'CON', 'addMove': True, 'only': 'start', 'onSave': 'full',
                                   'diceTiers': [[1, '1d4'], [5, '1d6'], [10, '1d8'], [17, '1d10']],
                                   'condition': {'apply': 'poisoned'}})], no_cast=True)
    by['Earthquake']['effects'].append(zone('Earthquake rubble', 'Difficult terrain.', 10, 'caster', difficult=True))
    by['Devastating Tremors']['effects'] += [
        zone('Broken ground', 'Difficult rocky terrain.', 100, 'caster', difficult=True),
        zone('Shattered ground', 'Hazardous difficult terrain: 2d6 typeless damage to a creature moving through it.', 15, 'caster', difficult=True,
             hazard={'damageType': '', 'dice': '2d6', 'only': 'enter'}),
    ]

    # ticks
    def tick_on(name, apply, tick, ends=None, when=None):
        e = next((e for e in by[name].setdefault('effects', []) if e.get('kind') == 'condition' and e.get('apply') == apply), None)
        if e is None:
            e = {'kind': 'condition', 'apply': apply, 'when': when or {'type': 'on_hit'}}
            by[name]['effects'].append(e)
        e['tick'] = tick
        if ends:
            e['ends'] = ends
        e.pop('note', None)

    tick_on('Infestation', 'infested', {'timing': 'start', 'damageType': 'Bug', 'ability': 'CON', 'onSave': 'none', 'addMove': True,
                                        'diceTiers': [[1, '1d4'], [5, '1d6'], [10, '1d8'], [17, '1d10']]})
    tick_on('Fire Spin', 'fire_spin', {'timing': 'end', 'damageType': 'Fire', 'dice': '1d10'},
            ends=[{'type': 'rounds', 'n': 3}, {'type': 'concentration'}])
    tick_on('Leech Seed', 'seeded', {'timing': 'end', 'damageType': 'Grass', 'drain': 0.5,
                                     'diceTiers': [[1, '1d4'], [5, '2d4'], [10, '2d6'], [17, '2d8']]})
    tick_on('Stone Maw', 'grappled', {'timing': 'start', 'damageType': 'Rock', 'diceTiers': [[1, '1d12'], [10, '4d6']]})
    tick_on('Spike Protein', 'infected', {'timing': 'end', 'pool': 'VP', 'diceTiers': [[1, '4d12'], [5, '6d12'], [10, '8d12'], [17, '10d12']]})
    for e in by['Spike Protein']['effects']:
        if e.get('apply') == 'infected':
            e['note'] = 'at 0 VP its HP also drops to 0'

    for n in ('Gravity Well', 'Magma Storm', 'Smog', 'Sludge Bomb', 'Infestation', 'Leech Seed'):
        print(n, by[n]['categories'], [e['kind'] for e in by[n]['effects']])
    if apply_it:
        FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
        print('written')


if __name__ == '__main__':
    main()
