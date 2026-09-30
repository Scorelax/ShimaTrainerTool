#!/usr/bin/env python3
"""Move migration, fortieth slice: Lucky Chant -- the third of
protect_negate's "needs real work" remainder (see migrate_effects_v38.py's
own module docstring for the pushback that started this).

Lucky Chant ("When a creature scores a critical hit on you, you may use your
reaction to quickly recite a magical incantation that treats the attack like
a normal hit, preventing the extra damage.") was deferred in v37 as needing
"a third reaction timing neither `targeted` nor `damaged` covers -- crit
itself isn't even determined until well after target-picker.js's own
attack-roll step has closed." That was solving the wrong problem: instead of
intercepting BEFORE damage (which does need a timing this schema doesn't
have), this reuses `reroll_damage`'s own established shape -- a RETROACTIVE
correction against damage that's already landed, same 'damaged' family
Attract already rides. "Treats it like a normal hit" becomes "refund half
the crit's own final total", the same halving approximation Wide Guard/
Nature's Embrace's own rules text already leans on (this app has no digital
dice, so there's no real "what a non-crit roll would have been" to recompute
from, only the crit's own total to work backward from).

The one genuinely missing piece: a 'damaged' reactor has no way to know
whether the hit that just landed on THEM was a crit at all -- that's only
ever computed on the ATTACKER's own device (combat-wip.js's _resolveOneHit),
and never made it onto the shared damage log entry. Fixed by:
- Reordering _resolveOneHit's own crit computation to run BEFORE
  CombatAPI.applyDamage instead of after (nothing it depends on -- picked,
  categories, guaranteedHit, effectiveStats -- comes from the damage result
  itself, so this is a safe reorder; status CONSUMPTION -- useStatus calls
  for Laser Focus/Lock-On/Mind Reader -- stays in its original post-damage
  position, only the pure `crit` boolean computation moved).
- Threading a new `crit` param through CombatAPI.applyDamage -> the
  apply-damage action -> _apply_damage/_apply_damage_to_target -> the
  'damage' log entry itself (`entry.crit`). Arrives as the string "true"/
  "false" like every other query-string param this app already parses
  explicitly (see the action handler's own comment).

New `kind: "undo_crit_damage"` effect ({target:"self", when:"always" --
deterministic, not a human judgment call like Parry/Captivate/Hover's own
"special": the log entry either says crit:true or it doesn't, so
_handleUndoCritDamage checks that directly instead of asking the reactor to
self-report it}). `tag_for` (migrate_effects_v2.py) gets a matching branch.
Unlike `reroll_damage` (which rides a save_fail and gets its "who's the
attacker" from that save's own targeting flow), Lucky Chant has no save at
all -- it's offered through `_handleEffectsOnly`'s plain self-only path,
which passes no targetId whatsoever. `_handleUndoCritDamage` instead reads
the attacker straight off the most recent damage log entry against the
reactor (`entry.actorId`/`actorName`) -- no second lookup needed, this app
already logs everything required.

    python migrate_effects_v40.py            # dry run
    python migrate_effects_v40.py --apply
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
    'Lucky Chant': {
        'fields': {'reactionTrigger': 'damaged', 'reactionRange': 0},
        'effects': [
            {'kind': 'undo_crit_damage', 'target': 'self', 'when': {'type': 'always'}, 'ends': [{'type': 'instant'}]},
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
