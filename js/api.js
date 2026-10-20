// API Client for Pokemon D&D Tool
// Handles all communication with the pi-server (the same server that serves the app)

import { getSettings } from './utils/settings.js';
import { commitMove } from './utils/move-commit.js';
import { redactForViewer } from './utils/combat-visibility.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

// The app always talks to the pi-server that serves it (the Raspberry Pi, or a localhost test run). The Google Apps
// Script backend it fell back to when opened from GitHub Pages is gone (2026-10-18) -- opened there, the app only
// shows the "moved" banner (index.js).
export const ON_OLD_GITHUB_ADDRESS = window.location.hostname.endsWith('github.io');

const API_CONFIG = {
  baseUrl: `${window.location.origin}/api`,
  timeout: 30000 // 30 seconds
};

// Server-Sent Events stream for live push notifications (Pokedex-config pushes, combat, ...).
export const EVENTS_URL = ON_OLD_GITHUB_ADDRESS ? null : `${window.location.origin}/api/events`;

// ============================================================================
// CACHE MANAGER
// ============================================================================

/** Drops a trainer's Pokemon from the request cache, under both Settings > Animated Sprites values (see PokemonAPI.get). */
function forgetCachedPokemon(trainerName, pokemonName) {
  for (const animated of [0, 1]) cache.remove(`pokemon:${trainerName}:${pokemonName}:${animated}`);
}

/** The same for a trainer (TrainerAPI.get). */
function forgetCachedTrainer(trainerName) {
  for (const animated of [0, 1]) cache.remove(`trainer:${trainerName}:${animated}`);
}

class CacheManager {
  constructor(duration = 30 * 60 * 1000) { // 30 minutes default
    this.duration = duration;
  }

  get(key) {
    try {
      const item = localStorage.getItem(`cache:${key}`);
      if (!item) return null;

      const { data, timestamp, ttl } = JSON.parse(item);

      // Check if expired (per-entry TTL wins over the default)
      if (Date.now() - timestamp > (ttl || this.duration)) {
        this.remove(key);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  }

  set(key, data, ttl) {
    try {
      localStorage.setItem(`cache:${key}`, JSON.stringify({
        data,
        timestamp: Date.now(),
        ttl
      }));
    } catch (error) {
      console.error('Cache set error:', error);
    }
  }

  remove(key) {
    localStorage.removeItem(`cache:${key}`);
  }

  clear() {
    Object.keys(localStorage)
      .filter(key => key.startsWith('cache:'))
      .forEach(key => localStorage.removeItem(key));
  }
}

// The Pi is a fast same-origin server, so TTLs stay short -- they're a fallback bound,
// not the primary invalidation mechanism (that's cache.remove() calls on
// write, or the X-Data-Version header below).
const cache = new CacheManager(5 * 60 * 1000); // 5 minutes default

// TTL for static game data (moves, items, feats, natures, pokedex config).
// The Reset Cache button clears it manually, and the X-Data-Version response
// header clears it automatically whenever a data file on the Pi changes or the
// DM saves the Pokedex settings; the TTL is the fallback bound.
const STATIC_DATA_TTL = 2 * 60 * 60 * 1000; // 2 hours

// TTL for the registered/complete Pokemon lists. These grow every time a
// player registers a Pokemon, but that write doesn't move the server's data
// version, so X-Data-Version doesn't cover them -- unlike the truly
// static data above, this TTL is the only thing bounding staleness across
// devices.
const LIVE_LIST_TTL = 5 * 60 * 1000; // 5 minutes

// Heavy endpoints (login bundle, full game data) get a longer timeout so a
// slow server day degrades to "slow" instead of failing at 30s.
const HEAVY_TIMEOUT = 90000;

// ============================================================================
// API CLIENT
// ============================================================================

// The DM console's "Hide from the battle log": while on, every shared-battle request carries hideLog=1, and the server
// marks what it logs as hidden from the players (routes_combat.py's handle).
let _hideBattleLog = false;

export function setHideBattleLog(on) {
  _hideBattleLog = !!on;
}

export function hideBattleLogOn() {
  return _hideBattleLog;
}

class API {
  static async request(route, action, params = {}, options = {}) {
    // Shared-battle actions (route 'combat') change live state, so a timed-out one is never retried -- the first try may
    // have reached the server with only the answer lost (a retried advance-turn would skip a turn) -- and they give up
    // sooner, with a message that says what's wrong, instead of hanging a button for a minute.
    const isCombat = route === 'combat';
    const { useCache = true, cacheKey, cacheTtl, timeout = isCombat ? 15000 : API_CONFIG.timeout, retries = isCombat ? 0 : 1, bypassCache = false } = options;

    // Check cache first -- bypassCache skips this read (forces a network
    // fetch) but the cache is still warmed below, so other callers still
    // benefit from it.
    if (useCache && cacheKey && !bypassCache) {
      const cached = cache.get(cacheKey);
      if (cached) {
        console.log('Cache hit:', cacheKey);
        return cached;
      }
    }

    // Build URL
    const url = new URL(API_CONFIG.baseUrl);
    url.searchParams.append('route', route);
    url.searchParams.append('action', action);

    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, value);
      }
    });
    if (isCombat && _hideBattleLog) url.searchParams.append('hideLog', '1');

    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) {
        console.warn(`[API] Retrying ${route}/${action} (attempt ${attempt + 1}/${retries + 1})...`);
        await new Promise(res => setTimeout(res, 2000 * attempt));
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(url.toString(), {
          signal: controller.signal,
          headers: {
            'Accept': 'application/json'
          }
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        // Server-driven cache invalidation: the pi-server tags every response
        // with its data version (gamedata.data_version). When it changes (a
        // data file on the Pi changed, or the DM saved the Pokedex settings),
        // drop the locally cached game data so this device picks up the new
        // content on its next fetch.
        const dataVersion = response.headers.get('X-Data-Version');
        if (dataVersion && localStorage.getItem('dataVersion') !== dataVersion) {
          cache.clear();
          localStorage.setItem('dataVersion', dataVersion);
        }
        // Surfaced in the UI (home page / settings) as "last updated" — separate
        // from dataVersion above, which drives cache invalidation and is only
        // rewritten when the value actually changes.
        if (dataVersion) localStorage.setItem('lastDataUpdate', dataVersion);

        const data = await response.json();

        if (data.status === 'error') {
          // Most route handlers (pi-server/app/*.py) return their failure text
          // as `message`, not `error` -- only a couple of main.py's own
          // top-level wrappers use `error`. Checking `error` alone meant
          // almost every real server-side rejection showed as this generic
          // fallback instead of its actual reason.
          throw new Error(data.error || data.message || 'Unknown API error');
        }

        if (useCache && cacheKey) {
          cache.set(cacheKey, data, cacheTtl);
        }

        // The battle as this screen may see it: a player's device or a table screen never gets the DM's hidden creatures
        // or hidden log entries (combat-visibility.js -- a no-op on the DM console).
        if (isCombat && data?.data?.participants) redactForViewer(data.data);

        // A shared-battle action answers with the battle as it now is: shown at once, the same way a live push is,
        // instead of waiting for that push -- a phone's live connection can lag or silently die. (combat-wip.js keeps
        // only the newest copy -- see the session `version`.)
        if (isCombat && action !== 'get-state' && data?.data?.participants && Array.isArray(data.data.turnOrder)) {
          window.dispatchEvent(new CustomEvent('app:combat-updated', { detail: data.data }));
        }

        return data;

      } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
          lastError = new Error(isCombat
            ? 'No answer from the server -- check your connection, then try again.'
            : 'Request timeout - please try again');
          console.warn(`[API] Timeout on ${route}/${action} (attempt ${attempt + 1})`);
        } else if (isCombat && error instanceof TypeError) {
          // fetch's own network failure ("Failed to fetch") -- the connection to the Pi dropped.
          throw new Error("Can't reach the server -- check your connection, then try again.");
        } else {
          throw error; // non-timeout errors are not retried
        }
      }
    }

    throw lastError;
  }
}

// ============================================================================
// POKEMON API
// ============================================================================

export class PokemonAPI {
  /**
   * Get complete list of registered Pokemon
   */
  static async getRegisteredList() {
    return API.request('pokemon', 'registered-list', {}, {
      cacheKey: 'pokemon:registered-list',
      useCache: true,
      cacheTtl: LIVE_LIST_TTL,
      timeout: HEAVY_TIMEOUT
    });
  }

