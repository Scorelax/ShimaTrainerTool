#!/usr/bin/env python3
"""Abilities batch C: everything left -- status handling, items, action economy,
activated abilities, legendary/unique ones. Also adds `review` (questions for
Benjakronk) and writes them to abilities_to_check.md. Schema: ability-effects-schema.md.

    python migrate_abilities_v3.py            # dry run: report only
    python migrate_abilities_v3.py --apply    # rewrites DnD_abilities.json + abilities_to_check.md

Re-running overwrites only the abilities listed here.
"""
import json
import sys
from pathlib import Path

from migrate_abilities_v1 import FILE, HIT_BY_MELEE, NEXT_ATTACK, PROF, any_of, eff, env, hp_below, weather

CHECKLIST = Path(__file__).with_name('abilities_to_check.md')

UNTIL_ITS_NEXT_TURN_STARTS = [{'type': 'until_turn', 'whose': 'holder', 'point': 'start', 'count': 1}]
UNTIL_ITS_NEXT_TURN_ENDS = [{'type': 'until_turn', 'whose': 'holder', 'point': 'end', 'count': 1}]
ENCOUNTER = [{'type': 'encounter'}]
INSTANT = [{'type': 'instant'}]


def activated(action):
    return {'type': 'activated', 'action': action}


def dm(text):
    return {'type': 'dm_confirms', 'text': text}


def form(option, kind, **fields):
    """One effect of a pick-one form (Transformer): siblings with the same `choice` group."""
    return eff(kind, when=activated('1 bonus action'), choice={'kind': 'chosen', 'option': option}, **fields)


NEGATIVE = {'type': 'self_negative_status'}

