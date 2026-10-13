"""route=game-data&action=player-pokedex -- the players' Pokedex (pokedex.html): every species in the shared pokedex
(pokedexConfig's `registered`) with only what the DM lets the players see of it (its `visibility` switches, or the
`defaults`), plus the moves the players may look up.

Benjakronk's old Pokedex site downloaded the whole encyclopedia and hid fields in the browser, so anyone could read
what they hadn't discovered yet. Here the hiding happens on the Pi: a field that's switched off never leaves it. The
switches mean what they meant on his site (its script.js getVisibility / createPokemonCard / getSearchableMoves), so
the DM console's Pokedex module (js/dm/pokedex.js) edits exactly what shows up here."""
import re

from . import upstream
from .calculations import fix_mojibake, sanitize_moves, sanitize_string
from .jsutil import js_parse_int

# What a switch is when neither the species' own settings nor the defaults name it (his site's DEFAULT_VISIBILITY).
_BASE_VISIBILITY = {
    'primaryType': True, 'secondaryType': True, 'description': True,
    'charSize': True, 'charRarity': True, 'charBehavior': True, 'charHabitat': True, 'charActivity': True,
    'statAC': False, 'statHD': False, 'statVD': False, 'statSpeed': False,
    'statSTR': False, 'statDEX': False, 'statCON': False, 'statINT': False, 'statWIS': False, 'statCHA': False,
    'statSaves': False, 'statSkills': False,
    'primaryAbility': False, 'secondaryAbility': False, 'hiddenAbility': False,
    'senseSight': False, 'senseHearing': False, 'senseSmell': False, 'senseTremorsense': False,
    'senseEcholocation': False, 'senseTelepathy': False, 'senseBlindsight': False, 'senseDarkvision': False,
    'senseTruesight': False,
    'evoFrom': False, 'evoTo': False, 'evoToTargets': {},
    'moves': False, 'movesMaxLevel': 1, 'extraVisibleMoves': [],
}
# Older config files used one switch per group; his migrateVisibility spread each over its fields.
_LEGACY_GROUPS = {
    'types': ('primaryType', 'secondaryType'),
    'characteristics': ('charSize', 'charRarity', 'charBehavior', 'charHabitat', 'charActivity'),
    'stats': ('statAC', 'statHD', 'statVD', 'statSpeed', 'statSTR', 'statDEX', 'statCON', 'statINT', 'statWIS',
              'statCHA', 'statSaves', 'statSkills'),
    'senses': ('senseSight', 'senseHearing', 'senseSmell', 'senseTremorsense', 'senseEcholocation', 'senseTelepathy',
               'senseBlindsight', 'senseDarkvision', 'senseTruesight'),
    'evolution': ('evoFrom', 'evoTo'),
}

# Encyclopedia row layout (see pokedex.py's _format_row).
_CHARACTERISTICS = (('charSize', 'Size', 9), ('charRarity', 'Rarity', 10), ('charBehavior', 'Behavior', 12),
                    ('charHabitat', 'Habitat', 11), ('charActivity', 'Activity', 13))
_COMBAT = (('statAC', 'AC', 20), ('statHD', 'Hit Dice', 21), ('statVD', 'Vitality', 23), ('statSpeed', 'Speed', 25))
_SCORES = (('statSTR', 'STR', 27), ('statDEX', 'DEX', 28), ('statCON', 'CON', 29), ('statINT', 'INT', 30),
           ('statWIS', 'WIS', 31), ('statCHA', 'CHA', 32))
_ABILITIES = (('primaryAbility', 15, 62, False), ('secondaryAbility', 16, 63, False), ('hiddenAbility', 17, 64, True))
_SENSES = (('senseSight', 'Sight', 71), ('senseHearing', 'Hearing', 72), ('senseSmell', 'Smell', 73),
           ('senseTremorsense', 'Tremorsense', 74), ('senseEcholocation', 'Echolocation', 75),
           ('senseTelepathy', 'Telepathy', 76), ('senseBlindsight', 'Blindsight', 77),
           ('senseDarkvision', 'Darkvision', 78), ('senseTruesight', 'Truesight', 79))
