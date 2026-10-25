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


# The DM's own names for the battles (the user's call, 2026-10-20): {file: name}, beside the logs. A battle without one
# is named on screen after its players, with the date and time.
_LOG_NAMES = 'names.json'


def _log_names():
    from .routes_combat import BATTLE_LOG_DIR
    try:
        with open(os.path.join(BATTLE_LOG_DIR, _LOG_NAMES), encoding='utf-8') as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def battle_logs(trainer_names=()):
    """[{file, kind, started, ended, rounds, entries, who, players, name, caught}] -- every battle on the Pi, newest first.
    `who`: the creatures that joined; `players`: the players' trainers in it (a join's owner -- or, in a log from before
    joins said whose they were, a name in `trainer_names`); `name`: the DM's name for it (None: not named); `ended`: when
    it ended (None for one still running or cut off)."""
    from .routes_combat import BATTLE_LOG_DIR, DM_OWNER
    names = sorted((n for n in os.listdir(BATTLE_LOG_DIR) if _LOG_NAME.match(n)), reverse=True) if os.path.isdir(BATTLE_LOG_DIR) else []
    known = {str(t).lower(): t for t in trainer_names}
    titles = _log_names()
    out = []
    for name in names:
        entries = _read_log(name)
        kind = name.rsplit('-', 1)[-1].split('.')[0] if '-' in name else ''
        who, players = [], []
        for e in entries:
            if e.get('type') != 'join' or not e.get('actorName'):
                continue
            if e['actorName'] not in who:
                who.append(e['actorName'])
            if 'actorOwner' in e:
                owner = e.get('actorOwner') or ''
                player = owner if owner and owner != DM_OWNER else None
            else:
                player = known.get(str(e['actorName']).lower())
            if player and player not in players:
                players.append(player)
        out.append({
            'file': name, 'kind': kind,
            'started': entries[0].get('ts') if entries else None,
            'ended': next((e.get('ts') for e in reversed(entries) if e.get('type') == 'session-end'), None),
            'rounds': max((js_parse_int(e.get('round')) or 0 for e in entries), default=0),
            'entries': len(entries), 'who': who, 'players': players,
            'name': titles.get(name) or None,
            'caught': sum(1 for e in entries if e.get('type') == 'capture'),
        })
    return out


def rename_battle_log(filename, name):
    """The DM's name for one battle (empty: back to the one made from its players and date)."""
    from .routes_combat import BATTLE_LOG_DIR
    if not _LOG_NAME.match(str(filename or '')) or not os.path.isfile(os.path.join(BATTLE_LOG_DIR, filename)):
        raise ValueError('No such battle log')
    titles = _log_names()
    name = str(name or '').strip()[:120]
    if name:
        titles[filename] = name
    else:
        titles.pop(filename, None)
    path = os.path.join(BATTLE_LOG_DIR, _LOG_NAMES)
    with open(path + '.tmp', 'w', encoding='utf-8') as f:
        json.dump(titles, f, ensure_ascii=False, indent=1)
    os.replace(path + '.tmp', path)
    return name or None


def battle_log(filename):
    """One battle's log, every line (the DM-only ones too): [{round, ts, type, text, actorName, targetName, hidden...}]."""
    if not _LOG_NAME.match(str(filename or '')):
        raise ValueError('No such battle log')
    return _read_log(filename)


# ---------------------------------------------------------------------------
# Moves (the user's call, 2026-10-25: the Admin module's Moves tab)
# ---------------------------------------------------------------------------

# What the DM can change on a move -- what the overlay keeps (gamedata.MOVES_OVERLAY_FILE); its effects and categories
# stay the file's
_MOVE_FIELDS = ('name', 'type', 'action', 'range', 'duration', 'reaction', 'moveStat', 'vpCost', 'description', 'scaling',
                'attackRoll')
