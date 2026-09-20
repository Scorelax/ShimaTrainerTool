#!/usr/bin/env python3
"""One-shot migration: structured `effects` + per-condition tags for the moves file.

Reads DnD_moves_categorized_draft.json (REAL APP DATA, see categorize_moves_draft.js)
and, for every move still carrying one of the retired status tags, parses the
description into an `effects` list, then rewrites `categories` from that list.
Idempotent: once a move's retired tags are gone it is never selected again.

    python build_move_effects.py            # dry run: prints the report, writes nothing
    python build_move_effects.py --apply    # rewrites the moves file

--- effects schema (one entry per condition a move can apply) -----------------
    {
      "apply":    <condition>,                 # see CONDITIONS; "other" needs "label"
      "when":     {"type": ...},               # how the condition gets applied, below
      "target":   "self",                      # only present when the USER is affected
      "duration": "for 1 minute",              # verbatim phrase from the move text, if any
      "saveEnds": true,                        # target may repeat the save/escape each turn
      "label":    "Blink",                     # "other" conditions only
      "choice":   {"kind": "random", "die": "d6", "roll": 3}   # or {"kind": "chosen"}
      "note":     "free text for oddities the fields above can't carry"
    }
    when.type:
      always                          no roll or save needed
      on_hit                          the attack roll hitting is the only requirement
      natural_roll  {min}             natural attack roll >= min
      crit                            on a critical hit
      save_fail     {ability, failBy, requires}
                                      target fails a save; failBy = fail by at least N
                                      (absent = any failure); requires = "hit" | "crit"
                                      when the save only happens after a hit / critical
                                      hit (added automatically for moves tagged
                                      trigger_saving_throw_on_hit).
      special       (see note)        e.g. speed reduced to 0, HP-pool sleep

--- derived tags ---------------------------------------------------------------
    status_condition_<c>              always / on_hit   (guaranteed)
    potential_status_condition_<c>    everything else   (roll / save / crit / special)
    self_ prefix                      when the user is the one affected
"""
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

FILE = Path(__file__).with_name('DnD_moves_categorized_draft.json')

RETIRED = {
    'potential_status_condition', 'potential_prone', 'status_condition',
    'status_inflict_threshold', 'status_inflict_save', 'status_inflict_auto',
}

CONDITIONS = [
    'blinded', 'charmed', 'deafened', 'frightened', 'grappled', 'incapacitated',
    'paralyzed', 'petrified', 'poisoned', 'prone', 'restrained', 'stunned',
    'unconscious', 'exhaustion',                                  # standard
    'burned', 'frozen', 'asleep', 'confused', 'flinched',         # pokemon-style
    'slowed', 'other',                                            # custom
]

# --- how each condition is spelled when a move applies it --------------------
MENTION = {
    'poisoned':      r"\bpoisoned\b|\bpoison(?:ing)? (?:the|a|them|it)\b|\bcauses? poison\b",
    'burned':        r"\bbur(?:ned|nt|ning|n)\b(?!\s*damage)",
    'paralyzed':     r"\bparaly[sz](?:e|ed|es|is)\b",
    'frozen':        r"\bfrozen\b|\bfreezes?\b|\bfreezing (?:the|it|them|a)\b",
    'asleep':        r"\basleep\b|\bto sleep\b",
    'confused':      r"\bconfus(?:ed|es|e|ing)\b",
    'flinched':      r"\bflinch(?:es|ed)?\b",
    'frightened':    r"\bfrighten(?:ed)?\b",
    'charmed':       r"\bcharm(?:ed)?\b",
    'blinded':       r"\bblinded\b",
    'deafened':      r"\bdeafened\b",
    'stunned':       r"\bstunned\b",
    'restrained':    r"\brestrain(?:ed|ing)\b",
    'grappled':      r"\bgrappl(?:ed|ing)\b",
    'incapacitated': r"\bincapacitat(?:ed|ing)\b",
    'petrified':     r"\bpetrified\b",
    'prone':         r"\bprone\b",
    'exhaustion':    r"\bexhaustion\b",
    'unconscious':   r"\bunconscious\b",
    'slowed':        r"\bslowed\b",
}
MENTION = {k: re.compile(v, re.I) for k, v in MENTION.items()}

