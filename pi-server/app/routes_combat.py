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
from .conditions import INCAPACITATING_CONDITIONS, REACTION_BLOCKING_CONDITIONS, condition_turn_damage, effective_speed_multiplier, zero_speed_condition, blocking_shield, incoming_damage_multiplier, outgoing_damage_multiplier, speed_override, granted_speed_entries, disabled_moves, move_lock
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
    # Set by apply-reaction-damage-multiplier (see _apply_reaction_damage_multiplier)
    # when a reactor's own move applies a `damage_multiplier` effect (Wide
    # Guard) -- {windowId, anchorId, attackerId, reactorId, reactorName,
    # multiplier}, or None. Same never-cleared-automatically/windowId-scoped
    # reasoning as reactionBlock, and deliberately a SEPARATE field from it
    # (a block cancels the attack outright; a multiplier only scales the
    # damage that still lands) -- reaction-window.js's waitForReactionWindow
    # reads both and a caller can act on either or neither.
    'reactionDamageMultiplier': None,
    'participants': {},
    'fieldEffects': [],
    # Shared weather/terrain -- {name, effect} freeform (the DM types both,
    # same shape combat.js's own weather/terrain badge already used when
    # this lived purely on ONE device's local combatState), or None. Moved
    # onto the session so every viewer sees the same value instead of only
    # whichever device happened to set it -- Solar Beam/Solar Blade's own
    # "if used in harsh sunlight" damage_note condition (self_weather_contains)
    # needs this to actually be visible to whoever's USING the move, not
    # just the DM's own screen. See _set_weather/_set_terrain below.
    'weather': None,
    'terrain': None,
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
        # 'beneficial': a creature ABOUT TO USE a move with a positive effect
        # on itself (a self-buff/self-heal) -- the one case `_handleEffectsOnly`
        # (combat-wip.js, the self-only move flow) never opened ANY window
        # for before Heal Block/Strength Sap/Spectral Surge/Snatch needed one.
        # Anchored on the CASTER themselves (both anchorId and attackerId),
        # same as every other trigger -- _eligible_reactors doesn't care
        # which trigger name it's given, only that it matches a candidate's
        # own reactionTrigger.
        if trigger not in ('targeted', 'damaged', 'beneficial'):
            raise ValueError('trigger must be targeted, damaged, or beneficial')
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
        return _mutate(conn, lambda s: _block_pending_attack(s, params['id'], params.get('moveName', '')))

    if action == 'negate-reaction-block':
        if not params.get('id'):
            raise ValueError('Missing participant id')
        return _mutate(conn, lambda s: _negate_reaction_block(s, params['id'], _load_move_data_file()))

    if action == 'apply-reaction-damage-multiplier':
        if not params.get('id'):
            raise ValueError('Missing participant id')
        multiplier = float(params.get('multiplier', 0.5))
        return _mutate(conn, lambda s: _apply_reaction_damage_multiplier(s, params['id'], multiplier))

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
        # Every param arrives as a query-string value (see api.js's own
        # URLSearchParams-based request()), so a JS `false` reaches here as
        # the STRING "false" -- truthy under a bare bool(...), hence the
        # explicit string check.
        crit = str(params.get('crit', '')).lower() == 'true'
        return _apply_damage(
            conn, params['id'], params['targetId'], dice_roll,
            move_type=params.get('moveType', ''),
            species=params.get('species'),
            move_name=params.get('moveName', ''),
            crit=crit,
        )

    if action == 'retype-last-damage':
        if not params.get('id') or not params.get('newType'):
            raise ValueError('Missing participant id or newType')
        outcome = {}
        result = _mutate(conn, lambda s: outcome.update(_retype_last_damage(conn, s, params['id'], params['newType'])))
        result.update(outcome)
        return result

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

    if action == 'update-item':
        if not params.get('id'):
            raise ValueError('Missing participant id')
        return _mutate(conn, lambda s: _update_item(s, params['id'], params.get('item', '')))

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

    if action == 'set-weather':
        return _mutate(conn, lambda s: _set_weather(s, params.get('name', ''), params.get('effect', '')))

    if action == 'set-terrain':
        return _mutate(conn, lambda s: _set_terrain(s, params.get('name', ''), params.get('effect', '')))

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

    if action == 'stand-up':
        if not params.get('id'):
            raise ValueError('Missing participant id')
        return _mutate(conn, lambda s: _stand_up(s, params['id']))

    if action == 'clear-token-position':
        if not params.get('id'):
            raise ValueError('Missing participant id')
        return _mutate(conn, lambda s: _clear_token_position(s, params['id']))

    if action == 'bide-use':
        if not params.get('id'):
            raise ValueError('Missing participant id')
        hold = str(params.get('hold', '')).lower() in ('1', 'true')
        return _mutate(conn, lambda s: _bide_use(s, params['id'], hold))

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


