#!/usr/bin/env python3
"""Move migration, thirty-third slice: Fury Cutter, Ice Ball, Rollout -- the
shared "double the dice each consecutive [turn/round] you hit with this
move" escalation flagged as its own mini-system in migrate_effects_v32.py's
own module docstring. Turned out to fit the EXISTING damage_note mechanism
after all, once actually designed -- no new effect KIND, just:

  - A new log-scan helper, `_lastHitMoveStreak(session, pid)`
    (combat-wip.js) -- {moveName, count}: how many CONSECUTIVE prior rounds
    this attacker landed a hit with the SAME move, read straight off the
    shared battle log (a miss never even reaches the damage-logging step,
    and an incapacitated participant can't have used a move at all -- see
    routes_combat.py's INCAPACITATING_CONDITIONS -- so the mere ABSENCE of
    a matching 'damage' log entry for a given round already covers both of
    those reset conditions for free, no separate check needed). Bridged
    onto the local combatant as `merged.lastHitMoveStreak`, same WIP-only
    pattern Archive Blast's `witnessedMoveTypes` and Power Trip's
    `activeBuffCount` already established.
  - A new self-conditional condition, `self_consecutive_move_hits`
    (combat.js's own evalCondition) -- magnitude IS the final, already-
    capped multiplier (not a raw count), since Fury Cutter/Ice Ball and
    Rollout cap in two genuinely different shapes per their own text:
    `cap` (Fury Cutter/Ice Ball -- the MULTIPLIER tops out at 8x and stays
    there no matter how long the streak keeps going) vs `maxStreak`
    (Rollout -- reaching the 5th consecutive hit is the last escalated one,
    "in which case the damage would reset", so a 6th consecutive hit
    restarts from 1x rather than climbing to 32x).
  - A new result field, `diceMultiplierFromMagnitude: true` -- reuses the
    EXISTING diceMultiplier display/application code path end to end
    (multiplyDiceString, the popup's dice-breakdown override), just sourced
    from the condition's own magnitude instead of a fixed per-effect number.

Verified the exact multiplier formula and the log-scan's round-by-round
logic against synthetic fixtures before writing this (both re-implemented
standalone, since neither function is exported from its page module) --
13 multiplier-formula checks (both cap shapes, boundary values) and 5
log-scan checks (a clean streak, no prior log, a gap breaking it, a
different move breaking it, cross-participant isolation) all passed.

NOT modeled, noted on each move instead of silently dropped: the escalating
VP cost (+1 per consecutive use) -- that lives in the move-USE flow (VP
cost is computed and sent before the damage-roll step this mechanism hooks
into), a materially different code path from a damage_note effect; and
Ice Ball/Rollout's own "also resets if your speed is reduced to 0" clause
-- a narrow edge case (speed independently dropping to 0 while still
somehow landing hits) not separately checked.

    python migrate_effects_v33.py            # dry run
    python migrate_effects_v33.py --apply
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from migrate_effects_v2 import tag_for
from migrate_effects_v3 import RETIRED_V3

FILE = Path(__file__).with_name('DnD_moves_categorized_draft.json')


def rebuild_categories(cats, effects):
    derived = []
    for e in effects:
        t = tag_for(e)
        if t not in derived:
            derived.append(t)
    out, placed = [], False
    for c in cats:
        if c in RETIRED_V3:
            if not placed:
                for t in derived:
                    if t not in out:
                        out.append(t)
                placed = True
            continue
        out.append(c)
    if not placed:
        for t in derived:
            if t not in out:
                out.append(t)
    return out


VP_NOTE = "VP cost also increases by 1 each consecutive use -- not auto-tracked, add it by hand."

OVERRIDES = {
    'Fury Cutter': [
        {
            'kind': 'damage_note',
            'condition': {'type': 'self_consecutive_move_hits', 'cap': 8},
            'diceMultiplierFromMagnitude': True,
            'note': VP_NOTE,
        },
    ],
    'Ice Ball': [
        {
            'kind': 'damage_note',
            'condition': {'type': 'self_consecutive_move_hits', 'cap': 8},
            'diceMultiplierFromMagnitude': True,
            'note': VP_NOTE + " Also resets if your speed is reduced to 0 -- not checked separately.",
        },
    ],
    'Rollout': [
        {
            'kind': 'damage_note',
            'condition': {'type': 'self_consecutive_move_hits', 'maxStreak': 5},
            'diceMultiplierFromMagnitude': True,
            'note': VP_NOTE + " Also resets if your speed is reduced to 0 -- not checked separately.",
        },
    ],
}


def main():
    apply_it = '--apply' in sys.argv
    data = json.loads(FILE.read_text(encoding='utf-8'))
    moves = data['moves']
    by_name = {m['name']: m for m in moves}

    missing = [n for n in OVERRIDES if n not in by_name]
    if missing:
        print('ERROR -- unknown move names:', missing)
        sys.exit(1)
    already = [n for n in OVERRIDES if by_name.get(n, {}).get('effects')]
    if already:
        print('ERROR -- already have effects (would overwrite):', already)
        sys.exit(1)

    print(f'{len(OVERRIDES)} moves getting effects')
    for name, effects in OVERRIDES.items():
        print(f'## {name}  ({len(effects)} effect(s))')
        for e in effects:
            print('   ', json.dumps(e, ensure_ascii=False))

    if not apply_it:
        return
    for name, effects in OVERRIDES.items():
        m = by_name[name]
        m['effects'] = effects
        m['categories'] = rebuild_categories(m['categories'], effects)
    FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
    print('\nwritten')


if __name__ == '__main__':
    main()
