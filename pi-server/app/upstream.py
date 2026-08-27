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

import httpx

from .calculations import sanitize_string

POKEMON_DATA_URL = 'https://script.google.com/macros/s/AKfycbwIT3OS2bdCv2kkDPh6IjRRirv17iPnuttlPcY47LCHBbpNPuHF_IjVq0mCt7TkkWoW/exec?action=pokemon'
MOVE_DATA_URL = 'https://script.google.com/macros/s/AKfycbz5jkSQ1HuCpCrbg_mePsfLDaoesjCvrX_fCAhJvTC5V3IddYmtjVJnh4_2YaX37Dkj/exec?action=moves'
ITEMS_DATA_URL = 'https://script.google.com/macros/s/AKfycbwIT3OS2bdCv2kkDPh6IjRRirv17iPnuttlPcY47LCHBbpNPuHF_IjVq0mCt7TkkWoW/exec?action=items'
POKEDEX_CONFIG_URL = 'https://raw.githubusercontent.com/Benjakronk/shima-pokedex/main/pokedex_config.json'

IMG_BASE_URL = 'https://raw.githubusercontent.com/Benjakronk/shima-pokedex/main/images/pokemon/'
IMG_FORMATS = ['png', 'jpg', 'jpeg', 'jfif']

# User-uploaded animated sprites, local to the Pi -- unrelated to Benjakronk's
# repo/pipeline above. Named just <sanitized-species-name>.gif, no dex-id
# prefix. Checked live on every request (a plain filesystem stat, not a
# network probe), so no caching layer is needed here.
GIF_DIR = os.path.expanduser(os.environ.get('GIF_DIR', '~/pokemon-dnd/pokemon-gifs'))

# Every local_sprite_url() return value starts with this -- used elsewhere to
# recognize (and refuse to persist) a sprite URL that shouldn't have reached
# permanent storage. See routes_pokemon.py's register/update/evolve guards.
SPRITE_URL_PREFIX = '/gifs/'

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
    if not force:
        cached = _cache_get(conn, 'moves')
        if cached is not None:
            return cached
    data = _fetch_json(MOVE_DATA_URL)
    _cache_put(conn, 'moves', data)
    return data


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


def registered_pokemon_names(conn):
    config = fetch_pokedex_config(conn)
    return config.get('registered', []) if config else []


def warm_upstream(conn):
    """Force-refresh every snapshot; failures keep the previous data.

    The four sources are fetched in parallel (each on its own SQLite
    connection - connections aren't shareable across threads), so the wall
    time is the slowest upstream instead of the sum of all four. The passed
    conn is unused but kept so callers don't change."""
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

    fns = (fetch_pokemon_db, fetch_moves, fetch_items, fetch_pokedex_config)
    with ThreadPoolExecutor(max_workers=len(fns)) as pool:
        list(pool.map(refresh, fns))


def get_image_url(conn, pokemon_name, pokemon_id):
    """Port of getImageUrl: probe GitHub for the sprite in each format.
    Successful lookups are cached in SQLite so this stays fast."""
    padded = str(pokemon_id).zfill(3)
    import re
    sanitized = re.sub(r'^-+|-+$', '', re.sub(r'[^a-z0-9]+', '-', str(pokemon_name).lower()))
    base = f'{padded}-{sanitized}'

    row = conn.execute('SELECT url FROM image_cache WHERE key = ?', (base,)).fetchone()
    if row:
        return row[0]

    for fmt in IMG_FORMATS:
        url = f'{IMG_BASE_URL}{base}.{fmt}'
        try:
            resp = httpx.head(url, timeout=15, follow_redirects=True)
            if resp.status_code == 405:
                resp = httpx.get(url, timeout=15, follow_redirects=True)
            if resp.status_code == 200:
                conn.execute('INSERT OR REPLACE INTO image_cache (key, url) VALUES (?, ?)', (base, url))
                conn.commit()
                return url
        except Exception:
            continue
    return None


def local_sprite_url(pokemon_name, shiny=False):
    """Self-uploaded animated sprite for pokemon_name, if one exists in
    GIF_DIR (which despite the name now holds both .mp4 and .gif -- kept the
    directory/env var name to avoid any Pi-side path changes). Same
    sanitization as get_image_url() for one consistent filename rule across
    both, but otherwise unrelated -- no dex-id prefix, no Benjakronk repo,
    no network probe/cache.

    Checked in this order, so shiny-correctness always wins over format
    preference: shiny+mp4, shiny+gif, non-shiny mp4, non-shiny gif. MP4 has
    real video compression (much smaller, hardware-decoded on phones) vs
    GIF's per-pixel palette encoding, so it's preferred whenever both exist
    for a species -- verified with actual pixel data that these sprites
    carry no transparency, so MP4's lack of an alpha channel loses nothing
    here. Shiny uses a -shiny suffix, matching the convention Benjakronk's
    own shiny sprites already use elsewhere; falls back through to the
    non-shiny variant if no shiny file exists in either format."""
    sanitized = re.sub(r'^-+|-+$', '', re.sub(r'[^a-z0-9]+', '-', str(pokemon_name).lower()))
    candidates = []
    if shiny:
        candidates += [f'{sanitized}-shiny.mp4', f'{sanitized}-shiny.gif']
    candidates += [f'{sanitized}.mp4', f'{sanitized}.gif']
    for filename in candidates:
        if os.path.isfile(os.path.join(GIF_DIR, filename)):
            return f'{SPRITE_URL_PREFIX}{filename}'
    return None
