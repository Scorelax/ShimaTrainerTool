"""route=pokemon -- the players' own Pokemon (owned.py: one object each) and the species lists (pokedex.py)."""
import json

from . import gamedata, live, media, owned, pokedex, trainers
from .jsutil import js_parse_int


def handle(conn, action, params):
    if action == 'list':
        return {'status': 'success', 'data': pokedex.get_complete_pokemon_data(conn)}

    if action == 'registered-list':
        return {'status': 'success', 'data': pokedex.get_registered_pokemon_list(conn)['data']}

    if action == 'get':
        if not params.get('trainer') or not params.get('name'):
            raise ValueError('Missing trainer or pokemon name')
        animated = params.get('animated', '1') != '0'
        return {'status': 'success', 'data': get_pokemon_info(conn, params['trainer'], params['name'], animated)}

    if action == 'register':
        if not params.get('trainer') or not params.get('data'):
            raise ValueError('Missing trainer or pokemon data')
        return register_pokemon_for_trainer(conn, params['trainer'], json.loads(params['data']))

    if action == 'update':
        if not params.get('data'):
            raise ValueError('Missing pokemon data')
        return update_pokemon_data(conn, json.loads(params['data']))

    if action == 'delete':
        if not params.get('trainer') or not params.get('name'):
            raise ValueError('Missing trainer or pokemon name')
        return delete_pokemon_for_trainer(conn, params['trainer'], params['name'])

    if action == 'recalculate-stats':
        # The Pokemon as the edit page has it (not saved yet) and the feats it had before -- returned worked out again.
        if not params.get('data'):
            raise ValueError('Missing pokemon data')
        pokemon = json.loads(params['data'])
        old_feats = json.loads(params.get('oldFeats') or '[]')
        owned.apply_feat_changes(pokemon, old_feats, pokemon.get('feats') or [])
        return {'status': 'success', 'newPokemonData': pokemon}

    if action == 'evolution-options':
        dex_entry = js_parse_int(params.get('dexEntry'))
        limit = js_parse_int(params.get('limit', 20)) or 20
        return pokedex.get_evolution_options(conn, dex_entry, limit)

    if action == 'evolution-video':
        if not params.get('from') or not params.get('to'):
            raise ValueError('Missing from/to pokemon names')
        return {'status': 'success',
                'url': media.local_evolution_video_url(params['from'], params['to'])}

    if action == 'battle-animation':
        if not params.get('name'):
            raise ValueError('Missing pokemon name')
        return {'status': 'success',
                'url': media.local_battle_animation_url(params['name'])}

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
        if not params.get('trainer') or not params.get('currentName') or not params.get('target'):
            raise ValueError('Missing evolution parameters')
        return evolve_pokemon(conn, params['trainer'], params['currentName'], params['target'],
                              json.loads(params.get('points') or '{}'))

    raise ValueError('Unknown pokemon action: ' + str(action))


def get_pokemon_info(conn, trainer_name, pokemon_name, animated=True):
    """pokemon/get -- one of a trainer's Pokemon, with the picture the app shows."""
    _, pokemon = owned.find(conn, trainer_name, pokemon_name)
    return owned.with_image(pokemon, animated) if pokemon else None


def build_registered_pokemon(conn, trainer_name, choice):
    """The Pokemon the registration page (pokemon-form.js) asks for: `choice` = {species, level, nature, loyalty,
    abilities: [slots], heldItem, nickname, shiny} -- built from its species (owned.from_species), with the trainer's
    own bonuses: an Ace Trainer's Max Potential (+1 STR / DEX / CON before its nature, or 10ft on every speed it has)
    and a Commander's +1 loyalty from level 5 (up to 10)."""
    trainer = trainers.find(conn, trainer_name)[1] or {}
    path = str(trainer.get('trainerPath') or '')
    max_potential = str(trainer.get('maxPotential') or '')
    loyalty = js_parse_int(choice.get('loyalty')) or 0
    if path == 'Commander' and (js_parse_int(trainer.get('level')) or 1) >= 5:
        loyalty = min(loyalty + 1, 10)
    pokemon = owned.from_species(
        conn, choice.get('species'), trainer=trainer_name, level=choice.get('level'), nature=choice.get('nature'),
        ability_slots=choice.get('abilities') or [0], nickname=choice.get('nickname'),
        held_item=choice.get('heldItem'), shiny=choice.get('shiny'), loyalty=loyalty)
    if path == 'Ace Trainer' and max_potential in ('STR', 'DEX', 'CON'):
        stat = owned.STAT_KEYS[max_potential.lower()]
        pokemon['stats'][stat] = (js_parse_int(pokemon['stats'].get(stat)) or 10) + 1
    if path == 'Ace Trainer' and max_potential == 'Speed':
        pokemon['movement'] = {k: v + 10 if v else v for k, v in pokemon['movement'].items()}
    return pokemon


def register_pokemon_for_trainer(conn, trainer_name, data):
    """A trainer caught a Pokemon: `data` is what the registration page chose (build_registered_pokemon)."""
    if not isinstance(data, dict):
        raise ValueError('Not a registration')
    pokemon = build_registered_pokemon(conn, trainer_name, data)
    pokemon['trainer'] = trainer_name
    owned.apply_registration_stats(conn, pokemon)

    # Remembered as caught for good -- the DM console's Pokedex keeps its Poke Ball after this Pokemon evolves. The
    # first one of a species the players catch also shows them what they learned of it (routes_dm.reveal_caught_species).
    from .routes_dm import caught_before, record_caught
    first_time = not caught_before(conn, pokemon['name'])
    owned.insert(conn, pokemon)
    record_caught(conn, pokemon['name'], pokemon, first_time)

    # The same trainer-data event every change to a trainer publishes -- the trainer's other open devices (and the DM
    # console's Party module) pick up the new Pokemon.
    live.publish({'type': 'trainer-data', 'trainer': trainer_name})

    return {'status': 'success',
            'message': f"{trainer_name} caught a {pokemon['name']}!",
            'newPokemonData': owned.with_image(pokemon)}


