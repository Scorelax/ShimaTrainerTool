"""route=music — cross-device background music sync anchors.

Deliberately a separate table from upstream_cache: that table's writes bump
fetched_at, which drives the X-Data-Version header and wipes every client's
localStorage game-data cache on change. A music-sync request has nothing to
do with game data and must never trigger that.

Tracks a listener count per track so the loop restarts from 0 the next time
someone joins an empty room, rather than a client joining a track nobody's
listened to in hours picking up wherever a stale anchor left off. This is a
best-effort presence count (a client's "leave" beacon can be lost if its
browser/tab dies uncleanly) -- acceptable for a small at-the-table app; it
just means the count can occasionally overcount until the next full reset.
"""
from datetime import datetime, timezone


def handle(conn, action, params):
    track = params.get('track')
    if not track:
        raise ValueError('Missing track')

    if action == 'sync':
        return {'status': 'success', 'startedAt': _join(conn, track)}

    if action == 'leave':
        _leave(conn, track)
        return {'status': 'success'}

    raise ValueError('Unknown music action: ' + str(action))


def _join(conn, track):
    row = conn.execute(
        'SELECT started_at, listeners FROM music_sync WHERE track = ?', (track,)).fetchone()

    if row and row[1] > 0:
        conn.execute(
            'UPDATE music_sync SET listeners = listeners + 1 WHERE track = ?', (track,))
        conn.commit()
        return row[0]

    # Empty room (or never-seen track): fresh epoch, first listener.
    started_at = datetime.now(timezone.utc).isoformat()
    conn.execute(
        'INSERT INTO music_sync (track, started_at, listeners) VALUES (?, ?, 1) '
        'ON CONFLICT(track) DO UPDATE SET started_at = excluded.started_at, listeners = 1',
        (track, started_at))
    conn.commit()
    return started_at


def _leave(conn, track):
    conn.execute(
        'UPDATE music_sync SET listeners = MAX(listeners - 1, 0) WHERE track = ?', (track,))
    conn.commit()
