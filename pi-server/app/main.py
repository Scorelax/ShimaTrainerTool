"""FastAPI entry point.

Speaks the same GET ?route=...&action=... contract as the Google Apps Script
deployment, and serves the PWA static files from the same origin. The only
frontend change needed is API_CONFIG.baseUrl in js/api.js.

Run locally:  uvicorn app.main:app --host 0.0.0.0 --port 8080
Env vars:     POKEDEX_DB (sqlite path), PWA_DIR (static files root)
"""
import os
from datetime import datetime, timezone

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import db, routes_pokemon, routes_trainer, routes_gamedata

app = FastAPI(title='Pokemon DnD Trainer Tool API')

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_methods=['GET'],
    allow_headers=['*'],
)

db.init()


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
    return JSONResponse(result)


# Serve the PWA from the same origin (mounted last so /api and /exec win)
_default_pwa = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
PWA_DIR = os.environ.get('PWA_DIR', _default_pwa)
if os.path.isfile(os.path.join(PWA_DIR, 'index.html')):
    app.mount('/', StaticFiles(directory=PWA_DIR, html=True), name='pwa')
