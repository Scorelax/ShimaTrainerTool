// Pokemon abilities on the client (shared battle) -- slice 2: what a creature's ability changes about its own rolls and
// moves (pi-server/docs/ability-effects-schema.md for the data; slice 1, the defensive side, runs on the server in
// pi-server/app/abilities.py). Three ways in:
//  - abilityStatuses(p, target): always-on bonuses that don't depend on the move -- +2 AC (Sand Veil), crit range
//    (Super Luck), advantage/disadvantage (No Guard, Defeatist, Slow Start, Pack Tactics with a target) -- as virtual
//    `stat`/`roll` statuses, so move-effects.js counts them everywhere a real status counts (statDeltas,
//    attackRollContext, saveRollContext).
//  - moveAbilityMods(p, move, info): what the ability does to ONE move -- type change (Pixilate), STAB, attack/damage
//    bonuses (Overgrow, Plus, Competitive), VP cost, save DC -- folded into the move popup by combat.js.
//  - targetAbilityDamage(attacker, target, move, type): damage that depends on who's hit (Merciless, Rivalry, Magnet
//    Pull) plus reminders for the defender's crit/reroll rules (Battle Armor, Paper Thin, Prism Armor), shown in the
//    damage-roll step (target-picker.js).
// A creature has ONE ability (its `abilities` text), with ability swaps applied and none under abilities_suppressed;
// `unknown`-tagged abilities never reach the client. A gate this side can't judge counts as not met.
import { footprintCells, footprintForSize } from './battle-map-grid.js';

let _data = {};       // ability name (lower case) -> { name, effects }
let _session = null;  // the live shared session, for weather/terrain/round/positions (set by combat-wip.js)

export function setAbilityData(map) {
  _data = {};
  for (const [name, effects] of Object.entries(map || {})) _data[name.toLowerCase()] = { name, effects };
}

export function setAbilitySession(session) { _session = session; }

const NEGATIVE = new Set(['blinded', 'charmed', 'deafened', 'frightened', 'grappled', 'incapacitated', 'paralyzed', 'petrified',
  'poisoned', 'prone', 'restrained', 'stunned', 'unconscious', 'exhaustion', 'burned', 'frozen', 'asleep', 'confused', 'flinched',
  'slowed', 'taunted', 'drowsy', 'cursed', 'infested', 'seeded', 'bleeding', 'infected', 'disoriented', 'switch_locked', 'trapped',
  'move_disabled']);

const _nameOf = (entry) => {
  let head = String(entry || '').split(';')[0].trim();
  const colon = head.indexOf(':');
  if (colon !== -1 && /^\d+$/.test(head.slice(0, colon).trim())) head = head.slice(colon + 1);
  return head.trim();
};

/** The creature's ability names (one, normally): ability swaps applied, none while suppressed. */
export function abilityNamesOf(p) {
  const statuses = p?.statuses || p?.liveStatuses || [];
  if (statuses.some(s => s.kind === 'condition' && s.apply === 'abilities_suppressed')) return [];
  let names = String(p?.abilities || '').split('|').filter(e => e.trim()).map(_nameOf).filter(Boolean);
  for (const s of statuses) {
    if (s.kind !== 'condition' || s.apply !== 'ability_override' || !s.value || !s.value2) continue;
    names = names.map(n => (n.toLowerCase() === String(s.value).toLowerCase() ? _nameOf(s.value2) : n));
  }
  return names;
}

/** [{ ability, effect }] for the creature's ability. */
export function abilityEffectsOf(p) {
  const out = [];
  for (const n of abilityNamesOf(p)) {
    const a = _data[n.toLowerCase()];
    if (a) a.effects.forEach(effect => out.push({ ability: a.name, effect }));
  }
  return out;
}

// --- gates ---------------------------------------------------------------------------------------------------------

