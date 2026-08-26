"""route=trainer — port of handleTrainerRoute and its sheet helpers."""
import json
import time

from . import db, routes_gamedata, pokedex, upstream
from .calculations import calculate_hp_vp
from .jsutil import js_parse_int, js_number, floor_div2

T = db.TRAINER_COLUMNS
P = db.POKEMON_COLUMNS


def handle(conn, action, params):
    if action == 'list':
        return {'status': 'success', 'data': get_trainers(conn)}

    if action == 'get':
        if not params.get('name'):
            raise ValueError('Missing trainer name')
        animated = params.get('animated', '1') != '0'
        return {'status': 'success', 'data': store_trainer_and_pokemon_data(conn, params['name'], animated)}

    if action == 'get-full':
        if not params.get('name'):
            raise ValueError('Missing trainer name')
        animated = params.get('animated', '1') != '0'
        return load_trainer_full_bundle(conn, params['name'], animated)

    if action == 'create':
        if not params.get('data'):
            raise ValueError('Missing trainer data')
        return create_trainer(conn, json.loads(params['data']))

    if action == 'update':
        if not params.get('data'):
            raise ValueError('Missing trainer data')
        return update_trainer_data(conn, json.loads(params['data']))

    if action == 'live-stats':
        return write_trainer_live_stats(
            conn, params.get('trainer'), params.get('stat'), js_parse_int(params.get('value')))

    if action == 'inventory':
        return _write_trainer_cell(conn, params.get('trainer'), 'inventory', params.get('data'),
                                   fail='Failed to write items')

    if action == 'gear':
        return _write_trainer_cell(conn, params.get('trainer'), 'gear', params.get('data'),
                                   fail='Failed to write gear')

    if action == 'money':
        # .gs stores JSON.stringify(parseInt(amount)) — a bare number string
        amount = js_parse_int(params.get('amount'))
        result = _write_trainer_cell(conn, params.get('trainer'), 'money', json.dumps(amount),
                                     fail='Failed to write money')
        if result.get('status') == 'error':
            raise ValueError('Trainer row not found for ' + str(params.get('trainer')))
        return {'status': 'success'}

    if action == 'affinity':
        if not params.get('trainer') or not params.get('affinity'):
            raise ValueError('Missing trainer name or affinity')
        return _write_trainer_cell(conn, params['trainer'], 'affinity', params['affinity'],
                                   success='Affinity saved successfully',
                                   fail='Failed to write affinity')

    if action == 'specialization':
        if not params.get('trainer') or not params.get('specialization'):
            raise ValueError('Missing trainer name or specialization')
        return _write_trainer_cell(conn, params['trainer'], 'specialization', params['specialization'],
                                   success='Specialization saved successfully',
                                   fail='Failed to write specialization')

    if action == 'trainer-path':
        if not params.get('trainer') or not params.get('path'):
            raise ValueError('Missing trainer name or path')
        return _write_trainer_cell(conn, params['trainer'], 'trainerpath', params['path'],
                                   success='Trainer path saved successfully',
                                   fail='Failed to write trainer path')

    raise ValueError('Unknown trainer action: ' + str(action))


def get_trainers(conn):
    return [{
        'id': i,
        'image': row[0],
        'name': row[1],
        'pinCode': row[22],
    } for i, (_, row) in enumerate(db.fetch_rows(conn, 'trainers', T), start=1)]


def _with_local_gif(row, animated=True):
    """Swap in a self-uploaded animated sprite for this row's image field,
    if one exists (upstream.local_gif_url) -- otherwise leave the stored
    image untouched. Skipped entirely when the caller has animated sprites
    turned off (Settings > Animated Sprites), so the stored static image
    always comes through unchanged."""
    if not animated:
        return row
    gif = upstream.local_gif_url(row[2], shiny=(row[61] == 'Y'))
    if not gif:
        return row
    row = list(row)
    row[1] = gif
    return row


def store_trainer_and_pokemon_data(conn, trainer_name, animated=True):
    trainer_entry = next(
        (row for _, row in db.fetch_rows(conn, 'trainers', T)
         if str(row[1]).lower() == trainer_name.lower()), None)
    if trainer_entry is None:
        return None

    pokemon_entries = [
        _with_local_gif(row, animated) for _, row in db.fetch_rows(conn, 'pokemon', P)
        if str(row[0]).lower() == trainer_name.lower()
    ]
    return {'trainerData': trainer_entry, 'pokemonData': pokemon_entries}


def load_trainer_full_bundle(conn, trainer_name, animated=True):
    start = time.time()
    try:
        trainer_pokemon = store_trainer_and_pokemon_data(conn, trainer_name, animated)
        if not trainer_pokemon or not trainer_pokemon['trainerData']:
            raise ValueError('Trainer not found: ' + trainer_name)

        trainer_class = trainer_pokemon['trainerData'][39]
        if trainer_class == 'Pokemon Trainer':
            game_data = routes_gamedata.load_all_game_data(conn)
        else:
            game_data = routes_gamedata.load_all_conduit_game_data(conn)

        result = {
            'status': 'success',
            'trainerData': trainer_pokemon['trainerData'],
            'pokemonData': trainer_pokemon['pokemonData'],
            'gameData': game_data,
            'trainerClass': trainer_class,
            'executionTime': int((time.time() - start) * 1000),
        }
    except Exception as e:
        return {'status': 'error', 'message': str(e)}

    try:
        result['registeredList'] = pokedex.get_registered_pokemon_list(conn)['data']
    except Exception:
        result['registeredList'] = None
    try:
        result['pokedexConfig'] = upstream.fetch_pokedex_config(conn)
    except Exception:
        result['pokedexConfig'] = None
    return result


