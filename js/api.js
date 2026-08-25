// API Client for Pokemon D&D Tool
// Handles all communication with Google Apps Script backend

// ============================================================================
// CONFIGURATION
// ============================================================================

// When the app is served by the pi-server itself (localhost test run, or
// the Raspberry Pi later), talk to that same server. When served from
// GitHub Pages (the live player-facing version), keep using Google Apps
// Script until cutover.
const SERVED_BY_PI_SERVER = window.location.protocol.startsWith('http')
  && !window.location.hostname.endsWith('github.io');

const API_CONFIG = {
  baseUrl: SERVED_BY_PI_SERVER
    ? `${window.location.origin}/api`
    : 'https://script.google.com/macros/s/AKfycbwXsojbcIhuqpYeWFVgsMzf74HvwvV7thts7K6VBV49CWHCNFQ5aKBGeMlWpJaG2YzC/exec',
  timeout: 30000 // 30 seconds
};

// ============================================================================
// CACHE MANAGER
// ============================================================================

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

// Now that the Pi backend is a fast same-origin server rather than
// rate-limited Apps Script, keep TTLs short -- they're a fallback bound,
// not the primary invalidation mechanism (that's cache.remove() calls on
// write, or the X-Data-Version header below).
const cache = new CacheManager(5 * 60 * 1000); // 5 minutes default

// TTL for static game data (moves, items, feats, natures, pokedex config).
// The Reset Cache button clears it manually, and on the pi-server backend
// the X-Data-Version response header clears it automatically whenever the
// server refreshes its upstream snapshots; the TTL is the fallback bound.
const STATIC_DATA_TTL = 2 * 60 * 60 * 1000; // 2 hours

// TTL for the registered/complete Pokemon lists. These grow every time a
// player registers a Pokemon, but that write never bumps the server's
// upstream_cache, so X-Data-Version doesn't cover them -- unlike the truly
// static data above, this TTL is the only thing bounding staleness across
// devices.
const LIVE_LIST_TTL = 5 * 60 * 1000; // 5 minutes

// Heavy endpoints (login bundle, full game data) get a longer timeout so a
// slow Apps Script day degrades to "slow" instead of failing at 30s.
const HEAVY_TIMEOUT = 90000;

// ============================================================================
// API CLIENT
// ============================================================================

class API {
  static async request(route, action, params = {}, options = {}) {
    const { useCache = true, cacheKey, cacheTtl, timeout = API_CONFIG.timeout, retries = 1 } = options;

    // Check cache first
    if (useCache && cacheKey) {
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
        // with the timestamp of its last upstream refresh. When it changes
        // (someone pressed Reset Cache, or the scheduled refresh ran), drop
        // the locally cached game data so this device picks up the new
        // content on its next fetch. Backends without the header (Apps
        // Script) are unaffected.
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
          throw new Error(data.error || 'Unknown API error');
        }

        if (useCache && cacheKey) {
          cache.set(cacheKey, data, cacheTtl);
        }

        return data;

      } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
          lastError = new Error('Request timeout - please try again');
          console.warn(`[API] Timeout on ${route}/${action} (attempt ${attempt + 1})`);
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
  static async getCompleteList() {
    return API.request('pokemon', 'list', {}, {
      cacheKey: 'pokemon:complete-list',
      useCache: true,
      cacheTtl: LIVE_LIST_TTL,
      timeout: HEAVY_TIMEOUT
    });
  }

  /**
   * Get specific Pokemon info
   */
  static async get(trainerName, pokemonName) {
    return API.request('pokemon', 'get', {
      trainer: trainerName,
      name: pokemonName
    }, {
      cacheKey: `pokemon:${trainerName}:${pokemonName}`
    });
  }

  /**
   * Register new Pokemon for trainer
   */
  static async register(trainerName, pokemonData) {
    const result = await API.request('pokemon', 'register', {
      trainer: trainerName,
      data: JSON.stringify(pokemonData)
    }, {
      useCache: false
    });

    // Invalidate relevant caches
    cache.remove(`trainer:${trainerName}`);
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

    // Invalidate cache
    cache.remove(`pokemon:${pokemonData[0]}:${pokemonData[2]}`);

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
    cache.remove(`trainer:${trainerName}`);

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

    cache.remove(`trainer:${trainerName}`);
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
      oldFeats: oldFeats
    }, {
      useCache: false
    });
  }

  /**
   * Get abilities for a specific Pokemon species
   */
  static async getAbilities(pokemonName) {
    return API.request('pokemon', 'abilities', {
      name: pokemonName
    }, {
      cacheKey: `pokemon:abilities:${pokemonName}`,
      useCache: true,
      cacheTtl: STATIC_DATA_TTL
    });
  }

  /**
   * Evolve a Pokemon
   */
  static async evolve(currentPokemonName, trainerName, evolvedPokemonData) {
    const result = await API.request('pokemon', 'evolve', {
      currentName: currentPokemonName,
      trainer: trainerName,
      data: JSON.stringify(evolvedPokemonData)
    }, {
      useCache: false
    });

    // Invalidate relevant caches
    cache.remove(`pokemon:${trainerName}:${currentPokemonName}`);
    cache.remove(`trainer:${trainerName}`);

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
    return API.request('trainer', 'get', { name }, {
      cacheKey: `trainer:${name}`,
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
    return API.request('trainer', 'get-full', { name }, {
      useCache: false,
      timeout: HEAVY_TIMEOUT
    });
  }

  /**
   * Create new trainer
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
   * Update trainer data
   */
  static async update(trainerData) {
    const result = await API.request('trainer', 'update', {
      data: JSON.stringify(trainerData)
    }, {
      useCache: false
    });

    // Invalidate cache
    cache.remove(`trainer:${trainerData[1]}`);

    return result;
  }

  /**
   * Update trainer inventory
   */
  static async updateInventory(trainerName, inventory) {
    const result = await API.request('trainer', 'inventory', {
      trainer: trainerName,
      data: JSON.stringify(inventory)
    }, {
      useCache: false
    });

    cache.remove(`trainer:${trainerName}`);
    return result;
  }

  /**
   * Update trainer gear
   */
  static async updateGear(trainerName, gear) {
    const result = await API.request('trainer', 'gear', {
      trainer: trainerName,
      data: gear
    }, {
      useCache: false
    });

    cache.remove(`trainer:${trainerName}`);
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

    cache.remove(`trainer:${trainerName}`);
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
    cache.remove(`trainer:${trainerName}`);

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
    cache.remove(`trainer:${trainerName}`);

    return result;
  }

  /**
   * Update trainer path
   */
  static async updateTrainerPath(trainerName, path) {
    const result = await API.request('trainer', 'trainer-path', {
      trainer: trainerName,
      path
    }, {
      useCache: false
    });

    // Invalidate trainer cache
    cache.remove(`trainer:${trainerName}`);

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
  static async getPokedexConfig() {
    return API.request('game-data', 'pokedex-config', {}, {
      cacheKey: 'game-data:pokedex-config',
      useCache: true,
      cacheTtl: STATIC_DATA_TTL
    });
  }

  /**
   * Refresh the SERVER-side upstream cache in place (pokemon DB, moves,
   * items, pokedex config are re-fetched and overwritten, so the cache
   * stays warm). Used by the Reset Cache button. Can take a while when
   * the upstream scripts are slow, hence the long timeout.
   * No-op on backends without the route.
   */
  static async clearServerCache() {
    return API.request('game-data', 'clear-cache', {}, {
      useCache: false,
      timeout: HEAVY_TIMEOUT,
      retries: 0
    });
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

