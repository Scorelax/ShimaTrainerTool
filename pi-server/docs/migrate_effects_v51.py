#!/usr/bin/env python3
"""Move migration, fifty-first slice: Wish and Harmony Breath --
`heal_target_or_aoe`'s two moderate builds (see migrate_effects_v50.py for
the easy half of this category). Cactus Bloom stays unmigrated (see its own
note below).

- **Wish** ("At the end of YOUR next turn, as a free action, heal a target
  in range"): the repeat-heal machinery (`_promptTurnHeals`/
  `_applyRecurringHeal`) always fires at the STATUS HOLDER's own turn
  boundary -- every prior `repeat` heal (Aqua Ring, Ingrain) is self-only,
  so holder and recipient were always the same participant. Wish needs the
  opposite: the status must be held by the CASTER (to fire at the CASTER's
  own next turn end, not the healed target's) while actually healing
  someone else. New `healTargetId` field (added to `_STATUS_FIELDS` so it
  actually persists -- it was silently dropped before), set by a new
  special case in `_offerMoveEffects` (`kind:"heal"` + `repeat` + NOT
  `target:"self"` -- the one combination no existing move needed) that
  applies the status to the CASTER with `healTargetId` pointing at whoever
  the human picked. `_applyRecurringHeal` now reads `status.healTargetId`
  to redirect the heal, while still computing "+MOVE" and any level-based
  scaling off the HOLDER's own stats -- it's the holder's move, not the
  recipient's. Backward compatible: Aqua Ring/Ingrain never set
  `healTargetId`, so `holderId` and `recipientId` stay the same participant
  for them, unchanged.

- **Harmony Breath** ("Allied creatures caught in the blast heal for half
  the amount rolled + MOVE"): already `multi_hit_aoe`/`trigger_saving_throw`
  (the hostile-damage half needs no effects entry at all, same as any other
  AoE). The ally-heal half is a plain `kind:"heal"` effect
  (`{fractionOfDamage: 0.5, moveMod:true}`, target unset) -- what's new is
  `_handleMultiHitAoe` itself gaining a SECOND multi-target picker after its
  main hostile loop, gated on the move actually having a non-self heal
  effect (so this extra prompt never shows for any other AoE move), healing
  whichever allies the human says were ALSO caught in the cone off the SAME
  `totalDamageDealt` the hostile loop already summed -- one shared roll
  resolved once for the whole blast, not a second roll just for allies.
  This app has no team/faction concept to auto-split hostile from ally (the
  same documented gap `blocking_shield`/Searing Flame/Pollen Puff already
  have), so a human picks for both halves.

**Cactus Bloom** ("When a creature in range falls in battle, you may cause
a cactus to grow out of it... the fallen creature now has one failed death
save. The cactus fruit may be picked and consumed to heal 2d4+2 HP") stays
unmigrated -- it compounds three separate things this app has no hook for
at all: a "participant just fainted" reaction trigger (nothing like it
exists -- every reaction here fires off an attack/damage/self-buff moment,
never a fainting event), real death-save tracking to add a failed one to,
and a persistent, pickable battlefield object (the same hazard-tile gap
Pasta Portal's own deferral already named). Not a small increment on
anything already built.

    python migrate_effects_v51.py            # dry run
    python migrate_effects_v51.py --apply
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
    'Wish': {
        'effects': [
            {
                'kind': 'heal', 'amount': {'dice': '3d8', 'moveMod': True}, 'repeat': 'end_of_turn', 'when': ALWAYS,
                'ends': [{'type': 'until_turn', 'whose': 'holder', 'point': 'end', 'count': 1}],
            },
        ],
    },
    'Harmony Breath': {
        'effects': [
            {'kind': 'heal', 'amount': {'fractionOfDamage': 0.5, 'moveMod': True}, 'when': ALWAYS, 'ends': INSTANT},
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
