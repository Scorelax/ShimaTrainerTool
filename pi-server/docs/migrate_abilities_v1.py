#!/usr/bin/env python3
"""Abilities batch A: out-of-combat abilities -> `unknown`, plus structured `effects`
for the common and simple families (pinch boosts, immunities, resistances, absorbs,
melee retaliation, weather setters/users, crit, flat bonuses, type conversions).
Schema: ability-effects-schema.md.

    python migrate_abilities_v1.py            # dry run: report only
    python migrate_abilities_v1.py --apply    # rewrites DnD_abilities.json

Re-running overwrites only the abilities listed here.
"""
import json
import sys
from pathlib import Path

FILE = Path(__file__).with_name('DnD_abilities.json')

# --- out of combat: manual by design (user's call, 2026-10-08) ------------------
UNKNOWN = [
    'Amorphous', 'Berry Sense', 'Camouflage', 'Colony Mind', 'Diplomat', 'Dream Walker',
    'Flower Mimic', 'Forest Sovereign', 'Gemcrafter', 'Great Archive', 'Hard Worker',
    'Honey Gather', 'Illuminate', 'Illusion', 'Living Wall', 'Mimic', 'Mineral Refinery',
    'Moody', 'Perfect Memory', 'Pollinator', 'Potential', 'Revealing Light', 'Salvager',
    'Spectral Sight', 'Storm Warning', 'Supervisor', 'Swamp Stalker', 'Swift Post',
    'Treasure Hoarder', 'Void Traversal', 'Wishmaker',
    # very specific, borderline combat -- manual for now (user's call, 2026-10-08)
    "Centurion's Honor", "Imperion's Honor", "Legion's Honor", 'Night Watch', 'Shadow Veil', 'Bloodhound',
    'Seasonal Coat', 'Burrower', 'Crystal Reservoir', 'Ossein Hunter', 'Radiant Being', 'Dreamscape',
]

# --- building blocks -------------------------------------------------------------
PASSIVE = {'type': 'passive'}
PROF = {'proficiency': True}


def hp_below(f):
    return {'type': 'self_hp_below', 'fraction': f}


def weather(*kw):
    return {'type': 'self_weather_contains', 'any': list(kw)}


def env(*kw):
    return {'type': 'environment', 'any': list(kw)}


def any_of(*gates):
    return {'type': 'any_of', 'gates': list(gates)}


def eff(kind, when=PASSIVE, while_=None, **fields):
    e = {'when': when}
    if while_:
        e['while'] = while_
    e['kind'] = kind
    e.update(fields)
    return e


NEXT_ATTACK = [{'type': 'uses', 'n': 1}]
UNTIL_ITS_NEXT_TURN_ENDS = [{'type': 'until_turn', 'whose': 'holder', 'point': 'end', 'count': 1}]
HIT_BY_MELEE = {'type': 'hit_by', 'melee': True}


def pinch(own_type, vp_type, note=None):
    gate = [hp_below(0.25)]
    out = [
        eff('damage_mod', while_=gate, diceMultiplier=1.5, filter={'moveTypes': [own_type], 'damaging': True}),
        eff('vp_cost_mod', while_=gate, multiplier=1.5, filter={'moveTypes': [vp_type], 'damaging': True}),
    ]
    if note:
        out[1]['note'] = note
    return out


def melee_retaliate(die, damage_type, optional=False):
    e = eff('retaliate', when=HIT_BY_MELEE, target='attacker', chance={'die': die, 'min': int(die[1:])},
            amount=PROF, damageType=damage_type)
    if optional:
        e['optional'] = True
    return [e]


def melee_condition(die, condition, ends=None):
    e = eff('condition', when=HIT_BY_MELEE, target='attacker', chance={'die': die, 'min': int(die[1:])}, apply=condition)
    if ends:
        e['ends'] = ends
    return [e]


def immune(**fields):
    return [eff('immunity', **fields)]


def weather_setter(name):
    return [eff('set_weather', when={'type': 'enter_battle'}, while_=[env('outside')], name=name, rounds=5,
                note='Ties with another weather ability go to the higher DEX score.')]


def end_turn_heal(*kw):
    return [eff('heal', when={'type': 'end_of_turn'}, while_=[weather(*kw)], amount=PROF)]


def type_override(to, frm=None, flt=None):
    e = eff('move_type_override', to=to)
    if frm:
        e['from'] = frm
    if flt:
        e['filter'] = flt
    return e


