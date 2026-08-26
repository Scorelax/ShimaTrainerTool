"""Formatting of the upstream pokemon database rows — ports of
getCompletePokemonData / formatPokemonData / getRegisteredPokemonList /
getPokemonAbilities / getEvolutionOptions."""
from .calculations import format_ability, sanitize_moves
from .jsutil import js_number, js_parse_int
from . import upstream


def _row_get(row, i):
    return row[i] if i < len(row) else None


def _ability(row, name_idx, desc_idx):
    name = _row_get(row, name_idx)
    if not name:
        return None
    desc = _row_get(row, desc_idx)
    return {'name': name, 'description': desc if desc is not None else 'No description available'}


def _movement(row):
    return {
        'walking': _row_get(row, 65), 'climbing': _row_get(row, 66),
        'flying': _row_get(row, 67), 'hovering': _row_get(row, 68),
        'swimming': _row_get(row, 69), 'burrowing': _row_get(row, 70),
    }


def _senses(row):
    return {
        'sight': _row_get(row, 71), 'hearing': _row_get(row, 72), 'smell': _row_get(row, 73),
        'tremorsense': _row_get(row, 74), 'echolocation': _row_get(row, 75),
        'telepathy': _row_get(row, 76), 'blindsight': _row_get(row, 77),
        'darkvision': _row_get(row, 78), 'truesight': _row_get(row, 79),
    }


def _format_row(row, image, with_shiny):
    data = [
        image,
        row[2],   # name
        row[1],   # dex entry
        row[19],  # level
        row[7],   # primary type
        row[8],   # secondary type
        format_ability(_ability(row, 15, 62)),
        format_ability(_ability(row, 16, 63)),
        format_ability(_ability(row, 17, 64)),
        row[20],  # ac
        row[21],  # hit dice
        row[22],  # hp
        row[23],  # vitality dice
        row[24],  # vp
        row[25],  # speed
        row[26],  # total stats
        row[27], row[28], row[29], row[30], row[31], row[32],  # STR..CHA
        row[33],  # saving throws
        row[34],  # skills
        sanitize_moves(row[35], 4),
        sanitize_moves(row[36], 4),
        sanitize_moves(row[37], 4),
        sanitize_moves(row[38], 4),
        sanitize_moves(row[39], 3),
        sanitize_moves(row[40], 3),
        row[14],  # evolution requirement
        _movement(row),
        _senses(row),
        row[6],   # flavor text
        row[9],   # size
    ]
    if with_shiny:
        data.append(_row_get(row, 61))
    return data


def get_complete_pokemon_data(conn):
    """pokemon/list — resolves image URLs server-side (cached in SQLite).
    Prefers a self-uploaded animated sprite over the static Benjakronk image
    when one exists for that species (non-shiny -- this list is a flat
    per-species reference, not tied to any one trainer's shiny Pokemon), so
    the evolution-target preview picks up GIFs the same way owned Pokemon do.
    Falls back to the static image untouched when no GIF is uploaded."""
    registered = upstream.registered_pokemon_names(conn)
    try:
        all_data = upstream.fetch_pokemon_db(conn)
        filtered = [row for row in all_data if row[2] in registered]
        return [
            _format_row(row, upstream.local_gif_url(row[2]) or upstream.get_image_url(conn, row[2], row[1]),
                        with_shiny=False)
            for row in filtered
        ]
    except Exception:
        return []


def get_registered_pokemon_list(conn):
    """pokemon/registered-list — static images resolved client-side (image =
    None unless a self-uploaded GIF exists). get_image_url's GitHub probe is
    deliberately deferred to the client for this bulk endpoint since it's
    slow -- but local_gif_url is a plain filesystem check, cheap enough to
    always do here, so this list (which feeds completePokemonData, and from
    there the evolution-target preview) knows about GIFs immediately instead
    of falling back to the static-only client-side resolver every time."""
    try:
        registered = upstream.registered_pokemon_names(conn)
        all_data = upstream.fetch_pokemon_db(conn)
        data = [
            _format_row(row, upstream.local_gif_url(row[2]), with_shiny=True)
            for row in all_data if row[2] in registered
        ]
        data.sort(key=lambda r: js_number(r[2]))
        return {'status': 'success', 'data': data, 'count': len(data)}
    except Exception as e:
        return {'status': 'error', 'message': str(e), 'data': []}


def get_evolution_options(conn, current_dex_entry, limit=20):
    try:
        registered = upstream.registered_pokemon_names(conn)
        all_data = upstream.fetch_pokemon_db(conn)
        if current_dex_entry is None:  # parseInt(NaN) in .gs -> no matches
            eligible = []
        else:
            eligible = [
                row for row in all_data
                if row[2] in registered and js_number(row[1]) > current_dex_entry
            ]
        eligible.sort(key=lambda r: js_number(r[1]))
        eligible = eligible[:limit]
        return {
            'status': 'success',
            'data': [_format_row(row, None, with_shiny=True) for row in eligible],
            'totalFound': len(eligible),
        }
    except Exception as e:
        return {'status': 'error', 'message': str(e), 'data': []}


def get_pokemon_abilities(conn, pokemon_name):
    try:
        all_data = upstream.fetch_pokemon_db(conn)
        pokemon = next((row for row in all_data if row[2] == pokemon_name), None)
        if not pokemon:
            return {'status': 'error', 'message': 'Pokemon not found: ' + pokemon_name, 'abilities': []}

        abilities = []
        for slot, (name_idx, desc_idx) in enumerate([(15, 62), (16, 63), (17, 64)]):
            if _row_get(pokemon, name_idx):
                desc = _row_get(pokemon, desc_idx) or 'No description available'
                abilities.append(f'{slot}:' + format_ability({'name': pokemon[name_idx], 'description': desc}))

        return {'status': 'success', 'pokemonName': pokemon_name, 'abilities': abilities}
    except Exception as e:
        return {'status': 'error', 'message': str(e), 'abilities': []}
