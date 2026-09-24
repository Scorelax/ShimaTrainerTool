"""route=combat -- the shared multiplayer combat session.

One active session at a time, matching the rest of this app's "single shared
state" model (see the one shared pokedex in upstream.py) -- this is a
tabletop group playing together, not a matchmaking service. State is stored
as a single JSON blob in the combat_session table (see db.py) and re-read
fresh on every action rather than cached in memory, same as everywhere else
in this codebase -- simple to reason about, and nowhere near a performance
concern at tabletop-combat request volume.

Every mutation re-publishes the *whole* session over the existing SSE
channel (live.py) rather than a delta -- sessions are small (a handful of
combatants), so broadcasting the full state avoids an entire class of
client-side patching bugs for negligible bandwidth cost.

use-move deliberately only covers the generic mechanic every move shares
(spend VP, optionally hit a target with a dice roll converted to damage via
type effectiveness) -- it is NOT a port of combat.js's per-move rules engine
(Ingrain healing, Stockpile/Spit Up stacks, recharge tracking, etc.). Those
stay in the legacy single-player combat page's client-side state for now;
porting each one here is future work, not part of this session/turn-order
plumbing.

This game has no digital dice -- every roll happens at the table. So the
client only ever sends the *raw roll result* (diceRoll) for a damage move;
the server converts that to actual damage using the move's type (from the
moves dataset) and the target's stored type(s), the same type-chart data
game-data/type-effectiveness already exposes.
"""
import json
import os
import re
import uuid
from datetime import datetime, timezone

from . import db, live, routes_gamedata, upstream
from .jsutil import js_parse_int

# Same os.environ-overridable, ~-expanded convention as upstream.py's other
# *_DIR constants (SPRITE_DIR, BATTLE_ANIMATION_DIR, ...). One file per
# battle session (see _new_log_filename), written incrementally as events
# happen so a crash mid-battle still leaves whatever was logged up to that
# point on disk -- not just written once at the end. Cleanup (deleting old
# logs) is left to the user's own cron job on the Pi, not this app.
BATTLE_LOG_DIR = os.path.expanduser(os.environ.get('BATTLE_LOG_DIR', '~/pokemon-dnd/battle-logs'))

_EMPTY_STATE = {
    'active': False,
    'battleType': None,
    'round': 0,
    'turnIndex': 0,
    'turnOrder': [],
    # Flips true on the first advance-turn. Before that, _rebuild_turn_order
    # never anchors a "current" participant -- while people are still
    # joining (each rolling initiative independently), there is no real
    # turn in progress yet, so a newly-sorted-in higher roll should be free
    # to land at the top rather than the system clinging to whoever
    # happened to occupy index 0 before the roster was even final.
    'started': False,
    'reactingParticipantId': None,
    # A live "does anyone want to react?" window (see _open_reaction_window and
    # move-effects-schema.md's own reaction section) -- None when closed. While
    # open: {id, trigger:'targeted'|'damaged', anchorId, attackerId, moveName,
    # expiresAt (epoch ms), eligible: {participantId: {moves:[name,...],
    # responded: bool}}}. Separate from reactingParticipantId -- this is "who
    # COULD react and hasn't answered yet", that's "who currently HAS the floor
    # because they said yes" (reaction-start/-end, unchanged, just now also
    # ticking this window's bookkeeping when it's open).
    'pendingReaction': None,
    # Set by block-pending-attack (see _block_pending_attack) when a reactor's
    # own move applies a `block_attack` effect (Protect, King's Shield, ...) --
    # {windowId, anchorId, attackerId, blockerId, blockerName}, or None. Never
    # cleared automatically (a stale one is harmless: `windowId` only ever
    # matches the ONE reaction window it was set during, see
    # reaction-window.js's own waitForReactionWindow, which is what actually
    # reads this). Deliberately separate from pendingReaction itself -- a
    # block can land well before reaction-end closes the window, and needs to
    # survive that close so the attacker's client (still polling) can see it.
    'reactionBlock': None,
    'participants': {},
    'fieldEffects': [],
    # The shared battle log -- one chronological list of everything that's
    # happened this session, oldest first, visible to every viewer (see
    # battle-log-popup.js) and readable by future move-logic that needs to
    # know history (e.g. "did this target already take damage this round"
    # -- see _damage_taken_this_round below). Deliberately uncapped -- a
    # tabletop session's full log is exactly what the user wants to be able
    # to look back through after the fact. Also mirrored to disk (see
    # BATTLE_LOG_DIR/logFile) as each entry is appended, not just held here.
    'log': [],
    # Filename (not full path) under BATTLE_LOG_DIR this session's log is
    # being appended to, set once in create-session. None means "not
    # writing to disk" (a session loaded before this feature existed, or a
    # disk write failed and _append_log_file gave up -- see its own
    # comment), never a reason to fail the request itself.
    'logFile': None,
    # The battle-map screen's state -- a second, separate physical display
    # shown alongside the HP/turn screen, purely spatial (positions/terrain,
    # never HP/VP). Lives here rather than as its own session/lifecycle
    # because it only ever makes sense alongside an active fight, so tying
    # it to create-session/end-session is free. 'grid' is the only
    # templateType for now; the field is already generic so a future
    # 'cave'/'zone' template is additive, not a breaking change.
    'board': {
        'templateType': 'grid',
        'grid': {'cols': 10, 'rows': 12},  # portrait by default -- matches the table display's orientation
        'cells': {},   # "col,row" -> {'terrain': '<freeform DM-typed label>'}
        'tokens': {},  # participantId -> {'col': int, 'row': int}
        # Chosen from list-backgrounds (see upstream.BATTLE_IMAGE_DIR), or
        # None for the plain dark stage. Set once via the placement screen's
        # PvP-only dropdown (combat-wip.js) and shared by every viewer --
        # the same URL string every screen (in-app popup, placement, kiosk
        # display) renders against.
        'backgroundImage': None,
    },
}