EFFECTS = {
    # --- status handling -----------------------------------------------------------
    'Shed Skin': [eff('cure_condition', when={'type': 'end_of_turn'}, while_=[NEGATIVE], chance={'die': 'd4', 'min': 4},
                      negativeConditions=True)],
    'Natural Cure': [eff('cure_condition', when={'type': 'switched_out'}, negativeConditions=True)],
    'Synchronize': [eff('condition', when={'type': 'condition_gained', 'conditions': ['burned', 'paralyzed', 'poisoned'],
                                           'fromCreature': True}, target='attacker', valueFrom='gained_condition',
                        ignoreImmunity=True, note='The attacker gets the same condition, even if otherwise immune.')],
    'Magic Bounce': [eff('reflect_condition', when={'type': 'condition_gained', 'negative': True, 'fromCreature': True},
                         optional=True, limit={'uses': 1, 'per': 'long_rest'}, target='attacker')],
    'Shield Dust': [eff('negate_condition', when={'type': 'condition_gained', 'negative': True, 'fromMove': True, 'byEnemy': True},
                        optional=True, limit={'uses': 1, 'per': 'long_rest'})],
    'Steadfast': [eff('pass_save', when={'type': 'save_failed', 'vsNegativeCondition': True}, optional=True,
                      limit={'uses': 1, 'per': 'long_rest'})],
    'Poison Heal': [eff('invert_condition_damage', conditions=['poisoned'], note='Poison damage heals it instead.')],
    'Healer': [eff('cure_condition', when=activated('1 action'), target='touched', conditions=['poisoned', 'burned', 'paralyzed'],
                   pickOne=True, note='Then roll a d4: on 1-2 the cured condition moves to this Pokemon.')],
    'Hydra\'s Resilience': [
        eff('heal', when={'type': 'start_of_turn'}, while_=[{'type': 'not', 'gate': NEGATIVE}], optional=True,
            amount={'dice': '1d4', 'timesLevel': True}),
        eff('cure_condition', when={'type': 'start_of_turn'}, while_=[NEGATIVE], save={'ability': 'CON', 'dc': 15},
            negativeConditions=True, note='On a success it also gets immunity to conditions for 1d4 rounds (next entry).'),
        eff('immunity', when={'type': 'start_of_turn'}, while_=[NEGATIVE], save={'ability': 'CON', 'dc': 15},
            negativeConditions=True, ends=[{'type': 'rounds', 'dice': '1d4'}]),
    ],
    'Liquid Ooze': [eff('condition', when={'type': 'targeted', 'drain': True}, target='attacker',
                        save={'ability': 'CON', 'dc': 12}, apply='poisoned', note='Leeching / absorbing moves.')],
    'Sedative Spines': [eff('condition', when={'type': 'contact'}, target='other', save={'ability': 'CON', 'dc': 15}, apply='drowsy',
                            ends=[{'type': 'rounds', 'dice': '1d4', 'unit': 'minute'}],
                            note='Drowsy: disadvantage on saves and attack rolls, others get advantage on saves it causes. '
                                 'When it ends: unconscious (counts as asleep) for 1d12 hours, only a long rest wakes it.')],
    'Spotless': [eff('cure_condition', when=activated('1 action'), target='allies', radiusFt=10, conditions=['poisoned'],
                     limit={'uses': 1, 'per': 'day'}, note='Also cleans dirt and poison residue in the area.')],
    'Filter System': [
        eff('cure_condition', when=activated('1 action'), target='self_or_touched', pickOne=True, negativeConditions=True,
            check={'skill': 'Medicine'}, limit={'uses': 3, 'per': 'long_rest'}),
        eff('heal', when=activated('1 action'), check={'skill': 'Medicine'}, amount={'fractionMaxHP': 0.0625},
            note='Only when the medicine check succeeds; shares the 3 uses above.'),
    ],
    'Corrosion': [eff('ignore_immunity', conditions=['poisoned'], note='Can poison steel- and poison-types.')],
    'Bad Dreams': [eff('deal_damage', when={'type': 'creature_end_of_turn_within'}, target='enemies',
                       targetFilter={'conditions': ['asleep']}, amount=PROF, damageType='',
                       note='Every sleeping opponent in battle, at the end of each of ITS turns.')],
    'Toxic Surge': [
        eff('condition', when={'type': 'enter_battle'}, target='enemies', radiusFt=15,
            save={'ability': 'CON', 'dc': '8+proficiency+CON'}, apply='poisoned', value='badly'),
        eff('damage_mod', while_=[{'type': 'target_status', 'any': ['poisoned']}], extraDice='1d6', flatBonus='proficiency',
            damageType='Poison', filter={'damaging': True}, note='Read as: against a poisoned enemy.'),
    ],

    # --- items ---------------------------------------------------------------------
    'Cheek Pouch': [eff('heal', when={'type': 'berry_eaten'}, amount={'fractionMaxHP': 0.1, 'round': 'up'})],
    'Gluttony': [eff('consume_held_berry', when={'type': 'damaged', 'crossesBelowFraction': 0.5}, mandatory=True)],
    'Harvest': [eff('restore_item', when={'type': 'end_of_turn'}, while_=[{'type': 'self_used_berry_this_turn'}],
                    chance={'die': 'd4', 'min': 3}, note='Gets the berry back as its held item.')],
    'Klutz': [eff('no_held_item')],
    'Magician': [eff('steal_item', when={'type': 'hits', 'melee': True}, while_=[{'type': 'self_no_held_item'}], target='target')],
    'Pickpocket': [eff('steal_item', when=activated('1 bonus action'), target='target',
                       contest={'self': 'DEX', 'target': 'WIS'},
                       note='After the first attempt, further attempts on the same opponent are at disadvantage.')],
    'Pickup': [eff('copy_item', when={'type': 'enemy_used_consumable_item'}, while_=[{'type': 'self_no_held_item'}])],
    'Sticky Hold': [eff('immunity', itemRemoval=True)],
    'Symbiosis': [eff('swap_item', when=activated('free'), target='ally', radiusFt=15)],
    'Unnerve': [eff('item_use_save', target='enemies', save={'ability': 'WIS', 'dc': 15}, note='To consume an item.')],
    'Multitype': [eff('type_from_held_item', item='Elemental Plate', note='The plate cannot be removed by any ability or move.')],
    'RKS System': [eff('type_from_held_item', item='memory disc')],

    # --- action economy / initiative ---------------------------------------------
    'Hustle': [eff('extra_action', when={'type': 'crit_dealt'}, optional=True, limit={'uses': 1, 'per': 'round'},
                   note='An attack made with that action has disadvantage.')],
    'Battle Tactics': [eff('extra_action', while_=[hp_below(0.5)])],
    'Prankster': [eff('initiative_position', when={'type': 'start_of_round'}, optional=True, position='first',
                      limit={'uses': 1, 'per': 'short_rest'}, note='Must use a status-affecting move on that turn.')],
    'Mischief Maker': [eff('initiative_position', position='any', note='Each round it may take its turn whenever it wants.')],
    'Truant': [eff('no_repeat_move', note="Can't use the same move in back-to-back rounds.")],
    'Triage': [eff('action_cost_override', to='1 bonus action', filter={'healing': True}, note='Healing or draining moves.')],
    'Grassy Surge': [eff('action_cost_override', to='1 bonus action', filter={'moves': ['Grassy Terrain']})],
    'Imposter': [eff('action_cost_override', to='1 bonus action', filter={'moves': ['Transform']})],
    "Mercury's Blessing": [eff('action_cost_override', to='1 bonus action', filter={'moves': ['Thief']})],
    'Toxic Aura': [eff('use_move', when={'type': 'start_of_turn'}, optional=True, move='Smog', free=True, action='1 bonus action')],
    'Dancer': [eff('reaction_move', when={'type': 'creature_used_move', 'nameMatch': ['Dance']}, reaction=True, optional=True,
                   note='Any creature it can see; it uses one of its own moves.')],
    'Skill Link': [eff('multi_hit_minimum', min=2, note='Combo moves that hit more than once off the same attack roll.')],
    'Huge Power': [eff('damage_mod', when={'type': 'before_attack_roll'}, optional=True, limit={'uses': 1, 'per': 'short_rest'},
                       totalMultiplier=2, filter={'attackRoll': True}, ends=NEXT_ATTACK, note='Must be announced before the attack roll.')],
    'Pure Power': [eff('damage_mod', when={'type': 'before_attack_roll'}, optional=True, limit={'uses': 1, 'per': 'short_rest'},
                       totalMultiplier=2, filter={'attackRoll': True}, ends=NEXT_ATTACK, note='Must be announced before the attack roll.')],

    # --- attack and damage ---------------------------------------------------------
    'Curiosity': [eff('damage_mod', extraDice='2d10', damageType='', filter={'attackRoll': True, 'firstUseInEncounter': True})],
    'Hematophage': [eff('heal', when={'type': 'hits', 'melee': True, 'damaging': True}, amount={'fractionOfDamageDealt': 0.5})],
    'Water Vein': [eff('heal', when={'type': 'move_used', 'moveTypes': ['Water']}, amount={'fractionMaxHP': 0.0625})],
    'Maritime Prowler': [eff('condition', when={'type': 'hits', 'moveTypes': ['Water', 'Dark'], 'naturalRollMin': 18},
                             target='target', apply='flinched')],
    'Mold Breaker': [eff('ignore_target_abilities', note='Abilities that would lessen its moves or their chance to hit.')],
    'Teravolt': [eff('ignore_target_abilities', note='Abilities that would hinder its moves or their chance to hit.')],
    'Turboblaze': [eff('ignore_target_abilities', note='Abilities that would hinder its moves or their chance to hit.')],
    'Unaware': [eff('ignore_target_stat_changes', note='Boosts since the start of battle, including AC and saves.')],
    'Honorable': [
        eff('damage_mod', while_=[{'type': 'self_level_at_least', 'n': 10}, {'type': 'self_hp_at_or_above', 'fraction': 0.5},
                                  {'type': 'target_level_below', 'n': 10}], totalMultiplier=0.5, filter={'damaging': True}),
        eff('damage_mod', while_=[{'type': 'self_level_at_least', 'n': 10}, {'type': 'self_hp_at_or_above', 'fraction': 0.5},
                                  {'type': 'target_level_at_least', 'n': 10}],
            extraDice='1d12', flatBonus='proficiency', damageType='', filter={'damaging': True}),
    ],
    'Predator': [
        eff('attack_bonus', while_=[{'type': 'target_marked', 'mark': 'prey'}], amount='proficiency',
            note='Double proficiency = one extra proficiency bonus. Prey is chosen during a long rest.'),
        eff('damage_mod', while_=[{'type': 'target_marked', 'mark': 'prey'}], rerollKeep='higher', filter={'damaging': True}),
    ],
    'Prey Stalker': [
        eff('roll', while_=[{'type': 'target_level_below_self'}], roll='advantage', on='attack_rolls'),
        eff('damage_mod', while_=[{'type': 'target_level_below_self'}], rerollKeep='higher', filter={'damaging': True}),
    ],
    'Protector': [
        eff('attack_bonus', while_=[dm('a lower-stage ally of its own family is in danger')], amount=5),
        eff('damage_mod', while_=[dm('a lower-stage ally of its own family is in danger')], flatBonus='proficiency',
            filter={'damaging': True}, note='Once per move.'),
    ],
    'Ram': [
        eff('roll', while_=[{'type': 'moved_straight_at_least', 'ft': 15}], roll='advantage', on='attack_rolls', filter={'melee': True}),
        eff('damage_mod', while_=[{'type': 'moved_straight_at_least', 'ft': 15}], rerollKeep='higher', filter={'melee': True}),
    ],
    'Solvent Tail': [
        eff('damage_mod', while_=[{'type': 'target_types', 'any': ['Poison', 'Steel']}], extraDice='1d4',
            scaling={'5': '1d6', '10': '2d6', '17': '2d8'}, filter={'damaging': True}),
        eff('manual', note="Bonus action: coat an ally's weapon with the same bonus for 1 minute."),
    ],
    'Stakeout': [eff('damage_mod', when={'type': 'enemy_switched_in'}, totalMultiplier=2, filter={'damaging': True},
                     targetFilter={'switchedIn': True}, ends=UNTIL_ITS_NEXT_TURN_ENDS,
                     note='Only against the replacement, on its first turn after the switch.')],
    'Spirit Guide': [
        eff('ignore_immunity', moveTypes=['Ghost'], vsTypes=['Normal', 'Fighting']),
        eff('type_proficiency', moveTypes=['Ghost']),
        eff('manual', note='Dying creatures within 15 ft can talk to it; reaction: change the outcome of a death saving throw.'),
    ],
    'Fortune\'s Favor': [eff('reroll_ones', pool={'halfLevel': True}, appliesTo=['self', 'trainer'],
                             note='Luck points: spend one when it or its trainer rolls a 1 to reroll that die.')],
    'Energy Intensive': [
        eff('lose_hp', when={'type': 'start_of_turn'}, pool='VP', amount=PROF),
        eff('vulnerability', damageTypes=['Psychic']),
        eff('lose_hp', when={'type': 'damaged', 'moveTypes': ['Psychic']}, pool='VP', amount={'fractionOfDamage': 1}),
    ],

    # --- defences ------------------------------------------------------------------
    'Cosmic Core': [
        eff('immunity', damageTypes=['Ground']),
        eff('deal_damage', when={'type': 'hit_by', 'damaging': True}, chance={'die': 'd12', 'min': 8}, target='all', radiusFt=15,
            amount={'fractionOfDamage': 0.5}, damageType='', note='Half the damage it took, reflected around it.'),
    ],
    'Ether Mirror': [eff('reflect_attack', when={'type': 'hit_by', 'ranged': True}, target='attacker',
                         note='All damage and effects rolled apply to the attacker instead.')],
    'Fireproof': [
        eff('resistance', damageTypes=['Fire']),
        eff('manual', when={'type': 'hit_by', 'moveTypes': ['Fire']},
            note='Roll 1d4: on a 1 the web burns away (resistance lost). Each later roll burns it on one more number. Resets on a long rest.'),
    ],
    'Overcoat': [eff('immunity', weatherDamage=['sand', 'hail'], moves=['Hail', 'Sandstorm', 'Weather Ball'])],
    'Grass Pelt': [eff('stat', while_=[{'type': 'self_terrain_contains', 'any': ['grass']}], stat='ac', amount=1)],
    'Surge Surfer': [eff('stat', when={'type': 'start_of_turn'}, while_=[{'type': 'self_terrain_contains', 'any': ['electric']}],
                         stat='speed', amount={'multiplier': 2}, ends=UNTIL_ITS_NEXT_TURN_ENDS)],
    'Surface Tension': [eff('immunity', hazards=True), eff('manual', note='Can walk on water.')],
    'Suction Cups': [eff('immunity', forcedSwitch=True)],
    'Saline Syntesis': [
        eff('resistance', while_=[any_of(weather('rain'), env('water'))], damageTypes='all_not_vulnerable'),
        eff('immunity', while_=[any_of(weather('rain'), env('water'))], vulnerabilityExtra=True),
        eff('heal', when={'type': 'start_of_turn'}, while_=[env('salt_water')], amount={'fractionMaxHP': 0.0625}),
    ],
    'Adaptive Cells': [eff('resistance', when={'type': 'start_of_turn'}, optional=True, valueFrom='damage_type_taken_since_last_turn',
                           ends=[{'type': 'other', 'text': 'until it uses this ability again'}])],
    'Between Worlds': [eff('resistance', when=activated('1 bonus action'), damageTypes='all', exceptTypes=['Psychic', 'Fairy'],
                           ends=UNTIL_ITS_NEXT_TURN_STARTS)],
    'Time Vision': [
        eff('roll', roll='advantage', on='attack_rolls'),
        eff('roll', roll='advantage', on='saving_throws'),
        eff('roll', roll='disadvantage', on='opportunity_attacks_against'),
        eff('immunity', surprised=True),
    ],
    'Warning Chime': [eff('immunity', target='self_and_allies', radiusFt=60, surprised=True,
                          scaling={'10': {'radiusFt': 100}})],
    'Mystical Presence': [eff('save_ability_override', use='CHA')],
    'Ancient Connection': [eff('roll', while_=[dm('within 60 ft of an ancient artifact')], roll='advantage', on='saving_throws', ability='WIS')],
    'Keen Eye': [eff('ignore_disadvantage', source='sight')],
    'Contrary': [eff('invert_stat_changes', filter={'fromMoves': True})],
    'Tangling Hair': [eff('condition', target='enemies', radiusFt=5, apply='no_disengage')],
    'Abyssal Presence': [
        eff('difficult_terrain', target='chosen', radiusFt=60, note='Creatures it chooses; the area moves with it.'),
        eff('manual', note='Dim light within the area counts as darkness.'),
    ],

    # --- activated / healing -------------------------------------------------------
    'Healing Rain': [eff('heal', when=activated('1 action'), while_=[weather('rain')], amount={'level': 1})],
    'Regenerator': [eff('heal', when={'type': 'switched_out'}, limit={'uses': 1, 'per': 'long_rest'}, amount={'level': 1})],
    'Forest Blessing': [
        eff('heal', when=activated('1 action'), target='chosen', targetFilter={'types': ['Grass']},
            amount={'dice': '2d4', 'plus': 'WIS'}, scaling={'5': '2d6', '10': '2d8', '17': '2d12'},
            limit={'uses': 3, 'per': 'long_rest'}, note='Plant or grass-type Pokemon.'),
        eff('manual', note='Passive: plants within 20 ft grow more vigorously and resist disease.'),
    ],
    'Eternal Radiance': [
        eff('immunity', conditions=['blinded']),
        eff('heal', when={'type': 'start_of_turn'}, target='allies', radiusFt=30, amount={'dice': '1d8'},
            note='Stronger near magical or ancient light.'),
        eff('manual', note='Creatures looking directly at it: CON save or blinded for 1 round. Action: illusions, '
                           'reveal invisible creatures, or blind enemies in a 60 ft radius.'),
    ],
    'Reality Weaver': [eff('force_reroll', while_=[dm("Jirachi's third eye is open")], reaction=True, optional=True,
                           radiusFt=60, note='Any d20 roll made in the area.')],
    'Cosmic Slumber': [
        eff('condition', apply='asleep', note='Always asleep -- its normal state; it still senses, decides and uses a limited set of moves.'),
        eff('heal', when={'type': 'start_of_turn'}, amount={'flat': 10, 'proficiencyMultiple': 2}),
    ],

    # --- forms ---------------------------------------------------------------------
    'Schooling': [eff('stat', when={'type': 'start_of_turn'},
                      while_=[{'type': 'self_level_at_least', 'n': 5}, {'type': 'self_hp_at_or_above', 'fraction': 0.25}],
                      optional=True, stat='ac', amount=5, limit={'uses': 1, 'per': 'short_rest'},
                      alsoStats={'str': 5, 'dex': 5, 'con': 5},
                      ends=[{'type': 'hp_below', 'fraction': 0.25}],
                      note="School Form. The extra CON doesn't change its HP.")],
    'Stance Change': [eff('swap_stats', when={'type': 'move_used', 'moves': ["King's Shield"]}, stats=['ac', 'dex'],
                          ends=[{'type': 'move_used', 'damaging': True}], note='Shield Forme; a damaging move returns it to Blade Forme.')],
    'Transformer': [
        form('Attack', 'attack_bonus', amount=5),
        form('Attack', 'roll', roll='advantage', on='attacks_against'),
        form('Defense', 'stat', stat='ac', amount=3),
        form('Defense', 'roll', roll='disadvantage', on='attack_rolls'),
        form('Defense', 'roll', roll='advantage', on='saves_against_its_moves'),
        form('Speed', 'extra_action', note='An extra attack action each turn, made at disadvantage.'),
        form('Speed', 'roll', roll='advantage', on='saves_against_its_moves'),
    ],
    'Trace': [eff('copy_ability', when={'type': 'enter_battle'}, random=True, target='enemy',
                  exclude=['Flower Gift', 'Forecast', 'Illusion', 'Imposter', 'Multitype', 'Trace', 'Wonder Guard', 'Zen Mode'])],
    'Mummy': [eff('replace_ability', when=HIT_BY_MELEE, target='attacker', random=True, to='Mummy', ends=ENCOUNTER)],
    'Magnetic Polarity': [
        eff('manual', when={'type': 'hit_by', 'moveTypes': ['Electric']}, choice={'kind': 'random', 'die': 'd4', 'roll': 1},
            note='Takes the damage as usual.'),
        eff('split_damage', when={'type': 'hit_by', 'moveTypes': ['Electric']}, choice={'kind': 'random', 'die': 'd4', 'roll': 2},
            pools=['HP', 'VP']),
        eff('split_damage', when={'type': 'hit_by', 'moveTypes': ['Electric']}, choice={'kind': 'random', 'die': 'd4', 'roll': 3},
            pools=['HP', 'VP']),
        eff('store_damage', when={'type': 'hit_by', 'moveTypes': ['Electric']}, choice={'kind': 'random', 'die': 'd4', 'roll': 4},
            damageType='Electric', ends=NEXT_ATTACK, note='Added to its next damaging move as bonus electric damage.'),
    ],
    'Volcanic Shell': [eff('deal_damage', when={'type': 'hit_by', 'melee': True}, reaction=True, optional=True, target='all', radiusFt=5,
                           damageType='Fire', amount={'diceBySize': {'Tiny': '1d4', 'Small': '2d4', 'Medium': '3d4', 'Large': '4d4',
                                                                      'Huge': '5d4', 'Gigantic': '6d4'}})],

    # --- information on entering battle ---------------------------------------------
    'Anticipation': [eff('reveal', when={'type': 'enter_battle'}, target='enemy', what='super_effective_move',
                         note='Only WHETHER it has a move this Pokemon is vulnerable to -- not which move.')],
    'Forewarn': [eff('reveal', when={'type': 'enter_battle'}, target='chosen', what='strongest_move',
                     note='On a tie, the target chooses which one it reveals.')],
    'Frisk': [eff('reveal', when={'type': 'enter_battle'}, target='enemy', what='held_item')],

    # --- mostly manual (unique mechanics the engine only reminds about) -------------
    'Negating Cone': [eff('negation_zone', when=activated('1 bonus action'), shape='cone', lengthFt=150,
                          exceptMoveTypes=['Normal'], exceptSelf=True,
                          note='Bonus action: aim the cone and switch it on or off. Moves other than normal-type are '
                               "negated inside it; the beholder's own moves aren't.")],
    'Forme Change': [eff('manual', when=activated('1 bonus action'), note="Deoxys switches between its four forms.")],
    'Multiple Heads': [eff('manual', note='Start of turn: choose an active head, gaining its type as a secondary type for the round. '
                                          'A head taking 25+ damage in one turn dies; end of next turn, bonus action: 1d6 per lost head, '
                                          'regrow one on a 5, two on a 6.')],
    'Incorporeal Body': [eff('manual', note='Moves through walls (difficult terrain). Inside a wall it takes half damage. '
                                            'Entering costs 5 VP, plus 5 VP at the start of each turn inside.')],
    'Formation Leader': [
        eff('stat', when=activated('1 bonus action'), target='formation', stat='ac', amount=2),
        eff('roll', when=activated('1 bonus action'), target='formation', roll='advantage', on='saving_throws', ability='STR'),
        eff('manual', note='Formation: 5 + half its level creatures (Large or smaller, at least 5) each within 5 ft of the next. '
                           'They only move when the leader moves them; a gap breaks it. Does not stack.'),
    ],
}

