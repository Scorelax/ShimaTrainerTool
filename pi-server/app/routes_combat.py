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
import copy
import json
import math
import os
import re
import threading
import uuid
from datetime import datetime, timezone

from . import abilities, db, live, routes_gamedata, upstream
from .conditions import untargetable_state, UNTARGETABLE_STATES, INCAPACITATING_CONDITIONS, REACTION_BLOCKING_CONDITIONS, condition_turn_damage, effective_speed_multiplier, zero_speed_condition, blocking_shield, incoming_damage_multiplier, outgoing_damage_multiplier, speed_override, granted_speed_entries, disabled_moves, move_lock, speed_bonus_entries, speed_multiplier_entries, incoming_flat_reduction, terrain_kind, terrain_blocked_status, terrain_blocks_bonus_actions, MISTY_BLOCKED_CONDITIONS, footprint_cells, footprint_size, terrains_affecting, weathers_affecting, weather_damage_for, weather_damage_kind, is_grounded, grounded_in, altitude_limits
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
    # Tile-limited terrains (Electric/Grassy/Misty/Psychic Terrain cast over a marked area instead of the whole
    # map): [{id, name, effect, cells:['col,row',...], expiresRound, healDice, sourceId, sourceName}]. The
    # whole-map terrain above stays as it was; conditions.py's terrains_affecting merges both for a participant.
    'terrainZones': [],
    # Same idea for weather (Sunny Day / Rain Dance / Sandstorm / Hail cast over a marked area).
    'weatherZones': [],
    # Spikes' "enters the area or starts its turn there" hits, waiting for the creature's owner to enter the damage roll
    # and DEX save: [{id, participantId, participantName, zoneId, zoneName, trigger, damageType, ability, dice, flat, dc, sourceId}].
    # Queued by _queue_hazards, resolved (or dismissed) by resolve-hazard.
    'pendingHazards': [],
    # Trick Room: the initiative order is reversed from the NEXT round after it's used, until the battle ends or it is
    # used again. `trickRoom` is whether it's reversed right now; `trickRoomFlip` that a cast is waiting for the next round.
    'trickRoom': False,
    'trickRoomFlip': False,
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


# The trainers' basic attack -- an ordinary entry in the moves file (1d6 + STR, typeless), used from the card's Attack button.
TRAINER_ATTACK_MOVE = 'Attack'

_PVP_DEFAULT_GRID = {'cols': 11, 'rows': 13}
_PVP_DEFAULT_BACKGROUND = 'battle-forest.png'


# Requests run on a thread pool, and every action is load -> change -> save of the one session blob: two at once
# (a move's VP update-stats and its log-event, say) would each save their own copy and the later one would quietly
# undo the other. One action at a time -- they're all quick.
_SESSION_LOCK = threading.Lock()


def handle(conn, action, params):
    with _SESSION_LOCK:
        return _handle(conn, action, params)


def _handle(conn, action, params):
    if action == 'get-state':
        return {'status': 'success', 'data': load_state(conn)}

    if action == 'create-session':
        battle_type = params.get('battleType', 'pve')
        if battle_type not in ('pvp', 'pve'):
            raise ValueError('battleType must be pvp or pve')
        if load_state(conn).get('active'):
            # One battle at a time -- a new one would silently replace the running one. It ends when its last
            # participant leaves (End Battle), so only the people in it can end it.
            raise ValueError('A battle is already in progress -- join it, or wait until its players end it.')
        state = copy.deepcopy(_EMPTY_STATE)  # deep: the board below is edited, never the shared template
        state['active'] = True
        state['battleType'] = battle_type
        if battle_type == 'pvp':
            # PvP starts on an 11x13 forest map (the user's call); still changeable on the placement screen.
            state['board']['grid'] = dict(_PVP_DEFAULT_GRID)
            if os.path.isfile(os.path.join(upstream.BATTLE_IMAGE_DIR, _PVP_DEFAULT_BACKGROUND)):
                state['board']['backgroundImage'] = f'/battle-images/{_PVP_DEFAULT_BACKGROUND}'
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
            **({'move': params['move']} if params.get('move') else {}),
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

    if action == 'use-bonus-action':
        if not params.get('id'):
            raise ValueError('Missing participant id')
        return _mutate(conn, lambda s: _use_bonus_action(s, params['id'], params.get('move', '')))

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

    if action == 'switch-pokemon':
        if not params.get('id') or not params.get('inId'):
            raise ValueError('Missing participant id or inId')
        passing = str(params.get('pass', '')) in ('1', 'true')
        return _mutate(conn, lambda s: _switch_pokemon(s, params['id'], params['inId'], passing,
                                                       js_parse_int(params.get('col')), js_parse_int(params.get('row'))))

    if action == 'cancel-pending-switch':
        if not params.get('id'):
            raise ValueError('Missing participant id')
        return _mutate(conn, lambda s: _cancel_pending_switch(s, params['id']))

    if action == 'queue-switch-heal':
        if not params.get('id') or params.get('mode') not in ('lunar', 'wish'):
            raise ValueError('Missing participant id, or mode must be lunar/wish')
        return _mutate(conn, lambda s: _queue_switch_heal(s, params['id'], params['mode']))

    if action == 'quash':
        if not params.get('id'):
            raise ValueError('Missing participant id')
        return _mutate(conn, lambda s: _quash(s, params['id']))

    if action == 'grant-extra-turn':
        if not params.get('id') or not params.get('targetId'):
            raise ValueError('Missing participant id or targetId')
        return _mutate(conn, lambda s: _grant_extra_turn(s, params['id'], params['targetId'], params.get('moveName', '')))

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
        pool = params.get('pool', 'hp')
        return _apply_damage(
            conn, params['id'], params['targetId'], dice_roll,
            move_type=params.get('moveType', ''),
            species=params.get('species'),
            move_name=params.get('moveName', ''),
            crit=crit,
            pool=pool if pool == 'vp' else 'hp',
        )

    if action == 'apply-retaliation':
        # Fire Shield-style passive retaliation (see _apply_retaliation) -- `id` is the shield
        # HOLDER, `targetId` the creature that just hit them in melee.
        if not params.get('id') or not params.get('targetId'):
            raise ValueError('Missing holder id or target id')
        dice_roll = js_parse_int(params.get('diceRoll'))
        if dice_roll is None:
            raise ValueError('Missing diceRoll')
        return _apply_retaliation(conn, params['id'], params['targetId'], dice_roll)

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

    if action == 'set-environment':
        return _mutate(conn, lambda s: _set_environment(s, params.get('name', ''), params.get('kind', ''), params.get('rounds'),
                                                        params.get('sourceId'), params.get('sourceName')))

    if action == 'request-forced-switch':
        if not params.get('id'):
            raise ValueError('Missing participant id')
        return _mutate(conn, lambda s: _request_forced_switch(s, params['id'], params.get('moveName', ''), params.get('sourceId')))

    if action == 'clear-forced-switch':
        return _mutate(conn, lambda s: s.__setitem__('pendingForcedSwitch', None))

    if action == 'set-weather':
        return _mutate(conn, lambda s: _set_weather(s, params.get('name', ''), params.get('effect', ''), params.get('rounds'),
                                                    params.get('sourceId'), params.get('sourceName'),
                                                    json.loads(params['cells']) if params.get('cells') else None,
                                                    js_parse_int(params.get('casterLevel')), str(params.get('concentration', '')) in ('1', 'true')))

    if action == 'remove-field-zone':
        return _mutate(conn, lambda s: _remove_field_zone(s, params.get('kind', ''), params.get('id', '')))

    if action == 'set-terrain':
        return _mutate(conn, lambda s: _set_terrain(s, params.get('name', ''), params.get('effect', ''), params.get('rounds'),
                                                    params.get('healDice'), params.get('sourceId'), params.get('sourceName'),
                                                    json.loads(params['cells']) if params.get('cells') else None,
                                                    json.loads(params['props']) if params.get('props') else None))

    if action == 'trick-room':
        return _mutate(conn, _trick_room)

    if action == 'resolve-hazard':
        if not params.get('id'):
            raise ValueError('Missing hazard id')
        roll = js_parse_int(params.get('roll'))
        saved = str(params.get('saved', '')) in ('1', 'true')
        failed_by = js_parse_int(params.get('failedBy'))
        return _mutate(conn, lambda s: _resolve_hazard(conn, s, params['id'], roll, saved, failed_by))

    if action == 'clear-terrain-zones':
        return _mutate(conn, lambda s: (s.__setitem__('terrainZones', []), s.__setitem__('weatherZones', [])))

    if action == 'rotate-token':
        facing = js_parse_int(params.get('facing'))
        if not params.get('id') or facing is None:
            raise ValueError('Missing participant id or facing')
        return _mutate(conn, lambda s: _rotate_token(s, params['id'], facing))

    if action == 'set-token-position':
        col = js_parse_int(params.get('col'))
        row = js_parse_int(params.get('row'))
        if not params.get('id') or col is None or row is None:
            raise ValueError('Missing participant id, col, or row')
        return _mutate(conn, lambda s: _set_token_position(s, params['id'], col, row))

    if action == 'set-token-altitude':
        z = js_parse_int(params.get('z'))
        if not params.get('id') or z is None:
            raise ValueError('Missing participant id or altitude')
        return _mutate(conn, lambda s: _set_token_altitude(s, params['id'], z))

    if action == 'move-token':
        col = js_parse_int(params.get('col'))
        row = js_parse_int(params.get('row'))
        if not params.get('id') or col is None or row is None:
            raise ValueError('Missing participant id, col, or row')
        z = js_parse_int(params.get('z'))  # altitude in feet; omitted = stay at the current altitude
        return _mutate(conn, lambda s: _move_token(s, params['id'], col, row, z))

    if action == 'stand-up':
        if not params.get('id'):
            raise ValueError('Missing participant id')
        return _mutate(conn, lambda s: _stand_up(s, params['id']))

    if action == 'ability-trigger':
        if not params.get('id') or not params.get('ability'):
            raise ValueError('Missing participant id or ability')
        return _mutate(conn, lambda s: _ability_trigger(conn, s, params['id'], params['ability'], js_parse_int(params.get('index')),
                                                        params.get('targetId') or params['id'], js_parse_int(params.get('amount')),
                                                        params.get('value'), params.get('spend') == '1'))

    if action == 'type-preview':
        # Read-only: the type multiplier a hit WOULD get, for the damage-roll step (super-effective ability conditions).
        return {'status': 'success', 'data': _type_preview(conn, load_state(conn), params.get('id'), params.get('targetId'),
                                                           params.get('moveType', ''), params.get('moveName', ''))}

    if action == 'rapid-orders':
        if not params.get('id') or not params.get('targetId'):
            raise ValueError('Missing trainer id or Pokemon id')
        return _mutate(conn, lambda s: _rapid_orders(s, params['id'], params['targetId']))

    if action == 'disengage':
        if not params.get('id'):
            raise ValueError('Missing participant id')
        return _mutate(conn, lambda s: _disengage(s, params['id']))

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
        facing = js_parse_int(params.get('facing'))  # optional: which way the token faces as it's placed
        return _mutate(conn, lambda s: _confirm_placement(s, params['id'], col, row, facing))

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
        # Whose turn it was when this happened -- Echoed Voice's "until the start of your next turn" window
        # needs the position within a round, not just the round.
        'turnIndex': state.get('turnIndex', 0),
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


def _immunity_ignored(attacker, target, attack_type):
    """Foresight/Odor Sleuth (an ATTACKER-side `ignore_immunities` condition, value = comma-
    separated attack types) and Miracle Eye (a TARGET-side `immunities_relinquished`, any type,
    only meaningful on a Dark/Ghost target) both make a type-chart immunity (0x) not count."""
    for s in _statuses_of(attacker or {}):
        if s.get('kind') == 'condition' and s.get('apply') == 'ignore_immunities':
            types = [t.strip().upper() for t in str(s.get('value') or '').split(',')]
            if str(attack_type).upper() in types:
                return True
    return any(s.get('kind') == 'condition' and s.get('apply') == 'immunities_relinquished' for s in _statuses_of(target or {}))


def _type_multiplier(conn, attack_type, defend_type1, defend_type2, target=None, attacker=None):
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
    if raw == 0 and (attacker or target) and _immunity_ignored(attacker, target, attack_type):
        # "...ignore any immunities granted by their type. If the secondary type gives it
        # vulnerability or resistance, it follows the secondary type for that effect": rate each
        # defending type on its own and let an immune one count as neutral.
        raw = 1
        for single in (defend_type1, defend_type2):
            if not single:
                continue
            single_values = routes_gamedata.calculate_type_effectiveness(conn, single, None)
            single_raw = single_values[idx] if idx < len(single_values) else 1
            raw *= single_raw if single_raw != 0 else 1
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
        # One bonus action per round, same cycle as the reaction: spent by use-bonus-action, refreshed when
        # this participant's own turn comes round again (see _advance_turn).
        'bonusActionUsed': False,
        # Live effects on this participant (conditions, stat modifiers,
        # advantage/disadvantage) -- see the status section below and
        # move-effects-schema.md. Older participants may lack the key;
        # every reader goes through _statuses_of.
        'statuses': [],
        # Meaningful for side='enemy' only -- allies are always fully visible
        # to their own team. DM toggles these per-enemy from the DM module.
        'visibility': {'hp': True, 'vp': True, 'name': True},
    }
    if status == 'participating':
        _apply_switch_heal(state, state['participants'][pid])
        _entered_battle(state, state['participants'][pid])
    _rebuild_turn_order(state)
    _log_event(state, 'join', text=f"{state['participants'][pid]['name']} joined the battle", actorId=pid, actorName=state['participants'][pid]['name'])


