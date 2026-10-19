// A map on its own, for the map editor (map-editor.js) -- the same getSetup / updateSetup / flushSetup / onSetupChange that
// setup-store.js gives Map setup and live-map-store.js the running battle, for a map kept somewhere else: an encounter's
// (encounters.js -- the Encounters module builds one without starting anything) or the adventure's (adventure.js). The
// editor sees {map, creatures: []}: nobody stands on an encounter's map until it's played. The adventure's map keeps its
// creatures (`creatures` option -- the Pokemon and NPCs the DM prepared on it, saved with the map as map.creatures).
import { emptySetup } from './setup-store.js';

/** A blank map: Map setup's starting size and background, ready to use. */
export function blankMap() {
  return { ...emptySetup().map, ready: true };
}

/**
 * `map`: the map to edit (a copy is kept here); `save(map)`: stores it -- called a moment after a change (several
 * quick ones, a painted stroke, become one) and on flush. Returns the store the map editor takes (`store` option).
 * `creatures`: the map keeps creatures standing on it (map.creatures, as the map editor's `creatures` -- adventure.js).
 */
export function createMapStore(map, save, { creatures: keepCreatures = false } = {}) {
  const split = (m) => {
    const { creatures, ...rest } = m || {};
    return { map: { ...blankMap(), ...rest }, creatures: keepCreatures && Array.isArray(creatures) ? creatures : [] };
  };
  let setup = split(map);
  let timer = null;
  let saving = null;
  const listeners = new Set();

  const flushSetup = async () => {
    clearTimeout(timer);
    timer = null;
    const body = JSON.parse(JSON.stringify(keepCreatures ? { ...setup.map, creatures: setup.creatures } : setup.map));
    saving = Promise.resolve(save(body));
    try { await saving; } finally { saving = null; }
  };

  return {
    getSetup: () => setup,
    updateSetup(fn) {
      fn(setup);
      if (!keepCreatures) setup.creatures = [];
      listeners.forEach(l => l(setup));
      clearTimeout(timer);
      timer = setTimeout(() => flushSetup().catch(() => {}), 600);
    },
    flushSetup,
    onSetupChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Swaps in another map (a saved map, Map setup's) -- saved too. */
    replace(next) {
      setup = split(next);
      listeners.forEach(l => l(setup));
      return flushSetup();
    },
  };
}
