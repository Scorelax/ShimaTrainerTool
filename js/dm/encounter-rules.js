// The encounter builder's game rules and generators, from Benjakronk's old DM tool (_reference/OLD DM Tool/app.js):
// terrain and weather for catching, the capture difficulty (CDC) breakdown, the XP table, evolution stages, and the
// random encounter / random NPC trainer generators. No screens here -- encounters.js and battle-live.js draw them.
import { newId, abilityMod } from './dm-common.js';
import { blankNpc } from './npcs.js';

// ---------------------------------------------------------------------------
// Terrain, weather and catching
// ---------------------------------------------------------------------------

/** Terrain: added to the accuracy DC of a throw (old tool's TERRAIN_MODIFIERS). */
export const TERRAIN = {
  flat: { name: 'Flat ground', mod: 0 }, tall_grass: { name: 'Tall grass', mod: 2 }, dense_forest: { name: 'Dense forest', mod: 4 },
  rocky: { name: 'Rocky terrain', mod: 3 }, mountain: { name: 'Mountainous', mod: 5 }, swamp: { name: 'Swamp / marsh', mod: 3 },
  urban: { name: 'Urban / city', mod: 1 }, beach: { name: 'Beach / shoreline', mod: 1 }, water_edge: { name: "Water's edge", mod: 2 },
  deep_water: { name: 'Deep water', mod: 4 }, ice: { name: 'Icy surface', mod: 3 }, cavern: { name: 'Cavern / underground', mod: 3 },
  volcanic: { name: 'Volcanic area', mod: 3 }, windy_plateau: { name: 'Windy plateau', mod: 2 }, zero_gravity: { name: 'Zero gravity', mod: 5 },
};

/** Weather: added to the accuracy ROLL (old tool's WEATHER_MODIFIERS) -- the same keys as the world clock's weather. */
export const WEATHER_ROLL_MOD = { clear: 0, overcast: 0, rain: -2, wind: -3, sandstorm: -4, hail: -3, fog: -2, snow: -2, storm: -3 };

const TYPE_CDC = {
  bug: -5, dark: 10, dragon: 15, electric: 5, fairy: 10, fighting: 10, fire: 5, flying: 5, ghost: 10, grass: 0,
  ground: 0, ice: 5, normal: 0, poison: 5, psychic: 10, rock: 5, steel: 10, water: 0, cosmic: 15,
};
const SIZE_CDC = { tiny: -5, small: 0, medium: 5, large: 10, huge: 15, gigantic: 20 };
const RARITY_CDC = { common: 0, uncommon: 5, rare: 10, 'very rare': 15, 'extremely rare': 20, unique: 25, unknown: 15 };
const BEHAVIOR_CDC = { docile: -15, cautious: 5, neutral: 0, curious: -5, protective: 5, aggressive: 10, territorial: 15, stalking: 20, unknown: 10 };
/** Added to the capture roll by the Pokemon's condition. */
export const STATUS_CAPTURE_BONUS = { Asleep: 15, Frozen: 15, Burned: 10, Paralyzed: 10, Poisoned: 10, Confused: 5 };

/** The capture difficulty: 50 + type(s) + size + rarity + behaviour + health (more than half its HP left +20, more than
 * a quarter +10). `p` is the battle participant, `sp` its species entry (rarity, behaviour). Returns the parts and total. */
export function captureDc(p, sp = {}) {
  const lower = v => String(v || '').trim().toLowerCase();
  const types = (TYPE_CDC[lower(p.type1)] || 0) + (TYPE_CDC[lower(p.type2)] || 0);
  const size = SIZE_CDC[lower(p.size || sp.size)] || 0;
  const rarity = RARITY_CDC[lower(sp.rarity)] || 0;
  const behavior = BEHAVIOR_CDC[lower(sp.behavior)] || 0;
  const pct = p.maxHP > 0 ? (p.currentHP / p.maxHP) * 100 : 100;
  const health = pct > 50 ? 20 : pct > 25 ? 10 : 0;
  return { types, size, rarity, behavior, health, hpPct: Math.max(0, Math.round(pct)), total: 50 + types + size + rarity + behavior + health };
}

