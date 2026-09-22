#!/usr/bin/env python3
"""Move migration, sixth slice: type-changing and resistance/immunity grants
-- three new condition names (see move-effects-schema.md's "Type matchups"
section): `type_changed` (now actually wired into damage calculation, not
just the badge text), `resistance_upgrade` (bumps the existing type-chart
result one step better -- vulnerable -> normal -> resistant -> immune, never
a flat override), `granted_immunity` (flat 0x for one type, ignoring the
actual matchup). Camouflage/Conversion/Reflect Type/Elemental Surge ship
with no `value` -- the move text has no fixed type (terrain, known moves, a
creature in range, an unspecified d20 table), so a dropdown in the effects
popup asks for it at apply time (effects-popup.js's _needsTypeChoice).

Acid Armor ships PARTIAL -- only its AC+2 (a plain, already-supported flat
stat buff, user's own call to add it now); its "melee attackers take 1d6
poison damage back" clause is a reactive-damage-trigger mechanic that
doesn't exist yet, so its old `counter_reaction_effect`/`damage` tags are
deliberately left untouched (not in RETIRED_V3) as a reminder it's only
half done.

    python migrate_effects_v8.py            # dry run
    python migrate_effects_v8.py --apply
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


ALWAYS = {'type': 'always'}
SELF = 'self'
CONC = {'type': 'concentration'}


def COND(apply, target=None, value=None, ends=None, note=None):
    e = {'kind': 'condition', 'apply': apply, 'when': ALWAYS}
    if target:
        e['target'] = target
    if value is not None:
        e['value'] = value
    if ends:
        e['ends'] = ends
    if note:
        e['note'] = note
    return e


def STAT(stat, amount, target=None, ends=None):
    e = {'kind': 'stat', 'stat': stat, 'amount': amount, 'when': ALWAYS}
    if target:
        e['target'] = target
    if ends:
        e['ends'] = ends
    return e


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
        # "taking on a new type ... dependent on the terrain, up to the DM's
        # discretion" -- no fixed value, human picks it via the dropdown.
        'Camouflage': [COND('type_changed', target=SELF, ends=D('Camouflage'))],
        # "equal to one of the types of a move it currently knows" -- also no fixed
        # value (this app doesn't know the mover's own moveset at effect-authoring
        # time), same dropdown.
        'Conversion': [COND('type_changed', target=SELF, ends=D('Conversion'))],
        # "you take on the type of a creature in range" -- dropdown, with the
        # optional second type for a dual-type creature.
        'Reflect Type': [COND('type_changed', target=SELF, ends=D('Reflect Type'))],
        # "+6 to AC and resistance to ALL types of damage. If vulnerable, now
        # regular; if already resistant, now immune" -- one-step-better, every type.
        'Iron Defense': [
            STAT('ac', 6, target=SELF, ends=[UNTIL_TURN('holder', 'end')]),
            COND('resistance_upgrade', target=SELF, value='all', ends=[UNTIL_TURN('holder', 'end')]),
        ],
        # "you and all allies around you ... resistance to electric-type attacks.
        # If already resistant, now immune; if vulnerable, now regular" -- same
        # escalation, scoped to one type, self + each ally in range when cast.
        'Mud Sport': [
            COND('resistance_upgrade', target=SELF, value='Electric', ends=D('Mud Sport')),
            COND('resistance_upgrade', value='Electric', ends=D('Mud Sport'), note='each ally in range when cast'),
        ],
        # "becoming immune to ground moves" -- flat, no escalation.
        'Magnet Rise': [COND('granted_immunity', target=SELF, value='Ground', ends=D('Magnet Rise'))],
        # "roll a d20 to determine the energy type. Gains resistance to that damage
        # type" -- no table given for what each roll means, so a dropdown same as
        # the type_changed moves. The "next damaging move deals extra 2d6 damage of
        # that type" clause is a separate, type-restricted damage-bonus mechanic
        # that doesn't exist yet -- not included (its old potential_damage_increase
        # tag is left in place as a reminder).
        'Elemental Surge': [COND('resistance_upgrade', target=SELF, ends=D('Elemental Surge'))],
        # AC+2 only -- see module docstring for why the retaliation clause waits.
        'Acid Armor': [STAT('ac', 2, target=SELF, ends=D('Acid Armor'))],
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
