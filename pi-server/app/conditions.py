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
