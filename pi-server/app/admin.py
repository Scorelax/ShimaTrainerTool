"""The DM console's Admin module (js/dm/admin.js -- the user's call, 2026-10-19): the DM adds and edits items and Pokedex
entries (species, with the abilities they name), uploads their pictures, and manages the loading-screen splashes.

What the DM writes goes to the data folder (gamedata.ITEMS_OVERLAY_FILE, species.OVERLAY_FILE /
species.ABILITY_OVERLAY_FILE), one record per name laid over the files in docs/ when they're read -- never into docs/
itself, which git keeps: an edit there on the Pi would block the next `git pull`. A record edited here wins over the
file's of the same name from then on.

Pictures go where the app already looks for them (media.py): an item's into ITEM_IMAGE_DIR named after the item ("Frost
Ball.png"), a species' still picture into POKEMON_IMAGE_DIR (<3-digit dex>-<name>.<ext>), its animated sprite into
SPRITE_DIR (<name>.mp4), each with a "-shiny" twin, and the splashes into SPLASH_DIR (splash-<n>.<ext>).
"""
import base64
import json
import os
import re

from . import gamedata, media, species as species_data
from .jsutil import js_parse_int

_PICTURE_TYPES = {'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif'}
_MAX_PICTURE_BYTES = 15 * 1024 * 1024
_MAX_VIDEO_BYTES = 80 * 1024 * 1024
_DATA_URL = re.compile(r'^data:([a-z]+/[a-z0-9+.-]+);base64,(.+)$', re.S)


