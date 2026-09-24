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
    if (s.apply === 'type_changed' && s.value) return `Type changed to ${s.value2 ? `${s.value}/${s.value2}` : s.value}`;
    if (s.apply === 'resistance_upgrade') return `Resistance upgraded (${s.value === 'all' ? 'all types' : s.value || ''})`;
    if (s.apply === 'granted_immunity') return `Immune to ${s.value || ''}`;
    return _title(String(s.apply || '').replace(/_/g, ' '));
  }
  if (s.kind === 'temp_hp') {
    return s.remaining !== undefined ? `${s.remaining} temporary HP left` : 'Temporary HP';
  }
  if (s.kind === 'reroll_damage') {
    return 'Reroll their damage, take the lower';
  }
  if (s.kind === 'block_attack') {
    return 'Block the attack entirely';
  }
  if (s.kind === 'prevent_faint') {
    return 'Fall to 1 HP instead of fainting';
  }
  if (s.kind === 'heal') {
    const pool = s.amount?.pool === 'VP' ? ' VP' : '';
    const repeatNote = s.repeat ? ` (${s.repeat === 'start_of_turn' ? 'start' : 'end'} of turn, while active)` : '';
    if (s.amount?.fractionOfDamage) return `Heal ${Math.round(s.amount.fractionOfDamage * 100)}% of damage dealt${pool}${repeatNote}`;
    if (s.amount?.levelMultiple) return `Heal ${s.amount.levelMultiple}x level${pool}${repeatNote}`;
    if (s.amount?.dice) return `Heal ${s.amount.dice}${s.amount.moveMod ? ' + MOVE' : ''}${pool}${repeatNote}`;
    return `Heal${pool}${repeatNote}`;
  }
  if (s.kind === 'stat') {
    let stat = s.stat === 'ac' ? 'AC'
      : s.stat === 'crit' ? 'Crit range'
      : s.stat === 'attack_rolls_or_saving_throws' ? 'an attack roll or saving throw'
      : _title(String(s.stat || '').replace(/_/g, ' '));
    // Hammer Arm's "disadvantage on DEX saves" -- see _abilityMatches's own
    // docstring; only saving_throws is ever this narrow.
    if (s.stat === 'saving_throws' && s.ability) stat = `${s.ability} ${stat.toLowerCase()}`;
    if (s.set !== undefined) return `${stat} set to ${s.set}`;
    if (s.amount === 'proficiency') return `${stat} + proficiency`;
    if (s.amount && typeof s.amount === 'object' && s.amount.dice) return `Add ${s.amount.dice} to ${stat}`;
    if (typeof s.amount === 'number') {
      const total = s.amount * (s.stacks || 1);
      return `${stat} ${total >= 0 ? '+' : '-'}${Math.abs(total)}`;
    }
    return stat;
  }
  const onText = s.on === 'saving_throws' && s.ability ? `${s.ability} saving throws` : (ON_TEXT[s.on] || String(s.on || '').replace(/_/g, ' '));
  return `${_title(s.roll)} on ${onText}`;
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

/** Does the participant have to actively choose to spend this bonus (rolled at the
 * table when they use it), rather than it being folded into every roll automatically?
 * `amount: {dice: "1d4"}` in place of a flat number or 'proficiency' (Sharpen, Growth,
 * Aromatic Mist, Helping Hand) -- see diceBonusOptionsFor. */
const _isDiceAmount = (s) => !!(s.amount && typeof s.amount === 'object' && s.amount.dice);

/** True for a status that ends with concentration -- the badge UI groups these
 * together under one "Concentration" umbrella instead of showing each separately. */
export const isConcentration = (s) => (s?.ends || []).some(e => e.type === 'concentration');

