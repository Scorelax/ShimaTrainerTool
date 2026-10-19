"""FastAPI entry point.

The app's API (GET /api?route=...&action=..., plus the POST endpoints below), and the PWA's static files from the same
origin -- js/api.js always talks to the server that serves it.

Run locally:  uvicorn app.main:app --host 0.0.0.0 --port 8080
Env vars:     POKEDEX_DB (sqlite path), PWA_DIR (static files root)
"""
import asyncio
import json
import mimetypes
import os
import queue as queue_mod
from datetime import datetime, timezone

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import admin, db, gamedata, live, media, routes_pokemon, routes_trainer, routes_gamedata, routes_music, routes_combat, routes_dm, species, sprite_previews

app = FastAPI(title='Pokemon DnD Trainer Tool API')

db.init()


# Binary media: self-uploaded MP4 sprites, evolution videos, the splashes,
# and the bundled audio/images in PWA_DIR/assets (27MB of mp3s
# and pngs). These are large, rarely change, and are re-displayed constantly
# during normal use (every navigation back to a screen showing an owned
# Pokemon re-requests its sprite) -- no-store on these was forcing a full
# multi-MB re-download every single time, which is what was making
# self-uploaded sprites stutter/re-buffer on every screen change instead of
# playing instantly from a local copy.
#
# Sprites and evolution videos are cached *hard* (no per-load network
# round-trip at all): media.local_sprite_url/local_evolution_video_url
# stamp a `?t=<mtime>` onto the URL itself, so a replaced file gets a brand
# new URL automatically -- nothing for the browser to revalidate, nothing to
# ever go stale, nothing to manually clear.
_VERSIONED_MEDIA_PREFIXES = ('/gifs/', '/evolution-videos/', media.CHARACTER_IMAGE_URL_PREFIX,
                             media.DISPLAY_IMAGE_URL_PREFIX, media.POKEMON_IMAGE_URL_PREFIX,
                             media.NPC_IMAGE_URL_PREFIX, sprite_previews.SPRITE_PREVIEW_URL_PREFIX)

# The splashes, badges and the bundled PWA assets aren't stamped with a
# version (their filenames stay constant even when the content behind them
# changes), so they can't be cached hard the same way -- they keep
# revalidating every load instead, same as before.
_REVALIDATED_MEDIA_PREFIXES = (media.SPLASH_URL_PREFIX, media.BADGE_URL_PREFIX, '/assets/', '/battle-images/')


@app.middleware('http')
async def caching_policy(request: Request, call_next):
    """App code and API responses (HTML/JS/CSS, /api, /api/events) stay
    no-store -- these are small, change often, and must always be instantly
    fresh (see git history around this date: an earlier no-cache attempt
    still left a locally-stored copy sitting around for some browser/WebView
    to get revalidation wrong on, which is exactly the class of stale-PWA-
    cache bug that got the old service worker retired too).

    Binary media under _VERSIONED_MEDIA_PREFIXES gets a long, immutable
    max-age -- safe because the URL itself changes whenever the file does, so
    there's no staleness risk to guard against with revalidation. Media under
    _REVALIDATED_MEDIA_PREFIXES keeps the old no-cache behavior: the browser
    still asks the server on every load (so replacing a file is never stuck
    stale), but StaticFiles' existing Last-Modified/ETag means an unchanged
    file comes back as an empty 304 instead of retransferring the full body."""
    response = await call_next(request)
    path = request.url.path
    if path.startswith(_VERSIONED_MEDIA_PREFIXES) and response.status_code in (200, 206, 304):
        response.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
    elif path.startswith(_REVALIDATED_MEDIA_PREFIXES):
        response.headers['Cache-Control'] = 'no-cache'
    else:
        response.headers['Cache-Control'] = 'no-store'
    return response


def _data_version():
    """gamedata.data_version (the Pokedex settings' last save, every data file's last change), plus the species files
    and the species / item pictures folders (a picture added shows on every device without waiting) -- whenever it
    changes, the devices drop the game data they keep."""
    conn = db.connect()
    try:
        return gamedata.data_version(conn, (species.SPECIES_FILE, species.ABILITIES_FILE, species.OVERLAY_FILE,
                                            species.ABILITY_OVERLAY_FILE, media.POKEMON_IMAGE_DIR, media.ITEM_IMAGE_DIR))
    finally:
        conn.close()


