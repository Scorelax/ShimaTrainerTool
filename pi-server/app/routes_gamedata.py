"""route=game-data — port of handleGameDataRoute and the static-data loaders."""
from . import db, upstream
from .jsutil import js_number
from .routes_pokemon import get_nature_data


def handle(conn, action, params):
    if action == 'all':
        return {'status': 'success', 'data': load_all_game_data(conn)}

    if action == 'conduit':
        return {'status': 'success', 'data': load_all_conduit_game_data(conn)}

    if action == 'moves':
        return {'status': 'success', 'data': upstream.fetch_moves(conn)}

    if action == 'natures':
        return {'status': 'success', 'data': get_nature_data(conn)}

    if action == 'type-effectiveness':
        return {'status': 'success',
                'data': calculate_type_effectiveness(conn, params.get('type1'), params.get('type2'))}

    if action == 'pokedex-config':
        return {'status': 'success', 'data': upstream.fetch_pokedex_config(conn)}

    if action == 'clear-cache':
        upstream.warm_upstream(conn)
        return {'status': 'success', 'message': 'Server cache refreshed'}

    raise ValueError('Unknown game-data action: ' + str(action))


def load_all_game_data(conn):
    try:
        return {
            'specializations': load_specializations(conn),
            'trainerPaths': load_trainer_paths(conn),
            'affinities': load_affinities(conn),
            'itemsData': upstream.fetch_items(conn),
            'moves': upstream.fetch_moves(conn),
            'natures': get_nature_data(conn),
            'trainerFeatsData': load_trainer_feats(conn),
            'skillsData': load_trainer_skills(conn),
            'pokemonFeatsData': load_pokemon_feats(conn),
            'nationalitiesData': load_nationalities(conn),
        }
    except Exception:
        return None


def load_all_conduit_game_data(conn):
    try:
        return {
            'conduitFeatures': load_conduit_features(conn),
            'battleStyles': load_conduit_battle_styles(conn),
            'typeAwakening': load_conduit_type_awakenings(conn),
            'itemsData': upstream.fetch_items(conn),
            'moves': upstream.fetch_moves(conn),
            'natures': get_nature_data(conn),
            'trainerFeatsData': load_trainer_feats(conn),
            'pokemonFeatsData': load_pokemon_feats(conn),
            'nationalitiesData': load_nationalities(conn),
        }
    except Exception:
        return None


def load_trainer_paths(conn):
    return [{
        'name': r[0],
        'level3': {'name': r[1], 'shortEffect': r[2], 'effect': r[3]},
        'level5': {'name': r[4], 'shortEffect': r[5], 'effect': r[6]},
        'level9': {'name': r[7], 'shortEffect': r[8], 'effect': r[9]},
        'level15': {'name': r[10], 'shortEffect': r[11], 'effect': r[12]},
    } for r in conn.execute(
        'SELECT name, l3name, l3short, l3effect, l5name, l5short, l5effect, '
        'l9name, l9short, l9effect, l15name, l15short, l15effect '
        'FROM trainer_paths ORDER BY ord')]


def load_specializations(conn):
    return [{'name': r[0], 'shortEffect': r[1], 'effect': r[2]}
            for r in conn.execute('SELECT name, shortEffect, effect FROM specializations ORDER BY ord')]


def load_affinities(conn):
    return [{'name': r[0], 'shortEffect': r[1], 'effect': r[2],
             'improvedShortEffect': r[3], 'improvedEffect': r[4]}
            for r in conn.execute(
                'SELECT name, shortEffect, effect, improvedShortEffect, improvedEffect '
                'FROM affinities ORDER BY ord')]


def load_trainer_skills(conn):
    skills = [{'level': r[0], 'name': r[1], 'shortEffect': r[2], 'fullEffect': r[3]}
              for r in conn.execute(
                  'SELECT level, name, shortEffect, fullEffect FROM trainer_skills ORDER BY ord')]
    return {'status': 'success', 'skills': skills}


def load_nationalities(conn):
    nationalities = [{'nationality': r[0], 'regionBuff': r[1], 'effect': r[2]}
                     for r in conn.execute(
                         'SELECT nationality, regionBuff, effect FROM nationalities ORDER BY ord')]
    return {'status': 'success', 'nationalities': nationalities}


def load_trainer_feats(conn):
    feats = [{'name': r[0], 'effect': r[1]}
             for r in conn.execute('SELECT name, effect FROM trainer_feats ORDER BY ord')]
    return {'status': 'success', 'trainerFeats': feats}


def load_pokemon_feats(conn):
    feats = [{'name': r[0], 'effect': r[1]}
             for r in conn.execute('SELECT name, effect FROM pokemon_feats ORDER BY ord')]
    return {'status': 'success', 'pokemonFeats': feats}


def load_conduit_features(conn):
    return [{'name': r[0], 'stage1Effect': r[1] or '', 'stage2Effect': r[2] or '',
             'stage3Effect': r[3] or ''}
            for r in conn.execute(
                'SELECT name, stage1Effect, stage2Effect, stage3Effect FROM conduit_features ORDER BY ord')]


def load_conduit_battle_styles(conn):
    return [{'name': r[0], 'effect': r[1]}
            for r in conn.execute('SELECT name, effect FROM conduit_battle_styles ORDER BY ord')]


def load_conduit_type_awakenings(conn):
    """Rebuilds the nested structure from the raw 4-column rows, mirroring the
    every-4th-row grouping in loadConduitTypeAwakenings."""
    rows = list(conn.execute('SELECT c1, c2, c3, c4 FROM conduit_awakening_rows ORDER BY ord'))
    awakenings = {}
    current_type = None
    for i, (c1, c2, c3, c4) in enumerate(rows):
        if i % 4 == 0:
            current_type = c1
            awakenings[current_type] = {'effect': c2, 'awakenings': []}
        elif current_type is not None:
            awakenings[current_type]['awakenings'].append({
                'name': c1,
                'levels': [c2 or '', c3 or '', c4 or ''],
            })
    return awakenings


def calculate_type_effectiveness(conn, type1, type2=None):
    try:
        attack_types = [r[0] for r in conn.execute('SELECT type FROM type_chart_attack ORDER BY ord')]
        defend_types = [r[0] for r in conn.execute('SELECT type FROM type_chart_defend ORDER BY ord')]
        matrix = {}
        for a_ord, d_ord, value in conn.execute(
                'SELECT attack_ord, defend_ord, value FROM type_chart_matrix'):
            matrix[(a_ord, d_ord)] = value

        upper_defend = [str(t).upper() for t in defend_types]
        try:
            type1_index = upper_defend.index(str(type1).upper())
        except ValueError:
            return []
        type2_index = -1
        if type2:
            try:
                type2_index = upper_defend.index(str(type2).upper())
            except ValueError:
                return []

        values = []
        for i in range(len(attack_types)):
            eff1 = js_number(matrix.get((i, type1_index), 1))
            eff2 = js_number(matrix.get((i, type2_index), 1)) if type2_index != -1 else 1
            combined = eff1 * eff2
            values.append(int(combined) if float(combined).is_integer() else combined)
        return values
    except Exception:
        return []
