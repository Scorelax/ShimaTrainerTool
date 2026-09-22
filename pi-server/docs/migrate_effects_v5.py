#!/usr/bin/env python3
"""Move migration, fourth slice: `set`-based stat effects (see
move-effects-schema.md's own `set` section for how the mechanic works) --
Superpower (a flat literal) and Laser Focus (not a `set` at all, a standalone
"next attack auto-crits" condition -- guaranteed_next_crit).

Guard Split is deliberately NOT in this batch, even though {avgWithTarget}
resolution was built for it -- it's a self-target effect ("your AC becomes
the average...") gated on an ENEMY's CHA save, and _handleEffectsOnly (the
handler for every effects-only move, combat-wip.js) only ever picks a target
when a non-self effect exists; a self effect whose own `when` needs an
external target/save has no routing today (the same known gap the code's
own comments already flag for Devastating Tremors' self-save). Applying it
anyway would silently never prompt for a target or roll the save -- needs a
small addition to _handleEffectsOnly first, not guessed at here. Power Trick
and Power Split are also NOT in this batch -- both need a "player picks
which ability score" mechanic that doesn't exist yet (Power Trick: which
score to swap with AC; Power Split: which of STR/DEX/WIS to replace) --
that's a different category the user hasn't specified yet.

    python migrate_effects_v5.py            # dry run
    python migrate_effects_v5.py --apply
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
                out.extend(derived)
                placed = True
            continue
        out.append(c)
    if not placed:
        out.extend(derived)
    return out


def E(kind, **kw):
    e = {'kind': kind}
    e.update(kw)
    return e


def STAT(stat, when, set=None, amount=None, target=None, ends=None, note=None):  # noqa: A002
    e = E('stat', stat=stat, when=when)
    if set is not None:
        e['set'] = set
    if amount is not None:
        e['amount'] = amount
    if target:
        e['target'] = target
    if ends:
        e['ends'] = ends
    if note:
        e['note'] = note
    return e


def CONDITION(apply, when, target=None, ends=None, note=None):
    e = E('condition', apply=apply, when=when)
    if target:
        e['target'] = target
    if ends:
        e['ends'] = ends
    if note:
        e['note'] = note
    return e


ALWAYS = {'type': 'always'}
SELF = 'self'
CONC = {'type': 'concentration'}
USES1 = [{'type': 'uses', 'n': 1}]


def UNTIL_TURN(whose='holder', point='end'):
    return {'type': 'until_turn', 'whose': whose, 'point': point}


def duration_ends(move):
    d = move['duration']
    out = []
    if isinstance(d.get('rounds'), int) and d['rounds'] > 0:
        out.append({'type': 'rounds', 'n': d['rounds']})
    if d.get('concentration'):
        out.append(dict(CONC))
    return out or [{'type': 'encounter'}]


OVERRIDES = {}


def build(moves_by_name):
    m = moves_by_name
    D = lambda name: duration_ends(m[name])  # noqa: E731

    OVERRIDES.update({
        # "your STR and DEX ability scores are set to 10 until the end of your next
        # turn" -- two flat literals, no target/formula to resolve.
        'Superpower': [
            STAT('str', ALWAYS, set=10, target=SELF, ends=[UNTIL_TURN('holder', 'end')]),
            STAT('dex', ALWAYS, set=10, target=SELF, ends=[UNTIL_TURN('holder', 'end')]),
        ],
        # Guard Split held back -- see module docstring (_handleEffectsOnly has no
        # routing yet for a self-effect gated on an ENEMY's save).
        # "your first attack on your next turn always results in a critical hit" --
        # not a stat set at all, a standalone flag (see move-effects.js's
        # guaranteedCritStatusId). Ends on either losing concentration or actually
        # spending it on that attack, whichever comes first.
        'Laser Focus': [
            CONDITION('guaranteed_next_crit', ALWAYS, target=SELF, ends=[dict(CONC)] + USES1),
        ],
    })


def main():
    apply_it = '--apply' in sys.argv
    data = json.loads(FILE.read_text(encoding='utf-8'))
    moves = data['moves']
    by_name = {m['name']: m for m in moves}
    build(by_name)

    missing = [n for n in OVERRIDES if n not in by_name]
    already = [n for n in OVERRIDES if by_name.get(n, {}).get('effects')]
    if missing:
        print('ERROR -- unknown move names:', missing)
        sys.exit(1)
    if already:
        print('ERROR -- already have effects (would overwrite):', already)
        sys.exit(1)

    print(f'{len(OVERRIDES)} moves, {sum(len(v) for v in OVERRIDES.values())} effects')
    for name, effects in OVERRIDES.items():
        print(f'## {name}')
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
