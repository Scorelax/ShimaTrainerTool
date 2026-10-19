// Live push notifications from the Pi server (see pi-server/app/live.py and
// main.py's /api/events). The kinds of event that arrive here:
//  - the players' Pokedex settings changed (the DM console's Pokedex module, or
//    a first catch revealing a species); refresh the session's copy in the
//    background so any screen that reads it (evolution.js, new-pokemon.js)
//    reflects it without the player hitting Reload Data.
//  - a trainer-data event (routes_trainer.py / routes_pokemon.py / routes_dm.py
//    publish this on every money/pokemon write, and when the DM gives an item)
//    -- if it's for the trainer currently loaded in this tab, refetch that
//    trainer so trainer-info/trainer-card don't need a trip back through
//    continue-journey to see it.
//  - a combat event (routes_combat.py publishes the whole session on every
//    mutation) -- forwarded as-is via a CustomEvent; pages that care (the WIP
//    combat tool) listen for it directly instead of this module knowing
//    anything about combat's shape.
//  - a combat-animation event (routes_combat.py's play-animation action) --
//    a one-shot "play this species' clip now" cue, not session state;
//    forwarded the same way for the display module to react to.
//  - a combat-hover event (routes_combat.py's hover-token action) -- a live
//    "here's where I'm considering placing this token" preview during the
//    placement step, also not session state; forwarded the same way.

import { EVENTS_URL, GameDataAPI, PokemonAPI, TrainerAPI } from '../api.js';
import { setPokedexConfig } from './visibility.js';
import { redactForViewer } from './combat-visibility.js';
import { storePokemon } from './owned-pokemon.js';
import { loadTrainer, storeTrainer } from './trainer-data.js';

let source = null;

/**
 * Opens the SSE connection once for the whole session -- this app is a real
 * SPA (main.js loads once, pages are innerHTML swaps), so the connection
 * survives every in-app navigation. No-ops on the old GitHub Pages address
 * (EVENTS_URL is null there) and if already initialized.
 */
export function initLiveUpdates() {
  if (!EVENTS_URL || source) return;

  source = new EventSource(EVENTS_URL);
  // EventSource reconnects on its own after a drop -- no manual retry/backoff needed. But whatever was pushed while it
  // was down is gone, and phones drop it whenever the screen sleeps or the app goes to the background. So on every
  // reconnect, and whenever the app comes back to the foreground, pages that mirror live state (the shared battle)
  // are told to fetch it fresh ('app:live-resync').
  let opened = false;
  source.onopen = () => {
    if (opened) window.dispatchEvent(new CustomEvent('app:live-resync'));
    opened = true;
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') window.dispatchEvent(new CustomEvent('app:live-resync'));
  });
  source.onmessage = (e) => {
    let event;
    try {
      event = JSON.parse(e.data);
    } catch (err) {
      return;
    }
    if (event.type === 'pokedex-config') {
      // The players' Pokedex page (js/pokedex/player-pokedex.js) fetches its own cut of the data at once.
      window.dispatchEvent(new CustomEvent('app:pokedex-config'));
      refreshPokedexData();
    } else if (event.type === 'trainer-data' && event.trainer) {
      refreshActiveTrainerData(event.trainer);
      // Pages watching every trainer (the DM console's Party module) hear about it too.
      window.dispatchEvent(new CustomEvent('app:trainer-data', { detail: { trainer: event.trainer } }));
    } else if (event.type === 'combat') {
      // What this screen may see of it (combat-visibility.js) -- the DM's hidden creatures and log lines left out.
      window.dispatchEvent(new CustomEvent('app:combat-updated', { detail: redactForViewer(event.session) }));
    } else if (event.type === 'combat-animation') {
      window.dispatchEvent(new CustomEvent('app:combat-animation', { detail: event }));
    } else if (event.type === 'combat-hover') {
      window.dispatchEvent(new CustomEvent('app:combat-hover', { detail: event }));
    } else if (event.type === 'dm-clock' || event.type === 'dm-npcs' || event.type === 'display-scene' || event.type === 'region-map-view') {
      // The DM console's world clock / NPC library / what the table TV shows / where the board screen's region map is
      // looking changed (another DM tab, or this one's own save coming back -- display.html listens for the scene,
      // battle-map.html for the region map).
      window.dispatchEvent(new CustomEvent(`app:${event.type}`, { detail: event }));
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
      sessionStorage.setItem('registeredSpecies', JSON.stringify(listResult.data));
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
    const currentName = loadTrainer().name;
    if (!currentName || currentName.toLowerCase() !== trainerName.toLowerCase()) return;

    const bundle = await TrainerAPI.getFull(trainerName);
    if (!bundle || bundle.status !== 'success' || !bundle.trainerData) return;

    storeTrainer(bundle.trainerData);
    (bundle.pokemonData || []).forEach((pokemon) => {
      storePokemon(pokemon);
    });
    if (bundle.registeredList) {
      sessionStorage.setItem('registeredSpecies', JSON.stringify(bundle.registeredList));
    }
    if (bundle.pokedexConfig) {
      setPokedexConfig(bundle.pokedexConfig);
    }
    // The move list too: a move the DM taught may be one of the DM's own, new since this device loaded the list
    if (Array.isArray(bundle.gameData?.moves)) sessionStorage.setItem('moves', JSON.stringify(bundle.gameData.moves));

    window.dispatchEvent(new CustomEvent('app:trainer-updated'));
  } catch (err) {
    console.warn('[LiveUpdates] Failed to refresh trainer data:', err);
  }
}