def _drop_pending_switch_involving(state, ids):
    """A switch held on a reaction window (see _switch_pokemon) is dropped the moment a Pokemon it involves leaves the battle."""
    ps = state.get('pendingSwitch')
    if ps and (ps['outId'] in ids or ps['inId'] in ids):
        state['pendingSwitch'] = None


def _end_source_leaves(state, pid):
    """`pid` left the battle (switched out, benched, removed): every status it put on someone that lasts "while the user remains
    in battle" (`ends: [{type: 'source_leaves'}]` -- Spirit Shackle, Thousand Waves) ends."""
    name = (state['participants'].get(pid) or {}).get('name') or 'its source'
    for p in state['participants'].values():
        for s in list(_statuses_of(p)):
            if s.get('sourceId') == pid and any(e.get('type') == 'source_leaves' for e in s.get('ends') or []):
                _expire_status(state, p, s, f'{name} left the battle')


def _entered_battle(state, participant):
    """Remembers the round a creature came into the battle (Fake Out / First Impression: "only usable in the first round you
    are in combat"). Before the battle starts that is round 1."""
    participant['enteredRound'] = state['round'] if state.get('started') else 1
    _ability_auto(state, participant['id'], 'enter_battle')  # Drizzle & co., Frisk & co., Disguise


def _remove_participant(state, pid):
    _end_source_leaves(state, pid)
    if (state.get('pendingForcedSwitch') or {}).get('pokemonId') == pid:
        state['pendingForcedSwitch'] = None
    state['participants'].pop(pid, None)
    state['board']['tokens'].pop(pid, None)
    _drop_pending_switch_involving(state, {pid})
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
        leaving = {pid for pid, p in state['participants'].items() if p.get('owner') == owner}
        _drop_pending_switch_involving(state, leaving)
        for pid in leaving:
            _end_source_leaves(state, pid)
        if (state.get('pendingForcedSwitch') or {}).get('pokemonId') in leaving:
            state['pendingForcedSwitch'] = None
        for pid in leaving:
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
    was = participant.get('status')
    participant['status'] = status
    if status == 'participating':
        _apply_switch_heal(state, participant)
        if was != 'participating':
            _entered_battle(state, participant)
    elif was == 'participating':
        _end_source_leaves(state, pid)
        if (state.get('pendingForcedSwitch') or {}).get('pokemonId') == pid:
            state['pendingForcedSwitch'] = None
    _rebuild_turn_order(state)


def _note_faint(participant, old_hp):
    """Remembers how much HP a participant had when it dropped to 0 or below -- Healing Wish passes on "an amount of HP equal to
    what the user lost by fainting"."""
    if old_hp is not None and old_hp > 0 and participant.get('currentHP', 0) <= 0:
        participant['hpBeforeFaint'] = old_hp


SWITCH_RANGE_CELLS = 4  # a Pokemon sent out lands within 20ft of its trainer


def _switch_placement(state, out, inn, col=None, row=None):
    """Where the incoming Pokemon appears on the map: a free tile within 20ft of its trainer (the trainer's own token), its whole
    footprint on the board and clear of every other token. `col`/`row` are the tile the player chose (validated here); without
    them the free tile nearest the outgoing Pokemon is used. A trainer with no token leaves only the board and occupancy rules.
    None when nothing is on the map at all (no tokens to place against)."""
    tokens = state['board']['tokens']
    out_token = tokens.get(out['id'])
    trainer = next((p for p in state['participants'].values()
                    if p.get('owner') == out.get('owner') and p.get('combatantType') == 'trainer' and p['id'] in tokens), None)
    if not out_token and not trainer and col is None:
        return None
    cols, rows = state['board']['grid']['cols'], state['board']['grid']['rows']
    size = footprint_size(inn.get('size'))
    occupied = set()
    for pid, t in tokens.items():
        if pid == out['id']:
            continue  # its tile is about to be free
        occupied.update(footprint_cells(t['col'], t['row'], footprint_size((state['participants'].get(pid) or {}).get('size'))))
    trainer_token = tokens[trainer['id']] if trainer else None

    def legal(c, r):
        cells = footprint_cells(c, r, size)
        if any(not (0 <= cc < cols and 0 <= rr < rows) for cc, rr in cells):
            return False
        if any(cell in occupied for cell in cells):
            return False
        if trainer_token and min(max(abs(cc - trainer_token['col']), abs(rr - trainer_token['row'])) for cc, rr in cells) > SWITCH_RANGE_CELLS:
            return False
        return True

    if col is not None and row is not None:
        if not legal(col, row):
            raise ValueError('That tile is more than 20ft from the trainer, occupied, or off the map')
        return {'col': col, 'row': row}
    anchor = out_token or trainer_token
    best = None
    for c in range(cols):
        for r in range(rows):
            if legal(c, r):
                d = max(abs(c - anchor['col']), abs(r - anchor['row']))
                if best is None or d < best[0]:
                    best = (d, c, r)
    if not best:
        raise ValueError('There is no free tile within 20ft of the trainer to send the Pokemon out to')
    return {'col': best[1], 'row': best[2]}


def _switch_pokemon(state, out_id, in_id, pass_statuses=False, col=None, row=None):
    """Swaps one of a trainer's Pokemon out for another: the outgoing one goes to the bench (status 'spectating', keeping its HP,
    VP and statuses), the incoming one is sent out onto a free tile within 20ft of the trainer (chosen by the player, `col`/`row`)
    and takes the outgoing one's slot in the turn order. `pass_statuses` is Baton Pass: every status on the outgoing Pokemon goes
    to the newcomer. A Pokemon that can't be switched out (Ingrain's `trapped`) is refused.

    A switch-out is itself a reaction trigger -- Pursuit may attack the Pokemon as it leaves, Block may stop the switch -- so when a
    hostile creature could react, the swap waits (`pendingSwitch`) while a `switch_out` window is open with the Pokemon still on
    the map, and happens when the window closes (see _finish_pending_switch). With nobody able to react it happens straight away.
    The shared tool had no switching before this -- only the legacy local combat page did."""
    out, inn = state['participants'].get(out_id), state['participants'].get(in_id)
    if not out or not inn:
        raise ValueError('Unknown participant')
    if out_id == in_id:
        raise ValueError("That Pokemon is already in the battle")
    owner = out.get('owner')
    if not owner or inn.get('owner') != owner:
        raise ValueError('Both Pokemon must belong to the same trainer')
    if out.get('combatantType') != 'pokemon' or inn.get('combatantType') != 'pokemon':
        raise ValueError('Only Pokemon can be switched')
    if out.get('status') != 'participating':
        raise ValueError(f"{out['name']} isn't in the battle")
    if inn.get('status') == 'participating':
        raise ValueError(f"{inn['name']} is already in the battle")
    if state.get('pendingSwitch'):
        raise ValueError('A switch is already in progress -- wait for its reaction window to close')
    trapped = next((s for s in _statuses_of(out) if s.get('kind') == 'condition' and s.get('apply') in _MOVEMENT_BLOCKING_CONDITIONS), None)
    if trapped:
        raise ValueError(f"{out['name']} is {trapped['apply']} and can't be switched out")
    # A condition that ALSO says "can't be switched out" (Spider Web's restraint, Memento, Slack Off) carries `noSwitch`.
    held = next((s for s in _statuses_of(out) if s.get('noSwitch')), None)
    if held:
        raise ValueError(f"{out['name']} can't be switched out ({held.get('moveName') or held.get('apply') or 'an effect'})")
    pending = {'outId': out_id, 'inId': in_id, 'pass': bool(pass_statuses), 'place': _switch_placement(state, out, inn, col, row)}

    if state.get('started') and out_id in state['board']['tokens'] and not state.get('pendingReaction'):
        hostile = {pid for pid, p in state['participants'].items() if pid != out_id and p.get('status') == 'participating' and _hostile(state, out, p)}
        if hostile:
            _open_reaction_window(state, 'switch_out', out_id, out_id, '', only_ids=hostile)
            if state.get('pendingReaction'):
                state['pendingSwitch'] = pending
                _log_event(state, 'switch-attempt', text=f"{owner} is switching {out['name']} out -- a chance to react",
                           actorId=out_id, actorName=out['name'])
                return
    _perform_switch(state, pending)


def _finish_pending_switch(state):
    """A reaction window just closed: carry out (or, if a Block stopped it, drop) the switch that was waiting on it."""
    pending = state.get('pendingSwitch')
    if not pending:
        return
    state['pendingSwitch'] = None
    out = state['participants'].get(pending['outId'])
    if pending.get('cancelled'):
        if out:
            _log_event(state, 'switch-blocked', text=f"{out['name']} is stopped dead in its tracks -- the switch doesn't happen", actorId=out['id'], actorName=out['name'])
        return
    try:
        _perform_switch(state, pending)
    except ValueError as e:
        _log_event(state, 'switch-blocked', text=f"The switch could not be completed: {e}")


def _cancel_pending_switch(state, pid):
    """Block: a reactor that used its reaction on a switch-out stops it. Needs a live `switch_out` window the reactor was eligible
    for and the floor, like every other reaction effect."""
    pending, pr = state.get('pendingSwitch'), state.get('pendingReaction')
    if not pending or not pr or pr.get('trigger') != 'switch_out':
        raise ValueError('There is no switch to stop')
    if pid not in pr['eligible'] or state.get('reactingParticipantId') != pid:
        raise ValueError('Only a reactor holding the floor can stop the switch')
    pending['cancelled'] = True
    blocker = state['participants'][pid]
    _log_event(state, 'switch-block', text=f"{blocker['name']} moves to stop the switch", actorId=pid, actorName=blocker['name'])


# What a Pokemon keeps when it's switched out normally (Baton Pass passes everything instead): the lasting conditions.
_SWITCH_PERSISTENT_CONDITIONS = {'burned', 'poisoned', 'asleep', 'paralyzed', 'frozen'}


def _perform_switch(state, pending):
    out, inn = state['participants'].get(pending['outId']), state['participants'].get(pending['inId'])
    if not out or not inn or out.get('status') != 'participating' or inn.get('status') == 'participating':
        raise ValueError('the Pokemon involved changed in the meantime')
    out_id, in_id, owner = out['id'], inn['id'], out.get('owner')
    # The newcomer takes the outgoing Pokemon's slot for the rest of this round (so nobody's turn is skipped or repeated by a
    # re-sort mid-round) -- including its turn, if it was the one acting; the order is re-sorted by initiative when the next round
    # begins (see _advance_turn). Before the battle starts there is no round to protect, so it just re-sorts straight away.
    order = state['turnOrder']
    if out_id in order:
        idx = order.index(out_id)
        if inn.get('lastTurnRound') == state['round'] and idx > state['turnIndex']:
            # The newcomer already had its turn this round (it was switched out, and the outgoing Pokemon -- whose turn hasn't come yet --
            # is now being swapped back for it): the slot dissolves rather than handing it a second turn.
            order.pop(idx)
        else:
            order[idx] = in_id
            if idx == state['turnIndex']:
                inn['lastTurnRound'] = state['round']  # the turn in progress continues as the newcomer
    state['resortAtRound'] = True
    if state.get('reactingParticipantId') == out_id:
        state['reactingParticipantId'] = in_id

    out['status'], inn['status'] = 'spectating', 'participating'
    out_token = state['board']['tokens'].pop(out_id, None)
    place = pending.get('place')
    if place:
        state['board']['tokens'][in_id] = {'col': place['col'], 'row': place['row'], 'facing': (out_token or {}).get('facing', 0), 'z': 0}
        inn['placed'] = True
    if pending.get('pass'):
        for s in [s for s in _statuses_of(out) if s.get('kind') in ('condition', 'stat', 'roll', 'temp_hp') and s.get('apply') not in UNTARGETABLE_STATES]:
            copy_ = json.loads(json.dumps(s))
            copy_['id'] = uuid.uuid4().hex[:8]
            _statuses_of(inn).append(copy_)
            _statuses_of(out).remove(s)
    else:
        # A normal switch-out: stat changes and passing effects end; the lasting conditions stay with the Pokemon on the bench.
        kept = [s for s in _statuses_of(out) if s.get('kind') == 'condition' and s.get('apply') in _SWITCH_PERSISTENT_CONDITIONS]
        if len(kept) != len(_statuses_of(out)):
            out['statuses'] = kept
            _log_event(state, 'status-expire', text=f"{out['name']}'s stat changes and other effects end as it is withdrawn",
                       targetId=out_id, targetName=out['name'])
    _ability_auto(state, out_id, 'switched_out')  # Natural Cure, Regenerator
    if (state.get('pendingForcedSwitch') or {}).get('pokemonId') == out_id:
        state['pendingForcedSwitch'] = None
    _apply_switch_heal(state, inn)
    _entered_battle(state, inn)
    _end_source_leaves(state, out_id)
    if not state.get('started'):
        _rebuild_turn_order(state)
    _log_event(state, 'switch', text=f"{owner} withdraws {out['name']} and sends out {inn['name']}{' (passing along its effects)' if pending.get('pass') else ''}",
               actorId=in_id, actorName=inn['name'])
    if state.get('started') and in_id in state['board']['tokens']:
        _queue_hazards(state, in_id, 'enter')  # sent out onto Spikes
        # Sticky Web / Toxic Spikes: "when a creature is switched into battle, you may use your reaction".
        if not state.get('pendingReaction'):
            hostile = {pid for pid, p in state['participants'].items() if pid != in_id and p.get('status') == 'participating' and _hostile(state, inn, p)}
            if hostile:
                _open_reaction_window(state, 'switch_in', in_id, in_id, '', only_ids=hostile)


