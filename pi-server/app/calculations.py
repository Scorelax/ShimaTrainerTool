"""The game's number rules (HP / VP, proficiency, STAB, feats) and text clean-up shared by the routes. A player's own
Pokemon uses them through owned.py, a trainer through trainers.py.
"""
import math
import re

from .jsutil import js_parse_int, js_number, intify

_FEAT_CHOICE = re.compile(r'^(.+?)\s*\((.+?)\)$')


def sanitize_string(s):
    if not s:
        return ''
    s = str(s).replace('\n', ' ').replace('\r', ' ').replace('\\', '')
    return re.sub(r'\s+', ' ', s).strip()


_MOJIBAKE_MARKS = ('Ã', 'â€', 'Â')


def fix_mojibake(s):
    """'PokÃ©mon' -> 'Pokémon': text that was UTF-8 but got read as Windows-1252 somewhere on its way from the
    encyclopedia (some of its descriptions arrive like that). Only touches text that shows the tell-tale marks,
    and leaves it as it was if it doesn't turn back into proper UTF-8."""
    if not s or not isinstance(s, str) or not any(m in s for m in _MOJIBAKE_MARKS):
        return s
    for codec in ('cp1252', 'latin-1'):
        try:
            return s.encode(codec).decode('utf-8')
        except (UnicodeEncodeError, UnicodeDecodeError):
            continue
    return s


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

    # the CON modifier is truncated toward zero here (ceil for negatives) -- the game's HP rule
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