def _dispatch(params):
    route = params.get('route', 'error')
    action = params.get('action', 'list')
    conn = db.connect()
    try:
        if route == 'pokemon':
            return routes_pokemon.handle(conn, action, params)
        if route == 'trainer':
            return routes_trainer.handle(conn, action, params)
        if route == 'game-data':
            return routes_gamedata.handle(conn, action, params)
        if route == 'music':
            return routes_music.handle(conn, action, params)
        if route == 'combat':
            return routes_combat.handle(conn, action, params)
        if route == 'dm':
            return routes_dm.handle(conn, action, params)
        if route == 'battle':
            if action in ('calculate-damage', 'roll-initiative'):
                return {'status': 'not_implemented'}
            raise ValueError('Unknown battle action: ' + str(action))
        if route == 'test':
            return {
                'status': 'success',
                'message': 'API is working!',
                'timestamp': datetime.now(timezone.utc).isoformat(),
                'endpoints': {
                    'pokemon': ['list', 'registered-list', 'get', 'register', 'update', 'delete',
                                'evolution-options', 'party-status', 'utility-slot', 'live-stats'],
                    'trainer': ['list', 'get', 'get-full', 'create', 'update', 'money', 'affinity',
                                'specialization', 'live-stats'],
                    'gameData': ['all', 'conduit', 'moves', 'natures',
                                 'type-effectiveness', 'pokedex-config', 'player-pokedex',
                                 'splash-list'],
                    'battle': ['calculate-damage', 'roll-initiative'],
                    'music': ['sync', 'leave'],
                    'combat': ['get-state', 'create-session', 'end-session', 'leave-session', 'add-participant',
                               'remove-participant', 'set-status', 'set-visibility',
                               'advance-turn', 'reaction-start', 'use-bonus-action', 'disengage', 'hold-action', 'use-held-action', 'rapid-orders', 'rotate-token', 'clear-terrain-zones', 'remove-field-zone', 'trick-room', 'resolve-hazard', 'grant-extra-turn', 'quash', 'switch-pokemon', 'cancel-pending-switch', 'queue-switch-heal', 'reaction-end', 'play-animation',
                               'use-move', 'apply-damage', 'update-stats', 'set-board-template', 'set-cell-terrain',
                               'set-token-position', 'move-token', 'adventure-settings', 'set-catchable', 'clear-token-position',
                               'confirm-placement', 'hover-token', 'list-backgrounds', 'set-board-background'],
                },
            }
        return {'error': 'Unknown route: ' + str(route), 'status': 'error'}
    finally:
        conn.close()


@app.get('/api')
def api(request: Request):
    params = dict(request.query_params)
    try:
        result = _dispatch(params)
    except Exception as e:
        # HTTP 200 with an error payload -- every caller reads `status`
        result = {'error': str(e), 'status': 'error'}
    return JSONResponse(result, headers={'X-Data-Version': _data_version()})


@app.post('/api/dm/setup')
def save_dm_setup(payload: dict):
    """The DM console's battle setup (map + creatures, see routes_dm.py) -- a POST body rather than the usual GET
    query string, since a setup with a handful of full stat blocks is far longer than a URL should be."""
    conn = db.connect()
    try:
        routes_dm.save_setup(conn, payload.get('setup'))
    except ValueError as e:
        return JSONResponse({'status': 'error', 'error': str(e)})
    finally:
        conn.close()
    return JSONResponse({'status': 'success'})


@app.post('/api/dm/clock')
def save_dm_clock(payload: dict):
    """The DM console's world clock (routes_dm.save_clock), pushed to every open DM console so they stay in step."""
    conn = db.connect()
    try:
        routes_dm.save_clock(conn, payload.get('clock'))
    except ValueError as e:
        return JSONResponse({'status': 'error', 'error': str(e)})
    finally:
        conn.close()
    live.publish({'type': 'dm-clock', 'clock': payload.get('clock')})
    return JSONResponse({'status': 'success'})


@app.post('/api/dm/npc')
def save_dm_npc(payload: dict):
    """One NPC from the DM console's NPC library (routes_dm.save_npc) -- a POST, since a full NPC with a team and a
    backstory is far longer than a query string."""
    conn = db.connect()
    try:
        npc = routes_dm.save_npc(conn, payload.get('npc'))
    except ValueError as e:
        return JSONResponse({'status': 'error', 'error': str(e)})
    finally:
        conn.close()
    live.publish({'type': 'dm-npcs', 'id': npc['id']})
    return JSONResponse({'status': 'success', 'data': npc})


@app.post('/api/dm/encounter')
def save_dm_encounter(payload: dict):
    """One encounter from the DM console's encounter library (routes_dm.save_encounter)."""
    conn = db.connect()
    try:
        encounter = routes_dm.save_encounter(conn, payload.get('encounter'))
    except ValueError as e:
        return JSONResponse({'status': 'error', 'error': str(e)})
    finally:
        conn.close()
    return JSONResponse({'status': 'success', 'data': encounter})


