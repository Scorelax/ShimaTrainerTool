"""Every species in the game, as objects -- read from docs/DnD_species.json (scripts/convert_species.py made it from
Benjakronk's 80-cell encyclopedia rows, 2026-10-18; the shape is described in the file's own "_about"). Everything on
the server that needs a species reads it through here.

On loading, each species also gets `evolvesFrom` (the species whose `evolvesInto` name it -- two for a fusion), worked
out instead of stored so the two directions can never disagree. The ability descriptions come from
docs/DnD_abilities.json, the one place they're written.

The helpers at the bottom turn a species back into the text the app has always shown (the evolution line, the one-line
speed, "25ft" / "-" movement...), so the pages and the players' saved Pokemon read exactly what they did before.

The DM console's Admin module adds and edits species and abilities on the Pi (admin.py): those go to OVERLAY_FILE /
ABILITY_OVERLAY_FILE in the data folder -- not into docs/, which git keeps (an edit there would block the next pull) --
and are laid over the files here, one species / ability replacing the file's of the same name."""
import json
import os
import re

from .db import DB_PATH

DOCS = os.path.join(os.path.dirname(__file__), '..', 'docs')
SPECIES_FILE = os.path.join(DOCS, 'DnD_species.json')
ABILITIES_FILE = os.path.join(DOCS, 'DnD_abilities.json')
DATA_DIR = os.path.dirname(DB_PATH)
OVERLAY_FILE = os.path.join(DATA_DIR, 'admin_species.json')            # {lowercase name: species}
ABILITY_OVERLAY_FILE = os.path.join(DATA_DIR, 'admin_abilities.json')  # {lowercase name: {name, description}}

MOVE_LEVELS = (1, 2, 6, 10, 14, 18)
MOVEMENT = ('walking', 'climbing', 'flying', 'hovering', 'swimming', 'burrowing')
SENSES = ('sight', 'hearing', 'smell', 'tremorsense', 'echolocation', 'telepathy', 'blindsight', 'darkvision', 'truesight')
STATS = ('strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma')
STAT_KEYS = ('str', 'dex', 'con', 'int', 'wis', 'cha')  # the same six, as the rest of the app names them
ABILITY_SLOTS = ('primary', 'secondary', 'hidden')  # slot 0, 1, 2

_cache = {'mtime': None, 'list': [], 'by_name': {}}
_abilities_cache = {'mtime': None, 'by_name': {}}


def _mtime(path):
    try:
        return os.path.getmtime(path)
    except OSError:
        return None


def read_overlay(path):
    """One of the DM's overlay files ({lowercase name: record}), {} when there's none (or it's broken)."""
    try:
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def all_species():
    """Every species, sorted by dex number -- the file's, with the DM's added / edited ones laid over (re-read only when
    either changes)."""
    mtime = (os.path.getmtime(SPECIES_FILE), _mtime(OVERLAY_FILE))
    if _cache['mtime'] != mtime:
        with open(SPECIES_FILE, encoding='utf-8') as f:
            species = json.load(f)['species']
        overlay = {k: v for k, v in read_overlay(OVERLAY_FILE).items() if isinstance(v, dict) and v.get('name')}
        species = [overlay.pop(s['name'].lower(), s) for s in species] + list(overlay.values())
        species.sort(key=lambda s: (s.get('dexNumber') if isinstance(s.get('dexNumber'), int) else 10 ** 6, s['name']))
        by_name = {s['name'].lower(): s for s in species}
        for s in species:
            s['evolvesFrom'] = []
        for s in species:  # in dex order, so a fusion's parents come out in that order too
            for e in s.get('evolvesInto') or []:
                child = by_name.get(str(e.get('species') or '').lower())
                if child is not None and s['name'] not in child['evolvesFrom']:
                    child['evolvesFrom'].append(s['name'])
        _cache.update(mtime=mtime, list=species, by_name=by_name)
    return _cache['list']


def get(name):
    """One species by name (any capitalisation), or None."""
    all_species()
    return _cache['by_name'].get(str(name or '').strip().lower())


def require(name):
    s = get(name)
    if s is None:
        raise ValueError('Unknown species: ' + str(name))
    return s


def ability_description(name):
    """An ability's description from DnD_abilities.json ('' when it isn't there)."""
    mtime = (os.path.getmtime(ABILITIES_FILE), _mtime(ABILITY_OVERLAY_FILE))
    if _abilities_cache['mtime'] != mtime:
        with open(ABILITIES_FILE, encoding='utf-8') as f:
            items = json.load(f)['abilities']
        by_name = {a['name'].lower(): a for a in items}
        by_name.update({k: v for k, v in read_overlay(ABILITY_OVERLAY_FILE).items() if isinstance(v, dict) and v.get('name')})
        _abilities_cache.update(mtime=mtime, by_name=by_name)
    a = _abilities_cache['by_name'].get(str(name or '').strip().lower())
    return re.sub(r'\s+', ' ', str(a.get('description') or '')).strip() if a else ''


def ability_names():
    """Every ability the game knows (DnD_abilities.json and the DM's own), by name."""
    ability_description('')  # (loads them)
    return sorted((a['name'] for a in _abilities_cache['by_name'].values()), key=str.lower)


def abilities(s):
    """[{slot, name, description}] -- the abilities the species has, slot 0 / 1 / 2 (primary, secondary, hidden)."""
    out = []
    for slot, key in enumerate(ABILITY_SLOTS):
        name = (s.get('abilities') or {}).get(key)
        if name:
            out.append({'slot': slot, 'name': name, 'description': ability_description(name) or 'No description available'})
    return out


