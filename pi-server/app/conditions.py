"""Server-side rules for named status conditions (the campaign's own
rulebook -- see move-effects-schema.md for the move-authored roll/stat
effect schema this is deliberately separate from). Mirrors the relevant
subset of js/utils/condition-rules.js's CONDITION_RULES table -- only the
fields something server-side actually reads. Advantage/disadvantage on
attack rolls/saves is entirely client-side (move-effects.js's
attackRollContext/saveRollContext read the JS table directly); this module
covers what the SERVER enforces: movement, and (in later phases)
incapacitation/type-immunity.

Deliberately not a 1:1 copy of every condition in the JS table -- adding an
entry here happens when a phase actually needs server enforcement for it,
not preemptively (see the status-conditions plan's own phased approach).
"""

CONDITION_RULES = {
    'grappled': {'speedMultiplier': 0},
    'restrained': {'speedMultiplier': 0},
    'frozen': {'speedMultiplier': 0},
    # 'timing' matches _expire_statuses_on_turn_point's own 'start'/'end'
    # vocabulary (not the client's 'start_of_turn'/'end_of_turn' naming for
    # repeat saves/heals) since this applies purely server-side, at the same
    # turn point _advance_turn already hooks. Deterministic (no dice, no
    # human decision) unlike a repeat heal/save, so it applies automatically
    # rather than through the client-driven turn-boundary prompt machinery.
    'burned': {'turnDamage': {'timing': 'start', 'amount': 'proficiency'}},
    'poisoned': {'turnDamage': {'timing': 'end', 'amount': 'proficiency'}},
    'paralyzed': {'speedMultiplier': 0.5},
    'confused': {'speedMultiplier': 0.5},
}

# Any of these blocks move-use and reactions entirely (_apply_move,
# _reaction_start) and movement (_move_token, alongside
# _MOVEMENT_BLOCKING_CONDITIONS) -- "Incapacitated" itself plus every
# condition whose own rulebook text says "incapacitated" as part of its
# effect (Stunned, Unconscious, Petrified, Frozen, Asleep). Paralyzed/
# Confused apply a transient 'incapacitated' status for their own
# failed-roll turn instead of being listed here directly (see
# combat-wip.js's _promptParalysisCheck/_promptConfusionCheck) -- most of
# the time they're NOT incapacitated at all, unlike everything in this set.
# Semi-invulnerable states a move can put its user in (Dig -> underground, Dive -> underwater, Fly ->
# airborne, Bounce -> ethereal_plane, Phantom Force/Shadow Force/Aqua Phase -> vanished). Each is a plain condition on the user; while it's
# held, the user can't be targeted by a move unless that move lists the state in its own `hitsStates`.
UNTARGETABLE_STATES = ('underground', 'underwater', 'airborne', 'vanished', 'ethereal_plane')


def untargetable_state(participant, hits_states=()):
    """The semi-invulnerable state keeping `participant` from being targeted by a move that can hit
    `hits_states`, or None when they're targetable."""
    for s in (participant or {}).get('statuses', []):
        if s.get('kind') == 'condition' and s.get('apply') in UNTARGETABLE_STATES and s.get('apply') not in hits_states:
            return s['apply']
    return None


INCAPACITATING_CONDITIONS = {'incapacitated', 'stunned', 'unconscious', 'petrified', 'frozen', 'asleep'}

# Confused blocks reactions specifically ("loses its ability to take
# reactions") without being fully incapacitated the rest of the time --
# checked only in _reaction_start, alongside INCAPACITATING_CONDITIONS,
# never in _apply_move/_move_token (a confused creature can still act and
# move, just with its own d20 self-harm check gating whether it actually
# gets to).
REACTION_BLOCKING_CONDITIONS = INCAPACITATING_CONDITIONS | {'confused'}


def condition_turn_damage(participant, point):
    """Every (conditionName, amount) pair `participant` owes from a held
    condition's own automatic turn-boundary damage (Burning/Poisoned) at
    turn point `point` ('start' or 'end', see _expire_statuses_on_turn_point's
    own vocabulary) -- amount already resolved to a number ('proficiency' ->
    the participant's own proficiency bonus), 0 entries filtered out."""
    out = []
    for s in (participant or {}).get('statuses', []):
        if s.get('kind') != 'condition':
            continue
        rule = CONDITION_RULES.get(s.get('apply'))
        turn_damage = rule.get('turnDamage') if rule else None
        if not turn_damage or turn_damage.get('timing') != point:
            continue
        amount = turn_damage.get('amount')
        resolved = participant.get('proficiency') or 0 if amount == 'proficiency' else amount
        if resolved:
            out.append((s['apply'], resolved))
    return out