def handle(conn, action, params):
    if action == 'get-state':
        return {'status': 'success', 'data': load_state(conn)}

    if action == 'create-session':
        battle_type = params.get('battleType', 'pve')
        if battle_type not in ('pvp', 'pve'):
            raise ValueError('battleType must be pvp or pve')
        state = dict(_EMPTY_STATE)
        state['active'] = True
        state['battleType'] = battle_type
        state['round'] = 1
        state['log'] = []
        state['logFile'] = _new_log_filename(battle_type)
        _log_event(state, 'session-start', text=f'Battle started ({battle_type.upper()})')
        return _save_and_publish(conn, state)

    if action == 'end-session':
        # Load the real current state first (not just blast _EMPTY_STATE
        # over it) so the "Battle ended" line actually lands in this
        # session's log file before it's reset -- otherwise the file would
        # just stop mid-battle with no closing entry.
        state = load_state(conn)
        if state.get('active'):
            _log_event(state, 'session-end', text='Battle ended')
        return _save_and_publish(conn, dict(_EMPTY_STATE))

    if action == 'leave-session':
        return _leave_session(conn, params.get('owner', ''))

    if action == 'log-event':
        # Fire-and-forget entry for a mechanic that only ever happens
        # client-side (status effects, heal-popup amounts, an attack roll
        # declared a Miss, item use, etc. -- see module docstring's
        # boundary on what's ported server-side vs. stays in combat.js's
        # local engine). Trusted the same way update-stats already is: the
        # client computes/knows the narrative, the server just stores and
        # broadcasts it so every viewer's log agrees.
        if not params.get('type') or not params.get('text'):
            raise ValueError('Missing type or text')
        return _mutate(conn, lambda s: _log_event(
            s, params['type'], text=params['text'],
            actorId=params.get('actorId'), actorName=params.get('actorName'),
            targetId=params.get('targetId'), targetName=params.get('targetName'),
        ))

    if action == 'add-participant':
        if not params.get('data'):
            raise ValueError('Missing participant data')
        return _mutate(conn, lambda s: _add_participant(s, json.loads(params['data'])))

    if action == 'remove-participant':
        if not params.get('id'):
            raise ValueError('Missing participant id')
        return _mutate(conn, lambda s: _remove_participant(s, params['id']))

    if action == 'set-status':
        if not params.get('id') or params.get('status') not in ('participating', 'spectating'):
            raise ValueError('Missing participant id, or status must be participating/spectating')
        return _mutate(conn, lambda s: _set_status(s, params['id'], params['status']))

    if action == 'set-visibility':
        if not params.get('id') or params.get('field') not in ('hp', 'vp', 'name'):
            raise ValueError('Missing participant id, or field must be hp/vp/name')
        visible = params.get('visible', '1') != '0'
        return _mutate(conn, lambda s: _set_visibility(s, params['id'], params['field'], visible))

    if action == 'advance-turn':
        return _mutate(conn, _advance_turn)

    if action == 'reaction-start':
        if not params.get('id'):
            raise ValueError('Missing participant id')
        return _mutate(conn, lambda s: _reaction_start(s, params['id']))

    if action == 'reaction-end':
        return _mutate(conn, _reaction_end)

    if action == 'open-reaction-window':
        trigger = params.get('trigger')
        if trigger not in ('targeted', 'damaged'):
            raise ValueError('trigger must be targeted or damaged')
        if not params.get('anchorId') or not params.get('attackerId'):
            raise ValueError('Missing anchorId or attackerId')
        outcome = {}
        result = _mutate(conn, lambda s: outcome.update(_open_reaction_window(
            s, trigger, params['anchorId'], params['attackerId'], params.get('moveName', ''))))
        result.update(outcome)
        return result

    if action == 'decline-reaction':
        if not params.get('id'):
            raise ValueError('Missing participant id')
        return _mutate(conn, lambda s: _decline_reaction(s, params['id']))

    if action == 'block-pending-attack':
        if not params.get('id'):
            raise ValueError('Missing participant id')
        return _mutate(conn, lambda s: _block_pending_attack(s, params['id']))

    if action == 'close-reaction-window':
        return _mutate(conn, _close_reaction_window)

    if action == 'play-animation':
        if not params.get('id'):
            raise ValueError('Missing participant id')
        return _play_animation(conn, params['id'], params.get('species'))

    if action == 'use-move':
        if not params.get('id') or not params.get('move'):
            raise ValueError('Missing participant id or move name')
        return _use_move(
            conn, params['id'], params['move'],
            target_id=params.get('targetId') or None,
            dice_roll=js_parse_int(params.get('diceRoll')) or 0,
            species=params.get('species'),
        )

    if action == 'apply-damage':
        if not params.get('id') or not params.get('targetId'):
            raise ValueError('Missing attacker id or target id')
        dice_roll = js_parse_int(params.get('diceRoll'))
        if dice_roll is None:
            raise ValueError('Missing diceRoll')
        return _apply_damage(
            conn, params['id'], params['targetId'], dice_roll,
            move_type=params.get('moveType', ''),
            species=params.get('species'),
            move_name=params.get('moveName', ''),
        )

    if action == 'apply-status':
        if not params.get('targetId') or not params.get('status'):
            raise ValueError('Missing targetId or status')
        spec = json.loads(params['status'])
        return _mutate(conn, lambda s: _apply_status(s, params['targetId'], spec))

    if action == 'remove-status':
        if not params.get('targetId') or not params.get('statusId'):
            raise ValueError('Missing targetId or statusId')
        return _mutate(conn, lambda s: _remove_status(s, params['targetId'], params['statusId'], params.get('reason', '')))

    if action == 'use-status':
        if not params.get('targetId') or not params.get('statusId'):
            raise ValueError('Missing targetId or statusId')
        return _mutate(conn, lambda s: _use_status(s, params['targetId'], params['statusId']))

    if action == 'update-base-stats':
        if not params.get('id') or not params.get('stats'):
            raise ValueError('Missing participant id or stats')
        stats = json.loads(params['stats'])
        return _mutate(conn, lambda s: _update_base_stats(s, params['id'], stats))

    if action == 'update-stats':
        if not params.get('id'):
            raise ValueError('Missing participant id')
        return _mutate(conn, lambda s: _update_stats(
            s, params['id'],
            js_parse_int(params.get('currentHP')),
            js_parse_int(params.get('currentVP')),
        ))

    if action == 'set-board-template':
        cols = js_parse_int(params.get('cols'))
        rows = js_parse_int(params.get('rows'))
        if not cols or not rows or cols < 1 or rows < 1:
            raise ValueError('cols and rows must be positive integers')
        return _mutate(conn, lambda s: _set_board_template(s, cols, rows))

    if action == 'set-cell-terrain':
        col = js_parse_int(params.get('col'))
        row = js_parse_int(params.get('row'))
        if col is None or row is None:
            raise ValueError('Missing col or row')
        return _mutate(conn, lambda s: _set_cell_terrain(s, col, row, params.get('terrain', '')))

    if action == 'list-backgrounds':
        return _list_backgrounds()

    if action == 'list-move-categories':
        return _list_move_categories()

    if action == 'set-board-background':
        return _mutate(conn, lambda s: _set_board_background(s, params.get('url', '')))

    if action == 'set-token-position':
        col = js_parse_int(params.get('col'))
        row = js_parse_int(params.get('row'))
        if not params.get('id') or col is None or row is None:
            raise ValueError('Missing participant id, col, or row')
        return _mutate(conn, lambda s: _set_token_position(s, params['id'], col, row))

    if action == 'move-token':
        col = js_parse_int(params.get('col'))
        row = js_parse_int(params.get('row'))
        if not params.get('id') or col is None or row is None:
            raise ValueError('Missing participant id, col, or row')
        return _mutate(conn, lambda s: _move_token(s, params['id'], col, row))

    if action == 'clear-token-position':
        if not params.get('id'):
            raise ValueError('Missing participant id')
        return _mutate(conn, lambda s: _clear_token_position(s, params['id']))

    if action == 'confirm-placement':
        col = js_parse_int(params.get('col'))
        row = js_parse_int(params.get('row'))
        if not params.get('id') or col is None or row is None:
            raise ValueError('Missing participant id, col, or row')
        return _mutate(conn, lambda s: _confirm_placement(s, params['id'], col, row))

    if action == 'hover-token':
        if not params.get('id'):
            raise ValueError('Missing participant id')
        return _hover_token(
            conn, params['id'],
            js_parse_int(params.get('col')), js_parse_int(params.get('row')),
        )

    raise ValueError('Unknown combat action: ' + str(action))


# ---------------------------------------------------------------------------
# Load / save
# ---------------------------------------------------------------------------

def load_state(conn):
    row = conn.execute('SELECT json FROM combat_session WHERE id = 1').fetchone()
    return json.loads(row[0]) if row else dict(_EMPTY_STATE)


def _save_and_publish(conn, state):
    conn.execute(
        'INSERT INTO combat_session (id, json, updated_at) VALUES (1, ?, ?) '
        'ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at',
        (json.dumps(state), datetime.now(timezone.utc).isoformat()))
    conn.commit()
    live.publish({'type': 'combat', 'session': state})
    return {'status': 'success', 'data': state}


def _mutate(conn, fn):
    """Load -> apply fn in place -> save/publish. Every write action shares
    this active-session guard so a stray add-participant etc. after
    end-session fails loudly instead of silently resurrecting a session."""
    state = load_state(conn)
    if not state.get('active'):
        raise ValueError('No active combat session')
    fn(state)
    return _save_and_publish(conn, state)


# ---------------------------------------------------------------------------
# Battle log
# ---------------------------------------------------------------------------

def _new_log_filename(battle_type):
    """One file per battle session, named at create-session time so every
    event this session logs (including this very first one) lands in the
    same file. Timestamp down to the second is enough to never collide --
    only one session is ever active at a time."""
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    return f'{stamp}-{battle_type}.jsonl'


def _append_log_file(state, entry):
    """Mirrors one log entry to BATTLE_LOG_DIR/<state['logFile']> as a JSON
    Lines file (one JSON object per line -- greppable, tailable, and never
    needs the whole file parsed just to add a line). Opened/closed fresh
    per entry rather than held open, so this survives the server process
    restarting mid-battle same as everything else in this module. Never
    raises -- a disk hiccup shouldn't take down the battle itself, only the
    (secondary, for-later-review) file copy of it."""
    filename = state.get('logFile')
    if not filename:
        return
    try:
        os.makedirs(BATTLE_LOG_DIR, exist_ok=True)
        with open(os.path.join(BATTLE_LOG_DIR, filename), 'a', encoding='utf-8') as f:
            f.write(json.dumps(entry) + '\n')
    except OSError:
        pass


def _log_event(state, event_type, text, actorId=None, actorName=None, targetId=None, targetName=None, **extra):
    """Appends one entry to the shared battle log (kept in the session state
    for the live popup, and mirrored to disk -- see _append_log_file -- for
    looking back after the session ends) and returns it. `text` is the
    human-readable line every viewer's log popup shows verbatim -- generated
    here (not left to the frontend) so there's one source of truth for what
    an event says, same reasoning as everything else this module computes
    server-side rather than trusting duplicated client logic. `extra` holds
    whatever structured fields are useful for a given event_type (amount,
    multiplier, moveType, vpCost, ...) for future move-logic queries (see
    _damage_taken_this_round below) without forcing every event type into
    one fixed shape. Deliberately uncapped -- see the 'log' field's own
    comment on _EMPTY_STATE."""
    entry = {
        'id': uuid.uuid4().hex[:8],
        'round': state.get('round', 0),
        'ts': datetime.now(timezone.utc).isoformat(),
        'type': event_type,
        'text': text,
        'actorId': actorId, 'actorName': actorName,
        'targetId': targetId, 'targetName': targetName,
        **extra,
    }
    state.setdefault('log', []).append(entry)
    _append_log_file(state, entry)
    return entry


def _damage_taken_this_round(state, pid):
    """Total damage `pid` has taken since the current round began, read
    straight from the shared log -- for move logic that needs to know "was
    this target already hit this round" (e.g. a move whose effect changes
    if the target took damage earlier in the round). Not called from
    anywhere yet; this is the scaffolding for that per-move logic once it
    exists, not a feature on its own."""
    round_now = state.get('round', 0)
    return sum(
        entry.get('amount', 0) for entry in state.get('log', [])
        if entry.get('round') == round_now and entry.get('type') == 'damage' and entry.get('targetId') == pid
    )