def _queue_switch_heal(state, pid, mode):
    """Lunar Dance ("the next creature released by its trainer is fully healed and cured of any status effects") and Healing Wish
    (cured, and recovers HP equal to what the user lost by fainting): remembered per trainer, applied to the next of their Pokemon
    to enter the battle -- through a switch, a new join, or being set participating."""
    participant = state['participants'].get(pid)
    if not participant:
        raise ValueError('Unknown participant: ' + pid)
    owner = participant.get('owner')
    if not owner:
        raise ValueError('That Pokemon has no trainer to pass its sacrifice to')
    state.setdefault('switchHeals', {})[owner] = {'mode': mode, 'sourceId': pid}
    _log_event(state, 'switch-heal', text=f"{participant['name']} sacrifices itself -- {owner}'s next Pokemon will be {'fully healed' if mode == 'lunar' else 'healed'}",
               actorId=pid, actorName=participant['name'])


def _apply_switch_heal(state, participant):
    """If this participant's trainer has a pending Lunar Dance / Healing Wish and this is a different Pokemon entering the
    battle, applies it: every condition is cured, and HP (and, for Lunar Dance, VP) is restored -- Lunar Dance to full, Healing
    Wish by the HP the sacrificed Pokemon had when it fainted."""
    pending = (state.get('switchHeals') or {}).get(participant.get('owner'))
    if not pending or participant.get('combatantType') != 'pokemon' or participant['id'] == pending['sourceId']:
        return
    del state['switchHeals'][participant['owner']]
    source = state['participants'].get(pending['sourceId']) or {}
    participant['statuses'] = [s for s in _statuses_of(participant) if s.get('kind') != 'condition']
    if pending['mode'] == 'lunar':
        participant['currentHP'] = participant['maxHP']
        participant['currentVP'] = participant['maxVP']
        note = 'fully healed and cured'
    else:
        gained = source.get('hpBeforeFaint') or 0
        participant['currentHP'] = min(participant['maxHP'], participant['currentHP'] + gained)
        note = f'cured and healed for {gained} HP'
    _log_event(state, 'switch-heal', text=f"{participant['name']} is {note} by {source.get('name', 'a fallen ally')}'s sacrifice",
               actorId=participant['id'], actorName=participant['name'])


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
    old_hp = participant['currentHP']
    if current_hp is not None:
        participant['currentHP'] = current_hp
        _note_faint(participant, old_hp)
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
    state['turnOrder'] = list(reversed(rolled + unrolled)) if state.get('trickRoom') else rolled + unrolled

    state['turnIndex'] = state['turnOrder'].index(current_id) if current_id in state['turnOrder'] else 0
    # Whoever holds the floor mid-reaction must still be in the fight: one who left, or was benched/fainted out to spectating
    # (a switch, set-status), would otherwise hold it forever -- no card left to press End Turn on, and advance-turn refuses.
    reacting = state['participants'].get(state['reactingParticipantId'])
    if not reacting or reacting.get('status') != 'participating':
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
            _finish_pending_switch(state)
        else:
            for pid in list(pr['eligible']):
                if not _still_participating(pid):
                    del pr['eligible'][pid]
            if not pr['eligible']:
                state['pendingReaction'] = None
                _finish_pending_switch(state)
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
    if new_round and state.get('resortAtRound'):
        # A switch happened this round: put the order back in initiative order for the new round.
        state['resortAtRound'] = False
        _rebuild_turn_order(state)
        state['turnIndex'] = 0
    if new_round and state.get('quashRestoreOrder'):
        # Quash moved someone to the bottom "for this round only" -- the real order comes back with the new round.
        restored = [pid for pid in state['quashRestoreOrder'] if pid in state['turnOrder']]
        restored += [pid for pid in state['turnOrder'] if pid not in restored]
        state['turnOrder'] = restored
        state['turnIndex'] = 0
        state['quashRestoreOrder'] = None
    if new_round and state.get('trickRoomFlip'):
        # Trick Room: "starting at the beginning of the next round ... the initiative order is permanently reversed"
        # (used again, it reverses back). Reversing the live order is the same as rebuilding it sorted the other way.
        state['trickRoom'] = not state.get('trickRoom')
        state['trickRoomFlip'] = False
        state['turnOrder'] = list(reversed(state['turnOrder']))
        state['turnIndex'] = 0
        _log_event(state, 'trick-room', text='Trick Room ' + ('twists the turn order -- initiative is reversed' if state['trickRoom'] else 'ends -- initiative is back to normal'))
    # Only the combatant whose normal turn is now starting gets their
    # reaction refreshed -- "usable again once their next turn comes up",
    # not a blanket reset for the whole table every lap.
    next_participant = state['participants'].get(state['turnOrder'][state['turnIndex']])
    # Who has had (or is having) a turn this round -- a Pokemon switched back in later the same round can't act twice (see _perform_switch).
    ending = state['participants'].get(ending_id) if ending_id else None
    if ending:
        ending['lastTurnRound'] = state['round'] - (1 if new_round else 0)
    if next_participant:
        next_participant['lastTurnRound'] = state['round']
        next_participant['reactionUsed'] = False
        next_participant['bonusActionUsed'] = False
        next_participant['movementUsed'] = 0
        next_participant['actionUsed'] = False
        next_participant['disengaged'] = False
    _log_event(state, 'turn-advance', text=f"Round {state['round']}: {next_participant['name'] if next_participant else '?'}'s turn",
               actorId=state['turnOrder'][state['turnIndex']], actorName=next_participant['name'] if next_participant else None)
    # Effects that end on a turn boundary or a round count (see the status
    # section) -- after the log line, so "wore off" entries read as happening
    # in the new turn/round.
    if ending_id:
        _ability_auto(state, ending_id, 'end_of_turn')  # Rain Dish, Ice Body, Dry Skin
        _apply_condition_turn_damage(state, ending_id, 'end')
        _queue_status_ticks(state, ending_id, 'end')
        _expire_statuses_on_turn_point(state, ending_id, 'end')
    if new_round:
        _expire_statuses_by_round(state)
    starting_id = state['turnOrder'][state['turnIndex']]
    _ability_auto(state, starting_id, 'start_of_turn')  # Chlorophyll, Psychic Barrier, Energy Intensive, Cosmic Slumber
    _expire_fields(state, starting_id)
    _apply_condition_turn_damage(state, starting_id, 'start')
    _queue_status_ticks(state, starting_id, 'start')
    _apply_weather_damage(state, starting_id)
    _queue_hazards(state, starting_id, 'start')
    _expire_statuses_on_turn_point(state, starting_id, 'start')


def _use_bonus_action(state, pid, move_name=''):
    """Spends `pid`'s one bonus action for this round (it comes back when their own turn starts again --
    see _advance_turn). The client disables every bonus-action move once it's spent; this is the
    authoritative check behind that, so a stale screen can't use a second one."""
    participant = state['participants'].get(pid)
    if not participant:
        raise ValueError('Unknown participant: ' + pid)
    if participant['status'] != 'participating':
        raise ValueError('Only participating combatants can use a bonus action')
    if participant.get('bonusActionUsed'):
        raise ValueError(f"{participant['name']} has already used their bonus action this round")
    if terrain_blocks_bonus_actions(terrains_affecting(state, pid), participant):
        raise ValueError(f"{participant['name']} can't use bonus actions (Psychic Terrain)")
    participant['bonusActionUsed'] = True
    label = f' ({move_name})' if move_name else ''
    _log_event(state, 'bonus-action', text=f"{participant['name']} used their bonus action{label}", actorId=pid, actorName=participant['name'])


def _disengage(state, pid):
    """The Disengage action (trainers and Pokemon alike): spends the participant's action, and for the rest of this
    turn moving away from enemies opens no "moved away" reaction window (_open_moved_away_window), so nothing in melee
    range gets an opportunity attack or reaction. Both flags reset when their next turn starts (_advance_turn).
    Moves don't mark the action as spent (nothing tracks that yet), so this only guards the basic actions."""
    participant = state['participants'].get(pid)
    if not participant:
        raise ValueError('Unknown participant: ' + pid)
    if pid != _active_participant_id(state):
        raise ValueError("It's not this participant's turn")
    incap = _incapacitating_status(participant)
    if incap:
        raise ValueError(f"{participant['name']} is {incap['apply']} and can't act")
    if participant.get('actionUsed'):
        raise ValueError(f"{participant['name']} has already used their action this turn")
    participant['actionUsed'] = True
    participant['disengaged'] = True
    state['started'] = True
    _log_event(state, 'disengage', text=f"{participant['name']} disengaged", actorId=pid, actorName=participant['name'])


def _rapid_orders(state, trainer_id, pokemon_id):
    """Rapid Orders (trainer buff, once per long rest -- the charge is the trainer's own, tracked client-side like
    every trainer buff): on the trainer's own turn, their active Pokemon takes one extra action right away. It gets
    the floor the same way a reaction does (reactingParticipantId -- so use-move, move-token and End Turn all act for
    it) without spending its reaction, and its End Turn (reaction-end) hands the floor straight back to the trainer,
    whose turn it still is. One extra action, not a whole turn: movement and bonus action are NOT refreshed."""
    trainer = state['participants'].get(trainer_id)
    pokemon = state['participants'].get(pokemon_id)
    if not trainer or not pokemon:
        raise ValueError('Unknown participant')
    if state.get('reactingParticipantId'):
        raise ValueError('Wait until the current reaction or extra action is over')
    if trainer_id != _active_participant_id(state):
        raise ValueError(f"Rapid Orders can only be given on {trainer['name']}'s own turn")
    if (pokemon.get('owner') or '') != (trainer.get('owner') or '') or pokemon.get('combatantType') != 'pokemon':
        raise ValueError("Rapid Orders can only be given to your own Pokemon")
    if pokemon.get('status') != 'participating':
        raise ValueError(f"{pokemon['name']} isn't in the battle right now")
    incap = _incapacitating_status(pokemon)
    if incap:
        raise ValueError(f"{pokemon['name']} is {incap['apply']} and can't act")
    pokemon['actionUsed'] = False
    pokemon['extraActionFrom'] = 'Rapid Orders'
    state['reactingParticipantId'] = pokemon_id
    state['started'] = True
    _log_event(state, 'extra-action', text=f"{trainer['name']} gives Rapid Orders -- {pokemon['name']} takes an extra action",
               actorId=trainer_id, actorName=trainer['name'], targetId=pokemon_id, targetName=pokemon['name'])


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


def _quash(state, target_id):
    """Quash: a creature that fails the save "must move to the bottom of the initiative order for this round only. Targets
    that have already taken their turn in this round are unaffected." The pre-Quash order is remembered and put back when
    the next round begins (see _advance_turn). The creature whose turn it is right now counts as having taken it."""
    target = state['participants'].get(target_id)
    if not target:
        raise ValueError('Unknown participant: ' + target_id)
    order = state['turnOrder']
    if target_id not in order:
        raise ValueError(f"{target['name']} isn't in the turn order")
    if order.index(target_id) <= state['turnIndex']:
        raise ValueError(f"{target['name']} has already taken their turn this round -- Quash does nothing")
    if not state.get('quashRestoreOrder'):
        state['quashRestoreOrder'] = list(order)
    order.remove(target_id)
    order.append(target_id)
    _log_event(state, 'quash', text=f"{target['name']} is moved to the bottom of the initiative order for this round",
               targetId=target_id, targetName=target['name'])


