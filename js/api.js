// API Client for Pokemon D&D Tool
// Handles all communication with Google Apps Script backend

// ============================================================================
// CONFIGURATION
// ============================================================================

// Replace with your actual Google Apps Script deployment URL
const API_CONFIG = {
  baseUrl: 'https://script.google.com/macros/s/AKfycbwXsojbcIhuqpYeWFVgsMzf74HvwvV7thts7K6VBV49CWHCNFQ5aKBGeMlWpJaG2YzC/exec',
  timeout: 30000, // 30 seconds
  retries: 2
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

      const { data, timestamp } = JSON.parse(item);

      // Check if expired
      if (Date.now() - timestamp > this.duration) {
        this.remove(key);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  }

  set(key, data) {
    try {
      localStorage.setItem(`cache:${key}`, JSON.stringify({
        data,
        timestamp: Date.now()
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

const cache = new CacheManager();

// ============================================================================
// API CLIENT
// ============================================================================

class API {
  static async request(route, action, params = {}, options = {}) {
    const { useCache = true, cacheKey, timeout = API_CONFIG.timeout } = options;

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

    // Make request with timeout
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

      const data = await response.json();

      // Check for API-level errors
      if (data.status === 'error') {
        throw new Error(data.error || 'Unknown API error');
      }

      // Cache successful responses
      if (useCache && cacheKey) {
        cache.set(cacheKey, data);
      }

      return data;

    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('Request timeout - please try again');
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
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
      useCache: true
    });
  }

  /**
   * Get complete Pokemon data (all registered)
   */
  static async getCompleteList() {
    return API.request('pokemon', 'list', {}, {
      cacheKey: 'pokemon:complete-list',
      useCache: true
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
   * Get abilities for a specific Pokemon species
   */
  static async getAbilities(pokemonName) {
    return API.request('pokemon', 'abilities', {
      name: pokemonName
    }, {
      cacheKey: `pokemon:abilities:${pokemonName}`,
      useCache: true
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
      useCache: true
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
      useCache: true
    });
  }

  /**
   * Load conduit-specific game data
   */
  static async getConduit() {
    return API.request('game-data', 'conduit', {}, {
      cacheKey: 'game-data:conduit',
      useCache: true
    });
  }

  /**
   * Get move data
   */
  static async getMoves() {
    return API.request('game-data', 'moves', {}, {
      cacheKey: 'game-data:moves',
      useCache: true
    });
  }

  /**
   * Get nature data
   */
  static async getNatures() {
    return API.request('game-data', 'natures', {}, {
      cacheKey: 'game-data:natures',
      useCache: true
    });
  }

  /**
   * Calculate type effectiveness
   */
  static async getTypeEffectiveness(type1, type2 = null) {
    const params = { type1 };
    if (type2) params.type2 = type2;

    return API.request('game-data', 'type-effectiveness', params, {
      cacheKey: `type-effectiveness:${type1}${type2 ? ':' + type2 : ''}`
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

export { cache, CacheManager };