def _last_log_event_for(state, pid, types=None):
    """Most recent log entry where `pid` is the actor or the target
    (optionally restricted to `types`), or None. Same "scaffolding for
    future move logic" status as _damage_taken_this_round above."""
    for entry in reversed(state.get('log', [])):
        if types is not None and entry.get('type') not in types:
            continue
        if entry.get('actorId') == pid or entry.get('targetId') == pid:
            return entry
    return None


def _play_animation(conn, pid, species):
    """Fire-and-forget: tells every connected screen (namely the display
    module) to play a species' battle animation clip right now. Doesn't
    touch combat_session at all -- this is a cue, not state, so there's
    nothing to persist or to hand a client that connects after the fact."""
    state = load_state(conn)
    if not state.get('active'):
        raise ValueError('No active combat session')
    participant = state['participants'].get(pid)
    if not participant:
        raise ValueError('Unknown participant: ' + pid)
    live.publish({
        'type': 'combat-animation',
        'participantId': pid,
        'species': species or participant['name'],
    })
    return {'status': 'success'}


def _hover_token(conn, pid, col, row):
    """Fire-and-forget, same shape as _play_animation -- a live "here's where
    I'm currently considering placing this token" preview during the
    placement step (see combat-wip.js's placement screen), not persisted
    state. col/row both None means "stopped hovering," which the client
    renders as clearing the ghost token."""
    state = load_state(conn)
    if not state.get('active'):
        raise ValueError('No active combat session')
    if pid not in state['participants']:
        raise ValueError('Unknown participant: ' + pid)
    live.publish({'type': 'combat-hover', 'participantId': pid, 'col': col, 'row': row})
    return {'status': 'success'}


def _find_move(conn, move_name):
    """Row straight from the moves dataset -- [name, type, modifier,
    actionType, vpCost, duration, range, desc, higherLevels], same array
    shape move-popup.js already destructures client-side. None for an
    unrecognized name (a still-being-typed custom/homebrew move), which
    callers treat as "no VP cost, no type multiplier" rather than an error --
    unrecognized shouldn't hard-block a turn."""
    for row in upstream.fetch_moves(conn):
        if row and str(row[0]).strip().lower() == move_name.strip().lower():
            return row
    return None


def _clamp_type_multiplier(raw):
    """This table's ruleset deliberately has no x4/x0.25 stacking for a
    double-weak/double-resist dual-type target -- only four outcomes exist:
    no effect (0), not very effective (0.5), neutral (1), super effective
    (2), regardless of how the two types' chart values would otherwise
    multiply out. Collapses whatever calculate_type_effectiveness's
    multiplicative chart produced (0, 0.25, 0.5, 1, 2, or 4) into that set."""
    if raw <= 0:
        return 0
    if raw < 1:
        return 0.5
    if raw > 1:
        return 2
    return 1


# One-step-better order for an escalating resistance grant (Iron Defense, Mud
# Sport): vulnerable -> normal -> resistant -> immune, never worse, never more
# than one step regardless of how favorable the matchup already was.
_MULT_LADDER = (2, 1, 0.5, 0)


def _bump_one_step_better(mult):
    try:
        idx = _MULT_LADDER.index(mult)
    except ValueError:
        idx = 1  # an unrecognized value is treated as normal before bumping
    return _MULT_LADDER[min(idx + 1, len(_MULT_LADDER) - 1)]


def _type_multiplier(conn, attack_type, defend_type1, defend_type2, target=None):
    """Reuses game-data/type-effectiveness's own chart lookup (routes_gamedata
    .calculate_type_effectiveness), which returns one multiplier per
    attacking type in type_chart_attack's order -- this just also resolves
    that order to find attack_type's position, then clamps it to this game's
    four-outcome ruleset (see _clamp_type_multiplier). Defaults to 1
    (neutral) whenever any type is missing/unrecognized, same as an untyped
    participant or an off-chart move should behave.

    `target` (the defending participant, optional -- only the two live combat
    callers have one to pass) layers three live `condition` statuses on top:
    `type_changed` (Camouflage/Conversion/Reflect Type) swaps in a different
    defend_type1/2 entirely before the chart lookup even runs; `granted_immunity`
    (Magnet Rise: "immune to ground moves", flat, ignores the actual matchup) forces
    0 outright when its `value` matches attack_type; `resistance_upgrade` (Iron
    Defense's `value:"all"`, Mud Sport's `value:"Electric"`) bumps the RESULT one
    step better (_bump_one_step_better) when it applies, on top of whatever the
    chart already said -- several sources each bump their own step, compounding."""
    statuses = (target or {}).get('statuses', []) if target else []
    for s in statuses:
        if s.get('kind') == 'condition' and s.get('apply') == 'type_changed' and s.get('value'):
            defend_type1 = s['value']
            defend_type2 = s.get('value2')
            break
    if not attack_type or not defend_type1:
        return 1
    values = routes_gamedata.calculate_type_effectiveness(conn, defend_type1, defend_type2)
    if not values:
        return 1
    attack_types = [r[0] for r in conn.execute('SELECT type FROM type_chart_attack ORDER BY ord')]
    upper_attack = [str(t).upper() for t in attack_types]
    try:
        idx = upper_attack.index(str(attack_type).upper())
    except ValueError:
        return 1
    raw = values[idx] if idx < len(values) else 1
    result = _clamp_type_multiplier(raw)
    for s in statuses:
        if s.get('kind') != 'condition':
            continue
        if s.get('apply') == 'granted_immunity' and str(s.get('value') or '').upper() == str(attack_type).upper():
            return 0
        if s.get('apply') == 'resistance_upgrade':
            v = s.get('value')
            if v == 'all' or (v and str(v).upper() == str(attack_type).upper()):
                result = _bump_one_step_better(result)
    return result


def _use_move(conn, pid, move_name, target_id, dice_roll, species):
    """The generic move-use mechanic every move shares: spend the user's VP
    (overflow drains their own HP -- see _apply_move), then optionally
    convert a manually-rolled dice number into damage against a target via
    type effectiveness. Also fires the same animation cue play-animation
    does, so using a move for real is what actually drives the display
    module now instead of only the WIP page's manual test button."""
    move_row = _find_move(conn, move_name)
    vp_cost = (js_parse_int(move_row[4]) or 0) if move_row else 0
    move_type = move_row[1] if move_row and len(move_row) > 1 else ''

    outcome = {}
    result = _mutate(conn, lambda s: outcome.update(
        _apply_move(conn, s, pid, move_name, vp_cost, target_id, dice_roll, move_type)))
    result.update(outcome)

    attacker = result['data']['participants'].get(pid, {})
    live.publish({
        'type': 'combat-animation',
        'participantId': pid,
        'species': species or attacker.get('name', ''),
    })
    return result


# ---------------------------------------------------------------------------
# Mutators
# ---------------------------------------------------------------------------

