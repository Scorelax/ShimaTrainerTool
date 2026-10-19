/**
 * The logged-in trainer -- one object (pi-server/app/trainers.py describes every field; the user's call, 2026-10-19 --
 * it was a 52-cell row before), kept in sessionStorage as `trainerData`. The login bundle sends it; every page reads it
 * back with loadTrainer() and writes it with storeTrainer() (plus TrainerAPI.update to save it on the Pi).
 */

const KEY = 'trainerData';

/** A trainer with every part there (empty), so `t.current.hp` and the like never throw on a missing piece. */
function normalized(t) {
  t = t && typeof t === 'object' && !Array.isArray(t) ? t : {};
  for (const k of ['stats', 'modifiers', 'combat', 'current', 'charges']) {
    if (!t[k] || typeof t[k] !== 'object') t[k] = {};
  }
  for (const k of ['savingThrows', 'skills', 'feats', 'languages', 'inventory', 'customItems', 'gear', 'affinities',
    'specializations']) {
    if (!Array.isArray(t[k])) t[k] = [];
  }
  return t;
}

/** The logged-in trainer from sessionStorage -- an empty one (no name) when there's none. */
export function loadTrainer() {
  try {
    return normalized(JSON.parse(sessionStorage.getItem(KEY) || 'null'));
  } catch {
    return normalized(null);
  }
}

/** A trainer with nothing in it (no name) -- for a page showing someone else's things. */
export function emptyTrainer() {
  return normalized(null);
}

/** Whether a trainer is logged in. */
export function hasTrainer() {
  return !!loadTrainer().name;
}

export function storeTrainer(t) {
  sessionStorage.setItem(KEY, JSON.stringify(t));
}

/** Whether sessionStorage still holds the trainer as the old 52-cell row (a session from before the change). */
export function hasOldTrainerRow() {
  try { return Array.isArray(JSON.parse(sessionStorage.getItem(KEY) || 'null')); } catch { return false; }
}

/** Current HP / VP / AC -- the max (or the AC) when it hasn't been set. */
export function currentHP(t) {
  return t?.current?.hp ?? t?.combat?.maxHP ?? 0;
}

export function currentVP(t) {
  return t?.current?.vp ?? t?.combat?.maxVP ?? 0;
}

export function currentAC(t) {
  return t?.current?.ac ?? t?.combat?.ac ?? 10;
}

/** The names on a list field, or 'None' -- for showing it as text. */
export function listText(list, none = 'None') {
  return (list || []).length ? list.join(', ') : none;
}

/** The feats as [{name, data}] -- `data` is Linguist's languages ("Elvish|Draconic"), '' for every other feat. */
export function featEntries(t) {
  return (t?.feats || []).map(name => ({ name, data: name === 'Linguist' ? (t.languages || []).join('|') : '' }));
}

// ---------------------------------------------------------------------------
// The inventory: `inventory` = [{name, quantity}] of the item list's items, `customItems` = [{name, description,
// quantity}] of the trainer's own.
// ---------------------------------------------------------------------------

/** How many of the item (by name, any case) the trainer has. */
export function itemCount(t, name) {
  const wanted = String(name || '').trim().toLowerCase();
  const all = [...(t?.inventory || []), ...(t?.customItems || [])];
  return all.filter(i => String(i.name || '').trim().toLowerCase() === wanted)
    .reduce((n, i) => n + (Number(i.quantity) || 0), 0);
}

/** Every item name the trainer has (the item list's and their own). */
export function inventoryNames(t) {
  return [...(t?.inventory || []), ...(t?.customItems || [])].map(i => i.name);
}

/**
 * Adds `quantity` of an item (a negative one takes some away; at 0 it's gone) -- to `customItems` with `custom`,
 * else `inventory`. Changes `t` in place and returns it.
 */
export function addItem(t, name, quantity, { custom = false, description = '' } = {}) {
  const key = custom ? 'customItems' : 'inventory';
  const list = t[key] = [...(t[key] || [])];
  const wanted = String(name || '').trim();
  const entry = list.find(i => String(i.name || '').toLowerCase() === wanted.toLowerCase());
  if (entry) {
    entry.quantity = (Number(entry.quantity) || 0) + quantity;
    if (custom && description) entry.description = description;
  } else if (quantity > 0) {
    list.push(custom ? { name: wanted, description, quantity } : { name: wanted, quantity });
  }
  t[key] = list.filter(i => (Number(i.quantity) || 0) > 0);
  return t;
}
