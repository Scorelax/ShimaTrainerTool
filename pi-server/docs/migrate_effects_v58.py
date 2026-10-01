#!/usr/bin/env python3
"""Move migration, fifty-eighth slice: `heal_self` (2 moves) -- the last of
the size-ordered small categories.

- **Burning Glance** ("When hit by a melee attack, you may use this
  reaction to make a melee attack... on a critical hit, no additional
  damage is done, but you regain the damage done as VP") needed NOTHING
  new at all -- it's a plain melee attack (no `trigger_saving_throw` tag,
  so it goes through the ordinary single-target attack-roll flow exactly
  like any other damage move; "reaction" only changes WHEN it's used, via
  the pre-existing reaction-floor mechanism, not WHICH flow handles it),
  with a `heal` effect gated `when:"crit"` (an EXISTING `evaluateEffect`
  case, never used by anything in this category before) instead of
  `on_hit` -- the drain-back only fires on a crit, matching the move's own
  text exactly. `pool:"VP"` is the same already-built field `drain` used
  for Energize/Enervation Ray/Recompose.

- **Refresh** ("curing poison, paralysis, and burn") needed one new small
  `stat_transfer` mode, `"cure_named"` -- a NAMED subset of conditions,
  narrower than the existing `dispel_conditions` mode (Aromatherapy/Heal
  Bell's own "cured of all negative status ailments"): Refresh's own text
  doesn't say "all ailments", just these three by name, so an unrelated
  condition like Confused is correctly left untouched. `names` (array of
  `apply` values) says exactly which; `_handleStatTransfer` just filters
  `target.statuses` down to `kind:'condition'` AND `names.includes(apply)`
  before removing -- the same remove() helper every other dispel mode
  already uses, no new mechanism beyond the one new filter.

This closes `heal_self` (2/2) and the ENTIRE size-ordered "small category"
run -- what remains is leftover one-offs already flagged as genuinely novel
inside categories visited earlier (Echoed Voice/Round, Cactus Bloom, Stored
Power, Throat Chop), the larger not-yet-touched categories (field_terrain,
field_weather, and the remainders of positioning/protect_negate/
steal_disrupt), and 32 "unknown" moves needing manual review before
anything else.

    python migrate_effects_v58.py            # dry run
    python migrate_effects_v58.py --apply
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
    'Burning Glance': {
        'effects': [
            {
                'kind': 'heal', 'amount': {'fractionOfDamage': 1.0, 'pool': 'VP'}, 'when': {'type': 'crit'},
                'target': 'self', 'ends': [{'type': 'instant'}],
                'note': 'Only on a crit -- a normal hit deals damage with no VP regained.',
            },
        ],
    },
    'Refresh': {
        'effects': [
            {
                'kind': 'stat_transfer', 'mode': 'cure_named', 'names': ['poisoned', 'paralyzed', 'burned'],
                'when': {'type': 'always'}, 'target': 'self', 'ends': [{'type': 'instant'}],
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