# Sentences that talk ABOUT a condition rather than applying it.
REFERENCE = re.compile(
    r"^(?:a|an|the)\s+(?:poisoned|burned|burning|paralyzed|frozen|asleep|confused|frightened|charmed|"
    r"blinded|deafened|stunned|restrained|grappled|incapacitated|petrified|slowed|infested)\s+(?:creature|target|opponent)"
    r"|\balready\b|\bwas charmed\b|\bif the user is\b|by this move\b"
    r"|\battacking a (?:slowed|frightened)\b|\bconsidered\b"
    r"|\b(?:while|as long as|so long as)\b[^,.]{0,60}\b(?:grappled|restrained|poisoned|incapacitated|charmed|frightened|blinded|stunned|burning|frozen|asleep|confused|slowed)\b"
    r"|\bburning targets\b"
    r"|\bon each successive turn\b|\bwake\b"
    r"|\battempt\w* to (?:restrain|stun|grapple|paralyze|freeze|confuse|charm|poison|burn|put)\b"
    r"|\battempting to (?:restrain|stun|grapple|paralyze|freeze|confuse|charm|poison|burn|put|inflict)\b"
    r"|\bchance to (?:put|paralyze|poison|burn|freeze|confuse)\b",
    re.I)
NEGATED = re.compile(r"(?:without|not|isn't|aren't|neither|no effect)\b[^.,;]{0,25}$", re.I)

ABILITY = re.compile(
    r"\b(strength|dexterity|constitution|intelligence|wisdom|charisma|STR|DEX|CON|INT|WIS|CHA)\b"
    r"(?:\s+(?:saving throw|save|roll))", re.I)
ABILITY_NAMES = {'strength': 'STR', 'dexterity': 'DEX', 'constitution': 'CON',
                 'intelligence': 'INT', 'wisdom': 'WIS', 'charisma': 'CHA'}

RE_NATURAL = re.compile(r"natural (?:attack )?rolls?\D{0,40}?(\d+)\s+or\s+(?:higher|more|20)", re.I)
RE_PLAIN_ROLL = re.compile(r"\bon a roll of (\d+) or (?:higher|more)", re.I)
RE_CRIT = re.compile(r"\b(?:on|scoring|scores) a critical hit\b", re.I)
RE_FAILBY = re.compile(r"\bfail\w*[^.]{0,45}?\bby\s+(more than\s+)?(\d+)|\bfailure of (\d+) or more", re.I)
RE_SAVE_FAIL = re.compile(
    r"\bon a fail(?:ure|ed save| save)?\b|\bfails? (?:the|this|their|its) (?:save|saving throw|roll)\b"
    r"|\bfail(?:s|ed)? the (?:save|saving throw)\b|\b(?:save|saving throw) (?:is )?fail(?:s|ed)\b"
    r"|\bcreatures? (?:that|who) fail\b|\bfailing the (?:save|saving throw)\b|\bmust (?:succeed|pass)\b"
    r"|\bif (?:the|it|they)\b[^.]{0,20}\bfails?\b|\bfailed save\b|\bon a failed\b"
    r"|\bmust (?:also |then )?(?:succeed|pass)\b"
    r"|\b(?:save|saving throw)\b[^.]{0,90}?,?\s+or\s+(?:be|become|becomes|fall|falls|falling|are|is|suffer|take|takes)\b", re.I)
RE_HIT = re.compile(
    r"\bon a (?:successful )?hit\b|\bon hit\b|\bon a success\b|\bif (?:the |this )?(?:attack )?hits?\b"
    r"|\bcreature hit\b|\bhit creature\b|\bsuccessful grapple\b|\bafter a hit\b", re.I)
RE_SELF = re.compile(r"\byou (?:become|are|fall)\b|\byourself\b|(?:^|[,;:]\s*)you must (?:succeed|pass)\b", re.I)
RE_DURATION = re.compile(
    r"\b(for (?:\d+d\d+|\d+|one|two|three|a) (?:round|turn|minute|hour)s?"
    r"|for the duration|until (?:the )?(?:end|beginning|start) of (?:its|their|the target's|the creature's|your|the user's|the beholder's) next turn"
    r"|until the (?:end|beginning|start) of (?:its|their|your) next turn)\b", re.I)
