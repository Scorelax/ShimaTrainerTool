#!/usr/bin/env python3
"""Move migration, thirty-fifth slice: 4 of the 23 `steal_disrupt` moves
(the biggest remaining category) -- read all 23 full descriptions first,
same discipline as every prior category. Most are genuinely blocked (item
theft with no held-item field anywhere in this app's combat data model;
a Pokemon "Ability" subsystem that doesn't exist; the already-known
"choose which stat, paired effect" gap; barrier moves/field-terrain/speed
that aren't built yet; and five DIFFERENT reactive-theft mechanics, each
bespoke, none sharing a mechanism worth building together). Four share one
real, buildable mechanism: read the currently active `kind:'stat'` statuses
on one or two participants and remove/copy/swap/steal them.

New `stat_transfer` effect kind (combat-wip.js's own `_handleStatTransfer`,
intercepted in `_offerMoveEffects` same as `reroll_damage`/`block_attack`/
`prevent_faint` -- never actually stored as a status itself, a one-shot
bulk operation against whatever's already live):
  - `mode: 'dispel'` -- Clear Smog: "any stat changes affecting the target
    ... are reset" -- removes every kind:'stat' status from the target.
  - `mode: 'copy'` -- Psych Up: "copying any positive or negative stat
    changes affecting them" -- recreates the target's own kind:'stat'
    statuses onto the user, target's own copy untouched.
  - `mode: 'swap'` -- Heart Swap: "swap any changes ... currently in
    effect on you or the target" -- exchanges BOTH sides' current
    kind:'stat' statuses.
  - `mode: 'steal'` -- Spectral Thief: "steal all positive stat changes
    affecting the creature" -- moves only the target's POSITIVE
    kind:'stat' statuses onto the user, removed from the target. Its own
    teleport-then-attack clause is NOT modeled (positioning isn't built
    yet) -- the damage+steal half still fully works, same partial-
    migration precedent as everywhere else in this effort.
Recreated statuses keep their ORIGINAL sourceId/sourceName/moveName/dc (a
copied Focus Energy still reads "from Focus Energy") -- only the stat
delta itself moves. Remaining duration isn't preserved exactly (restarts
from the status's own authored `ends`) -- documented, not modeled.

Also required a new `tag_for` branch (migrate_effects_v2.py) -- an
unrecognized `kind` would otherwise crash trying to read `roll`/`on`
fields this new kind doesn't have.

NOT migrated in this pass -- see this file's own module docstring intro
for the full breakdown, not repeated per-move here: Covet/Thief (no held-
item field anywhere), Simple Beam (no Ability subsystem), Defog/Speed
Swap/Psychic Fangs (each blocked on a different not-yet-built category),
Entraintment/Skill Swap (the already-known "choose which stat" gap),
Electrify/Heal Block/Snatch/Spectral Surge/Strength Sap (five distinct
reactive-theft mechanics, no shared mechanism). Guard Swap/Power Swap/
Role Play (swap or copy ONE CHOSEN stat, not everything) and Psycho Shift
(transfer ONE status) are real and buildable but need their own small
"choose which" picker each -- deliberately held for a separate slice
rather than folded in here.

    python migrate_effects_v35.py            # dry run
    python migrate_effects_v35.py --apply
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
ON_HIT = {'type': 'on_hit'}
INSTANT = [{'type': 'instant'}]

OVERRIDES = {
    'Clear Smog': [
        {'kind': 'stat_transfer', 'mode': 'dispel', 'when': ON_HIT, 'ends': INSTANT},
    ],
    'Psych Up': [
        {'kind': 'stat_transfer', 'mode': 'copy', 'when': ALWAYS, 'ends': INSTANT},
    ],
    'Heart Swap': [
        {'kind': 'stat_transfer', 'mode': 'swap', 'when': {'type': 'save_fail', 'ability': 'CHA'}, 'ends': INSTANT},
    ],
    'Spectral Thief': [
        {
            'kind': 'stat_transfer', 'mode': 'steal', 'when': ON_HIT, 'ends': INSTANT,
            'note': 'Teleporting to the target first is not automated -- position the token by hand.',
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
