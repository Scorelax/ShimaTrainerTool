/**
 * Reading a species object -- what pokemon/registered-list sends for each species (its entry in
 * pi-server/docs/DnD_species.json, plus `image`, `abilityList` and `evolvesFrom`; see pi-server/app/pokedex.py).
 * A player's own Pokemon is built from its species on the server (pi-server/app/owned.py); see owned-pokemon.js.
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

export function baseStat(s, key) {
  return (s.baseStats || {})[STATS[key] || key];
}

/** The six base stats added up (null while one is still missing). */
export function statTotal(s) {
  const vals = Object.values(STATS).map(k => (s.baseStats || {})[k]);
  return vals.every(v => Number.isInteger(v)) ? vals.reduce((a, b) => a + b, 0) : null;
}

/** {slot, name, description} of ability slot 0 / 1 / 2 (primary, secondary, hidden), or undefined. */
export function abilityInSlot(s, slot) {
  return (s.abilityList || []).find(a => a.slot === Number(slot));
}