RE_SAVE_ENDS = re.compile(
    r"\b(?:repeat|make|attempt)\b[^.]{0,30}\b(?:saving throw|save)\b[^.]{0,70}\b(?:beginning|end|start) of (?:each of )?(?:its|their|the creature's) turns?\b"
    r"|\b(?:escape|break free|end the effect)\b[^.]{0,70}\b(?:beginning|end|start) of (?:each of )?(?:its|their) turns?\b"
    r"|\b(?:beginning|end|start) of (?:each of )?(?:its|their) turns?\b[^.]{0,70}\b(?:escape|break free|repeat the sav)", re.I)
NO_DURATION = {'prone'}          # a fall doesn't "last"; the sentence's duration belongs to something else


def sentences(text):
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+", re.sub(r"\s+", " ", text)) if s.strip()]


def find_ability(s):
    m = ABILITY.search(s)
    if not m:
        return None
    a = m.group(1)
    return ABILITY_NAMES.get(a.lower(), a.upper())


def detect_when(s, last_ability):
    """Returns (when-dict, ability) for the strongest trigger cue in the sentence."""
    m = RE_NATURAL.search(s)
    if m:
        return {'type': 'natural_roll', 'min': int(m.group(1))}, last_ability
    m = RE_PLAIN_ROLL.search(s)
    if m:
        return {'type': 'natural_roll', 'min': int(m.group(1)), '_plain': True}, last_ability
    if RE_CRIT.search(s):
        return {'type': 'crit'}, last_ability
    ability = find_ability(s) or last_ability
    m = RE_FAILBY.search(s)
    if m:
        n = int(m.group(2) or m.group(3))
        if m.group(1):
            n += 1                       # "more than 5" == 6 or more
        return {'type': 'save_fail', 'ability': ability, 'failBy': n}, ability
    if RE_SAVE_FAIL.search(s):
        return {'type': 'save_fail', 'ability': ability}, ability
    if RE_HIT.search(s):
        return {'type': 'on_hit'}, ability
    return {'type': 'always'}, ability


def parse_move(move):
    """Parse the description into effects. Returns (effects, flags)."""
    effects, flags = [], []
    last_ability = None
    last_sentence_effects = []
    for s in sentences(move['description']):
        a = find_ability(s)
        if a:
            last_ability = a
        found = []
        if not REFERENCE.search(s):
            for cond, rx in MENTION.items():
                for m in rx.finditer(s):
                    if NEGATED.search(s[:m.start()]):
                        continue
                    found.append((m.start(), cond))
                    break
        if not found:
            # "A blinded creature can repeat the save at the start of its turns" etc.
            # describes the previous sentence's effects rather than adding new ones.
            if RE_SAVE_ENDS.search(s):
                for e in last_sentence_effects:
                    e['saveEnds'] = True
            continue
        when, last_ability = detect_when(s, last_ability)
        if when.pop('_plain', False):
            flags.append("non-natural 'roll of N'")
        this = []
        for _, cond in sorted(found):
            e = {'apply': cond, 'when': dict(when)}
            if RE_SELF.search(s):
                e['target'] = 'self'
            d = RE_DURATION.search(s)
            if d and cond not in NO_DURATION:
                e['duration'] = d.group(1)
            if RE_SAVE_ENDS.search(s):
                e['saveEnds'] = True
            this.append(e)
        effects.extend(this)
        last_sentence_effects = this
    # dedupe: same condition + same trigger; and a bare `always`/`on_hit` is dropped when the
    # same condition also has a real roll/save trigger (the bare one is flavor text).
    strong = {(e['apply'], e.get('target')) for e in effects
              if e['when']['type'] not in ('always', 'on_hit')}
    hit = {(e['apply'], e.get('target')) for e in effects if e['when']['type'] == 'on_hit'}
    seen, out = set(), []
    for e in effects:
        k = (e['apply'], e.get('target'))
        if e['when']['type'] in ('always', 'on_hit') and k in strong:
            continue
        if e['when']['type'] == 'always' and k in hit:
            continue
        key = (e['apply'], json.dumps(e['when'], sort_keys=True), e.get('target'))
        if key not in seen:
            seen.add(key)
            out.append(e)
    return out, flags


# --- helpers for the override table ------------------------------------------
def E(apply, when, **kw):
    e = {'apply': apply, 'when': when}
    e.update(kw)
    return e


ALWAYS = {'type': 'always'}
HIT = {'type': 'on_hit'}
CRIT = {'type': 'crit'}


def NAT(n):
    return {'type': 'natural_roll', 'min': n}