/** The accuracy DC of the throw: 10 + the Pokemon's DEX modifier + the terrain. */
export function accuracyDc(p, terrainKey) {
  const dexMod = abilityMod(p.dex);
  const terrain = TERRAIN[terrainKey]?.mod || 0;
  return { dexMod, terrain, total: 10 + dexMod + terrain };
}

// ---------------------------------------------------------------------------
// Experience (DM-only -- the players never see XP)
// ---------------------------------------------------------------------------

export const XP_TO_LEVEL = [0, 0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000,
  165000, 195000, 225000, 265000, 305000, 355000]; // index = level

export function levelFromXp(xp) {
  for (let level = 20; level >= 1; level--) if (xp >= XP_TO_LEVEL[level]) return level;
  return 1;
}

/** Combat lasts 6 seconds a round in Shima. */
export const ROUND_SECONDS = 6;

// ---------------------------------------------------------------------------
// Evolution stages ("From: X; Evolves: Y @ Level 14")
// ---------------------------------------------------------------------------

export function parseEvolution(text) {
  const out = { from: null, to: [] };
  String(text || '').split(';').map(s => s.trim()).forEach((part) => {
    if (/^from:/i.test(part)) out.from = part.replace(/^from:/i, '').split('@')[0].trim() || null;
    if (/^evolves:/i.test(part)) {
      part.replace(/^evolves:/i, '').split(/,|\/|\bor\b/i).map(s => s.split('@')[0].trim()).filter(Boolean).forEach(n => out.to.push(n));
    }
  });
  if (out.from && /^none$/i.test(out.from)) out.from = null;
  return out;
}

/** 'basic' (no earlier form), 'stage1' (has both), 'final' (an evolved form that doesn't evolve further). */
export function evolutionStage(sp) {
  const e = parseEvolution(sp.evolution);
  if (e.from && e.to.length) return 'stage1';
  if (e.from) return 'final';
  return 'basic';
}

export const STAGE_LABEL = { basic: 'Basic', stage1: 'Middle stage', final: 'Final evolution' };

/** Every species in `sp`'s evolution line, earliest first. */
export function evolutionLine(sp, all) {
  const byName = new Map(all.map(s => [s.name.toLowerCase(), s]));
  const line = [sp];
  const seen = new Set([sp.name.toLowerCase()]);
  let cur = sp;
  for (let e = parseEvolution(cur.evolution); e.from && byName.has(e.from.toLowerCase()) && !seen.has(e.from.toLowerCase()); e = parseEvolution(cur.evolution)) {
    cur = byName.get(e.from.toLowerCase());
    seen.add(cur.name.toLowerCase());
    line.unshift(cur);
  }
  const queue = [sp];
  while (queue.length) {
    parseEvolution(queue.shift().evolution).to.forEach((n) => {
      const next = byName.get(n.toLowerCase());
      if (next && !seen.has(n.toLowerCase())) { seen.add(n.toLowerCase()); line.push(next); queue.push(next); }
    });
  }
  return line;
}

// ---------------------------------------------------------------------------
// Random encounter
// ---------------------------------------------------------------------------

export const ENCOUNTER_TEMPLATES = {
  custom: { name: 'Custom', description: 'Your own settings' },
  swarm: { name: 'Swarm', description: '4-6 of one basic species', count: [4, 6], speciesMode: 'same', stage: 'basic' },
  pack: { name: 'Pack', description: '1 leader + 2-3 followers', count: [3, 4], levelMode: 'leader' },
  pair: { name: 'Pair', description: '2 Pokémon at the same level', count: 2, levelMode: 'identical' },
  ambush: { name: 'Ambush', description: '3-4 territorial Pokémon', count: [3, 4], behavior: 'Territorial' },
  horde: { name: 'Horde', description: '5-8 weak basic Pokémon', count: [5, 8], stage: 'basic' },
  boss: { name: 'Boss fight', description: '1 strong evolved Pokémon', count: 1, stage: 'evolved' },
  family: { name: 'Family group', description: 'One evolution line together', speciesMode: 'evolutionLine' },
};