# Questions for Benjakronk -- the effects above (or from v2) are a best guess until answered.
REVIEW = {
    'Peace Aura': 'No save DC is given. What is it (e.g. 8 + proficiency + WIS)? And "at the beginning of each turn" -- '
                  "each of this Pokemon's turns, or each creature's turn?",
    'Frigid Aura': 'The CON save against becoming slowed has no DC. What is it?',
    'Proper Form': 'No use limit. Does it cost the reaction each time, or is it limited (once per round / short rest)?',
    'Fairy Aura': '"Fairy moves by OTHER creatures" are doubled (not its own), while Dark Aura says "allies or opponents". Intentional?',
    'Dark Aura': 'Does it also double its own dark moves? (Fairy Aura excludes its own.)',
    'Arena Trap': '"Grounded creatures within 50 ft" -- does that include its own allies, or only opponents?',
    'Shadow Tag': '"Creatures within 50 ft" -- does that include its own allies, or only opponents?',
    'Balance Keeper': '"At the end of every turn, revert any stat changes" -- only its own stat changes, or every creature\'s? '
                      'Every creature\'s turn, or only its own?',
    'Battle Tactics': 'One extra action every turn while below 50% HP, or a single extra action when it first drops below?',
    'Noble Presence': '"At the beginning of each turn during initiative" -- each of its own turns, or every creature\'s turn?',
    'Molten Armor': 'While superheated, is the extra fire damage on ITS melee attacks, or on melee attacks made against it?',
    'Reality Ripper': 'Which moves count as "slashing attacks"? (Slash, Night Slash, the Claw and Cutter moves, Leaf Blade ...?)',
    'Royal Decree': 'What is the WIS save DC, and what kind of command (one word like Command, or anything)?',
    'Vector': 'What is the CON save DC?',
    'Void Manifest': 'What does Watcher\'s Guise do? Only Void Form is described.',
    'Imperial Authority': 'What does "override the ability of another Pokemon" mean -- suppress it, or replace it with something?',
    'Ether Dawn': 'What does the Ether Overload status do, how long does it last, and what does the count increasing by 1 lead to?',
    'Download': '"Normal attacks" -- normal-TYPE moves, or any ordinary attack?',
}