const _statuses = (p) => p?.statuses || p?.liveStatuses || [];
const _conds = (p) => new Set(_statuses(p).filter(s => s.kind === 'condition').map(s => s.apply));
const _hp = (p) => Number(p?.currentHP ?? p?.currentHp) || 0;
const _maxHp = (p) => Number(p?.maxHP ?? p?.maxHp) || 0;
const _types = (p) => [p?.type1, p?.type2, ...(p?.types || [])].filter(Boolean).map(t => String(t).toLowerCase());

/** Whole-map field plus tile zones under the creature's token (move-effects.js's fieldsAffecting, kept small here). */
function _fields(p, key) {
  const s = _session;
  if (!s) return [];
  const found = s[key] ? [s[key]] : [];
  const token = s.board?.tokens?.[p?.id];
  if (token && (token.z || 0) >= 0) {
    const covered = new Set(footprintCells(token.col, token.row, footprintForSize(p.size)).map(c => `${c.col},${c.row}`));
    for (const z of s[`${key}Zones`] || []) {
      if ((z.cells || []).some(c => covered.has(c)) && (z.height == null || (token.z || 0) <= z.height)) found.push(z);
    }
  }
  return found;
}

function _allyAdjacentTo(attacker, target) {
  const s = _session;
  const t = s?.board?.tokens?.[target?.id];
  if (!t) return null;
  return Object.values(s.participants || {}).some(p => {
    if (p.id === attacker.id || p.id === target.id || p.status !== 'participating') return false;
    if ((p.side || '') !== (attacker.side || '') || (s.battleType === 'pvp' && (p.owner || '') !== (attacker.owner || ''))) return false;
    const pt = s.board.tokens[p.id];
    return pt && Math.max(Math.abs(pt.col - t.col), Math.abs(pt.row - t.row)) <= 1;
  });
}

/** true / false, or null when it can't be judged here (needs a target that wasn't given, or a DM's call). */
export function gateHolds(p, gate, target = null) {
  const t = gate?.type;
  const frac = () => (_maxHp(p) ? _hp(p) / _maxHp(p) : 1);
  switch (t) {
    case 'any_of': return (gate.gates || []).some(g => gateHolds(p, g, target) === true);
    case 'not': { const r = gateHolds(p, gate.gate || {}, target); return r === null ? null : !r; }
    case 'self_hp_full': return _maxHp(p) > 0 && _hp(p) >= _maxHp(p);
    case 'self_hp_below': return frac() < gate.fraction;
    case 'self_hp_at_or_below': return frac() <= gate.fraction;
    case 'self_hp_at_or_above': return frac() >= gate.fraction;
    case 'self_status': return (gate.any || []).some(c => _conds(p).has(c));
    case 'self_negative_status': return [..._conds(p)].some(c => NEGATIVE.has(c));
    case 'self_weather_contains':
    case 'self_terrain_contains': {
      const names = _fields(p, t === 'self_weather_contains' ? 'weather' : 'terrain').map(f => String(f.name || '').toLowerCase());
      return (gate.any || []).some(k => names.some(n => n.includes(k.toLowerCase())));
    }
    case 'self_no_held_item': return !String(p?.item || '').trim();
    case 'self_level_at_least': return (Number(p?.level) || 0) >= gate.n;
    case 'combat_round_at_most': return _session ? (Number(_session.round) || 1) <= gate.n : null;
    case 'ally_has_ability': return _session ? Object.values(_session.participants || {}).some(o => o.id !== p.id
      && (o.owner || '') === (p.owner || '') && abilityNamesOf(o).some(n => (gate.any || []).includes(n))) : null;
    default: break;
  }
  if (!target) return null;
  switch (t) {
    case 'target_status': return (gate.any || []).some(c => _conds(target).has(c));
    case 'target_types': return (gate.any || []).some(ty => _types(target).includes(ty.toLowerCase()));
    case 'target_shares_type': return _types(target).some(ty => _types(p).includes(ty));
    case 'target_level_below': return (Number(target.level) || 0) < gate.n;
    case 'target_level_at_least': return (Number(target.level) || 0) >= gate.n;
    case 'target_level_below_self': return (Number(target.level) || 0) < (Number(p.level) || 0);
    case 'ally_adjacent_to_target': return _allyAdjacentTo(p, target);
    default: return null;
  }
}