const rnd = n => Math.floor(Math.random() * n);
const pick = list => list[rnd(list.length)];
const between = (lo, hi) => lo + rnd(hi - lo + 1);
export const rangePick = v => (Array.isArray(v) ? between(v[0], v[1]) : v);

/** The species the filters let through: {stage, habitat, types[], rarity, behavior, size, activity, includeExcluded}. */
export function encounterPool(all, f, exclusions = []) {
  const out = new Set(exclusions.map(n => n.toLowerCase()));
  return all.filter((s) => {
    if (!f.includeExcluded && out.has(s.name.toLowerCase())) return false;
    if (f.habitat && s.habitat !== f.habitat) return false;
    if (f.types?.length && !f.types.some(t => s.type1 === t || s.type2 === t)) return false;
    if (f.rarity && s.rarity !== f.rarity) return false;
    if (f.behavior && s.behavior !== f.behavior) return false;
    if (f.size && s.size !== f.size) return false;
    if (f.activity && s.activity !== f.activity) return false;
    if (f.stage) {
      const st = evolutionStage(s);
      if (f.stage === 'evolved' ? st === 'basic' : st !== f.stage) return false;
    }
    return true;
  });
}

function levels(count, min, max, mode) {
  if (mode === 'identical') { const l = between(min, max); return Array(count).fill(l); }
  if (mode === 'ascending') { const step = count > 1 ? (max - min) / (count - 1) : 0; return Array.from({ length: count }, (_, i) => Math.round(min + step * i)); }
  if (mode === 'leader') return [max, ...Array.from({ length: count - 1 }, () => between(min, Math.max(min, max - 2)))];
  return Array.from({ length: count }, () => between(min, max));
}

/**
 * The old tool's random encounter. `o` = {count, minLevel, maxLevel, levelMode (uniform|identical|ascending|leader),
 * speciesMode (random|unique|same|evolutionLine|selected), selected: [{name, quantity}], includeEvolutions, autoLabels,
 * ...the pool filters}. Returns [{species, level, name}] -- or throws with what went wrong.
 */
export function generateEncounter(all, o, exclusions = []) {
  let lo = Math.max(1, Math.min(20, o.minLevel || 1));
  let hi = Math.max(1, Math.min(20, o.maxLevel || lo));
  if (lo > hi) [lo, hi] = [hi, lo];
  const count = Math.max(1, Math.min(12, o.count || 3));
  let chosen = [];
  if (o.speciesMode === 'selected') {
    (o.selected || []).forEach(({ name, quantity }) => {
      const sp = all.find(s => s.name === name);
      if (!sp) return;
      const line = o.includeEvolutions ? evolutionLine(sp, all) : [sp];
      for (let i = 0; i < quantity; i++) chosen.push(line[i % line.length]);
    });
    if (!chosen.length) throw new Error('Pick some species first (or another species mode).');
  } else {
    const pool = encounterPool(all, o, exclusions);
    if (!pool.length) throw new Error('No Pokémon match those filters.');
    if (o.speciesMode === 'same') {
      const sp = pick(pool);
      chosen = Array(count).fill(sp);
    } else if (o.speciesMode === 'unique') {
      const shuffled = [...pool].sort(() => Math.random() - 0.5);
      chosen = shuffled.slice(0, count);
      while (chosen.length < count) chosen.push(pick(pool));
    } else if (o.speciesMode === 'evolutionLine') {
      const line = evolutionLine(pick(pool), all);
      const inPool = line.filter(s => pool.includes(s));
      const use = inPool.length ? inPool : line;
      chosen = Array.from({ length: count }, (_, i) => use[i % use.length]);
      const order = { basic: 0, stage1: 1, final: 2 };
      if (o.levelMode === 'ascending') chosen.sort((a, b) => order[evolutionStage(a)] - order[evolutionStage(b)]);
      if (o.levelMode === 'leader') chosen.sort((a, b) => order[evolutionStage(b)] - order[evolutionStage(a)]);
    } else {
      chosen = Array.from({ length: count }, () => pick(pool));
    }
  }
  const lv = levels(chosen.length, lo, hi, o.levelMode || 'uniform');
  const counts = {};
  chosen.forEach(s => { counts[s.name] = (counts[s.name] || 0) + 1; });
  const seen = {};
  return chosen.map((s, i) => {
    let name = s.name;
    if (o.autoLabels !== false && counts[s.name] > 1) {
      seen[s.name] = (seen[s.name] || 0) + 1;
      name = `${s.name} ${String.fromCharCode(64 + seen[s.name])}`;
    }
    return { species: s.name, level: lv[i], name };
  });
}