# Learned at level 1 (starting), 2, 6, 10, 14, 18: (column, how many count).
_MOVE_LEVELS = ((1, 35, 4), (2, 36, 4), (6, 37, 4), (10, 38, 4), (14, 39, 3), (18, 40, 3))


def _cell(row, i):
    v = row[i] if i < len(row) and row[i] is not None else ''
    return fix_mojibake(v) if isinstance(v, str) else v


def _text(row, i):
    return sanitize_string(_cell(row, i))


def _visibility(vis):
    """One species' switches with every key filled in -- his migrateVisibility."""
    vis = vis if isinstance(vis, dict) else {}
    out = {**_BASE_VISIBILITY, **vis}
    for old, keys in _LEGACY_GROUPS.items():
        if old in vis:
            for k in keys:
                if k not in vis:
                    out[k] = vis[old]
    if not isinstance(out.get('evoToTargets'), dict):
        out['evoToTargets'] = {}
    if not isinstance(out.get('extraVisibleMoves'), list):
        out['extraVisibleMoves'] = []
    return out


def _evolution(text):
    """'From: Sandit; Evolves: Bedouwara @ Level 14' -> ({'fusion': False, 'name': 'Sandit'}, ['Bedouwara']).
    The part after "From:" can be a fusion ('A + B @ ...'); the names after "Evolves:" can be several, each with its
    condition after an "@" (the same split as routes_dm._evo_part, which the DM console's switches are keyed by)."""
    text = re.sub(r'\s+', ' ', str(text or '').replace('\\n', ' ')).strip()
    evolves_from, evolves_to = None, []
    for part in text.split(';'):
        key, _, value = part.partition(':')
        key, value = key.strip().lower(), value.strip()
        if key == 'from' and value and value != '-':
            names = value.split('@')[0].strip()
            if '+' in names:
                evolves_from = {'fusion': True, 'name': ' + '.join(n.strip() for n in names.split('+'))}
            else:
                evolves_from = {'fusion': False, 'name': names}
        elif key == 'evolves':
            for n in re.split(r',|/|\bor\b', value):
                n = re.split(r'\s*@', n)[0].strip()
                if n and n != '-':
                    evolves_to.append(n)
    return evolves_from, evolves_to


def _shown_sense(value):
    v = str(value or '').strip()
    return bool(v) and v not in ('0', '-') and v.lower() != 'no'


def _die(value):
    v = str(value or '').strip()
    return f'd{v}' if v.isdigit() else v


