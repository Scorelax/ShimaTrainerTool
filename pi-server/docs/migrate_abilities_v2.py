#!/usr/bin/env python3
"""Abilities batch B: damage-reducing reactions, hit-triggered boosts, redirection,
auras, KO/faint triggers, type changes. Schema: ability-effects-schema.md.

    python migrate_abilities_v2.py            # dry run: report only
    python migrate_abilities_v2.py --apply    # rewrites DnD_abilities.json

Re-running overwrites only the abilities listed here.
"""
import json
import sys

from migrate_abilities_v1 import FILE, NEXT_ATTACK, PROF, eff, env, any_of, weather

UNTIL_ITS_NEXT_TURN_STARTS = [{'type': 'until_turn', 'whose': 'holder', 'point': 'start', 'count': 1}]
UNTIL_ITS_NEXT_TURN_ENDS = [{'type': 'until_turn', 'whose': 'holder', 'point': 'end', 'count': 1}]
ENCOUNTER = [{'type': 'encounter'}]
INSTANT = [{'type': 'instant'}]


def next_attack_advantage(when):
    return [eff('roll', when=when, roll='advantage', on='attack_rolls', ends=NEXT_ATTACK)]


def save_stat_boost(when):
    return [eff('stat', when=when, stat='saving_throw_abilities', amount=2, stacks={'max': 5}, ends=ENCOUNTER,
                note='The ability scores of its saving-throw proficiencies; max +10 to any one score.')]


