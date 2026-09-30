#!/usr/bin/env python3
"""Move migration, forty-third slice: Crafty Shield, Mat Block, Testudo
Formation -- the last three of protect_negate's "needs real work" remainder
(see migrate_effects_v38.py's own module docstring for the pushback that
started this whole re-pass). Only Shield Dome is left after this one, and it
stays deferred for a reason genuinely unlike anything else in this category
(see its own note in move-effects-schema.md -- real wall/line-of-sight
geometry this app's grid has no representation of at all, a battle-map
feature, not a move-effects one).

- **Crafty Shield** ("blocks an incoming status condition ... you or an ally
  within 5 feet"): re-assessed after the pushback and shipped as a
  documented simplification rather than left fully unmigrated. Reuses
  `block_attack`/`when:"special"` exactly like Parry/Captivate/Hover --
  correct for the common case (a pure status-inflicting move with no damage
  component), an over-correction for a damage+condition combo move (Thunder
  Punch-style), which this app has no mechanism to selectively cancel just
  the condition half of. The `note` field says so explicitly rather than
  silently shipping a move that sometimes does more than its own text says.
  `reactionTrigger:"targeted"`/`reactionRange:5` (Shield Guardian's own
  ally-range precedent).

- **Mat Block** / **Testudo Formation**: a genuinely new mechanism,
  `incoming_damage_multiplier`/`outgoing_damage_multiplier` (conditions.py),
  checked in `_apply_damage_to_target` -- Mat Block's "immune to damage from
  damaging moves" (0x) and Testudo's "take half damage... the damage they
  deal is also halved" (0.5x both ways) are both STANDING, multi-turn
  conditions scaling every hit during their duration, unlike
  `block_attack`/`damage_multiplier`'s one-shot reaction-window cancel of a
  single attack. Applied server-side, so every client call site
  (CombatAPI.applyDamage, wherever it's called from) is covered automatically.
  Kept separate from the logged type `multiplier` field -- Nature's Embrace's
  own reactor-side "was I vulnerable" check reads that field, and a
  Mat-Block-zeroed or Testudo-halved hit shouldn't look like a type-chart
  result it never was.

  Both moves ship with the SAME dual-effect shape Haze/Safeguard's own AoE
  buffs already use (`target:"self"` for the caster + target-unset for the
  multi-target picker covering allies/formation-mates) -- this app has no
  positional-radius detection, so a human picks who's actually in range,
  same established limit as every other AoE move here.

  Testudo Formation's OWN two riders stay manual, flagged in a `note`
  (same "partial-implementation precedent" this schema already uses
  elsewhere): automatically avoiding the ONE triggering attack (a
  multi-participant simultaneous block this app's reaction-window model,
  keyed to a single anchor, has no shape for) and "rooted together...
  until the beginning of your next turn" (a positional-linking constraint
  `_move_token` has no concept of). Both are narrower gaps than the
  category's original "not a small increment on anything already built"
  framing suggested, but still real and not silently dropped.

    python migrate_effects_v43.py            # dry run
    python migrate_effects_v43.py --apply
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
SPECIAL = {'type': 'special'}
INSTANT = [{'type': 'instant'}]

OVERRIDES = {
    'Crafty Shield': {
        'fields': {'reactionTrigger': 'targeted', 'reactionRange': 5},
        'effects': [
            {
                'kind': 'block_attack', 'target': 'self', 'when': SPECIAL, 'ends': INSTANT,
                'note': 'Only if the incoming move inflicts a status condition. Cancels the WHOLE attack, including any accompanying damage -- correct for a pure status move, an overcorrection for a damage+condition combo move (use judgment for those).',
            },
        ],
    },
    'Mat Block': {
        'effects': [
            {'kind': 'condition', 'apply': 'mat_block', 'target': 'self', 'when': ALWAYS, 'ends': [{'type': 'until_turn', 'whose': 'holder', 'point': 'end', 'count': 1}]},
            {'kind': 'condition', 'apply': 'mat_block', 'when': ALWAYS, 'ends': [{'type': 'until_turn', 'whose': 'holder', 'point': 'end', 'count': 1}]},
        ],
    },
    'Testudo Formation': {
        'fields': {'reactionTrigger': 'targeted', 'reactionRange': 0},
        'effects': [
            {
                'kind': 'condition', 'apply': 'testudo_formation', 'target': 'self', 'when': ALWAYS,
                'ends': [{'type': 'until_turn', 'whose': 'holder', 'point': 'start', 'count': 1}],
                'note': "Also automatically avoids the attack this reaction responds to, and roots the whole formation together until the beginning of your next turn -- neither is modeled, apply/track both by hand.",
            },
            {'kind': 'condition', 'apply': 'testudo_formation', 'when': ALWAYS, 'ends': [{'type': 'until_turn', 'whose': 'holder', 'point': 'start', 'count': 1}]},
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
