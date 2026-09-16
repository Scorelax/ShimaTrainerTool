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
import uuid
from datetime import datetime, timezone

from . import db, live, routes_gamedata, upstream
from .jsutil import js_parse_int

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
    'participants': {},
    'fieldEffects': [],
    # The battle-map screen's state -- a second, separate physical display
    # shown alongside the HP/turn screen, purely spatial (positions/terrain,
    # never HP/VP). Lives here rather than as its own session/lifecycle
    # because it only ever makes sense alongside an active fight, so tying
    # it to create-session/end-session is free. 'grid' is the only
    # templateType for now; the field is already generic so a future
    # 'cave'/'zone' template is additive, not a breaking change.
    'board': {
        'templateType': 'grid',
        'grid': {'cols': 10, 'rows': 8},
        'cells': {},   # "col,row" -> {'terrain': '<freeform DM-typed label>'}
        'tokens': {},  # participantId -> {'col': int, 'row': int}
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
        return _save_and_publish(conn, state)

    if action == 'end-session':
        return _save_and_publish(conn, dict(_EMPTY_STATE))

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
        )

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


def _type_multiplier(conn, attack_type, defend_type1, defend_type2):
    """Reuses game-data/type-effectiveness's own chart lookup (routes_gamedata
    .calculate_type_effectiveness), which returns one multiplier per
    attacking type in type_chart_attack's order -- this just also resolves
    that order to find attack_type's position, then clamps it to this game's
    four-outcome ruleset (see _clamp_type_multiplier). Defaults to 1
    (neutral) whenever any type is missing/unrecognized, same as an untyped
    participant or an off-chart move should behave."""
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
    return _clamp_type_multiplier(raw)


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
        _apply_move(conn, s, pid, vp_cost, target_id, dice_roll, move_type)))
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
        # Whether this participant has been placed on the battle map through
        # the (per-player) placement step -- see confirm-placement below.
        # Only ever checked client-side against a participant's own `owner`
        # (has *this* device's trainer finished placing everyone they own?),
        # so a freeform enemy's flag never actually gates anything; it just
        # starts false like everyone else rather than needing a special case.
        'placed': False,
        'status': status,
        'reactionUsed': False,
        # Meaningful for side='enemy' only -- allies are always fully visible
        # to their own team. DM toggles these per-enemy from the DM module.
        'visibility': {'hp': True, 'vp': True, 'name': True},
    }
    _rebuild_turn_order(state)


def _remove_participant(state, pid):
    state['participants'].pop(pid, None)
    state['board']['tokens'].pop(pid, None)
    _rebuild_turn_order(state)


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


def _advance_turn(state):
    if state['reactingParticipantId']:
        raise ValueError('Cannot advance turn while a reaction is in progress')
    if not state['turnOrder']:
        return
    state['started'] = True
    state['turnIndex'] = (state['turnIndex'] + 1) % len(state['turnOrder'])
    if state['turnIndex'] == 0:
        state['round'] += 1
    # Only the combatant whose normal turn is now starting gets their
    # reaction refreshed -- "usable again once their next turn comes up",
    # not a blanket reset for the whole table every lap.
    next_participant = state['participants'].get(state['turnOrder'][state['turnIndex']])
    if next_participant:
        next_participant['reactionUsed'] = False


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


def _reaction_end(state):
    if not state['reactingParticipantId']:
        raise ValueError('No reaction in progress')
    # turnIndex was never touched during the reaction, so the floor returns
    # to exactly where the normal order left off.
    state['reactingParticipantId'] = None


def _active_participant_id(state):
    if state['reactingParticipantId']:
        return state['reactingParticipantId']
    if state['turnOrder']:
        return state['turnOrder'][state['turnIndex']]
    return None


def _apply_move(conn, state, pid, vp_cost, target_id, dice_roll, move_type):
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

    outcome = {}
    if target_id:
        target = state['participants'].get(target_id)
        if not target:
            raise ValueError('Unknown target: ' + target_id)
        if dice_roll:
            multiplier = _type_multiplier(conn, move_type, target.get('type1'), target.get('type2'))
            actual_damage = round(dice_roll * multiplier)
            target['currentHP'] -= actual_damage  # no floor, same reasoning as above
            outcome = {'multiplier': multiplier, 'damageApplied': actual_damage}
    return outcome


def _apply_damage(conn, pid, target_id, dice_roll, move_type, species):
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
        _apply_damage_to_target(conn, s, pid, target_id, dice_roll, move_type)))
    result.update(outcome)

    attacker = result['data']['participants'].get(pid, {})
    live.publish({
        'type': 'combat-animation',
        'participantId': pid,
        'species': species or attacker.get('name', ''),
    })
    return result


def _apply_damage_to_target(conn, state, pid, target_id, dice_roll, move_type):
    attacker = state['participants'].get(pid)
    if not attacker:
        raise ValueError('Unknown participant: ' + pid)
    if pid != _active_participant_id(state):
        raise ValueError("It's not this participant's turn")
    target = state['participants'].get(target_id)
    if not target:
        raise ValueError('Unknown target: ' + target_id)
    state['started'] = True  # see _rebuild_turn_order -- someone acting means turn order is now live

    multiplier = _type_multiplier(conn, move_type, target.get('type1'), target.get('type2'))
    actual_damage = round(dice_roll * multiplier)
    target['currentHP'] -= actual_damage  # no floor, same reasoning as elsewhere in this module
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
#     themselves. Range/distance limits and terrain-blocking are explicit
#     future work; this only enforces whose turn it is.
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


def _set_token_position(state, pid, col, row):
    if pid not in state['participants']:
        raise ValueError('Unknown participant: ' + pid)
    state['board']['tokens'][pid] = {'col': col, 'row': row}


def _move_token(state, pid, col, row):
    if pid not in state['participants']:
        raise ValueError('Unknown participant: ' + pid)
    if pid != _active_participant_id(state):
        raise ValueError("It's not this participant's turn")
    state['started'] = True  # see _rebuild_turn_order -- acting on-turn means turn order is now live
    state['board']['tokens'][pid] = {'col': col, 'row': row}


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