EFFECTS = {
    # --- damage-reducing reactions ---------------------------------------------------
    'Sturdy': [eff('damage_taken_mod', when={'type': 'damaged', 'minFractionOfCurrentHP': 0.5},
                   chance={'die': 'd4', 'min': 3}, multiplier=0.5, ends=INSTANT)],
    'Fur Coat': [eff('damage_taken_mod', when={'type': 'hit_by'}, optional=True, limit={'uses': 1, 'per': 'long_rest'},
                     multiplier=0.5, ends=INSTANT)],
    'Friend Guard': [eff('damage_taken_mod', when={'type': 'ally_hit'}, radiusFt=15, target='ally', optional=True,
                         limit={'uses': 1, 'per': 'long_rest'}, multiplier=0.5, ends=INSTANT)],
    'Void Shift': [eff('damage_taken_mod', when={'type': 'damaged'}, reaction=True, optional=True,
                       limit={'uses': 1, 'per': 'short_rest'}, multiplier=0.5, ends=INSTANT)],
    'Chronoshift': [eff('damage_taken_mod', when={'type': 'damaged'}, chance={'die': 'd20', 'min': 18}, multiplier=0,
                        ends=INSTANT, note='Glimpses another timeline and avoids the attack.')],
    'Heavy Metal': [eff('stat', when={'type': 'attack_roll_against'}, optional=True, limit={'uses': 1, 'per': 'long_rest'},
                        stat='ac', amount=2, ends=INSTANT, note='Only worth using when +2 AC turns the hit into a miss.')],
    'Proper Form': [eff('roll', when={'type': 'attack_roll_against'}, target='attacker', reaction=True, optional=True,
                        roll='disadvantage', on='attack_rolls', ends=INSTANT,
                        note='No use limit in the text -- read as costing its reaction.')],
    'Water Compaction': [eff('damage_taken_mod', when={'type': 'damaged', 'moveTypes': ['Water']}, multiplier=0.5,
                             ends=UNTIL_ITS_NEXT_TURN_STARTS, note='Any OTHER damage after the water hit.')],
    'Stamina': [eff('stat', when={'type': 'damaged'}, stat='ac', amount=2, ends=UNTIL_ITS_NEXT_TURN_STARTS,
                    note="Doesn't stack -- a new hit just refreshes it.")],
    'Prism Armor': [eff('damage_taken_mod', filter={'vulnerable': True}, rerollKeep='lower')],
    'Filter': [eff('immunity', when={'type': 'hit_by', 'vulnerable': True}, chance={'die': 'd4', 'min': 4},
                   optional=True, vulnerabilityExtra=True, ends=INSTANT)],
    'Disguise': [eff('temp_hp', when={'type': 'enter_battle'}, amount={'levelMultiple': 2}, limit={'uses': 1, 'per': 'short_rest'},
                     note='The disguise breaks when these temporary HP reach 0; a short rest repairs it.')],
    'Aqua Camoflauge': [eff('temp_hp', when={'type': 'enter_battle'}, while_=[any_of(weather('rain'), env('coastal', 'swamp'))],
                            amount={'levelMultiple': 1}, limit={'uses': 1, 'per': 'short_rest'})],
    'Water Weight': [eff('temp_hp', when={'type': 'enter_battle'}, while_=[any_of(weather('rain'), env('coastal', 'swamp'))],
                         amount={'levelMultiple': 1}, limit={'uses': 1, 'per': 'short_rest'})],
    'Psychic Barrier': [eff('temp_hp', when={'type': 'start_of_turn'}, amount={'abilityMod': 'INT', 'plusProficiency': True},
                            stacks={'capLevelMultiple': 2})],

    # --- hit / miss triggered boosts ---------------------------------------------------
    'Justified': next_attack_advantage({'type': 'hit_by', 'moveTypes': ['Dark']}),
    'Rattled': next_attack_advantage({'type': 'hit_by', 'moveTypes': ['Dark', 'Bug', 'Ghost'], 'damaging': True}),
    'Toxic Boost': next_attack_advantage({'type': 'hit_by', 'moveTypes': ['Poison']}),
    'Defiant': next_attack_advantage({'type': 'condition_gained', 'fromMove': True}),
    'Analytic': next_attack_advantage({'type': 'attack_missed'}),
    'Motor Drive': [eff('stat', when={'type': 'hit_by', 'moveTypes': ['Electric']}, stat='speed', amount=10,
                        stacks={'max': 5}, ends=ENCOUNTER, note='Only if not immune to the hit.')],
    'Weak Armor': [
        eff('stat', when={'type': 'hit_by'}, stat='speed', amount=5, stacks={'max': 5}, ends=ENCOUNTER),
        eff('stat', when={'type': 'hit_by'}, stat='ac', amount=-1, stacks={'max': 5}, ends=ENCOUNTER),
    ],

    # --- redirection -----------------------------------------------------------------
    'Lightning Rod': [eff('redirect', when={'type': 'ally_targeted', 'includeSelf': True, 'direct': True, 'damaging': True,
                                            'moveTypes': ['Electric']}, radiusFt=30, reaction=True, optional=True,
                          damageMultiplier=0.5)],
    'Storm Drain': [eff('redirect', when={'type': 'ally_targeted', 'includeSelf': True, 'direct': True, 'damaging': True,
                                          'moveTypes': ['Water']}, radiusFt=30, reaction=True, optional=True,
                        damageMultiplier=0.5)],
    'Praetorian Guard': [eff('redirect', when={'type': 'ally_targeted'}, optional=True, moveAdjacent=True, useOwnAC=True,
                             note='Ally within its unspent movement; it moves next to the ally out of turn without '
                                  'provoking, and the attack is rolled against ITS AC.')],

    # --- auras ---------------------------------------------------------------------
    'Dark Aura': [eff('damage_mod', target='all', radiusFt=100, totalMultiplier=2, filter={'moveTypes': ['Dark'], 'damaging': True})],
    'Fairy Aura': [eff('damage_mod', target='others', radiusFt=100, totalMultiplier=2, filter={'moveTypes': ['Fairy'], 'damaging': True},
                       note='"By other creatures" -- its own fairy moves are not doubled.')],
    'Aura Break': [eff('aura_break', radiusFt=100, note='Dark Aura and Fairy Aura halve their moves instead of doubling them.')],
    'Battery': [eff('damage_mod', target='allies', radiusFt=20, diceMultiplier=2, filter={'moveTypes': ['Electric'], 'damaging': True})],
    'Flower Gift': [eff('damage_mod', while_=[weather('sun')], target='allies', radiusFt=30, flatBonus='proficiency',
                        filter={'damaging': True}, note="Each ally adds its OWN proficiency bonus.")],
    'Comforting Presence': [eff('roll', target='all', radiusFt=10, roll='advantage', on='saving_throws', vsConditions=['frightened'])],
    'Aroma Veil': [eff('auto_save', target='allies', radiusFt=15, ability='WIS')],
    'Sweet Veil': [eff('immunity', target='allies', radiusFt=15, conditions=['asleep'])],
    'Flower Veil': [
        eff('immunity', target='allies', radiusFt=15, targetFilter={'types': ['Grass']}, negativeConditions=True,
            note='Only NEW conditions -- ones already on the ally stay.'),
        eff('roll', target='allies', radiusFt=15, targetFilter={'types': ['Grass']}, roll='advantage', on='saving_throws'),
    ],
    'Air Lock': [eff('suppress_weather_abilities', target='all')],
    'Cloud Nine': [eff('suppress_weather_abilities', target='all')],
    'Arena Trap': [eff('condition', target='all', radiusFt=50, targetFilter={'grounded': True}, apply='switch_locked',
                       note='Can still leave by item, move or ability.')],
    'Shadow Tag': [eff('condition', target='all', radiusFt=50, apply='switch_locked', note='Can still leave by item, move or ability.')],
    'Magnet Pull': [
        eff('condition', target='enemies', targetFilter={'types': ['Steel']}, apply='switch_locked', note='All steel opponents in battle.'),
        eff('damage_mod', while_=[{'type': 'target_types', 'any': ['Steel']}], flatBonus='proficiency',
            filter={'moveTypes': ['Electric'], 'damaging': True}),
    ],
    'Dazzling': [eff('action_cost_override', target='all', from_='1 bonus action', to='1 action', note='Any creature it can see.')],
    'Queen Majesty': [eff('action_cost_override', target='all', from_='1 bonus action', to='1 action', note='Any creature it can see.')],
    'Pure Waters': [
        eff('damage_mod', target='others', radiusFt=50, totalMultiplier=1.2, filter={'moveTypes': ['Water'], 'damaging': True}, note='Rounded down.'),
        eff('suppress_secondary_effects', target='others', radiusFt=50, filter={'moveTypes': ['Water'], 'damaging': True}),
    ],
    'Gravity Well': [
        eff('damage_mod', target='all', radiusFt=100, totalMultiplier=1.5, filter={'moveTypes': ['Rock'], 'damaging': True}, note='Rounded down.'),
        eff('stat', target='all', radiusFt=100, stat='flying_speed', amount={'multiplier': 0.5}),
        eff('manual', note='Staying airborne in the area costs 20 VP per turn.'),
    ],
    'Wreath of Ash': [eff('deal_damage', when={'type': 'start_of_turn'}, target='all', radiusFt=5,
                          amount={'dice': '1d10', 'plus': 'proficiency'}, damageType='Fire', ignoreResistance=True)],
    'Freezing Aura': [eff('condition', when={'type': 'creature_end_of_turn_within'}, target='all', radiusFt=30,
                          save={'ability': 'CON', 'dc': 12}, apply='frozen', note='Creatures immune to frozen are skipped.')],
    'Time Warp': [
        eff('deal_damage', when={'type': 'creature_start_of_turn_within'}, target='all', radiusFt=50,
            save={'ability': 'WIS', 'dc': 21}, halfOnSave=True, amount={'dice': '4d10'}, damageType='Psychic'),
        eff('stat', when={'type': 'creature_start_of_turn_within'}, target='all', radiusFt=50,
            save={'ability': 'WIS', 'dc': 21}, stat='speed', amount={'multiplier': 0.5}, ends=UNTIL_ITS_NEXT_TURN_STARTS),
    ],

    # --- KO / faint ----------------------------------------------------------------
    'Moxie': [eff('extra_action', when={'type': 'ko_dealt'}, optional=True)],
    'Beast Boost': save_stat_boost({'type': 'ko_dealt'}),
    'Soul-Heart': save_stat_boost({'type': 'ally_fainted'}),
    'Self-Destructor': [eff('use_move', when={'type': 'knocked_out'}, move='Self-Destruct', free=True,
                            note='Used as if it had full HP, at no cost.')],
    'Phantom Body': [
        eff('prevent_faint', when={'type': 'would_faint'}, limit={'uses': 1, 'per': 'short_rest'}),
        eff('condition', when={'type': 'would_faint'}, limit={'uses': 1, 'per': 'short_rest'}, apply='incorporeal',
            ends=UNTIL_ITS_NEXT_TURN_STARTS, note="Can't attack; immune to physical damage."),
        eff('heal', when={'type': 'would_faint'}, limit={'uses': 1, 'per': 'short_rest'}, amount={'level': 1}, setTo=True,
            note="Reappears with HP equal to its level; can't be safely held in a Poke Ball until a long rest."),
    ],
    'Temporal Collapse': [
        eff('deal_damage', when={'type': 'knocked_out'}, target='all', radiusFt=100, save={'ability': 'CON', 'dc': 18},
            halfOnSave=True, amount={'dice': '10d10'}, damageType='Psychic'),
        eff('manual', when={'type': 'knocked_out'},
            note='Failed save: moved 1d4 x 10 ft in a random direction. The 1000 ft area becomes a temporal anomaly zone for 24 hours.'),
    ],
    'Emergency Exit': [eff('retreat', when={'type': 'damaged'}, while_=[{'type': 'self_hp_at_or_below', 'fraction': 0.5}],
                           optional=True, mandatory=False, allowSwitch=True,
                           note='Disengage + move up to its speed as a free action; its trainer may switch it out as a free action.')],
    'Wimp Out': [eff('retreat', when={'type': 'damaged', 'damaging': True, 'crossesBelowFraction': 0.5}, mandatory=True, allowSwitch=True,
                     note='MUST disengage and move its speed straight toward its trainer; if that puts it in switching range '
                          'and another Pokemon is available, it must be switched out.')],

    # --- type changes ----------------------------------------------------------------
    'Color Change': [eff('condition', when={'type': 'hit_by', 'damaging': True}, apply='type_changed', valueFrom='hit_move_type',
                         note="Takes on the new type's resistances, vulnerabilities and immunities.")],
    'Protean': [eff('condition', when={'type': 'move_used'}, apply='type_changed', valueFrom='used_move_type', slot='primary',
                    note='Changes just BEFORE the move is used (so it gets STAB).')],
    'Forecast': [eff('type_by_weather', map={'rain': 'Water', 'sun': 'Fire', 'hail': 'Ice', 'snow': 'Ice'}, default='Normal',
                     note='Cold and snowy conditions also make it Ice.')],
    'Primordial Shift': [eff('condition', when={'type': 'start_of_round'}, optional=True, apply='type_changed',
                             options=['Psychic', 'Dark', 'Water', 'Ground', 'Dragon'])],
}


def main(apply):
    data = json.loads(FILE.read_text(encoding='utf-8'))
    by_name = {a['name']: a for a in data['abilities']}
    missing = [n for n in EFFECTS if n not in by_name]
    if missing:
        sys.exit(f'Not in the ability list: {missing}')
    clash = [n for n in EFFECTS if 'unknown' in by_name[n].get('categories', [])]
    if clash:
        sys.exit(f'Already tagged unknown: {clash}')
    for n, effects in EFFECTS.items():
        for e in effects:  # `from` is a Python keyword
            if 'from_' in e:
                e['from'] = e.pop('from_')
        by_name[n]['effects'] = effects

    done = sum(1 for a in data['abilities'] if 'effects' in a)
    print(f'tagged: {len(EFFECTS)}  backlog: {len(data["abilities"]) - done} of {len(data["abilities"])}')
    if apply:
        FILE.write_text(json.dumps(data, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')
        print('written')


if __name__ == '__main__':
    main('--apply' in sys.argv)
