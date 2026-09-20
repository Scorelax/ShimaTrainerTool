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