def _add_participant(state, data):
    if data.get('side') not in ('player', 'enemy'):
        raise ValueError('side must be player or enemy')
    status = data.get('status', 'participating')
    if status not in ('participating', 'spectating'):
        raise ValueError('status must be participating or spectating')

    pid = data.get('id') or uuid.uuid4().hex[:8]
    state['participants'][pid] = {
        'id': pid,
        'side': data['side'],
        'name': data.get('name', 'Unknown'),
        'image': data.get('image', ''),
        'currentHP': data.get('currentHP', 0),
        'maxHP': data.get('maxHP', 0),
        'currentVP': data.get('currentVP', 0),
        'maxVP': data.get('maxVP', 0),
        # Defending types for this participant, used by use-move's type-
        # effectiveness damage calc. Blank means "no chart data" -- treated
        # as neutral (1x), same as an off-chart move (see _type_multiplier).
        'type1': data.get('type1', ''),
        'type2': data.get('type2', ''),
        # Which logged-in trainer this belongs to (combat-wip.js's "Join as
        # yourself" flow sets this to the trainer's own name for both
        # themselves and their Pokemon). Blank for DM-added freeform enemies
        # -- nobody "owns" those. Used client-side to gate battle-map token
        # movement to your own participants; not enforced server-side here,
        # same trust model as this file's other DM-facing actions (no
        # per-caller auth beyond Tailscale network membership).
        'owner': data.get('owner', ''),
        # The rolled d20 + initiative-score total from combat.js's reused
        # Initiative phase (see js/pages/combat.js's attachInitiativeListeners
        # onComplete). None means "no roll yet" -- _rebuild_turn_order appends
        # those after everyone who has rolled, same as a DM-added enemy with
        # no initiative today.
        'initiative': data.get('initiative'),
        # Shown on the external display screen alongside name/HP/VP (see
        # display.js) -- purely informational, no gameplay effect server-side.
        'level': data.get('level'),
        # Battle-map footprint hint -- a freeform sheet value (Tiny/Small/
        # Large/Huge/...), not a fixed enum here, same trust model as
        # type1/type2 above. Blank for trainers and freeform enemies (both
        # always 1x1 -- see footprintForSize in battle-map-grid.js, the
        # only place this is actually interpreted).
        'size': data.get('size', ''),
        # Movement tracker -- [{type, ft}, ...] (see combat.js's
        # buildTrainerCombatant/buildPokemonCombatant, the source of truth
        # this mirrors, same relationship as combatantType's own comment
        # below). Empty for anything added before this existed, or a DM's
        # freeform enemy -- move-token skips enforcement entirely then, same
        # "missing means untracked" convention as combatantType/hasStatBlock.
        'speeds': data.get('speeds', []),
        # Feet moved so far THIS turn, against whichever of the above types
        # move-token's own caller picked -- a single shared budget (5e's own
        # rule for a creature switching between multiple speeds: distance
        # already moved counts against every type's own max, not a separate
        # pool per type). Reset at the start of this participant's own next
        # turn (see _advance_turn).
        'movementUsed': 0,
        # Full stat block -- PvP only in practice (combatantToParticipant
        # only ever sends these for a trainer's own "join as yourself"
        # flow; a PvE freeform enemy never has them, side='enemy' stays
        # exactly as minimal as before). The user's explicit call: no
        # reason to hide a PvP opponent's stats from the app itself, since
        # every human at the table already sees them on paper anyway.
        # Lets every device compute things that need an arbitrary
        # participant's own numbers (a move's DC, an ability check) --
        # not just the ones it owns, unlike everything else in this
        # participant record before now. combatantType distinguishes the
        # trainer vs pokemon field shape (see combat.js's
        # buildTrainerCombatant/buildPokemonCombatant, the source of
        # truth this mirrors) since the two differ slightly (item/
        # abilities/stabBonusValue only make sense for a pokemon).
        # None (not present) for anything added before this existed, or a
        # DM's freeform enemy -- see hasStatBlock in combat-wip.js's
        # _syncLocalCombatState for how a missing block degrades.
        'combatantType': data.get('combatantType'),
        'speciesName': data.get('speciesName', ''),
        'ac': data.get('ac'), 'baseAc': data.get('baseAc'), 'critMod': data.get('critMod', 0),
        'proficiency': data.get('proficiency'), 'stabBonusValue': data.get('stabBonusValue'),
        'str': data.get('str'), 'dex': data.get('dex'), 'con': data.get('con'),
        'int': data.get('int'), 'wis': data.get('wis'), 'cha': data.get('cha'),
        'strMod': data.get('strMod'), 'dexMod': data.get('dexMod'), 'conMod': data.get('conMod'),
        'intMod': data.get('intMod'), 'wisMod': data.get('wisMod'), 'chaMod': data.get('chaMod'),
        'abilities': data.get('abilities', ''), 'item': data.get('item', ''),
        'moves': data.get('moves', []),
        'savingThrows': data.get('savingThrows', ''), 'skills': data.get('skills', ''),
        # Whether this participant has been placed on the battle map through
        # the (per-player) placement step -- see confirm-placement below.
        # Only ever checked client-side against a participant's own `owner`
        # (has *this* device's trainer finished placing everyone they own?),
        # so a freeform enemy's flag never actually gates anything; it just
        # starts false like everyone else rather than needing a special case.
        'placed': False,
        'status': status,
        'reactionUsed': False,
        # Live effects on this participant (conditions, stat modifiers,
        # advantage/disadvantage) -- see the status section below and
        # move-effects-schema.md. Older participants may lack the key;
        # every reader goes through _statuses_of.
        'statuses': [],
        # Meaningful for side='enemy' only -- allies are always fully visible
        # to their own team. DM toggles these per-enemy from the DM module.
        'visibility': {'hp': True, 'vp': True, 'name': True},
    }
    _rebuild_turn_order(state)
    _log_event(state, 'join', text=f"{state['participants'][pid]['name']} joined the battle", actorId=pid, actorName=state['participants'][pid]['name'])


def _remove_participant(state, pid):
    state['participants'].pop(pid, None)
    state['board']['tokens'].pop(pid, None)
    _rebuild_turn_order(state)


def _leave_session(conn, owner):
    """combat-wip.js's End Battle button: removes only the calling trainer's
    own participants instead of end-session's blunt reset-for-everyone, so
    one player leaving doesn't throw everyone else out of a fight still in
    progress. A DM's freeform enemies always have owner='' (see
    _add_participant), so they never count as a "player" here -- once no
    participant with a real owner is left, the session has no players left
    in it either, and actually ends the same way end-session does."""
    state = load_state(conn)
    if not state.get('active'):
        return {'status': 'success', 'data': state}
    if owner:
        for pid in [pid for pid, p in state['participants'].items() if p.get('owner') == owner]:
            state['participants'].pop(pid, None)
            state['board']['tokens'].pop(pid, None)
        _log_event(state, 'leave', text=f'{owner} left the battle', actorName=owner)
    if not any(p.get('owner') for p in state['participants'].values()):
        _log_event(state, 'session-end', text='Battle ended (all players left)')
        return _save_and_publish(conn, dict(_EMPTY_STATE))
    _rebuild_turn_order(state)
    return _save_and_publish(conn, state)


def _set_status(state, pid, status):
    participant = state['participants'].get(pid)
    if not participant:
        raise ValueError('Unknown participant: ' + pid)
    participant['status'] = status
    _rebuild_turn_order(state)


def _update_stats(state, pid, current_hp, current_vp):
    """Client-authoritative sync for HP/VP changes made through combat.js's
    own local battle engine (VP cost of using a move, Ingrain/direct/drain
    heals, manual HP/VP adjusters) -- those per-move mechanics are
    intentionally not ported server-side (see module docstring), so the
    client just computes the new value locally and tells the server what it
    landed on, the same trust model as everywhere else in this app."""
    participant = state['participants'].get(pid)
    if not participant:
        raise ValueError('Unknown participant: ' + pid)
    if current_hp is not None:
        participant['currentHP'] = current_hp
    if current_vp is not None:
        participant['currentVP'] = current_vp


_BASE_STAT_KEYS = ('ac', 'str', 'dex', 'con', 'int', 'wis', 'cha',
                   'strMod', 'dexMod', 'conMod', 'intMod', 'wisMod', 'chaMod', 'critMod')


def _update_base_stats(state, pid, stats):
    """Client-authoritative sync for a combatant's MANUAL stat edits (the Modify
    Stats buttons on its card: AC, ability scores and modifiers, crit modifier),
    which otherwise only ever touch that player's local card. Every other client
    reads these off the participant record -- a target's AC for the hit/miss hint,
    a saver's modifier, an attacker's Move DC and crit range -- so they have to
    follow. These are BASE values: the live status deltas (AC -1 from Crunch...)
    are NOT baked in, because every reader adds the participant's `statuses` on
    top itself; storing the buffed numbers here would count each effect twice.
    Same trust model as update-stats."""
    participant = state['participants'].get(pid)
    if not participant:
        raise ValueError('Unknown participant: ' + pid)
    for key in _BASE_STAT_KEYS:
        if key not in stats:
            continue
        value = js_parse_int(stats[key])
        if value is None:
            raise ValueError(f'{key} must be a number')
        participant[key] = value


def _set_visibility(state, pid, field, visible):
    participant = state['participants'].get(pid)
    if not participant:
        raise ValueError('Unknown participant: ' + pid)
    participant['visibility'][field] = visible


def _rebuild_turn_order(state):
    """Recomputed from participant status on every membership/status change,
    so flipping someone spectating<->participating mid-fight (the "rushes in
    from round 3" case) takes effect immediately rather than needing a
    separate reshuffle step. Whoever currently has the floor stays anchored
    by id (not index) when the list shifts under them -- reordering never
    changes *whose* turn it is, only where everyone else falls before/after.

    Participants who have rolled initiative (combat.js's reused Initiative
    phase) are fully re-sorted highest-first every time this runs, since
    joins happen one at a time asynchronously (each player finishes their
    own roll independently) -- sorting only newcomers-against-each-other
    would be a no-op in practice (there's rarely more than one newcomer per
    call). Anyone without a roll (a DM-added enemy) keeps plain insertion
    order and is appended after everyone who has rolled. Anchoring only
    applies once combat has actually 'started' (state['started'], set by the
    first advance-turn) -- before that, turnIndex is always just recomputed
    fresh (index 0 of the current sort), since there's no real turn in
    progress yet to protect."""
    current_id = None
    if state.get('started') and state['turnOrder'] and state['turnIndex'] < len(state['turnOrder']):
        current_id = state['turnOrder'][state['turnIndex']]

    live_ids = [pid for pid, p in state['participants'].items() if p['status'] == 'participating']
    rolled = sorted(
        (pid for pid in live_ids if state['participants'][pid].get('initiative') is not None),
        key=lambda pid: state['participants'][pid]['initiative'],
        reverse=True,
    )
    unrolled = [pid for pid in live_ids if state['participants'][pid].get('initiative') is None]
    state['turnOrder'] = rolled + unrolled

    state['turnIndex'] = state['turnOrder'].index(current_id) if current_id in state['turnOrder'] else 0
    if state['reactingParticipantId'] not in state['participants']:
        state['reactingParticipantId'] = None
    # A reaction window whose anchor or attacker left (or stopped participating,
    # e.g. fainted out) mid-window no longer means anything -- close it
    # outright. One whose eligible list just shrank the same way (an
    # eligible-but-undecided reactor left/dropped out) prunes them and
    # re-checks whether everyone left is now answered.
    def _still_participating(pid):
        p = state['participants'].get(pid)
        return bool(p) and p.get('status') == 'participating'

    pr = state.get('pendingReaction')
    if pr:
        if not _still_participating(pr['anchorId']) or not _still_participating(pr['attackerId']):
            state['pendingReaction'] = None
        else:
            for pid in list(pr['eligible']):
                if not _still_participating(pid):
                    del pr['eligible'][pid]
            if not pr['eligible']:
                state['pendingReaction'] = None
            else:
                _maybe_close_reaction_window(state)