def stats(s):
    """{'str': 13, 'dex': 10, ...} (None where the encyclopedia has no number yet)."""
    base = s.get('baseStats') or {}
    return {k: base.get(full) for k, full in zip(STAT_KEYS, STATS)}


def stat_total(s):
    vals = list(stats(s).values())
    return sum(vals) if all(isinstance(v, int) for v in vals) else None


def moves_at(s, level):
    """The moves learned at one of the six levels (1, 2, 6, 10, 14, 18)."""
    return list((s.get('moves') or {}).get(str(level)) or [])


# ---------------------------------------------------------------------------
# The text the app has always shown
# ---------------------------------------------------------------------------

def moves_text(s, level):
    return ', '.join(moves_at(s, level))


def feet_text(ft):
    """25 -> '25ft', 0 -> '-' (can't), None -> '' (unknown)."""
    return '' if ft is None else f'{ft}ft' if ft else '-'


def movement_text(s):
    """{'walking': '25ft', 'climbing': '25ft', 'flying': '-', ...}."""
    return {k: feet_text((s.get('movement') or {}).get(k)) for k in MOVEMENT}


def speed_text(s):
    """'25ft. Walking, 25ft. Climbing' -- the encyclopedia's old one-line speed."""
    return ', '.join(f'{ft}ft. {k.title()}' for k, ft in (s.get('movement') or {}).items() if ft)


def sense_text(value):
    return value if value else '-'


def senses_text(s):
    return {k: sense_text((s.get('senses') or {}).get(k)) for k in SENSES}


def list_text(values):
    """['Dexterity', 'Constitution'] -> 'Dexterity, Constitution'."""
    return ', '.join(values or [])


def evolution_text(s):
    """'From: Octodendron; Evolves: Yukinarbor @ Level 14' -- the encyclopedia's old evolution line (a player's saved
    Pokemon keeps it, and the app reads its evolutions from it). A fusion's parents are joined with ' + '."""
    parts = []
    if s.get('evolvesFrom'):
        parts.append('From: ' + ' + '.join(s['evolvesFrom']))
    for e in s.get('evolvesInto') or []:
        parts.append(f"Evolves: {e['species']} @ {e['requirement']}" if e.get('requirement') else f"Evolves: {e['species']}")
    return '; '.join(parts)


# What an evolution takes, one criterion each (the user's call, 2026-10-19 -- the Admin module builds them, the players'
# Pokedex shows one line each): evolvesInto[i]['criteria'] = [{type, value}], `requirement` their text joined (what the
# rest of the app shows), and `level` set only when a level is all it takes.
CRITERIA_TYPES = ('level', 'item', 'location', 'happiness', 'time', 'move', 'other')
TIMES_OF_DAY = ('morning', 'day', 'evening', 'night')


def criterion_label(c):
    """One criterion as the players read it: 'Level 7', 'Item: Water Stone', 'Time of day: Night'..."""
    t, v = c.get('type'), str(c.get('value') if c.get('value') is not None else '').strip()
    if t == 'level':
        return f'Level {v}'
    if t == 'item':
        return f'Item: {v}'
    if t == 'location':
        return f'Location: {v}'
    if t == 'happiness':
        return f'Happiness: {v}'
    if t == 'time':
        return f'Time of day: {v[:1].upper() + v[1:]}'
    if t == 'move':
        return f'Knows the move {v}'
    return v


def evolution_criteria(e):
    """An evolution's criteria -- its own, or read from the text of one written before they existed: "Level 7 Near
    ports" is Level 7 plus "Near ports"; anything else is one free-text criterion."""
    if isinstance(e.get('criteria'), list):
        return [c for c in e['criteria'] if isinstance(c, dict) and c.get('type') in CRITERIA_TYPES
                and str(c.get('value') if c.get('value') is not None else '').strip()]
    req = str(e.get('requirement') or '').strip()
    if not req:
        return []
    m = re.match(r'^level\s+(\d+)\b[\s,.;:-]*(.*)$', req, re.I | re.S)
    if m:
        rest = m.group(2).strip()
        return [{'type': 'level', 'value': int(m.group(1))}] + ([{'type': 'other', 'value': rest}] if rest else [])
    return [{'type': 'other', 'value': req}]


def requirement_lines(e):
    """What an evolution takes, one line per criterion."""
    return [criterion_label(c) for c in evolution_criteria(e)]


def evolves_into_names(s):
    return [e['species'] for e in s.get('evolvesInto') or []]


# Evolution targets the old encyclopedia misspelled (scripts/convert_species.py fixed them): the old spelling -> the name.
OLD_TARGET_SPELLINGS = {'Elqueeen': 'Elqueen', 'Agulizz': 'Agiluzz', 'Compiizard': 'Compizard', 'Lumiinarch': 'Luminarch',
                        'Silivolt': 'Silvolt', 'Blaziiken': 'Blaziken'}


def fix_target_spellings(config):
    """The players' Pokedex settings saved before the fix keep their per-evolution-target switches under the old
    spelling -- renamed to the species' name (in place; True when anything changed)."""
    changed = False
    for vis in ((config or {}).get('visibility') or {}).values():
        targets = vis.get('evoToTargets') if isinstance(vis, dict) else None
        if isinstance(targets, dict):
            for old, new in OLD_TARGET_SPELLINGS.items():
                if old in targets:
                    targets.setdefault(new, targets.pop(old))
                    changed = True
    return changed
