"""FastAPI entry point.

Speaks the same GET ?route=...&action=... contract as the Google Apps Script
deployment, and serves the PWA static files from the same origin. The only
frontend change needed is API_CONFIG.baseUrl in js/api.js.

Run locally:  uvicorn app.main:app --host 0.0.0.0 --port 8080
Env vars:     POKEDEX_DB (sqlite path), PWA_DIR (static files root)
"""
import asyncio
import hmac
import json
import os
import queue as queue_mod
from datetime import datetime, timezone

from fastapi import FastAPI, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import db, live, routes_pokemon, routes_trainer, routes_gamedata, routes_music, upstream

app = FastAPI(title='Pokemon DnD Trainer Tool API')

# POST is for /api/upstream-push, pushed cross-origin from Benjakronk's
# admin panel on benjakronk.github.io
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_methods=['GET', 'POST'],
    allow_headers=['*'],
    expose_headers=['X-Data-Version'],
)

db.init()


# Binary media: self-uploaded GIF sprites, Benjakronk splash mirror, and the
# bundled audio/images in PWA_DIR/assets (27MB of mp3s and pngs). These are
# large, rarely change, and are re-displayed constantly during normal use
# (every navigation back to a screen showing an owned Pokemon re-requests its
# sprite) -- no-store on these was forcing a full multi-MB re-download every
# single time, which is what was making self-uploaded GIFs stutter/re-buffer
# on every screen change instead of playing instantly from a local copy.
_CACHEABLE_MEDIA_PREFIXES = ('/gifs/', '/splashes/', '/assets/', '/evolution-videos/')


@app.middleware('http')
async def caching_policy(request: Request, call_next):
    """App code and API responses (HTML/JS/CSS, /api, /api/events) stay
    no-store -- these are small, change often, and must always be instantly
    fresh (see git history around this date: an earlier no-cache attempt
    still left a locally-stored copy sitting around for some browser/WebView
    to get revalidation wrong on, which is exactly the class of stale-PWA-
    cache bug that got the old service worker retired too).

    Binary media under _CACHEABLE_MEDIA_PREFIXES gets no-cache instead: the
    browser still asks the server on every load (so replacing a file is
    never stuck stale, same guarantee as no-store), but StaticFiles' existing
    Last-Modified/ETag means an unchanged file comes back as an empty 304
    instead of retransferring the full body -- keeping the "always eventually
    fresh, nothing to manually clear" property while fixing the re-buffering."""
    response = await call_next(request)
    path = request.url.path
    if path.startswith(_CACHEABLE_MEDIA_PREFIXES):
        response.headers['Cache-Control'] = 'no-cache'
    else:
        response.headers['Cache-Control'] = 'no-store'
    return response


def _data_version():
    """Newest upstream fetch time. Changes whenever the snapshots refresh
    (Reset Cache button or scripts/refresh_upstream.py), which tells clients
    to drop their locally cached static game data."""
    conn = db.connect()
    try:
        row = conn.execute('SELECT MAX(fetched_at) FROM upstream_cache').fetchone()
        return (row and row[0]) or 'none'
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
                    'pokemon': ['list', 'registered-list', 'get', 'register', 'update',
                                'evolution-options', 'party-status', 'utility-slot', 'live-stats'],
                    'trainer': ['list', 'get', 'create', 'update', 'inventory', 'gear',
                                'money', 'live-stats'],
                    'gameData': ['all', 'conduit', 'moves', 'natures',
                                 'type-effectiveness', 'pokedex-config'],
                    'battle': ['calculate-damage', 'roll-initiative'],
                    'music': ['sync', 'leave'],
                },
            }
        return {'error': 'Unknown route: ' + str(route), 'status': 'error'}
    finally:
        conn.close()


@app.get('/api')
@app.get('/exec')
def api(request: Request):
    params = dict(request.query_params)
    try:
        result = _dispatch(params)
    except Exception as e:
        # Same contract as the Apps Script doGet: HTTP 200 with an error payload
        result = {'error': str(e), 'status': 'error'}
    return JSONResponse(result, headers={'X-Data-Version': _data_version()})


@app.post('/api/upstream-push')
def push_upstream_dataset(payload: dict, x_push_key: str = Header(default='')):
    """Direct push from Benjakronk's admin panel: updates one of the four
    upstream snapshots (pokemon-db, moves, items, pokedex-config) immediately
    instead of waiting for the next pull. Guarded by a shared secret (env
    UPSTREAM_PUSH_KEY); disabled when the env var is unset."""
    expected = os.environ.get('UPSTREAM_PUSH_KEY', '')
    if not expected:
        return JSONResponse(
            {'status': 'error', 'error': 'push disabled: UPSTREAM_PUSH_KEY not set'},
            status_code=503)
    if not hmac.compare_digest(x_push_key, expected):
        return JSONResponse({'status': 'error', 'error': 'invalid push key'},
                            status_code=403)
    dataset = payload.get('dataset')
    conn = db.connect()
    try:
        upstream.store_pushed_dataset(conn, dataset, payload.get('data'))
    except ValueError as e:
        return JSONResponse({'status': 'error', 'error': str(e)}, status_code=400)
    finally:
        conn.close()
    version = _data_version()
    live.publish({'dataset': dataset, 'version': version})
    return JSONResponse({'status': 'success', 'message': f'{dataset} stored'},
                        headers={'X-Data-Version': version})


@app.get('/api/events')
async def live_events(request: Request):
    """Server-Sent Events stream: notifies connected devices the instant
    push_upstream_dataset() above lands a new Pokedex push, instead of
    waiting for the next Reload Data / login. One connection per device,
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


# Local mirror of Benjakronk's splash images (daily git pull on the Pi);
# mounted before the PWA catch-all so /splashes wins
if os.path.isdir(routes_gamedata.SPLASH_DIR):
    app.mount('/splashes', StaticFiles(directory=routes_gamedata.SPLASH_DIR),
              name='splashes')

# Self-uploaded animated sprites, mp4 or gif (see upstream.SPRITE_DIR /
# upstream.local_sprite_url). URL prefix stays /gifs -- see
# upstream.SPRITE_URL_PREFIX for why that's not renamed along with the folder.
if os.path.isdir(upstream.SPRITE_DIR):
    app.mount('/gifs', StaticFiles(directory=upstream.SPRITE_DIR), name='gifs')

# Self-uploaded evolution transition videos (see upstream.EVOLUTION_VIDEO_DIR /
# upstream.local_evolution_video_url)
if os.path.isdir(upstream.EVOLUTION_VIDEO_DIR):
    app.mount('/evolution-videos', StaticFiles(directory=upstream.EVOLUTION_VIDEO_DIR),
              name='evolution-videos')

# Serve the PWA from the same origin (mounted last so /api and /exec win)
_default_pwa = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
PWA_DIR = os.environ.get('PWA_DIR', _default_pwa)
if os.path.isfile(os.path.join(PWA_DIR, 'index.html')):
    app.mount('/', StaticFiles(directory=PWA_DIR, html=True), name='pwa')
