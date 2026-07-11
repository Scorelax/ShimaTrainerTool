"""route=pokemon — port of handlePokemonRoute and its sheet helpers."""
import json

from . import db, pokedex, upstream
from .calculations import (
    apply_feat_changes, calculate_hp_vp, calculate_modifiers,
    proficiency_for_level, stab_for_level,
)
from .jsutil import js_parse_int, js_parse_int_or, js_truthy, floor_div2, intify

P = db.POKEMON_COLUMNS

# Field order of getPokemonInfo's response object (subset of the row)
_INFO_FIELDS = [
    ('trainerName', 0), ('image', 1), ('name', 2), ('dexEntry', 3), ('level', 4),
    ('primaryType', 5), ('secondaryType', 6), ('ability', 7), ('ac', 8),
    ('hitDice', 9), ('hp', 10), ('vitalityDice', 11), ('vp', 12), ('speed', 13),
    ('totalStats', 14), ('strength', 15), ('dexterity', 16), ('constitution', 17),
    ('intelligence', 18), ('wisdom', 19), ('charisma', 20), ('savingThrows', 21),
    ('skills', 22), ('startingMoves', 23), ('level2Moves', 24), ('level6Moves', 25),
    ('level10Moves', 26), ('level14Moves', 27), ('level18Moves', 28),
    ('evolutionRequirement', 29), ('initiative', 30), ('proficiencyBonus', 31),
    ('nature', 32), ('loyalty', 33), ('stab', 34), ('heldItem', 35), ('nickname', 36),
    ('customMoves', 37), ('inActiveParty', 38), ('strmodifier', 39), ('dexmodifier', 40),
    ('conmodifier', 41), ('intmodifier', 42), ('wismodifier', 43), ('chamodifier', 44),
]


def handle(conn, action, params):
    if action == 'list':
        return {'status': 'success', 'data': pokedex.get_complete_pokemon_data(conn)}

    if action == 'registered-list':
        return {'status': 'success', 'data': pokedex.get_registered_pokemon_list(conn)['data']}

    if action == 'get':
        if not params.get('trainer') or not params.get('name'):
            raise ValueError('Missing trainer or pokemon name')
        return {'status': 'success', 'data': get_pokemon_info(conn, params['trainer'], params['name'])}

    if action == 'register':
        if not params.get('trainer') or not params.get('data'):
            raise ValueError('Missing trainer or pokemon data')
        return register_pokemon_for_trainer(conn, params['trainer'], json.loads(params['data']))

    if action == 'update':
        if not params.get('data'):
            raise ValueError('Missing pokemon data')
        return update_pokemon_data(conn, json.loads(params['data']))

    if action == 'recalculate-stats':
        if not params.get('data'):
            raise ValueError('Missing pokemon data')
        recalc_data = json.loads(params['data'])
        old_feats = params.get('oldFeats', '')
        new_feats = recalc_data[50] or ''
        result = apply_feat_changes(recalc_data, old_feats, new_feats)
        return result

    if action == 'evolution-options':
        dex_entry = js_parse_int(params.get('dexEntry'))
        limit = js_parse_int(params.get('limit', 20)) or 20
        return pokedex.get_evolution_options(conn, dex_entry, limit)

    if action == 'party-status':
        return update_active_party_status(
            conn, params.get('trainer'), params.get('pokemon'),
            js_parse_int(params.get('pokeslots')), params.get('operation'))

    if action == 'utility-slot':
        return update_utility_slot_status(
            conn, params.get('trainer'), params.get('pokemon'), params.get('operation'))

    if action == 'live-stats':
        return write_pokemon_live_stats(
            conn, params.get('trainer'), params.get('pokemon'),
            params.get('stat'), params.get('value'))

    if action == 'abilities':
        if not params.get('name'):
            raise ValueError('Missing pokemon name')
        return pokedex.get_pokemon_abilities(conn, params['name'])

    if action == 'evolve':
        if not params.get('currentName') or not params.get('trainer') or not params.get('data'):
            raise ValueError('Missing evolution parameters')
        evolve_data = json.loads(params['data'])
        calculated = calculate_modifiers(evolve_data, 'None', 'None')
        if calculated['status'] == 'success':
            resolved = upstream.get_image_url(conn, calculated['newPokemonData'][2], evolve_data[3])
            if resolved:
                calculated['newPokemonData'][1] = resolved
            replaced = replace_pokemon(conn, params['currentName'], params['trainer'],
                                       calculated['newPokemonData'])
            if replaced['status'] == 'success':
                return {'status': 'success', 'message': replaced.get('message'),
                        'newPokemonData': calculated['newPokemonData']}
            return replaced
        return calculated

    raise ValueError('Unknown pokemon action: ' + str(action))


