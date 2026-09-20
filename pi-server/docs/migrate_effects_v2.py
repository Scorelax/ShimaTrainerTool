#!/usr/bin/env python3
"""Effects schema v2 migration (see move-effects-schema.md for the schema itself).

Reads DnD_moves_categorized_draft.json and, for every move with v1 effects:
  * adds `kind` ("condition") to each effect,
  * promotes every v1 `other` + `label` condition to its own named condition
    (one tag per condition),
  * turns the verbatim `duration` / boolean `saveEnds` into a structured `ends` list
    (any entry ending the effect removes it): rounds / until_turn / save / concentration
    / encounter / long_rest / uses / other,
then adds `stat` / `roll` effects to the 23 moves whose natural-roll effect is a modifier
rather than a condition (plus Debris Break's AC drop), and regenerates the derived tags.

Idempotent: effects that already carry `kind` are left alone, and the added modifier
effects are only appended once.

    python migrate_effects_v2.py            # dry run
    python migrate_effects_v2.py --apply
"""
import json
import re
import sys
from collections import Counter
from pathlib import Path

FILE = Path(__file__).with_name('DnD_moves_categorized_draft.json')

# v1 `other` labels -> condition name (and a `value` for the type changes).
OTHER_TO_CONDITION = {
    'Blink': ('blink', None),
    'grounded': ('grounded', None),
    'taunted': ('taunted', None),
    'infested': ('infested', None),
    'removed from reality': ('removed_from_reality', None),
    'drowsy': ('drowsy', None),
    'controlled senses': ('controlled_senses', None),
    'mind captured': ('mind_captured', None),
    'moved 15 ft in a random direction': ('forced_movement', None),
    'watchful embers': ('watchful_embers', None),
    'cursed': ('cursed', None),
    'type changed to Ghost': ('type_changed', 'Ghost'),
    'type changed to Grass': ('type_changed', 'Grass'),
    'type changed to Water': ('type_changed', 'Water'),
    'disoriented': ('disoriented', None),
    'seeded': ('seeded', None),
    'insomnia': ('insomnia', None),
    'cannot flee or be switched out': ('trapped', None),
    'perish song': ('perish_song', None),
    'abilities suppressed': ('abilities_suppressed', None),
    'infected': ('infected', None),
    'invisible': ('invisible', None),
    'bleeding wounds': ('bleeding', None),
}
INSTANT_CONDITIONS = {'forced_movement'}   # announced, never stored

# Repeat-save details per (move, condition), read from each move's own text.
# timing: start_of_turn | end_of_turn | action (spend an action to attempt it)
SAVE_ENDS = {
    ('Spider Web', 'restrained'): ('STR', 'action'),
    ('Sticky Web', 'restrained'): ('STR', 'start_of_turn'),
    ('3. Fear Ray', 'frightened'): ('WIS', 'end_of_turn'),
    ('Abyssal Grasp', 'restrained'): ('STR', 'start_of_turn'),
    ('Thunderous Roar', 'frightened'): ('WIS', 'end_of_turn'),
    ('2. Stun Ray', 'stunned'): ('CON', 'end_of_turn'),
    ('Mesmerizing Dance', 'charmed'): ('WIS', 'end_of_turn'),
    ('Submission', 'grappled'): ('STR', 'start_of_turn'),
    ('Watchful Embers', 'watchful_embers'): ('WIS', 'start_of_turn'),
    ('Sky Drop', 'grappled'): ('STR', 'action'),
    ('Ethereal Vines', 'grappled'): ('STR', 'start_of_turn'),
    ('Spectral Chains', 'restrained'): ('DEX', 'end_of_turn'),
    ('Sand Tomb', 'restrained'): ('STR', 'start_of_turn'),
    ('Frost Shackles', 'restrained'): ('STR', 'end_of_turn'),
    ('Bind', 'grappled'): ('STR', 'start_of_turn'),
    ('Bind', 'restrained'): ('STR', 'start_of_turn'),
    ('Blinding Flash', 'blinded'): ('CON', 'end_of_turn'),
    ('Constrict', 'grappled'): ('STR', 'start_of_turn'),
    ('Constrict', 'restrained'): ('STR', 'start_of_turn'),
    ('Smokescreen', 'blinded'): ('CON', 'start_of_turn'),
    ('Vice Grip', 'grappled'): ('STR', 'start_of_turn'),
    ('Wrap', 'grappled'): ('STR', 'start_of_turn'),
    ('4. Slowing Ray', 'slowed'): ('DEX', 'end_of_turn'),
    ('Psycho Current', 'restrained'): ('STR', 'start_of_turn'),
    ('Vertigo Blast', 'slowed'): ('WIS', 'end_of_turn'),
    ('Rock Tomb', 'restrained'): ('STR', 'start_of_turn'),
    ('Whirlpool', 'restrained'): ('STR', 'start_of_turn'),
}