# What the battle's automation reads from a move's text: changed (other than its dice), the move wants a new look --
# its effects may no longer say what it does. The dice, the VP cost, the type and the move stat are read as they are.
_REVIEWED = ('description', 'scaling', 'action', 'range', 'duration', 'attackRoll')
_TIER = re.compile(r'\d+d\d+\s+at\s+level\s+\d+', re.I)


def _same_but_dice(a, b, field):
    """Whether two texts of a move say the same thing but for their dice (the description's "2d8", the higher levels'
    "3d8 at level 5, 4d8 at level 10, and 6d8 at level 17" -- however many levels)."""
    def norm(s):
        s = _TIER.sub('#', str(s or '')) if field == 'scaling' else str(s or '')
        s = re.sub(r'\d+d\d+', '#', s)
        s = re.sub(r'#(?:\s*,?\s*(?:and\s+)?#)+', '#', s)
        return re.sub(r'\s+', ' ', s).strip().rstrip('.')
    return norm(a) == norm(b)


def _duration(raw):
    """A duration's text as the move file keeps it -- {raw, rounds, concentration, varies} (the same reading as
    docs/categorize_moves_draft.js's parseDuration)."""
    s = _text(raw)
    concentration = bool(re.search(r'concentration', s, re.I))
    base = re.sub(r',?\s*concentration', '', s, flags=re.I).strip()
    rounds, varies = None, False
    if re.fullmatch(r'instantaneous', base, re.I):
        rounds = 0
    elif re.fullmatch(r'varies', base, re.I):
        varies = True
    else:
        m = re.fullmatch(r'(\d+)(?:-(\d+))?\s*(round|turn|minute|hour|day)s?', base, re.I)
        d = re.fullmatch(r'(\d+)d(\d+)\s*(round|turn|minute|hour|day)s?', base, re.I)
        if d:
            rounds = {'dice': f'{d.group(1)}d{d.group(2)}', 'unit': d.group(3).lower()}
        elif m:
            rounds = int(m.group(1)) * {'round': 1, 'turn': 1, 'minute': 10, 'hour': 600, 'day': 14400}[m.group(3).lower()]
        else:
            rounds = {'raw': base}
    return {'raw': s, 'rounds': rounds, 'concentration': concentration, 'varies': varies}


def _move_entry(m, overlay):
    patch = overlay.get(m['name'].lower()) or {}
    return {
        **{k: m.get(k) for k in _MOVE_FIELDS},
        'duration': (m.get('duration') or {}).get('raw', '') if isinstance(m.get('duration'), dict) else _text(m.get('duration')),
        'categories': m.get('categories') or [],
        'effects': len(m.get('effects') or []),
        'added': bool(patch.get('added')),
        'edited': any(k in patch for k in _MOVE_FIELDS if k != 'name'),
        'review': patch.get('review'),
    }


def move_list():
    """Every move as the app has it, for the Admin module: its fields (duration as its text), its categories and how many
    effects it has (read only here), whether the DM added or changed it, and its `review` mark ({why: [field, ...] --
    'new' for an added move --, at}) while it waits for a new look."""
    overlay = species_data.read_overlay(gamedata.MOVES_OVERLAY_FILE)
    return [_move_entry(m, overlay) for m in gamedata.move_records()]