@app.post('/api/dm/state')
def save_dm_state(payload: dict):
    """One of the DM console's small records (routes_dm._STATE_KEYS), stored whole."""
    conn = db.connect()
    try:
        routes_dm.save_state(conn, payload.get('key'), payload.get('data'))
    except ValueError as e:
        return JSONResponse({'status': 'error', 'error': str(e)})
    finally:
        conn.close()
    return JSONResponse({'status': 'success'})


@app.post('/api/dm/give-pokemon')
def dm_give_pokemon(payload: dict):
    """The aftermath: a caught Pokemon straight into a trainer's team (routes_dm.give_pokemon)."""
    conn = db.connect()
    try:
        result = routes_dm.give_pokemon(conn, payload.get('trainer'), payload.get('pokemon') or {})
    except ValueError as e:
        return JSONResponse({'status': 'error', 'error': str(e)})
    finally:
        conn.close()
    return JSONResponse(result)


@app.post('/api/dm/xp')
def dm_change_xp(payload: dict):
    """XP only the DM sees, given / taken / set on trainers and their Pokemon (routes_dm.change_xp)."""
    conn = db.connect()
    try:
        result = routes_dm.change_xp(conn, payload.get('changes'))
    except ValueError as e:
        return JSONResponse({'status': 'error', 'error': str(e)})
    finally:
        conn.close()
    return JSONResponse({'status': 'success', 'data': result})


@app.post('/api/dm/display-scene')
def dm_save_display_scene(payload: dict):
    """What the table TV shows -- a background and pictures (routes_dm.save_display_scene), pushed to the TV at once."""
    conn = db.connect()
    try:
        routes_dm.save_display_scene(conn, payload.get('scene'))
    except ValueError as e:
        return JSONResponse({'status': 'error', 'error': str(e)})
    finally:
        conn.close()
    return JSONResponse({'status': 'success'})


@app.post('/api/dm/pokemon-image')
def dm_save_pokemon_image(payload: dict):
    """A picture for a species without one, uploaded from the DM console's Pokedex (routes_dm.save_pokemon_image)."""
    conn = db.connect()
    try:
        data = routes_dm.save_pokemon_image(conn, payload)
    except ValueError as e:
        return JSONResponse({'status': 'error', 'error': str(e)})
    finally:
        conn.close()
    return JSONResponse({'status': 'success', 'data': data})


def _admin(fn):
    """A DM console Admin module request (admin.py): its answer as data, a refusal as {status: error, error}."""
    try:
        data = fn()
    except ValueError as e:
        return JSONResponse({'status': 'error', 'error': str(e)})
    return JSONResponse({'status': 'success', 'data': data})


@app.post('/api/dm/admin-item')
def dm_admin_item(payload: dict):
    """An item added or edited ({item, isNew})."""
    return _admin(lambda: admin.save_item(payload.get('item'), bool(payload.get('isNew'))))


@app.post('/api/dm/admin-item-image')
def dm_admin_item_image(payload: dict):
    """An item's picture ({name, data: "data:image/...;base64,..."}), saved as "<Item Name>.<ext>"."""
    return _admin(lambda: admin.save_item_image(payload.get('name'), payload.get('data')))


@app.post('/api/dm/admin-species')
def dm_admin_species(payload: dict):
    """A Pokedex entry added or edited ({species, isNew, abilityDescriptions})."""
    return _admin(lambda: admin.save_species(payload.get('species'), bool(payload.get('isNew')),
                                             payload.get('abilityDescriptions')))


@app.post('/api/dm/admin-pokemon-image')
def dm_admin_pokemon_image(payload: dict):
    """A species' still picture or animated sprite ({species, kind: 'still' | 'animated', shiny, data})."""
    return _admin(lambda: admin.save_pokemon_picture(payload.get('species'), payload.get('kind'), payload.get('data'),
                                                     bool(payload.get('shiny'))))


@app.post('/api/dm/admin-splash')
def dm_admin_splash(payload: dict):
    """A loading-screen splash: a new one, or in place of `replace` ({data, replace})."""
    return _admin(lambda: admin.save_splash(payload.get('data'), payload.get('replace') or None))


@app.post('/api/dm/admin-splash-delete')
def dm_admin_splash_delete(payload: dict):
    return _admin(lambda: admin.delete_splash(payload.get('file')))


