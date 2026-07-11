"""Straight port of the stat/feat math from Current_Code.gs.

Positional indices are identical to the Apps Script version — see
db.POKEMON_COLUMNS / db.TRAINER_COLUMNS for what each index means.
"""
import math
import re

from .jsutil import js_parse_int, js_parse_int_or, js_number, intify, floor_div2

_FEAT_CHOICE = re.compile(r'^(.+?)\s*\((.+?)\)$')


def sanitize_string(s):
    if not s:
        return ''
    s = str(s).replace('\n', ' ').replace('\r', ' ').replace('\\', '')
    return re.sub(r'\s+', ' ', s).strip()


def sanitize_moves(move_string, max_moves):
    if move_string is None:
        move_string = ''
    moves = [m.strip() for m in str(move_string).split(',')]
    return ', '.join([m for m in moves if m][:max_moves])


def format_ability(ability):
    if ability and ability.get('name') and ability.get('description'):
        return f"{ability['name']}, {ability['description']}"
    if ability and ability.get('name'):
        return ability['name']
    if ability and ability.get('description'):
        return ability['description']
    return ''


def proficiency_for_level(level):
    level = js_number(level)
    return 2 if level <= 4 else 3 if level <= 8 else 4 if level <= 12 else 5 if level <= 16 else 6


def stab_for_level(level):
    level = js_number(level)
    return 0 if level <= 2 else 2 if level <= 6 else 4 if level <= 10 else 6 if level <= 14 else 8 if level <= 18 else 10


def calculate_hp_vp(str_, dex, con, int_, wis, cha, level, hd, vd, loyalty):
    str_ = js_parse_int(str_)
    dex = js_parse_int(dex)
    con = js_parse_int(con)
    int_ = js_parse_int(int_)
    wis = js_parse_int(wis)
    cha = js_parse_int(cha)
    level = js_parse_int(level)
    hd = js_parse_int(hd)
    vd = js_parse_int(vd)

    # .gs truncates the CON modifier toward zero here (ceil for negatives)
    diff = con - 10
    conmodifier = math.ceil(diff / 2) if diff < 0 else math.floor(diff / 2)

    hp = hd + (level * ((hd / 2) + 1 + conmodifier))
    if js_number(loyalty) >= 2:
        hp += math.ceil(level / 2)

    total_stats = str_ + dex + con + int_ + wis + cha
    vp = vd + level * ((vd / 2) + 2) + math.floor((total_stats - 30) / 2)

    return intify(hp), intify(vp)


def parse_feat(feat):
    m = _FEAT_CHOICE.match(feat)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return feat, None


def _split_list(value):
    if isinstance(value, list):
        return list(value)
    if value:
        return [part.strip() for part in str(value).split(',')]
    return []