def _write_json(path, data):
    """Written whole and then put in place, so a reader never sees half a file."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def _decode(data_url, types, max_bytes, what):
    """(bytes, extension) of an uploaded data: URL of one of `types` ({mime: extension})."""
    m = _DATA_URL.match(str(data_url or ''))
    if not m or m.group(1) not in types:
        raise ValueError(f"That isn't {what}")
    raw = base64.b64decode(m.group(2))
    if len(raw) > max_bytes:
        raise ValueError(f'That file is too big ({max_bytes // (1024 * 1024)} MB at most)')
    return raw, types[m.group(1)]


def _replace_file(folder, stem, ext, raw, exts):
    """Saves `raw` as <stem><ext> in `folder`, removing the same picture in any other format first (otherwise the old one
    could still be the one found -- media.py picks the best format of a name)."""
    os.makedirs(folder, exist_ok=True)
    for filename in os.listdir(folder):
        s, e = os.path.splitext(filename)
        if s.lower() == stem.lower() and e.lower().lstrip('.') in exts and e.lower() != ext:
            os.remove(os.path.join(folder, filename))
    with open(os.path.join(folder, stem + ext), 'wb') as f:
        f.write(raw)
    os.utime(folder)  # the folder's time moves even when a file of the same name was overwritten: the devices' data
    # version follows it (main.py), so they fetch the picture's new address


def _text(v):
    return str(v if v is not None else '').strip()


def _num(v):
    """A whole number, or None for an empty field."""
    return js_parse_int(v) if _text(v) else None


# ---------------------------------------------------------------------------
# Items
# ---------------------------------------------------------------------------

def item_list():
    """Every item as the app has it, with its picture (or None) and whether the DM added / edited it here."""
    edited = set(species_data.read_overlay(gamedata.ITEMS_OVERLAY_FILE))
    return [{**i, 'image': media.item_image_url(i['name']), 'edited': i['name'].lower() in edited}
            for i in gamedata.items()]


def save_item(item, is_new=False):
    """An item added (`is_new`) or edited: {name, category, price, description, effect}. A new one needs a name no item
    has; an edited one keeps its name (the trainers' inventories know it by name). Price: a number, or a text such as
    "Not sold", or nothing."""
    if not isinstance(item, dict):
        raise ValueError('Not an item')
    name = _text(item.get('name'))
    if not name:
        raise ValueError('The item needs a name')
    existing = next((i for i in gamedata.items() if i['name'].lower() == name.lower()), None)
    if is_new and existing:
        raise ValueError(f'There is already an item called {existing["name"]}')
    if not is_new and not existing:
        raise ValueError(f'No item called {name}')
    price = _text(item.get('price'))
    record = {
        'name': existing['name'] if existing else name,
        'category': _text(item.get('category')) or 'Misc',
        'price': (int(price) if re.fullmatch(r'\d+', price) else price) if price else None,
        'description': _text(item.get('description')),
        'effect': _text(item.get('effect')),
    }
    overlay = dict(species_data.read_overlay(gamedata.ITEMS_OVERLAY_FILE))
    overlay[record['name'].lower()] = record
    _write_json(gamedata.ITEMS_OVERLAY_FILE, overlay)
    return {**record, 'image': media.item_image_url(record['name']), 'edited': True}


def save_item_image(name, data_url):
    """An item's picture, saved as "<Item Name>.<ext>" in the item pictures folder."""
    item = next((i for i in gamedata.items() if i['name'].lower() == _text(name).lower()), None)
    if not item:
        raise ValueError(f'No item called {name} -- save the item first')
    raw, ext = _decode(data_url, _PICTURE_TYPES, _MAX_PICTURE_BYTES, 'a picture (JPG, PNG, WebP or GIF)')
    stem = media.item_file_stem(item['name'])
    if not stem:
        raise ValueError("That item's name can't be a file name")
    _replace_file(media.ITEM_IMAGE_DIR, stem, ext, raw, media.ITEM_IMAGE_EXTS)
    return {'image': media.item_image_url(item['name'])}


# ---------------------------------------------------------------------------
# Pokedex entries (species) and their abilities
# ---------------------------------------------------------------------------

def species_record(name):
    """One species exactly as it's kept (the whole object, species.py's shape), its pictures, and whether it was added /
    edited here."""
    sp = species_data.require(name)
    out = {k: v for k, v in sp.items() if k != 'evolvesFrom'}  # evolvesFrom is worked out, never kept
    # every evolution with its criteria -- read from the text for one written before they existed
    out['evolvesInto'] = [{**e, 'criteria': species_data.evolution_criteria(e)} for e in sp.get('evolvesInto') or []]
    edited = sp['name'].lower() in species_data.read_overlay(species_data.OVERLAY_FILE)
    return {'species': out, 'edited': edited, 'pictures': species_pictures(sp),
            'abilityDescriptions': {a['name']: a['description'] for a in species_data.abilities(sp)},
            'abilityNames': species_data.ability_names()}


def _shiny_only(url):
    """media.py's shiny lookups fall back to the regular picture -- here only a real shiny one counts."""
    return url if url and '-shiny' in url else ''


def species_pictures(sp):
    name, dex = sp['name'], sp.get('dexNumber')
    return {
        'still': media.local_pokemon_image_url(name, dex) or '',
        'stillShiny': _shiny_only(media.local_pokemon_image_url(name, dex, shiny=True)),
        'animated': media.local_sprite_url(name) or '',
        'animatedShiny': _shiny_only(media.local_sprite_url(name, shiny=True)),
    }


def _names(v):
    return [n for n in (_text(x) for x in (v if isinstance(v, list) else str(v or '').split(','))) if n]


def save_species(sp, is_new=False, ability_descriptions=None):
    """A species added (`is_new`) or edited, in species.py's shape. A new one needs a name and a dex number no species
    has; an edited one keeps its name (the players' Pokemon and the Pokedex settings know it by name).
    `ability_descriptions`: {ability: description} for abilities the game doesn't know yet (or a changed description)."""
    if not isinstance(sp, dict):
        raise ValueError('Not a Pokedex entry')
    name = _text(sp.get('name'))
    if not name:
        raise ValueError('The Pokémon needs a name')
    existing = species_data.get(name)
    if is_new and existing:
        raise ValueError(f'There is already a Pokémon called {existing["name"]}')
    if not is_new and not existing:
        raise ValueError(f'No Pokémon called {name}')
    dex = _num(sp.get('dexNumber'))
    if dex is None or dex < 1:
        raise ValueError('The Pokémon needs a dex number')
    clash = next((s for s in species_data.all_species() if s.get('dexNumber') == dex
                  and s['name'].lower() != name.lower()), None)
    if clash:
        raise ValueError(f'#{dex} is {clash["name"]} already')
    types = sp.get('types') or {}
    if not _text(types.get('primary')):
        raise ValueError('The Pokémon needs a primary type')
    group = lambda key, fields, conv: {f: conv((sp.get(key) or {}).get(f)) for f in fields}
    evolutions = []
    for e in sp.get('evolvesInto') or []:
        target = _text((e or {}).get('species'))
        if not target:
            continue
        criteria = []
        for c in species_data.evolution_criteria(e):
            t, v = c['type'], _text(c.get('value'))
            if t == 'level':
                v = js_parse_int(v)
                if not v or not 1 <= v <= 100:
                    raise ValueError(f'{target}: the level has to be a number')
            elif t == 'time' and v.lower() not in species_data.TIMES_OF_DAY:
                raise ValueError(f'{target}: the time of day is one of {", ".join(species_data.TIMES_OF_DAY)}')
            criteria.append({'type': t, 'value': v.lower() if t == 'time' else v})
        lines = [species_data.criterion_label(c) for c in criteria]
        only_level = len(criteria) == 1 and criteria[0]['type'] == 'level'
        evolutions.append({'species': target, 'requirement': ', '.join(lines) or None, 'criteria': criteria,
                           **({'level': criteria[0]['value']} if only_level else {})})
    record = {
        'dexNumber': dex, 'name': existing['name'] if existing else name,
        'classification': _text(sp.get('classification')), 'description': _text(sp.get('description')),
        'types': {'primary': _text(types.get('primary')), 'secondary': _text(types.get('secondary')) or None},
        'size': _text(sp.get('size')), 'rarity': _text(sp.get('rarity')), 'habitat': _text(sp.get('habitat')),
        'behavior': _text(sp.get('behavior')), 'active': _text(sp.get('active')),
        'evolvesInto': evolutions,
        'abilities': group('abilities', species_data.ABILITY_SLOTS, lambda v: _text(v) or None),
        'encounter': group('encounter', ('minimumLevel', 'catchDifficulty'), _num),
        'combat': group('combat', ('ac', 'hitDie', 'baseHP', 'vitalityDie', 'baseVP'), _num),
        'baseStats': group('baseStats', species_data.STATS, _num),
        'savingThrows': _names(sp.get('savingThrows')), 'skills': _names(sp.get('skills')),
        'moves': {str(lvl): _names((sp.get('moves') or {}).get(str(lvl))) for lvl in species_data.MOVE_LEVELS},
        'movement': group('movement', species_data.MOVEMENT, lambda v: _num(v) or 0),
        'senses': group('senses', species_data.SENSES, lambda v: _text(v) or None),
    }
    descriptions = {_text(k): _text(v) for k, v in (ability_descriptions or {}).items() if _text(k) and _text(v)}
    if descriptions:
        abilities = dict(species_data.read_overlay(species_data.ABILITY_OVERLAY_FILE))
        for ability, text in descriptions.items():
            if species_data.ability_description(ability) != text:
                abilities[ability.lower()] = {'name': ability, 'description': text}
        _write_json(species_data.ABILITY_OVERLAY_FILE, abilities)
    overlay = dict(species_data.read_overlay(species_data.OVERLAY_FILE))
    overlay[record['name'].lower()] = record
    _write_json(species_data.OVERLAY_FILE, overlay)
    return species_record(record['name'])


def save_pokemon_picture(name, kind, data_url, shiny=False):
    """A species' still picture (`kind` 'still': JPG / PNG / WebP, into the Pokemon pictures folder as
    <3-digit dex>-<name>) or animated sprite ('animated': MP4, into the sprites folder as <name>.mp4) -- replacing the
    one it had. `shiny`: its shiny version (the "-shiny" twin)."""
    sp = species_data.require(name)
    suffix = '-shiny' if shiny else ''
    base = media._sanitize_species_name(sp['name'])
    if kind == 'animated':
        raw, ext = _decode(data_url, {'video/mp4': '.mp4'}, _MAX_VIDEO_BYTES, 'an MP4 video')
        os.makedirs(media.SPRITE_DIR, exist_ok=True)
        with open(os.path.join(media.SPRITE_DIR, f'{base}{suffix}{ext}'), 'wb') as f:
            f.write(raw)
        os.utime(media.SPRITE_DIR)
    elif kind == 'still':
        types = {k: v for k, v in _PICTURE_TYPES.items() if k != 'image/gif'}
        raw, ext = _decode(data_url, types, _MAX_PICTURE_BYTES, 'a picture (JPG, PNG or WebP)')
        stem = f'{str(sp.get("dexNumber")).zfill(3)}-{base}{suffix}'
        # also a picture of it under another number (the folder's naming is "<dex>-<name>", found by name too)
        folder = media.POKEMON_IMAGE_DIR
        if os.path.isdir(folder):
            for filename in os.listdir(folder):
                s, e = os.path.splitext(filename)
                if re.sub(r'^\d+-', '', s.lower()) == base + suffix and s.lower() != stem.lower() \
                        and e.lower().lstrip('.') in media._POKEMON_IMAGE_EXTS:
                    os.remove(os.path.join(folder, filename))
        _replace_file(folder, stem, ext, raw, media._POKEMON_IMAGE_EXTS)
    else:
        raise ValueError("kind must be 'still' or 'animated'")
    return species_pictures(sp)


# ---------------------------------------------------------------------------
# The loading-screen splashes
# ---------------------------------------------------------------------------

SPLASH_NAME = re.compile(r'^splash-(\d+)\.(png|jpe?g|webp)$', re.I)  # the random ones (routes_gamedata.splash_list)
SESSION_SPLASH = 'session.png'  # shown instead of them while it's there -- js/utils/splash.js asks for exactly this name


def splashes():
    """[{file, url, session}] -- the random splashes in number order, then session.png when it's there."""
    folder = media.SPLASH_DIR
    names = os.listdir(folder) if os.path.isdir(folder) else []
    out = sorted((n for n in names if SPLASH_NAME.match(n)), key=lambda n: int(SPLASH_NAME.match(n).group(1)))
    out += [n for n in names if n == SESSION_SPLASH]
    return [{'file': n, 'url': media._versioned_url(folder, media.SPLASH_URL_PREFIX, n), 'session': n.lower().startswith('session')}
            for n in out]


def save_splash(data_url, replace=None):
    """A splash uploaded: as the next splash-<n>, or in place of `replace` (one of splashes()' files)."""
    raw, ext = _decode(data_url, {k: v for k, v in _PICTURE_TYPES.items() if k != 'image/gif'}, _MAX_PICTURE_BYTES,
                       'a picture (JPG, PNG or WebP)')
    folder = media.SPLASH_DIR
    os.makedirs(folder, exist_ok=True)
    if replace:
        current = next((s for s in splashes() if s['file'] == replace), None)
        if not current:
            raise ValueError('No such splash')
        stem = os.path.splitext(current['file'])[0]
        if current['session'] and ext != '.png':
            raise ValueError('The session splash has to be a PNG')
        os.remove(os.path.join(folder, current['file']))
    else:
        numbers = [int(SPLASH_NAME.match(s['file']).group(1)) for s in splashes() if not s['session']]
        stem = f'splash-{max(numbers, default=0) + 1}'
    with open(os.path.join(folder, stem + ext), 'wb') as f:
        f.write(raw)
    return splashes()


def delete_splash(file):
    current = next((s for s in splashes() if s['file'] == file), None)
    if not current:
        raise ValueError('No such splash')
    os.remove(os.path.join(media.SPLASH_DIR, current['file']))
    return splashes()


# ---------------------------------------------------------------------------
# The battle logs (every battle's own file -- routes_combat._append_log_file -- PvE, PvP and adventures alike)
# ---------------------------------------------------------------------------

_LOG_NAME = re.compile(r'^[\w.-]+\.jsonl$')


def _read_log(filename):
    from .routes_combat import BATTLE_LOG_DIR
    entries = []
    try:
        with open(os.path.join(BATTLE_LOG_DIR, filename), encoding='utf-8') as f:
            for line in f:
                try:
                    entries.append(json.loads(line))
                except ValueError:
                    continue
    except OSError:
        pass
    return entries


def battle_logs():
    """[{file, kind, started, ended, rounds, entries, who, caught}] -- every battle on the Pi, newest first. `who`: the
    creatures that joined; `ended`: when it ended (None for one still running or cut off)."""
    from .routes_combat import BATTLE_LOG_DIR
    names = sorted((n for n in os.listdir(BATTLE_LOG_DIR) if _LOG_NAME.match(n)), reverse=True) if os.path.isdir(BATTLE_LOG_DIR) else []
    out = []
    for name in names:
        entries = _read_log(name)
        kind = name.rsplit('-', 1)[-1].split('.')[0] if '-' in name else ''
        who = []
        for e in entries:
            if e.get('type') == 'join' and e.get('actorName') and e['actorName'] not in who:
                who.append(e['actorName'])
        out.append({
            'file': name, 'kind': kind,
            'started': entries[0].get('ts') if entries else None,
            'ended': next((e.get('ts') for e in reversed(entries) if e.get('type') == 'session-end'), None),
            'rounds': max((js_parse_int(e.get('round')) or 0 for e in entries), default=0),
            'entries': len(entries), 'who': who,
            'caught': sum(1 for e in entries if e.get('type') == 'capture'),
        })
    return out


def battle_log(filename):
    """One battle's log, every line (the DM-only ones too): [{round, ts, type, text, actorName, targetName, hidden...}]."""
    if not _LOG_NAME.match(str(filename or '')):
        raise ValueError('No such battle log')
    return _read_log(filename)