# Best-guess effects for the abilities whose open question blocks part of them.
EFFECTS.update({
    'Peace Aura': [eff('roll', when={'type': 'start_of_turn'}, target='enemies', radiusFt=30, save={'ability': 'WIS', 'dc': None},
                       roll='disadvantage', on='attack_rolls', ends=UNTIL_ITS_NEXT_TURN_STARTS,
                       note='Until the start of THEIR next turn. DC not given -- see review.')],
    'Frigid Aura': [
        eff('stat', when={'type': 'creature_start_of_turn_within'}, target='enemies', radiusFt=10, stat='speed', amount=-10,
            ends=UNTIL_ITS_NEXT_TURN_ENDS),
        eff('condition', when={'type': 'hit_by', 'melee': True}, target='attacker', save={'ability': 'CON', 'dc': None},
            apply='slowed', ends=UNTIL_ITS_NEXT_TURN_ENDS, note='DC not given -- see review.'),
    ],
    'Balance Keeper': [
        eff('clear_stat_changes', when={'type': 'end_of_turn'}),
        eff('heal', when={'type': 'end_of_turn'}, amount={'dice': '2d10', 'perClearedStatChange': True}, pool='HP_or_VP',
            note='2d10 HP or VP for every stat change it reverted.'),
    ],
    'Noble Presence': [eff('roll', when={'type': 'start_of_turn'}, target='chosen_ally', radiusFt=60, roll='advantage', on='one_roll')],
    'Molten Armor': [eff('damage_mod', when={'type': 'hit_by', 'moveTypes': ['Fire']}, extraDice='1d6', flatBonus='proficiency',
                         damageType='Fire', filter={'melee': True}, scaling={'note': '+1d6 at every odd level above 10'},
                         ends=[{'type': 'rounds', 'n': 1}], note='Read as its own melee attacks -- see review. Also lava.')],
    'Reality Ripper': [
        eff('ignore_resistance', filter={'slashing': True}),
        eff('ignore_immunity', filter={'slashing': True}),
        eff('manual', note='Can hit creatures in the Ethereal Plane.'),
    ],
    'Royal Decree': [eff('condition', when=activated('1 action'), target='all', radiusFt=30, save={'ability': 'WIS', 'dc': None},
                         apply='commanded', limit={'uses': 1, 'per': 'long_rest'})],
    'Vector': [eff('condition', when={'type': 'hits'}, target='target', save={'ability': 'CON', 'dc': None},
                   options=['poisoned', 'paralyzed', 'slowed'], ends=[{'type': 'long_rest'}],
                   note='Failing by 5 or more bypasses defences like Safeguard. Slowed here = half movement.')],
    'Void Manifest': [
        eff('roll', when=activated('free'), choice={'kind': 'chosen', 'option': 'Void Form'}, roll='disadvantage', on='attacks_against'),
        eff('roll', when=activated('free'), choice={'kind': 'chosen', 'option': 'Void Form'}, roll='advantage', on='saving_throws',
            vsAreaMoves=True),
        eff('manual', note="Void Form: 30 ft supernatural darkness that moves with it; untargetable unless lit by ether light. "
                           "Watcher's Guise isn't described."),
    ],
    'Imperial Authority': [
        eff('condition', when=activated('1 action'), target='enemies', targetFilter={'canSee': True}, apply='frightened',
            ends=[{'type': 'rounds', 'dice': '1d4'}]),
        eff('suppress_ability', when=activated('1 bonus action'), target='chosen', limit={'uses': 3, 'per': 'long_rest'}),
    ],
    'Ether Dawn': [
        eff('damage_mod', rerollKeep='higher', filter={'damaging': True}),
        eff('manual', when={'type': 'move_used'},
            note='Roll a d20: on a 1 it gets Ether Overload, otherwise the overload count goes up by 1. '
                 'When the overload passes it loses 1d4 levels; below level 1 it dies.'),
    ],
    'Download': [eff('move_type_override', to='chosen', filter={'moveTypes': ['Normal']}, optional=True,
                     limit={'uses': 1, 'per': 'short_rest'}, ends=NEXT_ATTACK)],
})


