"""Pokemon abilities in the shared battle -- slice 1: the defensive, always-on effects the server applies by itself
whenever damage, a status or weather damage lands (pi-server/docs/ability-effects-schema.md for the data).

A participant has ONE ability, its `abilities` text ("0:Name;description", the format move-effects.js's
parseAbilityList reads), with any live `ability_override` status (Skill Swap, Role Play, ...) swapped in, and none at
all under `abilities_suppressed`. Abilities tagged `unknown` (manual by design) are skipped.

Gates (`while`) are checked against the live battle; a gate the server can't judge on its own (a DM's call on the
environment, anything about a target) counts as NOT met -- nothing is applied by guesswork.
"""
import json
import os
import re

from .conditions import weathers_affecting, terrains_affecting

ABILITIES_FILE = os.path.join(os.path.dirname(__file__), '..', 'docs', 'DnD_abilities.json')
_cache = {'key': None, 'by_name': {}}

# Conditions that count as negative for `negativeConditions` / `self_negative_status`.
NEGATIVE_CONDITIONS = {
    'blinded', 'charmed', 'deafened', 'frightened', 'grappled', 'incapacitated', 'paralyzed', 'petrified',
    'poisoned', 'prone', 'restrained', 'stunned', 'unconscious', 'exhaustion', 'burned', 'frozen', 'asleep',
    'confused', 'flinched', 'slowed', 'taunted', 'drowsy', 'cursed', 'infested', 'seeded', 'bleeding', 'infected',
    'disoriented', 'switch_locked', 'trapped', 'move_disabled',
}

_LADDER = (2, 1, 0.5, 0)  # type-chart steps, worst to best for the defender (same as routes_combat's _MULT_LADDER)


def _by_name():
    try:
        st = os.stat(ABILITIES_FILE)
    except OSError:
        return {}
    key = (st.st_mtime, st.st_size)
    if _cache['key'] != key:
        with open(ABILITIES_FILE, encoding='utf-8') as f:
            data = json.load(f)
        _cache['by_name'] = {a['name'].lower(): a for a in data.get('abilities', [])}
        _cache['key'] = key
    return _cache['by_name']


def _ability_name(entry):
    """'0:Name;description' / 'Name;description' / 'Name' -> 'Name'."""
    head = str(entry or '').split(';', 1)[0].strip()
    if ':' in head and head.split(':', 1)[0].strip().isdigit():
        head = head.split(':', 1)[1]
    return head.strip()


def ability_names(participant):
    statuses = (participant or {}).get('statuses') or []
    if any(s.get('kind') == 'condition' and s.get('apply') == 'abilities_suppressed' for s in statuses):
        return []
    names = [_ability_name(e) for e in str((participant or {}).get('abilities') or '').split('|') if e.strip()]
    for s in statuses:
        if s.get('kind') == 'condition' and s.get('apply') == 'ability_override' and s.get('value') and s.get('value2'):
            old, new = str(s['value']).lower(), _ability_name(s['value2'])
            names = [new if n.lower() == old else n for n in names]
    return [n for n in names if n]


def client_effects():
    """{ability name: effects} for every ability with effects (not unknown-tagged) -- sent to the client with the move
    data (list-move-categories) for its half of the engine."""
    return {a['name']: a['effects'] for a in _by_name().values()
            if a.get('effects') and 'unknown' not in a.get('categories', [])}


def ability_effects(participant):
    """[(ability name, effect), ...] for the participant's ability."""
    return [(name, e) for name, _, e in indexed_effects(participant)]


def indexed_effects(participant):
    """[(ability name, index of the effect within that ability, effect), ...] -- the index is how the client names
    one effect when it reports a trigger (routes_combat's ability-trigger)."""
    by_name = _by_name()
    out = []
    for name in ability_names(participant):
        a = by_name.get(name.lower())
        if not a or 'unknown' in a.get('categories', []):
            continue
        out += [(a['name'], i, e) for i, e in enumerate(a.get('effects') or [])]
    return out


def triggered(state, pid, event):
    """The participant's effects for this trigger (`when.type`) whose gates hold: [(ability, index, effect), ...]."""
    p = state['participants'].get(pid)
    if not p:
        return []
    return [(ab, i, e) for ab, i, e in indexed_effects(p)
            if (e.get('when') or {}).get('type') == event and gates_hold(state, pid, p, e)]