// ---------------------------------------------------------------------------
// Random NPC trainer
// ---------------------------------------------------------------------------

export const TRAINER_ARCHETYPES = {
  custom: { name: 'Custom', description: 'Your own settings', statMethod: '4d6' },
  gymLeader: { name: 'Gym Leader', description: 'High stats, type specialist, strong team', statMethod: 'elite', typeStrength: 0.9, teamSize: [4, 6], levelRelation: 'match', ace: true, inventory: ['Full Restore', 'Full Restore', 'Hyper Potion', 'Hyper Potion'] },
  eliteFour: { name: 'Elite Four', description: 'Very high stats, strong varied team', statMethod: 'elite', typeStrength: 0.8, teamSize: [5, 6], levelRelation: 'match', ace: true, inventory: ['Full Restore', 'Full Restore', 'Full Restore', 'Max Potion'] },
  ranger: { name: 'Ranger', description: 'Balanced, nature types', statMethod: '4d6', types: ['Grass', 'Bug', 'Flying', 'Normal'], teamSize: [2, 4], inventory: ['Potion', 'Potion', 'Antidote', 'Poké Ball'] },
  scientist: { name: 'Scientist', description: 'Psychic / Steel / Electric types', statMethod: 'pointBuy', types: ['Psychic', 'Steel', 'Electric', 'Poison'], teamSize: [2, 4], inventory: ['Potion', 'Super Potion', 'Revive'] },
  grunt: { name: 'Grunt', description: 'Low stats, weak team', statMethod: 'commoner', teamSize: [1, 3], levelRelation: 'below', stage: 'basic', inventory: ['Potion'] },
  veteran: { name: 'Veteran', description: 'Strong body, evolved team', statMethod: '4d6', teamSize: [3, 5], levelRelation: 'match', stage: 'evolved', inventory: ['Super Potion', 'Super Potion', 'Revive', 'Full Heal'] },
  ace: { name: 'Ace Trainer', description: 'Solid all-round trainer', statMethod: 'standardArray', teamSize: [3, 4], ace: true, inventory: ['Super Potion', 'Super Potion', 'Revive'] },
  youngster: { name: 'Youngster', description: 'Early-game trainer', statMethod: 'commoner', teamSize: [1, 2], levelRelation: 'below', stage: 'basic', inventory: ['Potion'] },
};

export const STAT_METHODS = {
  '4d6': '4d6, drop the lowest', standardArray: 'Standard array (15, 14, 13, 12, 10, 8)', pointBuy: 'Point buy, balanced (12, 12, 12, 11, 11, 10)',
  elite: 'Elite (16, 15, 14, 13, 12, 10)', commoner: 'Commoner (all 10)',
};

const TRAINER_NAMES = ['Ace', 'Blaze', 'Crystal', 'Drake', 'Echo', 'Fern', 'Granite', 'Haze', 'Iris', 'Jasper', 'Kai', 'Luna', 'Mist', 'Nova', 'Onyx',
  'Pike', 'Quinn', 'Raven', 'Storm', 'Terra', 'Umbra', 'Volt', 'Willow', 'Xander', 'Yuki', 'Zephyr', 'Ash', 'Brock', 'Misty', 'Gary', 'Cynthia', 'Lance'];

function rollStats(method) {
  const keys = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  const shuffled = arr => [...arr].sort(() => Math.random() - 0.5);
  const fixed = { standardArray: [15, 14, 13, 12, 10, 8], elite: [16, 15, 14, 13, 12, 10], pointBuy: [12, 12, 12, 11, 11, 10] }[method];
  const values = method === 'commoner' ? Array(6).fill(10)
    : fixed ? shuffled(fixed)
      : keys.map(() => [1, 2, 3, 4].map(() => between(1, 6)).sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0));
  return Object.fromEntries(keys.map((k, i) => [k, values[i]]));
}