NUM_WORDS = {'one': 1, 'two': 2, 'three': 3, 'a': 1}
UNIT_ROUNDS = {'round': 1, 'turn': 1, 'minute': 10, 'hour': 600, 'day': 14400}


def rounds_end(n):
    return {'type': 'rounds', 'n': n}


def parse_phrase(phrase, move):
    """One verbatim v1 duration phrase -> list of `ends` entries."""
    p = phrase.strip().lower()
    m = re.fullmatch(r'for (\d+d\d+(?: \+ move)?) (round|turn|minute|hour)s', p)
    if m:
        dice = m.group(1).replace(' + move', ' + MOVE')
        e = {'type': 'rounds', 'dice': dice}
        unit = m.group(2)
        if unit not in ('round', 'turn'):
            e['unit'] = unit
        return [e]
    m = re.fullmatch(r'for (\d+|one|two|three|a) (round|turn|minute|hour)s?', p)
    if m:
        n = int(m.group(1)) if m.group(1).isdigit() else NUM_WORDS[m.group(1)]
        return [rounds_end(n * UNIT_ROUNDS[m.group(2)])]
    if p == 'for the next round':
        return [rounds_end(1)]
    if p == 'for the duration':
        d = move['duration']
        out = []
        if isinstance(d.get('rounds'), int) and d['rounds'] > 0:
            out.append(rounds_end(d['rounds']))
        else:
            out.append({'type': 'other', 'text': d.get('raw', 'for the duration')})
        if d.get('concentration'):
            out.append({'type': 'concentration'})
        return out
    if p == 'until the end of your next two turns':
        return [{'type': 'until_turn', 'whose': 'holder', 'point': 'end', 'count': 2}]
    m = re.fullmatch(r"until (?:the )?(end|beginning|start) of (its|their|your|the user's|the beholder's|the creature's|the target's)? ?next turn", p)
    if m or p == 'until end of next turn':
        point = 'end' if (not m or m.group(1) == 'end') else 'start'
        who = m.group(2) if m else 'its'
        whose = 'source' if who in ('your', "the user's", "the beholder's") else 'holder'
        return [{'type': 'until_turn', 'whose': whose, 'point': point}]
    if p == 'as long as you remain in battle':
        return [{'type': 'encounter'}]
    return [{'type': 'other', 'text': phrase}]


# ---- modifier effects for the 23 non-condition natural-roll moves ---------------
def NAT(n):
    return {'type': 'natural_roll', 'min': n}


def stat(stat_name, when, amount=None, set_to=None, target=None, stacks=None, ends=None, note=None):
    e = {'kind': 'stat', 'stat': stat_name}
    if amount is not None:
        e['amount'] = amount
    if set_to is not None:
        e['set'] = set_to
    e['when'] = when
    if target:
        e['target'] = target
    if stacks:
        e['stacks'] = {'max': stacks}
    if ends:
        e['ends'] = ends
    if note:
        e['note'] = note
    return e


def roll(kind, on, when, target=None, ends=None, note=None):
    e = {'kind': 'roll', 'roll': kind, 'on': on, 'when': when}
    if target:
        e['target'] = target
    if ends:
        e['ends'] = ends
    if note:
        e['note'] = note
    return e


ONE_USE = [{'type': 'uses', 'n': 1}]
ENCOUNTER = [{'type': 'encounter'}]
HOLDER_NEXT_TURN_END = [{'type': 'until_turn', 'whose': 'holder', 'point': 'end'}]

