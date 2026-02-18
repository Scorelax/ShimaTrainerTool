// Visibility Helper for Pokemon Data
// Checks what information should be visible based on Pokedex config

import { GameDataAPI } from '../api.js';

// Cache for Pokedex config
let pokedexConfig = null;

/**
 * Initialize visibility system by loading Pokedex config from sessionStorage or API
 */
export async function initializeVisibility() {
  // If already loaded in memory, return immediately
  if (pokedexConfig) {
    console.log('[Visibility] Using cached Pokedex config from memory');
    return true;
  }

  // Check sessionStorage first (loaded in continue-journey)
  const cachedConfig = sessionStorage.getItem('pokedexConfig');
  if (cachedConfig) {
    try {
      pokedexConfig = JSON.parse(cachedConfig);
      console.log('[Visibility] Using cached Pokedex config from sessionStorage');
      return true;
    } catch (error) {
      console.error('[Visibility] Failed to parse cached Pokedex config:', error);
    }
  }

  // Fall back to API call if not in sessionStorage
  try {
    console.log('[Visibility] Fetching Pokedex config from API...');
    const result = await GameDataAPI.getPokedexConfig();
    if (result.status === 'success') {
      pokedexConfig = result.data;
      // Store in sessionStorage for future use
      sessionStorage.setItem('pokedexConfig', JSON.stringify(result.data));
      console.log('[Visibility] Pokedex config loaded successfully from API');
      return true;
    }
    return false;
  } catch (error) {
    console.error('Failed to load Pokedex config:', error);
    return false;
  }
}

/**
 * Get visibility settings for a specific Pokemon
 * @param {string} pokemonName - Name of the Pokemon
 * @returns {Object} Visibility settings object or defaults
 */
export function getPokemonVisibility(pokemonName) {
  if (!pokedexConfig) {
    console.warn('Pokedex config not loaded, returning all visible');
    return {
      types: true,
      description: true,
      characteristics: true,
      primaryAbility: true,
      secondaryAbility: true,
      hiddenAbility: true,
      stats: true,
      senses: true,
      evolution: true,
      moves: true,
      movesMaxLevel: 99,
      extraVisibleMoves: []
    };
  }

  const normalizedName = pokemonName.toLowerCase();

  // Check if Pokemon has specific visibility settings
  if (pokedexConfig.visibility && pokedexConfig.visibility[normalizedName]) {
    return pokedexConfig.visibility[normalizedName];
  }

  // Return defaults if Pokemon not found in visibility object
  return pokedexConfig.defaults || {
    types: false,
    description: true,
    characteristics: false,
    primaryAbility: false,
    secondaryAbility: false,
    hiddenAbility: false,
    stats: false,
    senses: false,
    evolution: false,
    moves: false,
    movesMaxLevel: 1,
    extraVisibleMoves: []
  };
}

/**
 * Check if a specific field should be visible for a Pokemon
 * @param {string} pokemonName - Name of the Pokemon
 * @param {string} field - Field name (e.g., 'hiddenAbility', 'stats', 'types')
 * @returns {boolean} True if field should be visible
 */
export function isFieldVisible(pokemonName, field) {
  const visibility = getPokemonVisibility(pokemonName);
  return visibility[field] === true;
}