def effective_speed_multiplier(participant):
    """The combined speed multiplier from every condition `participant`
    currently holds (1 = unaffected). Takes the MINIMUM across active
    sources rather than multiplying them together -- standard "the worst
    source wins, reductions don't stack" convention, not stated in the
    user's own rules text, so an assumption worth revisiting if it ever
    matters in play. Exhaustion is level-dependent (level 2+ halves, level
    5+ zeroes) rather than a flat CONDITION_RULES entry, since its speed
    effect isn't fixed the way Grappled/Restrained's is."""
    multiplier = 1
    for s in (participant or {}).get('statuses', []):
        if s.get('kind') != 'condition':
            continue
        if s.get('apply') == 'exhaustion':
            level = s.get('value') or 1
            if level >= 5:
                multiplier = min(multiplier, 0)
            elif level >= 2:
                multiplier = min(multiplier, 0.5)
            continue
        rule = CONDITION_RULES.get(s.get('apply'))
        if rule and 'speedMultiplier' in rule:
            multiplier = min(multiplier, rule['speedMultiplier'])
    return multiplier


# Safeguard's own named list ("protected from new negative status conditions
# of the following types: asleep, burned, confused, frozen, paralyzed,
# petrified, poisoned or slowed") -- kept as its own explicit set rather than
# reusing INCAPACITATING_CONDITIONS or any other existing grouping, since
# none of them matches this exact list (poisoned/burned/slowed aren't
# incapacitating; petrified is, but it's in both lists for different
# reasons).
SAFEGUARD_BLOCKED_CONDITIONS = {'asleep', 'burned', 'confused', 'frozen', 'paralyzed', 'petrified', 'poisoned', 'slowed'}


def blocking_shield(target, target_id, spec):
    """The apply-name of a `mist`/`safeguard`-style immunity shield already
    active on `target` that blocks an incoming status `spec` (about to be
    applied via _apply_status), or None. Both moves are a standing
    protection a PRIOR move granted, checked against every LATER apply
    attempt -- never against whatever's already active (each move's own
    "any current effects are still in place" / Mist's target keeps whatever
    it already had). `spec['sourceId']` unset, or equal to `target_id`
    itself (a self-inflicted debuff, e.g. a move's own drawback), never gets
    blocked -- both moves protect against an ENEMY's incoming effect, and
    nothing about a stat delta or a condition name says who dealt it on its
    own. This is a stand-in for a real team/faction check, which this app
    has no other example of anywhere -- a documented simplification, same
    spirit as `granted_immunity` having no team check either.

    Mist ("immune to negative stat effects or modifier changes") scopes to
    `kind:'stat'` with a negative flat amount only -- a dice-shaped bonus is
    never negative by construction (see move-effects.js's `_isDiceAmount`),
    and a `set` override or a `roll` advantage/disadvantage effect are both
    a different shape this move's own wording doesn't clearly cover either;
    left unblocked, a documented gap. Safeguard blocks only its own named
    condition list above, not the `INCAPACITATING_CONDITIONS` catch-all or
    every condition -- both scopes read the move's own text literally."""
    source_id = spec.get('sourceId')
    if not source_id or source_id == target_id:
        return None
    for s in (target or {}).get('statuses', []):
        if s.get('kind') != 'condition':
            continue
        apply_name = s.get('apply')
        if apply_name == 'ink_veil' and spec.get('kind') == 'condition':
            # Ink Veil: protected from ANY status condition (the regen roll is client-side).
            return 'ink veil'
        if apply_name == 'mist' and spec.get('kind') == 'stat':
            amount = spec.get('amount')
            if isinstance(amount, (int, float)) and amount < 0:
                return 'mist'
        if apply_name == 'safeguard' and spec.get('kind') == 'condition' and spec.get('apply') in SAFEGUARD_BLOCKED_CONDITIONS:
            return 'safeguard'
    return None