def calculate_modifiers(new_pokemon_data, stat_increases, new_feats):
    """Port of calculateModifiers — used by the evolve action (with
    stat_increases="None", new_feats="None", so the feat branches are inert)."""
    try:
        feats = _split_list(new_pokemon_data[50])
        skills = _split_list(new_pokemon_data[22])
        new_skills = _split_list(new_feats)

        strength = new_pokemon_data[15]
        dexterity = new_pokemon_data[16]
        constitution = new_pokemon_data[17]
        intelligence = new_pokemon_data[18]
        wisdom = new_pokemon_data[19]
        charisma = new_pokemon_data[20]

        if 'Acrobat' in new_skills:
            if 'Acrobat' in feats and js_number(dexterity) < 20:
                dexterity = js_number(dexterity) + 1
            skills.append('Acrobatics')
        if 'Actor' in new_skills:
            if 'Actor' in feats and js_number(charisma) < 20:
                charisma = js_number(charisma) + 1
        if 'Athlete' in new_skills and 'Athlete' in feats:
            if stat_increases[0] == 'STR' and js_number(strength) < 20:
                strength = js_number(strength) + 1
            elif stat_increases[0] == 'DEX' and js_number(dexterity) < 20:
                dexterity = js_number(dexterity) + 1
        if 'Brawny' in new_skills:
            if 'Brawny' in feats and js_number(strength) < 20:
                strength = js_number(strength) + 1
            skills.append('Athletics')
        if 'Durable' in new_skills:
            if 'Durable' in feats and js_number(constitution) < 20:
                constitution = js_number(constitution) + 1
        if 'Observant' in new_skills and 'Observant' in feats:
            if stat_increases[1] == 'INT' and js_number(intelligence) < 20:
                intelligence = js_number(intelligence) + 1
            elif stat_increases[1] == 'WIS' and js_number(wisdom) < 20:
                wisdom = js_number(wisdom) + 1
        if 'Perceptive' in new_skills:
            if 'Perceptive' in feats and js_number(wisdom) < 20:
                wisdom = js_number(wisdom) + 1
            skills.append('Perception')
        if 'Quick-Fingered' in new_skills:
            if 'Quick-Fingered' in feats and js_number(dexterity) < 20:
                dexterity = js_number(dexterity) + 1
        if 'Resilient' in new_skills and 'Resilient' in feats:
            choice = stat_increases[2]
            if choice == 'STR' and js_number(strength) < 20:
                strength = js_number(strength) + 1
            elif choice == 'DEX' and js_number(dexterity) < 20:
                dexterity = js_number(dexterity) + 1
            elif choice == 'CON' and js_number(constitution) < 20:
                constitution = js_number(constitution) + 1
            elif choice == 'INT' and js_number(intelligence) < 20:
                intelligence = js_number(intelligence) + 1
            elif choice == 'WIS' and js_number(wisdom) < 20:
                wisdom = js_number(wisdom) + 1
            elif choice == 'CHA' and js_number(charisma) < 20:
                charisma = js_number(charisma) + 1
        if 'Stealthy' in new_skills:
            if 'Stealthy' in feats and js_number(dexterity) < 20:
                dexterity = js_number(dexterity) + 1
            skills.append('Stealth')
        if 'AC Up' in new_skills and 'AC Up' in feats:
            new_pokemon_data[8] = js_parse_int(new_pokemon_data[8]) + 1

        strmodifier = floor_div2(strength)
        dexmodifier = floor_div2(dexterity)
        conmodifier = floor_div2(constitution)
        intmodifier = floor_div2(intelligence)
        wismodifier = floor_div2(wisdom)
        chamodifier = floor_div2(charisma)

        level = new_pokemon_data[4]
        hit_dice = js_parse_int(new_pokemon_data[9])
        vitality_dice = js_parse_int(new_pokemon_data[11])
        hp, vp = calculate_hp_vp(
            strength, dexterity, constitution, intelligence, wisdom, charisma,
            level, hit_dice, vitality_dice, new_pokemon_data[33]
        )

        if 'Tough' in new_skills and 'Tough' in feats:
            hp += js_number(level) * 2
        if 'Tireless' in new_skills and 'Tireless' in feats:
            vp += math.ceil(js_number(level) / 2) * vitality_dice

        new_pokemon_data[10] = intify(hp)
        new_pokemon_data[12] = intify(vp)
        new_pokemon_data[15] = strength
        new_pokemon_data[16] = dexterity
        new_pokemon_data[17] = constitution
        new_pokemon_data[18] = intelligence
        new_pokemon_data[19] = wisdom
        new_pokemon_data[20] = charisma
        new_pokemon_data[22] = ', '.join(str(s) for s in skills)
        new_pokemon_data[50] = ', '.join(str(f) for f in feats)
        new_pokemon_data[39] = strmodifier
        new_pokemon_data[40] = dexmodifier
        new_pokemon_data[41] = conmodifier
        new_pokemon_data[42] = intmodifier
        new_pokemon_data[43] = wismodifier
        new_pokemon_data[44] = chamodifier
        new_pokemon_data[34] = stab_for_level(level)
        new_pokemon_data[30] = dexmodifier + 5 if 'Alert' in feats else dexmodifier
        if 'Mobile' in new_skills and 'Mobile' in feats:
            # faithful port: the .gs version bumps index 24 here, not 13
            new_pokemon_data[24] = js_parse_int(new_pokemon_data[24]) + 10
        new_pokemon_data[31] = proficiency_for_level(level)

        return {'status': 'success', 'newPokemonData': new_pokemon_data}
    except Exception as e:
        return {'status': 'error', 'message': f'Failed to calculate modifiers due to error: {e}'}


# Feat effects shared by the add/remove passes in apply_feat_changes
_STAT_FEATS = {
    'Acrobat': ('dexterity', 'Acrobatics'),
    'Actor': ('charisma', None),
    'Brawny': ('strength', 'Athletics'),
    'Durable': ('constitution', None),
    'Perceptive': ('wisdom', 'Perception'),
    'Quick-Fingered': ('dexterity', None),
    'Stealthy': ('dexterity', 'Stealth'),
}
_CHOICE_FEATS = {
    'Athlete': ('STR', 'DEX'),
    'Observant': ('INT', 'WIS'),
    'Resilient': ('STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'),
}
_CHOICE_TO_STAT = {
    'STR': 'strength', 'DEX': 'dexterity', 'CON': 'constitution',
    'INT': 'intelligence', 'WIS': 'wisdom', 'CHA': 'charisma',
}


