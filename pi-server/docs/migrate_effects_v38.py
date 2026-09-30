#!/usr/bin/env python3
"""Move migration, thirty-eighth slice: Feint -- the first of protect_negate's
"needs real work" remainder actually built, after the user pushed back on
migrate_effects_v37.py's own count of what got deferred (Feint, Wide Guard
and several others were called out as too readily written off).

Feint ("When a creature you are targeting declares it will use Protect,
Detect, or similar protective move in response, you may use your reaction to
activate Feint. Your attack bypasses the protection and resolves normally,
and the target gets half the VP for the protection move refunded.") was
deferred in v37 as "a reaction to a DEFENDER's own declared reaction -- this
app's one-floor-holder-at-a-time turn model has no shape for that." That
framing was too literal: the tabletop flavor text describes a nested
interrupt, but the actual GAME OUTCOME only needs the ATTACKER to undo an
already-recorded block after the fact, which needs no interrupt nesting at
all -- by the time Feint could ever apply, the blocker's own reaction has
already fully resolved (`reactionBlock` is set, possibly after its window
has even closed). So Feint is authored as a plain follow-up action the
attacker takes, checked purely by identity against the block record, not
through the reaction-floor machinery every OTHER reaction in this app uses.

New pieces (routes_combat.py):
- `_block_pending_attack` now takes the blocker's own move name and stores
  it on `reactionBlock` -- needed so Feint knows whose move's VP cost to
  refund half of.
- `_negate_reaction_block` (new `negate-reaction-block` action): the
  attacker recorded on `reactionBlock` may call this once to mark it
  negated, charging Feint's OWN vp_cost against themselves (same VP-floors-
  at-0-overflows-into-HP rule `_apply_move` already uses) and refunding half
  the blocker's move's vp_cost to them.
- `_list_move_categories` gains a `flags` map alongside `categories`/
  `effects` -- Feint's own `negatesProtectBlock: true` top-level marker,
  the first thing in this schema that isn't shaped like an `effects` entry
  at all but still needs a client-side read (target-picker.js scans the
  attacker's whole moveset for a move carrying this flag to decide whether
  to offer "Use Feint" after a block -- see combat-wip.js's new
  `_feintMoveNameFor`).

Client-side: target-picker.js's `_afterTargetSelected` (the ONE place a
`block_attack` result is already handled) now offers a confirm dialog on a
block, if the attacker knows a `negatesProtectBlock` move -- accepting calls
`negateReactionBlock` and, on success, proceeds exactly as if the block
never happened. target-picker.js still has no dependency on combat.js (its
own stated design constraint) -- `feintMoveName` is resolved by the CALLER
(combat-wip.js) and passed in as a plain string, same layering every other
combat.js-derived value (categories, guaranteedHit) already respects at that
boundary.

Feint itself gets no `effects` entry -- its whole mechanism is the
`negatesProtectBlock` flag plus the bespoke code above, not the generic
`_offerMoveEffects` popup flow (there's no attack of Feint's OWN to roll;
what it acts on is already fully specified by the just-recorded block). Its
`categories` (`counter_reaction_effect`, `protect_negate`) are left exactly
as originally hand-assigned, same as the 7 `ignoresProtect` moves that also
carry no `effects` array.

    python migrate_effects_v38.py            # dry run
    python migrate_effects_v38.py --apply
"""
import json
import sys
from pathlib import Path

FILE = Path(__file__).with_name('DnD_moves_categorized_draft.json')

FIELD_OVERRIDES = {
    'Feint': {'negatesProtectBlock': True},
}


def main():
    apply_it = '--apply' in sys.argv
    data = json.loads(FILE.read_text(encoding='utf-8'))
    moves = data['moves']
    by_name = {m['name']: m for m in moves}

    missing = [n for n in FIELD_OVERRIDES if n not in by_name]
    if missing:
        print('ERROR -- unknown move names:', missing)
        sys.exit(1)

    print(f'{len(FIELD_OVERRIDES)} moves getting field updates')
    for name, fields in FIELD_OVERRIDES.items():
        print(f'## {name}  fields={fields}')

    if not apply_it:
        return
    for name, fields in FIELD_OVERRIDES.items():
        by_name[name].update(fields)
    FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
    print('\nwritten')


if __name__ == '__main__':
    main()
