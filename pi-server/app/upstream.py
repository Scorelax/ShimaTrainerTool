"""Snapshots of Benjakronk's external data sources, stored in SQLite.

The Apps Script version fetched these live with a 6h CacheService TTL. Here
they persist until explicitly refreshed — the Reset Cache button in the app
(game-data/clear-cache) or scripts/refresh_upstream.py re-fetches them.
A failed fetch keeps the previous snapshot.
"""
import json
import os
import re
from datetime import datetime, timezone
from urllib.parse import quote, unquote

import httpx

from .calculations import sanitize_string

POKEMON_DATA_URL = 'https://script.google.com/macros/s/AKfycbwIT3OS2bdCv2kkDPh6IjRRirv17iPnuttlPcY47LCHBbpNPuHF_IjVq0mCt7TkkWoW/exec?action=pokemon'
ITEMS_DATA_URL = 'https://script.google.com/macros/s/AKfycbwIT3OS2bdCv2kkDPh6IjRRirv17iPnuttlPcY47LCHBbpNPuHF_IjVq0mCt7TkkWoW/exec?action=items'
POKEDEX_CONFIG_URL = 'https://raw.githubusercontent.com/Benjakronk/shima-pokedex/main/pokedex_config.json'

# Moves used to come from a live Google Sheet fetch here too (same shape as
# the other *_DATA_URL constants above), until the user pointed out the
# move list is effectively static -- new moves are basically never added --
# so a version-controlled local file was worth more than staying live, and
# it's also where the user's own manual move categorization already lives
# (routes_combat.py's list-move-categories reads this exact file). See
# fetch_moves below for the row shape this produces.
MOVES_FILE = os.path.join(os.path.dirname(__file__), '..', 'docs', 'DnD_moves_categorized_draft.json')

# The picture formats of Benjakronk's images, best first (when a picture exists in several, the first one is used).
IMG_FORMATS = ['png', 'jpg', 'jpeg', 'jfif']

# User-uploaded animated sprites (mp4 only -- gif support was dropped, see
# local_sprite_url()), local to the Pi -- unrelated to Benjakronk's
# repo/pipeline above. Named just <sanitized-species-name>.mp4, no dex-id
# prefix. Checked live on every request (a plain filesystem stat, not a
# network probe), so no caching layer is needed here.
SPRITE_DIR = os.path.expanduser(os.environ.get('SPRITE_DIR', '~/pokemon-dnd/pokemon-sprites'))

# Every local_sprite_url() return value starts with this -- used elsewhere to
# recognize (and refuse to persist) a sprite URL that shouldn't have reached
# permanent storage. See routes_pokemon.py's register/update/evolve guards.
# Kept as /gifs/ even after the SPRITE_DIR rename and the gif-format drop --
# it's just a legacy URL prefix name at this point, already baked into every
# Pokemon's stored image field in the live DB; changing it would 404 every
# one of them until each got re-saved.
SPRITE_URL_PREFIX = '/gifs/'

# Self-uploaded evolution transition videos, e.g. pikachu_raichu.mp4 --
# unrelated to SPRITE_DIR above (different content, different naming: two
# species joined by an underscore instead of one). Same live-filesystem-
# check, no-caching-layer reasoning as SPRITE_DIR.
EVOLUTION_VIDEO_DIR = os.path.expanduser(
    os.environ.get('EVOLUTION_VIDEO_DIR', '~/pokemon-dnd/evolution_video'))

# Self-uploaded cry sound, e.g. pikachu.mp3 -- named with the same
# _sanitize_species_name() rule as SPRITE_DIR/EVOLUTION_VIDEO_DIR, but played
# once client-side on card view rather than persisted anywhere, so unlike
# local_sprite_url()/local_evolution_video_url() there's no lookup function
# here: the frontend builds the URL itself and no-ops on a 404.
CRY_DIR = os.path.expanduser(os.environ.get('CRY_DIR', '~/pokemon-dnd/pokemon-cries'))

