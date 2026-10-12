// The DM's battle setup -- the map and the creatures, prepared before Start battle (routes_dm.py keeps it on the Pi,
// so a reload or a different laptop picks it up where it was left). One copy in memory here; every change is saved
// shortly after it's made.
//
// Shape: {
//   map: { cols, rows, lockRatio, background, objects: [...board.objects], marks: {"col,row": kind}, ready, terrain, weather },
//   creatures: [{ id, kind: 'pokemon'|'trainer', name, config, participant, computed, initiativeBonus, heldBack,
//                 trainerId, position: {col, row, facing} | null }],
//   startedAt,
// }
// `map` uses board coordinates (routes_combat.py's board: cols x rows, objects anchored top-left); the map editor shows
// it the way the table TV does.
import { DmAPI } from '../api.js';

// Same starting size as a PvP battle: 20 squares across and 11 down on the table TV, so the squares come out square.
export const TV_ASPECT = 16 / 9;
export const DEFAULT_ACROSS = 20;
export const DEFAULT_DOWN = 11;
// A new map starts on the forest, like a PvP battle (routes_combat._PVP_DEFAULT_BACKGROUND).
export const DEFAULT_BACKGROUND = '/battle-images/battle-forest.png';

let _setup = null;
let _saveTimer = null;
let _saving = null;
const _listeners = new Set();

export function emptySetup() {
  return {
    // terrain / weather: what a Poke Ball throw is up against (encounter-rules.js TERRAIN, WEATHER_ROLL_MOD) -- 'world'
    // is the world clock's weather at the time.
    map: {
      cols: DEFAULT_DOWN, rows: DEFAULT_ACROSS, lockRatio: true, background: DEFAULT_BACKGROUND, objects: [], marks: {}, ready: false,
      terrain: 'flat', weather: 'world',
    },
    creatures: [],
    startedAt: null,
  };
}

export async function loadSetup() {
  const res = await DmAPI.getSetup();
  _setup = res.data || emptySetup();
  _setup.map = { ...emptySetup().map, ...(_setup.map || {}) };
  // A map saved before the forest default that was never set up yet gets it too.
  if (!_setup.map.ready && !_setup.map.background) _setup.map.background = DEFAULT_BACKGROUND;
  _setup.creatures = _setup.creatures || [];
  return _setup;
}

export function getSetup() {
  return _setup;
}

/** Runs `fn(setup)` to change it, tells every listener, and saves a moment later (several quick changes -- painting
 * squares -- become one save). */
export function updateSetup(fn) {
  fn(_setup);
  _listeners.forEach(l => l(_setup));
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(flushSetup, 600);
}

/** Saves now (before leaving a screen, or starting the battle). */
export async function flushSetup() {
  clearTimeout(_saveTimer);
  _saveTimer = null;
  if (!_setup) return;
  const body = JSON.parse(JSON.stringify(_setup));
  _saving = DmAPI.saveSetup(body);
  try { await _saving; } finally { _saving = null; }
}

export async function resetSetup() {
  clearTimeout(_saveTimer);
  await DmAPI.clearSetup();
  _setup = emptySetup();
  _listeners.forEach(l => l(_setup));
}

/** Back to a blank map (default size, the forest background, no objects or marks, not ready). Where the creatures stood belonged
 * to the old map, so those spots go too -- the creatures themselves stay. */
export function resetMap() {
  updateSetup(s => {
    s.map = emptySetup().map;
    s.creatures.forEach(c => { c.position = null; });
  });
}

/** Removes every NPC trainer and Pokemon from the setup; the map stays. */
export function resetBattle() {
  updateSetup(s => { s.creatures = []; });
}

export function onSetupChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

export function mapReady(setup = _setup) {
  return !!setup?.map?.ready;
}

export function battleReady(setup = _setup) {
  return (setup?.creatures || []).length > 0;
}