  /**
   * Get complete Pokemon data (all registered)
   */
  static async getCompleteList(forceRefresh = false) {
    return API.request('pokemon', 'list', {}, {
      cacheKey: 'pokemon:complete-list',
      useCache: true,
      bypassCache: forceRefresh,
      cacheTtl: LIVE_LIST_TTL,
      timeout: HEAVY_TIMEOUT
    });
  }

  /**
   * Get specific Pokemon info
   */
  static async get(trainerName, pokemonName, forceRefresh = false) {
    return API.request('pokemon', 'get', {
      trainer: trainerName,
      name: pokemonName,
      animated: getSettings().animatedSprites ? 1 : 0
    }, {
      cacheKey: `pokemon:${trainerName}:${pokemonName}:${getSettings().animatedSprites ? 1 : 0}`,
      bypassCache: forceRefresh
    });
  }

  /**
   * Register a newly caught Pokemon for a trainer. `choice` = {species, level, nature, loyalty, abilities: [slots],
   * heldItem, nickname, shiny}; the server builds the Pokemon (routes_pokemon.build_registered_pokemon).
   */
  static async register(trainerName, choice) {
    const pokemonData = choice;
    const result = await API.request('pokemon', 'register', {
      trainer: trainerName,
      data: JSON.stringify(pokemonData)
    }, {
      useCache: false
    });

    // Invalidate relevant caches
    forgetCachedTrainer(trainerName);
    cache.remove('pokemon:registered-list');

    return result;
  }

  /**
   * Update Pokemon data
   */
  static async update(pokemonData) {
    const result = await API.request('pokemon', 'update', {
      data: JSON.stringify(pokemonData)
    }, {
      useCache: false
    });

    // Invalidate cache (both picture settings -- see get)
    forgetCachedPokemon(pokemonData.trainer, pokemonData.name);

    return result;
  }

  /**
   * Release (permanently delete) a Pokemon from one trainer's box -- the
   * trainer+name pair is matched server-side the same case-insensitive way
   * every other pokemon lookup already is, so another trainer's copy of
   * the same species/nickname is never touched.
   */
  static async release(trainerName, pokemonName) {
    const result = await API.request('pokemon', 'delete', {
      trainer: trainerName,
      name: pokemonName
    }, {
      useCache: false
    });

    forgetCachedPokemon(trainerName, pokemonName);
    forgetCachedTrainer(trainerName);
    cache.remove('pokemon:registered-list');

    return result;
  }

  /**
   * Get evolution options for a Pokemon
   */
  static async getEvolutionOptions(dexEntry, limit = 20) {
    return API.request('pokemon', 'evolution-options', {
      dexEntry,
      limit
    });
  }

  /**
   * Check for a self-uploaded evolution transition video for this specific
   * pre-evolved -> evolved pair. Never cached -- must reflect whatever's
   * actually on disk right now, not a stale "no video" result from before
   * one was uploaded.
   */
  static async getEvolutionVideo(fromName, toName) {
    return API.request('pokemon', 'evolution-video', {
      from: fromName,
      to: toName
    }, {
      useCache: false,
      timeout: 6000,
      retries: 0
    });
  }

  /**
   * Check for a self-uploaded "use move" battle animation for this species.
   * Never cached -- same reasoning as getEvolutionVideo above. Short timeout
   * and no retry -- this is a cosmetic flourish preloaded well before the
   * player confirms a move (see utils/battle-animation.js), and the confirm
   * flow has no bound of its own while awaiting this lookup. If it's ever
   * left to the default 30s x (1 retry) it can hang the move-confirmation
   * popup for up to a minute with the Yes/No buttons disabled and no
   * loading feedback -- better to fail fast and just skip the animation.
   */
  static async getBattleAnimation(pokemonName) {
    return API.request('pokemon', 'battle-animation', {
      name: pokemonName
    }, {
      useCache: false,
      timeout: 6000,
      retries: 0
    });
  }

  /**
   * Update active party status
   */
  static async updatePartyStatus(trainerName, pokemonName, pokeslots, operation) {
    const result = await API.request('pokemon', 'party-status', {
      trainer: trainerName,
      pokemon: pokemonName,
      pokeslots,
      operation
    }, {
      useCache: false
    });

    // Invalidate trainer cache
    forgetCachedTrainer(trainerName);

    return result;
  }

  /**
   * Update utility slot
   */
  static async updateUtilitySlot(trainerName, pokemonName, operation) {
    const result = await API.request('pokemon', 'utility-slot', {
      trainer: trainerName,
      pokemon: pokemonName,
      operation
    }, {
      useCache: false
    });

    forgetCachedTrainer(trainerName);
    return result;
  }

  /**
   * Update Pokemon live stats (HP, VP, AC)
   */
  static async updateLiveStats(trainerName, pokemonName, stat, value) {
    return API.request('pokemon', 'live-stats', {
      trainer: trainerName,
      pokemon: pokemonName,
      stat,
      value
    }, {
      useCache: false
    });
  }

  /**
   * Recalculate Pokemon stats based on feats
   */
  static async recalculateStats(pokemonData, oldFeats) {
    return API.request('pokemon', 'recalculate-stats', {
      data: JSON.stringify(pokemonData),
      oldFeats: JSON.stringify(oldFeats || [])
    }, {
      useCache: false
    });
  }

  /**
   * Get abilities for a specific Pokemon species: [{slot, name, description}] (they were "slot:Name, Description" text
   * before 2026-10-19 -- a new cache key, so an answer cached in that form is never read)
   */
  static async getAbilities(pokemonName) {
    return API.request('pokemon', 'abilities', {
      name: pokemonName
    }, {
      cacheKey: `pokemon:species-abilities:${pokemonName}`,
      useCache: true,
      cacheTtl: STATIC_DATA_TTL
    });
  }

  /**
   * Evolve a Pokemon
   */
  /**
   * Evolve a Pokemon into `targetSpecies`, with the ability-score points the player spent ({str: 1, ...}) -- the
   * server builds the evolved Pokemon (owned.evolve) and stores it in its place.
   */
  static async evolve(currentPokemonName, trainerName, targetSpecies, points) {
    const result = await API.request('pokemon', 'evolve', {
      currentName: currentPokemonName,
      trainer: trainerName,
      target: targetSpecies,
      points: JSON.stringify(points || {})
    }, {
      useCache: false
    });

    // Invalidate relevant caches
    forgetCachedPokemon(trainerName, currentPokemonName);
    forgetCachedPokemon(trainerName, targetSpecies);
    forgetCachedTrainer(trainerName);

    return result;
  }
}

// ============================================================================
// TRAINER API
// ============================================================================

export class TrainerAPI {
  /**
   * Get all trainers
   */
  static async getAll() {
    return API.request('trainer', 'list', {}, {
      cacheKey: 'trainers:all',
      useCache: true
    });
  }

  /**
   * Get specific trainer with their Pokemon
   */
  static async get(name) {
    const animated = getSettings().animatedSprites ? 1 : 0;
    return API.request('trainer', 'get', { name, animated }, {
      cacheKey: `trainer:${name}:${animated}`,
      useCache: true,
      timeout: HEAVY_TIMEOUT
    });
  }

  /**
   * Batched login call: trainer + pokemon + game data + registered list +
   * pokedex config in one request. Requires a backend with the get-full
   * route deployed — callers should fall back to the individual calls if
   * this throws. Never cached: live trainer stats must be fresh.
   */
  static async getFull(name) {
    return API.request('trainer', 'get-full', { name, animated: getSettings().animatedSprites ? 1 : 0 }, {
      useCache: false,
      timeout: HEAVY_TIMEOUT
    });
  }

  /**
   * Create a new trainer from the new-journey form's fields -- the answer's `trainer` is the trainer as made.
   */
  static async create(trainerData) {
    const result = await API.request('trainer', 'create', {
      data: JSON.stringify(trainerData)
    }, {
      useCache: false
    });

    // Invalidate trainers list cache
    cache.remove('trainers:all');

    return result;
  }

  /**
   * Save the whole trainer (the object in sessionStorage's trainerData -- js/utils/trainer-data.js).
   */
  static async update(trainerData) {
    const result = await API.request('trainer', 'update', {
      data: JSON.stringify(trainerData)
    }, {
      useCache: false
    });

    forgetCachedTrainer(trainerData.name);
    return result;
  }

