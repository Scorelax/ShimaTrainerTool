// Combat Page — Full encounter tracker with initiative, status effects, and move integration

import { PokemonAPI, TrainerAPI, CombatAPI } from '../api.js';
import { showToast } from '../utils/notifications.js';
import { getMoveTypeColor, getTextColorForBackground, parseDamageDice, computeMoveData } from '../utils/pokemon-types.js';
import { showMovePopup } from '../utils/move-popup.js';
import { spriteMediaHtml } from '../utils/sprite-media.js';
import { preloadBattleAnimation } from '../utils/battle-animation.js';

// Holds a reference to the live battle state so inventory/heal functions stay in sync
let _battleState = null;

// Per-card render options (see renderCombatCard's own options param) that every internal
// re-render needs to keep reusing -- set once by attachBattleListeners, refreshable in between
// full attach cycles via setBattleCardOptions (e.g. combat-wip.js's shared view needs a card's
// React-eligibility to stay current across SSE pushes without re-running the whole attach).
let _battleCardOptions = {};

export function setBattleCardOptions(options) {
  _battleCardOptions = options || {};
}

// Module-level move cache — parsed once, reused everywhere
let _moves = null;
let _moveMap = null; // Map<name, moveData> for O(1) lookups

// Move-name -> category tags (see pi-server/docs/DnD_moves_categorized_draft.json
// and routes_combat.py's list-move-categories action) -- the user's own manual
// pass over each move's actual effect (damage/save/heal/drain/crit-range/...),
// used here just to route a move's post-use flow to the right popup ('trigger_saving_throw',
// 'reactive_save', 'guaranteed_hit', multi_hit_*, see showCombatMoveDetails). null until loaded;
// a move with no entry (not yet categorized, or the fetch hasn't resolved yet)
// just falls through to the existing attack-roll flow, same as before this
// existed -- never a reason to block using a move.
let _moveCategories = null;
let _moveCategoriesLoading = false;
// Move-name -> structured effects (same response as the categories; schema in
// pi-server/docs/move-effects-schema.md). {} until loaded, and for a move with no
// entry -- callers treat "no effects" as "nothing to offer", never an error.
let _moveEffects = {};

// The data file's tags may still carry the manual-review decoration ("--TRIGGER
// SAVING THROW--", "-- POTENTIAL DAMAGE INCREASE--", ...) that marked the user's
// own suggestions apart from the original snake_case ones. Normalized here, at
// the one place tags enter the client, to that original style so every check
// below is a plain snake_case string no matter how the file spells it -- and
// so stray spacing/casing typos in the data can't silently break a lookup.
function _normalizeTag(tag) {
  return String(tag).trim().replace(/^[\s-]+|[\s-]+$/g, '').toLowerCase().replace(/\s+/g, '_');
}

function loadMoveCategories() {
  if (_moveCategories || _moveCategoriesLoading) return;
  _moveCategoriesLoading = true;
  CombatAPI.listMoveCategories().then(result => {
    if (result.status !== 'success') return;
    const normalized = {};
    for (const [name, tags] of Object.entries(result.categories || {})) {
      normalized[name] = [...new Set((tags || []).map(_normalizeTag))];
    }
    _moveCategories = normalized;
    _moveEffects = result.effects || {};
  }).catch(() => {}).finally(() => { _moveCategoriesLoading = false; });
}

export function moveCategoriesFor(moveName) {
  return _moveCategories?.[moveName] || [];
}

/** The structured effects for `moveName` -- [{kind, apply|stat|roll, when,
 * target?, ends?, choice?, note?}, ...] (see move-effects-schema.md), [] when the
 * move has none (or the data hasn't loaded yet). */
export function moveEffectsFor(moveName) {
  return _moveEffects[moveName] || [];
}

/** The raw move row [name, type, modifier, actionType, vpCost, duration,
 * range, desc, higherLevels] for `name`, or undefined if the moves dataset
 * hasn't loaded yet or the name isn't found -- for callers outside this
 * file that need a move's own data (see save-picker.js's reactive-save
 * auto-detect, which needs the attacking move's `modifier` field to
 * compute the attacker's DC via pokemon-types.js's computeMoveDC). */
export function findMoveRow(name) {
  return _moveMap?.get(name);
}

// Module-level items DB cache — held items don't change during combat, so parse once
let _itemsCache = null;

// Holds the bench pokemon selected for a switch-in initiative roll
let _switchTargetPokemon = null;
function getCachedItems() {
  if (!_itemsCache) _itemsCache = JSON.parse(sessionStorage.getItem('items') || '[]');
  return _itemsCache;
}

// ============================================================================
// GAME HELPERS
// ============================================================================

/**
 * Returns true if the combatant has the named ability (case-insensitive).
 * Abilities are stored as "slot:name;desc|slot:name;desc" or "name;desc|name;desc".
 */
function hasAbility(combatant, abilityName) {
  if (!combatant?.abilities) return false;
  const target = abilityName.toLowerCase();
  return combatant.abilities.split('|').some(a => {
    const body = a.includes(':') ? a.substring(a.indexOf(':') + 1) : a;
    return body.split(';')[0].trim().toLowerCase() === target;
  });
}

function computeProficiency(level) {
  if (level >= 17) return 6;
  if (level >= 13) return 5;
  if (level >= 9)  return 4;
  if (level >= 5)  return 3;
  return 2;
}

function formatMod(val) {
  return val >= 0 ? `+${val}` : `${val}`;
}

// ============================================================================
// MOVE / RECHARGE HELPERS
// ============================================================================