def resolve_amount(p, amount):
    """A fixed amount the server can work out by itself, or None when it needs a roll (dice) or a number only the
    table knows (a share of damage dealt)."""
    if isinstance(amount, (int, float)):
        return int(amount)
    if not isinstance(amount, dict) or amount.get('dice'):
        return None
    prof = int(p.get('proficiency') or 0)
    level = int(p.get('level') or 0)
    if amount.get('proficiency'):
        return prof
    if 'level' in amount:
        return level * int(amount['level'] or 1)
    if 'levelMultiple' in amount:
        return level * int(amount['levelMultiple'])
    if 'fractionMaxHP' in amount:
        value = (p.get('maxHP') or 0) * amount['fractionMaxHP']
        return int(-(-value // 1)) if amount.get('round') == 'up' else int(value)
    if 'flat' in amount:
        return int(amount['flat']) + prof * int(amount.get('proficiencyMultiple') or 0)
    if 'abilityMod' in amount:
        mod = int(p.get(f"{str(amount['abilityMod']).lower()}Mod") or 0)
        return mod + (prof if amount.get('plusProficiency') else 0)
    return None


# --- gates --------------------------------------------------------------------------------------------------------

def _conditions(p):
    return {s.get('apply') for s in (p or {}).get('statuses') or [] if s.get('kind') == 'condition'}


def _hp_fraction(p):
    mx = p.get('maxHP') or 0
    return (p.get('currentHP') or 0) / mx if mx else 1


def gate_holds(state, pid, p, gate, target=None):
    """True / False, or None when the server can't judge it (treated as not met). `target` (a participant) lets the
    target_* gates be judged -- an attacker's ability against who it's hitting (Infiltrator)."""
    t = (gate or {}).get('type')
    if t == 'any_of':
        return any(gate_holds(state, pid, p, g, target) is True for g in gate.get('gates') or [])
    if t == 'not':
        inner = gate_holds(state, pid, p, gate.get('gate') or {}, target)
        return None if inner is None else not inner
    if target is not None and t == 'target_status':
        return bool(_conditions(target) & set(gate.get('any') or []))
    if target is not None and t == 'target_types':
        return bool({x.lower() for x in gate.get('any') or []} & _types(target))
    if target is not None and t == 'target_shares_type':
        return bool(_types(target) & _types(p))
    if t == 'self_hp_full':
        return (p.get('maxHP') or 0) > 0 and (p.get('currentHP') or 0) >= p['maxHP']
    if t == 'self_hp_below':
        return _hp_fraction(p) < gate['fraction']
    if t == 'self_hp_at_or_below':
        return _hp_fraction(p) <= gate['fraction']
    if t == 'self_hp_at_or_above':
        return _hp_fraction(p) >= gate['fraction']
    if t == 'self_status':
        return bool(_conditions(p) & set(gate.get('any') or []))
    if t == 'self_negative_status':
        return bool(_conditions(p) & NEGATIVE_CONDITIONS)
    if t == 'environment' and set(gate.get('any') or []) == {'outside'}:
        return True  # "enters an outside battle": nearly every battle map is outdoors -- the log says so, the DM can clear it
    if t in ('self_weather_contains', 'self_terrain_contains'):
        fields = weathers_affecting(state, pid) if t == 'self_weather_contains' else terrains_affecting(state, pid)
        names = [str(f.get('name') or '').lower() for f in fields]
        return any(k.lower() in n for n in names for k in gate.get('any') or [])
    return None


def gates_hold(state, pid, p, effect, target=None):
    return all(gate_holds(state, pid, p, g, target) is True for g in effect.get('while') or [])


def _types(p):
    return {str((p or {}).get(k) or '').lower() for k in ('type1', 'type2')} - {''}


def passive_effects(state, pid, p, kinds):
    """The participant's own always-on effects of these kinds whose gates hold right now."""
    return [(name, e) for name, e in ability_effects(p)
            if e.get('kind') in kinds and (e.get('when') or {}).get('type') == 'passive'
            and e.get('target', 'self') == 'self' and gates_hold(state, pid, p, e)]


# --- damage -------------------------------------------------------------------------------------------------------

def is_melee_record(record):
    """Same rule as move-effects.js's isMeleeMoveRow."""
    if not record:
        return False
    return bool(re.search(r'melee', str(record.get('range') or ''), re.I)
                or re.search(r'\b(?:makes?|strike out with)\b[^.]{0,40}?\bmelee attack', str(record.get('description') or ''), re.I))


def _types_match(value, move_type, multiplier, except_types=()):
    """A damageTypes value against the move's type: a list of types, 'all' (minus exceptTypes), or
    'all_not_vulnerable' (everything that isn't super effective)."""
    if not move_type:
        return False
    if value == 'all':
        return move_type not in {x.lower() for x in except_types}
    if value == 'all_not_vulnerable':
        return multiplier <= 1
    return isinstance(value, list) and move_type in {x.lower() for x in value}


def _step(multiplier, better):
    idx = _LADDER.index(multiplier) if multiplier in _LADDER else 1
    if multiplier == 0:
        return 0  # an immunity stays an immunity
    return _LADDER[min(idx + 1, 3)] if better else _LADDER[max(idx - 1, 0)]


_DAMAGE_ORDER = ('vulnerability', 'resistance', 'immunity', 'absorb', 'damage_taken_mod')


def adjust_incoming_damage(state, attacker_id, target_id, move_type, record, crit, multiplier, hostile, in_gravity,
                           distance_ft=None):
    """Abilities on a hit, after the type chart: the target's defence (slice 1), then the attacker's own (Tinted Lens,
    Scrappy, Mold Breaker -- slice 2) and damage auras around the attacker (Dark/Fairy Aura, Aura Break, Gravity Well,
    Pure Waters). Returns (type multiplier, extra multiplier, absorb fraction or None, [notes for the log]).
    `hostile` = attacker and target are on opposite sides; `distance_ft(state, a, b)` is routes_combat's helper."""
    target = state['participants'][target_id]
    attacker = state['participants'].get(attacker_id) or {}
    mtype = (move_type or '').strip().lower()
    name = (record or {}).get('name') or ''
    melee = is_melee_record(record)
    extra, absorb, notes = 1, None, []
    # Mold Breaker / Teravolt / Turboblaze: the target's ability doesn't get a say.
    breaker = next((ab for ab, _ in passive_effects(state, attacker_id, attacker, {'ignore_target_abilities'})), None)
    if breaker and target_id != attacker_id:
        effects = []
        if ability_names(target):
            notes.append(f"{breaker}: ignores {target.get('name')}'s ability")
    else:
        effects = passive_effects(state, target_id, target, set(_DAMAGE_ORDER))
    effects.sort(key=lambda ne: _DAMAGE_ORDER.index(ne[1]['kind']))
    for ab, e in effects:
        kind = e['kind']
        if kind == 'vulnerability' and _types_match(e.get('damageTypes'), mtype, multiplier):
            multiplier = _step(multiplier, better=False)
            notes.append(f'{ab}: weak to it')
        elif kind == 'resistance' and _types_match(e.get('damageTypes'), mtype, multiplier, e.get('exceptTypes') or ()):
            multiplier = _step(multiplier, better=True)
            notes.append(f'{ab}: resists it')
        elif kind == 'immunity':
            immune = (
                (_types_match(e.get('damageTypes'), mtype, multiplier) and not (ab.lower() == 'levitate' and in_gravity))
                or (name and name in (e.get('moves') or []))
                or (name and any(s.lower() in name.lower() for s in e.get('nameMatch') or []))
                or (e.get('soundBased') and (record or {}).get('soundBased'))
                or (e.get('allyAttacks') and attacker_id != target_id and not hostile)
                or (e.get('nonVulnerableDamage') and mtype and multiplier <= 1)
            )
            if immune and multiplier:
                multiplier = 0
                notes.append(f'{ab}: immune')
            if e.get('vulnerabilityExtra') and multiplier > 1:
                multiplier = 1
                notes.append(f'{ab}: no extra damage from its weakness')
        elif kind == 'absorb' and _types_match(e.get('damageTypes'), mtype, multiplier):
            absorb = e.get('healFraction', 0.5)
            notes.append(f'{ab}: absorbs it')
        elif kind == 'damage_taken_mod' and 'multiplier' in e:
            f = e.get('filter') or {}
            if f.get('saveForHalf') or f.get('crit') or 'rerollKeep' in e or e.get('maxDamage'):
                continue  # needs the roll or the save itself -- the client's side (a later slice)
            if f.get('damageTypes') and mtype not in {x.lower() for x in f['damageTypes']}:
                continue
            if f.get('notTypes') and mtype in {x.lower() for x in f['notTypes']}:
                continue
            if f.get('melee') and not melee:
                continue
            if (f.get('superEffective') or f.get('vulnerable')) and multiplier <= 1:
                continue
            extra *= e['multiplier']
            notes.append(f"{ab}: x{e['multiplier']}")

    # The attacker's own ability on its move (gates may look at the target -- Infiltrator).
    for ab, e in ability_effects(attacker):
        if (e.get('when') or {}).get('type') != 'passive' or e.get('target', 'self') != 'self':
            continue
        f = e.get('filter') or {}
        if set(f) - {'damaging', 'moveTypes'}:
            continue  # slashing & co. -- not something the server can tell from the move
        if f.get('moveTypes') and mtype not in {x.lower() for x in f['moveTypes']}:
            continue
        if not gates_hold(state, attacker_id, attacker, e, target):
            continue
        if e.get('kind') == 'ignore_immunity' and multiplier == 0 and mtype in {x.lower() for x in e.get('moveTypes') or []} \
                and _types(target) & {x.lower() for x in e.get('vsTypes') or []}:
            multiplier = 1
            notes.append(f'{ab}: hits through the immunity')
        elif e.get('kind') == 'ignore_resistance' and multiplier == 0.5:
            multiplier = 1
            notes.append(f'{ab}: ignores the resistance')

    # Damage auras: a move used within the aura holder's radius (Dark Aura, Fairy Aura -- reversed by Aura Break --
    # Gravity Well, Pure Waters).
    if distance_ft and mtype:
        def within(holder_id, radius):
            if holder_id == attacker_id:
                return True
            d = distance_ft(state, holder_id, attacker_id)
            return d is not None and d <= radius
        auras_broken = any(e.get('kind') == 'aura_break' and within(pid, e.get('radiusFt') or 0)
                           for pid, p in state['participants'].items() if p.get('status') == 'participating'
                           for _, e in ability_effects(p))
        for pid, p in state['participants'].items():
            if p.get('status') != 'participating':
                continue
            for ab, e in ability_effects(p):
                if e.get('kind') != 'damage_mod' or not e.get('totalMultiplier') or e.get('target') not in ('all', 'others'):
                    continue
                if (e.get('when') or {}).get('type', 'passive') != 'passive' or not gates_hold(state, pid, p, e):
                    continue
                if e['target'] == 'others' and pid == attacker_id:
                    continue
                types = (e.get('filter') or {}).get('moveTypes')
                if types and mtype not in {x.lower() for x in types}:
                    continue
                if not within(pid, e.get('radiusFt') or 0):
                    continue
                factor = e['totalMultiplier']
                if auras_broken and ab in ('Dark Aura', 'Fairy Aura'):
                    factor = 1 / factor
                extra *= factor
                notes.append(f"{ab} ({p.get('name')}): x{factor:g}")
    return multiplier, extra, absorb, notes


# --- statuses -----------------------------------------------------------------------------------------------------

def _blocks_condition(effect, apply):
    return apply in (effect.get('conditions') or []) or (effect.get('negativeConditions') and apply in NEGATIVE_CONDITIONS)


def condition_block(state, target_id, spec, distance_ft, hostile):
    """The ability (with its holder, for an ally's aura) that stops this condition from landing, or None.
    `distance_ft(state, a, b)` and `hostile(state, a, b)` are routes_combat's own helpers."""
    if spec.get('kind') != 'condition':
        return None
    apply = spec.get('apply')
    target = state['participants'].get(target_id) or {}
    for ab, e in passive_effects(state, target_id, target, {'immunity'}):
        if _blocks_condition(e, apply):
            return ab
    target_types = {str(target.get(k) or '').lower() for k in ('type1', 'type2')} - {''}
    for pid, p in state['participants'].items():
        if pid == target_id or p.get('status') != 'participating' or hostile(state, p, target):
            continue
        for ab, e in ability_effects(p):
            if e.get('kind') != 'immunity' or (e.get('when') or {}).get('type') != 'passive':
                continue
            if e.get('target') not in ('allies', 'self_and_allies') or not _blocks_condition(e, apply):
                continue
            wanted = {t.lower() for t in (e.get('targetFilter') or {}).get('types') or []}
            if wanted and not (wanted & target_types):
                continue
            radius = e.get('radiusFt')
            if radius:
                d = distance_ft(state, pid, target_id)
                if d is None or d > radius:
                    continue
            if gates_hold(state, pid, p, e):
                return f"{ab} ({p.get('name')})"
    return None


def _lowers(spec):
    amount = spec.get('amount')
    if isinstance(amount, (int, float)):
        return amount < 0
    if isinstance(amount, dict):
        return (amount.get('multiplier') or 1) < 1 or amount.get('sign') == -1
    return False


def stat_lock_block(state, target_id, spec):
    """Clear Body & co.: another creature can't lower these stats. Returns the ability name or None."""
    if spec.get('kind') != 'stat' or not _lowers(spec):
        return None
    source = spec.get('sourceId')
    if not source or source == target_id:
        return None
    target = state['participants'].get(target_id) or {}
    for ab, e in passive_effects(state, target_id, target, {'stat_lock'}):
        if not e.get('stats') or spec.get('stat') in e['stats']:
            return ab
    return None


def weather_damage_immune(state, pid, participant, weather_kind):
    """Sand Veil / Snow Cloak / Overcoat & co.: the ability that skips this weather's damage, or None.
    weather_kind is conditions.py's weather_damage_kind ('hail' | 'sandstorm')."""
    key = 'sand' if weather_kind == 'sandstorm' else weather_kind
    for ab, e in passive_effects(state, pid, participant, {'immunity'}):
        if key in (e.get('weatherDamage') or []):
            return ab
    return None