  /**
   * Update trainer money
   */
  static async updateMoney(trainerName, amount) {
    const result = await API.request('trainer', 'money', {
      trainer: trainerName,
      amount
    }, {
      useCache: false
    });

    forgetCachedTrainer(trainerName);
    return result;
  }

  /**
   * Update trainer live stats (HP, VP, AC)
   */
  static async updateLiveStats(trainerName, stat, value) {
    return API.request('trainer', 'live-stats', {
      trainer: trainerName,
      stat,
      value
    }, {
      useCache: false
    });
  }

  /**
   * Update trainer affinity
   */
  static async updateAffinity(trainerName, affinity) {
    const result = await API.request('trainer', 'affinity', {
      trainer: trainerName,
      affinity
    }, {
      useCache: false
    });

    // Invalidate trainer cache
    forgetCachedTrainer(trainerName);

    return result;
  }

  /**
   * Update trainer specialization
   */
  static async updateSpecialization(trainerName, specialization) {
    const result = await API.request('trainer', 'specialization', {
      trainer: trainerName,
      specialization
    }, {
      useCache: false
    });

    // Invalidate trainer cache
    forgetCachedTrainer(trainerName);

    return result;
  }
}

// ============================================================================
// GAME DATA API
// ============================================================================

export class GameDataAPI {
  /**
   * Load all game data at once
   */
  static async getAll() {
    return API.request('game-data', 'all', {}, {
      cacheKey: 'game-data:all',
      useCache: true,
      cacheTtl: STATIC_DATA_TTL,
      timeout: HEAVY_TIMEOUT
    });
  }

  /**
   * Load conduit-specific game data
   */
  static async getConduit() {
    return API.request('game-data', 'conduit', {}, {
      cacheKey: 'game-data:conduit',
      useCache: true,
      cacheTtl: STATIC_DATA_TTL,
      timeout: HEAVY_TIMEOUT
    });
  }

  /**
   * Get move data
   */
  static async getMoves() {
    return API.request('game-data', 'moves', {}, {
      cacheKey: 'game-data:moves',
      useCache: true,
      cacheTtl: STATIC_DATA_TTL
    });
  }

  /**
   * Get nature data
   */
  static async getNatures() {
    return API.request('game-data', 'natures', {}, {
      cacheKey: 'game-data:natures',
      useCache: true,
      cacheTtl: STATIC_DATA_TTL
    });
  }

  /**
   * Calculate type effectiveness
   */
  static async getTypeEffectiveness(type1, type2 = null) {
    const params = { type1 };
    if (type2) params.type2 = type2;

    return API.request('game-data', 'type-effectiveness', params, {
      cacheKey: `type-effectiveness:${type1}${type2 ? ':' + type2 : ''}`,
      cacheTtl: STATIC_DATA_TTL
    });
  }

  /**
   * Get Pokedex config (visibility settings, defaults, etc.)
   */
  static async getPokedexConfig(forceRefresh = false) {
    return API.request('game-data', 'pokedex-config', {}, {
      cacheKey: 'game-data:pokedex-config',
      useCache: true,
      bypassCache: forceRefresh,
      cacheTtl: STATIC_DATA_TTL
    });
  }

  /**
   * The players' Pokedex (pokedex.html): the registered species with only what the DM lets them see, and the moves
   * they may look up -- pi-server's player_pokedex.py does the hiding. Never cached: the DM's changes show at once.
   */
  static async getPlayerPokedex() {
    return API.request('game-data', 'player-pokedex', {}, { useCache: false, timeout: HEAVY_TIMEOUT });
  }

}

// ============================================================================
// MUSIC SYNC API
// ============================================================================

// Stable per-tab identity for music presence tracking. sessionStorage (not
// localStorage) so a new tab reads as a genuinely new listener, matching
// how a fresh device joining the room should behave.
function getMusicClientId() {
  let id = sessionStorage.getItem('musicClientId');
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    sessionStorage.setItem('musicClientId', id);
  }
  return id;
}

export class MusicAPI {
  /**
   * Join (or heartbeat-renew presence on) the shared start-time anchor for a
   * looping background track, so every device seeks to the same point in the
   * loop instead of starting from 0. The room is considered empty -- and the
   * epoch resets -- once no listener has synced/heartbeated in a while server-
   * side; see routes_music.py. Throws when the request fails -- callers should fall back to local playback.
   */
  static async sync(trackName) {
    return API.request('music', 'sync', { track: trackName, client: getMusicClientId() }, {
      useCache: false,
      timeout: 5000,
      retries: 0
    });
  }

  /**
   * Fire-and-forget: tells the server this device stopped listening to
   * trackName, so the room can go empty immediately instead of waiting for
   * this listener's heartbeat to go stale. keepalive lets the request
   * survive a page navigation/reload that happens right after.
   */
  static leave(trackName) {
    const url = `${API_CONFIG.baseUrl}?route=music&action=leave`
      + `&track=${encodeURIComponent(trackName)}&client=${encodeURIComponent(getMusicClientId())}`;
    fetch(url, { keepalive: true }).catch(() => {});
  }
}

// ============================================================================
// COMBAT API (new shared combat tool -- see pi-server/app/routes_combat.py)
// ============================================================================

export class CombatAPI {
  /** Current session state (or {active:false, ...} if none). Never cached --
   * must always reflect the live session, and live-updates.js already keeps
   * callers fresh via SSE without needing a poll. */
  static async getState() {
    return API.request('combat', 'get-state', {}, { useCache: false });
  }

  /** A PvP battle (players fight each other). PvE battles are started by the DM console instead (DmAPI.startBattle) --
   * the server refuses battleType 'pve' here. */
  static async createSession(battleType = 'pvp') {
    return API.request('combat', 'create-session', { battleType }, { useCache: false });
  }

  static async endSession() {
    return API.request('combat', 'end-session', {}, { useCache: false });
  }

  /** Removes just this trainer's own participants -- see routes_combat.py's
   * _leave_session docstring for why this exists instead of endSession()
   * (which resets the shared session for every player at once). */
  static async leaveSession(owner) {
    return API.request('combat', 'leave-session', { owner }, { useCache: false });
  }

  static async addParticipant(participant) {
    return API.request('combat', 'add-participant', { data: JSON.stringify(participant) }, { useCache: false });
  }

  /** The DM, during an adventure: { onScreen: 'adventure' | 'region', canJoin, canMove } -- any of them (routes_combat.py's
   * _set_adventure_settings). */
  static async adventureSettings({ onScreen, canJoin, canMove } = {}) {
    const params = {};
    if (onScreen) params.onScreen = onScreen;
    if (canJoin !== undefined) params.canJoin = canJoin ? '1' : '0';
    if (canMove !== undefined) params.canMove = canMove ? '1' : '0';
    return API.request('combat', 'adventure-settings', params, { useCache: false });
  }

  static async removeParticipant(id) {
    return API.request('combat', 'remove-participant', { id }, { useCache: false });
  }

  static async setStatus(id, status) {
    return API.request('combat', 'set-status', { id, status }, { useCache: false });
  }

  /** The DM console: a wild Pokemon the players caught leaves the battle, remembered as caught for the aftermath --
   * `givenTo`: the trainer it was already given to (the catch popup's "Caught by"). */
  static async capture(id, givenTo = '') {
    return API.request('combat', 'capture', { id, ...(givenTo ? { givenTo } : {}) }, { useCache: false });
  }

  /** The DM console: one of the DM's Pokemon marked catchable (a Poke Ball on its card, the DM's screens only) or not. */
  static async setCatchable(id, catchable) {
    return API.request('combat', 'set-catchable', { id, catchable: catchable ? '1' : '0' }, { useCache: false });
  }

  static async setVisibility(id, field, visible) {
    return API.request('combat', 'set-visibility', { id, field, visible: visible ? 1 : 0 }, { useCache: false });
  }

  /** Several of the players' visibility fields at once ({field: true/false}) -- the DM console's Pokedex button. */
  static async setVisibilityMany(id, fields) {
    return API.request('combat', 'set-visibility-many', { id, fields: JSON.stringify(fields) }, { useCache: false });
  }

  /** The DM changes one of its creatures mid-battle (any stat-block field -- routes_combat.py's _dm_update_participant). */
  static async dmUpdateParticipant(id, data) {
    return API.request('combat', 'dm-update-participant', { id, data: JSON.stringify(data) }, { useCache: false });
  }

