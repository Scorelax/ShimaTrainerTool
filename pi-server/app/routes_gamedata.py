"""route=game-data -- the game's data the app keeps while a trainer is logged in (gamedata.py's files), and the
splash list."""
import os
import re

from . import gamedata, media


def handle(conn, action, params):
    if action == 'all':
        return {'status': 'success', 'data': load_all_game_data(conn)}

    if action == 'conduit':
        return {'status': 'success', 'data': load_all_conduit_game_data(conn)}

    if action == 'moves':
        return {'status': 'success', 'data': gamedata.moves()}

    if action == 'natures':
        return {'status': 'success', 'data': gamedata.natures()}

    if action == 'type-effectiveness':
        return {'status': 'success', 'data': gamedata.type_matchups(params.get('type1'), params.get('type2'))}

    if action == 'pokedex-config':
        return {'status': 'success', 'data': gamedata.pokedex_config(conn)}

    if action == 'player-pokedex':
        from .player_pokedex import player_pokedex
        return {'status': 'success', 'data': player_pokedex(conn)}

    if action == 'splash-list':
        return splash_list()

    raise ValueError('Unknown game-data action: ' + str(action))


def splash_list():
    """The loading-screen splashes on the Pi (media.SPLASH_DIR): the splash-N.png files, and whether session.png is
    there."""
    if not os.path.isdir(media.SPLASH_DIR):
        return {'status': 'error', 'message': 'no splash folder on the Pi'}
    names = os.listdir(media.SPLASH_DIR)
    return {
        'status': 'success',
        'splashFiles': sorted(n for n in names if re.match(r'^splash-\d+\.png$', n)),
        'hasSession': 'session.png' in names,
    }


def _common(conn):
    return {
        'itemsData': {'status': 'success', 'items': gamedata.items()},
        'moves': gamedata.moves(),
        'natures': gamedata.natures(),
        'trainerFeatsData': {'status': 'success', 'trainerFeats': gamedata.trainer_feats()},
        'pokemonFeatsData': {'status': 'success', 'pokemonFeats': gamedata.pokemon_feats()},
        'nationalitiesData': {'status': 'success', 'nationalities': gamedata.nationalities()},
    }


def load_all_game_data(conn):
    """A Pokemon Trainer's game data."""
    return {
        'specializations': gamedata.specializations(),
        'trainerPaths': gamedata.trainer_paths(),
        'affinities': gamedata.affinities(),
        'skillsData': {'status': 'success', 'skills': gamedata.trainer_skills()},
        **_common(conn),
    }


def load_all_conduit_game_data(conn):
    """A conduit's game data."""
    conduit = gamedata.conduit()
    return {
        'conduitFeatures': conduit['features'],
        'battleStyles': conduit['battleStyles'],
        'typeAwakening': conduit['typeAwakenings'],
        **_common(conn),
    }