def zero_speed_condition(participant):
    """The apply-name of the first condition driving `participant`'s speed
    multiplier all the way to 0 (Grappled/Restrained/Frozen's own flat
    speedMultiplier, or Exhaustion level 5+), or None -- lets _move_token
    hard-block movement for these the same unconditional way
    _MOVEMENT_BLOCKING_CONDITIONS already does for 'trapped', regardless of
    whether `speeds` is recorded at all. Without this, a participant with no
    `speeds` data (a DM's freeform enemy) could still be freely dragged
    around the map while Grappled, since effective_speed_multiplier's own
    0x result only ever got READ from inside _move_token's speeds-gated
    budget check -- never enforced for a participant that check skips
    entirely."""
    for s in (participant or {}).get('statuses', []):
        if s.get('kind') != 'condition':
            continue
        if s.get('apply') == 'exhaustion' and (s.get('value') or 1) >= 5:
            return 'exhaustion'
        rule = CONDITION_RULES.get(s.get('apply'))
        if rule and rule.get('speedMultiplier') == 0:
            return s['apply']
    return None


def incoming_damage_multiplier(participant):
    """Combined multiplier on damage `participant` is about to RECEIVE, from
    every standing condition that scales it -- Mat Block's own "immune to
    damage from damaging moves" (0x), Testudo Formation's own "take half
    damage from all other attacks" (0.5x), and Aurora Veil's own "halve all
    damage dealt to you for three rounds" (0.5x, same shape as Testudo
    Formation's incoming half -- just without an outgoing half of its own).
    Takes the MINIMUM across active sources, same "worst source wins,
    doesn't stack multiplicatively" convention effective_speed_multiplier
    already uses. Checked at damage-APPLICATION time
    (_apply_damage_to_target), not a reaction-window block like
    block_attack/damage_multiplier -- these are standing, multi-turn
    conditions applying to every hit during their duration, not a one-shot
    cancellation of a single incoming attack. None of these conditions
    affect a status-inducing move at all -- those never call
    _apply_damage_to_target in the first place, so "status-inducing moves
    can still affect their targets" (Mat Block's own text) is already true
    with no extra check. Aurora Veil's own "only while it is hailing" gate
    is advisory, not enforced here -- same "surface it, trust the human"
    philosophy as every other weather/terrain check in this app (there's no
    structured weather-effect system to query authoritatively from, see
    move-effects-schema.md's own field_terrain/field_weather notes)."""
    multiplier = 1
    for s in (participant or {}).get('statuses', []):
        if s.get('kind') != 'condition':
            continue
        if s.get('apply') == 'mat_block':
            multiplier = min(multiplier, 0)
        elif s.get('apply') in ('testudo_formation', 'aurora_veil'):
            multiplier = min(multiplier, 0.5)
    return multiplier


def outgoing_damage_multiplier(participant):
    """Testudo Formation's own "the damage they deal is also halved" --
    checked on the ATTACKER side, separately from incoming_damage_multiplier
    (which scales what the DEFENDER receives): a formation member's own
    outgoing attacks are halved for the duration regardless of what the
    target holds. The two checks compound if a formation member ever attacks
    ANOTHER formation member (an unusual case the rulebook doesn't call out
    either way) -- a documented assumption, same spirit as
    resistance_upgrade's own "several sources each bump their own step,
    compounding"."""
    for s in (participant or {}).get('statuses', []):
        if s.get('kind') == 'condition' and s.get('apply') == 'testudo_formation':
            return 0.5
    return 1


def speed_override(participant):
    """Speed Swap's own "switch speed with the target" -- `speeds` is a
    whole array of movement TYPES per participant (walking/flying/
    swimming/...), not a flat scalar effective_speed_multiplier's own
    multiplier-only model has any notion of, so a swapped value is carried
    as its own condition instead of a `kind:'stat'` one (nothing reads a
    stat-kind "speed" field anywhere). The ft value to use INSTEAD of the
    participant's own recorded `speeds`, or None -- see _movement_budget's
    own use of this (routes_combat.py), which replaces the whole list with
    this single number for the duration rather than trying to merge it."""
    for s in (participant or {}).get('statuses', []):
        if s.get('kind') == 'condition' and s.get('apply') == 'speed_override':
            value = s.get('value')
            if isinstance(value, (int, float)):
                return value
    return None


def granted_speed_entries(participant):
    """Ascension's own "their flight speed becomes Xft for the duration" --
    `speeds` is read-only sheet data with no overlay mechanism the way flat
    stats have (effective_speed_multiplier only ever SCALES an existing
    entry, never adds one), so a granted temporary speed type is folded in
    by _movement_budget generically instead, never mutating the
    participant's own stored `speeds` list. Returns additional {type, ft}
    entries to fold in alongside the real ones -- empty when nothing's
    granted."""
    out = []
    for s in (participant or {}).get('statuses', []):
        if s.get('kind') != 'condition' or s.get('apply') != 'granted_flight_speed':
            continue
        ft = s.get('value')
        if isinstance(ft, (int, float)) and ft:
            out.append({'type': 'flying', 'ft': ft})
    return out