def SAVE(ability=None, failBy=None, requires=None):
    w = {'type': 'save_fail'}
    if ability:
        w['ability'] = ability
    if failBy:
        w['failBy'] = failBy
    if requires:
        w['requires'] = requires
    return w


def SPECIAL():
    return {'type': 'special'}


def other(label, when, **kw):
    return E('other', when, label=label, **kw)


def roll(die, n):
    return {'kind': 'random', 'die': die, 'roll': n}


CHOSEN = {'kind': 'chosen'}


def table(when, die, rows, **shared):
    """Random-table effects: rows = [(condition-or-label, roll, extra-kwargs)]."""
    out = []
    for cond, n, extra in rows:
        kw = dict(shared)
        kw.update(extra)
        if cond in CONDITIONS:
            out.append(E(cond, dict(when), choice=roll(die, n), **kw))
        else:
            out.append(E('other', dict(when), label=cond, choice=roll(die, n), **kw))
    return out


# Hand-written effects for moves the parser can't (or shouldn't) read. An entry
# REPLACES the parse. Written from the move text; anything the schema can't carry
# goes in `note`.
BLINK = 'Blink'
OVERRIDES = {
    # ---- Bug
    'Infestation': [other('infested', HIT, duration='for 1d4 rounds',
                          note='CON save at the start of each of its turns, taking 1d4 + MOVE bug damage on a failure')],
    'Megahorn': [E('prone', SAVE('STR'), note='only if the user moved at least 20 ft towards the target first')],
    'Spider Web': [E('restrained', HIT, saveEnds=True,
                     note='also cannot flee or be switched out; escapes with an action and a STR save')],
    'String Shot': [E('restrained', SPECIAL(), note='only if the stacked speed reduction (-10 ft per hit) brings its speed to 0')],
    # ---- Cosmic
    'Cosmic Pulse': [other(BLINK, SAVE('CON', requires='crit'), duration='until the end of their next turn')],
    'Dimension Slash': [other(BLINK, SAVE('CON', requires='hit'), duration='for 1 minute')],
    'Erasure': [other('removed from reality', SAVE('CHA'), duration='for 1d4 rounds',
                      note='save is made with disadvantage (legendary creatures and beings with strong planar connections have advantage); cannot be affected by anything while gone'),
                E('stunned', SAVE('CHA'), duration='for 1 round', note='when the creature returns')],
    'Graviton Beam': [E('prone', SAVE('STR')),
                      E('slowed', SAVE('STR'), duration='for 1 minute', note='movement speed halved')],
    'Gravity': [other('grounded', ALWAYS, note='every creature in the 40 ft sphere loses its flying/hovering speed; Levitate is suppressed')],
    'Spacial Rend': [other(BLINK, SAVE('CON', failBy=5), duration='for 1 minute',
                           note='first sucked into the Ethereal Plane until the beginning of your next turn')],
    # ---- Dark
    'Flatter': [E('confused', ALWAYS, note='while confused the target doubles its proficiency bonus on attack rolls')],
    'Taunt': [other('taunted', SAVE('WIS'), duration='for the duration',
                    note='can only use damaging attacks that target you')],
    'Curse': [other('cursed', SAVE('WIS'), duration='for the duration',
                    note='Ghost-type users only; you take 2d8 at first, the target takes 2d8 + MOVE ghost damage at the end of each of its turns')],
    # ---- Electric
    'Electroweb': [E('restrained', SPECIAL(), note='only if the target\'s speed is reduced to 0 (-5 ft per hit)')],
    # ---- Fairy
    'Flavor Savor': [E('grappled', HIT), E('restrained', HIT),
                     E('incapacitated', SPECIAL(), note='once swallowed (your next turn, if you kept concentration); only works on creatures smaller than you')],
    'Light Spike': [other('drowsy', SAVE('CON', requires='hit'), duration='for 1d4 minutes',
                          note='disadvantage on saving throws and attack rolls; others have advantage on saves induced by this Pokémon'),
                    E('unconscious', SPECIAL(), duration='for 1d12 hours',
                      note='when the drowsiness ends; cannot be woken by normal means unless it completes a long rest; counts as asleep')],
    'Marinara Mist': [other('controlled senses', HIT, duration='for 1 minute',
                            note='you announce how you confuse its senses each turn; ends early if it is healed of all status conditions')],
    'Noodly Appendage': [E('confused', SAVE('WIS', requires='hit')), E('charmed', SAVE('WIS', requires='hit')),
                         E('stunned', SPECIAL(), note='on a fumble'),
                         E('petrified', SPECIAL(), note='from level 18, if the creature fumbles the saving throw')],
    'Song of the Deep': [other('mind captured', SAVE(), note='you then fall asleep, entering the Dreamscape with your captives'),
                         E('asleep', ALWAYS, target='self')],
    'Abyssal Grasp': [E('restrained', HIT, saveEnds=True,
                        note='needs a second successful melee attack roll (bonus action) after landing a melee attack; breaks free with a STR save on its turn')],
    # ---- Fighting
    'High Horsepower': [E('prone', HIT, note='only if the target is your size or smaller')],
    # ---- Fire
    'Chronoflame': [E('exhaustion', SPECIAL(), note='after a hit the target rolls a d4; on a 1-2 it suffers one level of exhaustion')],
    'Dawn Dance': table(SAVE('DEX'), 'd4', [
        ('charmed', 1, {'duration': 'until end of next turn'}),
        ('burned', 2, {}),
        ('blinded', 3, {'duration': 'until end of next turn'}),
        ('moved 15 ft in a random direction', 4, {}),
    ]),
    'Supernova': [E('deafened', SAVE('CON'), duration='for 1 minute', note='creatures that succeed are deafened for 3 rounds instead')],
    'Watchful Embers': [other('watchful embers', HIT, duration='for the duration', saveEnds=True,
                              note='WIS save at the start of its turn to get rid of them; your moves may originate from them')],
    # ---- Flying
    'Air Slash': [E('flinched', NAT(15), note='only if the target has not taken a turn this round')],
    'Sky Drop': [E('grappled', HIT, saveEnds=True)],
    # ---- Ghost
    'Cerulean Haunt': [E('incapacitated', HIT, duration='for 1d4 + MOVE turns',
                         note='the target must be asleep; it wakes up but cannot act; on a critical hit it also loses half its remaining HP or VP')],
    'Ethereal Vines': [E('grappled', HIT, saveEnds=True)],
    "Pharaoh's Curse": [E('frightened', SPECIAL(), duration='until the end of its next turn',
                          note='reaction: when a creature in range lands an attack against you or an ally; it also has disadvantage on all rolls')],
    'Trick-or-Treat': [other('type changed to Ghost', SAVE('CHA'), duration='for the duration')],
    # ---- Grass
    'Cotton Spore': [E('restrained', SPECIAL(), duration='for the duration',
                       note='only if the failed CON save\'s speed reduction (-10 ft) brings its speed to 0')],
    'Disorienting Powder': [other('disoriented', SAVE('WIS'), duration='until the beginning of your next turn',
                                  note='disadvantage on attack rolls and saving throws; other creatures have +1 to attack rolls against it'),
                            E('confused', SAVE('WIS', failBy=5))],
    "Forest's Curse": [other('type changed to Grass', SAVE('CON'), duration='for the duration')],
    'Leech Seed': [other('seeded', HIT, duration='until it faints or is switched out',
                         note='1d4 grass damage at the end of each of its turns; half is restored to the attacker')],
    'Petal Dance': [E('confused', SPECIAL(), target='self', note='only if you use the move again the following turn; at the end of that turn')],
    'Spore Cloud': [E(c, SAVE('CON'), choice=CHOSEN) for c in ('asleep', 'confused', 'paralyzed', 'poisoned')],
    'Worry Seed': [other('insomnia', SAVE('CON'), duration='for the duration',
                         note='replaces the user\'s choice of ability; prevents sleep; on humans, no long-rest benefits and eventually exhaustion')],
    # ---- Ground
    'Devastating Tremors': [E('prone', SAVE('STR')),
                            E('incapacitated', SAVE('CON'), target='self', duration='for 1 round',
                              note='DC 20 CON save the user makes after using the move')],
    "Land's Wrath": [E('slowed', SAVE('DEX'), duration='until the end of their next turn', note='speed halved')],
    'Thousand Arrows': [other('grounded', SAVE('DEX'), duration='until the end of your next turn')],
    'Thousand Waves': [other('cannot flee or be switched out', SAVE('DEX'), duration='as long as you remain in battle')],
    # ---- Ice
    'Glaciate': [E('frozen', SPECIAL(), note='only if the target\'s speed is reduced to 0 (-5 ft per hit); it can use an action to warm up first')],
    'Pack Frost': [E('slowed', SAVE('CON'), duration='until the end of their next turn')],
    # ---- Normal
    '7. Sleep Ray': [E('asleep', SAVE('WIS'), duration='for 1 minute',
                       note='unconscious for the duration; wakes if it takes damage or another creature wakes it; no effect on Steel- and Ghost-types')],
    'Dizzy Punch': [E('confused', NAT(18), note='from level 17 the threshold is 17 or more')],
    'Follow Me': [other('taunted', SAVE('WIS'), duration='until the beginning of your next turn',
                        note='all enemies in range; their attacks must target you')],
    'Horn Attack': [E('prone', SAVE('STR'), note='only if you moved at least 20 ft towards the target this turn')],
    'Perish Song': [other('perish song', SAVE('CON'),
                          note='includes the user; faints in 3 rounds, on its turn, unless it flees or is switched out first')],
    'Secret Power': table(NAT(15), 'd6', [('poisoned', 1, {}), ('burned', 2, {}), ('confused', 3, {}),
                                          ('frozen', 4, {}), ('paralyzed', 5, {}), ('asleep', 6, {})]),
    'Sing': [E('asleep', SPECIAL(), note='roll 5d8 + MOVE: that many total hit points of creatures within 30 ft fall asleep, lowest current HP first; a creature is affected only if its HP fits in the remaining total')],
    'Slack Off': [E('incapacitated', ALWAYS, target='self', duration='until the end of your next two turns',
                    note='immediately and through your next two turns')],
    'Vice Grip': [E('grappled', HIT, saveEnds=True)],
    'Swagger': [E('confused', SAVE('WIS'), note='the target adds +2 to its attack rolls while confused')],
    'Tri Attack': table(SAVE('DEX', failBy=5), 'd4', [('burned', 1, {}), ('frozen', 2, {}), ('paralyzed', 3, {})],
                        note='a roll of 4 is rerolled'),
    'Yawn': [E('asleep', SPECIAL(), note='falls asleep at the end of its next turn if it is still in the battle')],
    # ---- Poison
    '4. Slowing Ray': [E('slowed', SAVE('DEX'), duration='for 1 minute', saveEnds=True,
                         note='speed halved; cannot take reactions; one action or bonus action per turn, not both')],
    'Gastro Acid': [other('abilities suppressed', HIT, duration='for the duration')],
    'Process Waste': table(SAVE('CON'), 'd4', [('poisoned', 1, {}), ('paralyzed', 2, {}), ('burned', 3, {}), ('asleep', 4, {})]),
    'Spike Protein': [other('infected', SAVE('CON'),
                            note='a further CON save after the DEX save; loses 4d12 VP at the end of its turn; at 0 VP its HP also drops to 0')],
    'Toxic Thread': [E('poisoned', HIT, note='while the threads make contact with the target; speed also -10 ft, stackable (the poison itself does not stack)'),
                     E('restrained', SPECIAL(), note='only if the stacked speed reduction brings its speed to 0')],
    # ---- Psychic
    '6. Telekinetic Ray': [E('restrained', SAVE('STR'), duration="until the start of the beholder's next turn",
                             note='the beholder also moves it up to 30 ft in any direction')],
    'Dream Seal': [E('asleep', SAVE('WIS'), duration='for 1 minute',
                     note='cannot be woken by any means; afterwards it sleeps on normally, gains one level of exhaustion on waking and takes 5d4 psychic damage')],
    'Mystic Pollen': table(SAVE('WIS'), 'd20', [
        ('asleep', 1, {}), ('blinded', 2, {}), ('burned', 3, {}), ('charmed', 4, {}), ('confused', 5, {}),
        ('deafened', 6, {}), ('flinched', 7, {}), ('frightened', 8, {}), ('frozen', 9, {}), ('grappled', 10, {}),
        ('incapacitated', 11, {}), ('invisible', 12, {}), ('paralyzed', 13, {}), ('petrified', 14, {}),
        ('poisoned', 15, {}), ('prone', 16, {}), ('restrained', 17, {}), ('stunned', 18, {}),
    ], note='a roll of 19 rerolls; on a 20 the user chooses the condition'),
    'Vertigo Blast': [E('incapacitated', SAVE('WIS'), duration='for 1 round'),
                      E('slowed', SAVE('WIS'), duration='for 1 minute', saveEnds=True, note='speed halved')],
    # ---- Rock
    '8. Petrification': [E('restrained', SAVE('DEX'), note='begins to turn to stone'),
                         E('petrified', SAVE('DEX'), duration='for 1 minute',
                           note='after the restrained stage: must repeat the save at the end of its next turn')],
    'Petrifying Gaze': [E('restrained', SAVE('CON'), note='begins to turn to stone'),
                        E('petrified', SAVE('CON'), duration='for 1 minute', note='follows the restrained stage')],
    'Rock Wrecker': [E('prone', HIT), E('prone', SAVE('DEX'), note='other creatures within 5 ft of the target')],
    'Smack Down': [E('prone', HIT, note='also loses any flying speed and ground-type immunity until the end of your next turn')],
    'Stone Maw': [E('grappled', SAVE('DEX', requires='hit'), note='only if the target is smaller than you; it is swallowed'),
                  E('restrained', SAVE('DEX', requires='hit'), note='only if the target is smaller than you; it is swallowed')],
    # ---- Steel
    'Bell Toll': [E('deafened', SAVE('CON', failBy=5), duration='for 1 minute')],
    'Debris Break': [E('grappled', HIT)],
    'Metal Burst': [other('bleeding wounds', NAT(20), duration='for 3 rounds',
                          note='loses HP equal to its proficiency bonus each time it spends VP or uses its movement')],
    # ---- Water
    'Soak': [other('type changed to Water', SAVE('CON'), duration='for three rounds')],
    # ---- retired tag was wrong (crit range, not a condition)
    'Night Slash': [],
}