  static async advanceTurn() {
    return API.request('combat', 'advance-turn', {}, { useCache: false });
  }

  static async reactionStart(id) {
    return API.request('combat', 'reaction-start', { id }, { useCache: false });
  }

  /** Spends the participant's bonus action for the round (refreshed on their next turn); rejects if already spent. */
  static async useBonusAction(id, move = '') {
    return API.request('combat', 'use-bonus-action', { id, move }, { useCache: false });
  }

  static async reactionEnd() {
    return API.request('combat', 'reaction-end', {}, { useCache: false });
  }

  /** Opens a "does anyone want to react?" window (see move-effects-schema.md's
   * reaction section / routes_combat.py's own docstring on this) -- trigger is
   * 'targeted' (anchorId = the target, called right after picking one, before
   * the attack roll) or 'damaged' (anchorId = whoever just took damage, called
   * right after applying it). Resolves to {opened: false} when nobody's
   * eligible (proceed immediately, nothing to wait for) or {opened: true} (see
   * utils/reaction-window.js for actually waiting it out). */
  static async openReactionWindow(trigger, anchorId, attackerId, moveName) {
    return API.request('combat', 'open-reaction-window', { trigger, anchorId, attackerId, moveName }, { useCache: false });
  }

  static async declineReaction(id) {
    return API.request('combat', 'decline-reaction', { id }, { useCache: false });
  }

  /** Called from combat-wip.js's _offerMoveEffects when a reactor's own move
   * applies a `block_attack` effect (Protect, King's Shield, ...) -- marks
   * the CURRENT pending reaction's attack as blocked, so the attacker's own
   * waitForReactionWindow (utils/reaction-window.js) knows to skip the
   * attack roll/damage step once the window closes. `id` must be the
   * blocker, currently holding the floor via reaction-start for a real
   * pending window -- see routes_combat.py's own _block_pending_attack. */
  static async blockPendingAttack(id, moveName = '') {
    commitMove(); // a move waiting to be paid for is paid now (move-commit.js)
    return API.request('combat', 'block-pending-attack', { id, moveName }, { useCache: false });
  }

  /** Feint's own mechanism -- `id` is the ORIGINAL ATTACKER of a block just
   * recorded (never the blocker/reactor), undoing it and resolving the
   * attack normally; see routes_combat.py's own _negate_reaction_block for
   * the identity check and the VP cost/refund it bundles in. Rejects if
   * `id` isn't that attack's own attacker, or it was already bypassed. */
  static async negateReactionBlock(id) {
    return API.request('combat', 'negate-reaction-block', { id }, { useCache: false });
  }

  /** Wide Guard's own mechanism -- `id` is the REACTOR (the one holding the
   * floor via reaction-start), same caller shape as blockPendingAttack, not
   * negateReactionBlock's attacker-identity one. See routes_combat.py's own
   * _apply_reaction_damage_multiplier. */
  static async applyReactionDamageMultiplier(id, multiplier, pool = null) {
    commitMove(); // a move waiting to be paid for is paid now (move-commit.js)
    return API.request('combat', 'apply-reaction-damage-multiplier', { id, multiplier, ...(pool ? { pool } : {}) }, { useCache: false });
  }

  /** Called once the caller's own local clock reaches the window's expiresAt
   * -- server refuses (rejects the promise) while someone's actively
   * reacting, never force-closing mid-use; the caller just retries shortly
   * after (see utils/reaction-window.js). */
  static async closeReactionWindow() {
    return API.request('combat', 'close-reaction-window', {}, { useCache: false });
  }

  /** Fire-and-forget cue for the display module to play a species' battle
   * animation clip right now -- not session state, nothing to await beyond
   * the request landing. */
  static async playAnimation(id, species) {
    return API.request('combat', 'play-animation', { id, species }, { useCache: false });
  }

  /**
   * The generic move-use mechanic: id must be whoever currently has the
   * floor (active turn or mid-reaction) -- the server enforces this and
   * rejects it otherwise. VP cost is looked up server-side from the moves
   * dataset, not sent from here. diceRoll is the raw number rolled at the
   * table (there's no digital dice in this game) -- the server converts it
   * to actual damage against targetId using the move's type vs. the
   * target's stored type(s); omit both targetId and diceRoll for a
   * self-only move. Resolves to { status, data: <session>, multiplier,
   * damageApplied } when a target was hit. Also triggers the display
   * module's animation playback for this species.
   */
  static async useMove(id, move, { targetId, diceRoll, species } = {}) {
    return API.request('combat', 'use-move', { id, move, targetId, diceRoll, species }, { useCache: false });
  }

  /** Client-authoritative HP/VP sync -- see routes_combat.py's _update_stats
   * docstring for why this exists (combat.js's own per-move mechanics --
   * VP cost, Ingrain/direct/drain heals, manual adjusters -- aren't ported
   * server-side, so the client computes the new value locally and just
   * reports where it landed). Omit a field to leave it untouched. */
  static async updateStats(id, { currentHP, currentVP } = {}) {
    return API.request('combat', 'update-stats', { id, currentHP, currentVP }, { useCache: false });
  }

  /** Covet/Thief's own mechanism -- sets a participant's whole `item` field
   * (a comma-separated freeform string, see routes_combat.py's own
   * _update_item), same client-authoritative sync model as updateStats. */
  static async updateItem(id, item) {
    return API.request('combat', 'update-item', { id, item }, { useCache: false });
  }

  /** Reports a combatant's manual stat edits (AC, ability scores + modifiers, crit
   * modifier) so every other player's popups use them -- BASE values, without the
   * live status deltas (see routes_combat.py's update-base-stats and
   * utils/stat-sync.js). */
  static async updateBaseStats(id, stats) {
    return API.request('combat', 'update-base-stats', { id, stats: JSON.stringify(stats) }, { useCache: false });
  }

  /** Puts a live effect (condition / stat modifier / advantage-disadvantage) on
   * a participant -- `status` is a move-effects entry (see move-effects-schema.md,
   * built by move-effects.js's buildStatusSpec) with rounds durations already
   * rolled to an `n`. Re-applying the same effect from the same move refreshes or
   * stacks it; the server expires it from its `ends`. See routes_combat.py. */
  static async applyStatus(targetId, status) {
    commitMove(); // a move waiting to be paid for is paid now (move-commit.js)
    return API.request('combat', 'apply-status', { targetId, status: JSON.stringify(status) }, { useCache: false });
  }

  /** A custom status condition's popup closed (routes_combat.py's statusNotices). */
  static async dismissNotice(id) {
    return API.request('combat', 'dismiss-notice', { id }, { useCache: false });
  }

  /** Removes one live effect by its id (a passed save, a manual cure...). */
  static async removeStatus(targetId, statusId, reason = '') {
    commitMove(); // a move waiting to be paid for is paid now (move-commit.js)
    return API.request('combat', 'remove-status', { targetId, statusId, reason }, { useCache: false });
  }

  /** Consumes one use of an effect that lasts "the next attack"/"next roll". */
  static async useStatus(targetId, statusId) {
    commitMove(); // a move waiting to be paid for is paid now (move-commit.js)
    return API.request('combat', 'use-status', { targetId, statusId }, { useCache: false });
  }

  /** Resolves an attack against a chosen target -- the other half of
   * use-move, split out so it doesn't double-deduct VP that combat.js's own
   * local move-popup flow (synced via updateStats) already spent. diceRoll
   * is expected to already include the caller's own damage modifier (the
   * same figure combat.js's move popup already computes and shows) --
   * this endpoint only applies type effectiveness on top of it. `crit`
   * (default false) is recorded on the damage log entry itself -- the
   * REACTOR of a later 'damaged' reaction (Lucky Chant) has no other way to
   * know whether the hit that just landed on them was a crit, since that's
   * only ever computed on the ATTACKER's own device (combat-wip.js's
   * _resolveOneHit). `pool` ('hp', the default, or 'vp') -- Energize/
   * Enervation Ray's own "damage_vp" category drains VP instead, see
   * combat-wip.js's _applyPrimaryDamage. Returns {multiplier,
   * damageApplied} alongside the usual {status, data}. */
  static async applyDamage(id, targetId, diceRoll, moveType, species, moveName, crit = false, pool = 'hp', soften = null) {
    commitMove(); // a move waiting to be paid for is paid now (move-commit.js)
    const extra = soften ? { softenHolderId: soften.holderId, softenAbility: soften.ability, softenIndex: soften.index } : {};
    return API.request('combat', 'apply-damage', { id, targetId, diceRoll, moveType, species, moveName, crit, pool, ...extra }, { useCache: false });
  }

