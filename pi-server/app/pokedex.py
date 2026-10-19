"""The species lists the player app reads -- pokemon/list, pokemon/registered-list, pokemon/evolution-options (and
pokemon/abilities) -- built from the species objects (species.py).

Each species goes out as its object from DnD_species.json (with `evolvesFrom` worked out), plus `image` (its picture
on the Pi) and `abilityList` ([{slot, name, description}], the descriptions from DnD_abilities.json). They were
Benjakronk's positional rows until 2026-10-18; a player's own Pokemon is built from one on the Pi (owned.from_species)."""
from . import gamedata, media, species as sp


def _entry(s, image):
    """One species as the player app gets it (a copy -- the loaded species stay as they are)."""
    return {**s, 'image': image, 'abilityList': sp.abilities(s)}


def _registered(conn):
    names = {str(n).lower() for n in gamedata.registered_pokemon_names(conn)}
    return [s for s in sp.all_species() if s['name'].lower() in names]


def get_complete_pokemon_data(conn):
    """pokemon/list — resolves image URLs server-side: a self-uploaded
    animated sprite when one exists for that species (non-shiny -- this list
    is a flat per-species reference, not tied to any one trainer's shiny
    Pokemon), so the evolution-target preview picks up MP4s the same way
    owned Pokemon do, else the original picture on the Pi."""
    try:
        return [_entry(s, media.pokemon_image_url(s['name'], s.get('dexNumber'))) for s in _registered(conn)]
    except Exception:
        return []


def get_registered_pokemon_list(conn):
    """pokemon/registered-list — the same per-species picture as pokemon/list
    (sprite, else the original picture on the Pi; both plain filesystem
    checks), so this list (which feeds completePokemonData, and from there
    the evolution-target preview) never has to look one up itself."""
    try:
        data = [_entry(s, media.pokemon_image_url(s['name'], s.get('dexNumber'))) for s in _registered(conn)]
        return {'status': 'success', 'data': data, 'count': len(data)}
    except Exception as e:
        return {'status': 'error', 'message': str(e), 'data': []}


def get_evolution_options(conn, current_dex_entry, limit=20):
    try:
        if current_dex_entry is None:  # not a number -> no matches
            eligible = []
        else:
            eligible = [s for s in _registered(conn) if (s.get('dexNumber') or 0) > current_dex_entry]
        eligible = eligible[:limit]
        return {
            'status': 'success',
            'data': [_entry(s, None) for s in eligible],
            'totalFound': len(eligible),
        }
    except Exception as e:
        return {'status': 'error', 'message': str(e), 'data': []}


def get_pokemon_abilities(conn, pokemon_name):
    s = sp.get(pokemon_name)
    if not s or s['name'] != pokemon_name:
        return {'status': 'error', 'message': 'Pokemon not found: ' + pokemon_name, 'abilities': []}
    return {'status': 'success', 'pokemonName': pokemon_name, 'abilities': sp.abilities(s)}  # [{slot, name, description}]