# Self-uploaded "use move" battle animation, e.g. pikachu.mp4 -- one clip per
# species (no per-move variants), named with the same _sanitize_species_name()
# rule as the others. Played in combat once the player confirms a move, over
# the idle sprite already shown in the confirm popup. Same live-filesystem-
# check, no-caching-layer reasoning as SPRITE_DIR/EVOLUTION_VIDEO_DIR -- and
# like those two (unlike CRY_DIR) it needs a lookup function, since the
# frontend has to know up front whether one exists at all in order to
# preload it ahead of the Yes click instead of finding out only when trying
# to play it.
BATTLE_ANIMATION_DIR = os.path.expanduser(
    os.environ.get('BATTLE_ANIMATION_DIR', '~/pokemon-dnd/battle-animations'))

# Battle-map background images, e.g. battle-forest.png -- browsed directly
# (routes_combat.py's list-backgrounds), unlike the per-species dirs above
# which are only ever looked up by an exact expected filename. Same live-
# filesystem-check, no-caching-layer reasoning as the others.
BATTLE_IMAGE_DIR = os.path.expanduser(
    os.environ.get('BATTLE_IMAGE_DIR', '~/pokemon-dnd/battle-images'))

# Self-made trainer portraits, e.g. Joey.png -- named after the trainer (case-
# insensitive), used instead of the trainer's stored image URL whenever one
# exists (local_character_image_url). Same live-filesystem-check reasoning as
# the dirs above, so dropping a new file in shows up on the next load.
CHARACTER_IMAGE_DIR = os.path.expanduser(
    os.environ.get('CHARACTER_IMAGE_DIR', '~/pokemon-dnd/images/characters'))

# Every local_character_image_url() return value starts with this -- like
# SPRITE_URL_PREFIX, used to refuse persisting one into the trainers table.
CHARACTER_IMAGE_URL_PREFIX = '/character-images/'
_CHARACTER_IMAGE_EXTS = ('.png', '.jpg', '.jpeg', '.webp', '.gif')

# Benjakronk's original species pictures, copied onto the Pi (the same files as his repo's images/pokemon, named
# <3-digit dex>-<sanitized name>.<png|jpg|jpeg|jfif>) -- served at /pokemon-images/ (local_pokemon_image_url).
POKEMON_IMAGE_DIR = os.path.expanduser(
    os.environ.get('POKEMON_IMAGE_DIR', '~/pokemon-dnd/images/original_pokemon'))
POKEMON_IMAGE_URL_PREFIX = '/pokemon-images/'
_POKEMON_IMAGE_EXTS = IMG_FORMATS + ['webp']

# The NPC pictures (Benjakronk's characters, named <sanitized name>.<ext>, e.g. nurse-joy.png) -- the DM console's NPC
# portraits, where the DM's own uploads go too (routes_dm.save_npc_image), and a trainer's portrait when there's no
# self-made one of that name (trainer_image_url). His repo's images/characters addresses map here.
NPC_IMAGE_DIR = os.path.expanduser(
    os.environ.get('NPC_IMAGE_DIR') or os.environ.get('ORIGINAL_CHARACTER_DIR') or '~/pokemon-dnd/images/npc')
NPC_IMAGE_URL_PREFIX = '/npc-images/'
NPC_IMAGE_EXTS = IMG_FORMATS + ['webp', 'gif']

# The gym badges (his repo's images/badges, <kebab-case name>.png) -- trainer-card.js asks for /badges/<name>.png.
BADGE_DIR = os.path.expanduser(os.environ.get('BADGE_DIR', '~/pokemon-dnd/images/badges'))
BADGE_URL_PREFIX = '/badges/'

# The loading-screen splashes (his repo's images/splashes: splash-<n>.png, and session.png when there is one).
SPLASH_DIR = os.path.expanduser(os.environ.get('SPLASH_DIR', '~/pokemon-dnd/images/splashes'))
SPLASH_URL_PREFIX = '/splashes/'

# Pictures the DM uploads from the DM console for the table TV (backgrounds -- routes_dm.save_display_image). Each file
# gets a new random name, so its URL never shows different content (cached hard, see main.py).
DISPLAY_IMAGE_DIR = os.path.expanduser(
    os.environ.get('DISPLAY_IMAGE_DIR', '~/pokemon-dnd/display-images'))
DISPLAY_IMAGE_URL_PREFIX = '/display-images/'

# Apps Script upstreams can be slow (cold starts)
_FETCH_TIMEOUT = 120.0


def _cache_get(conn, key):
    row = conn.execute('SELECT json FROM upstream_cache WHERE key = ?', (key,)).fetchone()
    return json.loads(row[0]) if row else None