def apply_feat_changes(pokemon_data, old_feats_str, new_feats_str):
    """Port of applyFeatChanges (route: pokemon/recalculate-stats)."""
    try:
        old_feats = [f.strip() for f in str(old_feats_str).split(',') if f.strip()] if old_feats_str else []
        new_feats = [f.strip() for f in str(new_feats_str).split(',') if f.strip()] if new_feats_str else []

        added = [f for f in new_feats if f not in old_feats]
        removed = [f for f in old_feats if f not in new_feats]

        stats = {
            'strength': js_parse_int(pokemon_data[15]),
            'dexterity': js_parse_int(pokemon_data[16]),
            'constitution': js_parse_int(pokemon_data[17]),
            'intelligence': js_parse_int(pokemon_data[18]),
            'wisdom': js_parse_int(pokemon_data[19]),
            'charisma': js_parse_int(pokemon_data[20]),
        }
        ac = js_parse_int(pokemon_data[8])

        movement_data = pokemon_data[13] or '30ft, -, -, -, -, -'
        if isinstance(movement_data, str) and ',' in movement_data:
            movement_values = [v.strip() for v in movement_data.split(',')]
        else:
            walking = movement_data if isinstance(movement_data, (int, float)) else js_parse_int(movement_data)
            movement_values = [f'{intify(walking)}ft', '-', '-', '-', '-', '-']
        walking_speed = js_parse_int_or(movement_values[0], 30)

        hp = js_parse_int(pokemon_data[10])
        vp = js_parse_int(pokemon_data[12])
        level = js_parse_int(pokemon_data[4])
        hit_dice = js_parse_int(pokemon_data[9])
        vitality_dice = js_parse_int(pokemon_data[11])

        skills = [s.strip() for s in str(pokemon_data[22]).split(',') if s.strip()] if pokemon_data[22] else []

        def add_skill(skill_name):
            for i, s in enumerate(skills):
                if s.lower() == skill_name.lower():
                    skills[i] = skill_name + '+'
                    return
            if (skill_name + '+') not in skills:
                skills.append(skill_name)

        def remove_skill(skill_name):
            if (skill_name + '+') in skills:
                skills[skills.index(skill_name + '+')] = skill_name
            else:
                skills[:] = [s for s in skills if s.lower() != skill_name.lower()]

        def apply(feat, direction):
            nonlocal ac, walking_speed, hp, vp
            name, choice = parse_feat(feat)
            if name in _STAT_FEATS:
                stat, skill = _STAT_FEATS[name]
                if direction > 0:
                    if stats[stat] < 20:
                        stats[stat] += 1
                    if skill:
                        add_skill(skill)
                else:
                    if stats[stat] > 1:
                        stats[stat] -= 1
                    if skill:
                        remove_skill(skill)
            elif name in _CHOICE_FEATS:
                stat = _CHOICE_TO_STAT.get(choice) if choice in _CHOICE_FEATS[name] else None
                if stat:
                    if direction > 0 and stats[stat] < 20:
                        stats[stat] += 1
                    elif direction < 0 and stats[stat] > 1:
                        stats[stat] -= 1
            elif name == 'AC Up':
                ac += direction
            elif name == 'Mobile':
                walking_speed += 10 * direction
            elif name == 'Tough':
                hp += level * 2 * direction
            elif name == 'Tireless':
                vp += math.ceil(level / 2) * vitality_dice * direction

        for feat in removed:
            apply(feat, -1)
        for feat in added:
            apply(feat, +1)

        # Recalculate HP/VP from the adjusted stats, then re-apply Tough/Tireless
        hp, vp = calculate_hp_vp(
            stats['strength'], stats['dexterity'], stats['constitution'],
            stats['intelligence'], stats['wisdom'], stats['charisma'],
            level, hit_dice, vitality_dice, pokemon_data[33]
        )
        if any(parse_feat(f)[0] == 'Tough' for f in new_feats):
            hp += level * 2
        if any(parse_feat(f)[0] == 'Tireless' for f in new_feats):
            vp += math.ceil(level / 2) * vitality_dice

        dex_modifier = floor_div2(stats['dexterity'])
        initiative = dex_modifier + 5 if any(parse_feat(f)[0] == 'Alert' for f in new_feats) else dex_modifier

        pokemon_data[8] = ac
        pokemon_data[10] = intify(hp)
        pokemon_data[12] = intify(vp)
        movement_values[0] = f'{walking_speed}ft'
        pokemon_data[13] = ', '.join(movement_values)
        pokemon_data[15] = stats['strength']
        pokemon_data[16] = stats['dexterity']
        pokemon_data[17] = stats['constitution']
        pokemon_data[18] = stats['intelligence']
        pokemon_data[19] = stats['wisdom']
        pokemon_data[20] = stats['charisma']
        pokemon_data[22] = ', '.join(skills)
        pokemon_data[30] = initiative
        pokemon_data[31] = proficiency_for_level(level)
        pokemon_data[34] = stab_for_level(level)
        pokemon_data[39] = floor_div2(stats['strength'])
        pokemon_data[40] = dex_modifier
        pokemon_data[41] = floor_div2(stats['constitution'])
        pokemon_data[42] = floor_div2(stats['intelligence'])
        pokemon_data[43] = floor_div2(stats['wisdom'])
        pokemon_data[44] = floor_div2(stats['charisma'])

        return {'status': 'success', 'newPokemonData': pokemon_data}
    except Exception as e:
        return {'status': 'error', 'message': f'Failed to apply feat changes: {e}'}