  /** What applyDamage WOULD do, without changing anything: {damageApplied, targetFainted, multiplier, hpBefore} under
   * `data` -- the target's Sturdy / Fur Coat is asked off this before the hit lands. */
  static async previewDamage(id, targetId, diceRoll, moveType, moveName, crit = false, pool = 'hp') {
    return API.request('combat', 'apply-damage', { id, targetId, diceRoll, moveType, moveName, crit, pool, preview: true }, { useCache: false });
  }

  /** Fire Shield's passive retaliation -- `id` is the shield HOLDER, `targetId` the creature that
   * just hit them in melee; the server checks the holder really has the status and applies the
   * rolled damage off-turn (routes_combat.py's _apply_retaliation). */
  static async applyRetaliation(id, targetId, diceRoll) {
    commitMove(); // a move waiting to be paid for is paid now (move-commit.js)
    return API.request('combat', 'apply-retaliation', { id, targetId, diceRoll }, { useCache: false });
  }

  /** Electrify's own mechanism -- `id` is the REACTOR, retroactively
   * recomputing their own most recent damage entry as if it had been
   * `newType`-typed all along (see routes_combat.py's own
   * _retype_last_damage). Returns {oldAmount, newAmount} alongside the
   * usual {status, data}. */
  static async retypeLastDamage(id, newType) {
    return API.request('combat', 'retype-last-damage', { id, newType }, { useCache: false });
  }

  /** Appends one entry to the shared battle log (routes_combat.py's 'log')
   * for a mechanic that only ever happens client-side -- status effects,
   * heal-popup amounts, an attack roll declared a Miss, etc. -- see
   * routes_combat.py's log-event action docstring for the trust model. */
  static async logEvent({ type, text, actorId, actorName, targetId, targetName, move }) {
    return API.request('combat', 'log-event', { type, text, actorId, actorName, targetId, targetName, move }, { useCache: false });
  }

  // -- Battle map (see pi-server/app/routes_combat.py's 'board' state) --
  // A second, separate display, purely spatial (positions/terrain, never
  // HP/VP) shown alongside the combat screen these other methods drive.

  static async setBoardTemplate(cols, rows) {
    return API.request('combat', 'set-board-template', { cols, rows }, { useCache: false });
  }

  /** Empty-string terrain clears the cell. */
  static async setCellTerrain(col, row, terrain) {
    return API.request('combat', 'set-cell-terrain', { col, row, terrain }, { useCache: false });
  }

  /** DM/setup placement -- NOT turn-gated, moves any token any time. */
  /** Forced altitude change (Smack Down to the ground, Skyward Soar 60ft up) -- not the creature's own movement. */
  static async setTokenAltitude(id, z) {
    commitMove(); // a move waiting to be paid for is paid now (move-commit.js)
    return API.request('combat', 'set-token-altitude', { id, z }, { useCache: false });
  }

  static async setTokenPosition(id, col, row) {
    commitMove(); // a move waiting to be paid for is paid now (move-commit.js)
    return API.request('combat', 'set-token-position', { id, col, row }, { useCache: false });
  }

  /** A player moving their own token during combat -- server rejects this
   * unless id is whoever currently has the floor (active turn or
   * mid-reaction), same authority check as useMove. */
  static async moveToken(id, col, row, z) {
    // z (altitude in feet, 5ft steps) is only sent when it changes; omitted = stay at the current altitude.
    return API.request('combat', 'move-token', { id, col, row, ...(z === undefined ? {} : { z }) }, { useCache: false });
  }

  /** Prone's own escape action -- stands up (ending Prone), costing half the
   * participant's fastest movement speed for the round (see routes_combat.py's
   * _stand_up). Rejected the same way move-token is if there isn't enough
   * movement left this turn, or if the participant isn't actually prone. */
  static async standUp(id) {
    return API.request('combat', 'stand-up', { id }, { useCache: false });
  }

  /** An ability effect the client detected (being hit, hitting): the server checks `holderId` has it and applies it
   * (routes_combat.py's _ability_trigger). `amount` = the rolled number when the effect has dice. */
  /** An ability moment the app spotted but can't play out -- the server logs it and pops it up for the trainers involved. */
  static async abilityReminder(holderId, ability, index, aboutId = null) {
    return API.request('combat', 'ability-reminder', { id: holderId, ability, index, ...(aboutId ? { aboutId } : {}) }, { useCache: false });
  }

  static async abilityTrigger(holderId, ability, index, targetId, amount = null, value = null, spend = false) {
    return API.request('combat', 'ability-trigger', {
      id: holderId, ability, index, targetId, ...(amount != null ? { amount } : {}), ...(value != null ? { value } : {}),
      ...(spend ? { spend: 1 } : {}), // an activated ability: spend its action / bonus action (once per use)
    }, { useCache: false });
  }

  /** The type multiplier a hit would get (chart + live type changes + abilities) -- read-only (routes_combat.py's _type_preview). */
  static async typePreview(attackerId, targetId, moveType, moveName = '') {
    return API.request('combat', 'type-preview', { id: attackerId, targetId, moveType, moveName }, { useCache: false });
  }

  /** Rapid Orders: on the trainer's turn, their Pokemon takes an extra action now (routes_combat.py's _rapid_orders). */
  static async rapidOrders(trainerId, pokemonId) {
    return API.request('combat', 'rapid-orders', { id: trainerId, targetId: pokemonId }, { useCache: false });
  }

  /** Hold Action: keeps the action for a trigger and ends the turn (routes_combat.py's _hold_action). */
  static async holdAction(id) {
    return API.request('combat', 'hold-action', { id }, { useCache: false });
  }

  /** Takes a held action outside the holder's turn -- the floor until its End Turn (routes_combat.py's _use_held_action). */
  static async useHeldAction(id) {
    return API.request('combat', 'use-held-action', { id }, { useCache: false });
  }

  /** Disengage: spends the action; moving away this turn provokes no reactions (routes_combat.py's _disengage). */
  static async disengage(id) {
    return API.request('combat', 'disengage', { id }, { useCache: false });
  }

  /** Bide's own two-phase toggle (see routes_combat.py's _bide_use) -- same
   * call either way, the server decides activate vs. resolve from the
   * participant's own current state. `hold` (10th level+ only) keeps
   * charging for one more turn instead of resolving -- ignored/harmless on
   * the activate call, only meaningful while already charging. */
  static async bideUse(id, hold = false) {
    commitMove(); // a move waiting to be paid for is paid now (move-commit.js)
    return API.request('combat', 'bide-use', { id, hold }, { useCache: false });
  }

  static async clearTokenPosition(id) {
    return API.request('combat', 'clear-token-position', { id }, { useCache: false });
  }

  /** The per-player placement step -- sets position AND marks the
   * participant placed in one call. Not turn-gated (happens pre-battle). */
  static async confirmPlacement(id, col, row, facing = null, z = null) {
    return API.request('combat', 'confirm-placement', { id, col, row, ...(facing === null ? {} : { facing }), ...(z === null ? {} : { z }) }, { useCache: false });
  }

  /** Fire-and-forget live preview of where a player is currently considering
   * placing a token, for other placement screens to render as a ghost.
   * Omit col/row to signal "stopped hovering" (clears the ghost). */
  static async hoverToken(id, col, row) {
    return API.request('combat', 'hover-token', { id, col, row }, { useCache: false });
  }

  /** A question for the player who controls participant `id` (a roll, a "use it?" or a save -- routes_combat.py's
   * _ask_prompt). `args` is the popup's settings; resolves with `promptId` alongside the usual {status, data}. */
  static async askPrompt(id, kind, args, askedBy) {
    return API.request('combat', 'prompt-ask', { id, kind, args: JSON.stringify(args || {}), askedBy }, { useCache: false });
  }

  /** The owner's answer to a prompt (any JSON value; null = closed without answering). */
  static async answerPrompt(promptId, answer) {
    return API.request('combat', 'prompt-answer', { promptId, answer: JSON.stringify(answer ?? null) }, { useCache: false });
  }

  static async clearPrompt(promptId) {
    return API.request('combat', 'prompt-clear', { promptId }, { useCache: false });
  }