const _gatesHold = (p, e, target) => (e.while || []).every(g => gateHolds(p, g, target) === true);
const _needsTarget = (e) => (e.while || []).some(function needs(g) {
  return /^(target_|ally_adjacent)/.test(g.type || '') || (g.gates || []).some(needs) || (g.gate ? needs(g.gate) : false);
});
const _isPassiveSelf = (e) => (e.when?.type || 'passive') === 'passive' && (e.target || 'self') === 'self';

// --- virtual statuses --------------------------------------------------------------------------------------------------

const _ROLL_ON = new Set(['attack_rolls', 'attacks_against', 'saving_throws', 'saves_against_its_moves']);

/** The creature's always-on, move-independent ability bonuses as `stat`/`roll` status objects (see the header).
 * With `target`, effects gated on the target (Pack Tactics, Prey Stalker) are included too. */
export function abilityStatuses(p, target = null) {
  const out = [];
  abilityEffectsOf(p).forEach(({ ability, effect: e }, i) => {
    if (!_isPassiveSelf(e) || e.filter) return;
    if (_needsTarget(e) && !target) return;
    if (!_gatesHold(p, e, target)) return;
    const base = { id: `ability:${ability}:${i}`, moveName: ability, fromAbility: true, ends: [] };
    if (e.kind === 'stat' && typeof e.amount === 'number' && ['ac', 'crit', 'str', 'dex', 'con', 'int', 'wis', 'cha', 'attack_rolls'].includes(e.stat)) {
      out.push({ ...base, kind: 'stat', stat: e.stat, amount: e.amount });
    } else if (e.kind === 'crit_range') {
      out.push({ ...base, kind: 'stat', stat: 'crit', amount: e.amount });
    } else if (e.kind === 'attack_bonus') {
      out.push({ ...base, kind: 'stat', stat: 'attack_rolls', amount: e.amount });
    } else if (e.kind === 'roll' && _ROLL_ON.has(e.on) && !e.vsConditions && !e.vsAreaMoves) {
      out.push({ ...base, kind: 'roll', roll: e.roll, on: e.on, ...(e.ability ? { ability: e.ability } : {}) });
    }
  });
  return out;
}

// --- one move ----------------------------------------------------------------------------------------------------------

const _amount = (v, p) => (v === 'proficiency' ? Number(p?.proficiency) || 0 : v === 'level' ? Number(p?.level) || 0 : Number(v) || 0);

/** Does the effect's `filter` match this move? info = { type, damaging, melee, soundBased, attackRoll, vpCost, ownType,
 * recoil, negativeCondition }. A filter needing the target (superEffective) doesn't match here. */
function _filterOk(f, move, info) {
  if (!f) return true;
  const name = String(move[0] || '');
  if (f.moveTypes && !f.moveTypes.map(t => t.toLowerCase()).includes(String(info.type || '').toLowerCase())) return false;
  if (f.damaging && !info.damaging) return false;
  if (f.melee && !info.melee) return false;
  if (f.moves && !f.moves.includes(name)) return false;
  if (f.nameMatch && !f.nameMatch.some(s => name.toLowerCase().includes(s.toLowerCase()))) return false;
  if (f.soundBased && !info.soundBased) return false;
  if (f.attackRoll && !info.attackRoll) return false;
  if (f.maxVpCost != null && !(Number(info.vpCost) <= f.maxVpCost)) return false;
  if (f.ownType && !info.ownType) return false;
  if (f.recoil && !info.recoil) return false;
  if (f.negativeCondition && !info.negativeCondition) return false;
  if (f.superEffective || f.vulnerable || f.firstUseInEncounter || f.healing || f.slashing) return false;
  return true;
}

