"""Rework pass (2026-10-08), batch A: clear fixes found by re-reading the whole move list against the newer mechanics.

- Missing reaction wiring: Spore / Stun Spore ("when targeted by / subject to a melee attack"), Burning Glance, Metal Burst,
  Static Shield, Pharaoh's Curse never opened a reaction window. Metal Burst gets Revenge's counter_attack (Steel); Static Shield
  negates the hit and counter-attacks for half of it (disadvantage when answering a ranged attack).
- Hold Back "always leaves its target with 1 hp" -> leavesAtOneHp (same as False Swipe).
- Rest never healed; Charge never doubled STAB on the next turn; Clamp had no escape save.
- Limit Break: its self `crit +1` status helped the NEXT attack, not this one. Now a move-level critBonus 2 (crits on 18-20),
  attackRollMode advantage, and a requires_self gate (below 50% HP). Feint Attack, Close Combat, Twilight Rush, Cataclysm Punch,
  Falcon Dive also get attackRollMode advantage ("always with advantage").
- Close Combat / Twilight Rush: "your AC is reduced by 1d4" (rolled once when applied).
- Speed is enforced on the map now, so the speed parts that were only text become effects: Geomancy, Rock Polish, Shift Gear,
  No Retreat, Cotton Spore, String Shot, Electroweb, Glaciate, Toxic Thread, Hammer Arm, Ice Hammer, Wealth's Burden.
- Spider Web / Memento / Slack Off: "cannot be switched out" -> `noSwitch` on the condition they already apply.
- Gates: Dawn Burst (above 75% HP), Snore (only while asleep), Recompose (no enemy within melee range).
- Notes that still said "switching isn't a mechanic" / "no positional system" are corrected.
"""
import json
import sys
from pathlib import Path

FILE = Path(__file__).with_name('DnD_moves_categorized_draft.json')
UNTIL_END_NEXT = [{'type': 'until_turn', 'whose': 'holder', 'point': 'end'}]


def speed(amount, when, target=None, ends=None, stacks=None, note=None):
    e = {'kind': 'stat', 'stat': 'speed', 'amount': amount, 'when': when}
    if target:
        e['target'] = target
    e['ends'] = ends or [{'type': 'encounter'}]
    if stacks:
        e['stacks'] = {'max': stacks}
    if note:
        e['note'] = note
    return e


ALWAYS = {'type': 'always'}
ON_HIT = {'type': 'on_hit'}