def _advance_turn(state):
    if state['reactingParticipantId']:
        raise ValueError('Cannot advance turn while a reaction is in progress')
    if not state['turnOrder']:
        return
    state['started'] = True
    ending_id = state['turnOrder'][state['turnIndex']] if state['turnIndex'] < len(state['turnOrder']) else None
    state['turnIndex'] = (state['turnIndex'] + 1) % len(state['turnOrder'])
    new_round = state['turnIndex'] == 0
    if new_round:
        state['round'] += 1
    # Only the combatant whose normal turn is now starting gets their
    # reaction refreshed -- "usable again once their next turn comes up",
    # not a blanket reset for the whole table every lap.
    next_participant = state['participants'].get(state['turnOrder'][state['turnIndex']])
    if next_participant:
        next_participant['reactionUsed'] = False
        next_participant['movementUsed'] = 0
    _log_event(state, 'turn-advance', text=f"Round {state['round']}: {next_participant['name'] if next_participant else '?'}'s turn",
               actorId=state['turnOrder'][state['turnIndex']], actorName=next_participant['name'] if next_participant else None)
    # Effects that end on a turn boundary or a round count (see the status
    # section) -- after the log line, so "wore off" entries read as happening
    # in the new turn/round.
    if ending_id:
        _expire_statuses_on_turn_point(state, ending_id, 'end')
    if new_round:
        _expire_statuses_by_round(state)
    _expire_statuses_on_turn_point(state, state['turnOrder'][state['turnIndex']], 'start')


def _reaction_start(state, pid):
    participant = state['participants'].get(pid)
    if not participant:
        raise ValueError('Unknown participant: ' + pid)
    if participant['status'] != 'participating':
        raise ValueError('Only participating combatants can react')
    if participant['reactionUsed']:
        raise ValueError('Reaction already used this cycle')
    if state['reactingParticipantId']:
        raise ValueError('Another reaction is already in progress')
    if state['turnOrder'] and state['turnOrder'][state['turnIndex']] == pid:
        raise ValueError("It's already this participant's turn")

    state['started'] = True  # see _rebuild_turn_order -- a reaction means turn order is now live
    state['reactingParticipantId'] = pid
    participant['reactionUsed'] = True
    # If a reaction WINDOW is open and this is one of the participants it was
    # offered to, saying yes counts as their answer -- same bookkeeping as an
    # explicit decline (see _decline_reaction), just the opposite outcome.
    pr = state.get('pendingReaction')
    if pr and pid in pr['eligible']:
        pr['eligible'][pid]['responded'] = True
    _log_event(state, 'reaction-start', text=f"{participant['name']} used a reaction", actorId=pid, actorName=participant['name'])


def _reaction_end(state):
    if not state['reactingParticipantId']:
        raise ValueError('No reaction in progress')
    reactor = state['participants'].get(state['reactingParticipantId'])
    # turnIndex was never touched during the reaction, so the floor returns
    # to exactly where the normal order left off.
    state['reactingParticipantId'] = None
    if reactor:
        _log_event(state, 'reaction-end', text=f"{reactor['name']}'s reaction ended", actorId=reactor['id'], actorName=reactor['name'])
    # The window (if this reactor came from one) may have been waiting on
    # them specifically -- now that they've released the floor, see if
    # everyone eligible has answered and it can close.
    _maybe_close_reaction_window(state)


# ---------------------------------------------------------------------------
# Reaction windows -- "does anyone want to react?" (see move-effects-schema.md's
# own reaction section). Opened by the ATTACKER's own client at the point their
# move's flow needs to pause (right after picking a target, for a `targeted`
# trigger; right after damage lands, for a `damaged` one) and waited on until it
# closes, same client-driven pattern _advance_turn/_reaction_start already use
# for "no server background timer, the client that cares tracks the clock".
# Actually reacting still goes through the EXISTING reaction-start/-end (turn
# authority, one holder at a time) -- a window is just who's ELIGIBLE and
# whether they've answered yet, not a second way to hold the floor.
# ---------------------------------------------------------------------------

# Chebyshev distance (5ft/square, a diagonal step costs the same as an
# orthogonal one -- the user's own rule, no vertical axis tracked yet).
_FT_PER_SQUARE = 5


def _grid_distance_ft(state, id_a, id_b):
    """Distance in feet between two participants' battle-map token positions,
    or None if either isn't placed. The user's own rule is every participant
    in the battle has to be on the map, but this stays defensive (excludes
    them from eligibility rather than crashing an attack over a missing
    token) instead of assuming that always holds true in practice."""
    tokens = state.get('board', {}).get('tokens', {})
    a, b = tokens.get(id_a), tokens.get(id_b)
    if not a or not b:
        return None
    return max(abs(a['col'] - b['col']), abs(a['row'] - b['row'])) * _FT_PER_SQUARE


def _has_block_attack_effect(move_data):
    """True if this move's own effects include a `block_attack` (Protect,
    King's Shield, ...) -- see move-effects-schema.md's own section. What
    `ignoresProtect` (below) actually filters against: it never blocks a
    reaction move for any OTHER reason, only a block_attack one."""
    return any(e.get('kind') == 'block_attack' for e in (move_data.get('effects') or []))


def _eligible_reactors(state, moves_data, trigger, anchor_id, exclude_id, attacking_move_name=None):
    """{participantId: [moveName, ...]} for every OTHER participant (never the
    attacker themselves) who knows at least one move flagged with this exact
    `trigger` ('targeted' | 'damaged') and is within that move's own
    `reactionRange` (feet) of `anchor_id` -- the target of the attack for
    `targeted`, or whoever just took damage for `damaged`. `reactionRange: 0`
    (the common case -- Noble Roar, Withdraw, Attract, ...) means the
    reaction only ever protects its own user, so only anchor_id itself can
    ever qualify for it; a move with a real range (Sentinel Strike's
    adjacent-ally intervention, Baby-Doll Eyes' 30ft, ...) can put someone
    ELSE in range of the anchor in the eligible set too. A participant with no
    token on the map (see _grid_distance_ft) never qualifies for a
    range-gated move, even range 0 -- an anchor with no token can't be
    "distance 0 from itself" reliably either, so this errs toward excluding
    rather than guessing.

    `attacking_move_name` (the move whose OWN attack opened this window --
    always known for 'targeted', which is exactly the family this matters
    for) is checked for `ignoresProtect` (Aqua Phase, Fly, Hyperspace Hole,
    ... -- "Protect and Detect reactions may not be used when hit by this
    attack"): when set, a candidate's block_attack move (Protect, King's
    Shield, ...) is skipped entirely -- not the whole participant, they may
    still have some OTHER eligible reaction move that isn't Protect-family
    and stays perfectly usable against an ignoresProtect attack."""
    moves_by_name = {m['name']: m for m in moves_data.get('moves', [])}
    attacking_move = moves_by_name.get(attacking_move_name) if attacking_move_name else None
    ignores_protect = bool(attacking_move and attacking_move.get('ignoresProtect'))
    result = {}
    for pid, p in state['participants'].items():
        if pid == exclude_id or p.get('status') != 'participating':
            continue  # reaction-start itself requires 'participating' -- never offer one nobody could accept
        for move_name in (p.get('moves') or []):
            m = moves_by_name.get(move_name)
            if not m or m.get('reactionTrigger') != trigger:
                continue
            if ignores_protect and _has_block_attack_effect(m):
                continue
            dist = _grid_distance_ft(state, pid, anchor_id)
            if dist is None or dist > (m.get('reactionRange') or 0):
                continue
            result.setdefault(pid, []).append(move_name)
    return result


def _open_reaction_window(state, trigger, anchor_id, attacker_id, move_name):
    if state['pendingReaction']:
        raise ValueError('A reaction window is already open')
    if anchor_id not in state['participants']:
        raise ValueError('Unknown anchor participant: ' + anchor_id)
    eligible = _eligible_reactors(state, _load_move_data_file(), trigger, anchor_id, attacker_id, move_name)
    if not eligible:
        return {'opened': False}  # nothing to wait for -- caller's flow proceeds immediately
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    state['pendingReaction'] = {
        'id': uuid.uuid4().hex[:8],
        'trigger': trigger, 'anchorId': anchor_id, 'attackerId': attacker_id, 'moveName': move_name,
        'expiresAt': now_ms + 10000,
        'eligible': {pid: {'moves': names, 'responded': False} for pid, names in eligible.items()},
    }
    anchor_name = state['participants'][anchor_id]['name']
    _log_event(state, 'reaction-window-open',
               text=f"Reaction window open -- {', '.join(state['participants'][p]['name'] for p in eligible)} may react to {anchor_name}",
               targetId=anchor_id, targetName=anchor_name)
    return {'opened': True}


def _decline_reaction(state, pid):
    pr = state['pendingReaction']
    if not pr:
        raise ValueError('No reaction window open')
    entry = pr['eligible'].get(pid)
    if not entry:
        raise ValueError('Not eligible to react to this')
    entry['responded'] = True
    _maybe_close_reaction_window(state)