def _cache_put(conn, key, obj):
    conn.execute(
        'INSERT OR REPLACE INTO upstream_cache (key, json, fetched_at) VALUES (?, ?, ?)',
        (key, json.dumps(obj), datetime.now(timezone.utc).isoformat()),
    )
    conn.commit()


def _fetch_json(url):
    resp = httpx.get(url, timeout=_FETCH_TIMEOUT, follow_redirects=True)
    resp.raise_for_status()
    return resp.json()


def fetch_pokemon_db(conn, force=False):
    if not force:
        cached = _cache_get(conn, 'pokemonDB')
        if cached is not None:
            return cached
    data = _fetch_json(POKEMON_DATA_URL)
    _cache_put(conn, 'pokemonDB', data)
    return data


def fetch_moves(conn, force=False):
    """Reads MOVES_FILE instead of a live fetch -- see that constant's own
    comment. `conn` and `force` only remain in the signature so every
    existing caller (routes_combat.py's _find_move, routes_gamedata.py,
    refresh_all's uniform fn(c, force=True) loop) keeps working unmodified;
    neither is actually used -- there's no SQLite cache or network response
    here to force a refresh of, since a plain file read is already cheap
    enough to just do fresh every call (same reasoning as
    routes_combat.py's list-move-categories, which reads this identical
    file -- an in-progress edit on the Pi should show up on the next move
    popup without a server restart). Returns the same [name, type,
    modifier, actionType, vpCost, duration, range, desc, higherLevels] row
    shape the live fetch used to, since every caller destructures it
    positionally."""
    try:
        with open(MOVES_FILE, encoding='utf-8') as f:
            data = json.load(f)
    except (OSError, ValueError):
        return []
    return [
        [m['name'], m['type'], m.get('moveStat', ''), m['action'], m.get('vpCost', ''),
         (m.get('duration') or {}).get('raw', ''), m['range'], m['description'], m.get('scaling', '')]
        for m in data.get('moves', [])
    ]


def fetch_items(conn, force=False):
    """Returns the mapped {'status': 'success', 'items': [...]} shape
    (the .gs version caches the mapped result, not the raw rows)."""
    if not force:
        cached = _cache_get(conn, 'items')
        if cached is not None:
            return cached
    try:
        data = _fetch_json(ITEMS_DATA_URL)
        items = [{
            'name': sanitize_string(row[0]),
            'type': sanitize_string(row[1]),
            'description': sanitize_string(row[3]),
            'effect': sanitize_string(row[4]),
        } for row in data]
        result = {'status': 'success', 'items': items}
        _cache_put(conn, 'items', result)
        return result
    except Exception:
        return {'status': 'error', 'message': 'Failed to load items'}


def fetch_pokedex_config(conn, force=False):
    if force and pokedex_config_edited_here(conn):
        force = False  # edited in the DM console: the Pi's copy is the real one now, never replaced by GitHub's
    if not force:
        cached = _cache_get(conn, 'pokedexConfig')
        if cached is not None:
            return cached
    try:
        data = _fetch_json(POKEDEX_CONFIG_URL)
        _cache_put(conn, 'pokedexConfig', data)
        return data
    except Exception:
        return {
            'registered': [], 'visibility': {}, 'defaults': {},
            'extraSearchableMoves': [], 'splashCount': 0,
        }


# Maps the dataset name used by the push endpoint to the upstream_cache key
# the matching pull-based fetch_* function already uses. pokemon-db/moves/
# items are pull-only (nightly refresh) -- they rarely change mid-session,
# unlike pokedex-config which needs to reach players in real time.
PUSHABLE_DATASETS = {
    'pokedex-config': 'pokedexConfig',
}


def store_pushed_dataset(conn, dataset, data):
    """Accept a dataset pushed directly by Benjakronk's admin panel, replacing
    the snapshot without waiting on GitHub raw's CDN. Storing bumps
    fetched_at, hence X-Data-Version, so clients refresh."""
    if dataset not in PUSHABLE_DATASETS:
        raise ValueError(
            'unknown dataset %r; expected one of %s'
            % (dataset, ', '.join(PUSHABLE_DATASETS)))

    if not isinstance(data, dict) or not isinstance(data.get('registered'), list):
        raise ValueError("pokedex-config must be an object with a 'registered' array")
    if 'visibility' in data and not isinstance(data['visibility'], dict):
        raise ValueError("'visibility' must be an object")

    _cache_put(conn, PUSHABLE_DATASETS[dataset], data)