/** A stat status's numeric amount (stacks applied); 'proficiency' = the holder's bonus.
 * A dice-based amount (see _isDiceAmount) never contributes here -- it's spent by
 * choice through the roll popup's own button, not automatic. */
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
    if (s.kind === 'stat' && s.stat === 'attack_rolls' && !_isDiceAmount(s)) {
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

// AC and crit modifier both apply as a flat delta straight to the field -- unlike an
// ability score, neither one has a separately-derived modifier to also update.
const _FLAT_KEYS = ['ac', 'crit'];
const _FLAT_FIELD = { ac: 'ac', crit: 'critMod' };

/** What a participant's live stat statuses currently add to AC, crit modifier, and each
 * ability score: {ac, crit, str, dex, con, int, wis, cha} (0 where nothing applies).
 * all_abilities counts for all six; stacks multiply; a `set` effect has no `amount` at
 * all (see statSetOverrides) so it's already skipped here by construction. */
export function statDeltas(participant) {
  const d = { ac: 0, crit: 0, str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };
  for (const s of participant?.statuses || []) {
    if (s.kind !== 'stat' || typeof s.amount !== 'number') continue;
    const amount = s.amount * _stackCount(s);
    if (s.stat === 'ac' || s.stat === 'crit') d[s.stat] += amount;
    else if (s.stat === 'all_abilities') _SCORE_KEYS.forEach(k => { d[k] += amount; });
    else if (_SCORE_KEYS.includes(s.stat)) d[s.stat] += amount;
  }
  return d;
}

/** What a participant's live stat statuses currently FORCE to an exact value via `set`
 * (Superpower's "STR and DEX set to 10", Guard Split's AC averaged with the target,
 * Power Trick's AC<->score swap): {key: value}, only present for a field an active
 * override actually targets. Unlike statDeltas these REPLACE the field instead of
 * shifting it (see reapplyStatDeltas/effectiveStats). The number is resolved once, at
 * apply time (see combat-wip.js's _resolveSetOverrides) -- Guard Split's "average with
 * the target" is never re-derived here, this just reads whatever concrete number the
 * status was given when it was applied. Last status in the list wins if more than one
 * targets the same field (rare -- matches a newer status visually replacing an older
 * badge everywhere else in this schema). */
export function statSetOverrides(participant) {
  const out = {};
  for (const s of participant?.statuses || []) {
    if (s.kind !== 'stat' || s.set === undefined) continue;
    if (_FLAT_KEYS.includes(s.stat) || _SCORE_KEYS.includes(s.stat)) out[s.stat] = s.set;
  }
  return out;
}

/** Moves a LOCAL combatant's AC / crit modifier / ability scores (the card's current
 * values, which the Modify Stats buttons also edit) from the status deltas last applied
 * (`prev`) to `next`, so manual edits stay and a removed status gives its points back. An
 * ability's modifier moves by the change in its floor((score-10)/2) step -- a sheet-
 * provided modifier that differs from the formula keeps its offset; AC/crit apply
 * directly, no derived field to update. Records `next` as `appliedStatMods` (the card
 * shows it). Mutates and returns `c`.
 *
 * `next.set` (and `prev.set`, both from statSetOverrides) carry any active `set`
 * overrides alongside the ordinary additive deltas -- a field under one gets FORCED to
 * that exact value instead of shifted, with the true pre-override value (and, for a
 * score, its modifier) snapshotted onto `c._preSetBase`/`_preSetBaseMod` the moment the
 * override starts and restored -- then the round's own delta applied on top of THAT --
 * the moment it ends. A plain statDeltas() result with no `.set` at all behaves exactly
 * as before (every existing caller). */
export function reapplyStatDeltas(c, prev, next) {
  const prevSet = prev?.set || {};
  const nextSet = next.set || {};
  if (Object.keys(nextSet).length || Object.keys(prevSet).length) {
    c._preSetBase = c._preSetBase || {};
    c._preSetBaseMod = c._preSetBaseMod || {};
  }
  for (const key of [..._FLAT_KEYS, ..._SCORE_KEYS]) {
    const field = _FLAT_FIELD[key] || key;
    if (!Number.isFinite(c[field])) continue;
    const modKey = `${key}Mod`;
    const hadOverride = key in prevSet;
    const hasOverride = key in nextSet;
    if (hasOverride) {
      if (!hadOverride) {
        // Snapshot the TRUE pre-override base to restore to later -- not just c[field]
        // as it stands right now, which could still carry an ordinary delta that's
        // ALSO ending this exact same round (e.g. a +2 AC buff expiring the same round
        // Guard Split's set-override begins): apply that delta's own arrival/departure
        // first, so the snapshot reflects reality instead of resurrecting a delta that
        // actually left at the same moment the override arrived.
        const deltaAdjusted = c[field] + (next[key] || 0) - (prev?.[key] || 0);
        c._preSetBase[key] = deltaAdjusted;
        if (!_FLAT_KEYS.includes(key)) c._preSetBaseMod[key] = c[modKey] + _STEP(deltaAdjusted) - _STEP(c[field]);
      }
      c[field] = nextSet[key];
      if (!_FLAT_KEYS.includes(key)) c[modKey] = _STEP(c[field]);
      continue;
    }
    let old = c[field];
    if (hadOverride) {
      // override just ended -- restore the pre-override base/mod, then this round's own
      // delta (if any) still applies on top of that, same as the normal path below.
      c[field] = c._preSetBase[key];
      if (!_FLAT_KEYS.includes(key)) c[modKey] = c._preSetBaseMod[key];
      old = c[field];
      delete c._preSetBase[key];
      delete c._preSetBaseMod[key];
    }
    const d = (next[key] || 0) - (hadOverride ? 0 : (prev?.[key] || 0));
    if (!d) continue;
    c[field] = old + d;
    if (!_FLAT_KEYS.includes(key)) {
      c[modKey] = (Number(c[modKey]) || 0) + _STEP(c[field]) - _STEP(old);
    }
  }
  c.appliedStatMods = { ...next };
  return c;
}

/** The values other players should see for a LOCAL combatant: its AC, crit modifier,
 * ability scores and modifiers, with the live status deltas taken back out
 * (`appliedStatMods`). Their popups add the live statuses on top themselves
 * (effectiveStats / attackRollContext), so sending the card's already-buffed numbers
 * would count every effect twice. Only finite numbers are included. A field currently
 * under a `set` override (see reapplyStatDeltas) reports the snapshotted pre-override
 * value instead of doing delta subtraction -- other clients apply the same override
 * themselves from the shared status list (statSetOverrides), so sending the forced
 * number here would double it up rather than cancel out. */
export function baseStats(c) {
  const applied = c.appliedStatMods || {};
  const appliedSet = applied.set || {};
  const out = {};
  for (const key of _FLAT_KEYS) {
    const field = _FLAT_FIELD[key];
    if (!Number.isFinite(c[field])) continue;
    out[field] = key in appliedSet ? (c._preSetBase?.[key] ?? c[field]) : c[field] - (applied[key] || 0);
  }
  for (const k of _SCORE_KEYS) {
    if (!Number.isFinite(c[k])) continue;
    const modKey = `${k}Mod`;
    if (k in appliedSet) {
      out[k] = c._preSetBase?.[k] ?? c[k];
      if (Number.isFinite(c[modKey])) out[modKey] = c._preSetBaseMod?.[k] ?? c[modKey];
      continue;
    }
    const baseScore = c[k] - (applied[k] || 0);
    out[k] = baseScore;
    if (Number.isFinite(c[modKey])) out[modKey] = c[modKey] - (_STEP(c[k]) - _STEP(baseScore));
  }
  return out;
}

/** A copy of a SERVER participant record with its live stat statuses applied to AC, crit
 * modifier, ability scores and their modifiers -- for anything computed from the record
 * (a Move DC, a target's AC, whether a roll crits) rather than from a card. Records
 * without a stat block pass through. A field under a `set` override (statSetOverrides)
 * is forced to that exact value -- overriding any delta on the same field entirely,
 * rather than adding to it -- with a score's modifier recomputed straight from the
 * formula (no offset to preserve here, there's no "prior" value in a snapshot-free
 * read like this one). */
export function effectiveStats(participant) {
  const d = statDeltas(participant);
  const setOv = statSetOverrides(participant);
  const out = { ...participant };
  for (const key of _FLAT_KEYS) {
    const field = _FLAT_FIELD[key];
    if (!Number.isFinite(out[field])) continue;
    if (key in setOv) { out[field] = setOv[key]; continue; }
    if (d[key]) out[field] += d[key];
  }
  for (const k of _SCORE_KEYS) {
    if (!Number.isFinite(out[k])) continue;
    const modKey = `${k}Mod`;
    if (k in setOv) { out[k] = setOv[k]; out[modKey] = _STEP(setOv[k]); continue; }
    if (!d[k]) continue;
    out[modKey] = (Number(out[modKey]) || 0) + _STEP(out[k] + d[k]) - _STEP(out[k]);
    out[k] += d[k];
  }
  return out;
}

/** The score change an ability gets from `saver`'s stat statuses (its own stat or all_abilities). */
function _abilityScoreDelta(saver, ability) {
  return statDeltas(saver)[String(ability || '').toLowerCase()] || 0;
}

/** True unless `s` carries its own `ability` field that doesn't match the save
 * actually being rolled (Hammer Arm's "disadvantage on DEX saves" -- narrower
 * than a plain `saving_throws` roll/stat effect, which applies to every
 * ability). No `ability` on the effect = applies broadly, same as before this
 * field existed. `all_rolls` is never ability-scoped -- only checked for
 * `saving_throws` specifically, see its two call sites below. */
function _abilityMatches(s, ability) {
  return !s.ability || s.ability === ability;
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
    if (s.kind === 'roll' && s.on === 'all_rolls') take(s, saver, s.roll === 'advantage' ? adv : dis);
    if (s.kind === 'roll' && s.on === 'saving_throws' && _abilityMatches(s, ability)) take(s, saver, s.roll === 'advantage' ? adv : dis);
    if (s.kind === 'stat' && s.stat === 'saving_throws' && _abilityMatches(s, ability) && !_isDiceAmount(s)) {
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

/** `holder`'s dice-based stat bonuses (amount: {dice}) that apply to `rollType`
 * ('attack_rolls' | 'saving_throws') -- unlike a flat/proficiency amount these are
 * never automatic (see _isDiceAmount): the picker offers a button per option, the
 * player rolls the die themselves and types the result in, and only then is it
 * added to the total. `stat: 'attack_rolls_or_saving_throws'` (Growth, Helping
 * Hand) is eligible for either roll type from the SAME status -- using it on one
 * consumes it for both. `consumable` mirrors the status's own `ends` (a `uses` end
 * means the picker should call use-status once it's actually spent; no `uses` means
 * it stays available -- Sharpen/Growth/Aromatic Mist last for their own duration
 * and can be used again on a later roll). */
export function diceBonusOptionsFor(holder, rollType) {
  return (holder?.statuses || [])
    .filter(s => s.kind === 'stat' && _isDiceAmount(s) && (s.stat === rollType || s.stat === 'attack_rolls_or_saving_throws'))
    .map(s => ({ statusId: s.id, holderId: holder.id, moveName: s.moveName || 'Effect', dice: s.amount.dice, consumable: _hasUses(s) }));
}

/** "Roll with ADVANTAGE (roll twice, keep the higher)" etc., or '' for a normal roll. */
export function rollModeText(mode) {
  if (mode === 'advantage') return 'Roll with ADVANTAGE — roll twice, keep the higher';
  if (mode === 'disadvantage') return 'Roll with DISADVANTAGE — roll twice, keep the lower';
  return '';
}

/** How much temporary HP `participant` currently has (Acupressure's roll-of-3):
 * summed across any active `temp_hp` statuses (0 if none). This pool absorbs
 * incoming damage before real HP server-side (routes_combat.py's
 * _absorb_temp_hp) -- `remaining` is authoritative, never re-derived from
 * `amount` here, since it shrinks as damage lands. Shown next to the HP number
 * as a small light-blue "+N" tag (combat.js's renderCombatCard), the same
 * convention as a live stat buff's tag. */
export function tempHpRemaining(participant) {
  return (participant?.statuses || [])
    .filter(s => s.kind === 'temp_hp')
    .reduce((sum, s) => sum + (Number(s.remaining) || 0), 0);
}

/** The status id of an active "next attack auto-crits" flag (Laser Focus) on
 * `participant`, or null -- a small standalone condition, not a stat/roll effect:
 * "your first attack on your next turn always results in a critical hit" overrides
 * the normal crit-threshold roll AND the hit/miss check itself (the attack is
 * guaranteed to land, not just guaranteed to crit IF it lands) for exactly one
 * attack, so this doesn't fit statDeltas/statSetOverrides at all. Consumed
 * (use-status) once that attack is actually resolved -- see combat-wip.js's
 * _handleDamageResolved/_resolveOneHit. */
export function guaranteedCritStatusId(participant) {
  return (participant?.statuses || []).find(s => s.kind === 'condition' && s.apply === 'guaranteed_next_crit')?.id || null;
}

/** The holder's statuses that end on a repeat saving throw at `timing`
 * ('start_of_turn' | 'end_of_turn') -- what to prompt for when that turn point
 * comes up. 'action' saves are never prompted (the holder chooses to spend the
 * action; the badge's detail popup has the button). */
export function pendingTurnSaves(participant, timing) {
  return (participant?.statuses || []).filter(s =>
    (s.ends || []).some(e => e.type === 'save' && e.timing === timing));
}

/** The holder's `heal` statuses that re-trigger at `timing` ('start_of_turn' |
 * 'end_of_turn') -- Aqua Ring/Ingrain's heal-over-time (see move-effects-
 * schema.md's `repeat` field). Always the HOLDER's own turn boundary -- a
 * delayed heal anchored to whoever CAST it (Wish's "at the end of MY next
 * turn") isn't a shape this covers yet. */
export function pendingTurnHeals(participant, timing) {
  return (participant?.statuses || []).filter(s => s.kind === 'heal' && s.repeat === timing);
}

/** "2d8" × 3 -> "6d8" -- the shown-dice-count half of a `damage_note` effect
 * (see move-effects-schema.md), shared by combat.js's own self-conditional
 * display (showCombatMoveDetails) and target-picker.js's target-conditional
 * one. Multiplying the leading number is the same arithmetic as rolling the
 * dice that many more times (same die size), which is what "double/triple
 * the dice" in this dataset's own move text consistently means. Any shape
 * that doesn't parse (there shouldn't be one -- computeMoveData's own
 * damageDice is always plain XdY) is returned unchanged rather than
 * guessed at. */
export function multiplyDiceString(dice, multiplier) {
  const m = /^(\d+)(d\d+)$/i.exec(dice || '');
  if (!m) return dice;
  return `${parseInt(m[1], 10) * multiplier}${m[2]}`;
}

/** Fraction of max HP (0..1), or null when either isn't a real number -- a
 * freeform PvE enemy with no stat block, most often. */
function _hpFraction(p) {
  const max = p?.maxHP;
  const cur = p?.currentHP;
  return Number.isFinite(max) && max > 0 && Number.isFinite(cur) ? cur / max : null;
}

function _hasCondition(p, applyNames) {
  return (p?.statuses || []).some(s => s.kind === 'condition' && (applyNames || []).includes(s.apply));
}

/** The fastest of a participant's own movement types (see combat-wip.js's
 * `speeds` field -- [{type, ft}, ...]), or null with none recorded --
 * Electro Ball's own "compare the target and user's highest speed type". */
function _maxSpeed(p) {
  const speeds = p?.speeds || [];
  if (!speeds.length) return null;
  return Math.max(...speeds.map(s => s.ft || 0));
}

// Heavy Slam's own size ordering -- the move's own text names it exactly
// this way ("Sizes, in order, are: Tiny, Small, Medium, Large, Huge,
// Gigantic"), the one canonical size scale this app has (participants'
// `size` field is otherwise freeform -- see footprintForSize).
const _SIZE_RANK = { tiny: 0, small: 1, medium: 2, large: 3, huge: 4, gigantic: 5 };

/** A participant's size RANK on Heavy Slam's own scale, not footprintForSize's
 * cruder Tiny/Small/Medium-vs-Large/Huge grid-footprint split -- blank or
 * unrecognized (including every trainer, who carries no `size` at all)
 * defaults to Medium, same "no size means ordinary humanoid-ish" convention
 * footprintForSize's own 1x1 default already uses. */
function _sizeRank(p) {
  const s = (p?.size || '').trim().toLowerCase();
  return _SIZE_RANK[s] ?? _SIZE_RANK.medium;
}

/** One `damage_note` effect's `condition` (see move-effects-schema.md), for
 * the TARGET-conditional half -- checked against `apply` values directly
 * (e.g. "poisoned"), unlike the self-conditional half's own evaluator
 * (combat.js's _evaluateDamageNotes), which matches legacy DISPLAY names
 * ("Poison") instead. Different on purpose: a self-conditional check reads
 * `c.statusEffects`, shaped the same whether `c` came from the old local
 * engine or the shared one; a target-conditional check only ever runs from
 * target-picker.js, which only ever has the RAW structured session
 * participant (`.statuses`, real `apply` values) to work with -- there's no
 * second shape to reconcile with here. */
function _targetConditionMet(cond, { attacker, target }) {
  if (!cond) return false;
  switch (cond.type) {
    case 'target_hp_below': { const f = _hpFraction(target); return f !== null && f < cond.fraction; }
    case 'target_hp_at_or_below': { const f = _hpFraction(target); return f !== null && f <= cond.fraction; }
    case 'target_hp_above': { const f = _hpFraction(target); return f !== null && f > cond.fraction; }
    case 'target_hp_at_or_above': { const f = _hpFraction(target); return f !== null && f >= cond.fraction; }
    case 'target_status': return _hasCondition(target, cond.any);
    case 'target_has_any_status': return (target?.statuses || []).length > 0;
    // Solvent Spray's own "double damage to Poison-type" -- checked against
    // both of the target's type slots (type1/type2, see routes_combat.py's
    // _add_participant), case-insensitively same as everywhere else in this
    // app that compares type names.
    case 'target_type': {
      const types = [target?.type1, target?.type2].filter(Boolean).map(t => t.toLowerCase());
      return (cond.any || []).some(t => types.includes(t.toLowerCase()));
    }
    case 'attacker_stat_below_target': {
      const key = String(cond.stat || '').toLowerCase();
      const a = Number(attacker?.[key]);
      const t = Number(target?.[key]);
      return Number.isFinite(a) && Number.isFinite(t) && a < t;
    }
    // Electro Ball's own comparison -- fastest of each participant's own
    // movement types, not a single flat stat (see _maxSpeed above).
    case 'attacker_max_speed_above_target': {
      const a = _maxSpeed(attacker);
      const t = _maxSpeed(target);
      return a !== null && t !== null && a > t;
    }
    // Heavy Slam's own comparison -- see _sizeRank above.
    case 'attacker_size_above_target': return _sizeRank(attacker) > _sizeRank(target);
    default:
      return false;
  }
}

/** How many size levels `attacker` outranks `target` by (Heavy Slam's own
 * "for EACH size level you are above" -- a `scalingBonus` magnitude, not
 * just met/not-met), 0 for every other condition type -- those are all
 * boolean-only, magnitude is meaningless for them (targetDamageNoteResult
 * only ever reads this when an effect actually declares scalingBonus,
 * same "magnitude ignored unless scalingBonus asks for it" convention
 * combat.js's own self-conditional evaluator uses). */
function _targetConditionMagnitude(cond, { attacker, target }) {
  if (cond?.type === 'attacker_size_above_target') return Math.max(0, _sizeRank(attacker) - _sizeRank(target));
  return 1;
}

/** Evaluates every target-conditional `damage_note` effect for a move
 * against the actual selected attacker/target -- target-picker.js's own
 * counterpart to combat.js's self-conditional _evaluateDamageNotes, run
 * once a target is actually known (its own step3, not the move-popup).
 * `effects` is expected pre-filtered to `kind === 'damage_note'` (see
 * combat-wip.js's own call sites); self-conditional ones among them are
 * harmless here -- none of this function's `condition.type` values match
 * `self_*`, so they're silently never met, already handled elsewhere.
 * Multiple diceMultiplier effects resolve to the highest among those MET,
 * same "never stacked" rule as the self-conditional side; flatBonus and
 * advantage DO accumulate/OR across every met effect, since nothing here
 * needs Flail's own "only the most severe tier" reasoning. */
export function targetDamageNoteResult(effects, { attacker, target, moveModValue = 0, nextTierDice = null }) {
  let diceMultiplier = 1, diceOverride = null, flatBonus = 0, advantage = false;
  const notes = [];
  for (const e of effects || []) {
    if (e.kind !== 'damage_note' || !_targetConditionMet(e.condition, { attacker, target })) continue;
    if (e.diceMultiplier && e.diceMultiplier > diceMultiplier) diceMultiplier = e.diceMultiplier;
    // Electro Ball's own "roll the next tier's dice, or double at the top
    // tier" -- nextTierDice (the caller's own computeMoveData.nextTierDice,
    // see combat-wip.js's call sites) is null once already at the highest
    // tier, where there's nothing higher to swap in, so the move's own
    // level-17+ fallback ("double the damage dice") applies instead --
    // same diceMultiplier this effect would otherwise use, just replacing
    // the swap with a multiply once there's no tier left to swap to.
    if (e.nextTierOrDouble) {
      if (nextTierDice) diceOverride = nextTierDice;
      else if (2 > diceMultiplier) diceMultiplier = 2;
    }
    if (e.flatBonus === 'proficiency') flatBonus += Number(attacker?.proficiency) || 0;
    // Wring Out's own "double your move modifier" -- one more copy of
    // whatever the move's own base modifier already contributed. The value
    // itself comes from the caller (combat.js's computedData.highestMod,
    // threaded through pickTarget/pickTargetAgain -- see combat-wip.js's own
    // call sites), not re-derived here, so it stays exactly consistent with
    // whatever the move-popup already showed for this same move/combatant.
    else if (e.flatBonus === 'moveModifier') flatBonus += moveModValue;
    else if (typeof e.flatBonus === 'number') flatBonus += e.flatBonus;
    // Heavy Slam's own "+MOVE mod per size level above the target" --
    // target-conditional counterpart to combat.js's self-conditional
    // scalingBonus (Trump Card/Frustration/Return), just reading its
    // magnitude from a target COMPARISON (_targetConditionMagnitude)
    // instead of a self-only counted value.
    if (e.scalingBonus) {
      const magnitude = _targetConditionMagnitude(e.condition, { attacker, target });
      const unitValue = e.scalingBonus.amountPerUnit === 'moveModifier' ? moveModValue : (e.scalingBonus.amountPerUnit || 0);
      let bonus = magnitude * unitValue;
      if (typeof e.scalingBonus.cap === 'number') bonus = Math.min(bonus, e.scalingBonus.cap);
      if (bonus) flatBonus += bonus;
    }
    if (e.advantage) advantage = true;
    if (e.note) notes.push(e.note);
  }
  return { diceMultiplier, diceOverride, flatBonus, advantage, note: notes.join('; ') };
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
  for (const k of ['apply', 'value', 'value2', 'stat', 'amount', 'set', 'roll', 'on', 'note', 'repeat', 'ability']) {
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