@app.post('/api/dm/npc-image')
def dm_save_npc_image(payload: dict):
    """A picture for an NPC uploaded from the DM's computer, into the NPC pictures folder (routes_dm.save_npc_image)."""
    try:
        img = routes_dm.save_npc_image(payload)
    except ValueError as e:
        return JSONResponse({'status': 'error', 'error': str(e)})
    return JSONResponse({'status': 'success', 'data': img})


@app.post('/api/dm/board-map')
def dm_set_board_map(payload: dict):
    """The DM's mid-battle map edits -- objects and difficult / blocked squares (routes_combat.dm_set_board_map)."""
    conn = db.connect()
    try:
        result = routes_combat.dm_set_board_map(conn, payload.get('objects'), payload.get('marks'), payload.get('traps'))
    except ValueError as e:
        return JSONResponse({'status': 'error', 'error': str(e)})
    finally:
        conn.close()
    return JSONResponse({'status': 'success', 'data': result.get('data') if isinstance(result, dict) else None})


@app.post('/api/dm/battle-background')
def dm_save_battle_background(payload: dict):
    """A battle-map background uploaded from the DM console's Map setup (routes_dm.save_battle_background)."""
    try:
        bg = routes_dm.save_battle_background(payload)
    except ValueError as e:
        return JSONResponse({'status': 'error', 'error': str(e)})
    return JSONResponse({'status': 'success', 'data': bg})


@app.post('/api/dm/battle-image')
def dm_save_battle_image(payload: dict):
    """A battle-map picture uploaded from the DM console -- an object (object-<name>.png) or a background
    (battle-<name>.<ext>) -- routes_dm.save_battle_image."""
    try:
        img = routes_dm.save_battle_image(payload)
    except ValueError as e:
        return JSONResponse({'status': 'error', 'error': str(e)})
    return JSONResponse({'status': 'success', 'data': img})


@app.post('/api/dm/battle-image-delete')
def dm_delete_battle_image(payload: dict):
    """Deletes an uploaded battle-map object or background picture (routes_dm.delete_battle_image)."""
    try:
        routes_dm.delete_battle_image(payload.get('url'))
    except ValueError as e:
        return JSONResponse({'status': 'error', 'error': str(e)})
    return JSONResponse({'status': 'success'})


@app.post('/api/dm/region-map-view')
def dm_save_region_map_view(payload: dict):
    """Where the region map on the board screen is looking (routes_dm.save_region_map_view), pushed to it at once and
    stored when `save` isn't false."""
    conn = db.connect()
    try:
        routes_dm.save_region_map_view(conn, payload.get('view'), store=payload.get('save', True) is not False)
    except ValueError as e:
        return JSONResponse({'status': 'error', 'error': str(e)})
    finally:
        conn.close()
    return JSONResponse({'status': 'success'})


@app.post('/api/dm/display-image')
def dm_save_display_image(payload: dict):
    """A picture uploaded from the DM's computer for the table TV, or a new name for one (routes_dm.save_display_image)."""
    conn = db.connect()
    try:
        img = routes_dm.save_display_image(conn, payload)
    except ValueError as e:
        return JSONResponse({'status': 'error', 'error': str(e)})
    finally:
        conn.close()
    return JSONResponse({'status': 'success', 'data': img})


@app.post('/api/dm/pokedex-config')
def save_dm_pokedex_config(payload: dict):
    """The DM console's Pokedex module: what the players may see of each species (pokedexConfig -- registered,
    visibility, defaults), pushed live so open devices pick it up at once."""
    conn = db.connect()
    try:
        gamedata.store_pokedex_config(conn, payload.get('config'))
    except ValueError as e:
        return JSONResponse({'status': 'error', 'error': str(e)})
    finally:
        conn.close()
    version = _data_version()
    live.publish({'type': 'pokedex-config', 'version': version})
    return JSONResponse({'status': 'success'}, headers={'X-Data-Version': version})


@app.get('/api/events')
async def live_events(request: Request):
    """Server-Sent Events stream: tells connected devices the instant
    something they show changes (the Pokedex settings, a trainer's data, the
    battle, the DM console's records) instead of waiting for the next Reload
    Data / login. One connection per device,
    opened once at app startup (see js/utils/live-updates.js) and reused for
    the whole session -- the frontend is a real SPA, not page-by-page
    navigation, so this doesn't need to reconnect between screens."""
    q = live.subscribe()

    async def event_stream():
        try:
            yield ': connected\n\n'
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.to_thread(q.get, timeout=15)
                    yield f'data: {json.dumps(event)}\n\n'
                except queue_mod.Empty:
                    yield ': keepalive\n\n'
        finally:
            live.unsubscribe(q)

    return StreamingResponse(event_stream(), media_type='text/event-stream')