_LOCAL_CONFIG_MARK = 'pokedex-config-edited-here'


def pokedex_config_edited_here(conn):
    """True once the DM console has saved the pokedex config (store_local_pokedex_config) -- from then on the Pi holds
    the real copy, so a cache refresh (warm_upstream / Reset Cache) keeps it instead of pulling GitHub's over it."""
    row = conn.execute('SELECT json FROM dm_state WHERE key = ?', (_LOCAL_CONFIG_MARK,)).fetchone()
    return bool(row and row[0])


def store_local_pokedex_config(conn, data):
    """The DM console's Pokedex module saving what players may see: same checks as Benjakronk's push, stored as the
    pokedexConfig snapshot (fetched_at moves on, so clients refresh) and marked as edited here (see above)."""
    store_pushed_dataset(conn, 'pokedex-config', data)
    conn.execute('INSERT OR REPLACE INTO dm_state (key, json, updated_at) VALUES (?, ?, ?)',
                 (_LOCAL_CONFIG_MARK, json.dumps(True), datetime.now(timezone.utc).isoformat()))
    conn.commit()


def registered_pokemon_names(conn):
    config = fetch_pokedex_config(conn)
    return config.get('registered', []) if config else []


def warm_upstream(conn):
    """Force-refresh every live snapshot; failures keep the previous data.
    Moves isn't one of these any more -- fetch_moves reads a local file now
    (see MOVES_FILE), nothing to refresh from network.

    The three remaining sources are fetched in parallel (each on its own
    SQLite connection - connections aren't shareable across threads), so
    the wall time is the slowest upstream instead of the sum of all three.
    The passed conn is unused but kept so callers don't change."""
    from concurrent.futures import ThreadPoolExecutor

    from . import db

    def refresh(fn):
        c = db.connect()
        try:
            fn(c, force=True)
        except Exception:
            pass
        finally:
            c.close()

    fns = (fetch_pokemon_db, fetch_items, fetch_pokedex_config)
    with ThreadPoolExecutor(max_workers=len(fns)) as pool:
        list(pool.map(refresh, fns))


def _sanitize_species_name(name):
    """Lowercase, non-alphanumeric runs collapsed to a single hyphen, no
    leading/trailing hyphens. The one filename rule shared by every local
    (local_pokemon_image_url, local_sprite_url, local_evolution_video_url,
    local_npc_image_url) lookup."""
    return re.sub(r'^-+|-+$', '', re.sub(r'[^a-z0-9]+', '-', str(name).lower()))


_folder_indexes = {}  # folder -> (folder mtime it was built at, {lowercase file stem: file name})


def _folder_files(folder, exts):
    """{lowercase file stem: file name} for the pictures in `folder` (extensions in `exts`, best first -- per stem the
    best format wins). Rebuilt only when the folder changes (a file added, removed or renamed)."""
    try:
        mtime = os.path.getmtime(folder)
    except OSError:
        return {}
    cached = _folder_indexes.get(folder)
    if cached and cached[0] == mtime:
        return cached[1]
    best = {}  # stem -> (rank, file name)
    for filename in os.listdir(folder):
        stem, ext = os.path.splitext(filename)
        ext = ext.lower().lstrip('.')
        if ext not in exts:
            continue
        rank = exts.index(ext)
        stem = stem.lower()
        if stem not in best or rank < best[stem][0]:
            best[stem] = (rank, filename)
    files = {stem: name for stem, (_, name) in best.items()}
    _folder_indexes[folder] = (mtime, files)
    return files


def _versioned_url(folder, prefix, filename):
    """prefix + file name + `?t=<mtime>`, or None when the file isn't there -- same mtime-stamped-URL reasoning as
    local_sprite_url()."""
    path = os.path.join(folder, filename or '')
    if not filename or not os.path.isfile(path):
        return None
    return f'{prefix}{quote(filename)}?t={int(os.path.getmtime(path))}'


