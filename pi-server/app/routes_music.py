"""route=music — cross-device background music sync anchors.

Deliberately a separate table from upstream_cache: that table's writes bump
fetched_at, which drives the X-Data-Version header and wipes every client's
localStorage game-data cache on change. A music-sync request has nothing to
do with game data and must never trigger that.

Presence is tracked per listening device (music_listeners), not as a single
running counter -- a plain increment/decrement counter drifts upward every
time a client reloads or crashes without its "leave" beacon completing (the
common case during testing, and not rare in real use either), since there's
no way to tell a missed decrement from a room that's genuinely still
occupied. Instead each client sends a heartbeat while it's listening; a
listener who hasn't been heard from in STALE_AFTER_SECONDS is treated as
gone, so a dropped leave signal self-heals within one stale window instead
of permanently inflating the count.
"""
from datetime import datetime, timedelta, timezone

STALE_AFTER_SECONDS = 40


def handle(conn, action, params):
    track = params.get('track')
    client_id = params.get('client')
    if not track:
        raise ValueError('Missing track')

    if action == 'sync':
        if not client_id:
            raise ValueError('Missing client')
        now = datetime.now(timezone.utc)
        return {
            'status': 'success',
            'startedAt': _join(conn, track, client_id, now),
            'serverNow': now.isoformat(),
        }

    if action == 'leave':
        if client_id:
            conn.execute(
                'DELETE FROM music_listeners WHERE track = ? AND client_id = ?', (track, client_id))
            conn.commit()
        return {'status': 'success'}

    raise ValueError('Unknown music action: ' + str(action))


def _join(conn, track, client_id, now):
    now_iso = now.isoformat()
    cutoff = (now - timedelta(seconds=STALE_AFTER_SECONDS)).isoformat()

    # Prune anyone (any track) not heard from recently -- self-heals missed
    # leave signals without needing perfect client-side cleanup.
    conn.execute('DELETE FROM music_listeners WHERE last_seen <= ?', (cutoff,))

    self_row = conn.execute(
        'SELECT 1 FROM music_listeners WHERE track = ? AND client_id = ?',
        (track, client_id)).fetchone()

    if self_row:
        # Heartbeat renewal from an already-known listener -- never touch the epoch.
        conn.execute(
            'UPDATE music_listeners SET last_seen = ? WHERE track = ? AND client_id = ?',
            (now_iso, track, client_id))
        row = conn.execute('SELECT started_at FROM music_sync WHERE track = ?', (track,)).fetchone()
        conn.commit()
        return row[0] if row else _reset_epoch(conn, track, now_iso)

    others_live = conn.execute(
        'SELECT 1 FROM music_listeners WHERE track = ? AND client_id != ? LIMIT 1',
        (track, client_id)).fetchone()  # whatever's left after pruning is, by definition, live

    conn.execute(
        'INSERT INTO music_listeners (track, client_id, last_seen) VALUES (?, ?, ?)',
        (track, client_id, now_iso))

    if others_live:
        row = conn.execute('SELECT started_at FROM music_sync WHERE track = ?', (track,)).fetchone()
        conn.commit()
        return row[0]

    return _reset_epoch(conn, track, now_iso)


def _reset_epoch(conn, track, started_at):
    conn.execute(
        'INSERT INTO music_sync (track, started_at) VALUES (?, ?) '
        'ON CONFLICT(track) DO UPDATE SET started_at = excluded.started_at',
        (track, started_at))
    conn.commit()
    return started_at