# Moves the old tagging pass missed entirely (no retired tag) that genuinely apply a
# condition. Found by running the parser over every move without `effects`; the other
# ~26 hits there were cures/immunities ("Safeguard", "Refresh"), damage bonuses against a
# condition ("Facade", "Smelling Salts") or wake-ups, which are not effects.
ADDITIONAL_TARGETS = {
    'Protostar': [E('blinded', SAVE('CON'), duration='for 1 minute',
                    note='creatures still inside Black Hole when the star ignites')],
    'Reality Bend': [E('confused', SAVE('WIS'), duration='for the duration', note='when a creature enters the distortion zone')],
    'Star Drain': [E('blinded', ALWAYS, duration='for the next round', note='creatures dependent on sight in the 80 ft area'),
                   E('blinded', SAVE('DEX'), duration='for 1 minute', note='on the flash released on your next turn')],
    'Starfall': [E('prone', SAVE('STR')),
                 E('blinded', SAVE('STR'), duration='until the end of their next turn'),
                 E('blinded', SAVE('CON'), duration='for 1 round', note='creatures within 60 ft of the impact but outside the radius')],
    '3. Fear Ray': [E('frightened', SAVE('WIS'), duration='for 1 minute', saveEnds=True)],
    'Imperial Decree': [E('charmed', SAVE('CHA'), duration='for 1 hour',
                          note='broken if you damage the charmed creature or lose concentration')],
    'Void Eruption': [E('prone', SAVE('STR'), note='Large or smaller creatures only; also flung up to 30 ft')],
    'Dragon Tail': [E('frightened', SAVE('CON', requires='hit'),
                      note='too frightened to remain in battle: switched out in trainer battles, moves away in wild battles')],
    'Outrage': [E('confused', SPECIAL(), target='self', note='when the move ends, after the third round or on broken concentration')],
    'Nuzzle': [E('paralyzed', SAVE('CON', requires='hit'))],
    'Whispering Winds': [E('frightened', SPECIAL(), note='on a natural roll of 1 on the WIS save')],
    'High Jump Kick': [E('prone', SPECIAL(), target='self', note='on a miss')],
    'Jump Kick': [E('prone', SPECIAL(), target='self', note='on a miss')],
    'Thermal Shock': [E('slowed', SAVE('CON', requires='hit'), duration='until the end of their next turn',
                        note='temperate environments only; speed halved')],
    'Final Gambit': [E('exhaustion', ALWAYS, target='self', note='3 levels; the user also faints')],
    'White Bloom': [E('incapacitated', SPECIAL(), target='self', duration='for one minute',
                      note='reaction at 0 HP; the white bloom replaces you')],
}
OVERRIDES.update(ADDITIONAL_TARGETS)

