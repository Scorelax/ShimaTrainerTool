#!/usr/bin/env python3
"""Move migration, fifty-fifth slice: `attack_suppression` (6 moves). This
category's own real blocker turned out to be server-side, not client-side:
nothing anywhere checked whether a move was currently USABLE at all before
letting `_apply_move` run it. Fixed with two new conditions.py lookups --
`disabled_moves(participant)` (every move NAME currently forbidden, read off
every `apply:"move_disabled"` status) and `move_lock(participant)` (the ONE
move name still allowed, read off `apply:"move_locked_to"`) -- both checked
in `_apply_move` right after the existing incapacitation check, raising the
same kind of ValueError a disabled/incapacitated participant already gets
for trying to act. With that enforcement in place, every move in this
category turned out buildable:

- **Disable** ("choose one of the opponent's known moves... this move is
  now disabled"): the one move here needing a genuine human CHOICE -- which
  move, from the target's own known list. New `kind:"disable_move"`,
  handled by `_handleDisableMove` (combat-wip.js), which opens a new
  `pickOneMoveName` popup (status-picker.js's `pickOneStatus`, generalized
  this pass into a shared `_pickFrom` core so it can list either live
  statuses OR plain move-name strings) over the target's own `.moves`
  array, then applies a plain `move_disabled` condition carrying the chosen
  name as `value`.

- **Imprison** ("unable to use any Move it knows that is the same as
  yours"): fully computable with no picker at all -- the overlap between
  the CASTER's own `.moves` and the target's `.moves` is exact, unambiguous
  data already on both participants. New `kind:"disable_overlapping_moves"`,
  `_handleDisableOverlappingMoves`: disables every name in that overlap as
  its own separate `move_disabled` status sharing one duration (the
  `disabled_moves()` lookup just unions whatever's live, so N statuses works
  identically to one).

- **Oblivion Ink** ("the last move used by the creature is disabled"): also
  fully computable -- a new `_lastMoveUsedBy` log-scan helper (same
  backward-walk convention as `_didLastAttackMiss`) reads the target's own
  most recent `'move-used'` entry. New `kind:"disable_last_used_move"`,
  `_handleDisableLastUsedMove`.

- **Encore** / **Torment** (both reactions: "force [the creature that
  targeted/hit you] to make a WIS save... on a fail, [it] can only use /
  cannot use the move that targeted/hit you"): the one real structural gap
  in this category -- both moves' own EFFECT targets the ORIGINAL ATTACKER,
  a third party relative to the reactor casting them, which this app's
  normal target-picker flow has no way to reach (`_handleEffectsOnly`'s own
  `pickMultipleTargets` lets a human pick ANY participant, not specifically
  "whoever just attacked me"). Fixed with two small pieces:
  1. `_handleEffectsOnly` now checks for a live `session.pendingReaction`
     anchored on the reactor themselves before falling back to
     `pickMultipleTargets` -- when one's open (which it still is: the
     reactor only reaches their own move-use while holding the floor for
     the SAME window, same precedent `_handleStealBuff` already established
     for steal_disrupt's reaction moves), its own `attackerId` is used as
     the one and only target automatically. This reuses the EXISTING
     `save_fail` + `confirmSecondarySave` machinery for free -- the save
     prompt just runs against the auto-resolved attacker like any other
     real target.
  2. The move NAME to lock/disable isn't knowable at authoring time either
     (it's "whichever move just hit the reactor", not fixed) -- a new
     `value: {fromPendingReactionMove: true}` sentinel, resolved in
     `_offerMoveEffects`'s own picks loop (same "mutate a clone, fall
     through to the normal path" shape `_resolveSetValue`'s caller already
     uses for Guard Split's `avgWithTarget`) by reading
     `session.pendingReaction.moveName`. From there it's a completely plain
     `kind:"condition"` effect -- Encore applies `move_locked_to`, Torment
     applies `move_disabled` -- needing no new kind at all. Both use
     `ends:{type:"until_turn", whose:"holder", point:"start", count:1}`
     ("for its next turn") -- already-implemented vocabulary
     (`routes_combat.py`'s own `_END_TYPES`/turn-boundary firing), just
     never previously exercised by anything in this category.

**Throat Chop** stays unmigrated: "unable to activate sound-based attacks"
needs a sound-based move TAG this dataset has nowhere at all (confirmed --
no `soundBased`/`sound_based` key anywhere in the move file), so there's no
way to even evaluate the restriction, let alone enforce it. Advisory-only,
same as every other "the data just doesn't carry this distinction yet" gap
in this schema (team/faction, wall/collision, ...).

    python migrate_effects_v55.py            # dry run
    python migrate_effects_v55.py --apply
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


OVERRIDES = {
    'Disable': {
        'effects': [
            {
                'kind': 'disable_move', 'when': {'type': 'save_fail', 'ability': 'WIS'},
                'ends': [{'type': 'rounds', 'n': 10}, {'type': 'concentration'}],
                'note': 'Human picks which of the target\'s known moves gets disabled (pickOneMoveName).',
            },
        ],
    },
    'Imprison': {
        'effects': [
            {
                'kind': 'disable_overlapping_moves', 'when': {'type': 'save_fail', 'ability': 'WIS'},
                'ends': [{'type': 'rounds', 'n': 10}, {'type': 'concentration'}],
                'note': 'Disables every move name the target shares with the caster -- computed, no picker needed.',
            },
        ],
    },
    'Oblivion Ink': {
        'effects': [
            {
                'kind': 'disable_last_used_move', 'when': {'type': 'on_hit'},
                'ends': [{'type': 'rounds', 'dice': '1d6'}],
                'note': 'Disables the target\'s own most recent move-used log entry.',
            },
        ],
    },
    'Encore': {
        'effects': [
            {
                'kind': 'condition', 'apply': 'move_locked_to', 'value': {'fromPendingReactionMove': True},
                'when': {'type': 'save_fail', 'ability': 'WIS'},
                'ends': [{'type': 'until_turn', 'whose': 'holder', 'point': 'start', 'count': 1}],
                'note': 'Targets whoever just targeted the reactor (session.pendingReaction); locks them to that same move.',
            },
        ],
    },
    'Torment': {
        'effects': [
            {
                'kind': 'condition', 'apply': 'move_disabled', 'value': {'fromPendingReactionMove': True},
                'when': {'type': 'save_fail', 'ability': 'WIS'},
                'ends': [{'type': 'until_turn', 'whose': 'holder', 'point': 'start', 'count': 1}],
                'note': 'Targets whoever just hit the reactor (session.pendingReaction); disables that same move.',
            },
        ],
    },
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
    for name, spec in OVERRIDES.items():
        effects = spec['effects']
        print(f'## {name}  ({len(effects)} effect(s))')
        for e in effects:
            print('   ', json.dumps(e, ensure_ascii=False))

    if not apply_it:
        return
    for name, spec in OVERRIDES.items():
        m = by_name[name]
        effects = spec['effects']
        m['effects'] = effects
        m['categories'] = rebuild_categories(m['categories'], effects)
    FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
    print('\nwritten')


if __name__ == '__main__':
    main()
