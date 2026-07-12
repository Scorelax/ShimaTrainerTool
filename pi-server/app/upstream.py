"""Snapshots of Benjakronk's external data sources, stored in SQLite.

The Apps Script version fetched these live with a 6h CacheService TTL. Here
they persist until explicitly refreshed — the Reset Cache button in the app
(game-data/clear-cache) or scripts/refresh_upstream.py re-fetches them.
A failed fetch keeps the previous snapshot.
"""
import json
from datetime import datetime, timezone

import httpx

from .calculations import sanitize_string

POKEMON_DATA_URL = 'https://script.google.com/macros/s/AKfycbwIT3OS2bdCv2kkDPh6IjRRirv17iPnuttlPcY47LCHBbpNPuHF_IjVq0mCt7TkkWoW/exec?action=pokemon'
MOVE_DATA_URL = 'https://script.google.com/macros/s/AKfycbz5jkSQ1HuCpCrbg_mePsfLDaoesjCvrX_fCAhJvTC5V3IddYmtjVJnh4_2YaX37Dkj/exec?action=moves'
ITEMS_DATA_URL = 'https://script.google.com/macros/s/AKfycbwIT3OS2bdCv2kkDPh6IjRRirv17iPnuttlPcY47LCHBbpNPuHF_IjVq0mCt7TkkWoW/exec?action=items'
POKEDEX_CONFIG_URL = 'https://raw.githubusercontent.com/Benjakronk/shima-pokedex/main/pokedex_config.json'

IMG_BASE_URL = 'https://raw.githubusercontent.com/Benjakronk/shima-pokedex/main/images/'
IMG_FORMATS = ['png', 'jpg', 'jpeg', 'jfif']

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