# Moves whose retired `status_inflict_threshold` tag really meant "natural-roll secondary
# effect that is not a condition" (AC/attack modifiers, advantage, ability boosts, speed 0).
# They keep that one tag until the effects schema grows a stat-modifier form.
KEEP_LEGACY_THRESHOLD = {
    'Lunge', 'Silver Wind', 'Crunch', 'Night Daze', 'Moonblast', 'Play Rough', 'Focus Blast',
    'Rock Smash', 'Ominous Wind', 'Shadow Bone', 'Energy Ball', 'Leaf Tornado', 'Trop Kick',
    'Mud Shot', 'Crush Claw', 'Mist Ball', 'Flash Cannon', 'Iron Tail', 'Metal Claw',
    'Meteor Mash', 'Octazooka', 'Razor Shell', 'Bone Crush',
}


def derive_tags(effects):
    tags = []
    for e in effects:
        guaranteed = e['when']['type'] in ('always', 'on_hit')
        prefix = 'status_condition' if guaranteed else 'potential_status_condition'
        if e.get('target') == 'self':
            prefix = 'self_' + prefix
        tag = f"{prefix}_{e['apply']}"
        if tag not in tags:
            tags.append(tag)
    return tags


def rebuild_categories(cats, effects, keep_legacy=False):
    """Replace the retired tags with the derived ones, at the first retired tag's position."""
    derived = derive_tags(effects)
    out, placed = [], False
    for c in cats:
        if c in RETIRED:
            if keep_legacy and c == 'status_inflict_threshold':
                out.append(c)
            elif not placed:
                out.extend(derived)
                placed = True
            continue
        out.append(c)
    if not placed:
        out.extend(derived)
    return out


