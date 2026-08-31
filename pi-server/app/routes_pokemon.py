"""route=pokemon — port of handlePokemonRoute and its sheet helpers."""
import json

from . import db, pokedex, upstream
from .calculations import (
    apply_feat_changes, calculate_hp_vp, calculate_modifiers,
    proficiency_for_level, stab_for_level,
)
from .jsutil import js_parse_int, js_parse_int_or, js_truthy, floor_div2, intify

P = db.POKEMON_COLUMNS


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

    if action == 'evolution-video':
        if not params.get('from') or not params.get('to'):
            raise ValueError('Missing from/to pokemon names')
        return {'status': 'success',
                'url': upstream.local_evolution_video_url(params['from'], params['to'])}

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
            # Always overwrite, never conditionally -- the incoming value
            # here can be a self-uploaded sprite URL (evolution.js shows
            # GIFs/MP4s on the target preview), which must never end up
            # persisted as this Pokemon's canonical stored image.
            resolved = upstream.get_image_url(conn, calculated['newPokemonData'][2], evolve_data[3])
            calculated['newPokemonData'][1] = resolved or ''
            replaced = replace_pokemon(conn, params['currentName'], params['trainer'],
                                       calculated['newPokemonData'])
            if replaced['status'] == 'success':
                return {'status': 'success', 'message': replaced.get('message'),
                        'newPokemonData': calculated['newPokemonData']}
            return replaced
        return calculated

    raise ValueError('Unknown pokemon action: ' + str(action))


def get_pokemon_info(conn, trainer_name, pokemon_name, animated=True):
    """pokemon/get -- returns the full row as a plain positional array (same
    shape as a pokemonData entry from trainer/get, or register/evolve's
    newPokemonData), not the old _INFO_FIELDS named-dict subset it used to
    return. That subset only covered indices 0-44 -- missing utility slot
    (56), shiny (61), live HP/VP/AC (45-47) and others every other part of
    the app reads positionally -- and nothing else in the frontend actually
    consumed the named-dict shape, so returning the same array shape as
    everything else is strictly more correct, not just more consistent."""
    for _, row in db.fetch_rows(conn, 'pokemon', P):
        if (str(row[0]).lower() == trainer_name.lower()
                and str(row[2]).lower() == pokemon_name.lower()):
            row = list(row)
            if animated:
                sprite = upstream.local_sprite_url(row[2], shiny=(row[61] == 'Y'))
                if sprite:
                    row[1] = sprite
            return row
    return None


def register_pokemon_for_trainer(conn, trainer_name, new_pokemon_data):
    # Never trust the client's image field for what gets permanently stored
    # -- always resolve the real static image fresh, server-side, exactly
    # like the evolve action already does unconditionally. Two ways the
    # client's own value can be wrong: it may be a self-uploaded sprite URL
    # (get_registered_pokemon_list() now prefers those for display), which
    # must never become this Pokemon's canonical image -- the read-time swap
    # in get_pokemon_info/_with_local_sprite already shows it dynamically on
    # every fetch regardless of what's stored. Or it may be new-pokemon.js's
    # own last-resort fallback ('assets/Pokeball.png', from resolveImageUrl()
    # exhausting every format probe) baked in permanently from a moment when
    # Benjakronk simply hadn't uploaded that species' artwork yet -- always
    # re-resolving here means a species that gets its art added later is
    # picked up by the *next* registration instead of staying stuck on
    # whatever the first attempt saw.
    new_pokemon_data[1] = upstream.get_image_url(conn, new_pokemon_data[2], new_pokemon_data[3]) or ''

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
            # Never trust the client's image field here -- GET responses
            # temporarily swap it to a self-uploaded GIF/MP4 URL for display
            # (see upstream.local_sprite_url), and that swapped value ends up
            # sitting in the client's copy of this Pokemon's data. This
            # endpoint is for saving stat/move/item changes, not the image --
            # always keep whatever's already canonically stored instead of
            # whatever the client happened to be holding.
            new_pokemon_data = list(new_pokemon_data)
            new_pokemon_data[1] = row[1]
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
    trainer_key = str(trainer_name).lower()
    pokemon_key = str(pokemon_name).lower()

    active_party = sorted(
        js_parse_int(row[38]) for _, row in rows
        if str(row[0]).lower() == trainer_key and js_truthy(row[38])
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
            if str(row[0]).lower() == trainer_key and str(row[2]).lower() == pokemon_key:
                db.set_cell(conn, 'pokemon', rowid, 'inactiveparty', next_slot)
                break
        return {'status': 'success', 'slot': next_slot}

    if operation == 'remove':
        for rowid, row in rows:
            if str(row[0]).lower() == trainer_key and str(row[2]).lower() == pokemon_key:
                db.set_cell(conn, 'pokemon', rowid, 'inactiveparty', '')
                break
        return {'status': 'success', 'message': 'Removed from party'}
    return None


def update_utility_slot_status(conn, trainer_name, pokemon_name, operation):
    rows = db.fetch_rows(conn, 'pokemon', P)
    trainer_key = str(trainer_name).lower()
    pokemon_key = str(pokemon_name).lower()
    try:
        if operation == 'add':
            target_row = None
            for rowid, row in rows:
                if str(row[0]).lower() == trainer_key and str(row[2]).lower() == pokemon_key:
                    target_row = (rowid, row)
                    break
            if target_row is None:
                return {'status': 'error', 'message': 'Pokemon not found'}
            target_rowid, target = target_row
            if js_truthy(target[38]):
                return {'status': 'error',
                        'message': 'A Pokémon cannot be in the active party and the utility slot at the same time'}
            for rowid, row in rows:
                if str(row[0]).lower() == trainer_key and row[56] == 1 and str(row[2]).lower() != pokemon_key:
                    db.set_cell(conn, 'pokemon', rowid, 'utilityslot', '')
            db.set_cell(conn, 'pokemon', target_rowid, 'utilityslot', 1)
            return {'status': 'success'}
        elif operation == 'remove':
            for rowid, row in rows:
                if str(row[0]).lower() == trainer_key and str(row[2]).lower() == pokemon_key:
                    db.set_cell(conn, 'pokemon', rowid, 'utilityslot', '')
                    return {'status': 'success'}
        return {'status': 'error', 'message': 'Pokemon not found'}
    except Exception:
        return {'status': 'error', 'message': 'Failed to update utility slot status'}


def write_pokemon_live_stats(conn, trainer_name, pokemon_name, stat, new_value):
    trainer_key = str(trainer_name).lower()
    pokemon_key = str(pokemon_name).lower()
    try:
        for rowid, row in db.fetch_rows(conn, 'pokemon', P):
            if str(row[0]).lower() == trainer_key and str(row[2]).lower() == pokemon_key:
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
        return {'status': 'error', 'message': 'Pokémon not found for this trainer'}
    except Exception:
        return {'status': 'error', 'message': 'Failed to write Pokemon Live Stats'}


def get_nature_data(conn):
    return [{
        'name': r[0], 'boostStat': r[1], 'boostAmount': r[2],
        'nerfStat': r[3], 'nerfAmount': r[4],
    } for r in conn.execute(
        'SELECT name, boostStat, boostAmount, nerfStat, nerfAmount FROM natures ORDER BY ord')]