def _grant_extra_turn(state, caster_id, target_id, move_name=''):
    """Tragic Hero: a willing creature that has just fallen below a third of its max HP (rounded down) is granted a new turn
    right after this reaction, once per creature per battle. Only records the grant (and the once-per-creature mark); the
    hand-over itself happens in _reaction_end, when the caster releases the floor."""
    caster = state['participants'].get(caster_id)
    target = state['participants'].get(target_id)
    if not caster or not target:
        raise ValueError('Unknown participant')
    if target.get('status') != 'participating':
        raise ValueError('Only a participating combatant can take an extra turn')
    if move_name in (target.get('usedOncePerCreature') or []):
        raise ValueError(f"{target['name']} has already been granted that this battle")
    if not (target.get('currentHP', 0) < (target.get('maxHP') or 0) // 3):
        raise ValueError(f"{target['name']} isn't below a third of their max HP")
    target.setdefault('usedOncePerCreature', []).append(move_name)
    state['pendingExtraTurn'] = target_id
    _log_event(state, 'extra-turn', text=f"{caster['name']} grants {target['name']} a second wind -- an extra turn right after this reaction",
               actorId=caster_id, actorName=caster['name'], targetId=target_id, targetName=target['name'])


def _hostile(state, a, b):
    """Whether two participants are on opposite sides: different `side`, or -- in PvP, where everyone is a 'player' -- different owners."""
    if a.get('side') != b.get('side'):
        return True
    return state.get('battleType') == 'pvp' and (a.get('owner') or '') != (b.get('owner') or '')


def _open_moved_away_window(state, mover_id, previous):
    """Pursuit: "when a creature moves away from you" -- called from _move_token once a move has landed. Every hostile creature
    that was nearer to the mover's old tile than to its new one becomes a candidate (their own range and reaction state are
    checked by _eligible_reactors). A switch-out has no trigger in this tool, so only walking away opens it."""
    if state.get('pendingReaction'):
        return  # one window at a time
    mover = state['participants'][mover_id]
    if mover.get('disengaged'):
        return  # Disengage: leaving reach this turn provokes nothing
    now = state['board']['tokens'][mover_id]
    away = set()
    for pid, p in state['participants'].items():
        tok = state['board']['tokens'].get(pid)
        if pid == mover_id or not tok or p.get('status') != 'participating' or not _hostile(state, mover, p):
            continue
        before = max(abs(previous['col'] - tok['col']), abs(previous['row'] - tok['row']))
        after = max(abs(now['col'] - tok['col']), abs(now['row'] - tok['row']))
        if after > before:
            away.add(pid)
    if away:
        _open_reaction_window(state, 'moved_away', mover_id, mover_id, '', only_ids=away)


def _reaction_end(state):
    if not state['reactingParticipantId']:
        raise ValueError('No reaction in progress')
    reactor = state['participants'].get(state['reactingParticipantId'])
    # turnIndex was never touched during the reaction, so the floor returns
    # to exactly where the normal order left off.
    state['reactingParticipantId'] = None
    if reactor and reactor.get('extraActionFrom'):
        # Rapid Orders (_rapid_orders): the extra action is over, the floor goes back to the trainer.
        _log_event(state, 'extra-action-end', text=f"{reactor['name']}'s extra action ({reactor['extraActionFrom']}) ended",
                   actorId=reactor['id'], actorName=reactor['name'])
        reactor['extraActionFrom'] = None
    elif reactor:
        _log_event(state, 'reaction-end', text=f"{reactor['name']}'s reaction ended", actorId=reactor['id'], actorName=reactor['name'])
    # The window (if this reactor came from one) may have been waiting on
    # them specifically -- now that they've released the floor, see if
    # everyone eligible has answered and it can close.
    _maybe_close_reaction_window(state)
    # Tragic Hero: "granted a new turn immediately after this reaction" -- the ally takes the floor right now, with a fresh
    # movement budget and bonus action, and gives it back the usual way (End Turn -> reaction-end).
    extra_id = state.get('pendingExtraTurn')
    state['pendingExtraTurn'] = None
    extra = state['participants'].get(extra_id) if extra_id else None
    if extra and extra.get('status') == 'participating':
        extra['movementUsed'] = 0
        extra['bonusActionUsed'] = False
        extra['actionUsed'] = False
        extra['disengaged'] = False
        state['reactingParticipantId'] = extra_id
        _log_event(state, 'extra-turn', text=f"{extra['name']} takes an extra turn", actorId=extra_id, actorName=extra['name'])


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


_MELEE_TEXT = re.compile(r'\b(?:makes?|strike out with)\b[^.]{0,40}?\bmelee attack', re.I)


def _is_melee_move(move):
    """Whether a move attacks in melee: "melee" in its range ("Melee", "15ft. melee", "Melee (15ft.)") or a description that
    makes a melee attack at a distance (Fly's diving strike, Dimension Slash at 10ft, Hyperspace Hole). Mirrored by
    move-effects.js's isMeleeMoveRow -- a plain `range == 'Melee'` check missed every reach/dive melee move."""
    return 'melee' in str(move.get('range', '')).lower() or bool(_MELEE_TEXT.search(str(move.get('description', ''))))


def _eligible_reactors(state, moves_data, trigger, anchor_id, exclude_id, attacking_move_name=None, only_ids=None):
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
    # Psychic Fangs: "ends Light Screen, bypasses Reflect" -- those reaction moves are never offered against it.
    ignored_reactions = set((attacking_move or {}).get('ignoresReactionMoves') or ())
    result = {}
    for pid, p in state['participants'].items():
        if pid == exclude_id or p.get('status') != 'participating':
            continue  # reaction-start itself requires 'participating' -- never offer one nobody could accept
        if p.get('reactionUsed'):
            continue  # one reaction per round -- spent until their own turn comes round again, so no popup either
        if only_ids is not None and pid not in only_ids:
            continue
        anchor = state['participants'].get(anchor_id) or {}
        for move_name in (p.get('moves') or []):
            m = moves_by_name.get(move_name)
            triggers = m.get('reactionTrigger') if m else None
            if not triggers or trigger not in (triggers if isinstance(triggers, list) else [triggers]):
                continue
            # Reflect/Counter/... only answer a MELEE attack, Light Screen/Mirror Coat only a ranged one: `reactionAttackRange`
            # is checked against the attacking move's own range ("Melee" is the one melee range in the data).
            want = m.get('reactionAttackRange')
            if want and attacking_move is not None:
                if (want == 'melee') != _is_melee_move(attacking_move):
                    continue
            # Tragic Hero: only once the anchor is below 1/N of its max HP (rounded down), and only once per creature per battle.
            one_over = m.get('reactionAnchorHpBelowOneOver')
            if one_over and not (anchor.get('currentHP', 0) < (anchor.get('maxHP') or 0) // one_over):
                continue
            if m.get('oncePerCreature') and move_name in (anchor.get('usedOncePerCreature') or []):
                continue
            if ignores_protect and _has_block_attack_effect(m):
                continue
            if move_name in ignored_reactions:
                continue
            dist = _grid_distance_ft(state, pid, anchor_id)
            if dist is None or dist > (m.get('reactionRange') or 0):
                continue
            result.setdefault(pid, []).append(move_name)
    return result


def _open_reaction_window(state, trigger, anchor_id, attacker_id, move_name, only_ids=None):
    if state['pendingReaction']:
        raise ValueError('A reaction window is already open')
    if anchor_id not in state['participants']:
        raise ValueError('Unknown anchor participant: ' + anchor_id)
    eligible = _eligible_reactors(state, _load_move_data_file(), trigger, anchor_id, attacker_id, move_name, only_ids)
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
        _finish_pending_switch(state)


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
    _finish_pending_switch(state)


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
_END_TYPES = ('rounds', 'until_turn', 'save', 'concentration', 'encounter', 'long_rest', 'uses', 'instant', 'other', 'source_leaves')
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
_STATUS_FIELDS = ('kind', 'apply', 'value', 'value2', 'stat', 'amount', 'set', 'roll', 'on', 'note', 'repeat', 'ability', 'healTargetId', 'against', 'appliesTo', 'noSwitch', 'tick')


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
    terrain_block = terrain_blocked_status(terrains_affecting(state, target_id), target, spec)
    if terrain_block:
        raise ValueError(f"{target['name']} is immune to that ({terrain_block})")
    # Abilities (abilities.py): Limber, Insomnia, Own Tempo... on the target itself, an ally's aura in range (Sweet
    # Veil, Flower Veil), or a stat lock against someone else lowering a stat (Clear Body, Big Pecks...).
    ability_block = (abilities.condition_block(state, target_id, spec, _grid_distance_ft, _hostile)
                     or abilities.stat_lock_block(state, target_id, spec))
    if ability_block:
        raise ValueError(f"{target['name']} is immune to that ({ability_block})")
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
    stackable = spec.get('kind') == 'stat' or (spec.get('kind') == 'condition' and spec.get('apply') == 'power_up')
    stack_max = js_parse_int((spec.get('stacks') or {}).get('max')) if stackable else None
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
    if new.get('kind') == 'condition' and new.get('apply') in INCAPACITATING_CONDITIONS:
        # Power-Up Punch: "all stacks are lost if you are incapacitated".
        statuses[:] = [s for s in statuses if s.get('apply') != 'power_up']
    _log_event(state, 'status-apply', text=f"{target['name']} {verb} {_status_label(new)}{from_text}",
               actorId=source_id, actorName=source_name, targetId=target_id, targetName=target['name'])
    _mirror_magic_coat(state, target, target_id, source, source_id, spec, new)
    if not existing and not spec.get('fromSynchronize'):
        _ability_condition_gained(state, target_id, new, source_id)  # Synchronize, Defiant, Shield Dust...


def _mirror_magic_coat(state, target, target_id, source, source_id, spec, new):
    """Magic Coat: "when an attack from a creature causes you to suffer from a negative status condition, they are also
    affected by the same condition." Runs after a condition lands on a target holding a `magic_coat` status, whenever it came
    from a different creature in range (the coat's `value`, in feet -- skipped when either has no token). The copy is applied
    through the ordinary path (so Safeguard/Misty Terrain/immunities can still stop it) and never mirrors again."""
    if spec.get('mirrored') or not source or source_id == target_id:
        return
    if new.get('kind') != 'condition' or new.get('apply') not in MISTY_BLOCKED_CONDITIONS:
        return
    coat = next((s for s in _statuses_of(target) if s.get('kind') == 'condition' and s.get('apply') == 'magic_coat'), None)
    if not coat:
        return
    dist = _grid_distance_ft(state, target_id, source_id)
    if dist is not None and isinstance(coat.get('value'), (int, float)) and dist > coat['value']:
        return
    mirror = {k: v for k, v in spec.items() if k not in ('sourceId', 'sourceName', 'moveName')}
    mirror.update({'sourceId': target_id, 'sourceName': target['name'], 'moveName': 'Magic Coat', 'mirrored': True})
    try:
        _apply_status(state, source_id, mirror)
    except ValueError as e:
        _log_event(state, 'status-apply', text=f"Magic Coat reflects the condition at {source['name']}, but it fails: {e}",
                   actorId=target_id, actorName=target['name'], targetId=source_id, targetName=source['name'])


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


def _consume_ignore_immunities(state, pid, attacker, move_type, move_name):
    """Foresight's "on the NEXT ghost/normal/fighting move" -- a one-move status (`uses` end).
    Called BEFORE the multiplier: the move that binds it still benefits, a stale one is already gone. It
    binds to the first matching move + round, so every target of an AoE still ignores
    immunities; any other matching move (or the same move in a later round) spends it."""
    for s in list(_statuses_of(attacker)):
        if s.get('kind') != 'condition' or s.get('apply') != 'ignore_immunities':
            continue
        if not any(e.get('type') == 'uses' for e in s.get('ends', [])):
            continue  # Odor Sleuth's duration-based aura, not a one-shot
        if str(move_type).upper() not in [t.strip().upper() for t in str(s.get('value') or '').split(',')]:
            continue
        bound = s.get('boundMove')
        if bound is None:
            s['boundMove'], s['boundRound'] = move_name, state.get('round', 0)
        elif bound != move_name or s.get('boundRound') != state.get('round', 0):
            _remove_status(state, pid, s['id'], 'used up')


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
    if move_name == TRAINER_ATTACK_MOVE:
        # A trainer's basic Attack is their action, same as Disengage (see _disengage).
        if attacker.get('actionUsed'):
            raise ValueError(f"{attacker['name']} has already used their action this turn")
        attacker['actionUsed'] = True
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
            multiplier = _type_multiplier(conn, move_type, target.get('type1'), target.get('type2'), target, attacker)
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


def _apply_retaliation(conn, holder_id, target_id, dice_roll):
    """Fire Shield's own "whenever a creature hits you with a melee attack, the shield erupts for
    2d8 fire damage". A PASSIVE trigger -- not a reaction, no floor-grab -- so it's applied on
    behalf of a participant who isn't the active turn (turn_check=False). Gated on the holder
    actually carrying a `retaliation_on_melee_hit` status (value = damage type), so the action
    can't be used to deal arbitrary off-turn damage."""
    outcome = {}

    def run(state):
        holder = state['participants'].get(holder_id)
        status = next((s for s in _statuses_of(holder or {}) if s.get('kind') == 'condition' and s.get('apply') == 'retaliation_on_melee_hit'), None)
        if not status:
            raise ValueError('No retaliation shield active on this participant')
        outcome.update(_apply_damage_to_target(
            conn, state, holder_id, target_id, dice_roll, status.get('value') or '', status.get('moveName') or '',
            turn_check=False))

    result = _mutate(conn, run)
    result.update(outcome)
    return result


def _apply_damage(conn, pid, target_id, dice_roll, move_type, species, move_name='', crit=False, pool='hp'):
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

    `pool` ('hp', the default, or 'vp') -- the `damage_vp` category's own
    drain moves (Energize, Enervation Ray) deal typed damage that drains VP
    instead of HP; see _apply_damage_to_target's own docstring for why that's
    a genuinely smaller code path, not the full HP pipeline with a pool swap.

    `crit` is recorded on the log entry purely for Lucky Chant's own later
    use (a 'damaged' reaction reading `entry.crit` back off the most recent
    damage entry against the reactor) -- nothing else here reads it."""
    outcome = {}
    result = _mutate(conn, lambda s: outcome.update(
        _apply_damage_to_target(conn, s, pid, target_id, dice_roll, move_type, move_name, crit, pool)))
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


def _move_has_flag(move_name, flag):
    """Whether the move data marks `move_name` with the top-level `flag` (server-side flags like leavesAtOneHp)."""
    if not move_name:
        return False
    move = next((m for m in _load_move_data_file().get('moves', []) if m['name'] == move_name), None)
    return bool(move and move.get(flag))


# ---------------------------------------------------------------------------
# Ability triggers (slice 3 of the ability engine -- abilities.py has the lookups). Two paths:
#   - _ability_auto: triggers with nothing to roll, run by the server itself at the moment they happen (turn start/end,
#     entering the battle, being withdrawn, a knockout).
#   - ability-trigger (_ability_trigger): triggers the client detects and rolls for (being hit, hitting -- Rough Skin's
#     "roll a d4, on a 4"). The client names the holder, the ability and the effect's index; this checks the holder
#     really has it and applies it through the normal damage/status paths.
# `limit` ({uses, per}) is counted per battle -- rests happen outside battles, so one battle is one rest period.
# ---------------------------------------------------------------------------

_SAVE_ABILITY_KEYS = {'str': 'str', 'dex': 'dex', 'con': 'con', 'int': 'int', 'wis': 'wis', 'cha': 'cha'}


def _ability_use_ok(state, holder, ability, index, effect):
    """False once the effect's per-battle use limit is spent; records a use otherwise."""
    limit = effect.get('limit') or {}
    uses = js_parse_int(limit.get('uses'))
    if not uses:
        return True
    counts = holder.setdefault('abilityUses', {})
    key = f'{ability}:{index}'
    if limit.get('per') in ('round', 'turn'):
        key += f":r{state['round']}"  # Hustle's once per round starts over each round
    if counts.get(key, 0) >= uses:
        return False
    counts[key] = counts.get(key, 0) + 1
    return True


def _ability_heal(state, holder, amount, ability, pool='HP'):
    field, max_field = ('currentVP', 'maxVP') if pool == 'VP' else ('currentHP', 'maxHP')
    gained = max(0, min((holder.get(max_field) or 0) - (holder.get(field) or 0), amount))
    if gained:
        holder[field] = (holder.get(field) or 0) + gained
        _log_event(state, 'heal', text=f"{holder['name']}'s {ability}: +{gained} {pool}", actorId=holder['id'], actorName=holder['name'],
                   targetId=holder['id'], targetName=holder['name'], amount=gained)


def _ability_stat(state, holder_id, target_id, ability, effect):
    """A stat effect as a status. 'saving_throw_abilities' (Beast Boost, Soul-Heart) means the ability scores of the
    target's saving-throw proficiencies -- one status each."""
    target = state['participants'][target_id]
    stats = [effect.get('stat')]
    if effect.get('stat') == 'saving_throw_abilities':
        words = re.findall(r'[A-Za-z]+', str(target.get('savingThrows') or ''))
        stats = [_SAVE_ABILITY_KEYS[w[:3].lower()] for w in words if w[:3].lower() in _SAVE_ABILITY_KEYS]
    for stat in stats:
        spec = {'kind': 'stat', 'stat': stat, 'sourceId': holder_id, 'moveName': ability, 'ends': effect.get('ends') or []}
        for k in ('amount', 'set', 'stacks'):
            if k in effect:
                spec[k] = effect[k]
        _apply_status(state, target_id, spec)


def _ability_auto(state, pid, event, **ctx):
    """Runs the participant's `event` effects that need no roll. Anything that does is left to the client (being hit)
    or to the table (the rest -- slice 4's reminders)."""
    holder = state['participants'].get(pid)
    if not holder or holder.get('status') != 'participating' and event != 'switched_out':
        return
    for ab, i, e in abilities.triggered(state, pid, event):
        kind = e.get('kind')
        amount = abilities.resolve_amount(holder, e.get('amount'))
        if kind in ('heal', 'lose_hp', 'temp_hp') and amount is None:
            continue  # dice -- rolled at the table
        if (e.get('optional') and kind != 'extra_action') or e.get('chance') or e.get('save'):
            continue  # a choice or a roll -- not automatic (Moxie's "may take another action" just re-opens the action)
        if not _ability_use_ok(state, holder, ab, i, e):
            continue
        if kind == 'heal' and not e.get('setTo') and (e.get('target') or 'self') == 'self':
            _ability_heal(state, holder, amount, ab, e.get('pool') if e.get('pool') in ('HP', 'VP') else 'HP')
        elif kind == 'lose_hp':
            if e.get('pool') == 'VP':
                holder['currentVP'] = max(0, (holder.get('currentVP') or 0) - amount)
            else:
                holder['currentHP'] -= _absorb_temp_hp(state, holder, amount)
            _log_event(state, 'status-damage', text=f"{holder['name']}'s {ab}: -{amount} {e.get('pool') or 'HP'}", actorId=pid, actorName=holder['name'])
        elif kind == 'temp_hp':
            cap = (e.get('stacks') or {}).get('capLevelMultiple')
            current = next((s for s in _statuses_of(holder) if s.get('kind') == 'temp_hp' and s.get('moveName') == ab), None)
            total = amount + ((current.get('remaining', current.get('amount')) or 0) if current and cap else 0)
            if cap:
                total = min(total, int(holder.get('level') or 0) * int(cap))
            _apply_status(state, pid, {'kind': 'temp_hp', 'amount': total, 'sourceId': pid, 'moveName': ab, 'ends': []})
        elif kind == 'set_weather':
            _set_weather(state, e.get('name'), '', e.get('rounds'), pid, holder['name'], caster_level=holder.get('level'))
            _log_event(state, 'weather', text=f"{holder['name']}'s {ab}: {e.get('name')} for {e.get('rounds')} rounds"
                                              f" (outside battles only -- clear it on the map if this one is indoors)", actorId=pid, actorName=holder['name'])
        elif kind == 'reveal':
            _log_event(state, 'ability', text=f"{holder['name']}'s {ab}: {e.get('note') or 'reveals something'}"
                                              f" -- {str(e.get('what', '')).replace('_', ' ')}", actorId=pid, actorName=holder['name'])
        elif kind == 'stat':
            _ability_stat(state, pid, pid, ab, e)
        elif kind == 'extra_action':
            holder['actionUsed'] = False
            _log_event(state, 'ability', text=f"{holder['name']}'s {ab}: may take another action", actorId=pid, actorName=holder['name'])
        elif kind == 'cure_condition' and e.get('negativeConditions'):
            for s in [s for s in _statuses_of(holder) if s.get('kind') == 'condition' and s.get('apply') in abilities.NEGATIVE_CONDITIONS]:
                _remove_status(state, pid, s['id'], f'cured by {ab}')


def _ability_prevent_faint(state, pid):
    """Phantom Body's `would_faint` effects: instead of fainting it reappears with the `heal` amount (its level) and
    the condition (incorporeal until its next turn) -- once per battle (`limit`)."""
    holder = state['participants'][pid]
    effects = abilities.triggered(state, pid, 'would_faint')
    stop = next(((ab, i, e) for ab, i, e in effects if e.get('kind') == 'prevent_faint'), None)
    if not stop or not _ability_use_ok(state, holder, *stop):
        return
    ab = stop[0]
    heal = next((e for _, _, e in effects if e.get('kind') == 'heal'), None)
    holder['currentHP'] = max(1, abilities.resolve_amount(holder, (heal or {}).get('amount')) or 1)
    for _, _, e in effects:
        if e.get('kind') == 'condition':
            _apply_status(state, pid, {'kind': 'condition', 'apply': e.get('apply'), 'sourceId': pid, 'moveName': ab, 'ends': e.get('ends') or []})
    _log_event(state, 'ability', text=f"{holder['name']}'s {ab}: instead of fainting it phases out, and comes back with {holder['currentHP']} HP",
               actorId=pid, actorName=holder['name'])


def _ability_condition_gained(state, target_id, new, source_id):
    """A condition just landed on `target_id`: Synchronize hands burn/paralysis/poison straight back to whoever caused
    it, Defiant gets advantage on its next attack when a move did it. Shield Dust / Magic Bounce are a choice -- a
    reminder in the log."""
    if new.get('kind') != 'condition' or not source_id or source_id == target_id:
        return
    holder = state['participants'].get(target_id)
    for ab, _, e in abilities.triggered(state, target_id, 'condition_gained'):
        wanted = (e.get('when') or {}).get('conditions')
        if wanted and new.get('apply') not in wanted:
            continue
        if (e.get('when') or {}).get('negative') and new.get('apply') not in abilities.NEGATIVE_CONDITIONS:
            continue
        kind = e.get('kind')
        if kind == 'condition' and e.get('valueFrom') == 'gained_condition':
            try:
                _apply_status(state, source_id, {'kind': 'condition', 'apply': new.get('apply'), 'sourceId': target_id,
                                                  'moveName': ab, 'ends': new.get('ends') or [], 'fromSynchronize': True})
            except ValueError as err:
                _log_event(state, 'ability', text=f"{holder['name']}'s {ab}: {err}", actorId=target_id, actorName=holder['name'])
        elif kind == 'roll':
            _apply_status(state, target_id, {'kind': 'roll', 'roll': e.get('roll'), 'on': e.get('on'), 'sourceId': target_id,
                                              'moveName': ab, 'ends': e.get('ends') or []})
        elif kind in ('negate_condition', 'reflect_condition'):
            _log_event(state, 'ability', text=f"{holder['name']} has {ab} -- it may {'ignore' if kind == 'negate_condition' else 'bounce back'}"
                                              f" this {new.get('apply')} (once per long rest): remove it from its badge if so",
                       actorId=target_id, actorName=holder['name'])


def _ability_trigger(conn, state, holder_id, ability, index, target_id, amount, value_text=None, spend=False):
    """A client-detected trigger (being hit, hitting): validates that `holder_id` has `ability` with an effect at `index`
    of a kind this can apply, then applies it -- damage to `target_id` (Rough Skin), a condition or stat or roll mode on
    it (Flame Body, Gooey, Justified), or a heal for the holder (Hematophage). `amount` is the rolled number when the
    effect has dice or depends on damage dealt."""
    holder = state['participants'].get(holder_id)
    target = state['participants'].get(target_id)
    if not holder or not target:
        raise ValueError('Unknown participant')
    entry = next(((ab, i, e) for ab, i, e in abilities.indexed_effects(holder) if ab.lower() == str(ability).lower() and i == index), None)
    if not entry:
        raise ValueError(f"{holder['name']} doesn't have that ability effect")
    ab, i, e = entry
    if not _ability_use_ok(state, holder, ab, i, e):
        raise ValueError(f"{holder['name']}'s {ab} has no uses left this battle")
    kind = e.get('kind')
    fixed = abilities.resolve_amount(holder, e.get('amount'))
    value = fixed if fixed is not None else amount
    spec_base = {'sourceId': holder_id, 'moveName': ab, 'ends': e.get('ends') or []}
    when = (e.get('when') or {})
    if when.get('type') == 'activated' and spend:
        # An ability used on its own turn: it costs the action / bonus action its `when.action` names.
        if holder_id != _active_participant_id(state):
            raise ValueError(f"{holder['name']} can only use {ab} on its own turn")
        cost = str(when.get('action') or '')
        if 'bonus' in cost:
            if holder.get('bonusActionUsed'):
                raise ValueError(f"{holder['name']} has already used their bonus action this round")
            holder['bonusActionUsed'] = True
        elif 'action' in cost:
            if holder.get('actionUsed'):
                raise ValueError(f"{holder['name']} has already used their action this turn")
            holder['actionUsed'] = True
        _log_event(state, 'ability', text=f"{holder['name']} uses {ab}", actorId=holder_id, actorName=holder['name'])
    if e.get('reaction'):
        if holder.get('reactionUsed'):
            raise ValueError(f"{holder['name']} has already used their reaction")
        holder['reactionUsed'] = True
    if kind == 'damage_taken_mod':
        # A reaction to a hit that already landed (Sturdy, Fur Coat, Void Shift, Chronoshift, Friend Guard): the part
        # of it the ability takes away comes back as HP -- the client works out how much (`amount`).
        if value and value > 0:
            gained = max(0, min((target.get('maxHP') or 0) - target['currentHP'], value))
            target['currentHP'] += gained
            _log_event(state, 'heal', text=f"{holder['name']}'s {ab} softens the hit -- {target['name']} gets {gained} HP back",
                       actorId=holder_id, actorName=holder['name'], targetId=target_id, targetName=target['name'], amount=gained)
        return
    if kind == 'vp_cost_mod':
        # Pressure: whoever targets the holder pays the move's VP again.
        if value and value > 0:
            target['currentVP'] = max(0, (target.get('currentVP') or 0) - value)
            _log_event(state, 'ability', text=f"{holder['name']}'s {ab}: {target['name']} pays {value} extra VP",
                       actorId=holder_id, actorName=holder['name'], targetId=target_id, targetName=target['name'])
        return
    if kind == 'extra_action':
        target['actionUsed'] = False
        _log_event(state, 'ability', text=f"{holder['name']}'s {ab}: {target['name']} may take another action", actorId=holder_id, actorName=holder['name'])
        return
    if kind == 'cure_condition':
        for s in [s for s in _statuses_of(target) if s.get('kind') == 'condition' and (
                s.get('apply') in (e.get('conditions') or []) or (e.get('negativeConditions') and s.get('apply') in abilities.NEGATIVE_CONDITIONS))]:
            _remove_status(state, target_id, s['id'], f'cured by {ab}')
        return
    if kind in ('retaliate', 'deal_damage'):
        if not value or value <= 0:
            return
        _apply_damage_to_target(conn, state, holder_id, target_id, value, e.get('damageType') or '', ab, turn_check=False)
    elif kind == 'condition':
        # Cursed Body's move_disabled names the move that just hit, Color Change's type_changed the type that hit it --
        # the client sends either as `value` (`valueFrom` in the data).
        cond_value = value_text if value_text and (e.get('apply') == 'move_disabled' or e.get('valueFrom')) else e.get('value')
        _apply_status(state, target_id, {**spec_base, 'kind': 'condition', 'apply': e.get('apply'),
                                         **({'value': cond_value} if cond_value is not None else {})})
    elif kind == 'stat':
        _ability_stat(state, holder_id, target_id, ab, e)
    elif kind == 'roll':
        _apply_status(state, target_id, {**spec_base, 'kind': 'roll', 'roll': e.get('roll'), 'on': e.get('on')})
    elif kind == 'attack_bonus':
        # Transformer's Attack form: +N to its attack rolls, as the usual attack-roll stat status.
        _apply_status(state, target_id, {**spec_base, 'kind': 'stat', 'stat': 'attack_rolls',
                                         'amount': abilities.resolve_amount(holder, e.get('amount')) or 0})
    elif kind == 'heal':
        if value and value > 0:
            _ability_heal(state, target if e.get('target') in ('chosen', 'allies', 'ally') else holder, value, ab,
                          e.get('pool') if e.get('pool') in ('HP', 'VP') else 'HP')
    elif when.get('type') == 'activated':
        # Anything else an activated ability does is the table's to play out -- the use (and its cost) is logged above.
        if e.get('note'):
            _log_event(state, 'ability', text=f"{ab}: {e['note']}", actorId=holder_id, actorName=holder['name'])
    else:
        raise ValueError(f"{ab}'s {kind} effect isn't triggered this way")


def _type_preview(conn, state, pid, target_id, move_type, move_name=''):
    """The type multiplier (2 / 1 / 0.5 / 0) a hit from `pid` on `target_id` would get -- the same chart, live type
    changes and abilities _apply_damage_to_target uses, without changing anything. None for an unknown participant."""
    attacker = state['participants'].get(pid)
    target = state['participants'].get(target_id)
    if not attacker or not target:
        return {'multiplier': None}
    record = next((m for m in _load_move_data_file().get('moves', []) if m['name'] == move_name), None) if move_name else None
    multiplier = _type_multiplier(conn, move_type, target.get('type1'), target.get('type2'), target, attacker)
    in_gravity = any(t.get('rule') == 'gravity' for t in terrains_affecting(state, target_id))
    multiplier, _, absorb, _ = abilities.adjust_incoming_damage(
        state, pid, target_id, move_type, record, False, multiplier, _hostile(state, attacker, target), in_gravity, _grid_distance_ft)
    return {'multiplier': 0 if absorb is not None else multiplier}


def _apply_damage_to_target(conn, state, pid, target_id, dice_roll, move_type, move_name='', crit=False, pool='hp', turn_check=True):
    attacker = state['participants'].get(pid)
    if not attacker:
        raise ValueError('Unknown participant: ' + pid)
    if turn_check and pid != _active_participant_id(state):
        raise ValueError("It's not this participant's turn")
    target = state['participants'].get(target_id)
    if not target:
        raise ValueError('Unknown target: ' + target_id)
    state['started'] = True  # see _rebuild_turn_order -- someone acting means turn order is now live

    # A semi-invulnerable target (underground, airborne, ...) can't be hit unless the move lists its state.
    record = None
    if move_name:
        record = next((m for m in _load_move_data_file().get('moves', []) if m['name'] == move_name), None)
        if record:
            hidden = untargetable_state(target, record.get('hitsStates') or ())
            if hidden:
                raise ValueError(f"{target['name']} is {hidden.replace('_', ' ')} and can't be targeted by {move_name}")

    _consume_ignore_immunities(state, pid, attacker, move_type, move_name)
    multiplier = _type_multiplier(conn, move_type, target.get('type1'), target.get('type2'), target, attacker)
    # The target's ability (abilities.py): immunities, resistances/weaknesses (a step on the type chart), absorbs,
    # and standing damage multipliers (Thick Fat, Multiscale, Fluffy...).
    in_gravity = any(t.get('rule') == 'gravity' for t in terrains_affecting(state, target_id))
    chart_multiplier = multiplier
    multiplier, ability_multiplier, absorb, ability_notes = abilities.adjust_incoming_damage(
        state, pid, target_id, move_type, record, crit, multiplier, _hostile(state, attacker, target), in_gravity, _grid_distance_ft)
    ability_note = f" -- {'; '.join(ability_notes)}" if ability_notes else ''
    if absorb is not None:
        # Volt/Water Absorb: no damage; a share of what the hit would have dealt comes back as HP instead.
        healed = max(0, min((target.get('maxHP') or 0) - target['currentHP'], int(dice_roll * chart_multiplier * absorb)))
        target['currentHP'] += healed
        _log_event(state, 'heal', text=f"{target['name']} absorbs {attacker['name']}'s {move_name or 'attack'} and recovers {healed} HP{ability_note}",
                   actorId=target_id, actorName=target['name'], targetId=target_id, targetName=target['name'], amount=healed)
        return {'multiplier': 0, 'damageApplied': 0, 'absorbed': healed}
    actual_damage = round(dice_roll * multiplier * ability_multiplier)

    if pool == 'vp':
        # Energize/Enervation Ray's own "deals typed damage, but it's VP, not
        # HP, that drains" -- keeps the SAME type-effectiveness multiplier
        # above (their own text still says "+ Ghost damage" etc.), but skips
        # every HP-SPECIFIC shield this module has (temp HP, Mat Block/
        # Testudo Formation's own standing damage reduction) -- nothing in
        # this dataset gives VP an analogous shield, and these moves' own
        # text never mentions one, so there's nothing to apply here. A
        # genuinely smaller code path, not the HP one with a field swapped.
        target['currentVP'] -= actual_damage  # no floor, same reasoning as the HP path below
        move_label = f' with {move_name}' if move_name else ''
        _log_event(
            state, 'damage',
            text=f"{attacker['name']} drained {actual_damage} VP from {target['name']}{move_label} ({multiplier}x)",
            actorId=pid, actorName=attacker['name'], targetId=target_id, targetName=target['name'],
            move=move_name, moveType=move_type, amount=actual_damage, multiplier=multiplier, crit=bool(crit), pool='vp',
        )
        return {'multiplier': multiplier, 'damageApplied': actual_damage}

    # Mat Block/Testudo Formation's own standing damage reductions -- applied
    # AFTER the type multiplier (kept separate, not folded into `multiplier`
    # itself: Nature's Embrace's own reactor-side "was I vulnerable"
    # check reads this logged field, and a Mat Block/Testudo hit shouldn't
    # look like a type-chart result it never was). condition_multiplier == 1
    # for the overwhelming majority of hits -- no condition to check.
    condition_multiplier = incoming_damage_multiplier(target) * outgoing_damage_multiplier(attacker)
    if condition_multiplier != 1:
        actual_damage = round(actual_damage * condition_multiplier)
    # Harden's own "reduce any damage dealt to you by 1d4 + MOVE" -- a FLAT
    # subtraction (one number, rolled once at cast time), applied AFTER the
    # multiplier above rather than folded into it (a percentage and a flat
    # amount compose by subtracting the flat one from the already-scaled
    # total, not by multiplying them together).
    flat_reduction = incoming_flat_reduction(target)
    if flat_reduction:
        actual_damage = max(0, actual_damage - flat_reduction)
    leftover = _absorb_temp_hp(state, target, actual_damage)
    hp_before = target['currentHP']
    target['currentHP'] -= leftover  # no floor, same reasoning as elsewhere in this module
    spared = False
    if hp_before > 1 and target['currentHP'] <= 0 and _move_has_flag(move_name, 'leavesAtOneHp'):
        # False Swipe: "if this attack would normally cause a creature to faint, it is reduced to 1HP instead".
        target['currentHP'] = 1
        spared = True
    if hp_before > 0 and target['currentHP'] <= 0:
        _ability_prevent_faint(state, target_id)  # Phantom Body
    _note_faint(target, hp_before)
    if hp_before > 0 and target['currentHP'] <= 0:
        # A knockout: the attacker's ko_dealt (Beast Boost, Moxie) and the fallen one's allies' ally_fainted (Soul-Heart).
        if pid != target_id:
            _ability_auto(state, pid, 'ko_dealt')
        for qid, q in state['participants'].items():
            if qid != target_id and q.get('status') == 'participating' and not _hostile(state, q, target):
                _ability_auto(state, qid, 'ally_fainted')
    move_label = f' with {move_name}' if move_name else ''
    condition_note = ' -- Mat Block/Testudo Formation reduces this' if condition_multiplier != 1 else ''
    condition_note += ' -- held back, left at 1 HP' if spared else ''
    condition_note += ' -- Harden reduces this' if flat_reduction else ''
    condition_note += ability_note
    _log_event(
        state, 'damage',
        text=f"{attacker['name']} hit {target['name']}{move_label} for {actual_damage} damage ({multiplier}x){condition_note}",
        actorId=pid, actorName=attacker['name'], targetId=target_id, targetName=target['name'],
        move=move_name, moveType=move_type, amount=actual_damage, multiplier=multiplier, crit=bool(crit),
    )
    return {'multiplier': multiplier, 'damageApplied': actual_damage, 'targetFainted': target['currentHP'] <= 0}


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


_MOVE_DATA_CACHE = {'stamp': None, 'data': None}


def _load_move_data_file():
    """upstream.MOVES_FILE (DnD_moves_categorized_draft.json) -- the full per-move record (categories, effects,
    reactionTrigger/reactionRange, ...), not just the raw [name, type, ...] row upstream.fetch_moves returns. Re-read whenever the
    file changes (its modification time or size), so an in-progress editing session on the Pi is still picked up on the very next
    read -- but not re-parsed on every call: the file is ~1 MB and this is consulted on every damage application and every token
    move (False Swipe's flag, Pursuit's reaction check), which on a Pi was real, avoidable work. Callers treat the result as
    read-only. {'moves': []} on any read failure -- every caller already treats a miss as "nothing special here", never a hard error."""
    try:
        stat = os.stat(upstream.MOVES_FILE)
        stamp = (stat.st_mtime_ns, stat.st_size)
        if _MOVE_DATA_CACHE['stamp'] != stamp:
            with open(upstream.MOVES_FILE, encoding='utf-8') as f:
                _MOVE_DATA_CACHE['data'] = json.load(f)
            _MOVE_DATA_CACHE['stamp'] = stamp
        return _MOVE_DATA_CACHE['data']
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
    flags = {}
    for m in moves:
        # Only markers a client caller actually reads: Feint's negatesProtectBlock, Phantom Tendril's
        # ignoresTargetStatChanges (target-picker.js skips the target's AC modifiers).
        marks = {k: True for k in ('negatesProtectBlock', 'ignoresTargetStatChanges', 'ignoresTargetAcBoosts', 'noCastDamage') if m.get(k)}
        # Semi-invulnerable states: `semiInvulnerable` (the state Dig/Fly/... puts the user in) and
        # `hitsStates` (states a move can still hit, e.g. Earthquake -> underground).
        if m.get('semiInvulnerable'):
            marks['semiInvulnerable'] = m['semiInvulnerable']
        if m.get('hitsStates'):
            marks['hitsStates'] = m['hitsStates']
        if m.get('soundBased'):
            marks['soundBased'] = True
        if m.get('attackRoll') is False:
            marks['noAttackRoll'] = True  # migrate_effects_v97.py -- the move popup shows no attack modifier
        if m.get('doubleDamageVsStates'):
            marks['doubleDamageVsStates'] = m['doubleDamageVsStates']
        # Limit Break / Feint Attack / Close Combat ...: the move's OWN attack roll is always made with advantage, and Limit
        # Break's "scores a critical hit on 18-20" widens the crit range for that attack only (base_crit is the 19-20 case).
        if m.get('attackRollMode'):
            marks['attackRollMode'] = m['attackRollMode']
        if m.get('critBonus'):
            marks['critBonus'] = m['critBonus']
        # Earthquake & co. only hit grounded creatures; Cyclone Charge hits the ones that aren't twice as hard.
        for k in ('affectsGroundedOnly', 'doubleDamageVsAirborne'):
            if m.get(k):
                marks[k] = True
        if m.get('targetRequiresStatus'):
            marks['targetRequiresStatus'] = m['targetRequiresStatus']  # Dream Eater & co: only a sleeping target
        if marks:
            flags[m['name']] = marks
    # Ability effects for the client's half of the engine (js/utils/ability-mods.js): name -> effects, unknown-tagged ones left out.
    return {'status': 'success', 'categories': categories, 'effects': effects, 'flags': flags,
            'abilities': abilities.client_effects()}


def _set_board_background(state, url):
    state['board']['backgroundImage'] = url or None


# Zone properties a move may attach (see move-effects-schema.md's set_terrain): `rule` names what the zone does for
# creatures on it (rototiller, fortune_ring, ion_deluge, magic_room, wonder_room, spikes, fissure), `hazard` is Spikes'
# damage, `difficult` doubles the movement cost of its tiles, `critReduction` is Fortune Ring's level-scaled crit DC drop,
# and `untilSourceTurn` ends it when the caster's next turn begins (Ion Deluge).
_ZONE_PROPS = ('rule', 'hazard', 'difficult', 'critReduction', 'concentration')  # `height` (may be 0) is handled separately below


def _set_field(state, key, name, effect, rounds=None, heal_dice=None, source_id=None, source_name=None, cells=None,
               caster_level=None, concentration=False, props=None):
    """Shared by terrain and weather ('terrain' / 'weather'). `rounds`/`healDice`/source only come from a MOVE (see
    move-effects-schema.md's set_terrain / set_weather): `rounds` schedules the expiry (_expire_fields, run from
    _advance_turn), `healDice` is Grassy Terrain's already-level-scaled end-of-turn heal, `casterLevel` is what
    Hail/Sandstorm's "half your level" reads. A DM-typed one carries none of them and just stays until cleared.
    `cells` (a list of "col,row") limits it to those tiles as a zone in state[key + 'Zones'] -- who it affects is
    whoever stands on them; without it it covers the whole map (state[key])."""
    if not name:
        state[key] = None
        return
    field = {'name': name, 'effect': effect}
    n = js_parse_int(rounds)
    if n and n > 0:
        field['expiresRound'] = state['round'] + n
    if heal_dice:
        field['healDice'] = str(heal_dice)
    if caster_level:
        field['casterLevel'] = caster_level
    if concentration:
        field['concentration'] = True
    if source_id:
        field['sourceId'] = source_id
        field['sourceName'] = source_name
    props = props or {}
    for k in _ZONE_PROPS:
        if props.get(k) not in (None, False, ''):
            field[k] = props[k]
    if props.get('untilSourceTurn') and source_id:
        field['untilTurnOf'] = source_id
    if props.get('height') is not None:
        field['height'] = int(props['height'])  # ft above the ground the zone reaches; 0 = the floor only
    if cells:
        field['id'] = uuid.uuid4().hex[:8]
        field['cells'] = sorted({str(c) for c in cells})
        zones = state.setdefault(key + 'Zones', [])
        # Recasting the same one replaces its previous zone rather than stacking duplicates -- except hazards and
        # difficult ground, which are separate patches that can overlap.
        if not (field.get('hazard') or field.get('difficult')):
            zones[:] = [z for z in zones if z['name'] != name]
        zones.append(field)
    else:
        state[key] = field
    if key == 'terrain':
        _wake_electric_sleepers(state)
        if field.get('rule') == 'gravity':
            # Gravity: every creature in the area "loses their flying/hovering speed" -- whoever is airborne in it lands.
            for pid, tok in state['board']['tokens'].items():
                if tok.get('z') and any(t.get('rule') == 'gravity' for t in terrains_affecting(state, pid)):
                    tok['z'] = 0


def _set_terrain(state, name, effect, rounds=None, heal_dice=None, source_id=None, source_name=None, cells=None, props=None):
    _set_field(state, 'terrain', name, effect, rounds, heal_dice, source_id, source_name, cells, props=props)


def _set_weather(state, name, effect, rounds=None, source_id=None, source_name=None, cells=None, caster_level=None,
                 concentration=False):
    _set_field(state, 'weather', name, effect, rounds, None, source_id, source_name, cells, caster_level, concentration)


_ENVIRONMENT_KINDS = ('cold', 'hot', 'windy')


def _set_environment(state, name, kind, rounds=None, source_id=None, source_name=None):
    """Chill / Superheat / Stormwind: the environment of the whole map -- 'cold', 'hot' or 'windy' -- for a number of rounds.
    Separate from the weather (it can be raining AND cold). No name clears it. Thermal Shock reads it: hot doubles its dice,
    cold freezes the ground, anything else (no environment, or windy) is "temperate"."""
    if not name:
        state['environment'] = None
        return
    if kind not in _ENVIRONMENT_KINDS:
        raise ValueError('environment kind must be cold, hot or windy')
    env = {'name': name, 'kind': kind}
    n = js_parse_int(rounds)
    if n and n > 0:
        env['expiresRound'] = state['round'] + n
    if source_id:
        env['sourceId'], env['sourceName'] = source_id, source_name
    state['environment'] = env
    _log_event(state, 'terrain', text=f"The environment turns {kind}: {name}")


def _request_forced_switch(state, pid, move_name='', source_id=None):
    """Dragon Tail in a trainer battle: "the target must be switched out if another creature is available". The target's own
    trainer picks the replacement -- their client sees `pendingForcedSwitch` and opens the switch picker. Cleared by the switch
    itself, by the Pokemon leaving, or by the owner's client when there is nobody to send in."""
    p = state['participants'].get(pid)
    if not p or p.get('status') != 'participating':
        raise ValueError('That creature is not in the battle')
    if not p.get('owner') or p.get('combatantType') != 'pokemon':
        raise ValueError("Only a trainer's Pokemon can be forced to switch")
    state['pendingForcedSwitch'] = {'pokemonId': pid, 'owner': p['owner'], 'moveName': move_name, 'sourceId': source_id}
    _log_event(state, 'switch-attempt', text=f"{p['name']} must be switched out ({move_name or 'forced'})", targetId=pid, targetName=p['name'])


def _remove_field_zone(state, kind, zone_id):
    """Ends one tile-limited zone by hand -- how a concentration weather (Hail, Sandstorm) is dropped when the
    caster loses concentration, since concentration itself isn't tracked as game state."""
    if kind not in ('terrain', 'weather'):
        raise ValueError('kind must be terrain or weather')
    zones = state.get(kind + 'Zones') or []
    zone = next((z for z in zones if z.get('id') == zone_id), None)
    if not zone:
        raise ValueError('No such zone')
    zones.remove(zone)
    _log_event(state, 'terrain-end', text=f"{zone['name']} ended")


def _wake_electric_sleepers(state):
    """"No grounded creatures inside the area can be asleep" -- wake anyone already asleep who is now standing in an Electric Terrain."""
    for p in state['participants'].values():
        zones = terrains_affecting(state, p['id'])
        loud = any(t.get('rule') == 'uproar' for t in zones)
        electric = grounded_in(p, zones) and any(terrain_kind(t) == 'electric' for t in zones)
        if not (loud or electric):
            continue
        for st in list(_statuses_of(p)):
            if st.get('kind') == 'condition' and st.get('apply') == 'asleep':
                _expire_status(state, p, st, 'Uproar' if loud else 'Electric Terrain')


def _expire_fields(state, starting_id=None):
    """Terrain and weather moves last a set number of rounds -- drop whole-map and zone ones whose round has come, and
    those cast "until the beginning of your next turn" (Ion Deluge) once that participant's turn starts."""
    def over(f):
        if f.get('untilTurnOf') and f['untilTurnOf'] == starting_id:
            return True
        return f.get('expiresRound') is not None and state['round'] >= f['expiresRound']
    for key in ('terrain', 'weather', 'environment'):
        if state.get(key) and over(state[key]):
            _log_event(state, 'terrain-end', text=f"{state[key]['name']} fades")
            state[key] = None
        zones = state.get(key + 'Zones') or []
        for z in [z for z in zones if over(z)]:
            _log_event(state, 'terrain-end', text=f"{z['name']} fades")
            zones.remove(z)


def _apply_weather_damage(state, pid):
    """Hail / Sandstorm: a creature standing in it at the start of its turn, or walking into it on its turn, takes
    typed damage of half the caster's level (rounded up) -- once per turn however it got there. Typeless in the
    sense of no type-chart multiplier: the move says "an amount ... equal to half your level", so it's flat.
    Same temp-HP-absorbs-first, no-floor-at-0 path as every other automatic damage tick."""
    participant = state['participants'].get(pid)
    if not participant or participant.get('status') != 'participating':
        return
    mark = [state['round'], state['turnIndex']]
    if participant.get('weatherHitTurn') == mark:
        return
    for weather in weathers_affecting(state, pid):
        source = state['participants'].get(weather.get('sourceId'))
        hit = weather_damage_for(weather, participant, (source or {}).get('level'))
        if not hit:
            continue
        if abilities.weather_damage_immune(state, pid, participant, weather_damage_kind(weather)):
            continue  # Sand Veil, Snow Cloak, Overcoat...
        damage_type, amount = hit
        participant['weatherHitTurn'] = mark
        leftover = _absorb_temp_hp(state, participant, amount)
        participant['currentHP'] -= leftover
        _log_event(state, 'status-damage', text=f"{participant['name']} takes {amount} {damage_type} damage from the {weather['name']}",
                   actorId=pid, actorName=participant['name'])
        return


def _path_cells(c0, r0, c1, r1):
    """The cells a straight move from (c0, r0) to (c1, r1) enters, in order (the start excluded). Mirrored exactly by
    battle-map-view.js's pathCells -- floor(x + 0.5), not round(), so both sides break ties the same way."""
    n = max(abs(c1 - c0), abs(r1 - r0))
    return [(c0 + math.floor((c1 - c0) * i / n + 0.5), r0 + math.floor((r1 - r0) * i / n + 0.5)) for i in range(1, n + 1)]


def _move_cost_ft(state, participant, c0, r0, c1, r1, z0=0, z1=0):
    """Feet of movement a move costs: 5ft per cell entered, double for a cell in a `difficult` zone (Fissure) -- but only
    for a creature that finishes the move on the ground, since a flyer overhead isn't slowed by the ground. Climbing or
    descending costs 1ft of movement per foot, and a diagonal costs the larger of its horizontal and vertical parts
    (Chebyshev again, like the rest of this module's distances). The `participant` argument is kept for the callers'
    signature; what matters is the altitude."""
    difficult = set()
    if z1 == 0:
        for z in state.get('terrainZones') or []:
            if z.get('difficult'):
                difficult.update(z.get('cells') or ())
    horizontal = sum(10 if f"{c},{r}" in difficult else 5 for c, r in _path_cells(c0, r0, c1, r1))
    return max(horizontal, abs(z1 - z0))


def _queue_hazards(state, pid, trigger):
    """Spikes: a creature that enters the zone or starts its turn there takes damage -- once per turn. Queues the hit
    for the creature's owner to resolve (the damage roll and the DEX save are entered by hand, like every other roll
    here) rather than applying it, since neither the roll nor the save is the server's to make."""
    participant = state['participants'].get(pid)
    if not participant or participant.get('status') != 'participating':
        return
    mark = [state['round'], state['turnIndex']]
    hits = participant.setdefault('hazardHits', {})  # zone -> the turn it last hit: once per turn PER ZONE (Smog over Spikes hits twice)
    def applies(z):
        h = z.get('hazard')
        # `only`: just on one trigger (Uproar hits at the START of a turn, not on entering); `excludeSource`: never the caster.
        return bool(h) and (not h.get('only') or h['only'] == trigger) and not (h.get('excludeSource') and z.get('sourceId') == pid)
    for zone in terrains_affecting(state, pid):
        key = zone.get('id') or zone['name']
        if not applies(zone) or hits.get(key) == mark:
            continue
        hits[key] = mark
        _queue_hit(state, participant, zone['hazard'], zone['name'], trigger, zone.get('sourceId'), zone.get('id'))
        _log_event(state, 'hazard', text=f"{participant['name']} {'enters' if trigger == 'enter' else 'starts their turn in'} the {zone['name']}",
                   targetId=pid, targetName=participant['name'])


def _queue_hit(state, participant, h, name, trigger, source_id, zone_id=None):
    """Queues one hazard-style hit for the holder's owner to resolve in the hazard popup: a zone's `hazard` (Spikes, Magma
    Storm, Quicksand Trap, ...) or a status's `tick` (Leech Seed, Infestation, Fire Spin, ...). Shape of `h`:
    damageType, dice, flat, ability, dc -- plus `onSave` ('half' by default, 'none' = a pass takes nothing, 'full' = the damage
    lands either way and the save only guards the condition), `condition` ({apply, ends, failBy} applied on a failed save),
    `pool` ('VP' drains VP instead of HP) and `drain` (that fraction of the damage heals the source -- Leech Seed)."""
    state.setdefault('pendingHazards', []).append({
        'id': uuid.uuid4().hex[:8], 'participantId': participant['id'], 'participantName': participant['name'], 'zoneId': zone_id,
        'zoneName': name, 'trigger': trigger, 'damageType': h.get('damageType', ''), 'ability': h.get('ability', ''),
        'dice': h.get('dice', ''), 'flat': h.get('flat', 0), 'dc': h.get('dc'), 'sourceId': source_id,
        'onSave': h.get('onSave') or 'half', 'condition': h.get('condition'), 'pool': h.get('pool') or 'HP', 'drain': h.get('drain'),
    })


def _queue_status_ticks(state, pid, point):
    """Damage-over-time statuses (`tick`, see _queue_hit): at the holder's turn `point` ('start'/'end') each one due queues a
    hit for its owner to roll -- the dice and the save are the table's, like every other roll in this tool."""
    participant = state['participants'].get(pid)
    if not participant or participant.get('status') != 'participating':
        return
    for s in _statuses_of(participant):
        tick = s.get('tick')
        if isinstance(tick, dict) and (tick.get('timing') or 'end') == point:
            _queue_hit(state, participant, tick, s.get('moveName') or s.get('apply') or 'Effect', 'tick', s.get('sourceId'))


def _resolve_hazard(conn, state, hazard_id, roll, saved, failed_by=None):
    """Applies (or, with no roll and no condition, dismisses) a queued hit: `roll` is the damage total the player rolled,
    adjusted by the entry's `onSave` when they passed. Goes through the ordinary typed-damage path, so type effectiveness and
    temp HP apply; the zone's caster is the attacker (the target itself if they've left the battle). A failed save applies the
    entry's `condition` (when it fails by at least its `failBy`); a VP-pool hit drains VP; `drain` heals the source."""
    pending = state.setdefault('pendingHazards', [])
    entry = next((h for h in pending if h['id'] == hazard_id), None)
    if not entry:
        raise ValueError('That hazard was already resolved')
    pending.remove(entry)
    target = state['participants'].get(entry['participantId'])
    if not target:
        return
    source_id = entry['sourceId'] if entry.get('sourceId') in state['participants'] else entry['participantId']
    amount = 0
    if roll is not None and roll > 0:
        on_save = entry.get('onSave') or 'half'
        amount = roll if not saved or on_save == 'full' else (roll // 2 if on_save == 'half' else 0)
    if amount > 0:
        if entry.get('pool') == 'VP':
            target['currentVP'] = max(0, (target.get('currentVP') or 0) - amount)
            _log_event(state, 'status-damage', text=f"{target['name']} loses {amount} VP from the {entry['zoneName']}",
                       actorId=target['id'], actorName=target['name'])
        else:
            _apply_damage_to_target(conn, state, source_id, entry['participantId'], amount, entry['damageType'], '', turn_check=False)
        source = state['participants'].get(entry.get('sourceId'))
        if entry.get('drain') and source and source['id'] != target['id']:
            healed = int(amount * float(entry['drain']))
            if healed > 0:
                source['currentHP'] = min(source.get('maxHP') or source['currentHP'] + healed, source['currentHP'] + healed)
                _log_event(state, 'heal', text=f"{source['name']} regains {healed} HP from the {entry['zoneName']}",
                           actorId=source['id'], actorName=source['name'])
    cond = entry.get('condition')
    if cond and entry.get('ability') and not saved and (not cond.get('failBy') or (failed_by or 0) >= cond['failBy']):
        try:
            _apply_status(state, entry['participantId'], {
                'kind': 'condition', 'apply': cond['apply'], 'ends': cond.get('ends') or [], 'sourceId': entry.get('sourceId'),
                'sourceName': (state['participants'].get(entry.get('sourceId')) or {}).get('name'), 'moveName': entry['zoneName'],
                'dc': entry.get('dc'),
            })
        except ValueError as e:  # immune (Misty Terrain, Safeguard, ...) -- the damage still stands
            _log_event(state, 'status-blocked', text=str(e), targetId=target['id'], targetName=target['name'])


def _trick_room(state):
    """Using Trick Room schedules the reversal for the start of the next round; using it again while it's active
    schedules the reversal back (see _advance_turn). Cast twice before a round passes, the casts cancel."""
    state['trickRoomFlip'] = not state.get('trickRoomFlip')
    _log_event(state, 'trick-room', text='The world seems to spin -- the turn order will twist at the start of the next round'
               if state['trickRoomFlip'] else 'Trick Room cancelled before it took hold')


def _in_gravity_at(state, participant, col, row):
    """Whether a creature standing at (col, row) would be inside a Gravity zone (any tile of its footprint)."""
    if (state.get('terrain') or {}).get('rule') == 'gravity':
        return True
    cells = {f"{c},{r}" for c, r in footprint_cells(col, row, footprint_size(participant.get("size")))}
    return any(z.get('rule') == 'gravity' and cells & set(z.get('cells') or ()) for z in state.get('terrainZones') or ())


def _set_token_altitude(state, pid, z):
    """Forced altitude change -- Smack Down / Thousand Arrows / Graviton Beam / Roost bring a creature to the ground (0),
    Skyward Soar takes it 60ft up. Like set-token-position this isn't the creature's own movement: no budget, no turn gate.
    Landing in a hazard counts as entering it."""
    tok = state['board']['tokens'].get(pid)
    if pid not in state['participants'] or not tok:
        raise ValueError('That participant has no token on the map')
    z = int(z)
    if z < 0 or z % 5:
        raise ValueError('Altitude must be a whole number of 5ft steps, at or above the ground')
    if z > 0 and _in_gravity_at(state, state['participants'][pid], tok['col'], tok['row']):
        z = 0
    previous = tok.get('z', 0)
    tok['z'] = z
    if z != previous:
        _log_event(state, 'move', text=f"{state['participants'][pid]['name']} {'falls to the ground' if z == 0 else f'is now {z}ft up'}",
                   actorId=pid, actorName=state['participants'][pid]['name'])
    if state.get('started') and z < previous:
        _queue_hazards(state, pid, 'enter')


def _set_token_position(state, pid, col, row):
    if pid not in state['participants']:
        raise ValueError('Unknown participant: ' + pid)
    z = _altitude_of(state, pid)
    if z and _in_gravity_at(state, state['participants'][pid], col, row):
        z = 0  # pushed or placed into a Gravity field: it can't stay up there
    state['board']['tokens'][pid] = {'col': col, 'row': row, 'facing': _facing_of(state, pid), 'z': z}
    _wake_electric_sleepers(state)
    if state.get('started'):
        _queue_hazards(state, pid, 'enter')  # forced movement (a swap, a push) into a hazard counts too


def _facing_of(state, pid):
    """A token's facing in degrees clockwise from up, always a multiple of 45 (0 for one never rotated)."""
    return (state['board']['tokens'].get(pid) or {}).get('facing', 0)


def _altitude_of(state, pid):
    """A token's altitude in feet above the ground (0 = on the ground, which every token starts at)."""
    return (state['board']['tokens'].get(pid) or {}).get('z', 0)


def _rotate_token(state, pid, facing):
    """Turns a token on the spot, in 45-degree steps (0 = up, 90 = right, ...). Free -- no movement cost --
    but turn-gated exactly like move-token, so only the participant holding the floor can turn."""
    if pid not in state['participants']:
        raise ValueError('Unknown participant: ' + pid)
    if pid != _active_participant_id(state):
        raise ValueError("It's not this participant's turn")
    token = state['board']['tokens'].get(pid)
    if not token:
        raise ValueError('That participant has no token on the map')
    token['facing'] = (round(facing / 45) * 45) % 360


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
    didn't have before), so it folds in rather than replacing.

    Agility/Autotomize/Flame Charge/Kinesis's own flat "+Nft" buffs
    (speed_bonus_entries) and Surface Glide/Tailwind's own "double speed"
    buffs (speed_multiplier_entries) are applied per speed-TYPE entry
    (additive first, then multiplicative, then the existing debuff-only
    `multiplier` below) -- both can scope to one movement type via
    `appliesTo` (Surface Glide's own "on/in water" only ever touches
    `swimming`) or apply to every entry (`'all'`, the default)."""
    override = speed_override(participant)
    if override is not None:
        speeds = [{'type': 'overridden', 'ft': override}]
    else:
        speeds = list(participant.get('speeds') or []) + granted_speed_entries(participant)
    if not speeds:
        return (0, 0)
    used = participant.get('movementUsed', 0)
    multiplier = effective_speed_multiplier(participant)
    bonuses = speed_bonus_entries(participant)
    buff_multipliers = speed_multiplier_entries(participant)

    def _effective_ft(entry):
        bonus = bonuses.get('all', 0) + bonuses.get(entry['type'], 0)
        buff = buff_multipliers.get('all', 1) * buff_multipliers.get(entry['type'], 1)
        return max(0, entry['ft'] + bonus) * buff * multiplier

    fastest = max(_effective_ft(s) for s in speeds)
    best_remaining = max(max(0, _effective_ft(s) - used) for s in speeds)
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


def _move_token(state, pid, col, row, z=None):
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
    current = state['board']['tokens'].get(pid)
    z0 = (current or {}).get('z', 0)
    z1 = z0 if z is None else z
    if current and (col, row, z1) == (current['col'], current['row'], z0):
        depth = f' ({-z1}ft underground)' if z1 < 0 else f' ({z1}ft up)' if z1 > 0 else ''
        raise ValueError(f"{participant['name']} is already there{depth} -- movement comes in 5ft steps")
    if z1 != z0:
        # Leaving the ground needs a way to fly (a flying speed goes as high as it likes, a hover-only creature stays within
        # 5ft); going below it needs a burrowing speed -- see conditions.py's altitude_limits. Coming back toward the ground
        # is always allowed.
        if z1 % 5:
            raise ValueError('Altitude must be a whole number of 5ft steps')
        low, high = altitude_limits(participant)
        if low is not None and z1 < low and z1 < z0:
            raise ValueError(f"{participant['name']} can't burrow (no burrowing speed)")
        if high is not None and z1 > high and z1 > z0:
            raise ValueError(f"{participant['name']} can't leave the ground (no flying speed)" if high == 0
                             else f"{participant['name']} can only hover {high}ft above the ground (no flying speed)")
    if z1 > 0 and _in_gravity_at(state, participant, col, row):
        if z1 > z0:
            raise ValueError(f"{participant['name']} can't fly inside the Gravity field")
        z0 = z1 = 0  # flying into it: it lands (the fall itself costs no movement)
    if participant.get('speeds'):
        distance_ft = _move_cost_ft(state, participant, current['col'], current['row'], col, row, z0, z1) if current else 0
        _, best_remaining = _movement_budget(participant)
        best_remaining = _fmt_ft(best_remaining)
        if distance_ft > best_remaining:
            raise ValueError(f"Not enough movement left ({best_remaining}ft remaining, this move needs {distance_ft}ft)")
        participant['movementUsed'] = participant.get('movementUsed', 0) + distance_ft

    state['started'] = True  # see _rebuild_turn_order -- acting on-turn means turn order is now live
    # Moving turns the token toward where it's heading (snapped to 45 degrees); rotate-token adjusts it after.
    previous = state['board']['tokens'].get(pid)
    facing = _facing_of(state, pid)
    if previous and (col, row) != (previous['col'], previous['row']):
        facing = (round(math.degrees(math.atan2(col - previous['col'], previous['row'] - row)) / 45) * 45) % 360
    state['board']['tokens'][pid] = {'col': col, 'row': row, 'facing': facing, 'z': z1}
    _wake_electric_sleepers(state)
    if state['turnOrder'] and state['turnOrder'][state['turnIndex']] == pid:
        _apply_weather_damage(state, pid)  # walked into Hail/Sandstorm on their own turn
    _queue_hazards(state, pid, 'enter')
    if previous and (col, row) != (previous['col'], previous['row']):
        _open_moved_away_window(state, pid, previous)
    _log_event(state, 'move', text=f"{participant['name']} moved to ({col}, {row})",
               actorId=pid, actorName=participant['name'], col=col, row=row)


def _clear_token_position(state, pid):
    state['board']['tokens'].pop(pid, None)


def _confirm_placement(state, pid, col, row, facing=None):
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
    facing = _facing_of(state, pid) if facing is None else (round(facing / 45) * 45) % 360
    state['board']['tokens'][pid] = {'col': col, 'row': row, 'facing': facing, 'z': _altitude_of(state, pid)}
    participant['placed'] = True
    _log_event(state, 'placement', text=f"{participant['name']} placed at ({col}, {row})",
               actorId=pid, actorName=participant['name'], col=col, row=row)
