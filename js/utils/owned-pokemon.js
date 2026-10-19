/**
 * The players' own Pokemon -- one object each (pi-server/app/owned.py describes every field; the user's call,
 * 2026-10-18 -- they were 62-cell rows before). The trainer bundle and pokemon/get send them; each is kept in
 * sessionStorage as `pokemon_<species, lowercase>`, the key every page reads it back by.
 */

import { MOVE_LEVELS, MOVEMENT, SENSES } from './species.js';

export { MOVE_LEVELS };

/** The name the app shows: its nickname, else its species. */
export function displayName(p) {
  return (p && (p.nickname || p.name)) || '';
}

const KEY_PREFIX = 'pokemon_';

export function pokemonKey(name) {
  return KEY_PREFIX + String(name || '').toLowerCase();
}

/** One of the trainer's Pokemon from sessionStorage (by species), or null. */
export function cachedPokemon(name) {
  try {
    const p = JSON.parse(sessionStorage.getItem(pokemonKey(name)) || 'null');
    return p && !Array.isArray(p) && typeof p === 'object' ? p : null;
  } catch {
    return null;
  }
}

export function storePokemon(p) {
  if (p && p.name) sessionStorage.setItem(pokemonKey(p.name), JSON.stringify(p));
}

export function forgetPokemon(name) {
  sessionStorage.removeItem(pokemonKey(name));
}

/** Every Pokemon of the trainer in sessionStorage. */
export function allCachedPokemon() {
  return Object.keys(sessionStorage)
    .filter(k => k.startsWith(KEY_PREFIX))
    .map(k => { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } })
    .filter(p => p && !Array.isArray(p) && typeof p === 'object' && p.name);
}

/** Whether sessionStorage still holds Pokemon as the old 62-cell rows (a session from before the change). */
export function hasOldRows() {
  return Object.keys(sessionStorage).filter(k => k.startsWith(KEY_PREFIX))
    .some(k => { try { return Array.isArray(JSON.parse(sessionStorage.getItem(k))); } catch { return false; } });
}

/** The moves it knows: every level's moves up to its own level, then its custom moves. */
export function knownMoveNames(p) {
  const level = Number(p?.level) || 1;
  const out = [];
  for (const lvl of MOVE_LEVELS) {
    if (level >= lvl) out.push(...((p.moves || {})[String(lvl)] || []));
  }
  out.push(...(p?.customMoves || []));
  return out;
}

/** {name, slot, description} of the abilities it has, slot order. */
export function abilitiesOf(p) {
  return [...(p?.abilities || [])].sort((a, b) => a.slot - b.slot);
}

/** 'Walking 30ft, Swimming 20ft' -- the speeds it has. */
export function speedText(p) {
  return MOVEMENT.filter(k => (p?.movement || {})[k])
    .map(k => `${k[0].toUpperCase()}${k.slice(1)} ${p.movement[k]}ft`).join(', ');
}

export function walkingSpeed(p) {
  return Number((p?.movement || {}).walking) || 0;
}

/** [[label, value]] of the senses it has. */
export function sensesList(p) {
  return SENSES.filter(k => (p?.senses || {})[k]).map(k => [`${k[0].toUpperCase()}${k.slice(1)}`, p.senses[k]]);
}

/** Its current HP / VP / AC / hit dice / vitality dice -- the max (or its AC / dice) where none is stored. */
export function currentHP(p) {
  const v = p?.current?.hp;
  return v == null || v === '' ? Number(p?.combat?.maxHP) || 0 : Number(v);
}

export function currentVP(p) {
  const v = p?.current?.vp;
  return v == null || v === '' ? Number(p?.combat?.maxVP) || 0 : Number(v);
}

export function currentAC(p) {
  const v = p?.current?.ac;
  return v == null || v === '' ? Number(p?.combat?.ac) || 0 : Number(v);
}

export function inParty(p) {
  return !!p?.partySlot;
}