def save_move(move, is_new=False):
    """A move added (`is_new`) or edited: {name, type, action, range, duration (its text), moveStat, vpCost, description,
    scaling, attackRoll}. A new one needs a name no move has; an edited one keeps its name (the Pokemon know their moves
    by name). Marked for a new look when it's new, or when what the automation reads changed (_REVIEWED) -- a mark
    already there stays, with this change's reasons added."""
    if not isinstance(move, dict):
        raise ValueError('Not a move')
    name = re.sub(r'\s+', ' ', _text(move.get('name')))
    if not name:
        raise ValueError('The move needs a name')
    records = gamedata.move_records()
    current = next((m for m in records if m['name'].lower() == name.lower()), None)
    if is_new and current:
        raise ValueError(f'There is already a move called {current["name"]}')
    if not is_new and not current:
        raise ValueError(f'No move called {name}')
    base = next((m for m in gamedata.read_file(gamedata.MOVES_FILE).get('moves') or [] if m['name'].lower() == name.lower()), None)
    before = current or gamedata.NEW_MOVE
    action = _text(move.get('action')) or '1 action'
    wanted = {
        'name': current['name'] if current else name,
        'type': _text(move.get('type')) or 'Normal',
        'action': action,
        'range': _text(move.get('range')),
        # a reaction by its action -- worked out again only when that changes (Powder's "1 action/ reaction" isn't one)
        'reaction': before.get('reaction', False) if action == before.get('action') else bool(re.search(r'\breaction\b', action, re.I)),
        'moveStat': _text(move.get('moveStat')) or 'None',
        'vpCost': _text(move.get('vpCost')),
        'description': _text(move.get('description')),
        'scaling': _text(move.get('scaling')),
        'attackRoll': bool(move.get('attackRoll')),
    }
    raw_duration = _text(move.get('duration')) or 'Instantaneous'
    old_duration = before.get('duration') if isinstance(before.get('duration'), dict) else {}
    # (an unchanged duration keeps the file's reading of it -- the same text reads the same, but the file may say more)
    wanted['duration'] = old_duration if old_duration.get('raw', '') == raw_duration else _duration(raw_duration)
    if not wanted['description']:
        raise ValueError('The move needs a description')

    # why it wants a new look now
    if not current:
        why = ['new']
    else:
        why = []
        raw = lambda v: ((v or {}).get('raw', '') if isinstance(v, dict) else v)  # (a duration: its text)

        def differs(k, old, new):
            if k in ('description', 'scaling'):
                return not _same_but_dice(old, new, k)
            if k == 'attackRoll':
                return bool(old) != bool(new)
            return (raw(old) or '') != (raw(new) or '')
        for k in _REVIEWED:
            # (put back as the file has it: what the automation was made for -- nothing to look at)
            if differs(k, before.get(k), wanted[k]) and (base is None or differs(k, base.get(k), wanted[k])):
                why.append(k)

    overlay = dict(species_data.read_overlay(gamedata.MOVES_OVERLAY_FILE))
    key = wanted['name'].lower()
    old_patch = overlay.get(key) or {}
    # only what differs from the file's move (an added one: all of it)
    patch = {k: v for k, v in wanted.items() if base is None or k == 'name' or base.get(k) != v}
    if base is None:
        patch['added'] = True
    review = old_patch.get('review')
    if why:
        reasons = list(dict.fromkeys((review or {}).get('why', []) + why))
        review = {'why': reasons, 'at': _now()}
    if review:
        patch['review'] = review
    if len(patch) == 1 and base is not None:
        overlay.pop(key, None)  # back to exactly the file's
    else:
        overlay[key] = patch
    _write_json(gamedata.MOVES_OVERLAY_FILE, overlay)
    return next(_move_entry(m, overlay) for m in gamedata.move_records() if m['name'].lower() == key)


def move_checked(name):
    """A move's `review` mark taken off -- the DM has looked it over (its automation is right)."""
    overlay = dict(species_data.read_overlay(gamedata.MOVES_OVERLAY_FILE))
    key = _text(name).lower()
    patch = dict(overlay.get(key) or {})
    if not patch.get('review'):
        raise ValueError(f'{name} isn\'t waiting for a look')
    patch.pop('review')
    if set(patch) <= {'name'}:
        overlay.pop(key)
    else:
        overlay[key] = patch
    _write_json(gamedata.MOVES_OVERLAY_FILE, overlay)
    return next(_move_entry(m, overlay) for m in gamedata.move_records() if m['name'].lower() == key)


def _now():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat(timespec='seconds')