def _species_entry(conn, row, vis, own):
    """One registered species, cut down to what `vis` lets through. `own`: it has settings of its own (the evolution
    targets are then its own switches; without, the defaults' single "Evolves into" switch stands for all of them,
    as the DM console shows it)."""
    name, dex = row[2], _cell(row, 1)
    primary, secondary = _text(row, 7), _text(row, 8)
    entry = {
        'name': name, 'dex': dex,
        'image': upstream.local_pokemon_image_url(name, dex) or upstream.local_sprite_url(name) or '',
        # Whether there IS a second type shows (as a split header colour) even while it's hidden -- as on his site.
        'dualType': bool(secondary),
        'primaryType': primary if vis['primaryType'] else None,
        'secondaryType': secondary if vis['secondaryType'] and secondary else None,
    }
    if vis['description']:
        entry['classification'] = _text(row, 5)
        entry['flavor'] = _text(row, 6)
    entry['info'] = [{'key': key, 'label': label, 'value': _text(row, i)}
                     for key, label, i in _CHARACTERISTICS if vis[key] and _text(row, i)]
    entry['combat'] = [{'label': label, 'value': _die(_text(row, i)) if key in ('statHD', 'statVD') else _text(row, i)}
                       for key, label, i in _COMBAT if vis[key]]
    entry['scores'] = [{'label': label, 'value': _text(row, i)} for key, label, i in _SCORES if vis[key]]
    entry['saves'] = _text(row, 33) if vis['statSaves'] else ''
    entry['skills'] = _text(row, 34) if vis['statSkills'] else ''
    entry['abilities'] = [
        {'name': _text(row, n), 'description': _text(row, d) or 'No description available', 'hidden': hidden}
        for key, n, d, hidden in _ABILITIES if vis[key] and _text(row, n)]
    entry['senses'] = [{'label': label, 'value': _text(row, i)}
                       for key, label, i in _SENSES if vis[key] and _shown_sense(_cell(row, i))]

    evolves_from, evolves_to = _evolution(_cell(row, 14))
    targets = vis['evoToTargets'] if own else {t: bool(vis['evoTo']) for t in evolves_to}
    entry['evolution'] = {
        'from': evolves_from if vis['evoFrom'] else None,
        'to': [t for t in evolves_to if targets.get(t)],
    }

    # Moves: everything learned up to movesMaxLevel, plus the extra ones the DM ticked; per level, how many stay hidden.
    entry['movesShown'] = bool(vis['moves'])
    entry['moves'], entry['hiddenMoves'] = [], {}
    if vis['moves']:
        max_level = js_parse_int(vis.get('movesMaxLevel')) or 1
        extra = {str(m).lower() for m in vis['extraVisibleMoves']}
        entry['movesMaxLevel'] = max_level
        for level, col, keep in _MOVE_LEVELS:
            names = [m.strip() for m in sanitize_moves(_cell(row, col), keep).split(',') if m.strip()]
            shown = [m for m in names if level <= max_level or m.lower() in extra]
            entry['moves'] += [{'name': m, 'level': level, 'extra': level > max_level} for m in shown]
            if len(names) > len(shown):
                entry['hiddenMoves'][str(level)] = len(names) - len(shown)
    return entry


def _move_details(conn):
    """{lowercase name: move} from the move list, in the shape the page shows."""
    out = {}
    for m in upstream.fetch_moves(conn):
        name, mtype, power, time, vp, duration, rng, desc, higher = (list(m) + [''] * 9)[:9]
        out[str(name).lower()] = {
            'name': name, 'type': mtype, 'power': power, 'time': time, 'vp': vp, 'duration': duration,
            'range': rng, 'description': fix_mojibake(desc), 'higher': fix_mojibake(str(higher or '').strip()),
        }
    return out


def player_pokedex(conn):
    config = upstream.fetch_pokedex_config(conn) or {}
    registered = {str(n).lower() for n in config.get('registered') or []}
    own_settings = {str(k).lower(): v for k, v in (config.get('visibility') or {}).items()}
    defaults = config.get('defaults') or {}

    species = []
    for row in upstream.fetch_pokemon_db(conn):
        name = row[2] if len(row) > 2 else ''
        if not name or str(name).lower() not in registered:
            continue
        own = own_settings.get(str(name).lower())
        species.append(_species_entry(conn, row, _visibility(own if own else defaults), bool(own)))
    species.sort(key=lambda s: js_parse_int(s['dex']) or 0)

    # The moves the players may look up: every move a species shows, plus the ones the DM made searchable on their own.
    details = _move_details(conn)
    searchable = {m['name'].lower() for s in species for m in s['moves']}
    searchable |= {str(m).lower() for m in config.get('extraSearchableMoves') or []}
    moves = sorted((details[n] for n in searchable if n in details), key=lambda m: str(m['name']).lower())
    return {'species': species, 'moves': moves}


def searchable_move_overview(conn):
    """For the DM console's "Searchable moves" page: every move (name + type), and which of them the players can
    already look up because a species in their Pokedex shows it."""
    via_pokemon = sorted({m['name'] for s in player_pokedex(conn)['species'] for m in s['moves']})
    moves = [{'name': m['name'], 'type': m['type']} for m in _move_details(conn).values()]
    moves.sort(key=lambda m: str(m['name']).lower())
    return {'moves': moves, 'viaPokemon': via_pokemon}