def _damage_taken_since(state, pid, since_log_id):
    """Total damage `pid` has taken from the log entry AFTER `since_log_id`
    onward -- Bide's own tally (see _bide_use), the general-purpose cousin
    of _damage_taken_this_round above (an arbitrary marker instead of "this
    round"). 0 if the marker itself isn't found (a stale id from a log that
    somehow got reset -- shouldn't happen, the log is append-only and never
    trimmed, but never worth raising over)."""
    log = state.get('log', [])
    idx = next((i for i, entry in enumerate(log) if entry.get('id') == since_log_id), None)
    if idx is None:
        return 0
    return sum(
        entry.get('amount', 0) for entry in log[idx + 1:]
        if entry.get('type') == 'damage' and entry.get('targetId') == pid
    )


def _bide_use(state, pid, hold=False):
    """Bide's own two-phase toggle -- the client always calls this same
    action regardless of which phase it's in, and reads the resulting
    participant record to tell which one just happened (bideChargingSinceLogId
    now set = just activated, pendingBideDamage now set = just resolved --
    see combat-wip.js's _syncLocalCombatState). Not activated: starts
    tracking, logs it, no damage yet -- a self-only use, same authority
    check as any other on-turn action, no target/VP handling here (that's
    apply-damage's own job once the resolved attack actually goes through
    target-picker). Already charging: `hold` (10th level+ only, checked
    client-side against the combatant's own level -- this function only
    enforces the "just once" part) leaves the marker untouched -- charging
    just keeps going, letting more damage accumulate, the move's own
    "chance to add additional damage" if you wait -- rather than resolving.
    Otherwise sums damage taken since that marker (_damage_taken_since),
    doubles it, and clears the marker."""
    participant = state['participants'].get(pid)
    if not participant:
        raise ValueError('Unknown participant: ' + pid)
    if pid != _active_participant_id(state):
        raise ValueError("It's not this participant's turn")

    since_id = participant.get('bideChargingSinceLogId')
    if not since_id:
        entry = _log_event(state, 'bide-activate', text=f"{participant['name']} braces, waiting to strike back",
                            actorId=pid, actorName=participant['name'])
        participant['bideChargingSinceLogId'] = entry['id']
        participant['pendingBideDamage'] = None
        participant['bideHeld'] = False
    elif hold:
        if participant.get('bideHeld'):
            raise ValueError('Bide can only be held for one extra turn')
        participant['bideHeld'] = True
        _log_event(state, 'bide-hold', text=f"{participant['name']} holds Bide for one more turn",
                   actorId=pid, actorName=participant['name'])
    else:
        taken = _damage_taken_since(state, pid, since_id)
        dealt = taken * 2
        participant['bideChargingSinceLogId'] = None
        participant['pendingBideDamage'] = dealt
        participant['bideHeld'] = False
        _log_event(state, 'bide-resolve',
                   text=f"{participant['name']} unleashes Bide for {dealt} damage ({taken} taken while charging)",
                   actorId=pid, actorName=participant['name'], amount=dealt)


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
        # Bide's own two-phase state (see _bide_use) -- bideChargingSinceLogId
        # is the log entry id marking when charging started (None when not
        # charging), pendingBideDamage is the computed payoff once resolved
        # (None until then), bideHeld is the 10th-level "held for one extra
        # turn" flag (see move-effects-schema.md's own Bide note) -- allowed
        # once per charge, reset back to False on the NEXT activation.
        # Blank/None/False for every other move -- this is only ever touched
        # by the bide-use action.
        'bideChargingSinceLogId': None,
        'pendingBideDamage': None,
        'bideHeld': False,
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


