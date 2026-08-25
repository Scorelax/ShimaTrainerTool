"""route=music — cross-device background music sync anchors.

Deliberately a separate table from upstream_cache: that table's writes bump
fetched_at, which drives the X-Data-Version header and wipes every client's
localStorage game-data cache on change. A music-sync request has nothing to
do with game data and must never trigger that.
"""
from datetime import datetime, timezone


def handle(conn, action, params):
    if action == 'sync':
        track = params.get('track')
        if not track:
            raise ValueError('Missing track')
        return {'status': 'success', 'startedAt': _get_or_start(conn, track)}

    raise ValueError('Unknown music action: ' + str(action))


def _get_or_start(conn, track):
    row = conn.execute('SELECT started_at FROM music_sync WHERE track = ?', (track,)).fetchone()
    if row:
        return row[0]
    started_at = datetime.now(timezone.utc).isoformat()
    conn.execute('INSERT INTO music_sync (track, started_at) VALUES (?, ?)', (track, started_at))
    conn.commit()
    return started_at
