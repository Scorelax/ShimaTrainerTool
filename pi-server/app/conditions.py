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
}

# Any of these blocks move-use and reactions entirely (_apply_move,
# _reaction_start) and movement (_move_token, alongside
# _MOVEMENT_BLOCKING_CONDITIONS) -- "Incapacitated" itself plus every
# condition whose own rulebook text says "incapacitated" as part of its
# effect (Stunned, Unconscious, Petrified; Asleep/Frozen join this set in a
# later phase, and Paralyzed/Confused apply a transient 'incapacitated'
# status for their own failed-roll turn rather than being listed here
# directly -- see the status-conditions plan).
INCAPACITATING_CONDITIONS = {'incapacitated', 'stunned', 'unconscious', 'petrified'}


def effective_speed_multiplier(participant):
    """The combined speed multiplier from every condition `participant`
    currently holds (1 = unaffected). Takes the MINIMUM across active
    sources rather than multiplying them together -- standard "the worst
    source wins, reductions don't stack" convention, not stated in the
    user's own rules text, so an assumption worth revisiting if it ever
    matters in play (e.g. once Exhaustion's own speed-halving lands
    alongside Grappled/Restrained's flat zero)."""
    multiplier = 1
    for s in (participant or {}).get('statuses', []):
        if s.get('kind') != 'condition':
            continue
        rule = CONDITION_RULES.get(s.get('apply'))
        if rule and 'speedMultiplier' in rule:
            multiplier = min(multiplier, rule['speedMultiplier'])
    return multiplier