  /** Battle-map background images available on the Pi (see
   * media.BATTLE_IMAGE_DIR) -- {status, backgrounds: [{key, label, url}]}.
   * Not session state -- safe to call any time, active session or not. */
  static async listBackgrounds() {
    return API.request('combat', 'list-backgrounds', {}, { useCache: false });
  }

  /** {status, categories: {moveName: [category, ...]}, effects: {moveName:
   * [effect, ...]}} -- the user's own manual move categorization plus the
   * structured status effects (see routes_combat.py's list-move-categories
   * action). Cacheable -- the file only changes between deploys, not
   * within a single page session. */
  static async listMoveCategories() {
    return API.request('combat', 'list-move-categories', {}, { useCache: true, cacheKey: 'move-categories', cacheTtl: 300000 });
  }

  /** Sets the shared board's background image (empty string clears it). */
  /** The DM moves / turns / lifts any creature, any time, without using its movement ({col, row, facing, z}). */
  /** The DM gives any creature a turn out of order -- the turn order resumes after it (routes_combat.py's _dm_give_turn). */
  static async dmGiveTurn(id) {
    return API.request('combat', 'dm-give-turn', { id }, { useCache: false });
  }

  /** The DM's size override for a creature: Tiny / Small / Medium / Large / Huge / Gigantic (_dm_set_size). */
  static async dmSetSize(id, size) {
    return API.request('combat', 'dm-set-size', { id, size }, { useCache: false });
  }

  static async dmPlaceToken(id, { col, row, facing, z }) {
    return API.request('combat', 'dm-place-token', { id, col, row, facing, z }, { useCache: false });
  }

  static async setBoardBackground(url) {
    return API.request('combat', 'set-board-background', { url }, { useCache: false });
  }

  /** Sets the shared session's weather/terrain (see routes_combat.py's
   * set-weather/set-terrain) -- empty name clears it. */
  /** `extra` is only passed by a weather MOVE: { rounds, sourceId, sourceName, casterLevel, concentration, cells }
   * (see routes_combat.py's _set_weather) -- `cells` limits it to those tiles, otherwise it covers the whole map. */
  /** Chill / Superheat / Stormwind: the whole map's environment ('cold' | 'hot' | 'windy'); an empty name clears it. */
  static async setEnvironment(name, kind = '', extra = {}) {
    commitMove(); // a move waiting to be paid for is paid now (move-commit.js)
    return API.request('combat', 'set-environment', { name, kind, ...extra }, { useCache: false });
  }

  /** Dragon Tail: the target's trainer must switch it out (their client opens the switch picker). */
  static async requestForcedSwitch(id, moveName, sourceId) {
    commitMove(); // a move waiting to be paid for is paid now (move-commit.js)
    return API.request('combat', 'request-forced-switch', { id, moveName, sourceId }, { useCache: false });
  }

  static async clearForcedSwitch() {
    return API.request('combat', 'clear-forced-switch', {}, { useCache: false });
  }

  static async setWeather(name, effect, extra = {}) {
    commitMove(); // a move waiting to be paid for is paid now (move-commit.js)
    const { cells, ...rest } = extra;
    return API.request('combat', 'set-weather', { name, effect, ...rest, ...(cells?.length ? { cells: JSON.stringify(cells) } : {}) }, { useCache: false });
  }

  /** Ends one tile-limited zone by hand (kind: 'terrain' | 'weather') -- e.g. a Hail whose caster lost concentration. */
  static async removeFieldZone(kind, id) {
    return API.request('combat', 'remove-field-zone', { kind, id }, { useCache: false });
  }

  /** `extra` is only passed by a terrain MOVE: { rounds, healDice, sourceId, sourceName, cells } (see
   * routes_combat.py's _set_terrain). `cells` (["col,row", ...]) limits it to those tiles; without it the
   * terrain covers the whole map. */
  static async setTerrain(name, effect, extra = {}) {
    commitMove(); // a move waiting to be paid for is paid now (move-commit.js)
    const { cells, props, ...rest } = extra;
    return API.request('combat', 'set-terrain', {
      name, effect, ...rest,
      ...(cells?.length ? { cells: JSON.stringify(cells) } : {}),
      // Zone rules a move attaches: { rule, hazard, difficult, critReduction, concentration, untilSourceTurn } (routes_combat.py's _ZONE_PROPS).
      ...(props ? { props: JSON.stringify(props) } : {}),
    }, { useCache: false });
  }

  /** Switch Pokemon (shared battle): `id` goes to the bench, `inId` takes its place on the map and in the turn order. `pass`
   * is Baton Pass -- the outgoing Pokemon's statuses go with it. */
  static async switchPokemon(id, inId, pass = false, tile = null, move = null) {
    // `tile` ({col, row}) is where the newcomer is sent out (within 20ft of its trainer); the server picks the nearest free tile without one.
    // `move`: the move whose effect does the switching (U-turn, Baton Pass...) -- the one way to switch on the Pokemon's own turn.
    return API.request('combat', 'switch-pokemon', { id, inId, pass: pass ? '1' : '', ...(tile ? { col: tile.col, row: tile.row } : {}), ...(move ? { move } : {}) }, { useCache: false });
  }

  /** The answer to a concentration check (session.concentrationChecks): 'pass', 'fail' (ends all its concentration) or
   * 'skip' (closed -- handled by hand). `note` is the roll, for the log. */
  static async concentrationSave(checkId, outcome, note = '') {
    return API.request('combat', 'concentration-save', { checkId, outcome, note }, { useCache: false });
  }

  /** Block: stops the switch-out that is waiting on the open `switch_out` reaction window. */
  static async cancelPendingSwitch(id) {
    return API.request('combat', 'cancel-pending-switch', { id }, { useCache: false });
  }

  /** Lunar Dance / Healing Wish: the trainer's next Pokemon to enter the battle is healed and cured (`mode`: 'lunar' | 'wish'). */
  static async queueSwitchHeal(id, mode) {
    return API.request('combat', 'queue-switch-heal', { id, mode }, { useCache: false });
  }

  /** Quash: moves the target to the bottom of this round's initiative order (restored when the next round begins). */
  static async quash(id) {
    commitMove(); // a move waiting to be paid for is paid now (move-commit.js)
    return API.request('combat', 'quash', { id }, { useCache: false });
  }

  /** Tragic Hero: the ally gets the floor for an extra turn the moment `id` (the caster) ends their reaction. */
  static async grantExtraTurn(id, targetId, moveName = '') {
    commitMove(); // a move waiting to be paid for is paid now (move-commit.js)
    return API.request('combat', 'grant-extra-turn', { id, targetId, moveName }, { useCache: false });
  }

  /** Trick Room: reverses (or, used again, un-reverses) the initiative order from the start of the next round. */
  static async trickRoom() {
    commitMove(); // a move waiting to be paid for is paid now (move-commit.js)
    return API.request('combat', 'trick-room', {}, { useCache: false });
  }

  /** Resolves a queued Spikes-style hazard hit: `roll` is the damage total, halved when `saved`; no roll dismisses it. */
  static async resolveHazard(id, roll, saved, failedBy = null) {
    return API.request('combat', 'resolve-hazard', { id, roll: roll ?? '', saved: saved ? '1' : '', failedBy: failedBy ?? '' }, { useCache: false });
  }

  /** Removes every tile-limited terrain zone (Defog's clear_field also clears the whole-map terrain). */
  static async clearTerrainZones() {
    return API.request('combat', 'clear-terrain-zones', {}, { useCache: false });
  }

  /** Turns a token on the spot (degrees clockwise from up, snapped to 45) -- turn-gated like moveToken, no movement cost. */
  static async rotateToken(id, facing) {
    return API.request('combat', 'rotate-token', { id, facing }, { useCache: false });
  }
}

// ============================================================================
// DM CONSOLE API (dm-console.html -- see pi-server/app/routes_dm.py)
// ============================================================================

export class DmAPI {
  /** Every species in the encyclopedia (not only the ones unlocked for players), as compact summaries for the
   * enemy picker: {name, dex, type1, type2, size, rarity, habitat, behavior, activity, evolution, level, abilities,
   * image (the animated sprite if there is one), picture (the still one)}. (The cache key's version goes up when the
   * shape or the pictures change, so no device keeps an old copy.) */
  static async speciesList() {
    return API.request('dm', 'species-list', {}, {
      cacheKey: 'dm:species-list-v4', useCache: true, cacheTtl: STATIC_DATA_TTL, timeout: HEAVY_TIMEOUT,
    });
  }