def _update_item(state, pid, item):
    """Covet/Thief's own mechanism needs SOME way to move a held item between
    two participants, and `item` (a comma-separated freeform string, same
    shape as `abilities`) had no write path during combat at all before this
    -- only ever set once, at participant-creation time, from the sheet's
    own data. Unlike `abilities`' own overlay-less mutation problem (see
    move-effects-schema.md's own "not covered yet" note on Entrainment/Role
    Play/Simple Beam/Skill Swap), an item transfer is PERMANENT, not "for a
    duration" -- there's no restore-on-expiry to design around, just a plain
    client-authoritative field sync, same trust model `_update_stats`
    already uses for HP/VP."""
    participant = state['participants'].get(pid)
    if not participant:
        raise ValueError('Unknown participant: ' + pid)
    participant['item'] = item


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


def _apply_condition_turn_damage(state, pid, point):
    """Burning/Poisoned's automatic proficiency-bonus damage tick at turn
    point `point` ('start'/'end') -- deterministic (no dice), so unlike a
    repeat `heal` status or a repeat save (client-driven, see
    pendingTurnSaves/pendingTurnHeals) this applies on its own, the same
    moment _advance_turn's own ends-expiry runs for that turn point. Same
    temp-HP-absorbs-first, no-floor-at-0 damage path as every other source
    of damage in this module."""
    participant = state['participants'].get(pid)
    if not participant:
        return
    for apply_name, amount in condition_turn_damage(participant, point):
        leftover = _absorb_temp_hp(state, participant, amount)
        participant['currentHP'] -= leftover
        _log_event(state, 'status-damage', text=f"{participant['name']} takes {amount} damage from being {apply_name}",
                   actorId=pid, actorName=participant['name'])


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
        _apply_condition_turn_damage(state, ending_id, 'end')
        _expire_statuses_on_turn_point(state, ending_id, 'end')
    if new_round:
        _expire_statuses_by_round(state)
    starting_id = state['turnOrder'][state['turnIndex']]
    _apply_condition_turn_damage(state, starting_id, 'start')
    _expire_statuses_on_turn_point(state, starting_id, 'start')


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
    blocking = next((s for s in _statuses_of(participant)
                      if s.get('kind') == 'condition' and s.get('apply') in REACTION_BLOCKING_CONDITIONS), None)
    if blocking:
        raise ValueError(f"{participant['name']} is {blocking['apply']} and can't react")

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