def get_pokemon_info(conn, trainer_name, pokemon_name):
    for _, row in db.fetch_rows(conn, 'pokemon', P):
        if (str(row[0]).lower() == trainer_name.lower()
                and str(row[2]).lower() == pokemon_name.lower()):
            return {field: row[idx] for field, idx in _INFO_FIELDS}
    return None


def register_pokemon_for_trainer(conn, trainer_name, new_pokemon_data):
    level = js_parse_int(new_pokemon_data[4])
    hd = js_parse_int(new_pokemon_data[9])
    vd = js_parse_int(new_pokemon_data[11])
    str_ = js_parse_int(new_pokemon_data[15])
    dex = js_parse_int(new_pokemon_data[16])
    con = js_parse_int(new_pokemon_data[17])
    int_ = js_parse_int(new_pokemon_data[18])
    wis = js_parse_int(new_pokemon_data[19])
    cha = js_parse_int(new_pokemon_data[20])
    loyalty = js_parse_int_or(new_pokemon_data[33], 0)

    # Nature stat adjustments
    nature_name = new_pokemon_data[32] or ''
    if nature_name:
        stat_map = {'strength': 'str', 'dexterity': 'dex', 'constitution': 'con',
                    'intelligence': 'int', 'wisdom': 'wis', 'charisma': 'cha'}
        stats = {'str': str_, 'dex': dex, 'con': con, 'int': int_, 'wis': wis, 'cha': cha}
        nature = next((n for n in get_nature_data(conn)
                       if str(n['name']).lower() == str(nature_name).lower()), None)
        if nature:
            boost_key = stat_map.get(str(nature['boostStat']).lower())
            nerf_key = stat_map.get(str(nature['nerfStat']).lower())
            if boost_key:
                stats[boost_key] += js_parse_int(nature['boostAmount'])
            if nerf_key:
                stats[nerf_key] -= js_parse_int(nature['nerfAmount'])
        str_, dex, con, int_, wis, cha = (stats['str'], stats['dex'], stats['con'],
                                          stats['int'], stats['wis'], stats['cha'])

    new_pokemon_data[15] = str_
    new_pokemon_data[16] = dex
    new_pokemon_data[17] = con
    new_pokemon_data[18] = int_
    new_pokemon_data[19] = wis
    new_pokemon_data[20] = cha

    hp, vp = calculate_hp_vp(str_, dex, con, int_, wis, cha, level, hd, vd, loyalty)

    new_pokemon_data[10] = hp
    new_pokemon_data[12] = vp
    new_pokemon_data[30] = floor_div2(dex)               # initiative
    new_pokemon_data[31] = proficiency_for_level(level)
    new_pokemon_data[34] = stab_for_level(level)
    new_pokemon_data[39] = floor_div2(str_)
    new_pokemon_data[40] = floor_div2(dex)
    new_pokemon_data[41] = floor_div2(con)
    new_pokemon_data[42] = floor_div2(int_)
    new_pokemon_data[43] = floor_div2(wis)
    new_pokemon_data[44] = floor_div2(cha)
    new_pokemon_data[45] = hp                            # currentHP
    new_pokemon_data[46] = vp                            # currentVP

    db.insert_row(conn, 'pokemon', P, new_pokemon_data)

    return {'status': 'success',
            'message': f'{trainer_name} caught a {new_pokemon_data[2]}!',
            'newPokemonData': new_pokemon_data}


def update_pokemon_data(conn, new_pokemon_data):
    trainer_name = str(new_pokemon_data[0]).lower()
    pokemon_name = str(new_pokemon_data[2]).lower()
    for rowid, row in db.fetch_rows(conn, 'pokemon', P):
        if str(row[0]).lower() == trainer_name and str(row[2]).lower() == pokemon_name:
            db.update_row(conn, 'pokemon', rowid, P, new_pokemon_data)
            return {'status': 'success'}
    return {'status': 'error', 'message': 'Pokémon not found.'}