  /** A full Pokemon row (the same 62-column shape a player's Pokemon has) for a DM-controlled Pokemon -- never
   * stored. `abilities` is the list of ability slots it has (0 primary, 1 secondary, 2 hidden). */
  static async buildPokemon({ species, level, nature = '', abilities = [0], nickname = '', item = '', shiny = false, stats = null, overrides = null, bonus = null, extraSkills = [], preview = false }) {
    return API.request('dm', 'build-pokemon', {
      species, level, nature, abilities: abilities.join(','), nickname, item, shiny: shiny ? '1' : '',
      ...(preview ? { preview: '1' } : {}), // just the numbers: skips looking up its picture
      ...(extraSkills?.length ? { skills: extraSkills.join(',') } : {}), // proficiencies on top of its species' own
      // The DM's own changes: final ability scores ({str, ...}) and {ac, maxHP, maxVP}, each only when set.
      ...(stats && Object.keys(stats).length ? { stats: JSON.stringify(stats) } : {}),
      ...(overrides && Object.keys(overrides).length ? { overrides: JSON.stringify(overrides) } : {}),
      // Encounter setup's bonuses on top of what the numbers come out as ({str: 2, ac: 1, ...}).
      ...(bonus && Object.values(bonus).some(Boolean) ? { bonus: JSON.stringify(bonus) } : {}),
    }, { useCache: false });
  }

  /** The DM's saved battle setup ({map, creatures, startedAt}) or null. */
  static async getSetup() {
    return API.request('dm', 'get-setup', {}, { useCache: false });
  }

