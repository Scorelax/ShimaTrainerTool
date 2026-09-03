// Live push notifications from the Pi server (see pi-server/app/live.py and
// main.py's /api/events). Two kinds of event arrive here:
//  - a fresh pokedex-config push from Benjakronk's admin panel; refresh the
//    session's copy in the background so any screen that reads it (evolution.js,
//    new-pokemon.js) reflects it without the player hitting Reload Data.
//  - a trainer-data event (routes_trainer.py / routes_pokemon.py publish this
//    on every inventory/gear/money/pokemon write, notably Benjakronk's
//    external game-write API) -- if it's for the trainer currently loaded in
//    this tab, refetch that trainer so trainer-info/trainer-card don't need a
//    trip back through continue-journey to see it.

import { EVENTS_URL, GameDataAPI, PokemonAPI, TrainerAPI } from '../api.js';
import { setPokedexConfig } from './visibility.js';

let source = null;

/**
 * Opens the SSE connection once for the whole session -- this app is a real
 * SPA (main.js loads once, pages are innerHTML swaps), so the connection
 * survives every in-app navigation. No-ops on the Apps Script backend
 * (EVENTS_URL is null there) and if already initialized.
 */
export function initLiveUpdates() {
  if (!EVENTS_URL || source) return;

  source = new EventSource(EVENTS_URL);
  // EventSource reconnects on its own after a drop -- no manual retry/backoff needed.
  source.onmessage = (e) => {
    let event;
    try {
      event = JSON.parse(e.data);
    } catch (err) {
      return;
    }
    if (event.dataset === 'pokedex-config') {
      refreshPokedexData();
    } else if (event.type === 'trainer-data' && event.trainer) {
      refreshActiveTrainerData(event.trainer);
    }
  };
}

async function refreshPokedexData() {
  try {
    const configResult = await GameDataAPI.getPokedexConfig(true);
    if (configResult.status === 'success') {
      setPokedexConfig(configResult.data);
    }

    const listResult = await PokemonAPI.getCompleteList(true);
    if (listResult.status === 'success') {
      sessionStorage.setItem('completePokemonData', JSON.stringify(listResult.data));
    }

    window.dispatchEvent(new CustomEvent('app:pokedex-updated'));
  } catch (err) {
    console.warn('[LiveUpdates] Failed to refresh pokedex data:', err);
  }
}

/**
 * Every device shares this one SSE stream regardless of which trainer it has
 * loaded, so only act when the push is actually for the trainer sitting in
 * this tab's sessionStorage -- otherwise every open device would refetch on
 * every other player's inventory change.
 */
async function refreshActiveTrainerData(trainerName) {
  try {
    const currentTrainerData = JSON.parse(sessionStorage.getItem('trainerData') || 'null');
    const currentName = currentTrainerData && currentTrainerData[1];
    if (!currentName || currentName.toLowerCase() !== trainerName.toLowerCase()) return;

    const bundle = await TrainerAPI.getFull(trainerName);
    if (!bundle || bundle.status !== 'success' || !bundle.trainerData) return;

    sessionStorage.setItem('trainerData', JSON.stringify(bundle.trainerData));
    (bundle.pokemonData || []).forEach((pokemon) => {
      sessionStorage.setItem(`pokemon_${pokemon[2].toLowerCase()}`, JSON.stringify(pokemon));
    });
    if (bundle.registeredList) {
      sessionStorage.setItem('completePokemonData', JSON.stringify(bundle.registeredList));
    }
    if (bundle.pokedexConfig) {
      setPokedexConfig(bundle.pokedexConfig);
    }

    window.dispatchEvent(new CustomEvent('app:trainer-updated'));
  } catch (err) {
    console.warn('[LiveUpdates] Failed to refresh trainer data:', err);
  }
}