def _block_pending_attack(state, pid):
    """Called from _apply_status's own caller (combat-wip.js's
    _offerMoveEffects, special-casing a `block_attack` effect the same way it
    already does reroll_damage/heal -- see move-effects-schema.md) the moment
    a reactor actually USES a move like Protect: marks the CURRENT pending
    reaction's attack as blocked, so the attacker's own client (waiting in
    waitForReactionWindow) knows to skip its attack roll/damage step entirely
    once the window closes, instead of proceeding as if nothing happened.
    Requires the caller to actually be holding the floor via reaction-start
    (same turn-authority check as every other reaction action) for a real
    pending window they were eligible for -- applying a block_attack effect
    with no live reaction to attach it to (a stray apply-status call, a
    window that already closed) does nothing mechanically, same trust-the-
    flow reasoning as everywhere else in this file. Never closes the window
    itself -- reaction-end still does that, exactly like every other
    reaction; this only leaves a note for the attacker to find."""
    participant = state['participants'].get(pid)
    if not participant:
        raise ValueError('Unknown participant: ' + pid)
    if state['reactingParticipantId'] != pid:
        raise ValueError('Not currently holding a reaction')
    pr = state.get('pendingReaction')
    if not pr or pid not in pr['eligible']:
        raise ValueError('No pending reaction to block with')
    state['reactionBlock'] = {
        'windowId': pr['id'], 'anchorId': pr['anchorId'], 'attackerId': pr['attackerId'],
        'blockerId': pid, 'blockerName': participant['name'],
    }
    _log_event(state, 'reaction-block', text=f"{participant['name']} blocks the attack!",
               actorId=pid, actorName=participant['name'])


def _maybe_close_reaction_window(state):
    """Closes the window the moment every eligible participant has answered
    (accepted-and-finished their reaction, or explicitly declined), rather
    than always waiting out the full 10 seconds. No-ops while someone
    currently holds the floor -- see _close_reaction_window's own note on
    never cutting a reaction off mid-use."""
    pr = state['pendingReaction']
    if not pr or state['reactingParticipantId']:
        return
    if all(e['responded'] for e in pr['eligible'].values()):
        state['pendingReaction'] = None
        _log_event(state, 'reaction-window-close', text='Reaction window closed (all answered)')


def _close_reaction_window(state):
    """Called by the attacker's own client once its local countdown to the
    window's expiresAt runs out -- no server-side background timer in this
    request-per-action model (same reasoning as _advance_turn's client-driven
    turn timing). Refuses while someone currently holds the floor
    (reactingParticipantId set): never force-close mid-reaction just because
    the DECIDE window's clock ran out -- the caller retries shortly after
    instead. Treats anyone who never answered as having declined."""
    pr = state['pendingReaction']
    if not pr:
        return
    if state['reactingParticipantId']:
        raise ValueError('Someone is still reacting -- try again shortly')
    state['pendingReaction'] = None
    _log_event(state, 'reaction-window-close', text='Reaction window closed (time expired)')


def _active_participant_id(state):
    if state['reactingParticipantId']:
        return state['reactingParticipantId']
    if state['turnOrder']:
        return state['turnOrder'][state['turnIndex']]
    return None


# ---------------------------------------------------------------------------
# Statuses -- live effects on a participant: conditions, stat modifiers,
# advantage/disadvantage. The shape is a move's `effects` entry (see
# pi-server/docs/move-effects-schema.md) minus `when`/`choice` (those only
# decide WHETHER it gets applied, which the client works out from the rolls it
# recorded), plus who applied it and the runtime state of each `ends` entry.
# Any ONE ends entry firing removes the status. Nothing here rolls dice or
# decides a save -- humans do that at the table; the server only stores what
# they report and expires what the turn/round counters say has run out.
# ---------------------------------------------------------------------------

_STATUS_KINDS = ('condition', 'stat', 'roll', 'temp_hp', 'heal')
_END_TYPES = ('rounds', 'until_turn', 'save', 'concentration', 'encounter', 'long_rest', 'uses', 'instant', 'other')
# value2: a type_changed condition's optional second type (Reflect Type copying a
# dual-type creature) -- every other condition/kind only ever uses `value`.
# repeat: a `heal` status only (Aqua Ring/Ingrain's heal-over-time) -- 'start_of_turn' |
# 'end_of_turn', re-triggers the heal at the HOLDER's own turn boundary each time it's
# still active (see combat-wip.js's _promptTurnHeals). A one-shot `heal` effect (every
# drain, every plain heal-on-use move) never reaches this at all -- it's intercepted
# client-side and applied directly, same as reroll_damage.
# ability: a roll/stat saving_throws effect scoped to one ability only
# (Hammer Arm's "disadvantage on DEX saves") -- unset applies broadly, same
# as before this field existed. See move-effects.js's _abilityMatches.
_STATUS_FIELDS = ('kind', 'apply', 'value', 'value2', 'stat', 'amount', 'set', 'roll', 'on', 'note', 'repeat', 'ability')


def _statuses_of(participant):
    return participant.setdefault('statuses', [])


def _status_label(s):
    """Human-readable name for a stored/incoming status, used in the log."""
    kind = s.get('kind')
    if kind == 'condition':
        if s.get('apply') == 'type_changed' and s.get('value'):
            types = s['value'] + (f"/{s['value2']}" if s.get('value2') else '')
            return f"type changed to {types}"
        if s.get('apply') == 'resistance_upgrade':
            scope = 'all types' if s.get('value') == 'all' else (s.get('value') or '')
            return f"resistance upgraded ({scope})"
        if s.get('apply') == 'granted_immunity':
            return f"immune to {s.get('value') or ''}"
        return (s.get('apply') or '').replace('_', ' ')
    if kind == 'stat':
        stat = (s.get('stat') or '').replace('_', ' ')
        if s.get('stat') == 'saving_throws' and s.get('ability'):
            stat = f"{s['ability']} {stat}"
        if 'set' in s:
            return f"{stat} set to {s['set']}"
        amount = s.get('amount')
        if amount == 'proficiency':
            return f'{stat} +proficiency bonus'
        if isinstance(amount, int):
            return f"{stat} {amount * s.get('stacks', 1):+d}"
        return stat
    if kind == 'temp_hp':
        remaining = s.get('remaining')
        return f"{remaining} temporary HP" if remaining is not None else 'temporary HP'
    if kind == 'heal':
        amount = s.get('amount') or {}
        pool = amount.get('pool', 'HP')
        if amount.get('fractionOfDamage'):
            return f"heal {round(amount['fractionOfDamage'] * 100)}% of damage dealt ({pool})"
        if amount.get('levelMultiple'):
            return f"heal {amount['levelMultiple']}x level ({pool})"
        if amount.get('dice'):
            return f"heal {amount['dice']}{' + MOVE' if amount.get('moveMod') else ''} ({pool})"
        return f"heal ({pool})"
    on = f"{s['ability']} saving throws" if s.get('on') == 'saving_throws' and s.get('ability') else (s.get('on') or '').replace('_', ' ')
    return f"{s.get('roll')} on {on}"


def _same_status(a, b):
    """Re-applying the same effect from the same source's same move refreshes
    (or stacks) it rather than piling up duplicates."""
    keys = ('kind', 'apply', 'value', 'stat', 'roll', 'on', 'sourceId', 'moveName')
    return all(a.get(k) == b.get(k) for k in keys)


def _prime_end(e, state, holder_id, source_id):
    """One incoming ends entry -> its stored form, with the runtime bookkeeping
    each type needs."""
    e = dict(e)
    kind = e['type']
    if kind == 'rounds':
        n = js_parse_int(e.get('n'))
        if n and n > 0:
            e['n'] = n
            e['expiresRound'] = state['round'] + n
        else:
            # Dice never got rolled, so there's nothing to schedule: keep it as
            # a reminder the holder's table removes by hand.
            unit = e.get('unit', 'round')
            return {'type': 'other', 'text': f"{e.get('dice', 'unrolled duration')} {unit}s"}
    elif kind == 'until_turn':
        e['count'] = max(1, js_parse_int(e.get('count')) or 1)
        who = source_id if e.get('whose') == 'source' else holder_id
        # "The end of their next turn", applied during their own turn, means the
        # following one -- so this turn's end doesn't count.
        e['skip'] = e.get('point') == 'end' and who is not None and who == _active_participant_id(state)
    elif kind == 'uses':
        e['left'] = max(1, js_parse_int(e.get('n')) or 1)
    return e


