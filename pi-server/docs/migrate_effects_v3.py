#!/usr/bin/env python3
"""Move migration, second slice: every move whose secondary effect is a flat/
stacking stat change or an advantage/disadvantage grant, with NO other
mechanic the schema doesn't already support (see move-effects-schema.md's
"Not covered yet" section for the full list of what got excluded and why --
dice-based amounts, multiplicative effects, reactions, ability-gated
conditions, target-specific roll filters, multi-turn move structures, temp-HP/
shields, heals, type changes, resistance/immunity, VP-cost changes, "set"
stat effects). Hand-authored overrides, read from each move's own text --
this is not a parser, every entry below was read and decided individually.

Two mapping decisions worth calling out, since they're not literal transcriptions:
  - "allies get +N to hit/attack it" is represented as the target's AC -N --
    mechanically identical (a lower AC helps every attacker's roll equally),
    and AC is what every other reader (the attack popup's hint, Move DC) already
    understands, instead of inventing a "bonus for whoever attacks this
    creature" concept that doesn't exist anywhere else in the schema.
  - "double your proficiency bonus" is `amount: 'proficiency'` on top of the
    roll's own already-included proficiency -- since a normal roll adds
    proficiency once, adding it again is exactly doubling it.

    python migrate_effects_v3.py            # dry run
    python migrate_effects_v3.py --apply
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from migrate_effects_v2 import tag_for  # reuse the same tag-naming logic (guaranteed/potential/self_ prefix)

FILE = Path(__file__).with_name('DnD_moves_categorized_draft.json')

# The old flat tags these 50 moves still carry -- unlike migrate_effects_v2.py's
# GEN_TAG (which matches an already-migrated move's tags, for a second pass over
# the SAME move), these are moves on their FIRST pass, so what needs retiring is
# the original auto-categorizer's tag, exactly like build_move_effects.py's own
# RETIRED set did for conditions.
RETIRED_V3 = {
    'stat_buff_self', 'stat_buff_ally', 'stat_debuff_enemy', 'stat_debuff_self',
    'advantage_on_attack_roll', 'potential_disadvantage', 'crit_range_mod',
    'boosted_attack_rolls', 'boosted_damage_rolls', 'advantage_on_saving_throws',
    'potential_stat_increase', 'increase_stab',
}


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


def STAT(stat, amount, when, target=None, stacks=None, ends=None, note=None):
    e = E('stat', stat=stat, amount=amount, when=when)
    if target:
        e['target'] = target
    if stacks:
        e['stacks'] = {'max': stacks}
    if ends:
        e['ends'] = ends
    if note:
        e['note'] = note
    return e


def ROLL(roll, on, when, target=None, ends=None, note=None):
    e = E('roll', roll=roll, on=on, when=when)
    if target:
        e['target'] = target
    if ends:
        e['ends'] = ends
    if note:
        e['note'] = note
    return e


ALWAYS = {'type': 'always'}
HIT = {'type': 'on_hit'}
CRIT = {'type': 'crit'}
SELF = 'self'


def NAT(n):
    return {'type': 'natural_roll', 'min': n}


def SAVE(ability, failBy=None):
    w = {'type': 'save_fail', 'ability': ability}
    if failBy:
        w['failBy'] = failBy
    return w


def ROUNDS(n):
    return {'type': 'rounds', 'n': n}


CONC = {'type': 'concentration'}
ENCOUNTER = {'type': 'encounter'}
LONG_REST = {'type': 'long_rest'}
USES1 = [{'type': 'uses', 'n': 1}]


def UNTIL_TURN(whose='holder', point='end'):
    return {'type': 'until_turn', 'whose': whose, 'point': point}


def duration_ends(move, extra_concentration=None):
    """'for the duration' resolved from the move's own raw duration field --
    same OR-semantics as migrate_effects_v2.py's parse_phrase: a positive
    round count and/or concentration, whichever the move actually states."""
    d = move['duration']
    out = []
    if isinstance(d.get('rounds'), int) and d['rounds'] > 0:
        out.append(ROUNDS(d['rounds']))
    if d.get('concentration'):
        out.append(dict(CONC))
    return out or [ENCOUNTER]


OVERRIDES = {}


def build(moves_by_name):
    m = moves_by_name
    D = lambda name: duration_ends(m[name])  # noqa: E731

    OVERRIDES.update({
        'Bug Buzz': [ROLL('disadvantage', 'attack_rolls', SAVE('CON', failBy=6), ends=USES1)],
        'Defend Order': [STAT('ac', 1, ALWAYS, target=SELF, ends=[CONC])],
        'Quiver Dance': [STAT('ac', 1, ALWAYS, target=SELF, ends=D('Quiver Dance')),
                         STAT('attack_rolls', 1, ALWAYS, target=SELF, ends=D('Quiver Dance')),
                         STAT('damage_rolls', 1, ALWAYS, target=SELF, ends=D('Quiver Dance'))],
        'Celestial Aura': [ROLL('advantage', 'saving_throws', ALWAYS, target=SELF, ends=D('Celestial Aura')),
                           STAT('int', 2, ALWAYS, target=SELF, ends=D('Celestial Aura')),
                           STAT('wis', 2, ALWAYS, target=SELF, ends=D('Celestial Aura'))],
        'Cosmic Power': [ROLL('advantage', 'saving_throws', ALWAYS, target=SELF, ends=D('Cosmic Power'))],
        'Fake Tears': [STAT('ac', -5, SAVE('WIS'), ends=[UNTIL_TURN('source', 'end')],
                            note='"allies get +5 to hit it" -- represented as the target\'s own AC dropping')],
        'Hone Claws': [STAT('attack_rolls', 1, ALWAYS, target=SELF, stacks=3, ends=D('Hone Claws')),
                       STAT('damage_rolls', 1, ALWAYS, target=SELF, stacks=3, ends=D('Hone Claws'))],
        'Snarl': [ROLL('disadvantage', 'attack_rolls', SAVE('WIS'), ends=USES1,
                       note='RAW only if that attack targets you -- applied regardless of target')],
        'Charm': [STAT('attack_rolls', -2, SAVE('WIS'), ends=D('Charm'),
                       note='RAW only against you -- applied to all its attacks')],
        'Courtly Grace': [STAT('ac', 1, ALWAYS, target=SELF, ends=D('Courtly Grace')),
                          STAT('ac', 1, ALWAYS, ends=D('Courtly Grace'), note='per ally selected')],
        'Dimension Dance': [ROLL('disadvantage', 'attacks_against', ALWAYS, target=SELF, ends=D('Dimension Dance'))],
        'Fairy Scales': [ROLL('disadvantage', 'attack_rolls', SAVE('DEX'), ends=[UNTIL_TURN('holder', 'end')])],
        'Flower Shield': [STAT('ac', 2, ALWAYS, ends=D('Flower Shield'), note='grass-type allies only')],
        'Forest Guardian': [STAT('all_abilities', 1, NAT(15), target=SELF, stacks=5, ends=[ENCOUNTER])],
        # speed is left out on purpose here (and everywhere else in this batch) -- the user's
        # own earlier call: hold off on movement speed until later, same as the conditions'
        # own effects. Geomancy/No Retreat keep their OTHER clauses; Flame Charge/Agility/
        # Autotomize had nothing else, so they're not in this batch at all (see below).
        'Geomancy': [ROLL('advantage', 'attack_rolls', ALWAYS, target=SELF, ends=[ROUNDS(3)]),
                     ROLL('advantage', 'saving_throws', ALWAYS, target=SELF, ends=[ROUNDS(3)])],
        'Light Dance': [STAT('ac', 2, ALWAYS, target=SELF, ends=[ROUNDS(3)])],
        'Moonlit Mirage': [ROLL('disadvantage', 'attacks_against', ALWAYS, target=SELF, ends=D('Moonlit Mirage'))],
        'No Retreat': [STAT('ac', 2, ALWAYS, target=SELF, ends=[ENCOUNTER]),
                       STAT('all_abilities', 2, ALWAYS, target=SELF, ends=[ENCOUNTER])],
        'Fire Lash': [STAT('ac', -1, SAVE('CON'), stacks=5, ends=D('Fire Lash'),
                           note='"allies add +1 to hit it" -- represented as the target\'s own AC dropping')],
        'Mystical Fire': [ROLL('disadvantage', 'attack_rolls', HIT, ends=[UNTIL_TURN('holder', 'end')])],
        'Meatball Meteor': [ROLL('disadvantage', 'attack_rolls', ALWAYS, target=SELF, ends=USES1),
                            ROLL('advantage', 'saves_against_its_moves', ALWAYS, target=SELF, ends=USES1)],
        'Overheat': [ROLL('disadvantage', 'attack_rolls', ALWAYS, target=SELF, ends=USES1),
                     ROLL('advantage', 'saves_against_its_moves', ALWAYS, target=SELF, ends=USES1)],
        'Psycho Boost': [ROLL('disadvantage', 'attack_rolls', ALWAYS, target=SELF, ends=USES1),
                         ROLL('advantage', 'saves_against_its_moves', ALWAYS, target=SELF, ends=USES1)],
        'Mud Bomb': [ROLL('disadvantage', 'attack_rolls', SAVE('CON'), ends=USES1),
                     ROLL('advantage', 'saves_against_its_moves', SAVE('CON'), ends=USES1)],
        'Mud-Slap': [STAT('attack_rolls', -1, HIT, stacks=5, ends=[ENCOUNTER],
                          note='the target can also remove this by spending an action -- use the badge\'s Remove button')],
        'Sand Attack': [STAT('attack_rolls', -1, SAVE('CON'), stacks=5, ends=[ENCOUNTER])],
        'Shadow Ball': [STAT('attack_rolls', -2, HIT, ends=[UNTIL_TURN('holder', 'end')])],
        'Cotton Guard': [STAT('ac', 2, ALWAYS, target=SELF, ends=D('Cotton Guard'))],
        'Seed Flare': [ROLL('advantage', 'attacks_against', SAVE('CON'), ends=[UNTIL_TURN('holder', 'end')])],
        'Leer': [STAT('ac', -1, SAVE('WIS'), stacks=5, ends=D('Leer'),
                      note='"allies add +1 to hit it" -- represented as the target\'s own AC dropping')],
        'Screech': [STAT('ac', -1, SAVE('WIS'), stacks=5, ends=D('Screech'),
                         note='"allies add +1 to hit it" -- represented as the target\'s own AC dropping')],
        'Spotlight': [ROLL('advantage', 'attacks_against', SAVE('DEX'), ends=D('Spotlight'))],
        'Minimize': [STAT('ac', 2, ALWAYS, target=SELF, ends=D('Minimize'))],
        'Mop Strike': [ROLL('disadvantage', 'attack_rolls', SAVE('DEX'), ends=USES1)],
        'Swords Dance': [STAT('ac', 1, ALWAYS, target=SELF, ends=[CONC])],
        'Tail Whip': [STAT('ac', -1, SAVE('WIS'), stacks=5, ends=D('Tail Whip'),
                           note='"allies add +1 to hit it" -- represented as the target\'s own AC dropping')],
        'Tearful Look': [STAT('attack_rolls', -1, SAVE('CHA'), stacks=5, ends=D('Tearful Look'))],
        'Work Up': [STAT('attack_rolls', 2, ALWAYS, target=SELF, ends=[ENCOUNTER])],
        'Acid Spray': [STAT('ac', -1, SAVE('CON'), stacks=3, ends=[LONG_REST])],
        'Coil': [STAT('attack_rolls', 1, ALWAYS, target=SELF, ends=D('Coil')),
                 STAT('damage_rolls', 1, ALWAYS, target=SELF, ends=D('Coil')),
                 STAT('ac', 1, ALWAYS, target=SELF, ends=D('Coil'))],
        # Agility and Autotomize are pure speed moves -- nothing else to give them, so
        # they're just not in this batch at all (speed itself is held for later, see above).
        'Barrier': [STAT('ac', 2, ALWAYS, target=SELF, ends=D('Barrier')),
                    STAT('ac', 2, ALWAYS, ends=D('Barrier'), note='per ally selected within 5ft')],
        'Meditate': [STAT('attack_rolls', 'proficiency', ALWAYS, target=SELF, ends=D('Meditate')),
                     STAT('saving_throws', 'proficiency', ALWAYS, target=SELF, ends=D('Meditate'))],
        'Dragon Dance': [STAT('attack_rolls', 'proficiency', ALWAYS, target=SELF, ends=D('Dragon Dance'))],
        'Ancient Power': [STAT('all_abilities', 1, NAT(19), target=SELF, stacks=5, ends=[ENCOUNTER])],
        'Rock Polish': [STAT('ac', 2, ALWAYS, target=SELF, ends=[ROUNDS(3)])],
        'Industrial Solvent': [STAT('ac', -1, SAVE('CON'), stacks=3, ends=[ROUNDS(10)])],
        'Metal Sound': [STAT('ac', -5, SAVE('CON'), ends=[UNTIL_TURN('holder', 'end')],
                             note='"+5 to attacks against it" -- represented as the target\'s own AC dropping')],
        'Mirror Shot': [ROLL('disadvantage', 'attack_rolls', SAVE('CON'), ends=USES1)],
        'Sqeegee Slash': [STAT('ac', -1, CRIT, stacks=5, ends=[LONG_REST])],
        'Muddy Water': [ROLL('disadvantage', 'attack_rolls', SAVE('CON', failBy=5), ends=USES1)],  # "by 5 OR MORE" (not "more than 5") -- 5, not 6
        'Razor Wind': [STAT('ac', 2, ALWAYS, target=SELF, ends=[CONC])],
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