/** Dice for a level-scaled extra (Solvent Tail: { "5": "1d6", "10": "2d6" }). */
function _scaledDice(e, level) {
  let dice = e.extraDice;
  for (const [lvl, d] of Object.entries(e.scaling || {})) if (typeof d === 'string' && level >= Number(lvl)) dice = d;
  return dice;
}

/**
 * What the creature's ability does to one move. `move` is a moves-file row ([name, type, stat, action, vp, ...]);
 * `info` = { damaging, melee, soundBased, attackRoll, recoil, negativeCondition } (the caller knows the move flags).
 * Returns { type, extraTypes, attack, damageFlat, diceMultiplier, extraDice: [], stabMultiplier, vpMultiplier, dcBonus,
 *           atkParts, dmgParts, notes }.
 */
export function moveAbilityMods(combatant, move, info = {}) {
  // combat.js's local combatant lacks some session fields (owner, side) -- fill them from the live record.
  const live = _session?.participants?.[combatant?.id];
  const p = live ? { ...live, ...combatant } : combatant;
  const mods = { type: move[1], extraTypes: [], attack: 0, damageFlat: 0, diceMultiplier: 1, extraDice: [], stabMultiplier: 1,
    vpMultiplier: 1, dcBonus: 0, atkParts: [], dmgParts: [], notes: [] };
  const effs = abilityEffectsOf(p).filter(({ effect: e }) => _isPassiveSelf(e) && !_needsTarget(e) && _gatesHold(p, e, null));
  const ownTypes = () => [..._types(p), ...mods.extraTypes.map(t => t.toLowerCase())];
  const ctx = () => ({ ...info, type: mods.type, vpCost: move[4], ownType: ownTypes().includes(String(mods.type || '').toLowerCase()) });

  // The move's type first (Pixilate, Normalize, Liquid Voice...): every other filter reads the final type.
  for (const { ability, effect: e } of effs) {
    if (e.kind !== 'move_type_override' || !e.to || e.to === 'chosen') continue;
    if (e.from && String(e.from).toLowerCase() !== String(mods.type || '').toLowerCase()) continue;
    if (!_filterOk(e.filter, move, ctx())) continue;
    if (mods.type !== e.to) mods.notes.push(`${ability}: counts as ${e.to}-type`);
    mods.type = e.to;
  }
  for (const { effect: e } of effs) if (e.kind === 'type_proficiency') mods.extraTypes.push(...(e.moveTypes || []));

  for (const { ability, effect: e } of effs) {
    if (!_filterOk(e.filter, move, ctx())) continue;
    switch (e.kind) {
      case 'attack_bonus':
        if (!e.filter) break; // move-independent -- already a virtual status (abilityStatuses)
        mods.attack += _amount(e.amount, p);
        mods.atkParts.push(`${ability} +${_amount(e.amount, p)}`);
        break;
      case 'damage_mod':
        if (!info.damaging) break;
        if (e.flatBonus != null) { const v = _amount(e.flatBonus, p); mods.damageFlat += v; mods.dmgParts.push(`${ability} ${v >= 0 ? '+' : ''}${v}`); }
        if (e.diceMultiplier) { mods.diceMultiplier *= e.diceMultiplier; mods.dmgParts.push(`${ability} ×${e.diceMultiplier} dice`); }
        if (e.extraDice) { const d = _scaledDice(e, Number(p?.level) || 1); mods.extraDice.push(d); mods.dmgParts.push(`${ability} +${d}${e.damageType ? ` ${e.damageType}` : ''}`); }
        if (e.totalMultiplier) mods.notes.push(`${ability}: ${e.totalMultiplier === 0.5 ? 'halve' : `×${e.totalMultiplier}`} the total damage`);
        if (e.rerollKeep) mods.notes.push(`${ability}: roll the damage twice and keep ${e.rerollKeep === 'higher' ? 'the higher' : 'either'} total`);
        break;
      case 'stab_mod':
        if (e.grant) break; // Tough Claws -- computeMoveData already handles it
        if (e.multiplier) { mods.stabMultiplier *= e.multiplier; mods.dmgParts.push(`${ability} STAB ×${e.multiplier}`); }
        break;
      case 'vp_cost_mod':
        if (e.multiplier) { mods.vpMultiplier *= e.multiplier; mods.notes.push(`${ability}: costs ×${e.multiplier} VP`); }
        break;
      case 'save_dc_bonus':
        mods.dcBonus += _amount(e.amount, p);
        break;
      case 'crit_dice_multiplier':
        mods.notes.push(`${ability}: on a critical hit, triple the dice instead of doubling`);
        break;
      default: break;
    }
  }
  return mods;
}