function loadCombatMoves() {
  if (_moves) return;
  const rawMovesData = sessionStorage.getItem('moves');
  if (!rawMovesData) return;
  try {
    const clean = JSON.parse(rawMovesData.replace(/\\"/g, '"').replace(/\\r/g, '').replace(/\\n/g, ''));
    _moves = clean.map(move => move.map(item => (typeof item === 'string' ? item.trim() : item)));
    _moveMap = new Map(_moves.map(m => [m[0], m]));
  } catch (e) {
    console.error('Failed to parse moves data:', e);
  }
}

/**
 * Parse the action type string for recharge info.
 * e.g. "1 action, recharge (short rest)" → { maxCharges: 1, type: 'SR' }
 *      "1 action, 2 charges, recharge (short rest)" → { maxCharges: 2, type: 'SR' }
 *      "1 action, recharge (long rest)" → { maxCharges: 1, type: 'LR' }
 *      "1 action, recharge (5-6)" → { maxCharges: 1, type: 'DICE', range: '5-6' }
 * Returns null if no recharge.
 */
function parseRecharge(actionType) {
  if (!actionType) return null;
  const lower = actionType.toLowerCase();
  if (!lower.includes('recharge')) return null;

  const rechargeMatch = lower.match(/recharge\s*\(([^)]+)\)/);
  if (!rechargeMatch) return null;

  const rechargeText = rechargeMatch[1].trim();

  // Dice-roll recharge: "5-6", "4-6", "3-6", etc.
  if (/^\d+-\d+$/.test(rechargeText)) {
    return { maxCharges: 1, type: 'DICE', range: rechargeText };
  }

  const type = rechargeText.includes('long') ? 'LR' : 'SR';

  // Look for explicit charge count anywhere in the action type string
  const chargeMatch = actionType.match(/(\d+)\s+charges?/i);
  const maxCharges = chargeMatch ? parseInt(chargeMatch[1]) : 1;

  return { maxCharges, type };
}

/**
 * Parse saved KnownMoves string into a map.
 * "Flame Wheel(1)(SR),Earthquake(0)(LR)" → { "Flame Wheel": { chargesLeft:1, type:'SR' }, ... }
 */
function parseKnownMoves(str) {
  if (!str) return {};
  const result = {};
  str.split(',').map(s => s.trim()).filter(Boolean).forEach(part => {
    const match = part.match(/^(.+?)\((\d+)\)\((\w+)\)$/);
    if (match) result[match[1]] = { chargesLeft: parseInt(match[2]), type: match[3] };
  });
  return result;
}

/**
 * Build the KnownMoves string to save back to the database.
 * Only includes SR/LR moves — DICE-type recharge moves are combat-only and not persisted.
 * Exported so combat-wip.js can persist a recharge-locked move's spent state through to
 * the DB itself (see its own _persistRechargeStates) -- this app's only OTHER place that
 * does this is endCombat below, which is legacy-combat-only (fires off its own End
 * Combat button), so the shared tool needs its own hook onto the same string format.
 */
export function buildKnownMovesString(rechargeStates) {
  return Object.entries(rechargeStates)
    .filter(([, s]) => s.type !== 'DICE')
    .map(([name, s]) => `${name}(${s.chargesLeft})(${s.type})`)
    .join(',');
}

/**
 * After allMoves is loaded, fill in any missing recharge states for pokemon combatants.
 * Called at the start of the battle phase.
 */
function initializeRechargeStates(state) {
  if (!_moves) return;
  state.combatants.forEach(c => {
    if (c.type !== 'pokemon') return;
    if (!c.rechargeStates) c.rechargeStates = {};
    c.moves.forEach(moveName => {
      if (c.rechargeStates[moveName] !== undefined) return;
      const moveData = _moveMap.get(moveName);
      if (!moveData) return;
      const recharge = parseRecharge(moveData[3] || '');
      if (!recharge) return;
      if (recharge.type === 'DICE') {
        c.rechargeStates[moveName] = { chargesLeft: 1, maxCharges: 1, type: 'DICE', range: recharge.range };
      } else {
        c.rechargeStates[moveName] = { chargesLeft: recharge.maxCharges, maxCharges: recharge.maxCharges, type: recharge.type };
      }
    });
  });
  saveCombatState(state);
}

// ============================================================================
// COMBATANT BUILDERS
// ============================================================================

export function buildTrainerCombatant() {
  const trainerData = JSON.parse(sessionStorage.getItem('trainerData') || '[]');
  const level = parseInt(trainerData[2]) || 1;
  const str = parseInt(trainerData[5]) || 10;
  const dex = parseInt(trainerData[6]) || 10;
  const con = parseInt(trainerData[7]) || 10;
  const int_ = parseInt(trainerData[8]) || 10;
  const wis = parseInt(trainerData[9]) || 10;
  const cha = parseInt(trainerData[10]) || 10;
  const strMod = parseInt(trainerData[27]) || Math.floor((str - 10) / 2);
  const dexMod = parseInt(trainerData[28]) || Math.floor((dex - 10) / 2);
  const conMod = parseInt(trainerData[29]) || Math.floor((con - 10) / 2);
  const intMod = parseInt(trainerData[30]) || Math.floor((int_ - 10) / 2);
  const wisMod = parseInt(trainerData[31]) || Math.floor((wis - 10) / 2);
  const chaMod = parseInt(trainerData[32]) || Math.floor((cha - 10) / 2);
  const maxHp = parseInt(trainerData[11]) || 0;
  const maxVp = parseInt(trainerData[12]) || 0;
  const currentHp = (trainerData[34] !== null && trainerData[34] !== undefined && trainerData[34] !== '') ? parseInt(trainerData[34]) : maxHp;
  const currentVp = (trainerData[35] !== null && trainerData[35] !== undefined && trainerData[35] !== '') ? parseInt(trainerData[35]) : maxVp;
  const ac = parseInt(trainerData[36]) || parseInt(trainerData[13]) || 10;
  const baseAc = parseInt(trainerData[13]) || 10;

  return {
    id: 'trainer', type: 'trainer', entityKey: 'trainerData',
    name: trainerData[1] || 'Trainer',
    image: trainerData[0] || 'assets/Pokeball.png',
    level, initiativeScore: dexMod, initiativeRoll: 0, initiativeBonus: 0, initiativeTotal: dexMod,
    ac, baseAc, critMod: 0, maxHp, currentHp, maxVp, currentVp,
    proficiency: parseInt(trainerData[17]) || computeProficiency(level),
    savingThrows: trainerData[15] || '',
    skills: trainerData[18] || '',
    str, dex, con, int: int_, wis, cha,
    strMod, dexMod, conMod, intMod, wisMod, chaMod,
    moves: [], types: [], rechargeStates: {},
    feats: trainerData[33] || '',
    inventory: trainerData[20] || '',
    statusEffects: [], isExpanded: false
  };
}

export function buildPokemonCombatant(pokemonKey) {
  loadCombatMoves();
  loadMoveCategories();
  const pokemonData = JSON.parse(sessionStorage.getItem(pokemonKey) || '[]');
  const level = parseInt(pokemonData[4]) || 1;
  const str = parseInt(pokemonData[15]) || 10;
  const dex = parseInt(pokemonData[16]) || 10;
  const con = parseInt(pokemonData[17]) || 10;
  const int_ = parseInt(pokemonData[18]) || 10;
  const wis = parseInt(pokemonData[19]) || 10;
  const cha = parseInt(pokemonData[20]) || 10;
  const strMod = Math.floor((str - 10) / 2);
  const dexMod = Math.floor((dex - 10) / 2);
  const conMod = Math.floor((con - 10) / 2);
  const intMod = Math.floor((int_ - 10) / 2);
  const wisMod = Math.floor((wis - 10) / 2);
  const chaMod = Math.floor((cha - 10) / 2);
  const maxHp = parseInt(pokemonData[10]) || 0;
  const maxVp = parseInt(pokemonData[12]) || 0;
  const currentHp = (pokemonData[45] !== null && pokemonData[45] !== undefined && pokemonData[45] !== '') ? parseInt(pokemonData[45]) : maxHp;
  const currentVp = (pokemonData[46] !== null && pokemonData[46] !== undefined && pokemonData[46] !== '') ? parseInt(pokemonData[46]) : maxVp;
  const proficiency = parseInt(pokemonData[31]) || computeProficiency(level);
  const initiative = parseInt(pokemonData[30]) || dexMod;

  // Parse learned moves by level
  const moveIndices = [23, 24, 25, 26, 27, 28, 37];
  const requiredLevels = [1, 2, 6, 10, 14, 18, 0];
  const moves = [];
  moveIndices.forEach((idx, i) => {
    if (level >= requiredLevels[i] || (idx === 37 && pokemonData[idx])) {
      const raw = pokemonData[idx] || '';
      if (raw) raw.split(',').map(m => m.trim()).filter(Boolean).forEach(m => moves.push(m));
    }
  });

  // Parse movement for display
  const movementData = pokemonData[13] || '';
  const movementValues = movementData.split(',').map(v => v.trim());
  const movementTypes = ['Walking', 'Climbing', 'Flying', 'Hovering', 'Swimming', 'Burrowing'];
  const movementDisplay = movementValues
    .map((v, i) => (v && v !== '-' && v !== '0' && v !== '') ? `${movementTypes[i]}: ${v}` : null)
    .filter(Boolean).join(', ');

  // Initialize recharge states (using existing KnownMoves from pokemonData[59] if present)
  const existingRecharges = parseKnownMoves(pokemonData[59] || '');
  const rechargeStates = {};
  if (_moves) {
    moves.forEach(moveName => {
      const moveData = _moveMap.get(moveName);
      if (!moveData) return;
      const recharge = parseRecharge(moveData[3] || '');
      if (!recharge) return;
      if (recharge.type === 'DICE') {
        // Dice-recharge moves always start fresh each combat — not persisted
        rechargeStates[moveName] = { chargesLeft: 1, maxCharges: 1, type: 'DICE', range: recharge.range };
      } else if (existingRecharges[moveName] !== undefined) {
        rechargeStates[moveName] = { chargesLeft: existingRecharges[moveName].chargesLeft, maxCharges: recharge.maxCharges, type: recharge.type };
      } else {
        rechargeStates[moveName] = { chargesLeft: recharge.maxCharges, maxCharges: recharge.maxCharges, type: recharge.type };
      }
    });
  }

  // Battle animation is keyed by species, not nickname -- and known as soon
  // as this combatant is built, well before any move gets confirmed -- so
  // kick off the preload right here rather than waiting on the move popup.
  preloadBattleAnimation(pokemonData[2]);

  return {
    id: pokemonKey, type: 'pokemon', entityKey: pokemonKey,
    name: pokemonData[36] || pokemonData[2] || 'Pokemon',
    speciesName: pokemonData[2] || '',
    image: pokemonData[1] || 'assets/Pokeball.png',
    level, initiativeScore: initiative, initiativeRoll: 0, initiativeBonus: 0, initiativeTotal: initiative,
    ac: parseInt(pokemonData[8]) || 10, baseAc: parseInt(pokemonData[8]) || 10, critMod: 0,
    maxHp, currentHp, maxVp, currentVp,
    proficiency, stabBonusValue: parseInt(pokemonData[34]) || 2,
    savingThrows: pokemonData[21] || '',
    skills: pokemonData[22] || '',
    str, dex, con, int: int_, wis, cha,
    strMod, dexMod, conMod, intMod, wisMod, chaMod,
    moves, types: [pokemonData[5], pokemonData[6]].filter(Boolean),
    abilities: pokemonData[7] || '',
    item: pokemonData[35] || '',
    size: pokemonData[57] || '',
    movement: movementDisplay,
    rechargeStates,
    feats: pokemonData[50] || '',
    typeChart: pokemonData[53] || '',
    statusEffects: (pokemonData[60] || '').split(',').map(s => s.trim()).filter(Boolean).map(name => ({ name, description: '', duration: -1 })),
    isExpanded: false
  };
}

// ============================================================================
// SESSION STATE
// ============================================================================

// Both the sessionStorage key and an optional post-save hook are
// swappable -- combat-wip.js's shared battle view points these at its own
// key ('wipCombatState', see setCombatStateKey) and a hook that pushes
// HP/VP deltas up to the server (setOnCombatStateSave) so it can reuse this
// entire battle engine (renderBattlePhase/attachBattleListeners and every
// popup underneath them) completely unmodified, operating on a local
// mirror of the shared session instead of colliding with the legacy page's
// own local-only 'combatState'. Both default to the legacy page's original
// behavior -- zero change for any caller that doesn't touch these setters.
let _combatStateKey = 'combatState';
let _onCombatStateSave = null;
// Same additive/swappable pattern as the two above, for the shared battle
// log (routes_combat.py's 'log' -- see combat-wip.js's battle-log-popup.js):
// an optional hook this file calls for mechanics that only ever happen
// locally (status effects, heal-popup amounts, item use, VP cost of a move)
// so the log stays a complete narrative even though those mechanics
// themselves stay client-only. Defaults to null -- the legacy page never
// sets it, so it costs those call sites nothing.
let _onLogEvent = null;

export function setCombatStateKey(key) {
  _combatStateKey = key || 'combatState';
}

export function setOnCombatStateSave(fn) {
  _onCombatStateSave = fn || null;
}

export function setOnLogEvent(fn) {
  _onLogEvent = fn || null;
}

function logBattleEvent(event) {
  if (_onLogEvent) _onLogEvent(event);
}

function getCombatState() {
  const raw = sessionStorage.getItem(_combatStateKey);
  return raw ? JSON.parse(raw) : null;
}

function saveCombatState(state) {
  sessionStorage.setItem(_combatStateKey, JSON.stringify(state));
  if (_onCombatStateSave) _onCombatStateSave(state);
}

// ============================================================================
// RENDER ENTRY POINT
// ============================================================================

export function renderCombat() {
  // Defensive reset: guarantees the legacy page's own entry point always
  // reads/writes its own default key with no stray hook attached, even if
  // combat-wip.js's shared battle view (or a future caller) left these
  // pointed elsewhere and the user navigated here without going through
  // that page's own "back" cleanup.
  setCombatStateKey('combatState');
  setOnCombatStateSave(null);

  const state = getCombatState();
  const phase = state ? state.phase : 'setup';
  if (phase === 'initiative') return renderInitiativePhase(state);
  if (phase === 'battle') return renderBattlePhase(state);
  return renderSetupPhase();
}

// ============================================================================
// PHASE 1: SETUP
// ============================================================================

export function renderSetupPhase({ showWipButton = true } = {}) {
  const trainerData = JSON.parse(sessionStorage.getItem('trainerData') || '[]');
  const trainerName = trainerData[1] || 'Trainer';
  const trainerImage = trainerData[0] || 'assets/Pokeball.png';
  const trainerLevel = parseInt(trainerData[2]) || 1;

  const partyPokemon = [];
  for (const key of Object.keys(sessionStorage)) {
    if (!key.startsWith('pokemon_')) continue;
    const pData = JSON.parse(sessionStorage.getItem(key));
    const slot = parseInt(pData[38], 10);
    if (slot >= 1 && slot <= 6) {
      partyPokemon.push({ key, name: pData[36] || pData[2] || 'Unknown', image: pData[1] || 'assets/Pokeball.png', level: parseInt(pData[4]) || 1, types: [pData[5], pData[6]].filter(Boolean), slot });
    }
  }
  partyPokemon.sort((a, b) => a.slot - b.slot);

  const pokemonCards = partyPokemon.map(p => `
    <div class="setup-pokemon-card" data-pokemon-key="${p.key}">
      <div class="setup-check">✓</div>
      ${spriteMediaHtml(p.image, p.name)}
      <div class="setup-pokemon-info">
        <div class="setup-pokemon-name">${p.name}</div>
        <div class="setup-pokemon-level">Lv ${p.level}</div>
        <div class="setup-pokemon-types">${p.types.map(t => `<span class="type-badge type-${t.toLowerCase()}">${t}</span>`).join('')}</div>
      </div>
    </div>
  `).join('');

  return `
    <div class="combat-page">
      <style>${COMBAT_CSS}</style>
      <div class="combat-header-bar">
        <button class="combat-back-btn" id="combatBackBtn">← Back</button>
        <div class="combat-header-title"><img src="assets/VS.png" alt="">Battle Setup</div>
        ${showWipButton ? '<button class="combat-wip-btn" id="combatWipBtn">🛠️ WIP</button>' : '<div></div>'}
      </div>
      <div class="combat-setup-container">
        <div class="setup-section-label">TRAINER (always included)</div>
        <div class="setup-trainer-card">
          <img src="${trainerImage}" alt="${trainerName}" onerror="this.src='assets/Pokeball.png'">
          <div class="setup-trainer-info">
            <div class="setup-trainer-name">${trainerName}</div>
            <div class="setup-trainer-level">Level ${trainerLevel}</div>
          </div>
        </div>
        <div class="setup-section-label">SELECT LEAD POKÉMON (1)</div>
        <div class="setup-pokemon-list" id="setupPokemonList">
          ${pokemonCards || '<div class="setup-empty">No active party Pokémon found.</div>'}
        </div>
        <button class="combat-start-btn" id="startCombatBtn" disabled>Start Battle →</button>
      </div>
    </div>`;
}

// ============================================================================
// PHASE 2: INITIATIVE
// ============================================================================

export function renderInitiativePhase(state) {
  const rows = state.combatants.map(c => `
    <div class="initiative-row">
      ${spriteMediaHtml(c.image, c.name, 'initiative-img')}
      <div class="initiative-info">
        <div class="initiative-name">${c.name} <span class="initiative-level">Lv ${c.level}</span></div>
        <div class="initiative-score-label">Initiative Score: <strong>${c.initiativeScore}</strong></div>
      </div>
      <div class="initiative-roll-group">
        <span class="initiative-plus">d20</span>
        <input type="number" class="initiative-bonus-input" id="bonus_${c.id}" value="" placeholder="" min="1" max="20">
        <span class="initiative-equals">= <strong id="total_${c.id}">${c.initiativeTotal}</strong></span>
      </div>
    </div>`).join('');

  return `
    <div class="combat-page">
      <style>${COMBAT_CSS}</style>
      <div class="combat-header-bar">
        <button class="combat-back-btn" id="combatBackBtn">← Setup</button>
        <div class="combat-header-title"><img src="assets/VS.png" alt="">Initiative</div>
        <div></div>
      </div>
      <div class="initiative-container">
<div class="initiative-list">${rows}</div>
        <button class="combat-start-btn" id="beginBattleBtn">Begin Battle →</button>
      </div>
    </div>`;
}

// ============================================================================
// PHASE 3: BATTLE
// ============================================================================

const WEATHER_SUGGESTIONS = ['Clear Skies', 'Rain', 'Harsh Sunlight', 'Sandstorm', 'Hail', 'Fog', 'Heavy Rain', 'Extremely Harsh Sunlight'];
const TERRAIN_SUGGESTIONS = ['Electric Terrain', 'Grassy Terrain', 'Misty Terrain', 'Psychic Terrain'];

function renderConditionBadge(type, cond) {
  const icon = type === 'weather' ? '🌦' : '🌿';
  return `
    <div class="combat-condition-badge">
      <span class="condition-icon">${icon}</span>
      <div class="condition-text">
        <span class="condition-name">${cond.name}</span>
        ${cond.effect ? `<span class="condition-effect">${cond.effect}</span>` : ''}
      </div>
      <button class="condition-clear-btn" data-type="${type}" title="Clear ${type}">✕</button>
    </div>`;
}

function renderGlobalBar(state) {
  const w = state.weather || null;
  const t = state.terrain || null;
  return `
    <div class="combat-global-bar" id="combatGlobalBar">
      ${w ? renderConditionBadge('weather', w) : '<button class="combat-global-btn" id="weatherBtn">🌦 Weather</button>'}
      ${t ? renderConditionBadge('terrain', t) : '<button class="combat-global-btn" id="terrainBtn">🌿 Terrain</button>'}
    </div>`;
}

function renderGlobalConditionModal() {
  return `
    <div class="combat-popup-overlay" id="globalConditionModal" style="display:none;">
      <div class="combat-popup-content" style="max-width:440px;padding:2rem;">
        <h3 id="globalConditionModalTitle" style="margin:0 0 1.2rem;text-align:center;color:#FFD700;font-size:1.1rem;"></h3>
        <div style="margin-bottom:1rem;">
          <label class="combat-condition-form-label">Name</label>
          <input type="text" id="globalConditionName" list="globalConditionSuggestions"
            style="width:100%;padding:0.6rem 0.8rem;background:#3a3a3a;border:2px solid #555;border-radius:8px;color:white;font-size:0.95rem;box-sizing:border-box;"
            placeholder="e.g. Rain" maxlength="60">
          <datalist id="globalConditionSuggestions"></datalist>
        </div>
        <div style="margin-bottom:1.5rem;">
          <label class="combat-condition-form-label">Effect <span style="font-weight:400;color:#777;text-transform:none;">(optional)</span></label>
          <textarea id="globalConditionEffect" rows="3"
            style="width:100%;padding:0.6rem 0.8rem;background:#3a3a3a;border:2px solid #555;border-radius:8px;color:white;font-size:0.88rem;box-sizing:border-box;resize:vertical;font-family:inherit;"
            placeholder="Describe what this does…" maxlength="200"></textarea>
        </div>
        <div style="display:flex;gap:0.6rem;justify-content:flex-end;flex-wrap:wrap;">
          <button class="combat-global-modal-btn gcm-cancel" id="globalConditionCancel">Cancel</button>
          <button class="combat-global-modal-btn gcm-clear" id="globalConditionClearBtn" style="display:none;">Clear</button>
          <button class="combat-global-modal-btn gcm-set" id="globalConditionSetBtn">Set</button>
        </div>
      </div>
    </div>`;
}

export function renderBattlePhase(state, cardOptions = {}) {
  const cards = state.combatants.map((c, idx) => renderCombatCard(c, idx === state.activeTurnIndex, cardOptions)).join('');
  return `
    <div class="combat-page">
      <style>${COMBAT_CSS}</style>
      <div class="combat-header-bar">
        <div class="combat-round-label">Round ${state.round}</div>
        <div class="combat-header-title"><img src="assets/VS.png" alt="">Battle</div>
        <button class="combat-end-btn" id="endCombatBtn">End Battle</button>
      </div>
      ${renderGlobalBar(state)}
      <div class="battle-list" id="battleList">${cards}</div>

      <!-- Global Condition Modal (weather / terrain) -->
      ${renderGlobalConditionModal()}

      <!-- Ingrain Heal Popup -->
      <div class="combat-popup-overlay" id="ingrainHealPopup" style="display:none;">
        <div class="combat-popup-content" style="max-width:420px;padding:2rem;">
          <h3 style="margin:0 0 0.4rem 0;color:#4CAF50;text-align:center;font-size:1.2rem;">🌿 Ingrain — End-of-Turn Heal</h3>
          <p id="ingrainHealTarget" style="text-align:center;color:#aaa;margin:0 0 1.4rem 0;font-size:0.9rem;"></p>
          <div style="margin-bottom:1rem;">
            <label id="ingrainDiceLabel" style="display:block;color:#FFDE00;font-weight:700;text-transform:uppercase;margin-bottom:0.5rem;font-size:0.88rem;">Roll 1d10:</label>
            <input type="number" id="ingrainDiceInput" min="1" placeholder="Enter roll result..." style="width:100%;padding:0.7rem 1rem;background:#3a3a3a;border:2px solid #555;border-radius:8px;color:white;font-size:1rem;box-sizing:border-box;">
          </div>
          <div id="ingrainModRow" style="display:none;margin-bottom:0.8rem;color:#aaa;font-size:0.88rem;text-align:center;"></div>
          <div style="text-align:center;margin-bottom:1.2rem;">
            <span style="color:#FFDE00;font-weight:700;text-transform:uppercase;font-size:0.88rem;">Total Healing: </span>
            <span id="ingrainTotal" style="color:#4CAF50;font-weight:900;font-size:1.1rem;">—</span>
          </div>
          <div style="margin-bottom:1.2rem;text-align:center;color:#aaa;font-size:0.83rem;">
            Heals remaining after this: <strong id="ingrainTurnsLeft" style="color:#FFDE00;"></strong>
          </div>
          <button id="ingrainHealConfirm" class="combat-use-move-btn" style="width:100%;background:linear-gradient(135deg,#2E7D32,#1B5E20);" disabled>Apply Heal</button>
        </div>
      </div>

      <!-- Drain Heal Popup -->
      <div class="combat-popup-overlay" id="drainHealPopup" style="display:none;">
        <div class="combat-popup-content" style="max-width:420px;padding:2rem;">
          <h3 id="drainHealTitle" style="margin:0 0 0.4rem 0;color:#4CAF50;text-align:center;font-size:1.2rem;">🌿 Drain — Heal</h3>
          <p id="drainHealTarget" style="text-align:center;color:#aaa;margin:0 0 1.4rem 0;font-size:0.9rem;"></p>
          <div style="margin-bottom:1rem;">
            <label style="display:block;color:#FFDE00;font-weight:700;text-transform:uppercase;margin-bottom:0.5rem;font-size:0.88rem;">Damage Dealt:</label>
            <input type="number" id="drainDamageInput" min="0" placeholder="Enter damage dealt..." style="width:100%;padding:0.7rem 1rem;background:#3a3a3a;border:2px solid #555;border-radius:8px;color:white;font-size:1rem;box-sizing:border-box;">
          </div>
          <div style="text-align:center;margin-bottom:1.5rem;">
            <span style="color:#FFDE00;font-weight:700;text-transform:uppercase;font-size:0.88rem;">Healing (½ rounded down): </span>
            <span id="drainHealTotal" style="color:#4CAF50;font-weight:900;font-size:1.1rem;">—</span>
          </div>
          <div style="display:flex;gap:1rem;">
            <button id="drainHealConfirm" class="combat-use-move-btn" disabled style="flex:1;background:linear-gradient(135deg,#2E7D32,#1B5E20);">Apply Heal</button>
            <button id="drainHealSkip" class="combat-use-move-btn" style="flex:1;background:linear-gradient(135deg,#555,#333);">Miss / Skip</button>
          </div>
        </div>
      </div>

      <!-- Direct Heal Popup (Swallow, Recover-style heals) -->
      <div class="combat-popup-overlay" id="directHealPopup" style="display:none;">
        <div class="combat-popup-content" style="max-width:420px;padding:2rem;">
          <h3 id="directHealTitle" style="margin:0 0 0.4rem 0;color:#4CAF50;text-align:center;font-size:1.2rem;">💊 Heal</h3>
          <p id="directHealTarget" style="text-align:center;color:#aaa;margin:0 0 1.4rem 0;font-size:0.9rem;"></p>
          <div style="margin-bottom:1rem;">
            <label id="directHealDiceLabel" style="display:block;color:#FFDE00;font-weight:700;text-transform:uppercase;margin-bottom:0.5rem;font-size:0.88rem;">Roll:</label>
            <input type="number" id="directHealDiceInput" min="1" placeholder="Enter roll result..." style="width:100%;padding:0.7rem 1rem;background:#3a3a3a;border:2px solid #555;border-radius:8px;color:white;font-size:1rem;box-sizing:border-box;">
          </div>
          <div id="directHealModRow" style="display:none;margin-bottom:0.8rem;color:#aaa;font-size:0.88rem;text-align:center;"></div>
          <div style="text-align:center;margin-bottom:1.5rem;">
            <span style="color:#FFDE00;font-weight:700;text-transform:uppercase;font-size:0.88rem;">Total Healing: </span>
            <span id="directHealTotal" style="color:#4CAF50;font-weight:900;font-size:1.1rem;">—</span>
          </div>
          <div style="display:flex;gap:1rem;">
            <button id="directHealConfirm" class="combat-use-move-btn" disabled style="flex:1;background:linear-gradient(135deg,#2E7D32,#1B5E20);">Apply Heal</button>
            <button id="directHealSkip" class="combat-use-move-btn" style="flex:1;background:linear-gradient(135deg,#555,#333);">Skip</button>
          </div>
        </div>
      </div>

      <!-- Spit Up Popup -->
      <div class="combat-popup-overlay" id="spitUpPopup" style="display:none;">
        <div class="combat-popup-content" style="max-width:420px;padding:2rem;">
          <h3 style="margin:0 0 0.4rem 0;color:#FF6B35;text-align:center;font-size:1.2rem;">💥 Spit Up</h3>
          <p id="spitUpTarget" style="text-align:center;color:#aaa;margin:0 0 1rem 0;font-size:0.9rem;"></p>
          <div style="text-align:center;margin-bottom:1.5rem;">
            <div style="font-size:2.4rem;font-weight:900;color:#FFDE00;" id="spitUpMultiplier"></div>
            <div style="color:#aaa;font-size:0.9rem;margin-top:0.4rem;">Multiply your damage roll by the stacks above</div>
          </div>
          <p style="text-align:center;color:#888;font-size:0.83rem;margin-bottom:1.2rem;">Stockpile has been cleared.</p>
          <button id="spitUpDismiss" class="combat-use-move-btn" style="width:100%;background:linear-gradient(135deg,#555,#333);">OK</button>
        </div>
      </div>

      <!-- Trainer HP/VP Calculator Popup -->
      <div class="combat-popup-overlay" id="trainerHpVpPopup" style="display:none;">
        <div class="combat-popup-content" style="max-width:380px;padding:2rem;">
          <h3 id="trainerHpVpTitle" style="margin:0 0 0.4rem 0;color:#FFDE00;text-align:center;font-size:1.2rem;">HP / VP</h3>
          <p id="trainerHpVpStatus" style="text-align:center;color:#aaa;margin:0 0 1.4rem 0;font-size:0.9rem;"></p>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.8rem;margin-bottom:1.2rem;">
            <div>
              <label style="display:block;color:#4CAF50;font-weight:700;text-transform:uppercase;margin-bottom:0.4rem;font-size:0.82rem;">HP Amount</label>
              <input type="number" id="trainerHpVpHpInput" min="0" placeholder="HP..." style="width:100%;padding:0.6rem 0.8rem;background:#3a3a3a;border:2px solid #555;border-radius:8px;color:white;font-size:1rem;box-sizing:border-box;">
            </div>
            <div>
              <label style="display:block;color:#64B5F6;font-weight:700;text-transform:uppercase;margin-bottom:0.4rem;font-size:0.82rem;">VP Amount</label>
              <input type="number" id="trainerHpVpVpInput" min="0" placeholder="VP..." style="width:100%;padding:0.6rem 0.8rem;background:#3a3a3a;border:2px solid #555;border-radius:8px;color:white;font-size:1rem;box-sizing:border-box;">
            </div>
          </div>
          <div style="display:flex;gap:0.8rem;">
            <button id="trainerHpVpAddBtn" class="combat-use-move-btn" style="flex:1;background:linear-gradient(135deg,#2E7D32,#1B5E20);">Add</button>
            <button id="trainerHpVpRemoveBtn" class="combat-use-move-btn" style="flex:1;background:linear-gradient(135deg,#7B1FA2,#4A148C);">Remove</button>
            <button id="trainerHpVpCloseBtn" class="combat-use-move-btn" style="flex:1;background:linear-gradient(135deg,#555,#333);">Close</button>
          </div>
        </div>
      </div>

      <!-- Inventory Popup -->
      <div class="popup-overlay" id="combatInventoryPopup" style="display:none;">
        <div class="popup-content combat-inv-popup-content">
          <button class="inventory-close" id="closeCombatInventoryPopup">×</button>
          <div class="inventory-popup-content">
            <div class="inventory-sidebar">
              <h2 class="inventory-title">Inventory</h2>
              <div class="inventory-search-wrapper">
                <input type="text" id="combatInventorySearch" class="inventory-search-input" placeholder="Search items..." autocomplete="off">
              </div>
              <ul id="combatInventorySearchResults" class="inventory-search-results"></ul>
              <ul id="combatInventoryCategories" class="inventory-categories"></ul>
            </div>
            <div class="inventory-main">
              <div class="item-info-card">
                <h3 class="item-name" id="combatSelectedItemName">Select an item</h3>
                <div class="item-details">
                  <div class="detail-section">
                    <h4>Description</h4>
                    <p id="combatDescriptionText">Choose an item from your inventory to view its details.</p>
                  </div>
                  <div class="detail-divider"></div>
                  <div class="detail-section">
                    <h4>Effect</h4>
                    <p id="combatEffectText">Item effects will appear here.</p>
                  </div>
                </div>
              </div>
              <div id="combatItemActionArea" class="combat-item-action-area"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Trainer Buffs Popup -->
      <div class="popup-overlay" id="combatBuffsPopup" style="display:none;">
        <div class="popup-content">
          <div class="popup-header">
            <div class="popup-title">Trainer Buffs</div>
            <button class="popup-close" id="closeCombatBuffsPopup">×</button>
          </div>
          <div class="popup-body" id="combatBuffsContent"></div>
        </div>
      </div>

      <!-- Switch Pokemon Popup -->
      <div class="popup-overlay" id="combatSwitchPopup" style="display:none;">
        <div class="popup-content combat-switch-popup-content">
          <div class="popup-header">
            <div class="popup-title">Switch Pokémon</div>
            <button class="popup-close" id="closeCombatSwitchPopup">×</button>
          </div>
          <div id="combatSwitchPopupBody" class="combat-switch-body popup-body"></div>
        </div>
      </div>

      <!-- Switch Initiative Popup -->
      <div class="popup-overlay" id="combatSwitchInitPopup" style="display:none;">
        <div class="popup-content" style="max-width:360px;">
          <div class="popup-header">
            <div class="popup-title" id="switchInitTitle">Initiative Roll</div>
            <button class="popup-close" id="closeCombatSwitchInitPopup">×</button>
          </div>
          <div class="popup-body">
            <p id="switchInitDesc" style="margin-bottom:1rem;color:#aaa;font-size:0.9rem;line-height:1.5;"></p>
            <div class="initiative-row" style="background:none;border:none;padding:0;margin-bottom:0.8rem;">
              <div class="initiative-roll-group" style="justify-content:center;width:100%;">
                <span class="initiative-plus">d20</span>
                <input type="number" class="initiative-bonus-input" id="switchInitInput" min="1" max="20" placeholder="Roll">
                <span class="initiative-equals">= <strong id="switchInitTotal">—</strong></span>
              </div>
            </div>
            <button id="confirmSwitchBtn" class="combat-start-btn" style="margin-top:0.5rem;" disabled>Switch In →</button>
          </div>
        </div>
      </div>

      <!-- Dice Recharge Confirmation Popup -->
      <div class="combat-popup-overlay" id="diceRechargePopup" style="display:none;">
        <div class="combat-popup-content" style="max-width:360px;padding:2rem;text-align:center;">
          <h3 id="diceRechargeMoveName" style="margin:0 0 0.6rem;color:#FFD700;font-size:1.1rem;"></h3>
          <p id="diceRechargeCriteria" style="margin:0 0 1.6rem;color:#aaa;font-size:0.95rem;"></p>
          <p style="margin:0 0 1.6rem;color:#e0e0e0;font-size:1rem;font-weight:600;">Move successfully recharged?</p>
          <div style="display:flex;gap:0.8rem;justify-content:center;">
            <button id="diceRechargeNo" class="combat-global-modal-btn gcm-cancel" style="min-width:80px;">No</button>
            <button id="diceRechargeYes" class="combat-global-modal-btn gcm-set" style="min-width:80px;">Yes</button>
          </div>
        </div>
      </div>

      <!-- Type Calculator Popup -->
      <div class="popup-overlay" id="combatTypeCalcPopup" style="display:none;">
        <div class="popup-content" style="max-width:min(92vw,460px)">
          <div class="popup-header">
            <div style="flex:1;display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;padding-left:2rem;min-width:0;">
              <div class="popup-title" id="typeCalcTitle"></div>
              <div id="typeCalcPokemonTypes" class="type-calc-type-row" style="margin:0;"></div>
            </div>
            <button class="popup-close" id="closeTypeCalcPopup">×</button>
          </div>
          <div class="popup-body">
            <div id="typeCalcWeakSection" class="type-eff-section">
              <div class="type-eff-label weak-label">Weakness</div>
              <div class="type-buttons-row" id="typeCalcWeak"></div>
            </div>
            <div id="typeCalcResistSection" class="type-eff-section">
              <div class="type-eff-label resist-label">Resistance</div>
              <div class="type-buttons-row" id="typeCalcResist"></div>
            </div>
            <div id="typeCalcImmuneSection" class="type-eff-section">
              <div class="type-eff-label immune-label">Immunity</div>
              <div class="type-buttons-row" id="typeCalcImmune"></div>
            </div>
            <div id="typeCalcAbilitySection" class="type-eff-section" style="display:none;">
              <div class="type-eff-label ability-effect-label" id="typeCalcAbilityLabel"></div>
              <div class="type-buttons-row" id="typeCalcAbility"></div>
            </div>
            <div id="typeCalcResult" class="type-calc-result"></div>
            <hr class="type-calc-divider">
            <div class="combat-stats-row">
              <div class="combat-stat-column">
                <div class="combat-stat-label">HP</div>
                <div class="combat-stat-value" id="typeCalcHpVal">—</div>
                <input type="number" id="typeCalcHpInput" class="combat-input" placeholder="Amount" min="0">
              </div>
              <div class="combat-stat-column">
                <div class="combat-stat-label">VP</div>
                <div class="combat-stat-value" id="typeCalcVpVal">—</div>
                <input type="number" id="typeCalcVpInput" class="combat-input" placeholder="Amount" min="0">
              </div>
            </div>
            <div class="combat-buttons">
              <button id="typeCalcAddBtn" class="combat-btn combat-btn-add">➕ Add</button>
              <button id="typeCalcRemoveBtn" class="combat-btn combat-btn-remove">➖ Remove</button>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

// ============================================================================
// COMBAT CARD
// ============================================================================

export function renderCombatCard(c, isActive, { compactWip, canReact, endTurnAtBottom, readOnly } = {}) {
  const fainted = c.currentHp <= 0;
  const hpPct = c.maxHp > 0 ? Math.round((c.currentHp / c.maxHp) * 100) : 0;
  const vpPct = c.maxVp > 0 ? Math.round((c.currentVp / c.maxVp) * 100) : 0;

  const typeBadges = c.types.map(t => `<span class="type-badge type-${t.toLowerCase()}">${t}</span>`).join('');

  // Values a live status (AC -1, all abilities +1...) is currently shifting -- see combat-wip.js's
  // _syncLocalCombatState. Shown as a small +/- next to the number so it's clear why it differs.
  const sm = c.appliedStatMods || {};
  const modTag = (key) => (sm[key]
    ? `<sup class="stat-mod-tag ${sm[key] > 0 ? 'up' : 'down'}" title="From live effects">${sm[key] > 0 ? '+' : ''}${sm[key]}</sup>`
    : '');

  const KNOWN_STATUSES = ['Poison','Burn','Confusion','Paralysis','Sleep','Freeze'];
  const _badgeHtml = (se) => {
    const dur = se.duration === -1 ? '' : ` (${se.duration})`;
    const isCustom = !KNOWN_STATUSES.includes(se.name);
    const cls = isCustom ? 'status-custom' : `status-${se.name.toLowerCase()}`;
    // Set only for effects the shared combat put there (see combat-wip.js's
    // _statusToBadge): clicking one opens its detail popup instead of the legacy
    // local remove, because the server owns it.
    const sid = se.serverStatusId ? ` data-server-status-id="${se.serverStatusId}"` : '';
    if (isCustom && se.description) {
      return `<span class="status-badge status-custom status-custom-expanded" data-combatant-id="${c.id}" data-effect="${se.name}"${sid}><span class="status-custom-name">${se.name}${dur}</span><span class="status-custom-desc">${se.description}</span></span>`;
    }
    return `<span class="status-badge ${cls}" data-combatant-id="${c.id}" data-effect="${se.name}"${sid}>${se.name}${dur}</span>`;
  };
  // Concentration effects (se.concentration -- see combat-wip.js's _statusToBadge)
  // group under one "Concentration" umbrella instead of showing as separate badges,
  // each still its own clickable entry underneath.
  const concEffects = c.statusEffects.filter(se => se.concentration);
  const otherEffects = c.statusEffects.filter(se => !se.concentration);
  const statusBadges = otherEffects.map(_badgeHtml).join('')
    + (concEffects.length ? `<span class="status-concentration-group"><span class="status-concentration-group-label">🧠 Concentration</span>${concEffects.map(_badgeHtml).join('')}</span>` : '');

  const expandedHTML = c.isExpanded ? renderExpandedSection(c, statusBadges, { compactWip, readOnly }) : '';

  return `
    <div class="combat-card ${isActive ? 'combat-card--active' : ''} ${fainted ? 'combat-card--fainted' : ''}" data-combatant-id="${c.id}" id="card_${c.id}">
      <div class="combat-card-main">
        <div class="combat-card-portrait-col">
          ${spriteMediaHtml(c.image, c.name, 'combat-card-img')}
          ${compactWip ? `<span class="combat-initiative-badge combat-initiative-badge--under-portrait">Init ${c.initiativeTotal}</span>` : ''}
        </div>
        <div class="combat-card-body">
          <div class="combat-card-name-row">
            <span class="combat-card-name ${fainted ? 'fainted-name' : ''}">${c.name}</span>
            <span class="combat-card-level">Lv ${c.level}</span>
            ${typeBadges}
            ${readOnly ? '' : compactWip
              ? `<button class="wip-react-btn" data-combatant-id="${c.id}" ${canReact ? '' : 'disabled'}>⚡ Reaction</button>`
              : `<span class="combat-initiative-badge">Init: ${c.initiativeTotal}</span>`}
          </div>
          <div class="combat-card-stats-group">
            ${c.hasStatBlock === false ? '' : `<div class="combat-card-ac-line">AC <strong>${c.ac} / ${c.baseAc}</strong>${modTag('ac')}</div>`}
            <div class="combat-card-stats-row">
              <span class="stat-bar-wrap">HP: <strong>${c.currentHp}/${c.maxHp}</strong>${c.tempHp ? `<sup class="temp-hp-tag" title="Temporary HP -- absorbs damage before real HP">+${c.tempHp}</sup>` : ''}
                <div class="mini-bar"><div class="mini-bar-fill hp-bar" style="width:${hpPct}%"></div></div>
              </span>
              <span class="stat-bar-wrap">VP: <strong>${c.currentVp}/${c.maxVp}</strong>
                <div class="mini-bar"><div class="mini-bar-fill vp-bar" style="width:${vpPct}%"></div></div>
              </span>
            </div>
          </div>
          ${c.hasStatBlock === false ? '' : `
          <div class="combat-card-stats-row combat-mods-row">
            <span>STR ${c.str}<small>(${formatMod(c.strMod)})</small>${modTag('str')}</span>
            <span>DEX ${c.dex}<small>(${formatMod(c.dexMod)})</small>${modTag('dex')}</span>
            <span>CON ${c.con}<small>(${formatMod(c.conMod)})</small>${modTag('con')}</span>
            <span>INT ${c.int}<small>(${formatMod(c.intMod)})</small>${modTag('int')}</span>
            <span>WIS ${c.wis}<small>(${formatMod(c.wisMod)})</small>${modTag('wis')}</span>
            <span>CHA ${c.cha}<small>(${formatMod(c.chaMod)})</small>${modTag('cha')}</span>
          </div>`}
        </div>
      </div>
      <div class="combat-card-footer">
        <div class="combat-status-badges">${statusBadges}</div>
        ${isActive && !readOnly && !endTurnAtBottom ? `<button class="end-turn-btn" data-combatant-id="${c.id}">End Turn</button>` : '<div></div>'}
      </div>
      ${expandedHTML}
      ${isActive && !readOnly && endTurnAtBottom ? `<button class="end-turn-btn combat-end-turn-bottom" data-combatant-id="${c.id}">End Turn</button>` : ''}
    </div>`;
}

function renderAbilitiesForCombat(raw) {
  if (!raw) return '';
  return raw.split('|').map(a => a.trim()).filter(Boolean).map(a => {
    const colonIdx = a.indexOf(':');
    const body = colonIdx !== -1 ? a.substring(colonIdx + 1) : a;
    const parts = body.split(';');
    const name = parts[0].trim();
    const desc = parts.slice(1).join(';').trim();
    return name ? `<div class="ability-entry"><strong>${name}</strong>${desc ? `<span class="ability-desc">: ${desc}</span>` : ''}</div>` : '';
  }).join('');
}

function renderItemForCombat(itemName) {
  if (!itemName) return '';
  const dbItem = getCachedItems().find(it => it.name === itemName);
  const desc = dbItem ? (dbItem.effect || dbItem.description || '') : '';
  return `<strong>${itemName}</strong>${desc ? `<span class="item-desc">: ${desc}</span>` : ''}`;
}

function renderExpandedSection(c, statusBadges, { compactWip, readOnly } = {}) {
  // --- Feats section (both) ---
  const featsSection = c.feats ? `
    <div class="expanded-feats-section">
      <div class="expanded-section-label">Feats</div>
      <div class="feats-list">
        ${c.feats.split(',').map(f => f.trim()).filter(Boolean).map(f => `<span class="feat-badge">${f}</span>`).join('')}
      </div>
    </div>` : '';

  // --- Trainer action buttons (trainer only) ---
  const hasBenchPokemon = (_battleState?.bench ?? []).length > 0;
  const ingrainLocked = (_battleState?.combatants ?? []).some(x =>
    x.type === 'pokemon' && x.currentHp > 0 &&
    x.statusEffects.some(se => se.name === 'Ingrain' && se.duration > 0)
  );
  const switchBtn = !hasBenchPokemon ? '' :
    ingrainLocked
      ? `<button class="combat-trainer-action-btn combat-switch-open-btn" disabled title="Cannot switch: a Pokémon is rooted by Ingrain" style="opacity:0.4;cursor:not-allowed;">⇄ Switch Pokémon</button>`
      : `<button class="combat-trainer-action-btn combat-switch-open-btn">⇄ Switch Pokémon</button>`;
  // Own-actions only (open your own bag/buffs, switch YOUR bench) -- meaningless
  // for a participant that isn't the viewer's own, so skipped in readOnly.
  const trainerActionsSection = c.type === 'trainer' && !readOnly ? `
    <div class="expanded-trainer-actions">
      <button class="combat-trainer-action-btn combat-inv-open-btn" data-combatant-id="${c.id}"><img src="assets/Bag.png" alt="Bag" class="combat-inv-icon"> Inventory</button>
      <button class="combat-trainer-action-btn combat-buffs-open-btn" data-combatant-id="${c.id}">✨ Trainer Buffs</button>
      ${switchBtn}
    </div>` : '';

  // --- Info section (pokemon only) ---
  const abilitiesHtml = renderAbilitiesForCombat(c.abilities);
  const itemHtml = renderItemForCombat(c.item);
  const SKILL_STAT = {
    'Athletics': 'STR',
    'Acrobatics': 'DEX', 'Sleight of Hand': 'DEX', 'Stealth': 'DEX',
    'Arcana': 'INT', 'History': 'INT', 'Investigation': 'INT', 'Nature': 'INT', 'Religion': 'INT',
    'Animal Handling': 'WIS', 'Insight': 'WIS', 'Medicine': 'WIS', 'Perception': 'WIS', 'Survival': 'WIS',
    'Deception': 'CHA', 'Intimidation': 'CHA', 'Performance': 'CHA', 'Persuasion': 'CHA'
  };
  const proficiencyDisplay = c.proficiency != null
    ? `+${c.proficiency}${c.skills ? ' — ' + c.skills.split(',').map(s => {
        const skill = s.trim().replace(/\+$/, '');
        const stat = SKILL_STAT[skill];
        return stat ? `${skill} (${stat})` : skill;
      }).filter(Boolean).join(', ') : ''}`
    : null;
  const savingThrowDisplay = c.proficiency != null && c.savingThrows && c.savingThrows.trim() && c.savingThrows.trim().toLowerCase() !== 'none'
    ? `+${c.proficiency} — ${c.savingThrows.split(',').map(s => s.trim()).filter(Boolean).join(', ')}`
    : null;
  const infoSection = c.type === 'pokemon' ? `
    <div class="expanded-info-section">
      <div class="expanded-section-label">Pokémon Info</div>
      <div class="info-grid">
        ${abilitiesHtml ? `<div class="info-row"><span class="info-label">Abilities</span><div class="info-ability-list">${abilitiesHtml}</div></div>` : ''}
        ${itemHtml     ? `<div class="info-row"><span class="info-label">Item</span><div>${itemHtml}</div></div>` : ''}
        ${c.size       ? `<div class="info-row"><span class="info-label">Size</span><span>${c.size}</span></div>` : ''}
        ${c.movement   ? `<div class="info-row"><span class="info-label">Movement</span><span>${c.movement}</span></div>` : ''}
        ${proficiencyDisplay ? `<div class="info-row"><span class="info-label">Proficiency</span><span>${proficiencyDisplay}</span></div>` : ''}
        ${savingThrowDisplay ? `<div class="info-row"><span class="info-label">Saving Throws</span><span>${savingThrowDisplay}</span></div>` : ''}
      </div>
    </div>` : `
    <div class="expanded-info-section">
      <div class="expanded-section-label">Trainer Stats</div>
      <div class="info-grid">
        ${proficiencyDisplay ? `<div class="info-row"><span class="info-label">Proficiency</span><span>${proficiencyDisplay}</span></div>` : ''}
        ${savingThrowDisplay ? `<div class="info-row"><span class="info-label">Saving Throws</span><span>${savingThrowDisplay}</span></div>` : ''}
      </div>
    </div>`;

  // --- HP / VP adjusters ---
  const typeCalcBtn = c.type === 'pokemon'
    ? `<button class="combat-type-calc-btn" data-combatant-id="${c.id}">🧮${compactWip ? ' Damage Calculator' : '<br>Damage<br>Calculator'}</button>`
    : `<button class="combat-type-calc-btn combat-trainer-hpvp-btn" data-combatant-id="${c.id}" style="background:rgba(76,175,80,0.12);border-color:rgba(76,175,80,0.5);color:#4CAF50;">HP/VP${compactWip ? ' Calculator' : '<br>Calculator'}</button>`;
  const critRow = c.type === 'pokemon' ? `
      <div class="hpvp-adjust-row" style="margin-top:0.35rem;">
        <span class="hpvp-stat-label">Crit</span>
        <button class="hpvp-btn" data-combatant-id="${c.id}" data-stat="crit" data-delta="-1">−</button>
        <input type="number" class="hpvp-input" value="${c.critMod || 0}" data-combatant-id="${c.id}" data-stat="crit">
        <span class="hpvp-max"></span>
        <button class="hpvp-btn" data-combatant-id="${c.id}" data-stat="crit" data-delta="1">+</button>
      </div>` : '';
  // HP/VP/AC/ability scores are all already visible on the base (non-expanded)
  // card at all times, so a readOnly viewer loses nothing but the edit widgets
  // themselves by skipping this -- except crit modifier, which only lives here,
  // so that alone gets a plain informational line.
  const hpvpSection = readOnly
    ? (c.type === 'pokemon' ? `
    <div class="expanded-hpvp-section">
      <div class="hpvp-adjust-row"><span class="hpvp-stat-label">Crit Modifier</span><span>${formatMod(c.critMod || 0)}</span></div>
    </div>` : '')
    : `
    <div class="expanded-hpvp-section">
      <div class="expanded-section-label">Adjust Stats</div>
      <div class="hpvp-hpvp-wrapper">
        <div class="hpvp-hpvp-left ${compactWip ? 'hpvp-hpvp-left--stacked' : ''}">
          <div class="hpvp-hpvp-rows">
            <div class="hpvp-adjust-row">
              <span class="hpvp-stat-label">HP</span>
              <button class="hpvp-btn" data-combatant-id="${c.id}" data-stat="hp" data-delta="-1">−</button>
              <input type="number" class="hpvp-input" value="${c.currentHp}" min="0" max="${c.maxHp}" data-combatant-id="${c.id}" data-stat="hp">
              <span class="hpvp-max">/ ${c.maxHp}</span>
              <button class="hpvp-btn" data-combatant-id="${c.id}" data-stat="hp" data-delta="1">+</button>
            </div>
            <div class="hpvp-adjust-row" style="margin-top:0.35rem;">
              <span class="hpvp-stat-label">VP</span>
              <button class="hpvp-btn" data-combatant-id="${c.id}" data-stat="vp" data-delta="-1">−</button>
              <input type="number" class="hpvp-input" value="${c.currentVp}" min="0" max="${c.maxVp}" data-combatant-id="${c.id}" data-stat="vp">
              <span class="hpvp-max">/ ${c.maxVp}</span>
              <button class="hpvp-btn" data-combatant-id="${c.id}" data-stat="vp" data-delta="1">+</button>
            </div>
          </div>
          ${typeCalcBtn}
        </div>
        <div class="hpvp-hpvp-right">
          <div class="hpvp-adjust-row">
            <span class="hpvp-stat-label">AC</span>
            <button class="hpvp-btn" data-combatant-id="${c.id}" data-stat="ac" data-delta="-1">−</button>
            <input type="number" class="hpvp-input" value="${c.ac}" data-combatant-id="${c.id}" data-stat="ac">
            <span class="hpvp-max">/ ${c.baseAc}</span>
            <button class="hpvp-btn" data-combatant-id="${c.id}" data-stat="ac" data-delta="1">+</button>
          </div>
          ${critRow}
        </div>
      </div>
    </div>`;

  // --- Stat adjusters (all combatants) ---
  const statNames = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
  const statKeys  = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  const modKeys   = ['strMod', 'dexMod', 'conMod', 'intMod', 'wisMod', 'chaMod'];
  const statItems = statNames.map((name, i) => `
    <div class="stat-adjust-item">
      <div class="stat-adjust-name">${name} <small>${formatMod(c[modKeys[i]])}</small></div>
      <div class="stat-adjust-controls">
        <button class="stat-delta-btn" data-combatant-id="${c.id}" data-stat="${statKeys[i]}" data-delta="-1">−</button>
        <input type="number" class="stat-adjust-val" value="${c[statKeys[i]]}" data-combatant-id="${c.id}" data-stat="${statKeys[i]}">
        <button class="stat-delta-btn" data-combatant-id="${c.id}" data-stat="${statKeys[i]}" data-delta="1">+</button>
      </div>
    </div>`).join('');

  // Purely an editing widget -- the same scores + modifiers it edits are already
  // shown in the base card's mods row, so readOnly just drops it, no info lost.
  const statSection = readOnly ? '' : `
    <div class="expanded-stats-adj-section">
      <div class="expanded-section-label">Modify Stats</div>
      <div class="stat-adjust-grid">
        ${statItems}
      </div>
    </div>`;

  // --- Status section ---
  const allEffects = ['Poison', 'Burn', 'Confusion', 'Paralysis', 'Sleep', 'Freeze'];
  const addStatusBtns = allEffects
    .filter(eff => !c.statusEffects.find(s => s.name === eff))
    .map(eff => `<button class="add-status-btn" data-combatant-id="${c.id}" data-effect="${eff}">${eff}</button>`)
    .join('');

  // Badges themselves already show in the footer regardless of readOnly (every
  // shared status is clickable for its own detail popup, ownership aside -- see
  // combat-wip.js's global _bindStatusBadgeClicks); this section is only the
  // ADD-a-status controls, plus the hint, so readOnly keeps the hint (when
  // there's something to tap) and drops everything else.
  const statusSection = readOnly
    ? (statusBadges ? `
    <div class="expanded-status-section">
      <div class="expanded-section-label">Status Effects</div>
      <div class="status-remove-hint">Tap a badge to remove it</div>
    </div>` : '')
    : `
    <div class="expanded-status-section">
      <div class="expanded-section-label">Status Effects</div>
      <div class="add-status-btns">
        ${addStatusBtns}
        <button class="add-status-btn combat-custom-status-btn" data-combatant-id="${c.id}">+ Custom…</button>
      </div>
      <div class="custom-status-form" id="customStatusForm_${c.id}" style="display:none;">
        <input type="text" class="custom-status-name-input" placeholder="Condition name…" maxlength="40">
        <input type="text" class="custom-status-effect-input" placeholder="Effect description (optional)…" maxlength="140">
        <button class="add-status-btn" data-combatant-id="${c.id}" data-action="addCustomStatus">Add</button>
        <button class="add-status-btn" data-combatant-id="${c.id}" data-action="cancelCustomStatus">Cancel</button>
      </div>
      ${statusBadges ? `<div class="status-remove-hint">Tap a badge to remove it</div>` : ''}
    </div>`;

  // --- Moves section (pokemon only) ---
  const movesSection = c.type === 'pokemon' && c.moves.length > 0 ? `
    <div class="expanded-moves-section">
      <div class="expanded-section-label">Moves</div>
      <div class="expanded-moves-list">
        ${c.moves.map(moveName => {
          const rs = c.rechargeStates && c.rechargeStates[moveName];
          const isLocked = rs && rs.chargesLeft <= 0;
          const isDice = rs && rs.type === 'DICE';
          let chargeText = '';
          if (rs) {
            if (isDice) chargeText = isLocked ? ' (spent)' : ` (${rs.range})`;
            else chargeText = ` (${rs.chargesLeft}/${rs.maxCharges} ${rs.type})`;
          }
          const isDiceLocked = isDice && isLocked;
          const label = `${moveName}${chargeText}`;
          // No move-use flow wired for a foreign card (see readOnly, above) --
          // a plain row instead of a clickable button, so it doesn't look like
          // it's supposed to do something on click.
          if (readOnly) return `<div class="combat-move-row"><div class="combat-move-item combat-move-item--display">${label}</div></div>`;
          return `<div class="combat-move-row">
            <button class="combat-move-item ${isLocked ? 'move-locked' : ''} ${isDiceLocked ? 'move-dice-locked' : ''}"
              data-move="${moveName}" data-combatant-id="${c.id}"
              data-is-dice-locked="${isDiceLocked ? 'true' : ''}"
              data-recharge-range="${isDice ? (rs.range || '') : ''}"
              ${isLocked && !isDice ? 'disabled' : ''}
            >${label}</button></div>`;
        }).join('')}
      </div>
    </div>` : '';

  return `
    <div class="combat-card-expanded" id="expanded_${c.id}">
      ${featsSection}
      ${infoSection}
      ${hpvpSection}
      ${statSection}
      ${statusSection}
      ${trainerActionsSection}
      ${movesSection}
    </div>`;
}

// ============================================================================
// CSS
// ============================================================================

function getCombatCSS() {
  return `
    .combat-page {
      min-height: 100vh;
      background: #1e0808;
      background-image: radial-gradient(circle at 1px 1px, rgba(255,255,255,0.04) 1px, transparent 0);
      background-size: 32px 32px;
      color: #e0e0e0;
      font-family: inherit;
      padding-bottom: 2rem;
      padding-top: 3.5rem;
    }
    .combat-header-bar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0.8rem 1rem;
      background: #1e0808;
      border-bottom: 1px solid rgba(255,255,255,0.15);
      position: fixed; top: 0; left: 0; right: 0; z-index: 100;
    }
    /* Absolutely positioned against the bar itself (already position:fixed,
       so it's the containing block) rather than left in the flex flow --
       justify-content:space-between only centers this when the button on
       each side happens to match in width, which Setup/Initiative/Battle's
       differing left+right buttons never do. */
    .combat-header-title {
      position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
      display: flex; align-items: center; gap: 0.4rem;
      font-size: 1.2rem; font-weight: 700; color: #FFD700; text-transform: uppercase; letter-spacing: 1px;
      white-space: nowrap;
    }
    .combat-header-title img { height: 1.6em; width: auto; }
    .combat-round-label { font-size: 1rem; font-weight: 700; color: #a0a0c0; }
    .combat-back-btn {
      background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);
      color: #e0e0e0; padding: 0.4rem 0.8rem; border-radius: 6px; cursor: pointer; font-size: 0.9rem;
    }
    .combat-end-btn {
      background: linear-gradient(135deg, #c0392b, #922b21); border: none;
      color: #fff; padding: 0.4rem 0.8rem; border-radius: 6px; cursor: pointer; font-size: 0.9rem; font-weight: 600;
    }
    .combat-wip-btn {
      background: linear-gradient(135deg, #8e44ad, #5b2c6f); border: none;
      color: #fff; padding: 0.4rem 0.8rem; border-radius: 6px; cursor: pointer; font-size: 0.9rem; font-weight: 600;
    }

    /* SETUP */
    .combat-setup-container { max-width: 600px; margin: 0 auto; padding: 1rem; }
    .setup-section-label { font-size: 0.7rem; font-weight: 700; letter-spacing: 1.5px; color: #888; text-transform: uppercase; margin: 1.2rem 0 0.4rem 0; }
    .setup-trainer-card { display: flex; align-items: center; gap: 0.8rem; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,215,0,0.3); border-radius: 10px; padding: 0.8rem 1rem; }
    .setup-trainer-card img { width: 56px; height: 56px; object-fit: contain; border-radius: 8px; background: rgba(255,255,255,0.05); }
    .setup-trainer-name { font-weight: 700; font-size: 1rem; }
    .setup-trainer-level { font-size: 0.85rem; color: #aaa; }
    .setup-pokemon-list { display: flex; flex-direction: column; gap: 0.5rem; }
    .setup-pokemon-card {
      display: flex; align-items: center; gap: 0.8rem;
      background: rgba(255,255,255,0.04); border: 2px solid rgba(255,255,255,0.1);
      border-radius: 10px; padding: 0.6rem 0.8rem; cursor: pointer; transition: all 0.2s; position: relative;
    }
    .setup-pokemon-card.selected { border-color: #4CAF50; background: rgba(76,175,80,0.12); }
    .setup-check { position: absolute; top: 6px; right: 8px; font-size: 1rem; color: #4CAF50; opacity: 0; transition: opacity 0.2s; }
    .setup-pokemon-card.selected .setup-check { opacity: 1; }
    .setup-pokemon-card img,
    .setup-pokemon-card video { width: 48px; height: 48px; object-fit: contain; }
    .setup-pokemon-name { font-weight: 600; font-size: 0.95rem; }
    .setup-pokemon-level { font-size: 0.8rem; color: #aaa; }
    .setup-pokemon-types { display: flex; gap: 4px; margin-top: 2px; }
    .setup-empty { color: #888; font-style: italic; padding: 1rem; text-align: center; }
    .combat-start-btn {
      display: block; width: 100%; margin-top: 1.5rem; padding: 0.9rem;
      background: linear-gradient(135deg, #667eea, #764ba2); color: #fff;
      border: none; border-radius: 10px; font-size: 1.1rem; font-weight: 700; cursor: pointer; transition: all 0.2s;
    }
    .combat-start-btn:disabled { background: rgba(255,255,255,0.1); color: #666; cursor: not-allowed; }

    /* INITIATIVE */
    .initiative-container { max-width: 600px; margin: 0 auto; padding: 1rem; }
    .initiative-instructions { font-size: 0.85rem; color: #aaa; margin-bottom: 1rem; }
    .initiative-list { display: flex; flex-direction: column; gap: 0.6rem; }
    .initiative-row {
      display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap;
      background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 0.6rem 0.8rem;
    }
    .initiative-img { width: 44px; height: 44px; object-fit: contain; flex-shrink: 0; }
    .initiative-info { flex: 1; min-width: 100px; }
    .initiative-name { font-weight: 600; font-size: 0.95rem; }
    .initiative-level { font-size: 0.75rem; color: #aaa; }
    .initiative-score-label { font-size: 0.8rem; color: #aaa; }
    .initiative-roll-group { display: flex; align-items: center; gap: 0.4rem; flex-wrap: nowrap; }
    .initiative-roll-btn { background: linear-gradient(135deg, #FFD700, #FFA500); color: #000; border: none; border-radius: 6px; padding: 0.35rem 0.65rem; font-weight: 700; font-size: 0.85rem; cursor: pointer; }
    .initiative-roll-input, .initiative-bonus-input { width: 52px; padding: 0.3rem; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; color: #e0e0e0; text-align: center; font-size: 0.9rem; }
    .initiative-plus, .initiative-equals { font-size: 0.9rem; color: #aaa; }
    .initiative-equals strong { color: #FFD700; font-size: 1rem; }

    /* BATTLE CARDS */
    .battle-list { max-width: 700px; margin: 0 auto; padding: 0.8rem; display: flex; flex-direction: column; gap: 0.6rem; }
    .combat-card { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; overflow: hidden; transition: border-color 0.2s, box-shadow 0.2s; }
    .combat-card--active { border: 2px solid #FFD700; box-shadow: 0 0 12px rgba(255,215,0,0.4); }
    .combat-card--fainted { opacity: 0.5; filter: grayscale(0.6); }
    .combat-card-main { display: flex; gap: 0.7rem; padding: 0.7rem; cursor: pointer; }
    /* Portrait + (compactWip only) Init badge, stacked directly under the image --
       not a stats-row entry, so it never pushes STR/DEX/CON/INT/WIS/CHA around. */
    .combat-card-portrait-col { display: flex; flex-direction: column; align-items: center; gap: 0.2rem; flex-shrink: 0; }
    .combat-card-img { width: 60px; height: 60px; object-fit: contain; flex-shrink: 0; border-radius: 8px; background: rgba(255,255,255,0.04); }
    .combat-card-body { flex: 1; min-width: 0; }
    .combat-card-name-row { display: flex; align-items: center; flex-wrap: wrap; gap: 0.3rem; margin-bottom: 0.35rem; }
    .combat-card-name { font-weight: 700; font-size: 1rem; }
    .fainted-name { text-decoration: line-through; color: #888; }
    .combat-card-level { font-size: 0.78rem; color: #aaa; }
    .combat-initiative-badge { margin-left: auto; font-size: 0.72rem; color: #FFD700; font-weight: 600; }
    .combat-initiative-badge--under-portrait { margin-left: 0; font-size: 0.62rem; white-space: nowrap; }
    .combat-card-stats-group { background: rgba(255,255,255,0.04); border-radius: 6px; padding: 0.2rem 0.45rem; margin-bottom: 0.2rem; }
    .combat-card-ac-line { font-size: 0.76rem; color: #c0c0c0; margin-bottom: 0.18rem; }
    .stat-mod-tag { font-size: 0.62rem; font-weight: 800; margin-left: 2px; }
    .stat-mod-tag.up { color: #2ecc71; }
    .stat-mod-tag.down { color: #e74c3c; }
    .temp-hp-tag { font-size: 0.62rem; font-weight: 800; margin-left: 2px; color: #6ec6ff; }
    .combat-card-stats-row { display: flex; flex-wrap: wrap; gap: 0.5rem; font-size: 0.82rem; }
    .combat-mods-row { display: grid; grid-template-columns: repeat(3, 1fr); font-size: 0.78rem; color: #c0c0c0; gap: 0.25rem 0.3rem; }
    .combat-mods-row small { color: #888; margin-left: 1px; }
    .stat-bar-wrap { display: flex; align-items: center; gap: 0.3rem; }
    .mini-bar { width: 48px; height: 5px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden; }
    .mini-bar-fill { height: 100%; border-radius: 3px; transition: width 0.3s; }
    .hp-bar { background: #4CAF50; }
    .vp-bar { background: #2196F3; }
    .combat-card-footer {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0.4rem 0.7rem; background: rgba(0,0,0,0.2); border-top: 1px solid rgba(255,255,255,0.06); min-height: 36px;
    }
    .combat-status-badges { display: flex; gap: 0.3rem; flex-wrap: wrap; }
    .status-badge { padding: 2px 8px; border-radius: 12px; font-size: 0.72rem; font-weight: 600; cursor: pointer; }
    .status-poison   { background: rgba(160,64,160,0.8);  color: #fff; }
    .status-burn     { background: rgba(240,80,20,0.8);   color: #fff; }
    .status-confusion{ background: rgba(255,215,0,0.8);   color: #000; }
    .status-paralysis{ background: rgba(255,200,0,0.8);   color: #000; }
    .status-sleep    { background: rgba(100,100,180,0.8); color: #fff; }
    .status-freeze   { background: rgba(88,200,237,0.8);  color: #000; }
    .end-turn-btn {
      background: linear-gradient(135deg, #e67e22, #d35400); color: #fff;
      border: none; border-radius: 6px; padding: 0.3rem 0.7rem; font-size: 0.82rem; font-weight: 600; cursor: pointer;
    }

    /* EXPANDED SECTION */
    .combat-card-expanded { background: rgba(0,0,0,0.3); border-top: 1px solid rgba(255,255,255,0.07); }
    .expanded-info-section,
    .expanded-hpvp-section,
    .expanded-stats-adj-section,
    .expanded-status-section,
    .expanded-moves-section { padding: 0.6rem 0.8rem; border-bottom: 1px solid rgba(255,255,255,0.05); }
    .expanded-moves-section { border-bottom: none; }
    .expanded-section-label { font-size: 0.65rem; font-weight: 700; letter-spacing: 1px; color: #888; text-transform: uppercase; margin-bottom: 0.35rem; }

    /* Info grid */
    .info-grid { display: flex; flex-direction: column; gap: 0.2rem; }
    .info-row { display: flex; gap: 0.5rem; font-size: 0.82rem; }
    .info-label { color: #aaa; min-width: 68px; flex-shrink: 0; font-weight: 600; }
    .info-ability-list { display: flex; flex-direction: column; gap: 0.15rem; }
    .ability-entry { line-height: 1.35; }
    .ability-desc { color: #b0b0b0; font-weight: 400; }
    .item-desc { color: #b0b0b0; font-weight: 400; }

    /* HP/VP adjusters */
    .hpvp-adjust-row { display: flex; align-items: center; gap: 0.4rem; }
    .hpvp-stat-label { font-size: 0.78rem; font-weight: 700; color: #aaa; min-width: 20px; }
    .hpvp-btn { width: 26px; height: 26px; flex-shrink: 0; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: #e0e0e0; border-radius: 6px; cursor: pointer; font-size: 1.1rem; display: flex; align-items: center; justify-content: center; }
    .hpvp-input { width: 52px; padding: 0.22rem; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; color: #e0e0e0; text-align: center; font-size: 0.9rem; }
    .hpvp-max { font-size: 0.82rem; color: #aaa; }

    /* Stat adjusters */
    .stat-adjust-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.4rem; }
    .stat-adjust-item { background: rgba(255,255,255,0.04); border-radius: 6px; padding: 0.35rem 0.4rem; }
    .stat-adjust-name { font-size: 0.72rem; font-weight: 700; color: #ccc; margin-bottom: 0.2rem; }
    .stat-adjust-name small { color: #888; font-weight: 400; }
    .stat-adjust-controls { display: flex; align-items: center; gap: 0.3rem; }
    .stat-delta-btn { width: 22px; height: 22px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); color: #e0e0e0; border-radius: 4px; cursor: pointer; font-size: 1rem; display: flex; align-items: center; justify-content: center; padding: 0; line-height: 1; }
    .stat-adjust-val { width: 42px; padding: 0.18rem; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); border-radius: 4px; color: #e0e0e0; text-align: center; font-size: 0.82rem; }

    /* Status */
    .add-status-btns { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-bottom: 0.3rem; }
    .add-status-btn { padding: 0.22rem 0.55rem; font-size: 0.75rem; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); color: #e0e0e0; border-radius: 12px; cursor: pointer; }
    .custom-status-form { display: flex; flex-wrap: wrap; gap: 0.35rem; align-items: center; margin-bottom: 0.4rem; }
    .custom-status-name-input { width: 110px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.2); color: #e0e0e0; border-radius: 6px; padding: 0.22rem 0.5rem; font-size: 0.75rem; }
    .custom-status-effect-input { flex: 1; min-width: 130px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.2); color: #e0e0e0; border-radius: 6px; padding: 0.22rem 0.5rem; font-size: 0.75rem; }
    .status-custom { background: rgba(150,100,220,0.3); color: #d4aaff; border: 1px solid rgba(180,130,255,0.5); }
    .status-custom-expanded { display: inline-flex; flex-direction: column; padding: 3px 8px; line-height: 1.3; }
    .status-custom-name { font-size: 0.72rem; font-weight: 700; }
    .status-custom-desc { font-size: 0.63rem; font-weight: 400; opacity: 0.9; }
    .status-remove-hint { font-size: 0.68rem; color: #888; }
    /* Groups every currently-active concentration effect (Sharpen's dice bonus, and
       any future concentration move alongside it) under one labeled umbrella instead
       of listing each as its own separate badge -- each stays individually clickable. */
    .status-concentration-group { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 3px 8px 3px 6px; border-radius: 12px; background: rgba(80,120,220,0.18); border: 1px solid rgba(120,150,255,0.4); }
    .status-concentration-group-label { font-size: 0.68rem; font-weight: 700; color: #a8c0ff; margin-right: 2px; }

    /* Moves */
    .expanded-moves-list { display: flex; flex-wrap: wrap; gap: 0.35rem; }
    .combat-move-row { display: flex; align-items: center; gap: 0.3rem; }
    .combat-move-item { padding: 0.3rem 0.7rem; border-radius: 14px; border: none; font-size: 0.78rem; font-weight: 600; cursor: pointer; transition: transform 0.1s; background: #888; color: #fff; }
    .combat-move-item:active { transform: scale(0.95); }
    .combat-move-item.move-locked { opacity: 0.4; cursor: not-allowed; background: #555 !important; color: #999 !important; }
    .combat-move-item.move-dice-locked { opacity: 0.7; cursor: pointer; background: rgba(255,165,0,0.15) !important; color: #FFA500 !important; border: 1px solid rgba(255,165,0,0.5) !important; }
    .combat-move-item.move-dice-locked:active { transform: scale(0.95); }
    .combat-move-item--display { cursor: default; }
    .combat-move-item--display:active { transform: none; }

    /* MOVE POPUP */
    .combat-popup-overlay { position: fixed; top:0; left:0; width:100%; height:100%; background: rgba(0,0,0,0.75); z-index: 1000; justify-content: center; align-items: center; backdrop-filter: blur(3px); }
    .combat-popup-content { background: #1e1e34; border: 1px solid rgba(255,255,255,0.12); border-radius: 16px; max-width: 560px; width: 92%; max-height: 85vh; overflow-y: auto; position: relative; box-shadow: 0 10px 40px rgba(0,0,0,0.6); }
    .combat-move-popup-header { padding: 1.1rem 1.2rem; border-radius: 16px 16px 0 0; border-bottom: 2px solid rgba(0,0,0,0.3); display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; position: relative; }
    .combat-move-popup-header h2 { margin: 0; font-size: 1.4rem; font-weight: 900; text-transform: uppercase; }
    .combat-move-type-badge { padding: 0.2rem 0.7rem; border-radius: 12px; font-size: 0.85rem; font-weight: 700; background: rgba(255,255,255,0.25); }
    .combat-popup-close { position: absolute; top: 0.8rem; right: 0.8rem; background: rgba(0,0,0,0.3); border: none; border-radius: 50%; width: 32px; height: 32px; font-size: 1.2rem; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; }
    .combat-move-popup-body { padding: 1rem 1.2rem; }
    .combat-move-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.4rem; margin-bottom: 0.8rem; font-size: 0.88rem; }
    .combat-move-description { background: rgba(255,255,255,0.06); border-radius: 8px; padding: 0.7rem; font-size: 0.88rem; line-height: 1.5; margin-bottom: 0.6rem; }
    .combat-move-higher { font-size: 0.82rem; margin-bottom: 0.8rem; opacity: 0.85; }
    .combat-move-rolls-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; background: rgba(255,255,255,0.05); border-radius: 8px; padding: 0.7rem; margin-bottom: 1rem; font-size: 0.88rem; }
    .combat-roll-bonus { font-size: 1.15em; font-weight: bold; }
    .combat-roll-breakdown { font-size: 0.75em; opacity: 0.8; margin-top: 0.2rem; }
    .combat-use-move-btn { width: 100%; padding: 0.75rem; background: linear-gradient(135deg, #4CAF50, #45A049); color: #fff; border: none; border-radius: 8px; font-size: 1rem; font-weight: 700; cursor: pointer; }
    .combat-move-held-items { background: rgba(255,255,255,0.06); border-radius: 8px; padding: 0.7rem; font-size: 0.88rem; line-height: 1.5; margin-bottom: 0.6rem; }
    .battle-dice-container, .tactician-container, .commander-container { background: rgba(255,255,255,0.06); border-radius: 8px; padding: 0.7rem; margin-bottom: 0.6rem; font-size: 0.88rem; }
    .tactician-ability, .commander-ability { padding: 0.35rem 0; border-top: 1px solid rgba(255,255,255,0.1); margin-top: 0.3rem; }
    .use-battle-dice-button, .use-tactician-button, .use-commander-button { padding: 0.3rem 0.7rem; background: linear-gradient(135deg, #4CAF50, #45A049); color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 0.82rem; font-weight: 700; }
    .use-battle-dice-button:disabled, .use-tactician-button:disabled, .use-commander-button:disabled { opacity: 0.4; cursor: not-allowed; }
    .tactician-input { width: 50px; padding: 0.2rem 0.4rem; background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.3); border-radius: 4px; color: inherit; font-size: 0.88rem; text-align: center; }
    .tp-dot, .commander-dot { width: clamp(10px,2vw,14px); height: clamp(10px,2vw,14px); border-radius: 50%; display: inline-block; box-shadow: 0 2px 4px rgba(0,0,0,0.3); }
    .tp-dot.filled, .commander-dot.filled { background: linear-gradient(135deg,#4CAF50,#45A049); border: 2px solid #FFDE00; box-shadow: 0 0 8px rgba(76,175,80,0.6); }
    .tp-dot.empty, .commander-dot.empty { background: rgba(100,100,100,0.4); border: 2px solid rgba(150,150,150,0.5); }

    /* FEATS */
    .expanded-feats-section { padding: 0.5rem 0.8rem; border-bottom: 1px solid rgba(255,255,255,0.05); }
    .feats-list { display: flex; flex-wrap: wrap; gap: 0.3rem; }
    .feat-badge { background: rgba(255,215,0,0.12); border: 1px solid rgba(255,215,0,0.3); color: #FFD700; padding: 2px 8px; border-radius: 10px; font-size: 0.72rem; font-weight: 600; }

    /* TRAINER ACTIONS */
    .expanded-trainer-actions { display: flex; gap: 0.5rem; padding: 0.6rem 0.8rem; border-bottom: 1px solid rgba(255,255,255,0.05); flex-wrap: wrap; }
    .combat-trainer-action-btn { padding: 0.38rem 0.85rem; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.18); color: #e0e0e0; border-radius: 8px; cursor: pointer; font-size: 0.82rem; font-weight: 600; transition: background 0.15s; }
    .combat-trainer-action-btn:hover { background: rgba(255,255,255,0.14); }

    /* BAG ICON */
    .combat-inv-icon { width: 18px; height: 18px; object-fit: contain; vertical-align: middle; margin-right: 2px; }

    /* TRAINER-INFO STYLE POPUPS */
    .popup-overlay { position: fixed; top:0; left:0; width:100%; height:100%; background: rgba(0,0,0,0.7); z-index: 2000; justify-content: center; align-items: center; backdrop-filter: blur(3px); }
    .popup-content { background: linear-gradient(160deg,var(--surface-solid),var(--surface-solid-deep)); border: 1px solid var(--border-accent); border-radius: 20px; padding: clamp(1.5rem,3vw,2.5rem); max-width: min(90vw,600px); max-height: 80vh; overflow-y: auto; position: relative; box-shadow: 0 15px 40px rgba(0,0,0,0.8); width: 92%; }
    .popup-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: clamp(1rem,2vh,1.5rem); padding-bottom: clamp(0.75rem,1.5vh,1rem); border-bottom: 1px solid var(--border-accent); }
    .popup-title { font-size: clamp(1.3rem,3vw,1.8rem); font-weight: 900; text-transform: uppercase; letter-spacing: 1px; color: #FFDE00; text-shadow: 0 2px 4px rgba(0,0,0,0.8); }
    .popup-close { background: linear-gradient(135deg,#EE1515,#C91010); color: #fff; border: 2px solid #333; border-radius: 50%; width: clamp(35px,7vw,45px); height: clamp(35px,7vw,45px); font-size: clamp(1.2rem,2.5vw,1.6rem); font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.3s; flex-shrink: 0; }
    .popup-close:hover { transform: scale(1.1) rotate(90deg); box-shadow: 0 5px 15px rgba(0,0,0,0.4); }
    .popup-body { color: #e0e0e0; font-size: clamp(0.95rem,2vw,1.1rem); line-height: 1.6; }

    /* INVENTORY POPUP */
    .combat-inv-popup-content { max-width: min(90vw,900px); max-height: 85vh; padding: 0; overflow: hidden; display: flex; flex-direction: column; }
    .inventory-popup-content { display: flex; height: 100%; flex: 1; overflow: hidden; min-height: 400px; }
    .inventory-sidebar { width: clamp(200px,35%,400px); background: linear-gradient(135deg,#2c2c2c,#252525); color: #fff; display: flex; flex-direction: column; border-right: 2px solid #333; overflow: hidden; }
    .inventory-title { padding: clamp(1rem,2vh,1.5rem); margin: 0; background: linear-gradient(135deg,#EE1515,#C91010); color: #fff; font-size: clamp(1.2rem,3vw,1.8rem); font-weight: 900; text-align: center; border-bottom: 2px solid #333; text-transform: uppercase; letter-spacing: 1px; text-shadow: 0 2px 4px rgba(0,0,0,0.5); }
    .inventory-categories { list-style: none; padding: 0; margin: 0; overflow-y: auto; flex: 1; }
    .category-header { padding: clamp(0.75rem,2vh,1rem) clamp(1rem,2.5vw,1.4rem); background: #3a3a3a; cursor: pointer; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #444; transition: all 0.2s; font-size: clamp(0.8rem,1.9vw,1rem); font-weight: 700; }
    .category-header:hover { background: #4a4a4a; }
    .category-header.active { background: linear-gradient(135deg,#EE1515,#C91010); color: #fff; }
    .arrow { transition: transform 0.2s; font-size: 0.85rem; }
    .category-header.active .arrow { transform: rotate(90deg); }
    .item-list { background: #2c2c2c; padding: 0; max-height: 0; overflow: hidden; transition: max-height 0.3s ease; }
    .item-list.expanded { max-height: 500px; overflow-y: auto; }
    .inventory-list-item { padding: clamp(0.5rem,1.5vh,0.75rem) clamp(1.2rem,3vw,1.8rem); cursor: pointer; transition: all 0.2s; border-left: 3px solid transparent; color: #ddd; font-size: clamp(0.78rem,1.8vw,0.9rem); }
    .inventory-list-item:hover { background: #3a3a3a; border-left-color: #EE1515; color: #fff; }
    .inventory-list-item.selected { background: #EE1515; color: #fff; border-left-color: #fff; font-weight: 700; }
    .inventory-search-wrapper { padding: 0.6rem 0.8rem; }
    .inventory-search-input { width: 100%; padding: 0.45rem 0.7rem; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; color: #fff; font-size: 0.88rem; box-sizing: border-box; outline: none; }
    .inventory-search-input:focus { border-color: #EE1515; }
    .inventory-search-results { list-style: none; padding: 0; margin: 0; overflow-y: auto; display: none; }
    .inventory-search-results.active { display: block; }
    .inventory-search-no-results { padding: 0.75rem 1rem; color: #999; font-size: 0.88rem; text-align: center; }
    .inventory-main { flex: 1; display: flex; flex-direction: column; padding: clamp(1rem,2.5vw,1.5rem); background: linear-gradient(160deg,var(--surface-solid),var(--surface-solid-deep)); overflow: hidden; }
    .item-info-card { flex: 1; display: flex; flex-direction: column; background: linear-gradient(135deg,#353535,#2d2d2d); border-radius: 12px; padding: clamp(1rem,2vw,1.5rem); box-shadow: 0 4px 20px rgba(0,0,0,0.5); margin-bottom: 1rem; overflow-y: auto; border: 2px solid rgba(255,222,0,0.3); }
    .item-name { font-size: clamp(1.2rem,3vw,1.8rem); color: #FFDE00; margin: 0 0 0.75rem 0; padding-bottom: 0.75rem; border-bottom: 2px solid rgba(255,222,0,0.3); font-weight: 900; text-transform: uppercase; letter-spacing: 1px; text-shadow: 0 2px 4px rgba(0,0,0,0.6); }
    .item-details { display: flex; flex-direction: column; gap: 1rem; flex: 1; }
    .detail-section { flex: 1; }
    .detail-section h4 { font-size: clamp(0.9rem,2vw,1.1rem); color: #FFDE00; margin: 0 0 0.5rem 0; font-weight: 900; text-transform: uppercase; }
    .detail-section p { font-size: clamp(0.85rem,1.9vw,1rem); color: #c0c0c0; line-height: 1.6; margin: 0; }
    .detail-divider { height: 2px; background: linear-gradient(90deg,transparent,rgba(255,222,0,0.3),transparent); }
    .inventory-close { position: absolute; top: clamp(12px,2.5vh,18px); right: clamp(12px,2.5vw,18px); width: clamp(32px,7vw,42px); height: clamp(32px,7vw,42px); background: linear-gradient(135deg,#757575,#616161); color: #fff; border: 2px solid #FFDE00; border-radius: 50%; font-size: clamp(1.3rem,3vw,1.8rem); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.3s; z-index: 10; }
    .inventory-close:hover { transform: scale(1.1) rotate(90deg); box-shadow: 0 0 20px rgba(255,222,0,0.6); }
    .inventory-actions { display: flex; flex-direction: column; align-items: center; gap: 0.5rem; }
    .inventory-actions-row { display: flex; gap: 0.5rem; justify-content: center; }
    .inventory-actions .action-btn { display: flex; flex-direction: row; align-items: center; justify-content: center; gap: 0.4rem; padding: 0.6rem 1.2rem; border: 2px solid #333; border-radius: 10px; cursor: pointer; transition: all 0.3s; font-size: clamp(0.8rem,1.7vw,0.95rem); font-weight: 900; text-transform: uppercase; background: linear-gradient(135deg,#3B4CCA,#2E3FA0); color: #fff; }
    .inventory-actions .action-btn:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 6px 18px rgba(0,0,0,0.4); }
    .inventory-actions .action-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn-icon { font-size: clamp(0.9rem,1.9vw,1.1rem); }
    .btn-text { font-size: clamp(0.75rem,1.6vw,0.9rem); }

    /* BUFFS POPUP (skill items) */
    .skill-item-container { border: 2px solid rgba(255,222,0,0.4); border-radius: 10px; margin: 0.75rem; padding: 0.85rem; background: linear-gradient(135deg,rgba(255,222,0,0.1),rgba(255,222,0,0.05)); }
    .skill-name-header { text-align: center; font-weight: 900; font-size: clamp(1rem,2.2vw,1.15rem); margin: 0 0 0.6rem 0; color: #FFDE00; text-transform: uppercase; text-shadow: 0 1px 3px rgba(0,0,0,0.6); }
    .skill-effect-box { border: 1px solid rgba(255,222,0,0.3); border-radius: 7px; padding: 0.65rem; text-align: left; background: rgba(0,0,0,0.2); color: #e0e0e0; font-size: clamp(0.85rem,1.9vw,0.95rem); line-height: 1.5; }
    .skill-header-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.6rem; }
    .charge-dots { display: flex; gap: 5px; align-items: center; }
    .charge-dot { width: clamp(10px,2vw,14px); height: clamp(10px,2vw,14px); border-radius: 50%; display: inline-block; box-shadow: 0 2px 4px rgba(0,0,0,0.3); }
    .charge-dot.filled { background: linear-gradient(135deg,#4CAF50,#45A049); border: 2px solid #FFDE00; box-shadow: 0 0 8px rgba(76,175,80,0.6); }
    .charge-dot.empty { background: rgba(100,100,100,0.4); border: 2px solid rgba(150,150,150,0.5); }
    .use-buff-button { margin-top: 0.6rem; padding: 0.55rem 1.2rem; background: linear-gradient(135deg,#4CAF50,#45A049); color: #fff; border: 2px solid #FFDE00; border-radius: 10px; font-size: clamp(0.9rem,2vw,1rem); font-weight: 900; text-transform: uppercase; cursor: pointer; width: 100%; transition: all 0.3s; }
    .use-buff-button:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 5px 15px rgba(76,175,80,0.5); }
    .use-buff-button:disabled { background: linear-gradient(135deg,#666,#555); border-color: #888; cursor: not-allowed; opacity: 0.6; }

    /* TYPE BADGES */
    .type-badge { padding: 1px 7px; border-radius: 10px; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; }
    .type-normal{background:#A8A878;color:#000}.type-fighting{background:#e68c2e;color:#000}.type-flying{background:#A890F0;color:#000}
    .type-poison{background:#A040A0;color:#fff}.type-ground{background:#A67C52;color:#fff}.type-rock{background:#a85d16;color:#fff}
    .type-bug{background:#A8B820;color:#000}.type-ghost{background:#705898;color:#fff}.type-steel{background:#bdbdbd;color:#000}
    .type-fire{background:#f02e07;color:#fff}.type-water{background:#1E90FF;color:#fff}.type-grass{background:#32CD32;color:#000}
    .type-electric{background:#FFD700;color:#000}.type-psychic{background:#F85888;color:#fff}.type-ice{background:#58c8ed;color:#000}
    .type-dragon{background:#280dd4;color:#fff}.type-dark{background:#282729;color:#fff}.type-fairy{background:#ed919f;color:#000}
    .type-cosmic{background:#120077;color:#fff}

    /* TYPE CALCULATOR */
    .hpvp-hpvp-wrapper { display: flex; align-items: stretch; gap: 1.4rem; }
    .hpvp-hpvp-left { flex: 1; min-width: 0; display: flex; flex-direction: row; align-items: stretch; gap: 0.4rem; }
    .hpvp-hpvp-rows { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .hpvp-hpvp-right { flex: 0 0 auto; border-left: 1px solid rgba(255,255,255,0.15); padding-left: 0.3rem; }
    .combat-type-calc-btn { background: rgba(255,165,0,0.12); border: 1px solid rgba(255,165,0,0.5); border-radius: 8px; color: #FFA500; font-size: 0.74rem; font-weight: 700; padding: 0.3rem 0.6rem; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; line-height: 1.4; min-width: 72px; align-self: stretch; }
    .combat-type-calc-btn:hover { background: rgba(255,165,0,0.28); }
    /* COMBAT TRACKER (inside type calc popup) */
    .type-calc-divider { border: none; border-top: 1px solid rgba(255,255,255,0.12); margin: 0.8rem 0 0.6rem; }
    .combat-stats-row { display: flex; gap: 1rem; margin-bottom: 0.6rem; }
    .combat-stat-column { flex: 1; display: flex; flex-direction: column; gap: 0.3rem; }
    .combat-stat-label { font-size: 0.78rem; font-weight: 700; color: #FFDE00; text-transform: uppercase; }
    .combat-stat-value { font-size: 1.05rem; font-weight: 700; color: #e0e0e0; }
    .combat-input { width: 100%; padding: 0.45rem 0.5rem; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; color: #e0e0e0; font-size: 0.9rem; box-sizing: border-box; }
    .combat-buttons { display: flex; gap: 0.5rem; }
    .combat-btn { flex: 1; padding: 0.55rem; border: none; border-radius: 8px; font-size: 0.9rem; font-weight: 700; cursor: pointer; transition: transform 0.1s; }
    .combat-btn:active { transform: scale(0.97); }
    .combat-btn-add { background: linear-gradient(135deg,#4CAF50,#45A049); color: #fff; }
    .combat-btn-remove { background: linear-gradient(135deg,#EE1515,#C91010); color: #fff; }
    .type-calc-type-row { display: flex; gap: 0.4rem; flex-wrap: wrap; margin-bottom: 0.75rem; justify-content: center; }
    .type-calc-badge { padding: 0.2rem 0.75rem; border-radius: 12px; font-size: 0.88rem; font-weight: 700; }
    .type-eff-section { margin-bottom: 0.55rem; }
    .type-eff-label { font-size: 0.74rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 0.3rem; text-align: center; }
    .weak-label { color: #ff7777; }
    .resist-label { color: #88aaff; }
    .immune-label { color: #aaaaaa; }
    .ability-effect-label { color: #c792ea; }
    .neutral-label { color: #cccccc; }
    .type-buttons-row { display: flex; flex-wrap: wrap; gap: 0.3rem; justify-content: center; }
    .combat-type-button { padding: 0.22rem 0.6rem; border-radius: 10px; border: 2px solid transparent; font-size: 0.76rem; font-weight: 700; cursor: pointer; transition: transform 0.1s, border-color 0.15s, box-shadow 0.15s; }
    .combat-type-button:hover { transform: scale(1.06); }
    .combat-type-button.selected { border-color: #fff; box-shadow: 0 0 8px rgba(255,255,255,0.55); transform: scale(1.1); }
    .type-calc-result { margin-top: 0.75rem; padding: 0.65rem 1rem; border-radius: 10px; font-size: 1rem; font-weight: 900; text-align: center; text-transform: uppercase; letter-spacing: 0.05em; display: none; }
    .type-calc-result.show { display: block; }
    .type-calc-weak { background: rgba(255,80,80,0.2); border: 2px solid rgba(255,100,100,0.7); color: #ff8888; }
    .type-calc-resist { background: rgba(100,150,255,0.18); border: 2px solid rgba(100,150,255,0.6); color: #88aaff; }
    .type-calc-immune { background: rgba(150,150,150,0.18); border: 2px solid rgba(150,150,150,0.5); color: #aaa; }
    .type-calc-neutral { background: rgba(255,255,255,0.07); border: 2px solid rgba(255,255,255,0.2); color: #ccc; }

    /* ITEM ACTION AREA */
    .combat-item-action-area { margin-top: 0.75rem; }
    .combat-item-target-select { width: 100%; padding: 0.6rem; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,222,0,0.3); border-radius: 8px; color: #e0e0e0; font-size: 0.9rem; margin-bottom: 0.5rem; }
    .combat-item-roll-row { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; }
    .combat-item-roll-label { color: #FFDE00; font-weight: 700; font-size: 0.9rem; flex-shrink: 0; }
    .combat-item-roll-input { width: 80px; padding: 0.4rem; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; color: #e0e0e0; text-align: center; font-size: 0.9rem; }
    .combat-item-heal-preview { font-size: 0.82rem; color: #4CAF50; margin-bottom: 0.5rem; min-height: 1.2em; }

    /* SWITCH POKEMON POPUP */
    .combat-switch-popup-content { max-width: min(92vw,500px); }
    .combat-switch-body { display: flex; flex-direction: column; gap: 0.5rem; }
    .switch-pokemon-card {
      display: flex; align-items: center; gap: 0.8rem;
      background: rgba(255,255,255,0.05); border: 2px solid rgba(255,255,255,0.1);
      border-radius: 10px; padding: 0.6rem 0.8rem; cursor: pointer; transition: all 0.18s;
    }
    .switch-pokemon-card:hover:not(.fainted-bench) { border-color: rgba(102,126,234,0.7); background: rgba(102,126,234,0.12); }
    .switch-pokemon-card.fainted-bench { opacity: 0.4; cursor: not-allowed; pointer-events: none; }
    .switch-poke-img { width: 52px; height: 52px; object-fit: contain; flex-shrink: 0; border-radius: 6px; background: rgba(255,255,255,0.04); }
    .switch-poke-info { flex: 1; min-width: 0; }
    .switch-poke-name { font-weight: 700; font-size: 0.92rem; display: flex; align-items: center; flex-wrap: wrap; gap: 0.3rem; margin-bottom: 0.25rem; }
    .switch-poke-stats { font-size: 0.82rem; color: #b0b0b0; display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
    .switch-init-label { background: rgba(255,215,0,0.15); border: 1px solid rgba(255,215,0,0.4); color: #FFD700; padding: 1px 7px; border-radius: 10px; font-size: 0.72rem; font-weight: 700; }
    .switch-init-new { background: rgba(76,175,80,0.15); border-color: rgba(76,175,80,0.4) !important; color: #4CAF50 !important; }
    .switch-no-bench { color: #888; font-style: italic; padding: 1rem; text-align: center; }

    @media (max-width: 480px) {
      .hpvp-hpvp-wrapper { flex-direction: column; gap: 0.5rem; }
      .hpvp-hpvp-left { flex-direction: column; align-items: stretch; }
      .hpvp-hpvp-right { border-left: none; padding-left: 0; border-top: 1px solid rgba(255,255,255,0.15); padding-top: 0.4rem; }
      .combat-type-calc-btn { align-self: flex-start; min-width: 0; width: auto; }
      .stat-adjust-grid { grid-template-columns: repeat(2, 1fr); }
      .combat-mods-row { grid-template-columns: repeat(2, 1fr); }
      .inventory-sidebar { width: clamp(100px, 36%, 140px); }
      .inventory-title { font-size: 0.7rem; padding: 0.5rem 0.4rem; letter-spacing: 0; }
      .category-header { font-size: 0.62rem; padding: 0.5rem 0.5rem; }
      .inventory-list-item { font-size: 0.58rem; padding: 0.4rem 0.6rem; }
    }

    /* GLOBAL CONDITIONS BAR (weather / terrain) */
    .combat-global-bar {
      display: flex; align-items: center; justify-content: center; gap: 0.6rem; flex-wrap: wrap;
      padding: 0.45rem 1rem;
      background: rgba(0,0,0,0.22);
      border-bottom: 1px solid rgba(255,255,255,0.07);
      min-height: 38px;
    }
    .combat-global-btn {
      background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.18);
      color: #b0b0b0; padding: 0.22rem 0.65rem; border-radius: 6px; cursor: pointer;
      font-size: 0.78rem; font-weight: 600; transition: all 0.18s; white-space: nowrap;
    }
    .combat-global-btn:hover { background: rgba(255,255,255,0.14); border-color: rgba(255,215,0,0.4); color: #FFD700; }
    .combat-condition-badge {
      display: flex; align-items: center; gap: 0.35rem;
      background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.2);
      border-radius: 8px; padding: 0.18rem 0.3rem 0.18rem 0.5rem; max-width: 260px;
    }
    .condition-icon { font-size: 0.95rem; flex-shrink: 0; }
    .condition-text { flex: 1; min-width: 0; }
    .condition-name { font-size: 0.8rem; font-weight: 700; color: #FFD700; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .condition-effect { font-size: 0.7rem; color: #a0a0a0; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .condition-clear-btn {
      background: none; border: none; color: rgba(255,255,255,0.35); cursor: pointer;
      font-size: 0.7rem; padding: 0 0.15rem; flex-shrink: 0; line-height: 1; transition: color 0.15s;
    }
    .condition-clear-btn:hover { color: #ff6b6b; }

    /* Global condition modal */
    .combat-condition-form-label {
      display: block; color: #FFD700; font-weight: 700; text-transform: uppercase;
      font-size: 0.78rem; letter-spacing: 0.5px; margin-bottom: 0.4rem;
    }
    .combat-global-modal-btn {
      padding: 0.5rem 1.2rem; border-radius: 7px; border: none; cursor: pointer;
      font-size: 0.88rem; font-weight: 700; transition: all 0.18s;
    }
    .combat-global-modal-btn.gcm-cancel { background: rgba(255,255,255,0.08); color: #ccc; border: 1px solid rgba(255,255,255,0.2); }
    .combat-global-modal-btn.gcm-cancel:hover { background: rgba(255,255,255,0.15); }
    .combat-global-modal-btn.gcm-clear { background: rgba(255,107,107,0.12); color: #ff8080; border: 1px solid rgba(255,107,107,0.3); }
    .combat-global-modal-btn.gcm-clear:hover { background: rgba(255,107,107,0.22); }
    .combat-global-modal-btn.gcm-set { background: linear-gradient(135deg, #667eea, #764ba2); color: #fff; border: none; }
    .combat-global-modal-btn.gcm-set:hover { filter: brightness(1.15); }
  `;
}

// Evaluated once at module load — avoids re-building and re-parsing the stylesheet on every phase transition
export const COMBAT_CSS = getCombatCSS();

// ============================================================================
// LISTENERS
// ============================================================================

export function attachCombatListeners() {
  const state = getCombatState();
  const phase = state ? state.phase : 'setup';
  if (phase === 'initiative') attachInitiativeListeners(state);
  else if (phase === 'battle') attachBattleListeners(state);
  else attachSetupListeners();
}

// -------------------------------- SETUP ------------------------------------

// onStart, when passed, is called with { trainerCombatant, activePokemon,
// bench, allPartyKeys } instead of the default local saveCombatState +
// render-initiative-locally behavior -- see combat-wip.js's reuse of this
// same function for the shared multiplayer join flow. Omitted (the default),
// this behaves exactly as before -- zero change to the legacy local flow.
export function attachSetupListeners({ backRoute = 'trainer-card', onStart } = {}) {
  document.getElementById('combatBackBtn')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('navigate', { detail: { route: backRoute } }));
  });

  document.getElementById('combatWipBtn')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('navigate', { detail: { route: 'combat-wip' } }));
  });

  const startBtn = document.getElementById('startCombatBtn');

  document.querySelectorAll('.setup-pokemon-card').forEach(card => {
    card.addEventListener('click', () => {
      const wasSelected = card.classList.contains('selected');
      // Deselect all, then select this one (unless it was already selected — toggle off)
      document.querySelectorAll('.setup-pokemon-card').forEach(c => c.classList.remove('selected'));
      if (!wasSelected) card.classList.add('selected');
      startBtn.disabled = document.querySelectorAll('.setup-pokemon-card.selected').length === 0;
    });
  });

  startBtn?.addEventListener('click', () => {
    loadCombatMoves();
    loadMoveCategories();
    const selectedKeys = [...document.querySelectorAll('.setup-pokemon-card.selected')].map(el => el.dataset.pokemonKey);
    const allPartyKeys = [...document.querySelectorAll('.setup-pokemon-card')].map(el => el.dataset.pokemonKey);
    const benchKeys = allPartyKeys.filter(k => !selectedKeys.includes(k));

    const activePokemon = buildPokemonCombatant(selectedKeys[0]);
    activePokemon.hasRolledInitiative = false;
    const trainerCombatant = buildTrainerCombatant();

    const bench = benchKeys.map(k => {
      const bc = buildPokemonCombatant(k);
      bc.hasRolledInitiative = false;
      return bc;
    });

    if (onStart) {
      onStart({ trainerCombatant, activePokemon, bench, allPartyKeys });
      return;
    }

    const combatants = [trainerCombatant, activePokemon];
    saveCombatState({ phase: 'initiative', round: 1, activeTurnIndex: 0, combatants, bench, partyKeys: allPartyKeys });
    const content = document.getElementById('content');
    content.innerHTML = renderCombat();
    attachCombatListeners();
  });
}

// ------------------------------ INITIATIVE ---------------------------------

// onComplete/onBack, when passed, replace the default local phase-transition
// behavior (see attachSetupListeners above for the same pattern) -- omitted,
// this is unchanged from before. onComplete receives state.combatants with
// initiativeTotal set (not yet sorted/saved) so a caller can do its own
// thing with the rolled values instead of the local sort+saveCombatState.
export function attachInitiativeListeners(state, { onComplete, onBack } = {}) {
  document.getElementById('combatBackBtn')?.addEventListener('click', () => {
    if (onBack) { onBack(); return; }
    sessionStorage.removeItem('combatState');
    document.getElementById('content').innerHTML = renderCombat();
    attachCombatListeners();
  });

  document.querySelectorAll('.initiative-bonus-input').forEach(input => {
    input.addEventListener('input', () => recalcInitiativeTotal(input.id.replace('bonus_', ''), state));
  });

  document.getElementById('beginBattleBtn')?.addEventListener('click', (e) => {
    // onComplete (combat-wip.js) awaits an add-participant round-trip per
    // combatant before finally re-rendering the page out from under this
    // button -- without disabling it immediately, a second click (double-
    // click, or just an impatient re-click while nothing visibly happens
    // yet) fires onComplete again and adds the same trainer/Pokemon a
    // second time under a brand new server-generated id.
    const btn = e.currentTarget;
    if (btn.disabled) return;
    btn.disabled = true;

    state.combatants.forEach(c => {
      c.initiativeBonus = parseInt(document.getElementById(`bonus_${c.id}`)?.value) || 0;
      c.initiativeTotal = c.initiativeScore + c.initiativeBonus;
      c.hasRolledInitiative = true;
    });

    if (onComplete) {
      onComplete(state.combatants);
      return;
    }

    state.combatants.sort((a, b) => b.initiativeTotal - a.initiativeTotal);
    state.phase = 'battle';
    state.activeTurnIndex = 0;
    saveCombatState(state);
    document.getElementById('content').innerHTML = renderCombat();
    attachCombatListeners();
  });
}

function recalcInitiativeTotal(id, state) {
  const c = state.combatants.find(x => x.id === id);
  if (!c) return;
  const bonus = parseInt(document.getElementById(`bonus_${id}`)?.value) || 0;
  const totalEl = document.getElementById(`total_${id}`);
  if (totalEl) totalEl.textContent = c.initiativeScore + bonus;
}

// -------------------------------- BATTLE -----------------------------------

export function attachBattleListeners(state, { onDamageResolved, onSaveTriggered, onReactiveSave, onMultiHitAoe, onEffectsOnly, ...cardOptions } = {}) {
  _battleState = state;
  _battleCardOptions = cardOptions; // see rerenderBattle -- every internal re-render (a move popup
  // confirming, an HP/VP adjuster click, etc.) needs to keep reusing the same per-card render
  // options this call was given, without every one of those many internal call sites having to
  // pass them through by hand.
  loadCombatMoves();
  loadMoveCategories();
  initializeRechargeStates(state);

  document.getElementById('endCombatBtn')?.addEventListener('click', () => endCombat(state));

  // ── Global conditions (weather / terrain) ──────────────────────────────────
  let _gcmType = null; // 'weather' | 'terrain'

  const gcModal    = document.getElementById('globalConditionModal');
  const gcName     = document.getElementById('globalConditionName');
  const gcEffect   = document.getElementById('globalConditionEffect');
  const gcTitle    = document.getElementById('globalConditionModalTitle');
  const gcDatalist = document.getElementById('globalConditionSuggestions');
  const gcClearBtn = document.getElementById('globalConditionClearBtn');

  const rerenderGlobalBar = () => {
    const bar = document.getElementById('combatGlobalBar');
    if (!bar) return;
    const w = state.weather || null;
    const t = state.terrain || null;
    bar.innerHTML = [
      w ? renderConditionBadge('weather', w) : '<button class="combat-global-btn" id="weatherBtn">🌦 Weather</button>',
      t ? renderConditionBadge('terrain', t) : '<button class="combat-global-btn" id="terrainBtn">🌿 Terrain</button>',
    ].join('');
    document.getElementById('weatherBtn')?.addEventListener('click', () => openGcModal('weather'));
    document.getElementById('terrainBtn')?.addEventListener('click', () => openGcModal('terrain'));
    bar.querySelectorAll('.condition-clear-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        state[btn.dataset.type] = null;
        saveCombatState(state);
        rerenderGlobalBar();
      });
    });
  };

  const openGcModal = (type) => {
    _gcmType = type;
    const isWeather = type === 'weather';
    const current = isWeather ? state.weather : state.terrain;
    gcTitle.textContent = isWeather ? '🌦 Set Weather' : '🌿 Set Terrain';
    gcName.value   = current?.name   || '';
    gcEffect.value = current?.effect || '';
    gcDatalist.innerHTML = (isWeather ? WEATHER_SUGGESTIONS : TERRAIN_SUGGESTIONS)
      .map(s => `<option value="${s}">`).join('');
    gcClearBtn.style.display = current ? 'inline-block' : 'none';
    gcModal.style.display = 'flex';
    setTimeout(() => gcName.focus(), 50);
  };

  const closeGcModal = () => {
    gcModal.style.display = 'none';
    _gcmType = null;
  };

  document.getElementById('globalConditionCancel')?.addEventListener('click', closeGcModal);
  gcModal?.addEventListener('click', (e) => { if (e.target === gcModal) closeGcModal(); });

  document.getElementById('globalConditionSetBtn')?.addEventListener('click', () => {
    const name = gcName.value.trim();
    if (!name || !_gcmType) return;
    state[_gcmType] = { name, effect: gcEffect.value.trim() };
    saveCombatState(state);
    rerenderGlobalBar();
    closeGcModal();
  });

  gcClearBtn?.addEventListener('click', () => {
    if (!_gcmType) return;
    state[_gcmType] = null;
    saveCombatState(state);
    rerenderGlobalBar();
    closeGcModal();
  });

  // Wire up buttons/badges on initial load
  rerenderGlobalBar();
  // ──────────────────────────────────────────────────────────────────────────

  const battleList = document.getElementById('battleList');
  if (battleList) {
    battleList.addEventListener('click', e => {
      if (e.target.closest('.end-turn-btn')) {
        const combatantId = e.target.closest('.end-turn-btn').dataset.combatantId;
        const combatant = state.combatants.find(x => x.id === combatantId);
        const ingrainIdx = combatant
          ? combatant.statusEffects.findIndex(se => se.name === 'Ingrain' && se.duration > 0)
          : -1;
        if (ingrainIdx >= 0 && combatant.currentHp > 0) {
          showIngrainHealPopup(combatant, combatant.statusEffects[ingrainIdx], state, () => {
            combatant.statusEffects[ingrainIdx].duration--;
            if (combatant.statusEffects[ingrainIdx].duration <= 0) {
              combatant.statusEffects.splice(ingrainIdx, 1);
            }
            endTurnForCombatant(combatantId, state);
          });
        } else {
          endTurnForCombatant(combatantId, state);
        }
        return;
      }
      if (e.target.closest('.hpvp-btn')) {
        handleHpVpDelta(e.target.closest('.hpvp-btn'), state); return;
      }
      if (e.target.closest('.stat-delta-btn')) {
        handleStatDelta(e.target.closest('.stat-delta-btn'), state); return;
      }
      if (e.target.closest('.combat-custom-status-btn')) {
        const btn = e.target.closest('.combat-custom-status-btn');
        const form = document.getElementById(`customStatusForm_${btn.dataset.combatantId}`);
        if (form) form.style.display = form.style.display === 'none' ? 'flex' : 'none';
        return;
      }
      if (e.target.closest('[data-action="addCustomStatus"]')) {
        const btn = e.target.closest('[data-action="addCustomStatus"]');
        const form = document.getElementById(`customStatusForm_${btn.dataset.combatantId}`);
        const name = form?.querySelector('.custom-status-name-input')?.value.trim();
        if (!name) { showToast('Enter a condition name.', 'warning'); return; }
        const desc = form?.querySelector('.custom-status-effect-input')?.value.trim() || '';
        addStatusEffect(btn.dataset.combatantId, name, state, desc); return;
      }
      if (e.target.closest('[data-action="cancelCustomStatus"]')) {
        const btn = e.target.closest('[data-action="cancelCustomStatus"]');
        const form = document.getElementById(`customStatusForm_${btn.dataset.combatantId}`);
        if (form) form.style.display = 'none'; return;
      }
      if (e.target.closest('.add-status-btn')) {
        const btn = e.target.closest('.add-status-btn');
        addStatusEffect(btn.dataset.combatantId, btn.dataset.effect, state); return;
      }
      if (e.target.closest('.status-badge')) {
        const badge = e.target.closest('.status-badge');
        if (badge.dataset.serverStatusId) return; // shared status -- combat-wip.js's own handler opens its detail popup
        removeStatusEffect(badge.dataset.combatantId, badge.dataset.effect, state); return;
      }
      if (e.target.closest('.combat-trainer-hpvp-btn')) {
        const btn = e.target.closest('.combat-trainer-hpvp-btn');
        const c = state.combatants.find(x => x.id === btn.dataset.combatantId);
        if (c) showTrainerHpVpPopup(c, state);
        return;
      }
      if (e.target.closest('.combat-type-calc-btn')) {
        const btn = e.target.closest('.combat-type-calc-btn');
        showTypeCalcPopup(btn.dataset.combatantId, state); return;
      }
      if (e.target.closest('.combat-inv-open-btn')) {
        showCombatInventoryPopup(); return;
      }
      if (e.target.closest('.combat-buffs-open-btn')) {
        showCombatBuffsPopup(); return;
      }
      if (e.target.closest('.combat-switch-open-btn')) {
        showSwitchPopup(state); return;
      }
      const moveItem = e.target.closest('.combat-move-item');
      if (moveItem && !moveItem.disabled) {
        if (moveItem.dataset.isDiceLocked === 'true') {
          showDiceRechargePopup(moveItem.dataset.move, moveItem.dataset.combatantId, moveItem.dataset.rechargeRange, state); return;
        }
        showCombatMoveDetails(moveItem.dataset.move, moveItem.dataset.combatantId, state, { onDamageResolved, onSaveTriggered, onReactiveSave, onMultiHitAoe, onEffectsOnly }); return;
      }
      // Toggle expand on card click (not on controls)
      const card = e.target.closest('.combat-card');
      if (card && !e.target.closest('.combat-card-footer') && !e.target.closest('.combat-card-expanded')) {
        const c = state.combatants.find(x => x.id === card.dataset.combatantId);
        if (c) { c.isExpanded = !c.isExpanded; saveCombatState(state); rerenderBattle(state); }
      }
    });

    // Direct number input for HP/VP
    battleList.addEventListener('change', e => {
      const hpvp = e.target.closest('.hpvp-input');
      if (hpvp) {
        const c = state.combatants.find(x => x.id === hpvp.dataset.combatantId);
        if (!c) return;
        const val = Math.max(0, parseInt(hpvp.value) || 0);
        if (hpvp.dataset.stat === 'hp') c.currentHp = Math.min(val, c.maxHp);
        if (hpvp.dataset.stat === 'vp') c.currentVp = Math.min(val, c.maxVp);
        if (hpvp.dataset.stat === 'ac') c.ac = val;
        if (hpvp.dataset.stat === 'crit') c.critMod = Math.max(-5, Math.min(5, val));
        saveCombatState(state); rerenderBattle(state); return;
      }
      // Direct number input for stats
      const statInput = e.target.closest('.stat-adjust-val');
      if (statInput) {
        updateCombatantStat(statInput.dataset.combatantId, statInput.dataset.stat, 0, state, parseInt(statInput.value) || 0);
      }
    });
  }

  // Inventory popup close
  document.getElementById('closeCombatInventoryPopup')?.addEventListener('click', () => {
    document.getElementById('combatInventoryPopup').style.display = 'none';
  });
  document.getElementById('combatInventoryPopup')?.addEventListener('click', e => {
    if (e.target.id === 'combatInventoryPopup') e.target.style.display = 'none';
  });

  // Buffs popup close
  document.getElementById('closeCombatBuffsPopup')?.addEventListener('click', () => {
    document.getElementById('combatBuffsPopup').style.display = 'none';
  });
  document.getElementById('combatBuffsPopup')?.addEventListener('click', e => {
    if (e.target.id === 'combatBuffsPopup') e.target.style.display = 'none';
  });
  document.getElementById('closeTypeCalcPopup')?.addEventListener('click', () => {
    document.getElementById('combatTypeCalcPopup').style.display = 'none';
  });
  document.getElementById('combatTypeCalcPopup')?.addEventListener('click', e => {
    if (e.target.id === 'combatTypeCalcPopup') e.target.style.display = 'none';
  });

  // Switch popup close
  document.getElementById('closeCombatSwitchPopup')?.addEventListener('click', () => {
    document.getElementById('combatSwitchPopup').style.display = 'none';
  });
  document.getElementById('combatSwitchPopup')?.addEventListener('click', e => {
    if (e.target.id === 'combatSwitchPopup') e.target.style.display = 'none';
  });

  // Switch initiative popup close
  document.getElementById('closeCombatSwitchInitPopup')?.addEventListener('click', () => {
    document.getElementById('combatSwitchInitPopup').style.display = 'none';
    _switchTargetPokemon = null;
  });
  document.getElementById('combatSwitchInitPopup')?.addEventListener('click', e => {
    if (e.target.id === 'combatSwitchInitPopup') { e.target.style.display = 'none'; _switchTargetPokemon = null; }
  });

  // Switch initiative input — live total update
  document.getElementById('switchInitInput')?.addEventListener('input', () => {
    if (!_switchTargetPokemon) return;
    const roll = parseInt(document.getElementById('switchInitInput').value) || 0;
    const totalEl = document.getElementById('switchInitTotal');
    if (totalEl) totalEl.textContent = _switchTargetPokemon.initiativeScore + roll;
    const confirmBtn = document.getElementById('confirmSwitchBtn');
    if (confirmBtn) confirmBtn.disabled = !document.getElementById('switchInitInput').value.trim();
  });

  // Confirm switch after initiative roll
  document.getElementById('confirmSwitchBtn')?.addEventListener('click', () => {
    if (!_switchTargetPokemon || !_battleState) return;
    const roll = parseInt(document.getElementById('switchInitInput')?.value) || 0;
    _switchTargetPokemon.initiativeBonus = roll;
    _switchTargetPokemon.initiativeTotal = _switchTargetPokemon.initiativeScore + roll;
    executePokemonSwitch(_switchTargetPokemon, _battleState);
    _switchTargetPokemon = null;
  });

  // Note: move popup close/confirm listeners are handled by the shared showMovePopup utility.

  applyMoveColors();
}

export function rerenderBattle(state) {
  const battleList = document.getElementById('battleList');
  if (!battleList) return;
  battleList.innerHTML = state.combatants.map((c, idx) => renderCombatCard(c, idx === state.activeTurnIndex, _battleCardOptions)).join('');
  applyMoveColors();
}

function showDiceRechargePopup(moveName, combatantId, range, state) {
  const popup = document.getElementById('diceRechargePopup');
  if (!popup) return;
  document.getElementById('diceRechargeMoveName').textContent = moveName;
  document.getElementById('diceRechargeCriteria').textContent = `Recharges on ${range} (roll a d6)`;
  popup.style.display = 'flex';

  const yesBtn = document.getElementById('diceRechargeYes');
  const noBtn = document.getElementById('diceRechargeNo');

  const close = () => { popup.style.display = 'none'; };

  yesBtn.onclick = () => {
    const c = state.combatants.find(x => x.id === combatantId);
    if (c && c.rechargeStates && c.rechargeStates[moveName]) {
      c.rechargeStates[moveName].chargesLeft = 1;
      saveCombatState(state);
      rerenderBattle(state);
      showToast(`${moveName} recharged!`, 'success');
    }
    close();
  };
  noBtn.onclick = close;
}

// ============================================================================
// SWITCH POKEMON
// ============================================================================

function showSwitchPopup(state) {
  const bench = state.bench || [];
  const popup = document.getElementById('combatSwitchPopup');
  const body = document.getElementById('combatSwitchPopupBody');
  if (!popup || !body) return;

  if (bench.length === 0) {
    body.innerHTML = '<p class="switch-no-bench">No other Pokémon available to switch in.</p>';
    popup.style.display = 'flex';
    return;
  }

  body.innerHTML = bench.map(p => {
    const hpPct = p.maxHp > 0 ? Math.round((p.currentHp / p.maxHp) * 100) : 0;
    const typeBadges = p.types.map(t => `<span class="type-badge type-${t.toLowerCase()}">${t}</span>`).join('');
    const fainted = p.currentHp <= 0;
    const initLabel = p.hasRolledInitiative
      ? `<span class="switch-init-label">Init: ${p.initiativeTotal}</span>`
      : `<span class="switch-init-label switch-init-new">Roll Init</span>`;
    return `
      <div class="switch-pokemon-card ${fainted ? 'fainted-bench' : ''}" data-pokemon-id="${p.id}">
        ${spriteMediaHtml(p.image, p.name, 'switch-poke-img')}
        <div class="switch-poke-info">
          <div class="switch-poke-name">${p.name} <span class="combat-card-level">Lv ${p.level}</span> ${typeBadges}</div>
          <div class="switch-poke-stats">
            HP: <strong>${p.currentHp}/${p.maxHp}</strong>
            <div class="mini-bar" style="display:inline-block;vertical-align:middle;margin:0 0.3rem;"><div class="mini-bar-fill hp-bar" style="width:${hpPct}%"></div></div>
            ${initLabel}
          </div>
        </div>
      </div>`;
  }).join('');

  // Attach click listeners to switchable cards
  body.querySelectorAll('.switch-pokemon-card:not(.fainted-bench)').forEach(card => {
    card.addEventListener('click', () => {
      const pokemon = bench.find(p => p.id === card.dataset.pokemonId);
      if (!pokemon) return;
      if (pokemon.hasRolledInitiative) {
        // Already has a saved initiative — switch immediately
        executePokemonSwitch(pokemon, state);
      } else {
        // First time in battle — need to roll initiative
        popup.style.display = 'none';
        showSwitchInitiativePopup(pokemon);
      }
    });
  });

  popup.style.display = 'flex';
}

function showSwitchInitiativePopup(benchPokemon) {
  _switchTargetPokemon = benchPokemon;
  const titleEl = document.getElementById('switchInitTitle');
  const descEl  = document.getElementById('switchInitDesc');
  const input   = document.getElementById('switchInitInput');
  const totalEl = document.getElementById('switchInitTotal');
  const confirmBtn = document.getElementById('confirmSwitchBtn');

  if (titleEl) titleEl.textContent = `${benchPokemon.name}'s Initiative`;
  if (descEl)  descEl.textContent  = `Initiative Score: ${benchPokemon.initiativeScore}. Enter your d20 roll:`;
  if (input)   { input.value = ''; }
  if (totalEl) totalEl.textContent = benchPokemon.initiativeScore;
  if (confirmBtn) confirmBtn.disabled = true;

  document.getElementById('combatSwitchInitPopup').style.display = 'flex';
}

function executePokemonSwitch(benchPokemon, state) {
  // Find the currently active pokemon (first non-trainer)
  const activePokIdx = state.combatants.findIndex(c => c.type === 'pokemon');
  if (activePokIdx === -1) return;

  const activePokemon = state.combatants[activePokIdx];
  // Remember who owns the current active turn so we can restore activeTurnIndex
  const activeTurnCombatant = state.combatants[state.activeTurnIndex];

  // Move active pokemon to bench
  activePokemon.hasRolledInitiative = true;
  state.bench = (state.bench || []).filter(b => b.id !== benchPokemon.id);
  state.bench.push(activePokemon);

  // Bring bench pokemon into active combatants
  benchPokemon.hasRolledInitiative = true;
  state.combatants.splice(activePokIdx, 1);
  state.combatants.push(benchPokemon);

  // Re-sort by initiative total
  state.combatants.sort((a, b) => b.initiativeTotal - a.initiativeTotal);

  // Restore activeTurnIndex to point to the same combatant that had the turn
  const newIdx = state.combatants.findIndex(c => c.id === activeTurnCombatant.id);
  state.activeTurnIndex = newIdx !== -1 ? newIdx : 0;

  saveCombatState(state);
  rerenderBattle(state);
  showToast(`${activePokemon.name} withdrawn — ${benchPokemon.name} switched in!`, 'success');

  document.getElementById('combatSwitchPopup').style.display = 'none';
  document.getElementById('combatSwitchInitPopup').style.display = 'none';
}

function applyMoveColors() {
  if (!_moveMap) return;
  document.querySelectorAll('.combat-move-item:not(.move-locked)').forEach(item => {
    const move = _moveMap.get(item.dataset.move);
    if (move) {
      const bg = getMoveTypeColor(move[1]);
      item.style.backgroundColor = bg;
      item.style.color = getTextColorForBackground(bg);
    }
  });
}

function handleHpVpDelta(btn, state) {
  const c = state.combatants.find(x => x.id === btn.dataset.combatantId);
  if (!c) return;
  const delta = parseInt(btn.dataset.delta);
  // HP has no floor (negative HP is how this game reads injury severity/
  // death saves -- see project notes); only capped against maxHp on the
  // heal side, via Math.min below. VP below is intentionally different --
  // it does floor at 0.
  if (btn.dataset.stat === 'hp') c.currentHp = Math.min(c.currentHp + delta, c.maxHp);
  if (btn.dataset.stat === 'vp') c.currentVp = Math.max(0, Math.min(c.currentVp + delta, c.maxVp));
  if (btn.dataset.stat === 'ac') c.ac = Math.max(0, c.ac + delta);
  if (btn.dataset.stat === 'crit') c.critMod = Math.max(-5, Math.min(5, (c.critMod || 0) + delta));
  saveCombatState(state);
  rerenderBattle(state);
}

function handleStatDelta(btn, state) {
  updateCombatantStat(btn.dataset.combatantId, btn.dataset.stat, parseInt(btn.dataset.delta), state, null);
}

function updateCombatantStat(id, stat, delta, state, absValue) {
  const c = state.combatants.find(x => x.id === id);
  if (!c) return;
  const modMap = { str: 'strMod', dex: 'dexMod', con: 'conMod', int: 'intMod', wis: 'wisMod', cha: 'chaMod' };
  if (stat === 'ac') {
    c.ac = Math.max(0, absValue !== null ? absValue : c.ac + delta);
  } else if (modMap[stat]) {
    const newVal = Math.max(1, absValue !== null ? absValue : c[stat] + delta);
    c[stat] = newVal;
    c[modMap[stat]] = Math.floor((newVal - 10) / 2);
  }
  saveCombatState(state);
  rerenderBattle(state);
}

// ============================================================================
// BATTLE LOGIC
// ============================================================================

function getStatMod(combatant, statName) {
  switch ((statName || '').toUpperCase()) {
    case 'STR': return combatant.strMod || 0;
    case 'DEX': return combatant.dexMod || 0;
    case 'CON': return combatant.conMod || 0;
    case 'INT': return combatant.intMod || 0;
    case 'WIS': return combatant.wisMod || 0;
    case 'CHA': return combatant.chaMod || 0;
    default: return 0;
  }
}

function getHealDiceForLevel(move, level) {
  const desc = move[7] || '';
  const higherLevels = move[8] || '';
  const baseMatch = desc.match(/regain\s+a\s+base\s+(\d+d\d+)/i);
  let dice = baseMatch ? baseMatch[1] : '1d6';
  if (higherLevels && level > 1) {
    const tierRegex = /(\d+d\d+)\s+at\s+level\s+(\d+)/gi;
    let match, bestDice = null, bestLevel = 0;
    while ((match = tierRegex.exec(higherLevels)) !== null) {
      const tierLevel = parseInt(match[2]);
      if (level >= tierLevel && tierLevel > bestLevel) { bestLevel = tierLevel; bestDice = match[1]; }
    }
    if (bestDice) dice = bestDice;
  }
  return dice;
}

/** "2d8" × 3 -> "6d8" -- the shown-dice-count half of a `damage_note` effect
 * (see move-effects-schema.md and showCombatMoveDetails's own use of this).
 * Multiplying the leading number is the same arithmetic as rolling the dice
 * that many more times (same die size), which is what "double/triple the
 * dice" in this dataset's own move text consistently means. Any shape that
 * doesn't parse (there shouldn't be one -- computeMoveData's own damageDice
 * is always plain XdY) is returned unchanged rather than guessed at. */
function _multiplyDiceString(dice, multiplier) {
  const m = /^(\d+)(d\d+)$/i.exec(dice || '');
  if (!m) return dice;
  return `${parseInt(m[1], 10) * multiplier}${m[2]}`;
}

/** Evaluates `damage_note` effects (already filtered to that kind) against
 * `c`'s own current HP/status -- see showCombatMoveDetails's own call site
 * for the full reasoning. Multiple dice-multiplier tiers (Flail's 2x at
 * <50% HP, 3x at <=10%) resolve to whichever's condition is met with the
 * HIGHEST multiplier, not stacked -- being at 10% HP already implies being
 * below 50%, so both conditions are "met" at once and only the more severe
 * one should show. Status names are checked against the same legacy display
 * names (`Poison`, `Paralysis`, `Burn`, ...) both engines' own status badges
 * already use (see combat-wip.js's LEGACY_BADGE_NAMES), so this works
 * identically whether `c` came from the old local engine or the shared one. */
function _evaluateDamageNotes(effects, c) {
  const hpFrac = (c.maxHp || 0) > 0 ? (c.currentHp || 0) / c.maxHp : null;
  const statusNames = new Set((c.statusEffects || []).map(se => se.name));
  const conditionMet = (cond) => {
    if (!cond) return false;
    if (cond.type === 'self_hp_below') return hpFrac !== null && hpFrac < cond.fraction;
    if (cond.type === 'self_hp_at_or_below') return hpFrac !== null && hpFrac <= cond.fraction;
    if (cond.type === 'self_status') return (cond.any || []).some(name => statusNames.has(name));
    return false;
  };
  let diceMultiplier = 1, diceNote = '', totalNote = '';
  for (const e of effects) {
    if (!conditionMet(e.condition)) continue;
    if (e.diceMultiplier && e.diceMultiplier > diceMultiplier) { diceMultiplier = e.diceMultiplier; diceNote = e.note || ''; }
    if (e.totalMultiplier) totalNote = e.note || `×${e.totalMultiplier} total damage`;
  }
  return { diceMultiplier, diceNote, totalNote };
}

function showIngrainHealPopup(combatant, ingrainEffect, state, onConfirm) {
  const modBonus = getStatMod(combatant, ingrainEffect.moveMod);
  const popup      = document.getElementById('ingrainHealPopup');
  const modRow     = document.getElementById('ingrainModRow');
  const turnsLeftEl = document.getElementById('ingrainTurnsLeft');

  document.getElementById('ingrainDiceLabel').textContent = `Roll ${ingrainEffect.healDice}:`;
  document.getElementById('ingrainHealTarget').textContent =
    `${combatant.name} — ${combatant.currentHp}/${combatant.maxHp} HP`;
  turnsLeftEl.textContent = ingrainEffect.duration - 1;

  if (ingrainEffect.moveMod && modBonus !== 0) {
    modRow.style.display = 'block';
    modRow.textContent = `${ingrainEffect.moveMod} modifier bonus: ${modBonus >= 0 ? '+' : ''}${modBonus}`;
  } else {
    modRow.style.display = 'none';
  }

  // Clone to remove any old listeners
  const oldInput = document.getElementById('ingrainDiceInput');
  const newInput = oldInput.cloneNode(true);
  newInput.value = '';
  oldInput.parentNode.replaceChild(newInput, oldInput);

  const oldBtn = document.getElementById('ingrainHealConfirm');
  const newBtn = oldBtn.cloneNode(true);
  newBtn.disabled = true;
  oldBtn.parentNode.replaceChild(newBtn, oldBtn);

  document.getElementById('ingrainTotal').textContent = '—';

  document.getElementById('ingrainDiceInput').addEventListener('input', function () {
    const val = parseInt(this.value);
    const totalEl = document.getElementById('ingrainTotal');
    const confirmBtn = document.getElementById('ingrainHealConfirm');
    if (val > 0) {
      const total = val + modBonus;
      totalEl.textContent = `${total} HP`;
      confirmBtn.disabled = false;
    } else {
      totalEl.textContent = '—';
      confirmBtn.disabled = true;
    }
  });

  document.getElementById('ingrainHealConfirm').addEventListener('click', function () {
    const diceVal = parseInt(document.getElementById('ingrainDiceInput').value);
    if (!diceVal || diceVal < 1) return;
    const total = diceVal + modBonus;
    combatant.currentHp = Math.min(combatant.currentHp + total, combatant.maxHp);
    showToast(`${combatant.name}: Ingrain healed ${total} HP!`, 'success');
    logBattleEvent({ type: 'heal', actorId: combatant.id, actorName: combatant.name, text: `${combatant.name} healed ${total} HP from Ingrain` });

    // Sync HP to sessionStorage and API
    const pd = JSON.parse(sessionStorage.getItem(combatant.entityKey) || 'null');
    if (pd) {
      pd[45] = combatant.currentHp;
      sessionStorage.setItem(combatant.entityKey, JSON.stringify(pd));
      const td = JSON.parse(sessionStorage.getItem('trainerData') || '[]');
      PokemonAPI.updateLiveStats(td[1], pd[2], 'HP', combatant.currentHp)
        .catch(e => console.error('Ingrain HP sync:', e));
    }

    popup.style.display = 'none';
    onConfirm();
  });

  popup.style.display = 'flex';
}

function showDrainHealPopup(combatant, moveName, state) {
  const popup = document.getElementById('drainHealPopup');
  document.getElementById('drainHealTitle').textContent = `🌿 ${moveName} — Drain Heal`;
  document.getElementById('drainHealTarget').textContent =
    `${combatant.name} — ${combatant.currentHp}/${combatant.maxHp} HP`;
  document.getElementById('drainHealTotal').textContent = '—';

  // Clone elements to remove stale listeners
  const oldInput = document.getElementById('drainDamageInput');
  const newInput = oldInput.cloneNode(true);
  newInput.value = '';
  oldInput.parentNode.replaceChild(newInput, oldInput);

  const oldBtn = document.getElementById('drainHealConfirm');
  const newBtn = oldBtn.cloneNode(true);
  newBtn.disabled = true;
  oldBtn.parentNode.replaceChild(newBtn, oldBtn);

  const oldSkip = document.getElementById('drainHealSkip');
  const newSkip = oldSkip.cloneNode(true);
  oldSkip.parentNode.replaceChild(newSkip, oldSkip);

  document.getElementById('drainDamageInput').addEventListener('input', function () {
    const dmg = parseInt(this.value);
    const totalEl = document.getElementById('drainHealTotal');
    const confirmBtn = document.getElementById('drainHealConfirm');
    if (!isNaN(dmg) && dmg >= 0) {
      const heal = Math.floor(dmg / 2);
      totalEl.textContent = `${heal} HP`;
      confirmBtn.disabled = heal <= 0;
    } else {
      totalEl.textContent = '—';
      confirmBtn.disabled = true;
    }
  });

  document.getElementById('drainHealConfirm').addEventListener('click', function () {
    const dmg = parseInt(document.getElementById('drainDamageInput').value);
    if (isNaN(dmg) || dmg < 0) return;
    const heal = Math.floor(dmg / 2);
    if (heal <= 0) return;

    combatant.currentHp = Math.min(combatant.currentHp + heal, combatant.maxHp);
    showToast(`${combatant.name}: ${moveName} drained ${heal} HP!`, 'success');
    logBattleEvent({ type: 'heal', actorId: combatant.id, actorName: combatant.name, text: `${combatant.name} drained ${heal} HP from ${moveName}` });

    // Sync to sessionStorage and API
    const pd = JSON.parse(sessionStorage.getItem(combatant.entityKey) || 'null');
    if (pd) {
      pd[45] = combatant.currentHp;
      sessionStorage.setItem(combatant.entityKey, JSON.stringify(pd));
      const td = JSON.parse(sessionStorage.getItem('trainerData') || '[]');
      PokemonAPI.updateLiveStats(td[1], pd[2], 'HP', combatant.currentHp)
        .catch(e => console.error('Drain HP sync:', e));
    }

    saveCombatState(state);
    rerenderBattle(state);
    popup.style.display = 'none';
  });

  document.getElementById('drainHealSkip').addEventListener('click', function () {
    popup.style.display = 'none';
  });

  popup.style.display = 'flex';
}

function showDirectHealPopup(combatant, moveName, healDice, moveMod, stacks, state) {
  const modBonus = getStatMod(combatant, moveMod);
  const popup = document.getElementById('directHealPopup');
  const modRow = document.getElementById('directHealModRow');

  const stackLabel = stacks > 1 ? ` ×${stacks} (Stockpile)` : '';
  document.getElementById('directHealTitle').textContent = `💊 ${moveName}`;
  document.getElementById('directHealTarget').textContent =
    `${combatant.name} — ${combatant.currentHp}/${combatant.maxHp} HP`;
  document.getElementById('directHealDiceLabel').textContent = `Roll ${healDice}${stackLabel}:`;
  document.getElementById('directHealTotal').textContent = '—';

  if (moveMod && modBonus !== 0) {
    modRow.style.display = 'block';
    modRow.textContent = `${moveMod} modifier bonus: ${modBonus >= 0 ? '+' : ''}${modBonus}`;
  } else {
    modRow.style.display = 'none';
  }

  const oldInput = document.getElementById('directHealDiceInput');
  const newInput = oldInput.cloneNode(true);
  newInput.value = '';
  oldInput.parentNode.replaceChild(newInput, oldInput);

  const oldBtn = document.getElementById('directHealConfirm');
  const newBtn = oldBtn.cloneNode(true);
  newBtn.disabled = true;
  oldBtn.parentNode.replaceChild(newBtn, oldBtn);

  const oldSkip = document.getElementById('directHealSkip');
  const newSkip = oldSkip.cloneNode(true);
  oldSkip.parentNode.replaceChild(newSkip, oldSkip);

  document.getElementById('directHealDiceInput').addEventListener('input', function () {
    const val = parseInt(this.value);
    const totalEl = document.getElementById('directHealTotal');
    const confirmBtn = document.getElementById('directHealConfirm');
    if (val > 0) {
      const total = (val * stacks) + modBonus;
      totalEl.textContent = `${total} HP`;
      confirmBtn.disabled = false;
    } else {
      totalEl.textContent = '—';
      confirmBtn.disabled = true;
    }
  });

  document.getElementById('directHealConfirm').addEventListener('click', function () {
    const diceVal = parseInt(document.getElementById('directHealDiceInput').value);
    if (!diceVal || diceVal < 1) return;
    const total = (diceVal * stacks) + modBonus;
    combatant.currentHp = Math.min(combatant.currentHp + total, combatant.maxHp);
    showToast(`${combatant.name}: ${moveName} restored ${total} HP!`, 'success');
    logBattleEvent({ type: 'heal', actorId: combatant.id, actorName: combatant.name, text: `${combatant.name} restored ${total} HP from ${moveName}` });

    const pd = JSON.parse(sessionStorage.getItem(combatant.entityKey) || 'null');
    if (pd) {
      pd[45] = combatant.currentHp;
      sessionStorage.setItem(combatant.entityKey, JSON.stringify(pd));
      const td = JSON.parse(sessionStorage.getItem('trainerData') || '[]');
      PokemonAPI.updateLiveStats(td[1], pd[2], 'HP', combatant.currentHp)
        .catch(e => console.error('Direct heal HP sync:', e));
    }

    saveCombatState(state);
    rerenderBattle(state);
    popup.style.display = 'none';
  });

  document.getElementById('directHealSkip').addEventListener('click', function () {
    popup.style.display = 'none';
  });

  popup.style.display = 'flex';
}

function showSpitUpPopup(combatant, stacks) {
  const popup = document.getElementById('spitUpPopup');
  document.getElementById('spitUpTarget').textContent = combatant.name;
  document.getElementById('spitUpMultiplier').textContent = stacks > 0 ? `×${stacks}` : '0 Stockpile stacks';

  const oldBtn = document.getElementById('spitUpDismiss');
  const newBtn = oldBtn.cloneNode(true);
  oldBtn.parentNode.replaceChild(newBtn, oldBtn);
  document.getElementById('spitUpDismiss').addEventListener('click', () => {
    popup.style.display = 'none';
  });

  popup.style.display = 'flex';
}

function showTrainerHpVpPopup(combatant, state) {
  const popup = document.getElementById('trainerHpVpPopup');

  const refreshStatus = () => {
    document.getElementById('trainerHpVpTitle').textContent = `${combatant.name} — HP / VP`;
    document.getElementById('trainerHpVpStatus').textContent =
      `HP: ${combatant.currentHp} / ${combatant.maxHp}   ·   VP: ${combatant.currentVp} / ${combatant.maxVp}`;
  };
  refreshStatus();

  const hpInput = document.getElementById('trainerHpVpHpInput');
  const vpInput = document.getElementById('trainerHpVpVpInput');
  hpInput.value = '';
  vpInput.value = '';

  const syncTrainer = () => {
    const td = JSON.parse(sessionStorage.getItem('trainerData') || '[]');
    td[34] = combatant.currentHp;
    td[35] = combatant.currentVp;
    sessionStorage.setItem('trainerData', JSON.stringify(td));
    TrainerAPI.update(td).catch(e => console.error('Trainer HP/VP sync:', e));
  };

  const oldAdd = document.getElementById('trainerHpVpAddBtn');
  const newAdd = oldAdd.cloneNode(true);
  oldAdd.parentNode.replaceChild(newAdd, oldAdd);

  const oldRemove = document.getElementById('trainerHpVpRemoveBtn');
  const newRemove = oldRemove.cloneNode(true);
  oldRemove.parentNode.replaceChild(newRemove, oldRemove);

  const oldClose = document.getElementById('trainerHpVpCloseBtn');
  const newClose = oldClose.cloneNode(true);
  oldClose.parentNode.replaceChild(newClose, oldClose);

  document.getElementById('trainerHpVpAddBtn').addEventListener('click', () => {
    const hp = parseInt(hpInput.value) || 0;
    const vp = parseInt(vpInput.value) || 0;
    if (hp > 0) combatant.currentHp = Math.min(combatant.currentHp + hp, combatant.maxHp);
    if (vp > 0) combatant.currentVp = Math.min(combatant.currentVp + vp, combatant.maxVp);
    saveCombatState(state);
    rerenderBattle(state);
    syncTrainer();
    refreshStatus();
    hpInput.value = ''; vpInput.value = '';
  });

  document.getElementById('trainerHpVpRemoveBtn').addEventListener('click', () => {
    const hp = parseInt(hpInput.value) || 0;
    const vp = parseInt(vpInput.value) || 0;
    if (hp > 0) combatant.currentHp = combatant.currentHp - hp; // no floor -- see handleHpVpDelta
    if (vp > 0) combatant.currentVp = Math.max(0, combatant.currentVp - vp);
    saveCombatState(state);
    rerenderBattle(state);
    syncTrainer();
    refreshStatus();
    hpInput.value = ''; vpInput.value = '';
  });

  document.getElementById('trainerHpVpCloseBtn').addEventListener('click', () => {
    popup.style.display = 'none';
  });

  popup.style.display = 'flex';
}

// The six conditions this page has always handled itself (end-of-turn damage / reminders,
// their own badge colors). Shared statuses for the matching conditions borrow these names.
const LEGACY_STATUS_NAMES = ['Poison', 'Burn', 'Confusion', 'Paralysis', 'Sleep', 'Freeze'];

function endTurnForCombatant(combatantId, state) {
  const c = state.combatants.find(x => x.id === combatantId);
  if (!c) return;

  const remaining = [];
  for (const se of c.statusEffects) {
    if (se.name === 'Ingrain') {
      // Duration managed by the end-turn intercept; preserve as-is (already decremented or removed there)
      remaining.push(se);
      continue;
    }
    if (se.serverStatusId && !LEGACY_STATUS_NAMES.includes(se.name)) {
      // Shared-combat effects (AC -1, Restrained, ...) are shown as badges and expired by the
      // server; a reminder toast on every end of turn would just be noise.
      remaining.push(se);
      continue;
    }
    if (se.name === 'Poison' || se.name === 'Burn') {
      const dmg = c.proficiency;
      c.currentHp = c.currentHp - dmg; // no floor -- see handleHpVpDelta
      showToast(`${c.name}: ${se.name}! −${dmg} HP`, 'warning');
    } else if (se.name === 'Confusion') {
      showToast(`${c.name}: Confused! Roll a confusion check.`, 'info');
    } else if (se.name === 'Paralysis') {
      showToast(`${c.name}: Paralyzed! May be unable to move.`, 'warning');
    } else if (se.name === 'Sleep') {
      showToast(`${c.name}: Asleep! Roll to wake up.`, 'info');
    } else if (se.name === 'Freeze') {
      showToast(`${c.name}: Frozen! Roll to thaw.`, 'info');
    } else {
      // Custom condition — show name and effect (if any) as a reminder
      const reminder = se.description ? ` — ${se.description}` : '';
      showToast(`${c.name}: ${se.name}${reminder}`, 'info');
    }
    if (se.duration === -1) remaining.push(se);
    else if (se.duration - 1 > 0) remaining.push({ ...se, duration: se.duration - 1 });
  }
  c.statusEffects = remaining;
  _syncStatusConditionToDb(c, state);

  // Advance to next living combatant
  const total = state.combatants.length;
  const currentC = state.combatants[state.activeTurnIndex];
  let next = state.activeTurnIndex;
  let wrapped = false;
  for (let i = 1; i <= total; i++) {
    const candidate = (state.activeTurnIndex + i) % total;
    if (candidate < state.activeTurnIndex || candidate === 0) wrapped = true;
    if (state.combatants[candidate].currentHp > 0) { next = candidate; break; }
  }
  if (wrapped) {
    state.round++;
    const roundLabel = document.querySelector('.combat-round-label');
    if (roundLabel) roundLabel.textContent = `Round ${state.round}`;
  }
  state.activeTurnIndex = next;

  // Start-of-turn ability effects
  const nextC = state.combatants[next];
  if (nextC && nextC.type === 'pokemon' && hasAbility(nextC, 'Energy Intensive')) {
    const drain = nextC.proficiency || 2;
    nextC.currentVp = Math.max(0, nextC.currentVp - drain);
    showToast(`${nextC.name}: Energy Intensive — −${drain} VP at start of turn`, 'warning');
  }

  state.combatants.forEach((cc, idx) => { if (idx !== next) cc.isExpanded = false; });
  saveCombatState(state);
  rerenderBattle(state);
}

function _syncStatusConditionToDb(c, state) {
  if (c.type !== 'pokemon' || !c.entityKey) return;
  const pd = JSON.parse(sessionStorage.getItem(c.entityKey) || 'null');
  if (!pd) return;
  const trainerName = state.combatants.find(x => x.type === 'trainer')?.name || '';
  pd[60] = c.statusEffects.filter(s => !s.serverStatusId).map(s => s.name).join(',');
  sessionStorage.setItem(c.entityKey, JSON.stringify(pd));
  PokemonAPI.updateLiveStats(trainerName, pd[2], 'StatusCondition', pd[60]).catch(e => console.error('Status sync:', e));
}

function addStatusEffect(combatantId, effectName, state, description = '') {
  const c = state.combatants.find(x => x.id === combatantId);
  if (!c || c.statusEffects.find(s => s.name === effectName)) return;
  const entry = { name: effectName, duration: -1 };
  if (description) entry.description = description;
  c.statusEffects.push(entry);
  saveCombatState(state);
  rerenderBattle(state);
  _syncStatusConditionToDb(c, state);
  logBattleEvent({ type: 'status-applied', actorId: c.id, actorName: c.name, text: `${c.name} is now ${effectName}` });
}

function removeStatusEffect(combatantId, effectName, state) {
  const c = state.combatants.find(x => x.id === combatantId);
  if (!c) return;
  c.statusEffects = c.statusEffects.filter(s => s.name !== effectName);
  saveCombatState(state);
  rerenderBattle(state);
  _syncStatusConditionToDb(c, state);
  logBattleEvent({ type: 'status-removed', actorId: c.id, actorName: c.name, text: `${c.name} is no longer ${effectName}` });
}

// ============================================================================
// MOVE POPUP
// ============================================================================

function showCombatMoveDetails(moveName, combatantId, state, { onDamageResolved, onSaveTriggered, onReactiveSave, onMultiHitAoe, onEffectsOnly } = {}) {
  // Only combat-wip.js's shared-combat flow ever passes any of these (see
  // _attachMainFocusListeners) -- the legacy page's own attachCombatListeners()
  // calls attachBattleListeners(state) with none of them, so this stays false
  // there and that page's own confirm-popup step is unaffected.
  const _isSharedCombat = !!(onDamageResolved || onSaveTriggered || onReactiveSave || onMultiHitAoe || onEffectsOnly);
  if (!_moves) { showToast('Move data not loaded.', 'warning'); return; }
  const move = _moveMap.get(moveName);
  if (!move) { showToast(`Move "${moveName}" not found.`, 'warning'); return; }

  const c = state.combatants.find(x => x.id === combatantId);
  if (!c) return;

  const trainerData = JSON.parse(sessionStorage.getItem('trainerData') || '[]');
  const trainerPath = trainerData[25] || '';
  const trainerLevel = parseInt(trainerData[2]) || 1;
  const specializationsStr = trainerData[24] || '';

  const heldItemNames = (c.item || '').split(',').map(s => s.trim()).filter(Boolean);
  const cachedItems = getCachedItems();
  const heldItemEffects = heldItemNames.map(name => {
    const dbItem = cachedItems.find(i => i.name === name);
    return dbItem ? (dbItem.effect || dbItem.description || '') : '';
  });

  const computedData = computeMoveData(
    move,
    {
      types: c.types || [],
      strMod: c.strMod, dexMod: c.dexMod, conMod: c.conMod,
      intMod: c.intMod, wisMod: c.wisMod, chaMod: c.chaMod,
      proficiency: c.proficiency,
      stabBonusValue: c.stabBonusValue || 2,
      level: c.level,
      hasToughClaws: hasAbility(c, 'Tough Claws'),
    },
    { path: trainerPath, level: trainerLevel, specializationsStr },
    heldItemEffects
  );

  const heldItemsHTML = heldItemNames.length > 0
    ? '<strong>Held Items:</strong>' + heldItemNames.map(name => {
        const dbItem = cachedItems.find(i => i.name === name);
        return dbItem
          ? `<div style="margin-top:0.3rem;"><strong>${dbItem.name}:</strong> ${dbItem.effect || dbItem.description || 'No description'}</div>`
          : `<div style="margin-top:0.3rem;"><strong>${name}:</strong> No description available</div>`;
      }).join('')
    : '';

  const _rechargeInfo = c.rechargeStates?.[moveName];
  const chargesLeft = _rechargeInfo !== undefined ? _rechargeInfo.chargesLeft : undefined;

  const _moveLower = moveName.toLowerCase();
  const _stacks = c.stockpileStacks || 0;
  const _isStackMove = _moveLower === 'spit up' || _moveLower === 'swallow';
  const _stackNote = _isStackMove
    ? (_stacks === 0
        ? 'Stockpile: 0 stacks — use Stockpile first'
        : `Stockpile: ×${_stacks} stack${_stacks > 1 ? 's' : ''}`)
    : undefined;

  // Heal dice display for "regain a base X hit points" moves
  const _fullMoveDesc = (move[7] || '') + ' ' + (move[8] || '');
  const _isDirectHeal = /regain\s+a\s+base\s+.*?\s+hit\s+points/i.test(_fullMoveDesc);
  // Same drain-heal pattern move-popup.js's own post-use check already uses
  // -- reused here (rather than re-derived) so "is this move actually
  // offensive" agrees with what that popup itself already decided a heal
  // move is, instead of drifting from a second copy of the same regex.
  const _isDrainHeal = /the\s+damage\s+dealt\s+is\s+restored\s+to\s+the\s+user/i.test(_fullMoveDesc);
  let _diceLabel, _diceOverride, _diceBreakdownOverride;
  if (_isDirectHeal) {
    const _healDice = getHealDiceForLevel(move, c.level || 1);
    const _healMoveMod = (move[2] || '').trim();
    const _healModBonus = _healMoveMod ? getStatMod(c, _healMoveMod) : 0;
    const _healStacks = _moveLower === 'swallow' ? Math.max(_stacks, 1) : 1;
    const _diceStr = _healStacks > 1 ? `${_healDice} ×${_healStacks}` : _healDice;
    _diceOverride = _healModBonus !== 0
      ? `${_diceStr} ${_healModBonus >= 0 ? '+' : ''}${_healModBonus}`
      : _diceStr;
    _diceBreakdownOverride = _healMoveMod && _healModBonus !== 0
      ? `${_healMoveMod} modifier: ${_healModBonus >= 0 ? '+' : ''}${_healModBonus}`
      : '';
  }

  // `damage_note` effects (see move-effects-schema.md's own section) --
  // Facade/Flail/Water Spout-style "double the damage if you're poisoned/
  // below X% HP" reminders, evaluated here against the ATTACKER's own
  // already-known HP/status (knowable before a target is even picked, unlike
  // a target-conditional move's own equivalent, which isn't built yet -- see
  // that section for why). A `diceMultiplier` recomputes the shown dice
  // string the same diceOverride mechanism above already uses (never stacks
  // with the heal-dice override -- no move is both); a `totalMultiplier`
  // (Water Spout's "halve the TOTAL after rolling") shows as a plain note
  // instead of a recomputed dice string, since halving the dice COUNT isn't
  // the same thing (a flat MOVE modifier doesn't halve with it, and the
  // distributions differ) -- safer to say so in words than assert a number
  // that might be wrong.
  let _damageNote = '';
  if (!_isDirectHeal && computedData.damageDice) {
    const _dmgNoteEffects = moveEffectsFor(moveName).filter(e => e.kind === 'damage_note');
    if (_dmgNoteEffects.length) {
      const { diceMultiplier, diceNote, totalNote } = _evaluateDamageNotes(_dmgNoteEffects, c);
      if (diceMultiplier > 1) {
        const _adjustedDice = _multiplyDiceString(computedData.damageDice, diceMultiplier);
        _diceOverride = computedData.damageBonus > 0 ? `${_adjustedDice} + ${computedData.damageBonus}` : _adjustedDice;
        _diceBreakdownOverride = [computedData.damageBreakdown, `×${diceMultiplier} dice (${diceNote})`].filter(Boolean).join(' · ');
      }
      if (totalNote) _damageNote = totalNote;
    }
  }

  // Same "is this an offensive move that will hand off to onDamageResolved"
  // check the onUseMove callback below uses to decide whether to actually
  // call it -- reused here so the popup's own inline battle animation is
  // deferred (played later, once a target/attack-roll/hit is confirmed via
  // target-picker.js) for exactly the moves that will take that detour,
  // and plays immediately as before for anything else (self-heals, legacy
  // combat.js callers that never pass onDamageResolved at all).
  const _willDeferToTargetPicker = !!onDamageResolved && !!computedData.damageDice && !_isDrainHeal && !_isDirectHeal;
  // Save-triggered moves (the user's own manual categorization -- see
  // moveCategoriesFor's docstring) detour through save-picker.js instead:
  // no attack roll, no AC comparison -- the TARGET rolls a save against
  // this move's DC (already computed as computedData.moveDC). Takes
  // priority over the target-picker detour above when both would
  // otherwise apply -- a categorized move is either one or the other,
  // never both, by construction of the categorization data itself.
  const _isSaveTriggered = moveCategoriesFor(moveName).includes('trigger_saving_throw');
  const _willDeferToSavePicker = _isSaveTriggered && !!onSaveTriggered;
  // Reactive-save moves (Wing Buffer, etc.) are the mirror image of the
  // above: the move's OWN USER is the one who saves, against whoever
  // attacked them -- not a chosen target's own DC. See combat-wip.js's
  // _handleReactiveSave for the auto-detect-from-the-log logic this hands
  // off to.
  const _isReactiveSave = moveCategoriesFor(moveName).includes('reactive_save');
  const _willDeferToReactiveSave = _isReactiveSave && !!onReactiveSave;
  // multi_hit_aoe moves (Judgment, Meteor Swarm, etc.) take priority over
  // BOTH single-target detours above -- a move can be tagged multi_hit_aoe
  // AND TRIGGER SAVING THROW at once (Judgment is exactly this: one save
  // per creature in the blast), but the very first step differs -- who's
  // even affected has to be picked (multi-target-picker.js) before any
  // per-target save/attack-roll resolution can happen at all. See
  // combat-wip.js's _handleMultiHitAoe, which re-uses pickTargetAgain/
  // confirmSecondarySave per selected target once that's settled.
  const _isMultiHitAoe = moveCategoriesFor(moveName).includes('multi_hit_aoe');
  const _willDeferToMultiHitAoe = _isMultiHitAoe && !!onMultiHitAoe;

  showMovePopup({
    move,
    computedData,
    heldItemsHTML,
    size: c.size,
    critMod: c.critMod,
    trainerData,
    chargesLeft,
    spriteUrl: c.image,
    spriteAlt: c.name,
    speciesName: c.speciesName,
    noteText: _stackNote || _damageNote || undefined,
    disableUse: _isStackMove && _stacks === 0,
    disableUseMsg: 'No Stockpile stacks — use Stockpile first',
    diceLabel: _diceLabel,
    diceOverride: _diceOverride,
    diceBreakdownOverride: _diceBreakdownOverride,
    deferAnimation: _willDeferToTargetPicker || _willDeferToSavePicker || _willDeferToReactiveSave || _willDeferToMultiHitAoe,
    skipConfirm: _isSharedCombat,
    onUseMove: (usedMoveName, vpCost) => {
      const target = state.combatants.find(x => x.id === combatantId);
      if (!target) return;

      let newVp = target.currentVp - vpCost;
      let newHp = target.currentHp;
      if (newVp < 0) { newHp = newHp + newVp; newVp = 0; } // no floor -- see handleHpVpDelta
      target.currentHp = newHp;
      target.currentVp = newVp;
      logBattleEvent({ type: 'move-used', actorId: target.id, actorName: target.name, text: `${target.name} used ${usedMoveName} (-${vpCost} VP)` });

      if (target.rechargeStates && target.rechargeStates[usedMoveName]) {
        target.rechargeStates[usedMoveName].chargesLeft =
          Math.max(0, target.rechargeStates[usedMoveName].chargesLeft - 1);
      }

      if (usedMoveName && usedMoveName.toLowerCase() === 'ingrain') {
        const ingrainMove = _moveMap?.get(usedMoveName);
        const desc = ingrainMove?.[7] || '';
        const higherLevels = ingrainMove?.[8] || '';
        const pokemonLevel = target.level || 1;
        const baseDiceMatch = desc.match(/(\d+d\d+)/i);
        let healDice = baseDiceMatch ? baseDiceMatch[1] : '1d10';
        if (higherLevels && pokemonLevel > 1) {
          const tierRegex = /(\d+d\d+)\s+at\s+level\s+(\d+)/gi;
          let match, bestDice = null, bestLevel = 0;
          while ((match = tierRegex.exec(higherLevels)) !== null) {
            const tierLevel = parseInt(match[2]);
            if (pokemonLevel >= tierLevel && tierLevel > bestLevel) { bestLevel = tierLevel; bestDice = match[1]; }
          }
          if (bestDice) healDice = bestDice;
        }
        const moveMod = (ingrainMove?.[2] || '').trim();
        target.statusEffects = target.statusEffects.filter(se => se.name !== 'Ingrain');
        target.statusEffects.push({ name: 'Ingrain', duration: 3, healDice, moveMod });
      }

      // Stockpile: increment stack counter (max 3)
      if (usedMoveName.toLowerCase() === 'stockpile') {
        target.stockpileStacks = Math.min((target.stockpileStacks || 0) + 1, 3);
        const s = target.stockpileStacks;
        showToast(`${target.name}: Stockpile ×${s}${s === 3 ? ' (max)' : ''}`, 'info');
      }

      // Spit Up: show stacks multiplier popup then reset
      if (usedMoveName.toLowerCase() === 'spit up') {
        const stacks = target.stockpileStacks || 0;
        target.stockpileStacks = 0;
        showSpitUpPopup(target, stacks);
      }

      saveCombatState(state);
      rerenderBattle(state);

      // Optional hook (combat-wip.js's shared battle view only -- the
      // legacy page never passes this, so its behavior is unchanged) for
      // "now pick a target and roll damage against them" -- offered only
      // for moves that actually deal damage to someone else, not self-heals
      // or pure status/utility moves, matching the same signal
      // move-popup.js's own drain/direct-heal post-use check already uses.
      if (_willDeferToReactiveSave) {
        onReactiveSave({ combatantId, moveName: usedMoveName, move, computedData, speciesName: target.speciesName });
      } else if (_willDeferToMultiHitAoe) {
        onMultiHitAoe({ combatantId, moveName: usedMoveName, move, computedData, speciesName: target.speciesName });
      } else if (_willDeferToSavePicker) {
        onSaveTriggered({ combatantId, moveName: usedMoveName, move, computedData, speciesName: target.speciesName });
      } else if (onDamageResolved && computedData.damageDice && !_isDrainHeal && !_isDirectHeal) {
        onDamageResolved({ combatantId, moveName: usedMoveName, move, computedData, speciesName: target.speciesName });
      } else if (onEffectsOnly && moveEffectsFor(usedMoveName).length) {
        // Nothing above took it (no damage, not save/AoE-tagged) but the move has
        // structured effects -- Slack Off, Rest, Yawn, Gravity... (combat-wip.js only).
        onEffectsOnly({ combatantId, moveName: usedMoveName, move, computedData, speciesName: target.speciesName });
      }
    },
    onDrainHeal: () => {
      const target = state.combatants.find(x => x.id === combatantId);
      if (target) showDrainHealPopup(target, moveName, state);
    },
    onDirectHeal: () => {
      const target = state.combatants.find(x => x.id === combatantId);
      if (!target) return;
      const healMove = _moveMap?.get(moveName);
      const healDice = getHealDiceForLevel(healMove || [], target.level || 1);
      const moveMod = (healMove?.[2] || '').trim();
      const isSwallow = moveName.toLowerCase() === 'swallow';
      const stacks = isSwallow ? (target.stockpileStacks || 0) : 1;
      if (isSwallow) {
        target.stockpileStacks = 0;
        saveCombatState(state);
        rerenderBattle(state);
      }
      showDirectHealPopup(target, moveName, healDice, moveMod, stacks, state);
    },
  });
}

// ============================================================================
// INVENTORY POPUP
// ============================================================================

let _combatSelectedItem = null;

function parseHealingEffect(effectText) {
  if (!effectText) return null;
  const match = effectText.match(/[Rr]estores?\s+(\d+d\d+)\s*(?:\+\s*(\d+))?\s*(HP|VP)/);
  if (!match) return null;
  return { dice: match[1], flatBonus: match[2] ? parseInt(match[2]) : 0, stat: match[3] };
}

function parseStatusCure(effectText) {
  if (!effectText) return null;
  const lower = effectText.toLowerCase();
  if (lower.includes('all status') || lower.includes('any status') || lower.includes('all conditions')) return ['all'];
  const statuses = ['Poison', 'Burn', 'Confusion', 'Paralysis', 'Sleep', 'Freeze'];
  const cured = statuses.filter(s => lower.includes(s.toLowerCase()));
  return cured.length > 0 ? cured : null;
}

function decrementCombatInventoryItem(itemName) {
  const td = JSON.parse(sessionStorage.getItem('trainerData') || '[]');
  const fullStr = td[20] || '';
  const sepIdx = fullStr.indexOf('##CUSTOM##');
  const regularStr = sepIdx >= 0 ? fullStr.slice(0, sepIdx) : fullStr;
  const customStr  = sepIdx >= 0 ? fullStr.slice(sepIdx + 10) : null;

  const items = regularStr.split(',').map(s => s.trim()).filter(Boolean);
  const idx = items.findIndex(s => {
    const m = s.match(/^(.+?)\s*\(x\d+\)$/);
    return (m ? m[1].trim() : s) === itemName;
  });

  if (idx !== -1) {
    const m = items[idx].match(/^(.+?)\s*\(x(\d+)\)$/);
    const qty = m ? parseInt(m[2]) : 1;
    if (qty <= 1) items.splice(idx, 1);
    else items[idx] = `${itemName} (x${qty - 1})`;
    const newRegular = items.join(', ');
    td[20] = customStr ? `${newRegular}##CUSTOM##${customStr}` : newRegular;
  } else if (customStr) {
    let customItems = [];
    try { customItems = JSON.parse(customStr) || []; } catch(e) {}
    const ci = customItems.findIndex(i => i.name === itemName);
    if (ci !== -1) {
      if (customItems[ci].quantity <= 1) customItems.splice(ci, 1);
      else customItems[ci].quantity--;
      const newRegular = items.join(', ');
      td[20] = customItems.length > 0
        ? `${newRegular}##CUSTOM##${JSON.stringify(customItems)}`
        : newRegular || 'None';
    }
  }
  sessionStorage.setItem('trainerData', JSON.stringify(td));
  TrainerAPI.update(td).catch(e => console.error('Inventory sync:', e));
}

function useCombatHealingItem(itemName, targetId, healAmount, stat) {
  const state = _battleState || getCombatState();
  if (!state) return;
  const target = state.combatants.find(c => c.id === targetId);
  if (!target) return;

  if (stat === 'HP') target.currentHp = Math.min(target.currentHp + healAmount, target.maxHp);
  else               target.currentVp = Math.min(target.currentVp + healAmount, target.maxVp);

  saveCombatState(state);
  rerenderBattle(state);
  decrementCombatInventoryItem(itemName);

  if (target.type === 'trainer') {
    const td = JSON.parse(sessionStorage.getItem('trainerData') || '[]');
    td[34] = target.currentHp; td[35] = target.currentVp;
    sessionStorage.setItem('trainerData', JSON.stringify(td));
    TrainerAPI.update(td).catch(e => console.error('Trainer sync:', e));
  } else {
    const pd = JSON.parse(sessionStorage.getItem(target.entityKey) || '[]');
    pd[45] = target.currentHp; pd[46] = target.currentVp;
    sessionStorage.setItem(target.entityKey, JSON.stringify(pd));
    const trainerName = _battleState?.combatants.find(c => c.type === 'trainer')?.name || '';
    const apiStat = stat === 'HP' ? 'HP' : 'VP';
    const apiVal  = stat === 'HP' ? target.currentHp : target.currentVp;
    PokemonAPI.updateLiveStats(trainerName, pd[2], apiStat, apiVal).catch(e => console.error('Pokemon sync:', e));
  }
}

function useCombatStatusCureItem(itemName, targetId, statusesToCure) {
  const state = _battleState || getCombatState();
  if (!state) return;
  const target = state.combatants.find(c => c.id === targetId);
  if (!target) return;

  if (statusesToCure[0] === 'all') target.statusEffects = [];
  else target.statusEffects = target.statusEffects.filter(s => !statusesToCure.includes(s.name));

  saveCombatState(state);
  rerenderBattle(state);
  decrementCombatInventoryItem(itemName);

  if (target.type === 'pokemon') {
    const pd = JSON.parse(sessionStorage.getItem(target.entityKey) || '[]');
    const trainerName = _battleState?.combatants.find(c => c.type === 'trainer')?.name || '';
    pd[60] = target.statusEffects.map(s => s.name).join(',');
    sessionStorage.setItem(target.entityKey, JSON.stringify(pd));
    PokemonAPI.updateLiveStats(trainerName, pd[2], 'StatusCondition', pd[60]).catch(e => console.error('Status sync:', e));
  }
}

function populateCombatItemActionArea(item) {
  const area = document.getElementById('combatItemActionArea');
  if (!area) return;

  const healing    = parseHealingEffect(item.effect);
  const statusCure = !healing ? parseStatusCure(item.effect) : null;

  const state      = getCombatState();
  const combatants = state ? state.combatants : [];
  const targetOptions = combatants
    .map(c => `<option value="${c.id}">${c.name} — ${healing?.stat === 'VP' ? `VP: ${c.currentVp}/${c.maxVp}` : `HP: ${c.currentHp}/${c.maxHp}`}</option>`)
    .join('');

  if (healing) {
    const bonusLabel = healing.flatBonus > 0 ? ` + ${healing.flatBonus}` : '';
    area.innerHTML = `
      <div class="combat-item-roll-row">
        <span class="combat-item-roll-label">Roll <strong>${healing.dice}</strong>${bonusLabel}:</span>
        <input type="number" id="combatHealRoll" class="combat-item-roll-input" min="1" placeholder="Result">
      </div>
      <select id="combatItemTarget" class="combat-item-target-select">
        <option value="">Select target...</option>${targetOptions}
      </select>
      <div id="combatHealPreview" class="combat-item-heal-preview"></div>
      <button class="use-buff-button" id="combatApplyItemBtn">Use</button>`;

    const updatePreview = () => {
      const roll = parseInt(document.getElementById('combatHealRoll')?.value) || 0;
      const total = roll + healing.flatBonus;
      const targetId = document.getElementById('combatItemTarget')?.value;
      const target = combatants.find(c => c.id === targetId);
      const preview = document.getElementById('combatHealPreview');
      if (preview && target && total > 0) {
        const cur = healing.stat === 'HP' ? target.currentHp : target.currentVp;
        const max = healing.stat === 'HP' ? target.maxHp : target.maxVp;
        const after = Math.min(cur + total, max);
        preview.textContent = `${healing.stat}: ${cur} → ${after} (+${after - cur})`;
      } else if (preview) {
        preview.textContent = '';
      }
    };
    area.querySelector('#combatHealRoll').addEventListener('input', updatePreview);
    area.querySelector('#combatItemTarget').addEventListener('change', updatePreview);

    area.querySelector('#combatApplyItemBtn').addEventListener('click', () => {
      const roll = parseInt(document.getElementById('combatHealRoll')?.value) || 0;
      if (roll <= 0) { showToast('Enter your dice roll result first.', 'warning'); return; }
      const targetId = document.getElementById('combatItemTarget')?.value;
      if (!targetId) { showToast('Select a target first.', 'warning'); return; }
      useCombatHealingItem(item.name, targetId, roll + healing.flatBonus, healing.stat);
      document.getElementById('combatInventoryPopup').style.display = 'none';
    });

  } else if (statusCure) {
    const cureLabel = statusCure[0] === 'all' ? 'all status conditions' : statusCure.join(', ');
    area.innerHTML = `
      <div style="color:#FFDE00;font-size:0.82rem;margin-bottom:0.4rem;">Cures: <strong>${cureLabel}</strong></div>
      <select id="combatItemTarget" class="combat-item-target-select">
        <option value="">Select target...</option>${targetOptions}
      </select>
      <button class="use-buff-button" id="combatApplyItemBtn">Use</button>`;

    area.querySelector('#combatApplyItemBtn').addEventListener('click', () => {
      const targetId = document.getElementById('combatItemTarget')?.value;
      if (!targetId) { showToast('Select a target first.', 'warning'); return; }
      useCombatStatusCureItem(item.name, targetId, statusCure);
      document.getElementById('combatInventoryPopup').style.display = 'none';
    });

  } else {
    area.innerHTML = `<button class="use-buff-button" id="combatApplyItemBtn">Use</button>`;
    area.querySelector('#combatApplyItemBtn').addEventListener('click', () => {
      decrementCombatInventoryItem(item.name);
      document.getElementById('combatInventoryPopup').style.display = 'none';
    });
  }
}

function showTypeCalcPopup(combatantId, state) {
  const c = state.combatants.find(x => x.id === combatantId);
  if (!c || c.type !== 'pokemon') return;

  const TYPE_NAMES = ["Normal","Fighting","Flying","Poison","Ground","Rock","Bug","Ghost","Steel","Fire","Water","Grass","Electric","Psychic","Ice","Dragon","Dark","Fairy"];
  const ALL_TYPES = [...TYPE_NAMES, "Cosmic"];

  const chartVals = (c.typeChart || '').split(',').map(Number);
  const multMap = {};
  TYPE_NAMES.forEach((name, i) => { multMap[name] = isNaN(chartVals[i]) ? 1 : chartVals[i]; });
  multMap["Cosmic"] = 1;

  // Energy Intensive: shift Psychic up one damage tier
  const energyIntensive = hasAbility(c, 'Energy Intensive');
  if (energyIntensive) {
    const psyMult = multMap['Psychic'] ?? 1;
    if (psyMult === 0)    multMap['Psychic'] = 0.5; // immune → resistant
    else if (psyMult < 1) multMap['Psychic'] = 1;   // resistant → neutral
    else if (psyMult === 1) multMap['Psychic'] = 2; // neutral → weak
    // already weak (≥2): no change
  }

  const weaknesses  = ALL_TYPES.filter(t => (multMap[t] ?? 1) > 1);
  const resistances = ALL_TYPES.filter(t => { const v = multMap[t] ?? 1; return v > 0 && v < 1; });
  const immunities  = ALL_TYPES.filter(t => (multMap[t] ?? 1) === 0);

  document.getElementById('typeCalcTitle').textContent = c.name;

  // Pokemon types row
  const typesEl = document.getElementById('typeCalcPokemonTypes');
  typesEl.innerHTML = c.types.map(t => {
    const bg = getMoveTypeColor(t);
    const col = getTextColorForBackground(bg);
    return `<span class="type-calc-badge" style="background:${bg};color:${col}">${t}</span>`;
  }).join('');

  // Build clickable type buttons
  function buildBtns(types) {
    return types.map(t => {
      const bg = getMoveTypeColor(t);
      const col = getTextColorForBackground(bg);
      return `<button class="combat-type-button" data-type="${t}" style="background:${bg};color:${col}">${t}</button>`;
    }).join('');
  }

  const sections = [
    { sectionId: 'typeCalcWeakSection',   containerId: 'typeCalcWeak',   types: weaknesses },
    { sectionId: 'typeCalcResistSection', containerId: 'typeCalcResist', types: resistances },
    { sectionId: 'typeCalcImmuneSection', containerId: 'typeCalcImmune', types: immunities },
  ];
  sections.forEach(({ sectionId, containerId, types }) => {
    const sec = document.getElementById(sectionId);
    sec.style.display = types.length ? '' : 'none';
    document.getElementById(containerId).innerHTML = buildBtns(types);
  });

  // Ability-effect section: always show Psychic for Energy Intensive
  const abilitySection = document.getElementById('typeCalcAbilitySection');
  const abilityContainer = document.getElementById('typeCalcAbility');
  const abilityLabel = document.getElementById('typeCalcAbilityLabel');
  // Show ability section only when Psychic landed at neutral (1×) — not visible in any standard section
  const psychicInStandardSection = [...weaknesses, ...resistances, ...immunities].includes('Psychic');
  if (energyIntensive && !psychicInStandardSection) {
    abilityLabel.textContent = 'Energy Intensive (neutral, drains VP)';
    abilityContainer.innerHTML = buildBtns(['Psychic']);
    abilitySection.style.display = '';
  } else {
    abilitySection.style.display = 'none';
  }

  // Result display + type button click handlers
  const resultEl = document.getElementById('typeCalcResult');
  resultEl.className = 'type-calc-result';
  resultEl.textContent = '';

  const popup = document.getElementById('combatTypeCalcPopup');
  popup.querySelectorAll('.combat-type-button').forEach(btn => {
    btn.addEventListener('click', () => {
      const wasSelected = btn.classList.contains('selected');
      popup.querySelectorAll('.combat-type-button').forEach(b => b.classList.remove('selected'));
      if (wasSelected) {
        // Deselect — clear result
        resultEl.className = 'type-calc-result';
        resultEl.textContent = '';
      } else {
        btn.classList.add('selected');
        const v = multMap[btn.dataset.type] ?? 1;
        if (v === 0) { resultEl.textContent = '0× — Immune!'; resultEl.className = 'type-calc-result type-calc-immune show'; }
        else if (v < 1) { resultEl.textContent = `${v}× — Not very effective`; resultEl.className = 'type-calc-result type-calc-resist show'; }
        else if (v > 1) { resultEl.textContent = `${v}× — Super effective!`; resultEl.className = 'type-calc-result type-calc-weak show'; }
        else { resultEl.textContent = '1× — Normal damage'; resultEl.className = 'type-calc-result type-calc-neutral show'; }
      }
    });
  });

  // HP / VP display and adjustment
  const hpValEl = document.getElementById('typeCalcHpVal');
  const vpValEl = document.getElementById('typeCalcVpVal');
  const hpInput = document.getElementById('typeCalcHpInput');
  const vpInput = document.getElementById('typeCalcVpInput');

  const refreshHpVp = () => {
    hpValEl.textContent = `${c.currentHp} / ${c.maxHp}`;
    vpValEl.textContent = `${c.currentVp} / ${c.maxVp}`;
  };
  refreshHpVp();
  hpInput.value = '';
  vpInput.value = '';

  const trainerName = _battleState?.combatants.find(x => x.type === 'trainer')?.name || '';
  const syncPokemon = () => {
    const pd = JSON.parse(sessionStorage.getItem(c.entityKey) || '[]');
    pd[45] = c.currentHp; pd[46] = c.currentVp;
    sessionStorage.setItem(c.entityKey, JSON.stringify(pd));
    PokemonAPI.updateLiveStats(trainerName, pd[2], 'HP', c.currentHp).catch(() => {});
    PokemonAPI.updateLiveStats(trainerName, pd[2], 'VP', c.currentVp).catch(() => {});
  };

  document.getElementById('typeCalcAddBtn').onclick = () => {
    const hpAmt = parseInt(hpInput.value) || 0;
    const vpAmt = parseInt(vpInput.value) || 0;
    if (hpAmt > 0) c.currentHp = Math.min(c.currentHp + hpAmt, c.maxHp);
    if (vpAmt > 0) c.currentVp = Math.min(c.currentVp + vpAmt, c.maxVp);
    saveCombatState(state);
    rerenderBattle(state);
    syncPokemon();
    refreshHpVp();
    hpInput.value = ''; vpInput.value = '';
  };

  document.getElementById('typeCalcRemoveBtn').onclick = () => {
    const hpAmt = parseInt(hpInput.value) || 0;
    const vpAmt = parseInt(vpInput.value) || 0;
    const selectedBtn = popup.querySelector('.combat-type-button.selected');
    const selectedType = selectedBtn?.dataset.type;
    const mult = selectedType ? (multMap[selectedType] ?? 1) : 1;
    const actualHp = Math.round(hpAmt * mult);
    if (actualHp > 0) c.currentHp = c.currentHp - actualHp; // no floor -- see handleHpVpDelta
    if (vpAmt > 0) c.currentVp = Math.max(0, c.currentVp - vpAmt);
    // Energy Intensive: Psychic damage also drains VP equal to HP taken
    if (actualHp > 0 && hasAbility(c, 'Energy Intensive')) {
      if (selectedType === 'Psychic') {
        c.currentVp = Math.max(0, c.currentVp - actualHp);
        showToast(`${c.name}: Energy Intensive — Psychic hit drains an extra ${actualHp} VP!`, 'warning');
      }
    }
    // Deselect the type button after applying damage
    if (selectedBtn) {
      selectedBtn.classList.remove('selected');
      resultEl.className = 'type-calc-result';
      resultEl.textContent = '';
    }
    saveCombatState(state);
    rerenderBattle(state);
    syncPokemon();
    refreshHpVp();
    hpInput.value = ''; vpInput.value = '';
  };

  popup.style.display = 'flex';
}

function showCombatInventoryPopup() {
  const trainerData = JSON.parse(sessionStorage.getItem('trainerData') || '[]');
  const inventory = trainerData[20] || '';
  const itemsStr = sessionStorage.getItem('items');
  const categoriesEl = document.getElementById('combatInventoryCategories');
  if (!categoriesEl) return;

  // Reset detail panel
  _combatSelectedItem = null;
  const nameEl    = document.getElementById('combatSelectedItemName');
  const descEl    = document.getElementById('combatDescriptionText');
  const effEl     = document.getElementById('combatEffectText');
  const actionArea = document.getElementById('combatItemActionArea');
  if (nameEl)    nameEl.textContent = 'Select an item';
  if (descEl)    descEl.textContent = 'Choose an item from your inventory to view its details.';
  if (effEl)     effEl.textContent  = 'Item effects will appear here.';
  if (actionArea) actionArea.innerHTML = '';

  const hasCombatCustom = inventory.includes('##CUSTOM##');
  if ((!inventory || !itemsStr) && !hasCombatCustom) {
    categoriesEl.innerHTML = '<li style="padding:1rem;color:#999;text-align:center;">No items in inventory</li>';
    document.getElementById('combatInventoryPopup').style.display = 'flex';
    return;
  }

  const itemsData = itemsStr ? JSON.parse(itemsStr) : [];
  const groupedItems = {};
  const combatSepIdx = inventory.indexOf('##CUSTOM##');
  const combatRegularInv = combatSepIdx >= 0 ? inventory.slice(0, combatSepIdx) : inventory;
  combatRegularInv.split(',').map(s => s.trim()).filter(Boolean).forEach(s => {
    const m = s.match(/^(.+?)\s*\(x(\d+)\)$/);
    const name = m ? m[1].trim() : s;
    const qty  = m ? parseInt(m[2]) : 1;
    const dbItem = itemsData.find(i => i.name === name);
    if (dbItem) {
      const type = dbItem.type || 'Misc';
      if (!groupedItems[type]) groupedItems[type] = [];
      groupedItems[type].push({ name, qty, description: dbItem.description || '', effect: dbItem.effect || '' });
    }
  });
  if (combatSepIdx >= 0) {
    try {
      const combatCustom = JSON.parse(inventory.slice(combatSepIdx + 10)) || [];
      if (combatCustom.length > 0) {
        groupedItems['Custom Items'] = combatCustom.map(ci => ({
          name: ci.name, qty: ci.quantity, description: ci.description || '', effect: ''
        }));
      }
    } catch(e) {}
  }

  let html = '';
  Object.keys(groupedItems).sort().forEach(type => {
    html += `<li>
      <div class="category-header" data-category="${type}">
        <span>${type}</span><span class="arrow">▶</span>
      </div>
      <div class="item-list">
        ${groupedItems[type].map(item =>
          `<div class="inventory-list-item" data-item-name="${item.name}">${item.name} (x${item.qty})</div>`
        ).join('')}
      </div>
    </li>`;
  });
  categoriesEl.innerHTML = html;

  const allItems = Object.values(groupedItems).flat();

  // Search
  const searchInput = document.getElementById('combatInventorySearch');
  const searchResults = document.getElementById('combatInventorySearchResults');
  if (searchInput && searchResults) {
    const normalize = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const applySearch = (query) => {
      const q = normalize(query.trim());
      if (!q) {
        searchResults.classList.remove('active');
        searchResults.innerHTML = '';
        categoriesEl.style.display = '';
        return;
      }
      categoriesEl.style.display = 'none';
      const matches = allItems.filter(item => normalize(item.name).includes(q));
      if (!matches.length) {
        searchResults.innerHTML = '<li class="inventory-search-no-results">No items found</li>';
      } else {
        searchResults.innerHTML = matches.map(item =>
          `<li class="inventory-list-item" data-item-name="${item.name}">${item.name} (x${item.qty})</li>`
        ).join('');
        searchResults.querySelectorAll('.inventory-list-item').forEach(el => {
          el.addEventListener('click', () => {
            searchResults.querySelectorAll('.inventory-list-item').forEach(x => x.classList.remove('selected'));
            el.classList.add('selected');
            _combatSelectedItem = allItems.find(i => i.name === el.dataset.itemName) || null;
            if (_combatSelectedItem && nameEl && descEl && effEl) {
              nameEl.textContent = `${_combatSelectedItem.name} (x${_combatSelectedItem.qty})`;
              descEl.textContent = _combatSelectedItem.description || 'No description available.';
              effEl.textContent = _combatSelectedItem.effect || 'No effect description.';
              populateCombatItemActionArea(_combatSelectedItem);
            }
          });
        });
      }
      searchResults.classList.add('active');
    };
    const freshSearch = searchInput.cloneNode(true);
    searchInput.parentNode.replaceChild(freshSearch, searchInput);
    freshSearch.value = '';
    freshSearch.addEventListener('input', e => applySearch(e.target.value));
    applySearch('');
  }

  categoriesEl.querySelectorAll('.category-header').forEach(header => {
    header.addEventListener('click', () => {
      const list = header.nextElementSibling;
      const expanded = list.classList.contains('expanded');
      categoriesEl.querySelectorAll('.item-list').forEach(l => l.classList.remove('expanded'));
      categoriesEl.querySelectorAll('.category-header').forEach(h => h.classList.remove('active'));
      if (!expanded) { list.classList.add('expanded'); header.classList.add('active'); }
    });
  });

  categoriesEl.querySelectorAll('.inventory-list-item').forEach(el => {
    el.addEventListener('click', () => {
      categoriesEl.querySelectorAll('.inventory-list-item').forEach(x => x.classList.remove('selected'));
      el.classList.add('selected');
      _combatSelectedItem = allItems.find(i => i.name === el.dataset.itemName) || null;
      if (_combatSelectedItem && nameEl && descEl && effEl) {
        nameEl.textContent = `${_combatSelectedItem.name} (x${_combatSelectedItem.qty})`;
        descEl.textContent = _combatSelectedItem.description || 'No description available.';
        effEl.textContent  = _combatSelectedItem.effect || 'No effect description.';
        populateCombatItemActionArea(_combatSelectedItem);
      }
    });
  });

  document.getElementById('combatInventoryPopup').style.display = 'flex';
}

// ============================================================================
// TRAINER BUFFS POPUP
// ============================================================================

function getCombatMaxCharges(buffName, trainerLevel) {
  switch (buffName) {
    case 'Second Wind':      return trainerLevel >= 7 ? 5 : trainerLevel >= 3 ? 2 : 0;
    case 'Rapid Orders':     return trainerLevel >= 6 ? 1 : 0;
    case 'Unbreakable Bond': return trainerLevel >= 13 ? 1 : 0;
    case 'Elemental Synergy':return trainerLevel >= 18 ? 1 : 0;
    case 'Master Trainer':   return trainerLevel >= 20 ? 2 : 0;
    default: return 0;
  }
}

function showCombatBuffsPopup() {
  const trainerData = JSON.parse(sessionStorage.getItem('trainerData') || '[]');
  const trainerLevel = parseInt(trainerData[2]) || 1;
  const skillsDataRaw = sessionStorage.getItem('skills');
  const nationalitiesDataRaw = sessionStorage.getItem('nationalities');

  const container = document.getElementById('combatBuffsContent');
  if (!container) return;

  let content = '';

  if (nationalitiesDataRaw) {
    const nationalitiesData = JSON.parse(nationalitiesDataRaw);
    const nationality = nationalitiesData.find(n => n.nationality === trainerData[38]);
    if (nationality) {
      content += `<div class="skill-item-container">
        <h3 class="skill-name-header">${nationality.regionBuff}</h3>
        <div class="skill-effect-box">${nationality.effect}</div>
      </div>`;
    }
  }

  const trainerBuffDefs = [
    { name: 'Second Wind',      index: 40 },
    { name: 'Rapid Orders',     index: 41 },
    { name: 'Unbreakable Bond', index: 42 },
    { name: 'Elemental Synergy',index: 43 },
    { name: 'Master Trainer',   index: 44 }
  ];

  if (skillsDataRaw) {
    const skillsData = JSON.parse(skillsDataRaw);
    const skillsByName = new Map();
    skillsData.forEach(skill => {
      const isUnlocked = trainerLevel >= skill.level;
      const effect = isUnlocked ? skill.fullEffect : `Unlocks at level ${skill.level}`;
      const existing = skillsByName.get(skill.name);
      if (!existing || (isUnlocked && skill.level > existing.level)) {
        skillsByName.set(skill.name, { level: skill.level, effect, isUnlocked });
      }
    });

    skillsByName.forEach((skillData, skillName) => {
      const buffDef = trainerBuffDefs.find(b => b.name === skillName);
      if (buffDef && skillData.isUnlocked) {
        const currentCharges = parseInt(trainerData[buffDef.index]) || 0;
        const maxCharges = getCombatMaxCharges(buffDef.name, trainerLevel);
        const dots = maxCharges > 0
          ? Array.from({ length: maxCharges }, (_, i) =>
              `<span class="charge-dot ${i < currentCharges ? 'filled' : 'empty'}"></span>`
            ).join('')
          : '';
        const disabled = currentCharges <= 0 ? 'disabled' : '';
        content += `<div class="skill-item-container">
          <div class="skill-header-row">
            <h3 class="skill-name-header">${skillName}</h3>
            ${dots ? `<div class="charge-dots">${dots}</div>` : ''}
          </div>
          <div class="skill-effect-box">${skillData.effect}</div>
          ${maxCharges > 0 ? `<button class="use-buff-button" data-buff-index="${buffDef.index}" ${disabled}>Use</button>` : ''}
        </div>`;
      } else {
        content += `<div class="skill-item-container">
          <h3 class="skill-name-header">${skillName}</h3>
          <div class="skill-effect-box">${skillData.effect}</div>
        </div>`;
      }
    });
  }

  container.innerHTML = content || '<p style="color:#aaa;padding:1rem;">No skills data available.</p>';

  container.querySelectorAll('.use-buff-button').forEach(btn => {
    btn.addEventListener('click', () => {
      const buffIndex = parseInt(btn.dataset.buffIndex);
      const td = JSON.parse(sessionStorage.getItem('trainerData') || '[]');
      const current = parseInt(td[buffIndex]) || 0;
      if (current <= 0) return;
      td[buffIndex] = current - 1;
      sessionStorage.setItem('trainerData', JSON.stringify(td));
      TrainerAPI.update(td).catch(e => console.error('Buff sync:', e));
      showCombatBuffsPopup();
    });
  });

  document.getElementById('combatBuffsPopup').style.display = 'flex';
}

// ============================================================================
// END COMBAT
// ============================================================================

async function endCombat(state) {
  const trainerData = JSON.parse(sessionStorage.getItem('trainerData') || '[]');
  const trainerName = trainerData[1] || '';

  // Persist trainer
  const trainer = state.combatants.find(c => c.type === 'trainer');
  if (trainer) {
    trainerData[34] = trainer.currentHp;
    trainerData[35] = trainer.currentVp;
    sessionStorage.setItem('trainerData', JSON.stringify(trainerData));
    TrainerAPI.update(trainerData).catch(e => console.error('Trainer sync:', e));
  }

  // Persist all pokemon — active and benched
  const allPokemon = [
    ...state.combatants.filter(c => c.type === 'pokemon'),
    ...(state.bench || [])
  ];

  for (const c of allPokemon) {
    const pokemonData = JSON.parse(sessionStorage.getItem(c.entityKey) || '[]');
    const pokemonName = pokemonData[2];
    pokemonData[45] = c.currentHp;
    pokemonData[46] = c.currentVp;

    const knownMovesStr = buildKnownMovesString(c.rechargeStates || {});
    pokemonData[59] = knownMovesStr;

    const statusCondStr = c.statusEffects.map(s => s.name).join(',');
    pokemonData[60] = statusCondStr;

    sessionStorage.setItem(c.entityKey, JSON.stringify(pokemonData));

    // Full update for HP, VP, KnownMoves
    PokemonAPI.update(pokemonData).catch(e => console.error('Pokemon sync:', e));
    // Explicit StatusCondition update — uses clearContent() in GAS when empty, which reliably clears the cell
    PokemonAPI.updateLiveStats(trainerName, pokemonName, 'StatusCondition', statusCondStr)
      .catch(e => console.error('StatusCondition sync:', e));
  }

  sessionStorage.removeItem('combatState');
  window.dispatchEvent(new CustomEvent('navigate', { detail: { route: 'trainer-card' } }));
}
