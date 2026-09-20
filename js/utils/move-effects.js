// Pure helpers for the structured move `effects` (schema: pi-server/docs/
// move-effects-schema.md) -- deciding which effects a resolved attack/save
// triggered, describing them, and turning one into an apply-status payload.
// No DOM, no API calls: the popups and combat-wip.js do the talking, this only
// answers questions, so it can be exercised in isolation.

const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

/** A participant's saving-throw modifier for `ability` ("STR"..."CHA"): the
 * ability modifier plus proficiency when its `savingThrows` list names that
 * ability. null when the participant has no ability data (a DM's freeform
 * enemy) -- the caller then just asks for the total instead. */
export function saveModifierFor(participant, ability) {
  if (!participant || !ability) return null;
  const key = String(ability).toLowerCase();
  if (!ABILITY_KEYS.includes(key)) return null;
  const mod = participant[`${key}Mod`];
  if (mod === null || mod === undefined || Number.isNaN(Number(mod))) return null;
  const proficient = String(participant.savingThrows || '').toLowerCase()
    .split(/[,;/\s]+/).some(s => s && s.startsWith(key));
  return Number(mod) + (proficient ? (Number(participant.proficiency) || 0) : 0);
}

/** Lowest natural d20 that counts as a critical hit: 20 by default, lowered by
 * the attacker's crit modifier and by 1 for moves tagged base_crit ("crits on
 * 19-20"). Never below 2. */
export function critThreshold(critMod = 0, baseCrit = false) {
  return Math.max(2, 20 - (Number(critMod) || 0) - (baseCrit ? 1 : 0));
}

function _requirementMet(requires, ctx) {
  if (!requires) return true;
  if (requires === 'hit') return !!ctx.hit;
  if (requires === 'crit') return !!ctx.hit && !!ctx.crit;
  if (requires.type === 'natural_roll') return !!ctx.hit && ctx.attackRoll != null && ctx.attackRoll >= requires.min;
  return true;
}

/** Did this resolved attack/save trigger `effect`? ctx = {hit, attackRoll (the
 * natural d20, null if none was entered), crit, guaranteedHit, save: {passed,
 * failBy} | null}. Returns:
 *   'yes'        triggered -- offer it (pre-selected)
 *   'needs_save' would trigger on a failed save that hasn't been rolled yet
 *   'manual'     the move text can't be decided from what was recorded (a
 *                special condition, or a roll that wasn't entered) -- offer it
 *                unselected and let a human judge
 *   'no'         didn't trigger */
export function evaluateEffect(effect, ctx) {
  const w = effect.when || {};
  const hit = !!ctx.hit;
  switch (w.type) {
    case 'always':
      return 'yes';
    case 'on_hit':
      return hit ? 'yes' : 'no';
    case 'natural_roll':
      if (!hit || ctx.guaranteedHit) return 'no';
      if (ctx.attackRoll === null || ctx.attackRoll === undefined) return 'manual';
      return ctx.attackRoll >= w.min ? 'yes' : 'no';
    case 'crit':
      if (!hit) return 'no';
      if (ctx.crit === undefined) return 'manual';
      return ctx.crit ? 'yes' : 'no';
    case 'save_fail': {
      if (!_requirementMet(w.requires, ctx)) return 'no';
      if (!ctx.save) return 'needs_save';
      if (ctx.save.passed) return 'no';
      if (w.failBy) {
        if (ctx.save.failBy === null || ctx.save.failBy === undefined) return 'manual';
        if (ctx.save.failBy < w.failBy) return 'no';
      }
      return 'yes';
    }
    default:
      return 'manual';
  }
}

const ON_TEXT = {
  attack_rolls: 'attack rolls',
  attacks_against: 'attacks against it',
  saving_throws: 'saving throws',
  saves_against_its_moves: 'saves against its moves',
  ability_checks: 'ability checks',
  all_rolls: 'all rolls',
};