def write_checklist(by_name):
    lines = ['# Abilities to check with Benjakronk', '',
             'Generated by `migrate_abilities_v3.py` from each ability\'s `review` field. '
             'The current effects are a best guess until these are answered.', '']
    for name in sorted(REVIEW):
        lines += [f'## {name}', '', f'> {by_name[name]["description"]}', '', f'**Question:** {REVIEW[name]}', '']
    CHECKLIST.write_text('\n'.join(lines), encoding='utf-8')


def main(apply):
    data = json.loads(FILE.read_text(encoding='utf-8'))
    by_name = {a['name']: a for a in data['abilities']}
    missing = [n for n in list(EFFECTS) + list(REVIEW) if n not in by_name]
    if missing:
        sys.exit(f'Not in the ability list: {missing}')
    clash = [n for n in EFFECTS if 'unknown' in by_name[n].get('categories', [])]
    if clash:
        sys.exit(f'Already tagged unknown: {clash}')
    for n, effects in EFFECTS.items():
        by_name[n]['effects'] = effects
    for n, question in REVIEW.items():
        by_name[n]['review'] = {'with': 'Benjakronk', 'question': question}

    left = [a['name'] for a in data['abilities'] if 'effects' not in a]
    print(f'tagged: {len(EFFECTS)}  review: {len(REVIEW)}  backlog: {len(left)} {left}')
    if apply:
        FILE.write_text(json.dumps(data, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')
        write_checklist(by_name)
        print('written')


if __name__ == '__main__':
    main('--apply' in sys.argv)