// --- one move against one target ------------------------------------------------------------------------------------

/** Damage that depends on who's hit -- the attacker's target-gated damage_mods (Merciless, Rivalry, Magnet Pull, Toxic
 * Surge, Honorable, Prey Stalker, Solvent Tail) -- plus the defender's crit/reroll reminders. `typeMultiplier` (if
 * known) lets superEffective filters match. Returns { flat, notes } -- `flat` is added to the damage total. */
export function targetAbilityDamage(attacker, target, move, { type, damaging = true, melee = false, typeMultiplier = null } = {}) {
  const out = { flat: 0, notes: [] };
  if (!attacker || !target || !move) return out;
  for (const { ability, effect: e } of abilityEffectsOf(attacker)) {
    if (e.kind !== 'damage_mod' || !_isPassiveSelf(e)) continue;
    const f = e.filter || {};
    const needsTarget = _needsTarget(e) || f.superEffective;
    if (!needsTarget) continue; // already in the move popup's numbers
    if (!_gatesHold(attacker, e, target)) continue;
    if (f.superEffective && !(typeMultiplier > 1)) continue;
    if (f.damaging && !damaging) continue;
    if (f.melee && !melee) continue;
    if (f.moveTypes && !f.moveTypes.map(t => t.toLowerCase()).includes(String(type || '').toLowerCase())) continue;
    if (e.flatBonus != null) { const v = _amount(e.flatBonus, attacker); out.flat += v; out.notes.push(`${ability}: ${v >= 0 ? '+' : ''}${v} damage (added)`); }
    if (e.diceMultiplier) out.notes.push(`${ability}: roll ×${e.diceMultiplier} the damage dice`);
    if (e.extraDice) out.notes.push(`${ability}: add ${_scaledDice(e, Number(attacker.level) || 1)}${e.damageType ? ` ${e.damageType}` : ''} to the damage roll`);
    if (e.totalMultiplier) out.notes.push(`${ability}: ${e.totalMultiplier === 0.5 ? 'halve' : `×${e.totalMultiplier}`} the total damage`);
    if (e.rerollKeep) out.notes.push(`${ability}: roll the damage twice and keep the ${e.rerollKeep === 'higher' ? 'higher' : 'better'} total`);
  }
  for (const { ability, effect: e } of abilityEffectsOf(target)) {
    if (!_isPassiveSelf(e) || !_gatesHold(target, e, null)) continue;
    if (e.kind === 'immunity' && e.critDamage) out.notes.push(`${target.name}'s ${ability}: a critical hit does no extra damage -- roll the normal dice`);
    if (e.kind === 'damage_taken_mod' && e.filter?.crit && e.maxDamage) out.notes.push(`${target.name}'s ${ability}: a critical hit against it deals maximum damage`);
    if (e.kind === 'damage_taken_mod' && e.rerollKeep === 'lower' && typeMultiplier > 1) out.notes.push(`${target.name}'s ${ability}: roll the damage twice and use the lower result`);
  }
  return out;
}

/** Magic Guard: a save-for-half move does nothing to this creature on a passed save. Returns the ability name or null. */
export function noDamageOnPassedSave(p) {
  const hit = abilityEffectsOf(p).find(({ effect: e }) => e.kind === 'damage_taken_mod' && e.filter?.saveForHalf && e.multiplier === 0
    && _isPassiveSelf(e) && _gatesHold(p, e, null));
  return hit ? hit.ability : null;
}