def disabled_moves(participant):
    """Disable/Oblivion Ink/Torment's own "this one move can't be used" --
    the set of move names a participant currently can't use, read off every
    `apply:"move_disabled"` condition they hold (`value` = the move name).
    More than one can be active at once -- Imprison's own "any move you know
    that matches mine" disables potentially SEVERAL moves at a time, modeled
    as one status per overlapping move (combat-wip.js's own
    _handleDisableOverlappingMoves) rather than a list-valued single status,
    same atomic-per-effect shape every other condition here already uses. Checked by
    _apply_move before a move is allowed to be used at all -- the one real
    enforcement point this whole family needed, since nothing anywhere in
    the shared combat system previously tracked "can this participant use
    THIS move right now" (use-move's own module docstring is explicit that
    per-move rules like this stayed client-only/legacy-engine territory
    before now)."""
    return {s['value'] for s in (participant or {}).get('statuses', [])
            if s.get('kind') == 'condition' and s.get('apply') == 'move_disabled' and s.get('value')}


def move_lock(participant):
    """Encore's own "can ONLY use the move that targeted you" -- the one
    move name still allowed, or None if nothing locks the participant down
    this way. Unlike disabled_moves (a blacklist, any number active), this
    is a whitelist of exactly one -- only one `move_locked_to` condition
    should ever be active on a participant at a time in practice (nothing
    stops authoring two, but Encore is the only move that grants this, so
    there's nothing to combine); the first one found wins."""
    for s in (participant or {}).get('statuses', []):
        if s.get('kind') == 'condition' and s.get('apply') == 'move_locked_to' and s.get('value'):
            return s['value']
    return None


def speed_bonus_entries(participant):
    """Agility/Autotomize/Flame Charge/Kinesis's own flat "+Nft to your
    [movement type(s)]" -- the FIRST real use of `kind:'stat', stat:'speed'`
    anywhere in this schema (never wired in before this pass -- `speeds` is
    a whole array of movement TYPES per participant, not a flat scalar the
    existing additive statDeltas machinery has any notion of, which is
    exactly why it sat unbuilt). {scope: total_ft}, `scope` is either one
    speed `type` string (an `appliesTo` field on the status -- Kinesis only
    buffs walking/flying/swimming, never a type the participant doesn't
    already have) or `'all'` (the default -- Agility/Autotomize/Flame
    Charge's own "any movement type"). Stacks already folded in via the
    stored `stacks` count, same `amount * stacks` convention this module's
    display logic elsewhere already uses. Only ADDITIVE amounts (a plain
    number) count here -- see speed_multiplier_entries for the `{multiplier}`
    shape (Surface Glide/Tailwind's own "double speed")."""
    out = {}
    for s in (participant or {}).get('statuses', []):
        if s.get('kind') != 'stat' or s.get('stat') != 'speed':
            continue
        amount = s.get('amount')
        if not isinstance(amount, (int, float)):
            continue
        scope = s.get('appliesTo') or 'all'
        out[scope] = out.get(scope, 0) + amount * s.get('stacks', 1)
    return out


def speed_multiplier_entries(participant):
    """Surface Glide's own "double speed on/in water" (scoped to `'swimming'`
    via `appliesTo`) and Tailwind's "doubles movement speed" (`'all'`, and
    granted to allies too -- see combat-wip.js's own AoE-targeting for that
    half, this function only ever reads ONE participant's own statuses).
    {scope: factor}, same scope convention as speed_bonus_entries, combined
    multiplicatively when more than one source targets the same scope.
    Deliberately separate from effective_speed_multiplier (the
    Grappled/Paralyzed/... DEBUFF table, which takes the MINIMUM across
    sources and is keyed by CONDITION NAME, not a `kind:'stat'` status at
    all) -- a buff combines differently (multiplied together, starting from
    1) and these are authored as a `stat:'speed'` status with a
    `{multiplier}`-shaped `amount`, never a candidate for that table."""
    out = {}
    for s in (participant or {}).get('statuses', []):
        if s.get('kind') != 'stat' or s.get('stat') != 'speed':
            continue
        amount = s.get('amount')
        if not isinstance(amount, dict) or not isinstance(amount.get('multiplier'), (int, float)):
            continue
        scope = s.get('appliesTo') or 'all'
        out[scope] = out.get(scope, 1) * amount['multiplier']
    return out


