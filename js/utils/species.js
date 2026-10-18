/**
 * Reading a species object -- what pokemon/registered-list sends for each species (its entry in
 * pi-server/docs/DnD_species.json, plus `image`, `abilityList` and `evolvesFrom`; see pi-server/app/pokedex.py).
 *
 * A player's saved Pokemon is still a positional row, so registering or evolving one turns the species back into the
 * text that row has always kept -- these helpers do it exactly as pi-server/app/species.py does on the server
 * (keep the two the same).
 */

export const MOVE_LEVELS = [1, 2, 6, 10, 14, 18];
export const MOVEMENT = ['walking', 'climbing', 'flying', 'hovering', 'swimming', 'burrowing'];
export const SENSES = ['sight', 'hearing', 'smell', 'tremorsense', 'echolocation', 'telepathy', 'blindsight', 'darkvision', 'truesight'];
export const STATS = { str: 'strength', dex: 'dexterity', con: 'constitution', int: 'intelligence', wis: 'wisdom', cha: 'charisma' };

/** The species named `name` (any capitalisation) in a list of species objects, or undefined. */
export function findSpecies(list, name) {
  const key = String(name || '').trim().toLowerCase();
  return (list || []).find(s => s && String(s.name).toLowerCase() === key);
}

/** The cached registered list (sessionStorage 'registeredSpecies' -- continue-journey.js / live-updates.js fill it). */
export function cachedSpecies() {
  try {
    const list = JSON.parse(sessionStorage.getItem('registeredSpecies') || 'null');
    return Array.isArray(list) ? list : null;
  } catch {
    return null;
  }
}

export function baseStat(s, key) {
  return (s.baseStats || {})[STATS[key] || key];
}

/** The six base stats added up (null while one is still missing). */
export function statTotal(s) {
  const vals = Object.values(STATS).map(k => (s.baseStats || {})[k]);
  return vals.every(v => Number.isInteger(v)) ? vals.reduce((a, b) => a + b, 0) : null;
}

/** 'Tackle, Growl' -- the moves learned at one of the six levels. */
export function movesText(s, level) {
  return ((s.moves || {})[String(level)] || []).join(', ');
}

/** 25 -> '25ft', 0 -> '-' (can't), null -> '' (unknown). */
export function feetText(ft) {
  return ft == null ? '' : ft ? `${ft}ft` : '-';
}

/** '25ft, 25ft, -, -, -, -' -- walking, climbing, flying, hovering, swimming, burrowing; `bonus` feet added to each
 *  speed it has. */
export function movementLine(s, bonus = 0) {
  return MOVEMENT.map(k => {
    const ft = (s.movement || {})[k];
    return (ft ? feetText(ft + bonus) : feetText(ft)) || '-';
  }).join(', ');
}

/** 'Poor, Good, -, ...' -- the nine senses in order, '-' where it has none. */
export function sensesLine(s) {
  return SENSES.map(k => (s.senses || {})[k] || '-').join(', ');
}

/** ['Dexterity', 'Constitution'] -> 'Dexterity, Constitution'. */
export function listText(values) {
  return (values || []).join(', ');
}

/** 'From: Octodendron; Evolves: Yukinarbor @ Level 14' -- the evolution line a saved Pokemon keeps. */
export function evolutionText(s) {
  const parts = [];
  if ((s.evolvesFrom || []).length) parts.push('From: ' + s.evolvesFrom.join(' + '));
  for (const e of s.evolvesInto || []) {
    parts.push(e.requirement ? `Evolves: ${e.species} @ ${e.requirement}` : `Evolves: ${e.species}`);
  }
  return parts.join('; ');
}

/** {slot, name, description} of ability slot 0 / 1 / 2 (primary, secondary, hidden), or undefined. */
export function abilityInSlot(s, slot) {
  return (s.abilityList || []).find(a => a.slot === Number(slot));
}

/** 'slot:Name;Description' -- how a saved Pokemon keeps each of its abilities. */
export function savedAbility(a) {
  return `${a.slot}:${a.name};${a.description || ''}`;
}