def main():
    apply = '--apply' in sys.argv
    raw = FILE.read_text(encoding='utf-8')
    data = json.loads(raw)
    moves = data['moves']
    targets = [m for m in moves
               if (RETIRED & set(m['categories']) or m['name'] in ADDITIONAL_TARGETS)
               and not m.get('effects')]
    results = {}
    report = defaultdict(list)
    for m in targets:
        name = m['name']
        if name in OVERRIDES:
            effects, flags = OVERRIDES[name], []
            source = 'override'
        else:
            effects, flags = parse_move(m)
            source = 'parsed'
        if 'trigger_saving_throw_on_hit' in m['categories']:
            for e in effects:
                if e['when']['type'] == 'save_fail' and 'requires' not in e['when']:
                    e['when']['requires'] = 'hit'
        results[name] = (effects, source)
        if not effects and name not in KEEP_LEGACY_THRESHOLD and name not in OVERRIDES:
            report['no_effects_unhandled'].append(name)
        for f in flags:
            report['flags'].append(f'{name}: {f}')
        for e in effects:
            if e['apply'] == 'other' and 'label' not in e:
                report['other_without_label'].append(name)

    verbose = '--verbose' in sys.argv
    print(f'{len(targets)} target moves; {sum(1 for v in results.values() if v[1] == "override")} overridden')
    for k, v in report.items():
        print(f'\n[{k}] {len(v)}')
        for x in v:
            print('  -', x)
    if verbose:
        print()
        for m in targets:
            effects, source = results[m['name']]
            print(f"## {m['name']} [{m['type']}] ({source}) old={[c for c in m['categories'] if c in RETIRED]}")
            for e in effects:
                print('   ', json.dumps(e, ensure_ascii=False))

    if not apply:
        return
    by_name = {m['name']: m for m in targets}
    new_moves = []
    for m in moves:
        if m['name'] in by_name:
            effects, _ = results[m['name']]
            rebuilt = {}
            for k, v in m.items():
                if k == 'categories':
                    rebuilt['categories'] = rebuild_categories(
                        v, effects, keep_legacy=m['name'] in KEEP_LEGACY_THRESHOLD)
                    if effects:
                        rebuilt['effects'] = effects
                elif k != 'effects':
                    rebuilt[k] = v
            m = rebuilt
        new_moves.append(m)
    data['moves'] = new_moves
    FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
    tagc = Counter(c for m in new_moves for c in m['categories'] if 'status_condition' in c)
    print('\nwritten. new tag counts:')
    for k, v in sorted(tagc.items()):
        print(f'  {k}: {v}')


if __name__ == '__main__':
    main()