PUNCH = ['Sucker Punch', 'Thunder Punch', 'Cataclysm Punch', 'Drain Punch', 'Dynamic Punch', 'Focus Punch',
         'Mach Punch', 'Power-Up Punch', 'Fire Punch', 'Shadow Punch', 'Ice Punch', 'Comet Punch', 'Dizzy Punch',
         'Mega Punch', 'Bullet Punch']
BITE = ['Bite', 'Crunch', 'Hydra Bite', 'Bug Bite', 'Thunder Fang', 'Fire Fang', 'Ice Fang', 'Hyper Fang',
        'Super Fang', 'Poison Fang', 'Dream Fang', 'Psychic Fangs', 'Temporal Fang']
AURA_PULSE = ['Celestial Aura', 'Aura Sphere', 'Aura Theft', 'Cosmic Pulse', 'Dark Pulse', 'Dragon Pulse',
              'Magnetic Pulse', 'Photon Pulse', 'Heal Pulse', 'Origin Pulse', 'Water Pulse']
POWDER = ['Powder', 'Powder Cloud', 'Rage Powder', 'Disorienting Powder', 'Sleep Powder', 'Poison Powder',
          'Stun Spore', 'Cotton Spore', 'Spore', 'Spore Cloud', 'Release Spores', 'Bioluminescent Spores']
STATUS_FOUR = ['poisoned', 'burned', 'confused', 'paralyzed']

