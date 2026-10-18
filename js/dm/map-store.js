// A map on its own, for the map editor (map-editor.js) -- the same getSetup / updateSetup / flushSetup / onSetupChange that
// setup-store.js gives Map setup and live-map-store.js the running battle, for a map kept somewhere else: an encounter's
// (encounters.js -- the Encounters module builds one without starting anything) or the adventure's (adventure.js). The
// editor sees {map, creatures: []}: nobody stands on these maps until they're played.
import { emptySetup } from './setup-store.js';

/** A blank map: Map setup's starting size and background, ready to use. */
export function blankMap() {
  return { ...emptySetup().map, ready: true };
}

/**
 * `map`: the map to edit (a copy is kept here); `save(map)`: stores it -- called a moment after a change (several
 * quick ones, a painted stroke, become one) and on flush. Returns the store the map editor takes (`store` option).
 */
export function createMapStore(map, save) {
  let setup = { map: { ...blankMap(), ...(map || {}) }, creatures: [] };
  let timer = null;
  let saving = null;
  const listeners = new Set();

  const flushSetup = async () => {
    clearTimeout(timer);
    timer = null;
    const body = JSON.parse(JSON.stringify(setup.map));
    saving = Promise.resolve(save(body));
    try { await saving; } finally { saving = null; }
  };

  return {
    getSetup: () => setup,
    updateSetup(fn) {
      fn(setup);
      setup.creatures = [];
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
      setup = { map: { ...blankMap(), ...(next || {}) }, creatures: [] };
      listeners.forEach(l => l(setup));
      return flushSetup();
    },
  };
}
