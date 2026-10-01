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
    damage from damaging moves" (0x) and Testudo Formation's own "take half
    damage from all other attacks" (0.5x). Takes the MINIMUM across active
    sources, same "worst source wins, doesn't stack multiplicatively"
    convention effective_speed_multiplier already uses. Checked at damage-
    APPLICATION time (_apply_damage_to_target), not a reaction-window block
    like block_attack/damage_multiplier -- these are standing, multi-turn
    conditions applying to every hit during their duration, not a one-shot
    cancellation of a single incoming attack. Neither condition affects a
    status-inducing move at all -- those never call _apply_damage_to_target
    in the first place, so "status-inducing moves can still affect their
    targets" (Mat Block's own text) is already true with no extra check."""
    multiplier = 1
    for s in (participant or {}).get('statuses', []):
        if s.get('kind') != 'condition':
            continue
        if s.get('apply') == 'mat_block':
            multiplier = min(multiplier, 0)
        elif s.get('apply') == 'testudo_formation':
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