def _apply_status(state, target_id, spec):
    target = state['participants'].get(target_id)
    if not target:
        raise ValueError('Unknown participant: ' + target_id)
    if spec.get('kind') not in _STATUS_KINDS:
        raise ValueError('status kind must be condition, stat, roll, temp_hp or heal')
    raw_ends = spec.get('ends') or []
    for e in raw_ends:
        if not isinstance(e, dict) or e.get('type') not in _END_TYPES:
            raise ValueError('Unknown status end: ' + json.dumps(e))

    source_id = spec.get('sourceId') or None
    source = state['participants'].get(source_id) if source_id else None
    source_name = source['name'] if source else spec.get('sourceName')
    move_name = spec.get('moveName', '')
    new = {k: spec[k] for k in _STATUS_FIELDS if k in spec}
    new.update({'sourceId': source_id, 'sourceName': source_name, 'moveName': move_name})
    from_text = f" (from {source_name}'s {move_name})" if source_name and move_name else ''

    if any(e['type'] == 'instant' for e in raw_ends):
        # Announced, never stored (e.g. a forced 15 ft move).
        _log_event(state, 'status-apply', text=f"{target['name']}: {_status_label(new)}{from_text}",
                   actorId=source_id, actorName=source_name, targetId=target_id, targetName=target['name'])
        return

    new['dc'] = js_parse_int(spec.get('dc'))
    new['appliedRound'] = state['round']
    new['ends'] = [_prime_end(e, state, target_id, source_id) for e in raw_ends]

    statuses = _statuses_of(target)
    existing = next((s for s in statuses if _same_status(s, new)), None)
    new['id'] = existing['id'] if existing else uuid.uuid4().hex[:8]
    if spec.get('kind') == 'temp_hp':
        # A fresh pool, full size -- re-applying the same source's same move (Acupressure
        # re-rolled) REPLACES it outright via the existing/statuses[...] = new swap below,
        # same as any other non-stacking status; nothing here carries a partial pool over.
        new['remaining'] = js_parse_int(spec.get('amount')) or 0
    stack_max = js_parse_int((spec.get('stacks') or {}).get('max')) if spec.get('kind') == 'stat' else None
    verb = 'is now'
    if stack_max:
        new['stackMax'] = stack_max
        new['stacks'] = min(stack_max, (existing.get('stacks', 1) if existing else 0) + 1)
        if new['stacks'] > 1:
            verb = f"stacked to x{new['stacks']}:"
    if existing:
        statuses[statuses.index(existing)] = new
    else:
        statuses.append(new)
    _log_event(state, 'status-apply', text=f"{target['name']} {verb} {_status_label(new)}{from_text}",
               actorId=source_id, actorName=source_name, targetId=target_id, targetName=target['name'])


def _find_status(state, target_id, status_id):
    target = state['participants'].get(target_id)
    if not target:
        raise ValueError('Unknown participant: ' + target_id)
    for s in _statuses_of(target):
        if s['id'] == status_id:
            return target, s
    raise ValueError('Unknown status: ' + status_id)


def _remove_status(state, target_id, status_id, reason=''):
    target, s = _find_status(state, target_id, status_id)
    _statuses_of(target).remove(s)
    _log_event(state, 'status-remove', text=f"{target['name']}: {_status_label(s)} ended" + (f' ({reason})' if reason else ''),
               targetId=target_id, targetName=target['name'])


def _use_status(state, target_id, status_id):
    """Consumes one use of a `uses` end (an advantage/disadvantage or bonus that
    lasts "the next attack"); the status goes away once a uses entry runs out."""
    target, s = _find_status(state, target_id, status_id)
    for e in s.get('ends', []):
        if e.get('type') == 'uses' and e.get('left', 0) > 0:
            e['left'] -= 1
            if e['left'] <= 0:
                _remove_status(state, target_id, status_id, 'used up')
            return
    raise ValueError('That status has no uses left')


def _expire_status(state, participant, s, why):
    _statuses_of(participant).remove(s)
    _log_event(state, 'status-expire', text=f"{participant['name']}: {_status_label(s)} wore off ({why})",
               targetId=participant['id'], targetName=participant['name'])


def _expire_statuses_on_turn_point(state, pid, point):
    """A turn just ended/started for `pid`: fire every until_turn end waiting on it."""
    for p in state['participants'].values():
        for s in list(_statuses_of(p)):
            for e in s.get('ends', []):
                if e.get('type') != 'until_turn' or e.get('point') != point:
                    continue
                who = s.get('sourceId') if e.get('whose') == 'source' else p['id']
                if who != pid:
                    continue
                if e.get('skip'):
                    e['skip'] = False
                    continue
                e['count'] = e.get('count', 1) - 1
                if e['count'] <= 0:
                    _expire_status(state, p, s, f'{point} of the turn')
                    break


def _absorb_temp_hp(state, target, amount):
    """Drains `amount` of incoming damage from any active `temp_hp` status on
    `target` before it reaches real HP (standard temp-HP absorption order),
    removing the status once its pool empties. Returns the leftover still owed
    to currentHP (0 if the pool covered it all, `amount` unchanged if there's
    no active pool or amount isn't positive -- healing/0-damage never touches it)."""
    remaining = amount
    if remaining <= 0:
        return remaining
    for s in list(_statuses_of(target)):
        if remaining <= 0:
            break
        if s.get('kind') != 'temp_hp':
            continue
        pool = s.get('remaining', 0)
        if pool <= 0:
            continue
        absorbed = min(pool, remaining)
        s['remaining'] = pool - absorbed
        remaining -= absorbed
        _log_event(state, 'status-absorb', text=f"{target['name']}'s temporary HP absorbed {absorbed} damage",
                   targetId=target['id'], targetName=target['name'])
        if s['remaining'] <= 0:
            _remove_status(state, target['id'], s['id'], 'absorbed')
    return remaining


def _expire_statuses_by_round(state):
    for p in state['participants'].values():
        for s in list(_statuses_of(p)):
            if any(e.get('type') == 'rounds' and e.get('expiresRound') is not None
                   and state['round'] >= e['expiresRound'] for e in s.get('ends', [])):
                _expire_status(state, p, s, 'duration over')


def _apply_move(conn, state, pid, move_name, vp_cost, target_id, dice_roll, move_type):
    attacker = state['participants'].get(pid)
    if not attacker:
        raise ValueError('Unknown participant: ' + pid)
    if pid != _active_participant_id(state):
        raise ValueError("It's not this participant's turn")
    state['started'] = True  # see _rebuild_turn_order -- someone acting means turn order is now live

    # VP floors at 0; overflow drains the user's own HP with NO floor --
    # negative HP is how this game reads injury severity/death saves, and
    # that applies to self-inflicted VP overflow exactly like any other
    # damage. (This used to clamp the overflow at 0 HP -- a bug, fixed here
    # together with the same clamp in combat.js's onUseMove and three other
    # spots in that file.)
    new_vp = attacker['currentVP'] - vp_cost
    new_hp = attacker['currentHP']
    if new_vp < 0:
        new_hp += new_vp
        new_vp = 0
    attacker['currentHP'] = new_hp
    attacker['currentVP'] = new_vp
    _log_event(state, 'move-used', text=f"{attacker['name']} used {move_name} (-{vp_cost} VP)",
               actorId=pid, actorName=attacker['name'], move=move_name, vpCost=vp_cost)

    outcome = {}
    if target_id:
        target = state['participants'].get(target_id)
        if not target:
            raise ValueError('Unknown target: ' + target_id)
        if dice_roll:
            multiplier = _type_multiplier(conn, move_type, target.get('type1'), target.get('type2'), target)
            actual_damage = round(dice_roll * multiplier)
            leftover = _absorb_temp_hp(state, target, actual_damage)
            target['currentHP'] -= leftover  # no floor, same reasoning as above
            outcome = {'multiplier': multiplier, 'damageApplied': actual_damage}
            move_label = f' with {move_name}' if move_name else ''
            _log_event(
                state, 'damage',
                text=f"{attacker['name']} hit {target['name']}{move_label} for {actual_damage} damage ({multiplier}x)",
                actorId=pid, actorName=attacker['name'], targetId=target_id, targetName=target['name'],
                move=move_name, moveType=move_type, amount=actual_damage, multiplier=multiplier,
            )
    return outcome


def _apply_damage(conn, pid, target_id, dice_roll, move_type, species, move_name=''):
    """The other half of resolving an attack, split out from use-move: that
    action's VP cost was for a single-participant local engine (combat.js's
    own move popup, driven client-side) that already handles spending VP and
    each move's special-case mechanics (Ingrain, Stockpile, etc.) entirely
    on its own, synced up via update-stats -- calling use-move too would
    double-deduct VP for the same move. This does only the target half:
    given a dice roll the client already added its own damage modifier to
    (computeMoveData's damageBonus -- combat.js already computes and shows
    this in the move popup, so there's no reason to duplicate that
    calculation server-side), convert it to damage via type effectiveness
    and apply it. Same turn-authority rule as every other on-turn action."""
    outcome = {}
    result = _mutate(conn, lambda s: outcome.update(
        _apply_damage_to_target(conn, s, pid, target_id, dice_roll, move_type, move_name)))
    result.update(outcome)

    attacker = result['data']['participants'].get(pid, {})
    live.publish({
        'type': 'combat-animation',
        'participantId': pid,
        'species': species or attacker.get('name', ''),
    })
    return result


