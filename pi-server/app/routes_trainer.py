"""route=trainer -- the players' trainers (objects, trainers.py) and the batched login bundle."""
import json
import time

from . import gamedata, live, owned, routes_gamedata, pokedex, trainers
from .jsutil import js_parse_int


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

    if action == 'money':
        amount = js_parse_int(params.get('amount'))
        result = _write_field(conn, params.get('trainer'), 'money', amount or 0, fail='Failed to write money')
        if result.get('status') == 'error':
            raise ValueError('Trainer not found: ' + str(params.get('trainer')))
        return {'status': 'success'}

    if action == 'affinity':
        if not params.get('trainer') or not params.get('affinity'):
            raise ValueError('Missing trainer name or affinity')
        return _write_field(conn, params['trainer'], 'affinities', _names(params['affinity']),
                            success='Affinity saved successfully', fail='Failed to write affinity')

    if action == 'specialization':
        if not params.get('trainer') or not params.get('specialization'):
            raise ValueError('Missing trainer name or specialization')
        return _write_field(conn, params['trainer'], 'specializations', _names(params['specialization']),
                            success='Specialization saved successfully', fail='Failed to write specialization')

    raise ValueError('Unknown trainer action: ' + str(action))


def _names(value):
    """A JSON list of names, or the names as one text ("PSYCHIC, DRAGON")."""
    try:
        v = json.loads(value)
    except ValueError:
        v = value
    return [str(n).strip() for n in (v if isinstance(v, list) else str(v).split(',')) if str(n).strip()]


def get_trainers(conn):
    """The login screen's list: every trainer's name, picture and PIN."""
    return [{
        'id': i,
        'image': trainers.with_image(t)['image'],
        'name': t['name'],
        'pinCode': t.get('pinCode', ''),
    } for i, (_, t) in enumerate(trainers.all_trainers(conn), start=1)]


def store_trainer_and_pokemon_data(conn, trainer_name, animated=True):
    _, trainer = trainers.find(conn, trainer_name)
    if trainer is None:
        return None
    pokemon_entries = [owned.with_image(p, animated) for _, p in owned.all_owned(conn, trainer['name'])]
    return {'trainerData': trainers.with_image(trainer), 'pokemonData': pokemon_entries}


def load_trainer_full_bundle(conn, trainer_name, animated=True):
    start = time.time()
    try:
        trainer_pokemon = store_trainer_and_pokemon_data(conn, trainer_name, animated)
        if not trainer_pokemon or not trainer_pokemon['trainerData']:
            raise ValueError('Trainer not found: ' + trainer_name)

        trainer_class = trainer_pokemon['trainerData'].get('trainerClass', '')
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
        result['pokedexConfig'] = gamedata.pokedex_config(conn)
    except Exception:
        result['pokedexConfig'] = None
    return result


def create_trainer(conn, form):
    try:
        trainer = trainers.create(form)
        if not trainer['name']:
            return {'status': 'error', 'message': 'The trainer needs a name.'}
        if trainers.find(conn, trainer['name'])[0] is not None:
            return {'status': 'error', 'message': f"There's already a trainer called {trainer['name']}."}
        trainers.insert(conn, trainer)
        return {'status': 'success', 'message': 'Trainer created successfully!', 'trainer': trainers.with_image(trainer)}
    except Exception:
        return {'status': 'error', 'message': 'Failed to create trainer. Please try again.'}


def update_trainer_data(conn, trainer):
    """The whole trainer, as the app changed it. The app sends back the picture it was shown -- it never changes a
    trainer's picture, so the stored one is kept."""
    if not isinstance(trainer, dict) or not trainer.get('name'):
        raise ValueError('Not a trainer')
    tid, old = trainers.find(conn, trainer['name'])
    if tid is None:
        return {'status': 'error', 'message': 'Trainer not found.'}
    trainer = {**trainer, 'name': old['name'], 'image': old.get('image', '')}
    trainers.save(conn, tid, trainer)
    return {'status': 'success'}


def _write_field(conn, trainer_name, field, value, success=None, fail='Write failed'):
    """One field of the trainer, written -- and every open app told this trainer's data changed."""
    try:
        tid, trainer = trainers.find(conn, trainer_name)
        if tid is None:
            return {'status': 'error', 'message': 'Trainer not found'}
        trainer[field] = value
        trainers.save(conn, tid, trainer)
        live.publish({'type': 'trainer-data', 'trainer': trainer['name']})
        result = {'status': 'success'}
        if success:
            result['message'] = success
        return result
    except Exception:
        return {'status': 'error', 'message': fail}


def write_trainer_live_stats(conn, trainer_name, stat, new_value):
    """The trainer's current HP / VP / AC (stat 'HP' / 'VP' / 'AC')."""
    try:
        tid, trainer = trainers.find(conn, trainer_name)
        if tid is None:
            return {'status': 'error', 'message': 'Trainer not found'}
        key = 'hp' if stat == 'HP' else 'vp' if stat == 'VP' else 'ac'
        trainer.setdefault('current', {})[key] = new_value
        trainers.save(conn, tid, trainer)
        return {'status': 'success'}
    except Exception:
        return {'status': 'error', 'message': 'Failed to write Trainer Live Stats'}