def main():
    apply_it = '--apply' in sys.argv
    data = json.loads(FILE.read_text(encoding='utf-8'))
    by = {m['name']: m for m in data['moves']}

    def fx(name):
        return by[name].setdefault('effects', [])

    def drop_cat(name, *cats):
        by[name]['categories'] = [c for c in by[name]['categories'] if c not in cats]

    # reactions
    for n in ('Spore', 'Stun Spore'):
        by[n].update(reactionTrigger='targeted', reactionRange=0, reactionAttackRange='melee')
    by['Burning Glance'].update(reactionTrigger='damaged', reactionRange=0, reactionAttackRange='melee')
    by['Metal Burst'].update(reactionTrigger='damaged', reactionRange=0, reactionAttackRange='melee')
    drop_cat('Metal Burst', 'damage')
    fx('Metal Burst').insert(0, {'kind': 'counter_attack', 'damageType': 'Steel', 'damageFrom': 'damage_taken', 'rollMode': 'disadvantage',
                                 'target': 'self', 'when': ALWAYS, 'ends': [{'type': 'instant'}],
                                 'note': 'Attack roll against your attacker with disadvantage; on a hit, the damage you just took is dealt back as steel damage.'})
    by['Static Shield'].update(reactionTrigger='damaged', reactionRange=0)
    drop_cat('Static Shield', 'guaranteed_hit')
    by['Static Shield']['effects'] = [
        {'kind': 'counter_attack', 'damageType': 'Electric', 'damageFrom': 'damage_taken', 'fraction': 0.5, 'rollMode': 'disadvantage_if_ranged',
         'target': 'self', 'when': ALWAYS, 'ends': [{'type': 'instant'}],
         'note': 'Attack back for half the damage you took (disadvantage if the attack you reflect was ranged).'},
        {'kind': 'negate_damage', 'target': 'self', 'when': ALWAYS, 'ends': [{'type': 'instant'}]},
    ] + [e for e in fx('Static Shield') if e.get('kind') == 'condition']
    by["Pharaoh's Curse"].update(reactionTrigger='damaged', reactionRange=50)
    by["Pharaoh's Curse"]['effects'] = [
        {'kind': 'condition', 'apply': 'frightened', 'when': ALWAYS, 'ends': UNTIL_END_NEXT, 'note': 'the creature that just landed the attack'},
        {'kind': 'roll', 'roll': 'disadvantage', 'on': 'attack_rolls', 'when': ALWAYS, 'ends': UNTIL_END_NEXT},
        {'kind': 'roll', 'roll': 'disadvantage', 'on': 'saving_throws', 'when': ALWAYS, 'ends': UNTIL_END_NEXT},
    ]

    # small fixes
    by['Hold Back']['leavesAtOneHp'] = True
    fx('Rest').insert(0, {'kind': 'heal', 'amount': {'dice': '4d6', 'moveMod': True}, 'when': ALWAYS, 'target': 'self', 'ends': [{'type': 'instant'}]})
    fx('Charge').append({'kind': 'condition', 'apply': 'stab_doubled', 'when': ALWAYS, 'target': 'self',
                         'ends': [{'type': 'until_turn', 'whose': 'holder', 'point': 'end', 'count': 1}], 'note': 'on your next turn'})
    for e in fx('Clamp'):
        e['ends'] = [{'type': 'save', 'ability': 'STR', 'timing': 'start_of_turn'}]

    # Limit Break + always-advantage attacks
    by['Limit Break']['effects'] = [{'kind': 'requires_self', 'hpBelow': 0.5, 'message': 'Limit Break requires being below 50% HP'}]
    by['Limit Break'].update(critBonus=2, attackRollMode='advantage')
    for n in ('Feint Attack', 'Close Combat', 'Twilight Rush', 'Cataclysm Punch', 'Falcon Dive'):
        by[n]['attackRollMode'] = 'advantage'
    for n in ('Close Combat', 'Twilight Rush'):
        fx(n).append({'kind': 'stat', 'stat': 'ac', 'amount': {'rollOnApply': '1d4', 'sign': -1}, 'when': ALWAYS, 'target': 'self',
                      'ends': [{'type': 'until_turn', 'whose': 'holder', 'point': 'start'}]})

    # speed
    fx('Geomancy').append(speed(10, ALWAYS, 'self', [{'type': 'rounds', 'n': 3}]))
    fx('Rock Polish').append(speed(20, ALWAYS, 'self', [{'type': 'rounds', 'n': 3}]))
    fx('Shift Gear').append(speed(10, ALWAYS, 'self', [{'type': 'concentration'}]))
    fx('No Retreat').append(speed(5, ALWAYS, 'self'))
    fx('Cotton Spore').insert(0, speed(-10, {'type': 'save_fail', 'ability': 'CON'}, ends=[{'type': 'rounds', 'n': 10}]))
    fx('String Shot').insert(0, speed(-10, ON_HIT, ends=[{'type': 'rounds', 'n': 10}], stacks=12,
                                     note='stacks; an action and a STR save remove the string'))
    fx('Electroweb').insert(0, speed(-5, ON_HIT, stacks=12, note='stacks; an action removes the web'))
    fx('Glaciate').insert(0, speed(-5, ON_HIT, stacks=12, note='stacks; an action warms it up and resets its speed'))
    fx('Toxic Thread').insert(0, speed(-10, ON_HIT, stacks=12, note='stacks; an action removes the threads'))
    fx('Hammer Arm').append(speed({'multiplier': 0.5}, ALWAYS, 'self', UNTIL_END_NEXT))
    fx('Ice Hammer').append(speed({'multiplier': 0.5}, ON_HIT, ends=UNTIL_END_NEXT))
    fx("Wealth's Burden").append(speed({'multiplier': 0.5}, {'type': 'natural_roll', 'min': 16}, ends=UNTIL_END_NEXT))

    # can't be switched out
    for n, apply in (('Spider Web', 'restrained'), ('Memento', 'incapacitated'), ('Slack Off', 'incapacitated')):
        for e in fx(n):
            if e.get('kind') == 'condition' and e.get('apply') == apply:
                e['noSwitch'] = True

    # gates
    fx('Dawn Burst').insert(0, {'kind': 'requires_self', 'hpAbove': 0.75, 'message': 'Dawn Burst needs your HP above 75% of your maximum'})
    fx('Snore').insert(0, {'kind': 'requires_self', 'status': 'asleep', 'message': 'Snore can only be used while you are asleep'})
    fx('Recompose').insert(0, {'kind': 'requires_self', 'noHostileWithinFt': 5, 'message': 'Recompose needs no enemies within melee range'})

    # stale notes
    stale = {
        'Fairy Lock': 'Blocks grid movement (this app\'s meaning of trapped) and switching out.',
        'Mean Look': 'Blocks grid movement and switching out.',
        'Spirit Shackle': 'Blocks grid movement and switching out.',
        'Ingrain': 'Blocks moving and being switched out.',
    }
    for n, note in stale.items():
        for e in fx(n):
            if e.get('apply') == 'trapped':
                e['note'] = note
    for e in fx('Divine Noodle Form'):
        if e.get('kind') == 'temp_hp':
            e['note'] = 'Melee reach increase to 15ft is not tracked.'

    for n in ('Spore', 'Stun Spore', 'Burning Glance', 'Metal Burst', 'Static Shield', "Pharaoh's Curse", 'Limit Break', 'Close Combat', 'Snore'):
        m = by[n]
        print(n, {k: m.get(k) for k in ('reactionTrigger', 'reactionAttackRange', 'critBonus', 'attackRollMode') if m.get(k)}, [e['kind'] for e in m.get('effects') or []])
    if apply_it:
        FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
        print('written')


if __name__ == '__main__':
    main()