def _apply_damage_to_target(conn, state, pid, target_id, dice_roll, move_type, move_name=''):
    attacker = state['participants'].get(pid)
    if not attacker:
        raise ValueError('Unknown participant: ' + pid)
    if pid != _active_participant_id(state):
        raise ValueError("It's not this participant's turn")
    target = state['participants'].get(target_id)
    if not target:
        raise ValueError('Unknown target: ' + target_id)
    state['started'] = True  # see _rebuild_turn_order -- someone acting means turn order is now live

    multiplier = _type_multiplier(conn, move_type, target.get('type1'), target.get('type2'), target)
    actual_damage = round(dice_roll * multiplier)
    leftover = _absorb_temp_hp(state, target, actual_damage)
    target['currentHP'] -= leftover  # no floor, same reasoning as elsewhere in this module
    move_label = f' with {move_name}' if move_name else ''
    _log_event(
        state, 'damage',
        text=f"{attacker['name']} hit {target['name']}{move_label} for {actual_damage} damage ({multiplier}x)",
        actorId=pid, actorName=attacker['name'], targetId=target_id, targetName=target['name'],
        move=move_name, moveType=move_type, amount=actual_damage, multiplier=multiplier,
    )
    return {'multiplier': multiplier, 'damageApplied': actual_damage}


# ---------------------------------------------------------------------------
# Battle map -- see the 'board' shape on _EMPTY_STATE above. Two ways to
# move a token, matching two different actors:
#   - set-token-position (_set_token_position): DM/setup placement, NOT
#     turn-gated -- the DM places/repositions any token (including enemies)
#     whenever, same as the WIP test controls do today.
#   - move-token (_move_token): a player moving their own token during
#     combat. Turn-gated exactly like use-move -- only whoever currently
#     has the floor (active turn, or mid-reaction) can move, and only
#     themselves. Also rejected outright for a mover with a condition in
#     _MOVEMENT_BLOCKING_CONDITIONS (Ingrain's "may not move" -- see its
#     own `trapped` condition effect). Range/distance limits and terrain-
#     blocking are still explicit future work -- this only enforces whose
#     turn it is and whether they can act at all.
# ---------------------------------------------------------------------------

def _set_board_template(state, cols, rows):
    # Changing grid size invalidates any existing terrain marks (they were
    # placed against the old dimensions), but leaves token positions as-is --
    # simplicity over defensive bounds-checking, consistent with how lightly
    # this file already treats edge cases elsewhere.
    state['board']['templateType'] = 'grid'
    state['board']['grid'] = {'cols': cols, 'rows': rows}
    state['board']['cells'] = {}


def _set_cell_terrain(state, col, row, terrain):
    key = f'{col},{row}'
    if terrain:
        state['board']['cells'][key] = {'terrain': terrain}
    else:
        state['board']['cells'].pop(key, None)


_BACKGROUND_FILENAME_RE = re.compile(r'^battle-(.+)\.png$', re.IGNORECASE)


def _list_backgrounds():
    """Battle-map background images available on disk (see
    upstream.BATTLE_IMAGE_DIR) -- named battle-<key>.png, e.g.
    battle-forest.png -> {"key": "forest", "label": "Forest", "url": "/battle-images/battle-forest.png"}.
    Not session state (doesn't touch `state` at all) -- just a filesystem
    listing, same "browsable directory" reasoning as routes_gamedata.py's
    media_list(), kept here instead since this is purely a combat/board
    concern with nothing else needing to know about it."""
    if not os.path.isdir(upstream.BATTLE_IMAGE_DIR):
        return {'status': 'success', 'backgrounds': []}
    backgrounds = []
    for filename in sorted(os.listdir(upstream.BATTLE_IMAGE_DIR)):
        m = _BACKGROUND_FILENAME_RE.match(filename)
        if not m:
            continue
        key = m.group(1)
        label = key.replace('_', ' ').replace('-', ' ').title()
        backgrounds.append({'key': key, 'label': label, 'url': f'/battle-images/{filename}'})
    return {'status': 'success', 'backgrounds': backgrounds}


def _load_move_data_file():
    """Fresh read of upstream.MOVES_FILE (DnD_moves_categorized_draft.json) --
    the full per-move record (categories, effects, reactionTrigger/
    reactionRange, ...), not just the raw [name, type, ...] row
    upstream.fetch_moves returns. No caching, same reasoning as
    _list_move_categories below: an in-progress editing session on the Pi is
    picked up on the very next read. {'moves': []} on any read failure --
    every caller already treats a miss as "nothing special here", never a
    hard error."""
    try:
        with open(upstream.MOVES_FILE, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return {'moves': []}


def _list_move_categories():
    """{moveName: [category, ...]} for every move that's been through the
    user's manual categorization pass so far -- a move with no entry here
    just means "not categorized yet" client-side (see combat.js's
    moveCategoriesFor), not an error. Missing/unparseable file -> empty
    dict, same reasoning: a category lookup miss should never block using
    a move, only skip whatever specialized flow that category would have
    triggered (see showCombatMoveDetails's _isSaveTriggered check).

    Also returns `effects`: {moveName: [effect, ...]} for the moves that have a
    structured `effects` list (which condition a move applies and what triggers
    it -- schema in pi-server/docs/move-effects-schema.md). Same
    miss-is-not-an-error rule: no entry just means "no structured effects"."""
    moves = _load_move_data_file().get('moves', [])
    categories = {m['name']: m.get('categories', []) for m in moves}
    effects = {m['name']: m['effects'] for m in moves if m.get('effects')}
    return {'status': 'success', 'categories': categories, 'effects': effects}


def _set_board_background(state, url):
    state['board']['backgroundImage'] = url or None


def _set_token_position(state, pid, col, row):
    if pid not in state['participants']:
        raise ValueError('Unknown participant: ' + pid)
    state['board']['tokens'][pid] = {'col': col, 'row': row}


# Conditions that block voluntary movement entirely, checked below -- a
# small, deliberately explicit allowlist rather than every condition that
# SOUNDS like it should stop someone (most still have no mechanical
# enforcement at all, see move-effects-schema.md's own "Not applied yet"
# note -- this is the first). 'trapped' is the one this app already gives
# that exact meaning ("cannot flee or be switched out" -- see
# migrate_effects_v2.py's OTHER_TO_CONDITION), used by Ingrain and
# Thousand Waves alike.
_MOVEMENT_BLOCKING_CONDITIONS = {'trapped'}


def _move_token(state, pid, col, row):
    participant = state['participants'].get(pid)
    if not participant:
        raise ValueError('Unknown participant: ' + pid)
    if pid != _active_participant_id(state):
        raise ValueError("It's not this participant's turn")
    blocking = next((s for s in _statuses_of(participant)
                      if s.get('kind') == 'condition' and s.get('apply') in _MOVEMENT_BLOCKING_CONDITIONS), None)
    if blocking:
        raise ValueError(f"{participant['name']} is {blocking['apply']} and can't move")

    # Movement budget -- skipped entirely for a participant with no `speeds`
    # recorded (a DM's freeform enemy, or anyone added before this existed),
    # same "missing means untracked" convention `speeds` itself documents.
    # Grid distance -> feet uses the simplified "diagonal costs the same as
    # straight" rule (Chebyshev distance x 5ft), not 5e's stricter 5/10ft
    # alternating-diagonal rule -- consistent with this board having no
    # other terrain-cost concept yet either.
    #
    # Deliberately doesn't ask (or care) WHICH movement type covers this
    # move -- the user's own call: that decision (is this walk-able terrain,
    # is this a burrow, ...) happens at the table, not in the app. The app
    # only needs to know whether the distance is possible under ANY of the
    # participant's own types, so the check is against whichever type has
    # the most left, and the single shared movementUsed counter (see
    # `speeds`' own comment) is what actually drops every type's own
    # remaining number together afterwards.
    speeds = participant.get('speeds') or []
    if speeds:
        current = state['board']['tokens'].get(pid)
        distance_ft = max(abs(col - current['col']), abs(row - current['row'])) * 5 if current else 0
        used = participant.get('movementUsed', 0)
        best_remaining = max(max(0, s['ft'] - used) for s in speeds)
        if distance_ft > best_remaining:
            raise ValueError(f"Not enough movement left ({best_remaining}ft remaining, this move needs {distance_ft}ft)")
        participant['movementUsed'] = used + distance_ft

    state['started'] = True  # see _rebuild_turn_order -- acting on-turn means turn order is now live
    state['board']['tokens'][pid] = {'col': col, 'row': row}
    _log_event(state, 'move', text=f"{participant['name']} moved to ({col}, {row})",
               actorId=pid, actorName=participant['name'], col=col, row=row)


def _clear_token_position(state, pid):
    state['board']['tokens'].pop(pid, None)


def _confirm_placement(state, pid, col, row):
    """The per-player placement step (see combat-wip.js's placement screen):
    like set-token-position (unrestricted, not turn-gated -- this happens
    before battle even starts), but also marks the participant placed so
    that player's client knows to move on once every participant they own
    has one. Two participants can't end up on the same cell -- rejected
    here as the authoritative check; the placement screen also greys out
    an occupied-or-currently-hovered cell client-side so this should be
    a rare race rather than the normal path to seeing this error."""
    participant = state['participants'].get(pid)
    if not participant:
        raise ValueError('Unknown participant: ' + pid)
    for other_id, pos in state['board']['tokens'].items():
        if other_id != pid and pos['col'] == col and pos['row'] == row:
            raise ValueError('That square is already taken')
    state['board']['tokens'][pid] = {'col': col, 'row': row}
    participant['placed'] = True
    _log_event(state, 'placement', text=f"{participant['name']} placed at ({col}, {row})",
               actorId=pid, actorName=participant['name'], col=col, row=row)