def incoming_flat_reduction(participant):
    """Harden's own "reduce any damage dealt to you by 1d4 + MOVE until the
    beginning of your next turn" -- a FLAT subtraction per hit, a different
    shape from incoming_damage_multiplier's own standing-condition
    MULTIPLIER table (Mist/Safeguard/Mat Block/Testudo Formation): Harden's
    reduction is a fixed number rolled ONCE at cast time (this app has no
    digital dice, so the human enters it then, same as any other rolled
    amount), not a percentage. Returns the LARGEST active value (several
    sources don't stack additively here -- no text says they should, same
    "worst/best source wins" convention this module already uses for the
    multiplier tables) or 0 with nothing active. Checked by
    _apply_damage_to_target AFTER the type multiplier, same ordering
    incoming_damage_multiplier already uses, and floored at 0 damage (never
    heals from an overlarge reduction)."""
    best = 0
    for s in (participant or {}).get('statuses', []):
        if s.get('kind') == 'condition' and s.get('apply') == 'damage_reduction':
            value = s.get('value')
            if isinstance(value, (int, float)):
                best = max(best, value)
    return best


# ---------------------------------------------------------------------------
# Terrain moves (Electric/Grassy/Misty/Psychic Terrain). The shared session
# terrain is still a freeform {name, effect} pair (plus expiresRound/healDice
# when a move cast it), so which terrain is active is a loose name match --
# same trust level as the weather checks -- which keeps a DM-typed "Misty
# Terrain" working exactly like one the move set. There's no "who's standing
# in the area" concept anywhere in this app, so every effect applies
# field-wide (a documented simplification).
# ---------------------------------------------------------------------------

TERRAIN_KEYWORDS = ('electric', 'grassy', 'misty', 'psychic')


def terrain_kind(terrain):
    """'electric' | 'grassy' | 'misty' | 'psychic' for the active session terrain, or None."""
    name = ((terrain or {}).get('name') or '').lower()
    return next((k for k in TERRAIN_KEYWORDS if k in name), None)


def is_grounded(participant):
    """The terrain moves' own definition: "those that do not have a flying speed or Levitate,
    Magnet Rise, or similar ability". Smack Down's `grounded` condition overrides all of it."""
    statuses = (participant or {}).get('statuses', [])
    if any(s.get('kind') == 'condition' and s.get('apply') == 'grounded' for s in statuses):
        return True
    speeds = list((participant or {}).get('speeds') or []) + granted_speed_entries(participant)
    if any(str(sp.get('type', '')).lower() in ('flying', 'hovering') and (sp.get('ft') or 0) > 0 for sp in speeds):
        return False
    if 'levitate' in str((participant or {}).get('abilities') or '').lower():
        return False
    for s in statuses:
        if s.get('kind') != 'condition':
            continue
        if s.get('apply') == 'airborne':
            return False
        if s.get('apply') == 'granted_immunity' and str(s.get('value') or '').lower() == 'ground':
            return False  # Magnet Rise
    return True


# Misty Terrain's "new status conditions" -- every rulebook condition that is an affliction
# (see condition-rules.js), not the bookkeeping conditions moves also use (type_changed, mat_block, ...).
MISTY_BLOCKED_CONDITIONS = SAFEGUARD_BLOCKED_CONDITIONS | {
    'blinded', 'deafened', 'flinched', 'frightened', 'charmed', 'grappled', 'restrained', 'stunned', 'unconscious', 'exhaustion',
}


def terrain_blocked_status(terrain, target, spec):
    """The terrain name blocking an incoming status `spec` on `target`, or None. Electric Terrain:
    no grounded creature can be asleep. Misty Terrain: no grounded creature gains a new status
    condition. Both are standing protections checked at apply time, like blocking_shield."""
    kind = terrain_kind(terrain)
    if kind not in ('electric', 'misty') or spec.get('kind') != 'condition' or not is_grounded(target):
        return None
    apply_name = spec.get('apply')
    if kind == 'electric' and apply_name == 'asleep':
        return 'Electric Terrain'
    if kind == 'misty' and apply_name in MISTY_BLOCKED_CONDITIONS:
        return 'Misty Terrain'
    return None