def update_pokemon_data(conn, pokemon):
    """Saves a Pokemon the app changed (stats, moves, items...), found by its trainer and species."""
    pid, _ = owned.find(conn, pokemon.get('trainer'), pokemon.get('name'))
    if pid is None:
        return {'status': 'error', 'message': 'Pokémon not found.'}
    owned.save(conn, pid, pokemon)
    return {'status': 'success'}


def delete_pokemon_for_trainer(conn, trainer_name, pokemon_name):
    """edit-pokemon.js's Release button -- removes exactly that trainer's Pokemon (another trainer's of the same
    species is never touched)."""
    pid, _ = owned.find(conn, trainer_name, pokemon_name)
    if pid is None:
        return {'status': 'error', 'message': 'Pokémon not found.'}
    owned.delete(conn, pid)
    live.publish({'type': 'trainer-data', 'trainer': trainer_name})
    return {'status': 'success', 'message': f'{pokemon_name} released.'}


def _hidden_ability_shown(conn, species):
    """Whether the players' Pokedex shows `species`' hidden ability (visibility.js's isFieldVisible(name, 'hiddenAbility'))."""
    config = gamedata.pokedex_config(conn)
    vis = (config.get('visibility') or {}).get(str(species).lower())
    if not isinstance(vis, dict):
        vis = config.get('defaults') or {}
    return vis.get('hiddenAbility') is True


def evolve_pokemon(conn, trainer_name, current_name, target, points):
    """`trainer_name`'s `current_name` evolves into `target`, with the ability-score `points` the player spent
    (owned.evolve) -- stored in its place, so it keeps its XP."""
    pid, current = owned.find(conn, trainer_name, current_name)
    if pid is None:
        return {'status': 'error', 'message': 'Pre-evolved Pokémon not found.'}
    evolved = owned.evolve(conn, current, target, points, _hidden_ability_shown(conn, target))
    owned.save(conn, pid, evolved)
    live.publish({'type': 'trainer-data', 'trainer': trainer_name})
    return {'status': 'success', 'message': 'Pokémon replaced successfully.', 'newPokemonData': owned.with_image(evolved)}


def update_active_party_status(conn, trainer_name, pokemon_name, pokeslots, operation):
    mine = owned.all_owned(conn, trainer_name)
    target = next(((i, p) for i, p in mine if str(p['name']).lower() == str(pokemon_name).lower()), None)
    if operation == 'add':
        taken = {p.get('partySlot') for _, p in mine if p.get('partySlot')}
        if len(taken) >= (pokeslots or 0):
            return {'status': 'error', 'message': 'Party is full'}
        next_slot = next((i for i in range(1, (pokeslots or 0) + 1) if i not in taken), 1)
        if target:
            target[1]['partySlot'] = next_slot
            owned.save(conn, *target)
        return {'status': 'success', 'slot': next_slot}
    if operation == 'remove':
        if target:
            target[1]['partySlot'] = None
            owned.save(conn, *target)
        return {'status': 'success', 'message': 'Removed from party'}
    return None


def update_utility_slot_status(conn, trainer_name, pokemon_name, operation):
    """The one Pokemon a trainer has in the utility slot (never one that's in the active party)."""
    mine = owned.all_owned(conn, trainer_name)
    target = next(((i, p) for i, p in mine if str(p['name']).lower() == str(pokemon_name).lower()), None)
    if target is None:
        return {'status': 'error', 'message': 'Pokemon not found'}
    if operation == 'add':
        if target[1].get('partySlot'):
            return {'status': 'error',
                    'message': 'A Pokémon cannot be in the active party and the utility slot at the same time'}
        for i, p in mine:
            if p.get('utilitySlot') and i != target[0]:
                p['utilitySlot'] = False
                owned.save(conn, i, p)
        target[1]['utilitySlot'] = True
        owned.save(conn, *target)
        return {'status': 'success'}
    if operation == 'remove':
        target[1]['utilitySlot'] = False
        owned.save(conn, *target)
        return {'status': 'success'}
    return {'status': 'error', 'message': 'Pokemon not found'}


def write_pokemon_live_stats(conn, trainer_name, pokemon_name, stat, new_value):
    """One live value, written straight away: HP / VP / AC (current), MoveCharges (JSON, owned.py's moveCharges) or
    StatusConditions (JSON list of names)."""
    pid, pokemon = owned.find(conn, trainer_name, pokemon_name)
    if pid is None:
        return {'status': 'error', 'message': 'Pokémon not found for this trainer'}
    current = pokemon.setdefault('current', {})
    if stat in ('HP', 'VP', 'AC'):
        current[stat.lower()] = js_parse_int(new_value)
    elif stat == 'MoveCharges':
        pokemon['moveCharges'] = json.loads(new_value or '{}')
    elif stat == 'StatusConditions':
        pokemon['statusConditions'] = json.loads(new_value or '[]')
    else:
        return {'status': 'error', 'message': 'Unknown live stat: ' + str(stat)}
    owned.save(conn, pid, pokemon)
    return {'status': 'success'}