/**
 * The old tool's random trainer, as an NPC for the NPC library (npcs.js's shape). `o` = {archetype, name, level, path,
 * statMethod, teamCount, levelRelation (custom|match|below), minLevel, maxLevel, stage (''|basic|evolved), ace, type,
 * type2, typeStrength, habitat, autoInventory, includeExcluded}.
 */
export function generateTrainer(all, o, exclusions = [], natures = []) {
  const arch = TRAINER_ARCHETYPES[o.archetype] || TRAINER_ARCHETYPES.custom;
  const level = Math.max(1, Math.min(20, o.level || 5));
  let lo; let hi;
  if (o.levelRelation === 'match') { lo = level; hi = level; } else if (o.levelRelation === 'below') { lo = Math.max(1, level - 3); hi = Math.max(1, level - 1); } else { lo = o.minLevel || 3; hi = Math.max(lo, o.maxLevel || lo); }
  const out = new Set(exclusions.map(n => n.toLowerCase()));
  let pool = all.filter(s => o.includeExcluded || !out.has(s.name.toLowerCase()));
  if (o.stage) pool = pool.filter(s => (o.stage === 'basic' ? evolutionStage(s) === 'basic' : evolutionStage(s) !== 'basic'));
  if (o.habitat) { const h = pool.filter(s => s.habitat === o.habitat); if (h.length) pool = h; }
  const types = [o.type, o.type2].filter(Boolean);
  let typePool = types.length ? pool.filter(s => types.some(t => s.type1 === t || s.type2 === t)) : pool;
  if (!typePool.length) typePool = pool;
  if (!pool.length) throw new Error('No Pokémon match those settings.');

  const team = [];
  const used = new Set();
  const teamCount = Math.max(1, Math.min(6, o.teamCount || 3));
  for (let i = 0; i < teamCount; i++) {
    const from = types.length && Math.random() < (o.typeStrength ?? 0.7) ? typePool : pool;
    // A trainer has one of each species (the app tells a trainer's Pokemon apart by species).
    const fresh = from.filter(s => !used.has(s.name));
    const sp = pick(fresh.length ? fresh : from);
    used.add(sp.name);
    const lv = o.ace && i === 0 ? Math.min(20, hi + between(2, 3)) : between(lo, hi);
    team.push({ id: newId('mon'), species: sp.name, nickname: '', level: lv, nature: natures.length ? pick(natures) : '', abilities: [0], item: '', shiny: false, notes: o.ace && i === 0 ? 'Ace Pokémon' : '', stats: {} });
  }
  team.sort((a, b) => b.level - a.level);

  let inventory = [];
  if (o.autoInventory) {
    const names = arch.inventory || [
      'Potion', ...(level >= 5 ? ['Super Potion'] : []), ...(level >= 10 ? ['Revive'] : []), ...(level >= 12 ? ['Hyper Potion'] : []),
      ...(level >= 15 ? ['Full Heal'] : []), ...(level >= 18 ? ['Full Restore'] : []),
    ];
    const counts = {};
    names.forEach(n => { counts[n] = (counts[n] || 0) + 1; });
    if (!arch.inventory) { counts.Potion = Math.ceil(level / 5); if (counts['Super Potion']) counts['Super Potion'] = Math.floor(level / 5); }
    inventory = Object.entries(counts).map(([name, quantity]) => ({ name, quantity, description: '' }));
  }

  const stats = rollStats(o.statMethod || arch.statMethod);
  return {
    ...blankNpc(),
    name: o.name || pick(TRAINER_NAMES), role: arch.name === 'Custom' ? 'Trainer' : arch.name, attitude: 'hostile',
    level, ...stats, ac: 10 + abilityMod(stats.dex), maxHP: 0, trainerPath: o.path || '', // 0 = worked out from level and CON
    affinity: o.type || '', team, inventory, notes: 'Made by the random trainer generator.',
  };
}