MODIFIER_MOVES = {
    'Lunge': [roll('disadvantage', 'attack_rolls', NAT(15), ends=ONE_USE, note='its next attack')],
    'Silver Wind': [stat('all_abilities', NAT(19), amount=1, target='self', stacks=5, ends=ENCOUNTER,
                         note='while you remain in battle; stacks to +5')],
    'Crunch': [stat('ac', NAT(18), amount=-1, stacks=5, ends=ENCOUNTER, note='for the remainder of combat')],
    'Night Daze': [roll('disadvantage', 'attack_rolls', NAT(13), ends=ONE_USE, note='its next attack'),
                   roll('advantage', 'saves_against_its_moves', NAT(13), ends=ONE_USE,
                        note='if it activates a move that requires a saving throw, its targets have advantage')],
    'Moonblast': [roll('disadvantage', 'attack_rolls', NAT(15), ends=ONE_USE, note='its next attack')],
    'Play Rough': [stat('attack_rolls', NAT(19), amount=-1, stacks=5, ends=ENCOUNTER, note='for the remainder of combat')],
    'Focus Blast': [roll('advantage', 'attacks_against', NAT(19), ends=ONE_USE, note='the next attack against the target')],
    'Rock Smash': [stat('ac', NAT(19), amount=-1, ends=ENCOUNTER, note='while it remains in battle')],
    'Ominous Wind': [stat('all_abilities', NAT(19), amount=1, target='self', ends=[{'type': 'rounds', 'n': 3}])],
    'Shadow Bone': [stat('ac', NAT(18), amount=-1, stacks=5, ends=ENCOUNTER, note='while it remains in battle')],
    'Energy Ball': [roll('advantage', 'attacks_against', NAT(19), ends=ONE_USE, note='the next attack against the target')],
    'Leaf Tornado': [roll('disadvantage', 'attack_rolls', NAT(15), ends=ONE_USE, note='its next attack'),
                     roll('advantage', 'saves_against_its_moves', NAT(15), ends=ONE_USE,
                          note='if it activates a move that requires a saving throw, its targets have advantage')],
    'Trop Kick': [stat('attack_rolls', NAT(16), amount=-1, stacks=5, ends=ENCOUNTER, note='for the remainder of combat')],
    'Mud Shot': [stat('speed', NAT(16), set_to=0, ends=HOLDER_NEXT_TURN_END)],
    'Crush Claw': [stat('attack_rolls', NAT(15), amount=1, target='self', ends=ONE_USE, note='your next attack on the same target')],
    'Mist Ball': [roll('disadvantage', 'attack_rolls', NAT(11), ends=HOLDER_NEXT_TURN_END,
                       note='any attack it makes before the end of its next turn')],
    'Flash Cannon': [roll('advantage', 'attacks_against', NAT(19), ends=ONE_USE, note='the next attack against the target')],
    'Iron Tail': [stat('ac', NAT(19), amount=-1, ends=ENCOUNTER, note='for the rest of combat')],
    'Metal Claw': [stat('attack_rolls', NAT(19), amount='proficiency', target='self', ends=ONE_USE,
                        note='add your proficiency bonus to your next attack')],
    'Meteor Mash': [roll('advantage', 'attack_rolls', NAT(18), target='self', ends=ONE_USE, note='your next attack')],
    'Octazooka': [stat('attack_rolls', NAT(18), amount=-1, ends=ENCOUNTER, note='for the remainder of this combat')],
    'Razor Shell': [stat('ac', NAT(18), amount=-1, stacks=5, ends=ENCOUNTER)],
    'Bone Crush': [stat('ac', {'type': 'save_fail', 'ability': 'DEX', 'requires': NAT(19)}, amount=-2,
                        ends=HOLDER_NEXT_TURN_END,
                        note='the save DC is +1 per 10 ft of height above 10 ft dropped; on a natural 20 the save always fails')],
}
# Debris Break already has its grappled effect; the AC drop is added alongside it.
APPEND_MODIFIERS = {
    'Debris Break': [stat('ac', NAT(16), amount=-1, stacks=3, ends=[{'type': 'long_rest'}],
                          note='on the second attack only')],
}


# ---- tags ------------------------------------------------------------------------
GEN_TAG = re.compile(
    r'^(?:self_)?(?:potential_)?(?:status_condition_[a-z_]+'
    r'|stat_(?:buff|debuff)_(?:ac|speed|attack_rolls|damage_rolls|saving_throws|str|dex|con|int|wis|cha|all_abilities)'
    r'|(?:advantage|disadvantage)_(?:attack_rolls|attacks_against|saving_throws|saves_against_its_moves|ability_checks|all_rolls))$')