def replace_pokemon(conn, pre_evolved_name, trainer_name, new_pokemon_data):
    for rowid, row in db.fetch_rows(conn, 'pokemon', P):
        if (str(row[0]).lower() == trainer_name.lower()
                and str(row[2]).lower() == pre_evolved_name.lower()):
            db.update_row(conn, 'pokemon', rowid, P, new_pokemon_data)
            return {'status': 'success', 'message': 'Pokémon replaced successfully.'}
    return {'status': 'error', 'message': 'Pre-evolved Pokémon not found.'}


def update_active_party_status(conn, trainer_name, pokemon_name, pokeslots, operation):
    rows = db.fetch_rows(conn, 'pokemon', P)

    active_party = sorted(
        js_parse_int(row[38]) for _, row in rows
        if row[0] == trainer_name and js_truthy(row[38])
    )

    if operation == 'add':
        if len(active_party) >= pokeslots:
            return {'status': 'error', 'message': 'Party is full'}
        next_slot = 1
        for i in range(1, pokeslots + 1):
            if i not in active_party:
                next_slot = i
                break
        for rowid, row in rows:
            if row[0] == trainer_name and row[2] == pokemon_name:
                db.set_cell(conn, 'pokemon', rowid, 'inactiveparty', next_slot)
                break
        return {'status': 'success', 'slot': next_slot}

    if operation == 'remove':
        for rowid, row in rows:
            if row[0] == trainer_name and row[2] == pokemon_name:
                db.set_cell(conn, 'pokemon', rowid, 'inactiveparty', '')
                break
        return {'status': 'success', 'message': 'Removed from party'}
    return None


def update_utility_slot_status(conn, trainer_name, pokemon_name, operation):
    rows = db.fetch_rows(conn, 'pokemon', P)
    try:
        if operation == 'add':
            for rowid, row in rows:
                if row[0] == trainer_name and row[56] == 1 and row[2] != pokemon_name:
                    db.set_cell(conn, 'pokemon', rowid, 'utilityslot', '')
            for rowid, row in rows:
                if row[0] == trainer_name and row[2] == pokemon_name:
                    if js_truthy(row[38]):
                        return {'status': 'error',
                                'message': 'A Pokémon cannot be in the active party and the utility slot at the same time'}
                    db.set_cell(conn, 'pokemon', rowid, 'utilityslot', 1)
                    return {'status': 'success'}
        elif operation == 'remove':
            for rowid, row in rows:
                if row[0] == trainer_name and row[2] == pokemon_name:
                    db.set_cell(conn, 'pokemon', rowid, 'utilityslot', '')
                    return {'status': 'success'}
        return {'status': 'error', 'message': 'Pokemon not found'}
    except Exception:
        return {'status': 'error', 'message': 'Failed to update utility slot status'}


def write_pokemon_live_stats(conn, trainer_name, pokemon_name, stat, new_value):
    try:
        for rowid, row in db.fetch_rows(conn, 'pokemon', P):
            if row[0] == trainer_name and row[2] == pokemon_name:
                if stat == 'HP':
                    db.set_cell(conn, 'pokemon', rowid, 'currentHP', js_parse_int(new_value))
                elif stat == 'VP':
                    db.set_cell(conn, 'pokemon', rowid, 'currentVP', js_parse_int(new_value))
                elif stat == 'KnownMoves':
                    db.set_cell(conn, 'pokemon', rowid, 'knownmoves', new_value)
                elif stat == 'StatusCondition':
                    db.set_cell(conn, 'pokemon', rowid, 'statuscondition',
                                '' if new_value in (None, '') else new_value)
                else:  # AC
                    db.set_cell(conn, 'pokemon', rowid, 'currentAC', js_parse_int(new_value))
                return {'status': 'success'}
        return {'status': 'error', 'message': 'Trainer not found'}
    except Exception:
        return {'status': 'error', 'message': 'Failed to write Pokemon Live Stats'}


def get_nature_data(conn):
    return [{
        'name': r[0], 'boostStat': r[1], 'boostAmount': r[2],
        'nerfStat': r[3], 'nerfAmount': r[4],
    } for r in conn.execute(
        'SELECT name, boostStat, boostAmount, nerfStat, nerfAmount FROM natures ORDER BY ord')]
