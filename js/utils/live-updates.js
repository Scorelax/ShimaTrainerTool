// Live push notifications from the Pi server (see pi-server/app/live.py and
// main.py's /api/events). Right now the only thing pushed is a fresh
// pokedex-config from Benjakronk's admin panel; when one arrives, refresh the
// session's copy in the background so any screen that reads it (currently
// evolution.js) reflects it without the player hitting Reload Data.

import { EVENTS_URL, GameDataAPI, PokemonAPI } from '../api.js';
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