def tag_for(e):
    guaranteed = e['when']['type'] in ('always', 'on_hit')
    if e['kind'] == 'condition':
        base = f"status_condition_{e['apply']}"
    elif e['kind'] == 'stat':
        buff = e.get('amount') == 'proficiency' or (isinstance(e.get('amount'), (int, float)) and e['amount'] > 0)
        base = f"stat_{'buff' if buff else 'debuff'}_{e['stat']}"
    else:
        base = f"{e['roll']}_{e['on']}"
    if not guaranteed:
        base = 'potential_' + base
    if e.get('target') == 'self':
        base = 'self_' + base
    return base


def derive_tags(effects):
    out = []
    for e in effects:
        t = tag_for(e)
        if t not in out:
            out.append(t)
    return out


def rebuild_categories(cats, effects):
    derived = derive_tags(effects)
    out, placed = [], False
    for c in cats:
        if GEN_TAG.match(c) or c == 'status_inflict_threshold':
            if not placed:
                out.extend(derived)
                placed = True
            continue
        out.append(c)
    if not placed:
        out.extend(derived)
    return out


# ---- migration -------------------------------------------------------------------
def migrate_effect(move, e, problems):
    if 'kind' in e:
        return e
    name = move['name']
    apply, value = e['apply'], None
    if apply == 'other':
        apply, value = OTHER_TO_CONDITION[e['label']]
    ends = []
    if e.get('duration'):
        ends.extend(parse_phrase(e['duration'], move))
    if e.get('saveEnds'):
        key = (name, apply)
        if key not in SAVE_ENDS:
            problems.append(f'no SAVE_ENDS entry for {key}')
        else:
            ability, timing = SAVE_ENDS[key]
            ends.append({'type': 'save', 'ability': ability, 'timing': timing})
    if apply in INSTANT_CONDITIONS:
        ends = [{'type': 'instant'}]
    out = {'kind': 'condition', 'apply': apply}
    if value:
        out['value'] = value
    out['when'] = e['when']
    for k in ('target',):
        if k in e:
            out[k] = e[k]
    if ends:
        out['ends'] = ends
    for k in ('choice', 'note'):
        if k in e:
            out[k] = e[k]
    return out


def main():
    apply_it = '--apply' in sys.argv
    data = json.loads(FILE.read_text(encoding='utf-8'))
    problems = []
    added = 0
    for m in data['moves']:
        effects = m.get('effects')
        if effects:
            m['effects'] = [migrate_effect(m, e, problems) for e in effects]
        if m['name'] in MODIFIER_MOVES and not m.get('effects'):
            m['effects'] = json.loads(json.dumps(MODIFIER_MOVES[m['name']]))
            added += 1
        if m['name'] in APPEND_MODIFIERS and not any(e['kind'] != 'condition' for e in m['effects']):
            m['effects'].extend(json.loads(json.dumps(APPEND_MODIFIERS[m['name']])))
            added += 1
        if m.get('effects'):
            m['categories'] = rebuild_categories(m['categories'], m['effects'])

    # Keep `effects` right after `categories` (a no-op for moves that already had it there).
    for i, m in enumerate(data['moves']):
        if 'effects' in m:
            data['moves'][i] = {}
            for k, v in m.items():
                if k != 'effects':
                    data['moves'][i][k] = v
                if k == 'categories':
                    data['moves'][i]['effects'] = m['effects']

    kinds = Counter(e['kind'] for m in data['moves'] for e in m.get('effects', []))
    conds = Counter(e['apply'] for m in data['moves'] for e in m.get('effects', []) if e['kind'] == 'condition')
    no_end = [f"{m['name']}: {e['apply'] if e['kind'] == 'condition' else e['kind']}"
              for m in data['moves'] for e in m.get('effects', []) if not e.get('ends')]
    leftover = [m['name'] for m in data['moves'] if 'status_inflict_threshold' in m['categories']]
    print('kinds', dict(kinds), '| modifier moves added', added)
    print('conditions', dict(conds))
    print('problems', problems)
    print('legacy threshold tags left', leftover)
    print(f'{len(no_end)} effects with no stated end (removed manually):')
    for x in no_end:
        print('  -', x)
    if problems:
        sys.exit(1)
    if apply_it:
        FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
        print('written')


if __name__ == '__main__':
    main()