# The pictures on the Pi (see media.py): species, NPCs, badges and splashes. The folders are
# made here if they aren't there yet, so files copied in later show up without a restart. Mounted before the PWA
# catch-all so these paths win. Many species pictures are .jfif, which Python doesn't know as a JPEG -- without this
# they'd be sent as plain text.
mimetypes.add_type('image/jpeg', '.jfif')
for _folder, _prefix, _name in ((media.POKEMON_IMAGE_DIR, media.POKEMON_IMAGE_URL_PREFIX, 'pokemon-images'),
                                (media.NPC_IMAGE_DIR, media.NPC_IMAGE_URL_PREFIX, 'npc-images'),
                                (media.ITEM_IMAGE_DIR, media.ITEM_IMAGE_URL_PREFIX, 'item-images'),
                                (media.BADGE_DIR, media.BADGE_URL_PREFIX, 'badges'),
                                (media.SPLASH_DIR, media.SPLASH_URL_PREFIX, 'splashes')):
    os.makedirs(_folder, exist_ok=True)
    app.mount(_prefix.rstrip('/'), StaticFiles(directory=_folder), name=_name)

# Small copies of the animated sprites (see sprite_previews.py) -- the original until the copy is made (not cached, so
# the next load gets the copy). Every missing copy starts being made now, in the background.
@app.get(sprite_previews.SPRITE_PREVIEW_URL_PREFIX + '{filename}')
def sprite_preview(filename: str):
    try:
        path = sprite_previews.preview_file(filename)
    except FileNotFoundError:
        return Response(status_code=404)
    if path:
        return FileResponse(path, media_type='video/mp4')
    return RedirectResponse(sprite_previews.original_url(filename), status_code=307)


sprite_previews.queue_missing()

# Self-uploaded animated sprites, mp4 only (see media.SPRITE_DIR /
# media.local_sprite_url). URL prefix stays /gifs -- see
# media.SPRITE_URL_PREFIX for why that's not renamed along with the folder.
# Made here if it isn't there yet: the DM console's Admin module can upload the first one (a mount needs the folder).
os.makedirs(media.SPRITE_DIR, exist_ok=True)
app.mount('/gifs', StaticFiles(directory=media.SPRITE_DIR), name='gifs')

# Self-uploaded evolution transition videos (see media.EVOLUTION_VIDEO_DIR /
# media.local_evolution_video_url)
if os.path.isdir(media.EVOLUTION_VIDEO_DIR):
    app.mount('/evolution-videos', StaticFiles(directory=media.EVOLUTION_VIDEO_DIR),
              name='evolution-videos')

# Self-uploaded Pokemon cries (see media.CRY_DIR)
if os.path.isdir(media.CRY_DIR):
    app.mount('/cries', StaticFiles(directory=media.CRY_DIR), name='cries')

# Self-uploaded "use move" battle animations (see media.BATTLE_ANIMATION_DIR /
# media.local_battle_animation_url)
if os.path.isdir(media.BATTLE_ANIMATION_DIR):
    app.mount('/battle-animations', StaticFiles(directory=media.BATTLE_ANIMATION_DIR),
              name='battle-animations')

# Self-made trainer portraits (see media.CHARACTER_IMAGE_DIR / media.local_character_image_url)
if os.path.isdir(media.CHARACTER_IMAGE_DIR):
    app.mount(media.CHARACTER_IMAGE_URL_PREFIX.rstrip('/'), StaticFiles(directory=media.CHARACTER_IMAGE_DIR),
              name='character-images')

# Battle-map background images (see media.BATTLE_IMAGE_DIR / routes_combat.py's list-backgrounds)
if os.path.isdir(media.BATTLE_IMAGE_DIR):
    app.mount('/battle-images', StaticFiles(directory=media.BATTLE_IMAGE_DIR),
              name='battle-images')

# Pictures the DM uploads for the table TV (see media.DISPLAY_IMAGE_DIR) -- made here if it isn't there yet, since the
# first upload comes after startup and a mount needs the folder to exist.
os.makedirs(media.DISPLAY_IMAGE_DIR, exist_ok=True)
app.mount(media.DISPLAY_IMAGE_URL_PREFIX.rstrip('/'), StaticFiles(directory=media.DISPLAY_IMAGE_DIR),
          name='display-images')

# Serve the PWA from the same origin (mounted last so /api wins)
_default_pwa = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
PWA_DIR = os.environ.get('PWA_DIR', _default_pwa)
if os.path.isfile(os.path.join(PWA_DIR, 'index.html')):
    app.mount('/', StaticFiles(directory=PWA_DIR, html=True), name='pwa')