def local_sprite_url(pokemon_name, shiny=False):
    """Self-uploaded animated sprite for pokemon_name, if one exists in
    SPRITE_DIR. Same sanitization as local_pokemon_image_url() for one
    consistent filename rule across both, but otherwise unrelated -- no
    dex-id prefix.

    Checked in this order, so shiny-correctness always wins: shiny.mp4, then
    non-shiny.mp4. Shiny uses a -shiny suffix, matching the convention
    Benjakronk's own shiny sprites already use elsewhere; falls back through
    to the non-shiny variant if no shiny file exists."""
    sanitized = _sanitize_species_name(pokemon_name)
    candidates = []
    if shiny:
        candidates.append(f'{sanitized}-shiny.mp4')
    candidates.append(f'{sanitized}.mp4')
    for filename in candidates:
        path = os.path.join(SPRITE_DIR, filename)
        if os.path.isfile(path):
            # `?t=<mtime>` lets main.py cache this response hard (long
            # max-age, no per-load revalidation round-trip) while still
            # invalidating automatically the moment this exact file is
            # replaced -- the URL itself changes, so there's no stale copy to
            # ever manually clear.
            return f'{SPRITE_URL_PREFIX}{filename}?t={int(os.path.getmtime(path))}'
    return None


def local_evolution_video_url(pre_evolved_name, evolved_name):
    """Self-uploaded evolution transition video for this specific
    <pre-evolved> -> <evolved> pair, if one exists in EVOLUTION_VIDEO_DIR.
    Named <sanitized-pre-evolved>_<sanitized-evolved>.mp4 -- underscore as
    the separator between the two species is unambiguous since
    _sanitize_species_name() already turns every other character into a
    hyphen, so it can never appear inside either segment itself."""
    filename = f'{_sanitize_species_name(pre_evolved_name)}_{_sanitize_species_name(evolved_name)}.mp4'
    path = os.path.join(EVOLUTION_VIDEO_DIR, filename)
    if os.path.isfile(path):
        # See the matching comment in local_sprite_url() above -- same
        # mtime-stamped-URL reasoning.
        return f'/evolution-videos/{filename}?t={int(os.path.getmtime(path))}'
    return None


def local_character_image_url(trainer_name):
    """Self-made portrait for trainer_name in CHARACTER_IMAGE_DIR (file name =
    the trainer's name, any case, any of _CHARACTER_IMAGE_EXTS), or None.
    Same mtime-stamped-URL reasoning as local_sprite_url()."""
    wanted = str(trainer_name or '').strip().lower()
    if not wanted or not os.path.isdir(CHARACTER_IMAGE_DIR):
        return None
    for filename in sorted(os.listdir(CHARACTER_IMAGE_DIR)):
        stem, ext = os.path.splitext(filename)
        if stem.lower() == wanted and ext.lower() in _CHARACTER_IMAGE_EXTS:
            path = os.path.join(CHARACTER_IMAGE_DIR, filename)
            if os.path.isfile(path):
                return f'{CHARACTER_IMAGE_URL_PREFIX}{quote(filename)}?t={int(os.path.getmtime(path))}'
    return None


_pokemon_by_name = (None, {})  # (the _folder_files dict it was built from, {'<name>': file name})


def _pokemon_image_files():
    """POKEMON_IMAGE_DIR's pictures keyed '<dex>-<name>' (the file names), and the same keyed by '<name>' alone."""
    global _pokemon_by_name
    files = _folder_files(POKEMON_IMAGE_DIR, _POKEMON_IMAGE_EXTS)
    if _pokemon_by_name[0] is not files:
        by_name = {}
        for stem in sorted(files):
            by_name.setdefault(re.sub(r'^\d+-', '', stem), files[stem])
        _pokemon_by_name = (files, by_name)
    return files, _pokemon_by_name[1]


def local_pokemon_image_url(pokemon_name, pokemon_id, shiny=False):
    """The original picture of a species from POKEMON_IMAGE_DIR, or None: '<dex>-<name>' first (Benjakronk's naming),
    then the name alone (in case the number differs). A shiny one uses its '-shiny' picture when there is one."""
    files, by_name = _pokemon_image_files()
    name = _sanitize_species_name(pokemon_name)
    base = f'{str(pokemon_id).zfill(3)}-{name}'
    for suffix in (('-shiny', '') if shiny else ('',)):
        filename = files.get(base + suffix) or by_name.get(name + suffix)
        if filename:
            return _versioned_url(POKEMON_IMAGE_DIR, POKEMON_IMAGE_URL_PREFIX, filename)
    return None


