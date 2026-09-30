#!/usr/bin/env python3
"""Move migration, thirty-ninth slice: Wide Guard -- the second of
protect_negate's "needs real work" remainder, after the user's pushback
(see migrate_effects_v38.py's own module docstring for the first, Feint).

Wide Guard ("As a reaction, when a creature activates a damaging move that
damages multiple allies within range, you may halve the damage dealt.")
was deferred in v37 for two stated reasons: it halves rather than negates,
and the reaction window would need to open INSIDE an AoE resolution, which
`_handleMultiHitAoe` (combat-wip.js) didn't have one at all. Both addressed
here, at the cost of one real simplification the user explicitly signed off
on ("wide guard gives damage reduction to nearby allies, which we can spot
on the battle map" -- i.e. a human eyeballing who's actually in range is
fine, same established trust model as every other AoE-membership check in
this app; nothing new needed there).

New pieces:
- A new effect `kind: "damage_multiplier"` ({multiplier, target:"self",
  when:"special" -- the Protect family's own "roll over 15 after the first
  use" escalating cost stays a manual human judgment call, same treatment
  Parry/Captivate/Hover already get for THEIR own conditional outcomes}).
  `tag_for` (migrate_effects_v2.py) gets a matching branch.
- `_offerMoveEffects` (combat-wip.js) special-cases it exactly like
  `block_attack` -- a one-shot signal to the ATTACKER's own client instead
  of a stored status, just scaling the damage that still lands instead of
  cancelling it. New `CombatAPI.applyReactionDamageMultiplier` ->
  routes_combat.py's own `_apply_reaction_damage_multiplier`, recording
  {windowId, anchorId, attackerId, reactorId, reactorName, multiplier} on a
  new top-level `reactionDamageMultiplier` session field, structurally
  identical to `reactionBlock` (same windowId-matching, same "never cleared,
  harmless when stale" reasoning).
- `reaction-window.js`'s `waitForReactionWindow` now watches BOTH
  `reactionBlock` and `reactionDamageMultiplier`, resolving to
  `{blocked}` or `{blocked: false, multiplier, reactorName}`.
- `_handleMultiHitAoe` now opens ONE 'targeted' reaction window right after
  targets are picked, anchored on the FIRST target actually selected (this
  app has no real blast-center/positional-radius concept, so this is the
  closest stand-in for "is the reactor in range of the blast" -- a
  documented approximation, not a precision claim). A `block_attack`
  reactor (Protect et al, also eligible here since this reuses the same
  'targeted' family Wide Guard rides on) only ever protects its own user,
  so it's filtered OUT of the AoE's own target list rather than aborting
  the whole resolution. A `damage_multiplier` reactor (Wide Guard) instead
  scales every remaining target's own damage -- threaded through both of
  this function's branches (the trigger_saving_throw one inline, the
  guaranteed-hit one via a new optional `damageMultiplier` param on
  `_resolveOneHit`, defaulted to 1 everywhere else so no other caller's
  behavior changes). New `waitForTargetedAoeReactions`
  (reaction-wait-overlay.js, generalized from the 'damaged'-only
  `waitForDamagedReactions` it already shared code with) gives this its own
  non-interactive "waiting..." overlay, since (unlike target-picker.js's
  single-target flow) this loop has no existing popup step to pause inside
  of -- same situation the 'damaged' family was already in.

    python migrate_effects_v39.py            # dry run
    python migrate_effects_v39.py --apply
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
    'Wide Guard': {
        'fields': {'reactionTrigger': 'targeted', 'reactionRange': 50},
        'effects': [
            {
                'kind': 'damage_multiplier', 'multiplier': 0.5, 'target': 'self', 'when': {'type': 'special'},
                'ends': [{'type': 'instant'}],
                'note': 'Only the first use each combat is free -- after that, roll over 15 on a d20 or forfeit the reaction with no effect.',
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
        print(f'## {name}  ({len(effects)} effect(s))  fields={spec.get("fields", {})}')
        for e in effects:
            print('   ', json.dumps(e, ensure_ascii=False))

    if not apply_it:
        return
    for name, spec in OVERRIDES.items():
        m = by_name[name]
        effects = spec['effects']
        m['effects'] = effects
        m['categories'] = rebuild_categories(m['categories'], effects)
        m.update(spec.get('fields', {}))
    FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
    print('\nwritten')


if __name__ == '__main__':
    main()
