#!/usr/bin/env python3
"""Move migration, third slice: dice-based stat bonuses. Sharpen, Growth,
Aromatic Mist and Helping Hand ("add 1d4/1d6 to a roll") were left out of
migrate_effects_v3.py because the schema's `amount` only supported a flat
number or 'proficiency' -- this adds `amount: {dice: "1d4"}` (see
move-effects-schema.md) and the compound stat `attack_rolls_or_saving_throws`
for the two moves whose bonus can go on either roll type from one shared use
(Growth, Helping Hand -- using it on either consumes the same status). Unlike
every other stat effect so far, a dice amount is never automatic: the
target-picker/save-picker attack- and save-roll steps offer a button per
eligible status, the player rolls the die themselves and types the result in,
and only then is it folded into the total (move-effects.js's
diceBonusOptionsFor / _isDiceAmount).

Growth and Aromatic Mist both grant the bonus to "you (or one ally)" / "you
and any ally in range" -- modeled the same way migrate_effects_v3.py did for
Courtly Grace/Barrier: a target:'self' entry plus a second, untargeted entry
offered through the multi-target picker, note explaining the actual scope.
The human still applies the move's own "or", same trust model as everywhere
else in this schema (see _offerMoveEffects/showEffectsPopup: every effect is
offered, not auto-applied).

    python migrate_effects_v4.py            # dry run
    python migrate_effects_v4.py --apply
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from migrate_effects_v2 import tag_for
from migrate_effects_v3 import RETIRED_V3  # same old flat tags these 4 moves still carry

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


def STAT(stat, amount, when, target=None, ends=None, note=None):
    e = E('stat', stat=stat, amount=amount, when=when)
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


def DICE(d):
    return {'dice': d}


def duration_ends(move):
    """'for the duration' resolved from the move's own raw duration field --
    same OR-semantics as migrate_effects_v3.py's own duration_ends."""
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
        # "You may add 1d4 to all attack rolls for the duration" -- repeatable (no
        # uses cap), just concentration/round-limited like every other status here.
        'Sharpen': [
            STAT('attack_rolls', DICE('1d4'), ALWAYS, target=SELF, ends=D('Sharpen')),
        ],
        # "a creature in range (or you) gains the ability to add a d4 to any attack
        # roll or saving throw for the duration" -- self OR one ally, not both (see
        # module docstring); attack_rolls_or_saving_throws since either roll type
        # qualifies from the same use.
        'Growth': [
            STAT('attack_rolls_or_saving_throws', DICE('1d4'), ALWAYS, target=SELF, ends=D('Growth')),
            STAT('attack_rolls_or_saving_throws', DICE('1d4'), ALWAYS, ends=D('Growth'),
                 note='OR one ally in range, instead of yourself'),
        ],
        # "you and any ally within 5 feet of you may add a d4 to any saving throw
        # they make for the duration" -- both at once (unlike Growth), saves only,
        # not concentration (its own duration data has concentration: False).
        'Aromatic Mist': [
            STAT('saving_throws', DICE('1d4'), ALWAYS, target=SELF, ends=D('Aromatic Mist')),
            STAT('saving_throws', DICE('1d4'), ALWAYS, ends=D('Aromatic Mist'),
                 note='each ally within 5ft when cast'),
        ],
        # "That ally can add a d6 to one ability check, attack roll, or saving throw
        # ... within the next 10 minutes ... An ally being helped can only have one
        # d6 available at a time" -- single use, expires after its own 10-minute
        # window if never spent; ability-check option dropped (no ability-check
        # roll popup anywhere in this tool to attach a button to -- user's own call).
        'Helping Hand': [
            STAT('attack_rolls_or_saving_throws', DICE('1d6'), ALWAYS,
                 ends=D('Helping Hand') + [{'type': 'uses', 'n': 1}],
                 note='also usable on an ability check -- no ability-check roll popup in this tool to attach it to'),
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