def pokemon_image_url(pokemon_name, pokemon_id, shiny=False, animated=True):
    """What the app shows for a species: its self-uploaded animated sprite (unless the player turned animated sprites
    off), else its original picture, else '' (the app shows a Poke Ball)."""
    return ((animated and local_sprite_url(pokemon_name, shiny=shiny))
            or local_pokemon_image_url(pokemon_name, pokemon_id, shiny=shiny) or '')


def local_npc_image_url(name):
    """The NPC picture for this trainer / character name (NPC_IMAGE_DIR, file named <sanitized name>.<ext>), or None."""
    filename = _folder_files(NPC_IMAGE_DIR, NPC_IMAGE_EXTS).get(_sanitize_species_name(name))
    return _versioned_url(NPC_IMAGE_DIR, NPC_IMAGE_URL_PREFIX, filename)


def npc_pictures():
    """[(file stem, url)] for every picture in NPC_IMAGE_DIR, by name -- the DM console's NPC portraits."""
    files = _folder_files(NPC_IMAGE_DIR, NPC_IMAGE_EXTS)
    out = [(stem, _versioned_url(NPC_IMAGE_DIR, NPC_IMAGE_URL_PREFIX, name)) for stem, name in sorted(files.items())]
    return [(stem, url) for stem, url in out if url]


def trainer_image_url(trainer_name, stored=''):
    """What the app shows for a trainer: the self-made portrait (local_character_image_url), else the NPC picture of
    that name, else the picture the row stored (made local, see localize_image_url), else the Poke Ball."""
    return (local_character_image_url(trainer_name) or local_npc_image_url(trainer_name)
            or localize_image_url(stored) or 'assets/Pokeball.png')


# A picture in Benjakronk's repo -- the address the app stored before everything moved onto the Pi.
_REPO_IMAGE = r'https?://raw\.githubusercontent\.com/Benjakronk/shima-pokedex/[^/\s"]+/images/([a-z_]+)/([^?#\s"]+)'
_REPO_IMAGE_FOLDERS = {
    'pokemon': (POKEMON_IMAGE_DIR, POKEMON_IMAGE_URL_PREFIX),
    'characters': (NPC_IMAGE_DIR, NPC_IMAGE_URL_PREFIX),
    'badges': (BADGE_DIR, BADGE_URL_PREFIX),
    'splashes': (SPLASH_DIR, SPLASH_URL_PREFIX),
}


def _local_repo_picture(match):
    folder = _REPO_IMAGE_FOLDERS.get(match.group(1))
    return _versioned_url(*folder, os.path.basename(unquote(match.group(2)))) if folder else None


def localize_image_url(url):
    """A stored picture address, made local: one of Benjakronk's repo pictures becomes the same file on the Pi (None
    when the Pi doesn't have it), any other web address is dropped (None), and the Pi's own paths stay as they are."""
    url = str(url or '').strip()
    m = re.fullmatch(_REPO_IMAGE + r'(?:[?#].*)?', url)
    if m:
        return _local_repo_picture(m)
    if not url or re.match(r'^[a-z][a-z0-9+.-]*:', url, re.I):
        return None
    return url


def localize_image_urls_in_text(text):
    """Every repo picture address in a stored JSON text (the DM console's saved scenes, NPCs, encounters) swapped for
    the Pi's copy of it ('' when the Pi doesn't have it)."""
    if not text or 'Benjakronk/shima-pokedex' not in text:
        return text
    return re.sub(_REPO_IMAGE, lambda m: _local_repo_picture(m) or '', text)


def local_battle_animation_url(pokemon_name):
    """Self-uploaded "use move" battle animation for pokemon_name, if one
    exists in BATTLE_ANIMATION_DIR. Same sanitization/mtime-stamped-URL
    reasoning as local_sprite_url()/local_evolution_video_url()."""
    filename = f'{_sanitize_species_name(pokemon_name)}.mp4'
    path = os.path.join(BATTLE_ANIMATION_DIR, filename)
    if os.path.isfile(path):
        return f'/battle-animations/{filename}?t={int(os.path.getmtime(path))}'
    return None