def _block_pending_attack(state, pid, move_name=''):
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
    reaction; this only leaves a note for the attacker to find.

    `move_name` (the reactor's own blocking move, e.g. "Protect") is stored
    on the record purely for Feint's own later use -- see
    _negate_reaction_block, which needs to know what move's VP cost to
    refund half of. Every OTHER reader of `reactionBlock` (reaction-window.js's
    waitForReactionWindow) only ever looked at windowId/blockerName, so this
    is additive."""
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
        'blockerId': pid, 'blockerName': participant['name'], 'moveName': move_name,
    }
    _log_event(state, 'reaction-block', text=f"{participant['name']} blocks the attack!",
               actorId=pid, actorName=participant['name'])


def _negate_reaction_block(state, pid, moves_data):
    """Feint's own mechanism: "When a creature you are targeting declares it
    will use Protect... you may use your reaction to activate Feint. Your
    attack bypasses the protection and resolves normally, and the target
    gets half the VP for the protection move refunded." Deliberately NOT
    modeled as a reaction to the reactor's own reaction -- this app's
    turn-authority model has exactly one floor-holder at a time, and by the
    time this can even be called the blocker's own reaction has already
    fully resolved (reactionBlock is set; the window may already be closed).
    Feint instead just checks identity against the recorded block: only the
    ORIGINAL ATTACKER of that specific block may ever call this, and only
    once (`rb['negated']` guards a double-use). No reaction-floor check at
    all -- this isn't "reacting" in the engine's sense, it's the attacker
    taking a follow-up action after learning the outcome, and this app has
    no reaction-economy tracking anywhere to spend against regardless (every
    already-shipped reaction move has this same gap).

    Never routed through the normal _apply_move/target-picker flow -- Feint
    is triggered directly from target-picker.js's own "blocked" state, not
    by the player picking a target and rolling an attack for it (there's
    nothing to target here; the attack it un-blocks is already fully
    specified by `reactionBlock`). So its own VP cost is charged HERE
    instead, same VP-floors-at-0-overflows-into-HP rule _apply_move already
    uses for every other move's cost."""
    rb = state.get('reactionBlock')
    if not rb:
        raise ValueError('No blocked attack to bypass')
    if rb.get('attackerId') != pid:
        raise ValueError('Not eligible to bypass this block')
    if rb.get('negated'):
        raise ValueError('Already bypassed')
    attacker = state['participants'].get(pid)
    if not attacker:
        raise ValueError('Unknown participant: ' + pid)

    moves_by_name = {m['name']: m for m in moves_data.get('moves', [])}
    feint = moves_by_name.get('Feint')
    feint_vp = js_parse_int(feint.get('vpCost')) if feint else 0
    new_vp = attacker['currentVP'] - (feint_vp or 0)
    new_hp = attacker['currentHP']
    if new_vp < 0:
        new_hp += new_vp
        new_vp = 0
    attacker['currentHP'] = new_hp
    attacker['currentVP'] = new_vp

    blocker = state['participants'].get(rb.get('blockerId'))
    blocker_move = moves_by_name.get(rb.get('moveName'))
    blocker_vp = js_parse_int(blocker_move.get('vpCost')) if blocker_move else 0
    refund = (blocker_vp or 0) // 2
    if blocker and refund:
        blocker['currentVP'] = (blocker.get('currentVP') or 0) + refund

    rb['negated'] = True
    refund_text = f" -- {blocker['name']} gets {refund} VP refunded" if blocker and refund else ''
    _log_event(state, 'move-used',
               text=f"{attacker['name']} used Feint (-{feint_vp or 0} VP) -- bypasses "
                    f"{blocker['name'] if blocker else 'the'} protection, the attack resolves normally{refund_text}",
               actorId=pid, actorName=attacker['name'], move='Feint', vpCost=feint_vp or 0)


def _apply_reaction_damage_multiplier(state, pid, multiplier):
    """Wide Guard's own mechanism: "As a reaction, when a creature activates
    a damaging move that damages multiple allies within range, you may halve
    the damage dealt." Recorded the same way `_block_pending_attack` records
    a block -- {windowId, anchorId, attackerId, reactorId, reactorName,
    multiplier} on a new top-level `reactionDamageMultiplier` field -- so the
    attacker's own client (still polling in waitForReactionWindow) can pick
    it up once the window closes, matched by windowId exactly like
    reactionBlock already is. Same reaction-floor requirement as
    _block_pending_attack (the caller must actually be holding the floor for
    a real pending window they were eligible for) -- unlike
    _negate_reaction_block, this IS an ordinary reaction, not a follow-up
    action outside the floor-holding model."""
    participant = state['participants'].get(pid)
    if not participant:
        raise ValueError('Unknown participant: ' + pid)
    if state['reactingParticipantId'] != pid:
        raise ValueError('Not currently holding a reaction')
    pr = state.get('pendingReaction')
    if not pr or pid not in pr['eligible']:
        raise ValueError('No pending reaction to apply this to')
    state['reactionDamageMultiplier'] = {
        'windowId': pr['id'], 'anchorId': pr['anchorId'], 'attackerId': pr['attackerId'],
        'reactorId': pid, 'reactorName': participant['name'], 'multiplier': multiplier,
    }
    pct = round((1 - multiplier) * 100)
    _log_event(state, 'reaction-block', text=f"{participant['name']} reduces the incoming damage by {pct}%!",
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
# healTargetId: a `repeat` heal only, Wish's own "at the end of YOUR next
# turn, heal a target in range" -- the repeat-heal machinery always fires
# at the STATUS HOLDER's own turn boundary (combat-wip.js's
# _promptTurnHeals/_applyRecurringHeal), so the status has to be held by
# the CASTER (to fire at the caster's own next turn end, not the healed
# target's) with this field saying who actually receives it. Every other
# repeat heal (Aqua Ring, Ingrain) is self-only, so holder and recipient
# were always the same participant before this.
_STATUS_FIELDS = ('kind', 'apply', 'value', 'value2', 'stat', 'amount', 'set', 'roll', 'on', 'note', 'repeat', 'ability', 'healTargetId')


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
        # following one -- so this turn's end doesn't count. `noSkip` opts a
        # caller OUT of that -- Confused's own "forfeits the rest of THIS
        # turn" (combat-wip.js's _promptConfusionCheck) is applied at the
        # START of the very turn it needs to expire at the END of, not their
        # NEXT one, so the disambiguation this skip exists for is exactly
        # backwards for it.
        e['skip'] = (not e.get('noSkip')) and e.get('point') == 'end' and who is not None and who == _active_participant_id(state)
    elif kind == 'uses':
        e['left'] = max(1, js_parse_int(e.get('n')) or 1)
    return e


def _apply_status(state, target_id, spec):
    target = state['participants'].get(target_id)
    if not target:
        raise ValueError('Unknown participant: ' + target_id)
    if spec.get('kind') not in _STATUS_KINDS:
        raise ValueError('status kind must be condition, stat, roll, temp_hp or heal')
    shield = blocking_shield(target, target_id, spec)
    if shield:
        # Mist/Safeguard -- a standing protection blocks THIS apply outright,
        # same "the app enforces what the rules say, no dice involved"
        # treatment as block_attack -- surfaced as an ordinary ValueError so
        # every existing apply-status call site's own error handling (just
        # fixed this session, see move-effects-schema.md's review-pass note)
        # already shows it correctly with no client changes needed.
        raise ValueError(f"{target['name']} is immune to that ({shield.title()})")
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

    if spec.get('kind') == 'condition' and spec.get('apply') == 'exhaustion':
        # Exhaustion is a single leveled status (1-6), not the usual
        # presence/absence condition -- and unlike every other status here,
        # a LATER application from a completely different source/move still
        # has to find and bump the SAME existing entry (_same_status's own
        # sourceId/moveName/value match would never do that, since the
        # whole point is the value changing). `value` on the incoming spec
        # is how many levels this application ADDS (the rulebook's own "one
        # or more levels, as specified" -- unspecified defaults to 1), not
        # the resulting level itself. Session-only for now (see the
        # status-conditions plan) -- no `ends` at all, cleared manually or
        # by a long rest outside combat, which this module has no hook into.
        return _apply_exhaustion(state, target, new, js_parse_int(spec.get('value')) or 1, from_text, source_id, source_name)

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


def _apply_exhaustion(state, target, new, increment, from_text, source_id, source_name):
    """See _apply_status's own call site for why this is special-cased
    entirely outside the generic stacking path."""
    existing = next((s for s in _statuses_of(target) if s.get('kind') == 'condition' and s.get('apply') == 'exhaustion'), None)
    if existing:
        existing['value'] = min(6, (existing.get('value') or 1) + increment)
        level = existing['value']
        text = f"{target['name']}'s Exhaustion increases to level {level}{from_text}"
    else:
        new['value'] = min(6, increment)
        new['id'] = uuid.uuid4().hex[:8]
        level = new['value']
        _statuses_of(target).append(new)
        text = f"{target['name']} gains Exhaustion (level {level}){from_text}"
    _log_event(state, 'status-apply', text=text, actorId=source_id, actorName=source_name,
               targetId=target['id'], targetName=target['name'])
    if level >= 6:
        # The rulebook's own level-6 effect is death outright -- deliberately
        # NOT auto-applied (no HP/fainted change here), same precedent as
        # Self-Destruct's own forced-death-save chain being left as a human
        # judgment call rather than automated.
        _log_event(state, 'status-apply', text=f"{target['name']} has reached Exhaustion level 6 -- death, per the rulebook (not auto-applied; a human decides how this plays out)",
                   targetId=target['id'], targetName=target['name'])


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
    incap = _incapacitating_status(attacker)
    if incap:
        raise ValueError(f"{attacker['name']} is {incap['apply']} and can't act")
    # Disable/Imprison/Oblivion Ink/Torment's own "this move can't be used"
    # and Encore's own "can ONLY use this move" -- the one real enforcement
    # point this whole family needed (conditions.py's own disabled_moves/
    # move_lock), since nothing here previously tracked per-move usability
    # at all.
    if move_name in disabled_moves(attacker):
        raise ValueError(f"{attacker['name']}'s {move_name} is currently disabled")
    lock = move_lock(attacker)
    if lock and move_name != lock:
        raise ValueError(f"{attacker['name']} can only use {lock} right now")
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


def _apply_damage(conn, pid, target_id, dice_roll, move_type, species, move_name='', crit=False):
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
    and apply it. Same turn-authority rule as every other on-turn action.

    `crit` is recorded on the log entry purely for Lucky Chant's own later
    use (a 'damaged' reaction reading `entry.crit` back off the most recent
    damage entry against the reactor) -- nothing else here reads it."""
    outcome = {}
    result = _mutate(conn, lambda s: outcome.update(
        _apply_damage_to_target(conn, s, pid, target_id, dice_roll, move_type, move_name, crit)))
    result.update(outcome)

    attacker = result['data']['participants'].get(pid, {})
    live.publish({
        'type': 'combat-animation',
        'participantId': pid,
        'species': species or attacker.get('name', ''),
    })
    return result


def _retype_last_damage(conn, state, reactor_id, new_type):
    """Electrify's own mechanism: "the attacking move's type is changed to
    electric" -- by the time a 'damaged' reaction can even fire, the hit
    already landed using its OWN type's multiplier, so this is a
    RETROACTIVE correction against the log entry, same family as
    reroll_damage/undo_crit_damage/negate_damage rather than anything that
    intercepts before the roll (avoids needing to thread a type override
    through target-picker.js's own multi-step attack-roll/damage-roll flow,
    which nothing else in this app does either). Reverses the ORIGINAL type
    multiplier to recover the raw roll (`amount / multiplier` -- a rounding
    approximation, same "close enough" trust level `round()` already
    accepts everywhere else in this file), recomputes with `new_type`
    against the reactor's own types, and adjusts HP by the difference --
    note this can make the hit WORSE, not just better, if the new type
    happens to be one the reactor is vulnerable to; Electrify's own rules
    text doesn't promise otherwise. Requires the caller to be currently
    holding the reaction floor, same gate every other reaction-triggered
    action in this file uses."""
    reactor = state['participants'].get(reactor_id)
    if not reactor:
        raise ValueError('Unknown participant: ' + reactor_id)
    if state['reactingParticipantId'] != reactor_id:
        raise ValueError('Not currently holding a reaction')
    original = next((e for e in reversed(state['log']) if e.get('type') == 'damage' and e.get('targetId') == reactor_id), None)
    if not original or not original.get('amount'):
        raise ValueError('No damage entry found to retype')
    old_type = original.get('moveType') or ''
    if old_type.lower() == new_type.lower():
        raise ValueError(f'That hit was already {new_type}-type')
    old_multiplier = original.get('multiplier') or 1
    amount = original['amount']
    raw = amount / old_multiplier if old_multiplier else amount
    new_multiplier = _type_multiplier(conn, new_type, reactor.get('type1'), reactor.get('type2'), reactor)
    new_amount = round(raw * new_multiplier)
    diff = new_amount - amount
    reactor['currentHP'] -= diff  # no floor, same reasoning as elsewhere in this module
    _log_event(
        state, 'damage',
        text=f"{reactor['name']}'s last hit is retyped to {new_type} -- damage adjusted from {amount} to {new_amount} ({new_multiplier}x)",
        targetId=reactor_id, targetName=reactor['name'], amount=new_amount, multiplier=new_multiplier, moveType=new_type,
    )
    return {'oldAmount': amount, 'newAmount': new_amount}


def _apply_damage_to_target(conn, state, pid, target_id, dice_roll, move_type, move_name='', crit=False):
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
    # Mat Block/Testudo Formation's own standing damage reductions -- applied
    # AFTER the type multiplier (kept separate, not folded into `multiplier`
    # itself: Nature's Embrace's own reactor-side "was I vulnerable"
    # check reads this logged field, and a Mat Block/Testudo hit shouldn't
    # look like a type-chart result it never was). condition_multiplier == 1
    # for the overwhelming majority of hits -- no condition to check.
    condition_multiplier = incoming_damage_multiplier(target) * outgoing_damage_multiplier(attacker)
    if condition_multiplier != 1:
        actual_damage = round(actual_damage * condition_multiplier)
    leftover = _absorb_temp_hp(state, target, actual_damage)
    target['currentHP'] -= leftover  # no floor, same reasoning as elsewhere in this module
    move_label = f' with {move_name}' if move_name else ''
    condition_note = ' -- Mat Block/Testudo Formation reduces this' if condition_multiplier != 1 else ''
    _log_event(
        state, 'damage',
        text=f"{attacker['name']} hit {target['name']}{move_label} for {actual_damage} damage ({multiplier}x){condition_note}",
        actorId=pid, actorName=attacker['name'], targetId=target_id, targetName=target['name'],
        move=move_name, moveType=move_type, amount=actual_damage, multiplier=multiplier, crit=bool(crit),
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
    miss-is-not-an-error rule: no entry just means "no structured effects".

    Also returns `flags`: {moveName: {negatesProtectBlock?: true}} for a move
    with a top-level marker the client needs but that isn't shaped like an
    `effects` entry at all -- so far just Feint's own `negatesProtectBlock`
    (target-picker.js's _afterTargetSelected scans the ATTACKER's whole
    moveset for one, to decide whether to offer "Use Feint" after a block).
    `ignoresProtect`/`reactionTrigger`/`reactionRange` stay server-only
    (only `_eligible_reactors` ever reads them) -- not added here until a
    client caller actually needs one too."""
    moves = _load_move_data_file().get('moves', [])
    categories = {m['name']: m.get('categories', []) for m in moves}
    effects = {m['name']: m['effects'] for m in moves if m.get('effects')}
    flags = {m['name']: {'negatesProtectBlock': True} for m in moves if m.get('negatesProtectBlock')}
    return {'status': 'success', 'categories': categories, 'effects': effects, 'flags': flags}


def _set_board_background(state, url):
    state['board']['backgroundImage'] = url or None


def _set_weather(state, name, effect):
    state['weather'] = {'name': name, 'effect': effect} if name else None


def _set_terrain(state, name, effect):
    state['terrain'] = {'name': name, 'effect': effect} if name else None


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


def _incapacitating_status(participant):
    """The first incapacitating condition (see conditions.py's
    INCAPACITATING_CONDITIONS) `participant` currently holds, or None --
    shared by _apply_move/_reaction_start/_move_token, all three of which an
    incapacitated creature can't do at all."""
    return next((s for s in _statuses_of(participant)
                 if s.get('kind') == 'condition' and s.get('apply') in INCAPACITATING_CONDITIONS), None)


def _fmt_ft(n):
    """Cosmetic only -- "15ft" not "15.0ft" in a rejection message. Shared by
    _move_token and _stand_up so the two can't drift apart on this again (an
    earlier pass fixed it in _move_token alone and _stand_up's own message
    was still showing raw floats)."""
    return int(n) if n == int(n) else n


def _movement_budget(participant):
    """(fastest_effective_ft, best_remaining_ft) for `participant`'s own
    movement this turn -- shared by _move_token (checks a travel distance
    against best_remaining) and _stand_up (costs half of fastest_effective_ft
    itself, Prone's own "standing costs half your movement" rule). Both
    numbers already have Grappled/Restrained/Paralyzed/etc.'s speed
    multiplier folded in; (0, 0) for a participant with no `speeds` recorded
    (and nothing granted/overriding one either) -- same "missing means
    untracked" convention as _move_token's own original comment.

    Speed Swap's own `speed_override` (conditions.py), when present,
    REPLACES the participant's own recorded `speeds` entirely with just that
    one overridden number -- "switch speed with the target" means their
    speed now IS that value, not an addition to what they already had.
    Ascension's own `granted_flight_speed` instead ADDS an entry alongside
    the real ones (a genuinely new, separate movement type the participant
    didn't have before), so it folds in rather than replacing."""
    override = speed_override(participant)
    if override is not None:
        speeds = [{'type': 'overridden', 'ft': override}]
    else:
        speeds = list(participant.get('speeds') or []) + granted_speed_entries(participant)
    if not speeds:
        return (0, 0)
    used = participant.get('movementUsed', 0)
    multiplier = effective_speed_multiplier(participant)
    fastest = max(s['ft'] * multiplier for s in speeds)
    best_remaining = max(max(0, s['ft'] * multiplier - used) for s in speeds)
    return (fastest, best_remaining)


def _stand_up(state, pid):
    """Prone's own escape action -- standing up costs half the participant's
    fastest movement speed for the round (the user's own addition to the
    rulebook text, not covered by the source document) and ends Prone
    immediately. Blocked the same way _move_token blocks voluntary movement
    entirely (a fully incapacitated creature can't stand up either)."""
    participant = state['participants'].get(pid)
    if not participant:
        raise ValueError('Unknown participant: ' + pid)
    if pid != _active_participant_id(state):
        raise ValueError("It's not this participant's turn")
    prone = next((s for s in _statuses_of(participant) if s.get('kind') == 'condition' and s.get('apply') == 'prone'), None)
    if not prone:
        raise ValueError(f"{participant['name']} isn't prone")
    incap = _incapacitating_status(participant)
    if incap:
        raise ValueError(f"{participant['name']} is {incap['apply']} and can't stand up")

    fastest, best_remaining = _movement_budget(participant)
    if fastest:
        cost = fastest / 2
        if cost > best_remaining:
            raise ValueError(f"Not enough movement left to stand up ({_fmt_ft(best_remaining)}ft remaining, standing needs {_fmt_ft(cost)}ft)")
        participant['movementUsed'] = participant.get('movementUsed', 0) + cost

    state['started'] = True
    _remove_status(state, pid, prone['id'], 'stood up')


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
    incap = _incapacitating_status(participant)
    if incap:
        raise ValueError(f"{participant['name']} is {incap['apply']} and can't move")
    zeroed = zero_speed_condition(participant)
    if zeroed:
        # Unconditional, same as the two checks above -- a 0x speed
        # multiplier means "can't move at all" regardless of whether
        # `speeds` happens to be recorded (the budget check below is
        # skipped entirely without it, which used to let a Grappled/
        # Restrained participant with no speeds data move completely
        # unrestricted).
        raise ValueError(f"{participant['name']} is {zeroed} and can't move")

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
    if participant.get('speeds'):
        current = state['board']['tokens'].get(pid)
        distance_ft = max(abs(col - current['col']), abs(row - current['row'])) * 5 if current else 0
        _, best_remaining = _movement_budget(participant)
        best_remaining = _fmt_ft(best_remaining)
        if distance_ft > best_remaining:
            raise ValueError(f"Not enough movement left ({best_remaining}ft remaining, this move needs {distance_ft}ft)")
        participant['movementUsed'] = participant.get('movementUsed', 0) + distance_ft

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