# --- batch A effects ----------------------------------------------------------------
EFFECTS = {
    # pinch boosts (below 25% HP)
    'Overgrow': pinch('Grass', 'Grass', note="The dex text says WATER moves cost more -- a typo for grass (user's call, 2026-10-08)."),
    'Blaze': pinch('Fire', 'Fire'),
    'Torrent': pinch('Water', 'Water'),
    'Swarm': pinch('Bug', 'Bug'),
    'Defeatist': [eff('roll', while_=[hp_below(0.25)], roll='disadvantage', on='attack_rolls')],
    'Berserk': [
        eff('roll', while_=[hp_below(0.25)], roll='disadvantage', on='attack_rolls'),
        eff('damage_mod', while_=[hp_below(0.25)], totalMultiplier=2, filter={'damaging': True}),
        eff('roll', while_=[hp_below(0.25)], roll='advantage', on='saves_against_its_moves'),
    ],
    'Ferocity': [
        eff('vp_cost_mod', while_=[hp_below(0.5), {'type': 'self_hp_at_or_above', 'fraction': 0.25}], multiplier=2, filter={'damaging': True}),
        eff('damage_mod', while_=[hp_below(0.5), {'type': 'self_hp_at_or_above', 'fraction': 0.25}], extraDice='2d6', flatBonus='proficiency', filter={'attackRoll': True}),
        eff('vp_cost_mod', while_=[hp_below(0.25)], multiplier=3, filter={'damaging': True}),
        eff('damage_mod', while_=[hp_below(0.25)], extraDice='4d6', flatBonus='proficiency', filter={'attackRoll': True}),
    ],
    'Multiscale': [eff('damage_taken_mod', while_=[{'type': 'self_hp_full'}], multiplier=0.5, firstOnly=True)],
    'Shadow Shield': [eff('damage_taken_mod', while_=[{'type': 'self_hp_full'}], multiplier=0.5, firstOnly=True)],

    # crits
    'Battle Armor': immune(critDamage=True),
    'Shell Armor': immune(critDamage=True),
    'Solid Rock': immune(critDamage=True),
    'Super Luck': [eff('crit_range', amount=1)],
    'Sniper': [eff('crit_dice_multiplier', multiplier=3)],
    'Anger Point': [eff('damage_mod', when={'type': 'crit_taken'}, diceMultiplier=2, filter={'damaging': True},
                        ends=NEXT_ATTACK + [{'type': 'until_turn', 'whose': 'holder', 'point': 'end', 'count': 1}],
                        note='One move on its following turn.')],

    # stat protection
    'Clear Body': [eff('stat_lock')],
    'Full Metal Body': [eff('stat_lock')],
    'White Smoke': [eff('stat_lock')],
    'Big Pecks': [eff('stat_lock', stats=['ac'])],
    'Hyper Cutter': [eff('stat_lock', stats=['attack_rolls', 'damage_rolls'])],

    # condition immunities
    'Immunity': immune(conditions=['poisoned']),
    'Insomnia': immune(conditions=['asleep']),
    'Vital Spirit': immune(conditions=['asleep']),
    "Sentinel's Vigil": immune(conditions=['asleep'], note="Text: can't UNWILLINGLY fall asleep."),
    'Limber': immune(conditions=['paralyzed']),
    'Magma Armor': immune(conditions=['frozen']),
    'Own Tempo': immune(conditions=['confused']),
    'Inner Focus': immune(conditions=['flinched']),
    'Water Veil': immune(conditions=['burned']),
    'Oblivious': immune(conditions=['charmed', 'taunted']),
    'Hydration': [eff('immunity', while_=[any_of(weather('rain'), env('water'))], negativeConditions=True)],
    'Leaf Guard': [eff('immunity', while_=[weather('sun')], negativeConditions=True)],

    # damage immunities, resistances, absorbs
    'Levitate': immune(damageTypes=['Ground']),
    'Bulletproof': immune(nameMatch=['Bullet', 'Ball', 'Bomb']),
    'Cacophony': immune(soundBased=True),
    'Soundproof': immune(soundBased=True),
    'Damp': immune(moves=['Self-Destruct', 'Explosion']),
    'Telepathy': immune(allyAttacks=True),
    'Rock Head': immune(recoil=True),
    'Solid Gold': [eff('immunity', damageTypes=['Poison', 'Electric', 'Ice', 'Grass']), eff('immunity', vulnerabilityExtra=True)],
    'Wonder Guard': immune(nonVulnerableDamage=True),
    'Volt Absorb': [eff('absorb', damageTypes=['Electric'], healFraction=0.5)],
    'Water Absorb': [eff('absorb', damageTypes=['Water'], healFraction=0.5)],
    'Sap Sipper': [
        eff('immunity', damageTypes=['Grass']),
        eff('roll', when={'type': 'hit_by', 'moveTypes': ['Grass']}, roll='advantage', on='attack_rolls', ends=NEXT_ATTACK),
    ],
    'Flash Fire': [
        eff('immunity', damageTypes=['Fire']),
        eff('stab_mod', when={'type': 'hit_by', 'moveTypes': ['Fire']}, multiplier=2, filter={'moveTypes': ['Fire']}, ends=NEXT_ATTACK,
            note='Also triggered by standing in open flames.'),
        eff('ignore_resistance', when={'type': 'hit_by', 'moveTypes': ['Fire']}, filter={'moveTypes': ['Fire']}, ends=NEXT_ATTACK),
    ],
    'Power Surge': [
        eff('immunity', damageTypes=['Electric']),
        eff('stab_mod', when={'type': 'hit_by', 'moveTypes': ['Electric']}, multiplier=2, filter={'moveTypes': ['Electric']}, ends=NEXT_ATTACK,
            note='Also triggered by being in an electric current.'),
    ],
    'Heatproof': [eff('damage_taken_mod', multiplier=0.5, filter={'damageTypes': ['Fire']}), eff('immunity', conditions=['burned'])],
    'Thick Fat': [eff('damage_taken_mod', multiplier=0.5, filter={'damageTypes': ['Ice', 'Fire']})],
    'Water Bubble': [eff('resistance', damageTypes=['Fire']), eff('immunity', conditions=['burned'])],
    'Fluffy': [eff('vulnerability', damageTypes=['Fire']), eff('damage_taken_mod', multiplier=0.5, filter={'melee': True, 'notTypes': ['Fire']})],
    'Light Armor': [eff('damage_taken_mod', multiplier=0.75, filter={'superEffective': True}, note='Rounded down.')],
    'Paper Thin': [eff('vulnerability', damageTypes=['Fire']), eff('damage_taken_mod', filter={'crit': True}, maxDamage=True)],
    'Desert Adaptation': [
        eff('resistance', damageTypes=['Fire']),
        eff('type_proficiency', moveTypes=['Ground']),
        eff('manual', note='No penalty from extreme heat.'),
    ],
    'Reinforced Form': [
        eff('resistance', damageTypes=['Normal', 'Steel']),
        eff('manual', note='+2 AC defending a location held for a day; immune to forced movement on ground it has cleaned.'),
    ],
    'Ancient Ward': [
        eff('resistance', damageTypes=['Cosmic']),
        eff('manual', note='Out of combat: predicts stellar events, senses Cosmic/Psychic/Ghost/Dark energy within 5 miles.'),
    ],

    # melee retaliation
    'Rough Skin': melee_retaliate('d4', '', optional=True),
    'Iron Barbs': melee_retaliate('d4', '', optional=True),
    'Static': melee_retaliate('d4', 'Electric'),
    'Poison Point': melee_retaliate('d4', 'Poison'),
    'Effect Spore': melee_retaliate('d4', 'Grass'),
    'Flame Body': melee_condition('d10', 'burned') + [eff('manual', note='Sheds dim light in a 15 ft radius.')],
    'Stench': melee_condition('d10', 'flinched'),
    'Gooey': [eff('stat', when=HIT_BY_MELEE, target='attacker', chance={'die': 'd4', 'min': 4}, stat='speed', set=0,
                  ends=UNTIL_ITS_NEXT_TURN_ENDS)],
    'Cursed Body': [eff('condition', when=HIT_BY_MELEE, target='attacker', chance={'die': 'd4', 'min': 4}, optional=True,
                        apply='move_disabled', value='the move it just used', ends=UNTIL_ITS_NEXT_TURN_ENDS)],
    'Emberflame': [
        eff('retaliate', when=HIT_BY_MELEE, target='attacker', amount={'dice': '1d4', 'plus': 'proficiency'}, damageType='Fire',
            note='Also when a creature within 5 feet grapples it.'),
        eff('manual', note='Sheds dim light in a 10 ft radius while conscious.'),
    ],
    'Static Wool': [
        eff('retaliate', when=HIT_BY_MELEE, target='attacker', save={'ability': 'CON', 'dc': 10}, amount={'dice': '1d6'}, damageType='Electric'),
        eff('roll', when=HIT_BY_MELEE, target='attacker', save={'ability': 'CON', 'dc': 10}, roll='disadvantage', on='attack_rolls',
            ends=UNTIL_ITS_NEXT_TURN_ENDS),
    ],
    'Poison Touch': [eff('condition', when={'type': 'hits', 'melee': True}, target='target', chance={'die': 'd10', 'min': 10}, apply='poisoned')],
    'Aftermath': [eff('retaliate', when={'type': 'knocked_out', 'melee': True}, target='attacker', amount={'fractionOfDamage': 0.5}, damageType='')],
    'Innards Out': [eff('retaliate', when={'type': 'knocked_out', 'damaging': True}, target='attacker', amount={'fractionOfDamage': 1}, damageType='',
                        note='Equal to the HP it lost to that move.')],

    # weather
    'Drizzle': weather_setter('Rain'),
    'Drought': weather_setter('Harsh Sunlight'),
    'Sand Stream': weather_setter('Sandstorm'),
    'Snow Warning': weather_setter('Hail'),
    'Rain Dish': end_turn_heal('rain'),
    'Ice Body': end_turn_heal('hail', 'snow'),
    'Dry Skin': [
        eff('lose_hp', when={'type': 'end_of_turn'}, while_=[weather('sun')], amount=PROF),
        eff('heal', when={'type': 'end_of_turn'}, while_=[weather('rain')], amount=PROF),
    ],
    'Chlorophyll': [
        eff('stat', while_=[weather('sun')], stat='speed', amount={'multiplier': 2}),
        eff('heal', when={'type': 'start_of_turn'}, while_=[weather('sun')], amount=PROF),
    ],
    'Swift Swim': [eff('stat', while_=[weather('rain')], stat='swim_speed', amount={'multiplier': 2})],
    'Sand Rush': [immune(weatherDamage=['sand'])[0], eff('stat', while_=[any_of(weather('sand'), env('desert'))], stat='speed', amount={'multiplier': 2})],
    'Slush Rush': [immune(weatherDamage=['hail'])[0], eff('stat', while_=[any_of(weather('hail'), env('arctic'))], stat='speed', amount={'multiplier': 2})],
    'Sand Veil': [immune(weatherDamage=['sand'])[0], eff('stat', while_=[any_of(weather('sand'), env('desert'))], stat='ac', amount=2)],
    'Snow Cloak': [immune(weatherDamage=['hail'])[0], eff('stat', while_=[any_of(weather('hail', 'snow'), env('arctic'))], stat='ac', amount=2)],
    'Stone Veil': [eff('stat', while_=[any_of(weather('sand'), env('rocky'))], stat='ac', amount=2)],
    'Sand Force': [eff('stab_mod', while_=[weather('sand')], multiplier=2, filter={'damaging': True})],

    # common reactive ones
    'Pressure': [eff('vp_cost_mod', when={'type': 'targeted', 'direct': True}, target='attacker', multiplier=2,
                     note='Single-target moves only (not area of effect).')],
    # Any enemy on the field, not only attacks against this Pokemon (user confirmed, 2026-10-08).
    'Intimidate': [eff('roll', when={'type': 'enemy_attack_roll'}, target='attacker', roll='disadvantage', on='attack_rolls',
                       optional=True, limit={'uses': 1, 'per': 'short_rest'}, ends=NEXT_ATTACK)],
    'Cute Charm': [eff('roll', when={'type': 'enemy_attack_roll'}, target='attacker', roll='disadvantage', on='attack_rolls',
                       optional=True, limit={'uses': 1, 'per': 'short_rest'}, ends=NEXT_ATTACK)],
    'Speed Boost': [eff('roll', while_=[env('type_habitat')], target='trainer', roll='advantage', on='initiative',
                        note='Environment related to its type -- DM decides.')],
    'Unburden': [eff('roll', while_=[{'type': 'self_no_held_item'}], target='trainer', roll='advantage', on='initiative')],
    'Magic Guard': [eff('damage_taken_mod', multiplier=0, filter={'saveForHalf': True, 'saveSucceeded': True})],
    'Infiltrator': [
        eff('ignore_protections', names=['Light Screen', 'Reflect']),
        eff('ignore_resistance', while_=[{'type': 'target_status', 'any': ['asleep', 'frightened']}], filter={'damaging': True}),
    ],

    # flat bonuses
    'Compound Eyes': [eff('attack_bonus', amount=1)],
    'Gale Wings': [eff('attack_bonus', amount=1, filter={'moveTypes': ['Flying']})],
    'Victory Star': [eff('attack_bonus', target='allies', amount=1, note='All allied Pokemon in battle (within 50 ft).', radiusFt=50)],
    'Plus': [eff('attack_bonus', while_=[{'type': 'ally_has_ability', 'any': ['Plus', 'Minus']}], amount=2),
             eff('damage_mod', while_=[{'type': 'ally_has_ability', 'any': ['Plus', 'Minus']}], flatBonus=2, filter={'damaging': True})],
    'Minus': [eff('attack_bonus', while_=[{'type': 'ally_has_ability', 'any': ['Plus', 'Minus']}], amount=2),
              eff('damage_mod', while_=[{'type': 'ally_has_ability', 'any': ['Plus', 'Minus']}], flatBonus=2, filter={'damaging': True})],
    'Competitive': [eff('damage_mod', while_=[{'type': 'self_status', 'any': STATUS_FOUR}], flatBonus='proficiency', filter={'damaging': True})],
    'Sheer Force': [eff('damage_mod', while_=[{'type': 'self_status', 'any': STATUS_FOUR}], flatBonus='proficiency', filter={'damaging': True})],
    'Flare Boost': [eff('damage_mod', while_=[{'type': 'self_status', 'any': ['burned']}], flatBonus='proficiency', filter={'damaging': True})],
    'Guts': [eff('manual', while_=[{'type': 'self_status', 'any': ['burned', 'poisoned']}],
                 note='Ignores the disadvantage / reduced damage of burned and poisoned; still takes their end-of-turn damage.')],
    'Marvel Scale': [eff('stat', while_=[{'type': 'self_negative_status'}], stat='ac', amount=2)],
    'Quick Feet': [eff('stat', while_=[{'type': 'self_negative_status'}], stat='speed', amount=15)],
    'Rivalry': [eff('damage_mod', while_=[{'type': 'target_shares_type'}], flatBonus='proficiency', filter={'damaging': True})],
    'Mega Launcher': [eff('damage_mod', flatBonus='proficiency', filter={'moves': AURA_PULSE})],
    'Merciless': [eff('damage_mod', while_=[{'type': 'target_status', 'any': ['poisoned']}], diceMultiplier=2, filter={'damaging': True})],
    'Iron Fist': [eff('damage_mod', rerollKeep='either', filter={'moves': PUNCH})],
    'Strong Jaw': [eff('damage_mod', rerollKeep='either', filter={'moves': BITE})],
    'Technician': [eff('damage_mod', rerollKeep='either', filter={'damaging': True, 'maxVpCost': 6})],
    'Adaptability': [eff('damage_mod', rerollKeep='either', filter={'damaging': True, 'ownType': True})],
    'Neuroforce': [eff('damage_mod', rerollKeep='higher', filter={'superEffective': True})],
    'Tinted Lens': [eff('ignore_resistance', filter={'damaging': True})],
    'Scrappy': [eff('ignore_immunity', moveTypes=['Normal', 'Fighting'], vsTypes=['Ghost'])],
    'Circuit Break': [eff('ignore_immunity', moveTypes=['Electric'], vsTypes=['Ground'])],
    'Reckless': [eff('stab_mod', multiplier=2, filter={'recoil': True})],
    'Tough Claws': [eff('stab_mod', grant=True, multiplier=2, filter={'melee': True, 'attackRoll': True},
                        note='Gets STAB on a melee hit whatever its type; if it already had STAB, double it.')],
    'Serene Grace': [eff('save_dc_bonus', amount=1, filter={'negativeCondition': True})],
    'Powder Master': [eff('save_dc_bonus', amount='level', filter={'moves': POWDER})],
    'No Guard': [eff('roll', roll='advantage', on='attack_rolls'), eff('roll', roll='advantage', on='attacks_against')],
    'Pack Tactics': [eff('roll', while_=[{'type': 'ally_adjacent_to_target'}], roll='advantage', on='attack_rolls')],
    'Early Bird': [eff('roll', roll='advantage', on='saving_throws', vsConditions=['asleep'])],
    'Wonder Skin': [eff('roll', roll='advantage', on='saving_throws', vsConditions=['burned', 'frozen', 'poisoned', 'paralyzed'])],
    'Long Reach': [eff('stat', stat='reach', amount=5, note='Melee attacks and attacks of opportunity.')],
    'Run Away': immune(opportunityAttacks=True),
    'Stall': [eff('initiative_position', position='last')],
    'Slow Start': [
        eff('stat', while_=[{'type': 'combat_round_at_most', 'n': 2}], stat='speed', amount={'multiplier': 0.5}),
        eff('roll', while_=[{'type': 'combat_round_at_most', 'n': 2}], roll='disadvantage', on='attack_rolls'),
    ],

    # type proficiency / conversion
    'Dark Native': [eff('type_proficiency', moveTypes=['Dark']), eff('manual', note='If it is also Dark type, double its proficiency bonus.')],
    'Psychic Boost': [eff('type_proficiency', moveTypes=['Psychic'])],
    'Winter Roots': [
        eff('type_proficiency', moveTypes=['Ice']),
        eff('heal', when={'type': 'ally_drain_heal'}, radiusFt=30, amount={'fractionOfAllyHealing': 0.5}),
    ],
    'Pixilate': [type_override('Fairy', frm='Normal')],
    'Normalize': [type_override('Normal')],
    'Liquid Voice': [type_override('Water', flt={'soundBased': True})],
    'Fairy Wings': [type_override('Fairy', frm='Flying', flt={'damaging': True})],
    'Fairy Breath': [type_override('Fairy', flt={'moves': ['Dragon Breath', 'Harmony Breath', 'Frost Breath']})],
    'Refrigerate': [type_override('Ice', frm='Normal'),
                    eff('manual', note='Ice moves freeze water surfaces and make 10 ft radius difficult terrain around the target.')],
    'Galvanize': [type_override('Electric', frm='Normal'),
                  eff('manual', note='Electric damage stores a charge (lasts 1 minute in combat); at 3 charges the next electric attack deals double damage, costs double VP and uses them all.')],
}


def main(apply):
    data = json.loads(FILE.read_text(encoding='utf-8'))
    by_name = {a['name']: a for a in data['abilities']}
    missing = [n for n in UNKNOWN + list(EFFECTS) if n not in by_name]
    if missing:
        sys.exit(f'Not in the ability list: {missing}')
    overlap = set(UNKNOWN) & set(EFFECTS)
    if overlap:
        sys.exit(f'Both unknown and tagged: {overlap}')

    for n in UNKNOWN:
        by_name[n]['categories'] = ['unknown']
        by_name[n]['effects'] = []
    for n, effects in EFFECTS.items():
        by_name[n].pop('categories', None)
        by_name[n]['effects'] = effects

    done = sum(1 for a in data['abilities'] if 'effects' in a)
    print(f'unknown: {len(UNKNOWN)}  tagged: {len(EFFECTS)}  backlog: {len(data["abilities"]) - done} of {len(data["abilities"])}')
    if apply:
        FILE.write_text(json.dumps(data, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')
        print('written')


if __name__ == '__main__':
    main('--apply' in sys.argv)