function _title(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

/** Short display name for a status or an effect: "Burned", "AC -2", "Speed set
 * to 0", "Disadvantage on attack rolls". Stacks (stored statuses only) scale
 * the amount. */
export function statusLabel(s) {
  if (s.kind === 'condition') {
    if (s.apply === 'type_changed' && s.value) return `Type changed to ${s.value}`;
    return _title(String(s.apply || '').replace(/_/g, ' '));
  }
  if (s.kind === 'stat') {
    const stat = s.stat === 'ac' ? 'AC' : _title(String(s.stat || '').replace(/_/g, ' '));
    if (s.set !== undefined) return `${stat} set to ${s.set}`;
    if (s.amount === 'proficiency') return `${stat} + proficiency`;
    if (typeof s.amount === 'number') {
      const total = s.amount * (s.stacks || 1);
      return `${stat} ${total >= 0 ? '+' : '-'}${Math.abs(total)}`;
    }
    return stat;
  }
  return `${_title(s.roll)} on ${ON_TEXT[s.on] || String(s.on || '').replace(/_/g, ' ')}`;
}

const TIMING_TEXT = { start_of_turn: 'start of its turn', end_of_turn: 'end of its turn', action: 'as an action' };

/** One `ends` entry as a phrase for the popup / badge detail. */
export function describeEnd(e) {
  switch (e.type) {
    case 'rounds':
      if (e.n) return `${e.n} round${e.n === 1 ? '' : 's'}`;
      return `${e.dice}${e.unit ? ' ' + e.unit + 's' : ' rounds'}`;
    case 'until_turn': {
      const who = e.whose === 'source' ? "the user's" : 'its';
      const count = e.count > 1 ? ` (${e.count} turns)` : '';
      return `${e.point === 'start' ? 'start' : 'end'} of ${who} next turn${count}`;
    }
    case 'save': return `${e.ability} save (${TIMING_TEXT[e.timing] || e.timing})`;
    case 'concentration': return 'while concentrating';
    case 'encounter': return 'rest of the battle';
    case 'long_rest': return 'until a long rest';
    case 'uses': return e.left != null ? `${e.left} use${e.left === 1 ? '' : 's'} left` : `next ${e.n === 1 ? 'use' : e.n + ' uses'}`;
    case 'instant': return 'instant';
    default: return e.text || e.type;
  }
}

// ---------------------------------------------------------------------------
// Live modifiers: what a participant's stored statuses (see routes_combat.py's
// `statuses`) do to a roll that's about to be made. Pure -- the pickers show the
// result and add it to the totals, the human still rolls the dice (so advantage /
// disadvantage is a banner: "roll twice"), and any status that lasts "the next
// attack/roll" is reported in `consume` for the picker to use up once the roll
// is confirmed.
// ---------------------------------------------------------------------------

const _stackCount = (s) => s.stacks || 1;
const _hasUses = (s) => (s.ends || []).some(e => e.type === 'uses');
const _sourceText = (s) => `${statusLabel(s)} from ${s.moveName || 'an effect'}`;

/** A stat status's numeric amount (stacks applied); 'proficiency' = the holder's bonus. */
function _statAmount(s, holder) {
  if (s.amount === 'proficiency') return Number(holder?.proficiency) || 0;
  return typeof s.amount === 'number' ? s.amount * _stackCount(s) : 0;
}

/** {mode, notes, consume} shared by both contexts: advantage and disadvantage from
 * different sources cancel to a normal roll (the notes still list them). */
function _finish(ctx, adv, dis) {
  ctx.mode = adv.length && dis.length ? 'normal' : adv.length ? 'advantage' : dis.length ? 'disadvantage' : 'normal';
  if (adv.length && dis.length) ctx.notes.push('Advantage and disadvantage cancel out — roll once');
  ctx.advantage = adv;
  ctx.disadvantage = dis;
  const seen = new Set();
  ctx.consume = ctx.consume.filter(c => (seen.has(c.statusId) ? false : seen.add(c.statusId)));
  return ctx;
}

/** Modifiers for an attack roll by `attacker` against `target` (participant records,
 * either may be missing): the attacker's attack-roll bonus/penalty and advantage/
 * disadvantage, the target's AC change and attacks-against advantage/disadvantage. */
export function attackRollContext(attacker, target) {
  const ctx = { attackBonus: 0, acDelta: 0, mode: 'normal', notes: [], consume: [] };
  const adv = [], dis = [];
  const take = (s, holder, list) => {
    list.push(s);
    ctx.notes.push(_sourceText(s));
    if (_hasUses(s)) ctx.consume.push({ holderId: holder.id, statusId: s.id });
  };
  for (const s of attacker?.statuses || []) {
    if (s.kind === 'roll' && (s.on === 'attack_rolls' || s.on === 'all_rolls')) take(s, attacker, s.roll === 'advantage' ? adv : dis);
    if (s.kind === 'stat' && s.stat === 'attack_rolls') {
      const a = _statAmount(s, attacker);
      ctx.attackBonus += a;
      ctx.notes.push(_sourceText(s));
      if (_hasUses(s)) ctx.consume.push({ holderId: attacker.id, statusId: s.id });
    }
  }
  for (const s of target?.statuses || []) {
    // (a target's own all_rolls status affects ITS rolls, not attacks against it)
    if (s.kind === 'roll' && s.on === 'attacks_against') take(s, target, s.roll === 'advantage' ? adv : dis);
    if (s.kind === 'stat' && s.stat === 'ac') {
      const a = _statAmount(s, target);
      ctx.acDelta += a;
      ctx.notes.push(_sourceText(s));
    }
  }
  return _finish(ctx, adv, dis);
}

const _STEP = (score) => Math.floor((score - 10) / 2);
const _SCORE_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

/** What a participant's live stat statuses currently add to AC and each ability score:
 * {ac, str, dex, con, int, wis, cha} (0 where nothing applies). all_abilities counts
 * for all six; stacks multiply; `set` (speed) and `proficiency` amounts don't belong here. */
export function statDeltas(participant) {
  const d = { ac: 0, str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };
  for (const s of participant?.statuses || []) {
    if (s.kind !== 'stat' || typeof s.amount !== 'number') continue;
    const amount = s.amount * _stackCount(s);
    if (s.stat === 'ac') d.ac += amount;
    else if (s.stat === 'all_abilities') _SCORE_KEYS.forEach(k => { d[k] += amount; });
    else if (_SCORE_KEYS.includes(s.stat)) d[s.stat] += amount;
  }
  return d;
}

/** Moves a LOCAL combatant's AC / ability scores (the card's current values, which the
 * Modify Stats buttons also edit) from the status deltas last applied (`prev`) to `next`,
 * so manual edits stay and a removed status gives its points back. An ability's modifier
 * moves by the change in its floor((score-10)/2) step -- a sheet-provided modifier that
 * differs from the formula keeps its offset. Records `next` as `appliedStatMods` (the card
 * shows it). Mutates and returns `c`. */
export function reapplyStatDeltas(c, prev, next) {
  for (const key of ['ac', ..._SCORE_KEYS]) {
    const d = (next[key] || 0) - (prev?.[key] || 0);
    if (!d || !Number.isFinite(c[key])) continue;
    const old = c[key];
    c[key] = old + d;
    if (key !== 'ac') {
      const modKey = `${key}Mod`;
      c[modKey] = (Number(c[modKey]) || 0) + _STEP(c[key]) - _STEP(old);
    }
  }
  c.appliedStatMods = { ...next };
  return c;
}

/** The values other players should see for a LOCAL combatant: its AC, ability scores and
 * modifiers with the live status deltas taken back out (`appliedStatMods`), plus its crit
 * modifier. Their popups add the live statuses on top themselves (effectiveStats /
 * attackRollContext), so sending the card's already-buffed numbers would count every
 * effect twice. Only finite numbers are included. */
export function baseStats(c) {
  const applied = c.appliedStatMods || {};
  const out = {};
  if (Number.isFinite(c.ac)) out.ac = c.ac - (applied.ac || 0);
  for (const k of _SCORE_KEYS) {
    if (!Number.isFinite(c[k])) continue;
    const baseScore = c[k] - (applied[k] || 0);
    out[k] = baseScore;
    const modKey = `${k}Mod`;
    if (Number.isFinite(c[modKey])) out[modKey] = c[modKey] - (_STEP(c[k]) - _STEP(baseScore));
  }
  if (Number.isFinite(c.critMod)) out.critMod = c.critMod;
  return out;
}

/** A copy of a SERVER participant record with its live stat statuses applied to AC,
 * ability scores and their modifiers -- for anything computed from the record (a Move
 * DC, a target's AC) rather than from a card. Records without a stat block pass through. */
export function effectiveStats(participant) {
  const d = statDeltas(participant);
  const out = { ...participant };
  if (Number.isFinite(out.ac)) out.ac += d.ac;
  for (const k of _SCORE_KEYS) {
    if (!d[k] || !Number.isFinite(out[k])) continue;
    const modKey = `${k}Mod`;
    out[modKey] = (Number(out[modKey]) || 0) + _STEP(out[k] + d[k]) - _STEP(out[k]);
    out[k] += d[k];
  }
  return out;
}

/** The score change an ability gets from `saver`'s stat statuses (its own stat or all_abilities). */
function _abilityScoreDelta(saver, ability) {
  return statDeltas(saver)[String(ability || '').toLowerCase()] || 0;
}

/** Modifiers for `saver`'s saving throw (`ability` "STR".."CHA" or null) against a
 * move used by `moveUser`: the saver's own saving-throw bonuses and advantage/
 * disadvantage, its ability-score changes (as a change in the modifier), and the
 * move user's "saves against its moves" advantage/disadvantage (Night Daze). */
export function saveRollContext(saver, moveUser, ability) {
  const ctx = { modifierDelta: 0, mode: 'normal', notes: [], consume: [] };
  const adv = [], dis = [];
  const take = (s, holder, list) => {
    list.push(s);
    ctx.notes.push(_sourceText(s));
    if (_hasUses(s)) ctx.consume.push({ holderId: holder.id, statusId: s.id });
  };
  for (const s of saver?.statuses || []) {
    if (s.kind === 'roll' && (s.on === 'saving_throws' || s.on === 'all_rolls')) take(s, saver, s.roll === 'advantage' ? adv : dis);
    if (s.kind === 'stat' && s.stat === 'saving_throws') {
      const a = _statAmount(s, saver);
      ctx.modifierDelta += a;
      ctx.notes.push(_sourceText(s));
    }
  }
  const scoreDelta = ability ? _abilityScoreDelta(saver, ability) : 0;
  if (scoreDelta) {
    const base = Number(saver?.[String(ability).toLowerCase()]);
    // A score change moves the modifier by the difference of the floor((score-10)/2) steps.
    if (Number.isFinite(base)) {
      const step = (n) => Math.floor((n - 10) / 2);
      const d = step(base + scoreDelta) - step(base);
      ctx.modifierDelta += d;
      ctx.notes.push(`${ability} score ${scoreDelta > 0 ? '+' : ''}${scoreDelta} → modifier ${d >= 0 ? '+' : ''}${d}`);
    }
  }
  for (const s of moveUser?.statuses || []) {
    if (s.kind === 'roll' && s.on === 'saves_against_its_moves') take(s, moveUser, s.roll === 'advantage' ? adv : dis);
  }
  return _finish(ctx, adv, dis);
}

/** "Roll with ADVANTAGE (roll twice, keep the higher)" etc., or '' for a normal roll. */
export function rollModeText(mode) {
  if (mode === 'advantage') return 'Roll with ADVANTAGE — roll twice, keep the higher';
  if (mode === 'disadvantage') return 'Roll with DISADVANTAGE — roll twice, keep the lower';
  return '';
}

/** The holder's statuses that end on a repeat saving throw at `timing`
 * ('start_of_turn' | 'end_of_turn') -- what to prompt for when that turn point
 * comes up. 'action' saves are never prompted (the holder chooses to spend the
 * action; the badge's detail popup has the button). */
export function pendingTurnSaves(participant, timing) {
  return (participant?.statuses || []).filter(s =>
    (s.ends || []).some(e => e.type === 'save' && e.timing === timing));
}

/** describeEnds for a STORED status: a rounds end shows how many are left in the
 * current `round` ("3 rounds left"), the rest read as in describeEnd. */
export function describeStatusEnds(status, round) {
  const ends = status.ends || [];
  if (!ends.length) return 'until removed';
  return ends.map(e => {
    if (e.type === 'rounds' && e.expiresRound != null && round != null) {
      const left = Math.max(0, e.expiresRound - round);
      return `${left} round${left === 1 ? '' : 's'} left`;
    }
    return describeEnd(e);
  }).join(', or ');
}

/** "10 rounds, or WIS save (end of its turn)" -- or 'until removed' when the
 * move text states no end (the holder's table removes it by hand). */
export function describeEnds(ends) {
  if (!ends || !ends.length) return 'until removed';
  return ends.map(describeEnd).join(', or ');
}

/** The apply-status payload for `effect`. `ends` is the effect's own list unless
 * the caller already resolved rolled durations (a {dice} entry given an `n`). */
export function buildStatusSpec(effect, { sourceId, sourceName, moveName, dc, ends }) {
  const spec = { kind: effect.kind, sourceId, sourceName, moveName, dc, ends: ends || effect.ends || [] };
  for (const k of ['apply', 'value', 'stat', 'amount', 'set', 'roll', 'on', 'note']) {
    if (effect[k] !== undefined) spec[k] = effect[k];
  }
  if (effect.stacks) spec.stacks = effect.stacks;
  return spec;
}

/** Splits triggered effects into what the popup needs: standalone rows, random-
 * table groups (one row applies, chosen by the die roll a human types in), and
 * "chosen" groups (the user picks one). Group key = same die/kind + same trigger. */
export function groupEffects(entries) {
  const rows = [];
  const groups = new Map();
  for (const entry of entries) {
    const c = entry.effect.choice;
    if (!c) { rows.push({ type: 'row', entry }); continue; }
    const key = `${c.kind}:${c.die || ''}:${JSON.stringify(entry.effect.when)}`;
    if (!groups.has(key)) {
      const g = { type: c.kind === 'random' ? 'random' : 'chosen', die: c.die, entries: [] };
      groups.set(key, g);
      rows.push(g);
    }
    groups.get(key).entries.push(entry);
  }
  return rows;
}
