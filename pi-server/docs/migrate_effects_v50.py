#!/usr/bin/env python3
"""Move migration, fiftieth slice: `heal_target_or_aoe` (9 moves), the
easy half -- Aromatherapy, Heal Bell, Scrub Down, Purify, Pollen Puff,
Present. Wish and Harmony Breath need real new plumbing (see
migrate_effects_v51.py); Cactus Bloom stays unmigrated (see its own note
in move-effects-schema.md).

- **Aromatherapy** / **Heal Bell** ("cured of all negative status
  ailments", AoE, no save): a new `stat_transfer` mode, `"dispel_conditions"`
  -- the inverse scope of the existing `"dispel"` (which only ever touches
  `kind:'stat'`): this removes every `kind:'condition'` status instead,
  leaving stat buffs/debuffs untouched. No "negative" filtering needed on
  top of that -- this app has no condition ever authored as a deliberate
  benefit to its own holder, so "every condition" and "every negative one"
  are the same set in practice. Both ship as the same `target:"self"` +
  target-unset dual-effect pair Haze/Safeguard/Mat Block already use for an
  automatic (no-save) AoE, since both heal "you and all allies".

- **Scrub Down** ("remove one condition... if you keep concentration until
  the beginning of your next turn, and are still within touching range"):
  the ALREADY-BUILT `dispel_one` mode (Searing Flame), applied immediately
  rather than modeling the delayed/conditional-on-concentration resolution
  -- a documented simplification (noted on the effect itself) rather than
  new infrastructure, since dispel has no "repeat"/delayed-firing concept
  the way `heal` does.

- **Purify** ("remove all status effects from a target... restores the
  user's HP by twice its level... cannot target itself"): `dispel_all`
  (broader than Aromatherapy/Heal Bell's own condition-only scope -- "all
  status effects" reads as every kind, matching Haze's own established
  "stat bonuses... status effects... are removed" wording) + a plain `heal`
  effect (`{levelMultiple: 2}`, target:"self") approximating "twice its
  level" as a flat per-use amount -- there's no mechanism to scale a heal
  by HOW MANY statuses a dispel just removed, so this doesn't try to.
  "Cannot target itself" is enforced by simply never authoring a
  `target:"self"` dispel effect for it.

- **Pollen Puff** ("if the target is an ally, it heals for half the damage
  roll instead"): a plain `heal` effect (`{fractionOfDamage: 0.5,
  moveMod:true}`, `when:"on_hit"`) offered ALONGSIDE the move's own normal
  damage -- this app has no team/faction concept to auto-detect "ally"
  (the same documented gap `blocking_shield`/Searing Flame's own dispel_one
  already have), so the note tells the human to zero out the damage roll
  (or otherwise undo it) and use this heal instead when the target turns
  out to be an ally.

- **Present** ("If the natural attack roll is 2 or lower, REGARDLESS if it
  hits, the present provides 1d6 + MOVE hit points instead"): a new `when`
  type, `"natural_roll_at_most"` (move-effects.js's `evaluateEffect` --
  deliberately does NOT gate on `hit` the way the existing `natural_roll`
  does, since this move's own text is explicit it still counts on a miss).
  A plain `heal` effect using it, target unset (the TARGET receives the
  gift, not the caster).

    python migrate_effects_v50.py            # dry run
    python migrate_effects_v50.py --apply
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
    'Aromatherapy': {
        'effects': [
            {'kind': 'stat_transfer', 'mode': 'dispel_conditions', 'target': 'self', 'when': ALWAYS, 'ends': INSTANT},
            {'kind': 'stat_transfer', 'mode': 'dispel_conditions', 'when': ALWAYS, 'ends': INSTANT},
        ],
    },
    'Heal Bell': {
        'effects': [
            {'kind': 'stat_transfer', 'mode': 'dispel_conditions', 'target': 'self', 'when': ALWAYS, 'ends': INSTANT},
            {'kind': 'stat_transfer', 'mode': 'dispel_conditions', 'when': ALWAYS, 'ends': INSTANT},
        ],
    },
    'Scrub Down': {
        'effects': [
            {
                'kind': 'stat_transfer', 'mode': 'dispel_one', 'when': ALWAYS, 'ends': INSTANT,
                'note': 'Applied immediately -- assumes you keep concentration and stay in touching range until the beginning of your next turn. Undo by hand if either breaks first.',
            },
        ],
    },
    'Purify': {
        'effects': [
            {'kind': 'stat_transfer', 'mode': 'dispel_all', 'when': ALWAYS, 'ends': INSTANT},
            {
                'kind': 'heal', 'amount': {'levelMultiple': 2}, 'target': 'self', 'when': ALWAYS, 'ends': INSTANT,
                'note': 'Approximates "twice its level" as a flat per-use heal -- not scaled by how many statuses were actually removed.',
            },
        ],
    },
    'Pollen Puff': {
        'effects': [
            {
                'kind': 'heal', 'amount': {'fractionOfDamage': 0.5, 'moveMod': True}, 'when': {'type': 'on_hit'}, 'ends': INSTANT,
                'note': "Only if the target is an ally -- zero out (or otherwise undo) the damage roll above and use this heal instead.",
            },
        ],
    },
    'Present': {
        'effects': [
            {'kind': 'heal', 'amount': {'dice': '1d6', 'moveMod': True}, 'when': {'type': 'natural_roll_at_most', 'max': 2}, 'ends': INSTANT},
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