def create_trainer(conn, trainer):
    try:
        strength = js_number(trainer['strength'])
        dexterity = js_number(trainer['dexterity'])
        constitution = js_number(trainer['constitution'])
        intelligence = js_number(trainer['intelligence'])
        wisdom = js_number(trainer['wisdom'])
        charisma = js_number(trainer['charisma'])
        level = js_number(trainer['level'])

        strmodifier = floor_div2(strength)
        dexmodifier = floor_div2(dexterity)
        conmodifier = floor_div2(constitution)
        intmodifier = floor_div2(intelligence)
        wismodifier = floor_div2(wisdom)
        chamodifier = floor_div2(charisma)

        hit_dice = js_parse_int(trainer['hitDice'])
        vitality_dice = js_parse_int(trainer['vitalityDice'])
        hp, vp = calculate_hp_vp(strength, dexterity, constitution, intelligence,
                                 wisdom, charisma, level, hit_dice, vitality_dice, 0)

        initiative = dexmodifier
        ac = 10 + dexmodifier
        proficiency = 2 if level <= 4 else 3 if level <= 8 else 4 if level <= 12 else 5 if level <= 16 else 6

        if trainer.get('trainerClass') == 'Pokemon Trainer':
            if 1 <= level <= 4:
                pokeslots = 3
            elif 5 <= level <= 9:
                pokeslots = 4
            elif 10 <= level <= 15:
                pokeslots = 5
            elif 16 <= level <= 20:
                pokeslots = 6
            else:
                pokeslots = 3
        else:
            if 1 <= level <= 4:
                pokeslots = 0
            elif 5 <= level <= 15:
                pokeslots = 1
            elif 16 <= level <= 20:
                pokeslots = 2
            else:
                pokeslots = 0

        image_url = trainer.get('image') or 'https://via.placeholder.com/150'
        inventory = json.loads(trainer.get('inventory') or '[]')
        inventory_str = ', '.join(f"{item['name']} (x{item['quantity']})" for item in inventory)
        skills = ', '.join(trainer['skills']) if isinstance(trainer.get('skills'), list) else ''

        row_data = [
            image_url, trainer['name'], trainer['level'], trainer['hitDice'], trainer['vitalityDice'],
            trainer['strength'], trainer['dexterity'], trainer['constitution'],
            trainer['intelligence'], trainer['wisdom'], trainer['charisma'],
            hp, vp, ac, trainer.get('walkingSpeed'), trainer.get('savingThrows'),
            initiative, proficiency, skills, trainer.get('money'), inventory_str,
            trainer.get('leaguePoints'), trainer.get('pinCode'),
            '', '', '',  # affinity, specialization, trainerpath
            pokeslots,
            strmodifier, dexmodifier, conmodifier, intmodifier, wismodifier, chamodifier,
            '', '', '', '', '',  # feats, currentHP, currentVP, currentAC, gear
            trainer.get('nationality'), trainer.get('trainerClass'),
            '', '', '', '', '', '', '', '', '', '', '', '',
        ]

        db.insert_row(conn, 'trainers', T, row_data)
        return {'status': 'success', 'message': 'Trainer created successfully!', 'rowData': row_data}
    except Exception:
        return {'status': 'error', 'message': 'Failed to create trainer. Please try again.'}


def update_trainer_data(conn, new_trainer_data):
    name = str(new_trainer_data[1]).lower()
    for rowid, row in db.fetch_rows(conn, 'trainers', T):
        if str(row[1]).lower() == name:
            db.update_row(conn, 'trainers', rowid, T, new_trainer_data)
            return {'status': 'success'}
    return {'status': 'error', 'message': 'Trainer not found.'}


def _find_trainer_rowid(conn, trainer_name):
    """findTrainerRow — exact (case-sensitive) name match, like the .gs ===."""
    for rowid, row in db.fetch_rows(conn, 'trainers', T):
        if row[1] == trainer_name:
            return rowid
    return None


def _write_trainer_cell(conn, trainer_name, column, value, success=None, fail='Write failed'):
    try:
        rowid = _find_trainer_rowid(conn, trainer_name)
        if rowid is None:
            return {'status': 'error', 'message': 'Trainer not found'}
        db.set_cell(conn, 'trainers', rowid, column, value)
        result = {'status': 'success'}
        if success:
            result['message'] = success
        return result
    except Exception:
        return {'status': 'error', 'message': fail}


def write_trainer_live_stats(conn, trainer_name, stat, new_value):
    try:
        rowid = _find_trainer_rowid(conn, trainer_name)
        if rowid is None:
            return {'status': 'error', 'message': 'Trainer not found'}
        column = 'currentHP' if stat == 'HP' else 'currentVP' if stat == 'VP' else 'currentAC'
        db.set_cell(conn, 'trainers', rowid, column, new_value)
        return {'status': 'success'}
    except Exception:
        return {'status': 'error', 'message': 'Failed to write Trainer Live Stats'}