  /** Saves the whole setup -- a POST (main.py's /api/dm/setup), since it's far longer than a query string allows. */
  static async saveSetup(setup) {
    const res = await fetch(`${API_CONFIG.baseUrl}/dm/setup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ setup }),
    });
    const data = await res.json();
    if (!res.ok || data.status !== 'success') throw new Error(data.error || `Saving the setup failed (${res.status})`);
    return data;
  }

  static async clearSetup() {
    return API.request('dm', 'clear-setup', {}, { useCache: false });
  }

  /** {objects: [{key, label, url}], backgrounds: [...], portraits: [{name, file, url, own}]} for the map and battle setup
   * (portraits: the NPC pictures, then the players' own, own: true). */
  static async mapAssets() {
    return API.request('dm', 'map-assets', {}, { useCache: false });
  }

  /** Starts an adventure on the Adventure module's map (dm_state 'adventure-map', with the creatures prepared on it): the
   * table's map without a battle. `settings`: {canJoin, canMove, onScreen} to start with. */
  static async startAdventure({ canJoin, canMove, onScreen } = {}) {
    const params = {};
    if (canJoin !== undefined) params.canJoin = canJoin ? '1' : '0';
    if (canMove !== undefined) params.canMove = canMove ? '1' : '0';
    if (onScreen) params.onScreen = onScreen;
    return API.request('dm', 'start-adventure', params, { useCache: false, timeout: 30000 });
  }

  /** Starts the PvE battle from the saved setup -- only then can the players join. */
  static async startBattle() {
    return API.request('dm', 'start-battle', {}, { useCache: false, timeout: 30000 });
  }

  /** Everything the encyclopedia has on one species (Pokedex module). */
  static async speciesDetail(name) {
    return API.request('dm', 'species-detail', { name }, { cacheKey: `dm:species:${name}`, useCache: true, cacheTtl: STATIC_DATA_TTL, timeout: HEAVY_TIMEOUT });
  }

  /** The players' Pokedex settings ({registered, visibility, defaults, ...}). Never cached. */
  static async pokedexConfig() {
    return API.request('dm', 'pokedex-config', {}, { useCache: false });
  }

  /** Every move ({name, type}) and the names the players can already look up through a species in their Pokedex
   * (`viaPokemon`) -- the Pokedex module's "Searchable moves" page. */
  static async pokedexSearchable() {
    return API.request('dm', 'pokedex-searchable', {}, { useCache: false, timeout: HEAVY_TIMEOUT });
  }

  /** Saves what the players may see (POST -- main.py's /api/dm/pokedex-config); it's live-pushed to every device. */
  static async savePokedexConfig(config) {
    const res = await fetch(`${API_CONFIG.baseUrl}/dm/pokedex-config`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config }),
    });
    const data = await res.json();
    if (!res.ok || data.status !== 'success') throw new Error(data.error || `Saving the Pokédex settings failed (${res.status})`);
    cache.remove('game-data:pokedex-config');
    return data;
  }

  /** Every player trainer with all their Pokemon: [{trainer: row, pokemon: [rows], xp: {trainer, pokemon: [one per
   * row]}}] (Party module). XP is null where none is stored yet. */
  /** The species the players have caught -- {caught: [ever caught, kept after evolving], owned: [a player has one
   * now]}, lowercase names. */
  static async caughtSpecies() {
    return (await API.request('dm', 'caught-species', {}, { useCache: false })).data || { caught: [], owned: [] };
  }

  /** The DM ticks / unticks a species as caught by the players. Returns caughtSpecies' shape. */
  static async setCaught(species, caught) {
    return (await API.request('dm', 'set-caught', { species, caught: caught ? '1' : '0' }, { useCache: false })).data;
  }

  static async party() {
    return API.request('dm', 'party', {}, { useCache: false, timeout: HEAVY_TIMEOUT });
  }

  /** Adds `quantity` of an item (negative takes some away) to a trainer's inventory, on the server in one go. `custom`
   * = an item of the DM's own, not from the items list (stored with its description). */
  static async giveItem(trainer, item, quantity = 1, { custom = false, description = '' } = {}) {
    return API.request('dm', 'give-item', { trainer, item, quantity, custom: custom ? '1' : '', description }, { useCache: false });
  }

  /** Adds `amount` (negative takes some away, never below 0) to a trainer's money. */
  static async giveMoney(trainer, amount) {
    return API.request('dm', 'give-money', { trainer, amount }, { useCache: false });
  }

  /** The world clock ({year, month, day, hour, minute, weather, events, timers}) or null before it's ever been set. */
  static async getClock() {
    return API.request('dm', 'get-clock', {}, { useCache: false });
  }

  static async saveClock(clock) {
    return DmAPI._post('clock', { clock }, 'Saving the clock');
  }

  /** The NPC library, sorted by name. */
  static async npcs() {
    return API.request('dm', 'npcs', {}, { useCache: false });
  }

  /** Saves one NPC (new or changed); resolves to the stored copy. */
  static async saveNpc(npc) {
    return (await DmAPI._post('npc', { npc }, 'Saving the NPC')).data;
  }

  static async deleteNpc(id) {
    return API.request('dm', 'delete-npc', { id }, { useCache: false });
  }

  /** The encounter library, newest change first. */
  static async encounters() {
    return API.request('dm', 'encounters', {}, { useCache: false });
  }

  /** Saves one encounter (new or changed); resolves to the stored copy. */
  static async saveEncounter(encounter) {
    return (await DmAPI._post('encounter', { encounter }, 'Saving the encounter')).data;
  }

  static async deleteEncounter(id) {
    return API.request('dm', 'delete-encounter', { id }, { useCache: false });
  }

  /** XP only the DM sees: `changes` = [{trainer, pokemon? (species name), add? | set?}]. Resolves to
   * [{trainer, pokemon, before, xp, level, xpLevel}]. */
  static async changeXp(changes) {
    return (await DmAPI._post('xp', { changes }, 'Saving the XP')).data;
  }

  /** What the table TV shows ({background, items, battlePictures}) -- stored and pushed to the TV at once. */
  static async saveDisplayScene(scene) {
    return DmAPI._post('display-scene', { scene }, 'Updating the TV');
  }

  /** A picture for a species that has none ({species, data: a data: URL}) into the Pi's Pokemon pictures folder ->
   * {image, picture}. */
  static async uploadPokemonImage(image) {
    return (await DmAPI._post('pokemon-image', image, 'Uploading the picture')).data;
  }

  /** A picture for an NPC ({name, data: a data: URL}) into the Pi's NPC pictures folder -> {name, file, url, own}. */
  static async uploadNpcImage(image) {
    return (await DmAPI._post('npc-image', image, 'Uploading the picture')).data;
  }

  /** The running battle's map objects and difficult / blocked squares, as the DM's live map editor has them. */
  static async setBoardMap(objects, marks, traps) {
    return (await DmAPI._post('board-map', { objects, marks, traps }, 'Changing the map')).data;
  }

  /** A battle-map picture from the DM's computer ({kind: 'object' | 'background', name, data: data URL}) -> {key, label,
   * url}, saved as object-<name>.png / battle-<name>.<ext> (routes_dm.py's save_battle_image). */
  static async uploadBattleImage(image) {
    return (await DmAPI._post('battle-image', image, 'Uploading the picture')).data;
  }

  /** Deletes one of the battle-map pictures (an object-* or battle-* file) by its url. */
  static async deleteBattleImage(url) {
    return DmAPI._post('battle-image-delete', { url }, 'Deleting the picture');
  }

  /** A battle-map background from the DM's computer ({name, data: data URL}) -> {key, label, url} (routes_dm.py). */
  static async uploadBattleBackground(image) {
    return (await DmAPI._post('battle-background', image, 'Uploading the background')).data;
  }

  /** Where the region map on the board screen is looking ({x, y, zoom, polar, azimuth, style}) -- pushed to the board
   * at once, and stored on the Pi unless `save` is false. */
  static async saveRegionMapView(view, { save = true } = {}) {
    return DmAPI._post('region-map-view', { view, save }, 'Moving the map');
  }

  /** The pictures uploaded for the TV, newest first: [{id, name, url, createdAt}]. */
  static async displayImages() {
    return API.request('dm', 'display-images', {}, { useCache: false });
  }

  /** Uploads a picture ({name, data: a data: URL}), or renames one ({id, name}); resolves to it. */
  static async saveDisplayImage(image) {
    return (await DmAPI._post('display-image', image, 'Uploading the picture')).data;
  }

  /** The locations' icons on the Pi (~/pokemon-dnd/images/locations, "<Type>-<Name>"): [{file, type, name, url}]. */
  static async locationIcons() {
    return (await API.request('dm', 'location-icons', {}, { useCache: false })).data || [];
  }

  /** A location's icon uploaded ({type, name, data: a data: URL}) -- one with the same type and name replaced. */
  static async saveLocationIcon(icon) {
    return (await DmAPI._post('location-icon', icon, 'Uploading the icon')).data;
  }

  static async deleteLocationIcon(file) {
    const res = await API.request('dm', 'delete-location-icon', { file }, { useCache: false });
    if (res.status !== 'success') throw new Error(res.error || "Couldn't delete the icon");
    return res;
  }

  static async deleteDisplayImage(id) {
    return API.request('dm', 'delete-display-image', { id }, { useCache: false });
  }

  /** One of the console's small DM-only records ('encounter-run', 'last-battle', 'saved-pokemon',
   * 'encounter-exclusions', 'display-scene') -- null when never set. */
  static async getState(key) {
    return (await API.request('dm', 'get-state', { key }, { useCache: false })).data ?? null;
  }

  static async saveState(key, data) {
    return DmAPI._post('state', { key, data }, 'Saving');
  }

  /** A caught Pokemon straight into a trainer's team: `pokemon` = {species, level, nature, abilities, item, shiny,
   * stats, extraSkills, nickname}. */
  static async givePokemon(trainer, pokemon) {
    return DmAPI._post('give-pokemon', { trainer, pokemon }, 'Giving the Pokémon');
  }

  // --- The Admin module (pi-server/app/admin.py) ---

  /** Every item with its picture and whether it was added / edited here -> [{name, category, price, description,
   * effect, image, edited}]. */
  static async adminItems() {
    return (await API.request('dm', 'admin-items', {}, { useCache: false, timeout: HEAVY_TIMEOUT })).data || [];
  }

  /** An item added (`isNew`) or edited -> the item as saved. */
  static async adminSaveItem(item, isNew) {
    return (await DmAPI._post('admin-item', { item, isNew }, 'Saving the item')).data;
  }

  /** The DM's custom moves, as they're kept -> [{name, type, action, range, duration: {raw}, moveStat, vpCost, description,
   * scaling, attackRoll}]. */
  static async allMoves() {
    return API.request('game-data', 'moves', {}, { useCache: false });
  }

  /** A move from the move list taught to a player's Pokemon for good -- one it hasn't learned yet or can't normally
   * learn (its custom moves, like Edit Pokemon's) -- or with `forget`, one taken away. */
  /** A player's Pokemon's hit / vitality die set by the DM (4, 6, 8, 10, 12, 20) -- kept when it evolves. */
  static async setPokemonDice(trainer, pokemon, { hitDie, vitalityDie }) {
    return API.request('dm', 'pokemon-dice', { trainer, pokemon, hitDie, vitalityDie }, { useCache: false });
  }

  static async giveMove(trainer, pokemon, move, { forget = false } = {}) {
    return API.request('dm', 'give-move', { trainer, pokemon, move, ...(forget ? { forget: '1' } : {}) }, { useCache: false });
  }

  /** An item's picture ({name, data: a data: URL}) -> {image}. */
  static async adminItemImage(name, data) {
    return (await DmAPI._post('admin-item-image', { name, data }, 'Uploading the picture')).data;
  }

  /** One Pokedex entry as it's kept -> {species, edited, pictures, abilityDescriptions}. */
  static async adminSpecies(name) {
    return (await API.request('dm', 'admin-species', { name }, { useCache: false })).data;
  }

  /** A Pokedex entry added or edited (`abilityDescriptions`: {ability: description} for new / changed ones). */
  static async adminSaveSpecies(species, isNew, abilityDescriptions) {
    return (await DmAPI._post('admin-species', { species, isNew, abilityDescriptions }, 'Saving the Pokédex entry')).data;
  }

  /** A species' still picture or animated sprite ({species, kind: 'still' | 'animated', shiny, data}) -> its pictures. */
  static async adminPokemonImage(upload) {
    return (await DmAPI._post('admin-pokemon-image', upload, 'Uploading')).data;
  }

  /** The loading-screen splashes -> [{file, url, session}]. */
  static async adminSplashes() {
    return (await API.request('dm', 'admin-splashes', {}, { useCache: false })).data || [];
  }

  /** A new splash, or one in place of `replace` -> the splashes. */
  static async adminSaveSplash(data, replace = null) {
    return (await DmAPI._post('admin-splash', { data, replace }, 'Uploading the splash')).data;
  }

  static async adminDeleteSplash(file) {
    return (await DmAPI._post('admin-splash-delete', { file }, 'Deleting the splash')).data;
  }

  /** Every battle's log on the Pi, newest first -> [{file, kind, started, ended, rounds, entries, who, players, name, caught}]. */
  static async adminBattleLogs() {
    return (await API.request('dm', 'admin-battle-logs', {}, { useCache: false })).data || [];
  }

  /** A picture for an event or a location (the Admin module) -> {url}. */
  static async adminPicture(data) {
    return (await DmAPI._post('admin-picture', { data }, 'Uploading the picture')).data;
  }

  /** The DM's name for a battle (an empty one: back to its players and date). */
  static async adminRenameBattleLog(file, name) {
    return (await DmAPI._post('admin-battle-log-name', { file, name }, 'Renaming the battle')).data;
  }

  /** One battle's log, every line. */
  static async adminBattleLog(file) {
    return (await API.request('dm', 'admin-battle-log', { file }, { useCache: false })).data || [];
  }

  /** The game data this device keeps (species lists, details...) dropped -- after the Admin module changed some. */
  static forgetCachedData() {
    cache.clear();
  }

  static async _post(path, body, what) {
    const res = await fetch(`${API_CONFIG.baseUrl}/dm/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || data.status !== 'success') throw new Error(data.error || `${what} failed (${res.status})`);
    return data;
  }
}

// ============================================================================
// OFFLINE DETECTION
// ============================================================================

export class OfflineManager {
  static isOnline = navigator.onLine;

  static init() {
    window.addEventListener('online', () => {
      this.isOnline = true;
      document.dispatchEvent(new CustomEvent('app:online'));
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      document.dispatchEvent(new CustomEvent('app:offline'));
    });
  }

  static checkConnection() {
    return this.isOnline;
  }
}

// Initialize offline detection
OfflineManager.init();

// ============================================================================
// EXPORTS
// ============================================================================

