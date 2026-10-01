#!/usr/bin/env python3
"""Move migration, forty-ninth slice: `positioning` (13 moves), the next
category after `steal_disrupt`. 8 of the 13 fit mechanisms that already
exist (one of them with real code, `trapped`; one purely as a logged
reminder, `forced_movement`), just never reused since their only prior use
was a single move each -- read every move fully before trusting the
category label, same discipline as every category before this one.

**Push/pull reuses `forced_movement`** (`kind:"condition"`, already built
for Dawn Dance -- `ends:[{type:"instant"}]` means "announced, never stored",
see `_apply_status`'s own instant-conditions branch: it logs the shove as a
battle-log entry and nothing else, the human drags the token on the actual
map same as any other manual positioning in this app). No new code at all,
just data -- a `note` on each describing the distance/direction, since
unlike Dawn Dance's own single d4-table entry, these vary move to move and
are worth having in the effects-popup itself, not just the move's own
description text.
- **Circle Throw**: `when:"on_hit"`.
- **Lava Cannon**: `when:{save_fail, DEX}` -- already `multi_hit_aoe` +
  `trigger_saving_throw`, so this rides the existing per-target save loop.
- **Magnetic Pulse**: `when:{save_fail, STR}`.
- **Roar**: `when:{save_fail, CHA}` -- already `multi_hit_aoe` too.
- **Strength**: `when:"on_hit"` -- the move's own "you may ALSO choose to
  push" is already optional with zero extra work: the effects-popup already
  lets a human leave ANY offered effect unchecked.

**"Cannot flee or be switched out" reuses `trapped`** (`kind:"condition"`,
the SAME mechanism Ingrain/Thousand Waves already use, matching the move's
OWN near-verbatim wording -- `_MOVEMENT_BLOCKING_CONDITIONS` in
routes_combat.py already gives it this exact meaning). Real, enforced
automation for the "flee" half (`_move_token` hard-blocks a trapped
participant's own grid movement); the "switched out" half stays advisory
only -- there is no switch-Pokémon mechanic ANYWHERE in the shared combat
system yet (routes_combat.py has no switch action at all, only the legacy
local engine does, and only for Ingrain specifically), a real, separate,
much bigger gap than this migration pass is scoped to close.
- **Fairy Lock**: no save at all (the move's own text has none) --
  `when:"always"`, the same `target:"self"` + target-unset dual-effect
  shape Haze/Safeguard/Mat Block already use for an automatic, no-save AoE
  (a human picks who's actually in the 40ft circle). `ends:
  {until_turn, point:"end", count:1}` for "on their next turn" -- the
  restriction needs to still be live DURING that turn, not have already
  lifted by its start.
- **Mean Look**: `when:{save_fail, WIS}`, `ends:{rounds, n:3}` (the move's
  own stated duration).
- **Spirit Shackle**: `when:"on_hit"`, `ends:{type:"other", text:...}` --
  "while the user remains in battle" matches no existing `ends` entry (no
  vocabulary for "tied to another specific participant staying in the
  encounter"), so this uses the catch-all ("anything else -- shown, removed
  manually") exactly as documented for cases like it.

The remaining 5 are NOT migrated this pass:
- **U-turn** / **Volt Switch** -- their own "move up to half your speed
  away... or switch out" needs nothing new for the movement half (a player
  can already freely use the existing, fully-working move-token feature
  afterward -- same "the app doesn't need to gate what's already open"
  reasoning Dig/Dive's own un-automated "with advantage" clause gets) and
  the switch-out half is the same unbuilt mechanic noted above. No effects
  entry needed, same precedent as every other move whose own flavor is
  already covered by existing, ungated functionality.
- **Block** -- reacts to "an opponent attempting to flee or switch out",
  which has no trigger point to hook into at all: there's no reaction
  window opened before a token move is attempted (unlike 'beneficial', the
  self-buff gap closed in steal_disrupt, this would need intercepting
  _move_token itself, a different shape again), and "switch out" still
  isn't a mechanic in this app's shared system.
- **Pasta Portal** -- compounds THREE separate unbuilt systems at once: a
  persistent map hazard/trap tile players and enemies can walk through
  (nothing like `fieldEffects`/per-cell terrain tracking is wired to
  anything), a "flee the whole encounter" group-check mechanic (distinct
  from grid movement, which `trapped`/`_move_token` already cover), and the
  same switch-out gap. Not a small increment on anything already built.
- **Strafe** -- its own post-hit reposition ("fly to a position within
  30ft of the target") is a SPECIAL grant explicitly OUTSIDE the normal
  movement budget ("ignoring your flying speed"), unlike U-turn/Volt
  Switch's plain "up to half your speed" (which IS normal budgeted
  movement, hence need nothing new) -- reusing `_move_token` directly would
  incorrectly check/consume the character's own ordinary per-turn
  allowance for a move whose text says it doesn't. Needs a "reposition that
  bypasses the normal movement budget" action that doesn't exist, plus the
  same switch-out alternative.

    python migrate_effects_v49.py            # dry run
    python migrate_effects_v49.py --apply
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


ALWAYS = {'type': 'always'}
INSTANT = [{'type': 'instant'}]

OVERRIDES = {
    'Circle Throw': {
        'effects': [
            {
                'kind': 'condition', 'apply': 'forced_movement', 'when': {'type': 'on_hit'}, 'ends': INSTANT,
                'note': '30ft (your size or smaller target), 15ft (one size larger), or 5ft (two+ sizes larger), in a direction of your choice. A collision with a solid surface or another creature deals 1d6 typeless damage to both -- not automated.',
            },
        ],
    },
    'Lava Cannon': {
        'effects': [
            {
                'kind': 'condition', 'apply': 'forced_movement', 'when': {'type': 'save_fail', 'ability': 'DEX'}, 'ends': INSTANT,
                'note': 'Pushed back 10ft, straight away from the line.',
            },
        ],
    },
    'Magnetic Pulse': {
        'effects': [
            {
                'kind': 'condition', 'apply': 'forced_movement', 'when': {'type': 'save_fail', 'ability': 'STR'}, 'ends': INSTANT,
                'note': 'Pulled 15ft toward you or pushed 15ft away, your choice. Only affects Steel-type creatures, or ones wearing metal armor/holding a metal weapon -- use judgment for anyone else.',
            },
        ],
    },
    'Roar': {
        'effects': [
            {
                'kind': 'condition', 'apply': 'forced_movement', 'when': {'type': 'save_fail', 'ability': 'CHA'}, 'ends': INSTANT,
                'note': 'The creature Disengages (free action) and moves up to its own speed in a straight line directly away from you. Allies are unaffected.',
            },
        ],
    },
    'Strength': {
        'effects': [
            {
                'kind': 'condition', 'apply': 'forced_movement', 'when': {'type': 'on_hit'}, 'ends': INSTANT,
                'note': 'Optional -- pushed 5ft away, your choice.',
            },
        ],
    },
    'Fairy Lock': {
        'effects': [
            {'kind': 'condition', 'apply': 'trapped', 'target': 'self', 'when': ALWAYS, 'ends': [{'type': 'until_turn', 'whose': 'holder', 'point': 'end', 'count': 1}]},
            {
                'kind': 'condition', 'apply': 'trapped', 'when': ALWAYS, 'ends': [{'type': 'until_turn', 'whose': 'holder', 'point': 'end', 'count': 1}],
                'note': "Blocks grid movement (this app's own enforced meaning for trapped); switching out isn't a mechanic this app's shared combat system has yet, so that half stays advisory only.",
            },
        ],
    },
    'Mean Look': {
        'effects': [
            {
                'kind': 'condition', 'apply': 'trapped', 'when': {'type': 'save_fail', 'ability': 'WIS'}, 'ends': [{'type': 'rounds', 'n': 3}],
                'note': "Blocks grid movement; switching out isn't a mechanic this app's shared combat system has yet, so that half stays advisory only.",
            },
        ],
    },
    'Spirit Shackle': {
        'effects': [
            {
                'kind': 'condition', 'apply': 'trapped', 'when': {'type': 'on_hit'}, 'ends': [{'type': 'other', 'text': 'until the attacker leaves the battle'}],
                'note': "Blocks grid movement; switching out isn't a mechanic this app's shared combat system has yet, so that half stays advisory only.",
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
