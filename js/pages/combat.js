// Combat Page — Full encounter tracker with initiative, status effects, and move integration

import { PokemonAPI, TrainerAPI } from '../api.js';
import { showToast } from '../utils/notifications.js';
import { getMoveTypeColor, getTextColorForBackground, parseDamageDice, computeMoveData } from '../utils/pokemon-types.js';

// Holds a reference to the live battle state so inventory/heal functions stay in sync
let _battleState = null;

// Module-level move cache — parsed once, reused everywhere
let _moves = null;
let _moveMap = null; // Map<name, moveData> for O(1) lookups

// Module-level items DB cache — held items don't change during combat, so parse once
let _itemsCache = null;
function getCachedItems() {
  if (!_itemsCache) _itemsCache = JSON.parse(sessionStorage.getItem('items') || '[]');
  return _itemsCache;
}

// ============================================================================
// GAME HELPERS
// ============================================================================

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
 */
function buildKnownMovesString(rechargeStates) {
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

function buildTrainerCombatant() {
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
  const currentHp = parseInt(trainerData[34]) || maxHp;
  const currentVp = parseInt(trainerData[35]) || maxVp;
  const ac = parseInt(trainerData[36]) || parseInt(trainerData[13]) || 10;
  const baseAc = parseInt(trainerData[13]) || 10;

  return {
    id: 'trainer', type: 'trainer', entityKey: 'trainerData',
    name: trainerData[1] || 'Trainer',
    image: trainerData[0] || 'assets/Pokeball.png',
    level, initiativeScore: dexMod, initiativeRoll: 0, initiativeBonus: 0, initiativeTotal: dexMod,
    ac, baseAc, critMod: 0, maxHp, currentHp, maxVp, currentVp,
    proficiency: computeProficiency(level),
    str, dex, con, int: int_, wis, cha,
    strMod, dexMod, conMod, intMod, wisMod, chaMod,
    moves: [], types: [], rechargeStates: {},
    feats: trainerData[33] || '',
    inventory: trainerData[20] || '',
    statusEffects: [], isExpanded: false
  };
}

function buildPokemonCombatant(pokemonKey) {
  loadCombatMoves();
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
  const currentHp = parseInt(pokemonData[45]) || maxHp;
  const currentVp = parseInt(pokemonData[46]) || maxVp;
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

  return {
    id: pokemonKey, type: 'pokemon', entityKey: pokemonKey,
    name: pokemonData[36] || pokemonData[2] || 'Pokemon',
    image: pokemonData[1] || 'assets/Pokeball.png',
    level, initiativeScore: initiative, initiativeRoll: 0, initiativeBonus: 0, initiativeTotal: initiative,
    ac: parseInt(pokemonData[8]) || 10, baseAc: parseInt(pokemonData[8]) || 10, critMod: 0,
    maxHp, currentHp, maxVp, currentVp,
    proficiency, stabBonusValue: parseInt(pokemonData[34]) || 2,
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
    statusEffects: [], isExpanded: false
  };
}

// ============================================================================
// SESSION STATE
// ============================================================================

function getCombatState() {
  const raw = sessionStorage.getItem('combatState');
  return raw ? JSON.parse(raw) : null;
}

function saveCombatState(state) {
  sessionStorage.setItem('combatState', JSON.stringify(state));
}

// ============================================================================
// RENDER ENTRY POINT
// ============================================================================

export function renderCombat() {
  const state = getCombatState();
  const phase = state ? state.phase : 'setup';
  if (phase === 'initiative') return renderInitiativePhase(state);
  if (phase === 'battle') return renderBattlePhase(state);
  return renderSetupPhase();
}

// ============================================================================
// PHASE 1: SETUP
// ============================================================================

function renderSetupPhase() {
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
      <img src="${p.image}" alt="${p.name}" onerror="this.src='assets/Pokeball.png'">
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
        <div class="combat-header-title">⚔️ Combat Setup</div>
        <div></div>
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
        <div class="setup-section-label">SELECT PARTY POKÉMON</div>
        <div class="setup-pokemon-list" id="setupPokemonList">
          ${pokemonCards || '<div class="setup-empty">No active party Pokémon found.</div>'}
        </div>
        <button class="combat-start-btn" id="startCombatBtn" disabled>Start Combat →</button>
      </div>
    </div>`;
}

// ============================================================================
// PHASE 2: INITIATIVE
// ============================================================================

function renderInitiativePhase(state) {
  const rows = state.combatants.map(c => `
    <div class="initiative-row">
      <img src="${c.image}" alt="${c.name}" class="initiative-img" onerror="this.src='assets/Pokeball.png'">
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
        <div class="combat-header-title">⚔️ Initiative</div>
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

function renderBattlePhase(state) {
  const cards = state.combatants.map((c, idx) => renderCombatCard(c, idx === state.activeTurnIndex)).join('');
  return `
    <div class="combat-page">
      <style>${COMBAT_CSS}</style>
      <div class="combat-header-bar">
        <div class="combat-round-label">Round ${state.round}</div>
        <div class="combat-header-title">⚔️ Battle</div>
        <button class="combat-end-btn" id="endCombatBtn">End Combat</button>
      </div>
      <div class="battle-list" id="battleList">${cards}</div>

      <!-- Move Details Popup -->
      <div class="combat-popup-overlay" id="combatMovePopup" style="display:none;">
        <div class="combat-popup-content" id="combatMovePopupContent">
          <div id="combatMovePopupHeader" class="combat-move-popup-header">
            <button id="closeCombatMovePopup" class="combat-popup-close">×</button>
            <h2 id="combatMoveNamePopup"></h2>
            <div id="combatMoveTypePopup" class="combat-move-type-badge"></div>
          </div>
          <div id="combatMovePopupBody" class="combat-move-popup-body">
            <div class="combat-move-grid">
              <div><strong>Modifier:</strong> <span id="cMoveModifier"></span></div>
              <div><strong>Action:</strong> <span id="cMoveAction"></span></div>
              <div><strong>VP Cost:</strong> <span id="cMoveVP"></span></div>
              <div><strong>Duration:</strong> <span id="cMoveDuration"></span></div>
              <div><strong>Range:</strong> <span id="cMoveRange"></span></div>
              <div><strong>Size:</strong> <span id="cMoveSize"></span></div>
              <div><strong>Crit Mod:</strong> <span id="cMoveCritMod"></span></div>
            </div>
            <div class="combat-move-description" id="cMoveDescription"></div>
            <div class="combat-move-higher" id="cMoveHigher"></div>
            <div class="combat-move-rolls-grid">
              <div>
                <strong>Attack Roll:</strong>
                <span id="cAttackBonus" class="combat-roll-bonus"></span>
                <div id="cAttackBreakdown" class="combat-roll-breakdown"></div>
              </div>
              <div>
                <strong>Damage Roll:</strong>
                <span id="cDamageBonus" class="combat-roll-bonus"></span>
                <div id="cDamageBreakdown" class="combat-roll-breakdown"></div>
              </div>
            </div>
            <div class="combat-move-held-items" id="cHeldItems" style="display:none;"></div>
            <div id="cBattleDiceContainer"></div>
            <div id="cTacticianContainer"></div>
            <div id="cCommanderContainer"></div>
            <button id="useCombatMoveBtn" class="combat-use-move-btn">Use Move</button>
          </div>
        </div>
      </div>

      <!-- Use Move Confirm -->
      <div class="combat-popup-overlay" id="combatMoveConfirmPopup" style="display:none;">
        <div class="combat-popup-content" style="max-width:360px;text-align:center;padding:2rem;">
          <h3 id="combatConfirmText" style="margin:0 0 1.5rem 0;color:#e0e0e0;"></h3>
          <div style="display:flex;gap:1rem;">
            <button id="confirmCombatMoveYes" class="combat-use-move-btn" style="flex:1;">Yes</button>
            <button id="confirmCombatMoveNo" class="combat-use-move-btn" style="flex:1;background:linear-gradient(135deg,#EE1515,#C91010);">No</button>
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

function renderCombatCard(c, isActive) {
  const fainted = c.currentHp <= 0;
  const hpPct = c.maxHp > 0 ? Math.round((c.currentHp / c.maxHp) * 100) : 0;
  const vpPct = c.maxVp > 0 ? Math.round((c.currentVp / c.maxVp) * 100) : 0;

  const typeBadges = c.types.map(t => `<span class="type-badge type-${t.toLowerCase()}">${t}</span>`).join('');

  const KNOWN_STATUSES = ['Poison','Burn','Confusion','Paralysis','Sleep','Freeze'];
  const statusBadges = c.statusEffects.map(se => {
    const dur = se.duration === -1 ? '' : ` (${se.duration})`;
    const cls = KNOWN_STATUSES.includes(se.name) ? `status-${se.name.toLowerCase()}` : 'status-custom';
    const titleAttr = se.description ? ` title="${se.description.replace(/"/g, '&quot;')}"` : '';
    return `<span class="status-badge ${cls}"${titleAttr} data-combatant-id="${c.id}" data-effect="${se.name}">${se.name}${dur}</span>`;
  }).join('');

  const expandedHTML = c.isExpanded ? renderExpandedSection(c, statusBadges) : '';

  return `
    <div class="combat-card ${isActive ? 'combat-card--active' : ''} ${fainted ? 'combat-card--fainted' : ''}" data-combatant-id="${c.id}" id="card_${c.id}">
      <div class="combat-card-main">
        <img src="${c.image}" alt="${c.name}" class="combat-card-img" onerror="this.src='assets/Pokeball.png'">
        <div class="combat-card-body">
          <div class="combat-card-name-row">
            <span class="combat-card-name ${fainted ? 'fainted-name' : ''}">${c.name}</span>
            <span class="combat-card-level">Lv ${c.level}</span>
            ${typeBadges}
            <span class="combat-initiative-badge">Init: ${c.initiativeTotal}</span>
          </div>
          <div class="combat-card-stats-group">
            <div class="combat-card-ac-line">AC <strong>${c.ac} / ${c.baseAc}</strong></div>
            <div class="combat-card-stats-row">
              <span class="stat-bar-wrap">HP: <strong>${c.currentHp}/${c.maxHp}</strong>
                <div class="mini-bar"><div class="mini-bar-fill hp-bar" style="width:${hpPct}%"></div></div>
              </span>
              <span class="stat-bar-wrap">VP: <strong>${c.currentVp}/${c.maxVp}</strong>
                <div class="mini-bar"><div class="mini-bar-fill vp-bar" style="width:${vpPct}%"></div></div>
              </span>
            </div>
          </div>
          <div class="combat-card-stats-row combat-mods-row">
            <span>STR ${c.str}<small>(${formatMod(c.strMod)})</small></span>
            <span>DEX ${c.dex}<small>(${formatMod(c.dexMod)})</small></span>
            <span>CON ${c.con}<small>(${formatMod(c.conMod)})</small></span>
            <span>INT ${c.int}<small>(${formatMod(c.intMod)})</small></span>
            <span>WIS ${c.wis}<small>(${formatMod(c.wisMod)})</small></span>
            <span>CHA ${c.cha}<small>(${formatMod(c.chaMod)})</small></span>
          </div>
        </div>
      </div>
      <div class="combat-card-footer">
        <div class="combat-status-badges">${statusBadges}</div>
        ${isActive ? `<button class="end-turn-btn" data-combatant-id="${c.id}">End Turn</button>` : '<div></div>'}
      </div>
      ${expandedHTML}
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

function renderExpandedSection(c, statusBadges) {
  // --- Feats section (both) ---
  const featsSection = c.feats ? `
    <div class="expanded-feats-section">
      <div class="expanded-section-label">Feats</div>
      <div class="feats-list">
        ${c.feats.split(',').map(f => f.trim()).filter(Boolean).map(f => `<span class="feat-badge">${f}</span>`).join('')}
      </div>
    </div>` : '';

  // --- Trainer action buttons (trainer only) ---
  const trainerActionsSection = c.type === 'trainer' ? `
    <div class="expanded-trainer-actions">
      <button class="combat-trainer-action-btn combat-inv-open-btn" data-combatant-id="${c.id}"><img src="assets/Bag.png" alt="Bag" class="combat-inv-icon"> Inventory</button>
      <button class="combat-trainer-action-btn combat-buffs-open-btn" data-combatant-id="${c.id}">✨ Trainer Buffs</button>
    </div>` : '';

  // --- Info section (pokemon only) ---
  const abilitiesHtml = renderAbilitiesForCombat(c.abilities);
  const itemHtml = renderItemForCombat(c.item);
  const infoSection = c.type === 'pokemon' ? `
    <div class="expanded-info-section">
      <div class="expanded-section-label">Pokémon Info</div>
      <div class="info-grid">
        ${abilitiesHtml ? `<div class="info-row"><span class="info-label">Abilities</span><div class="info-ability-list">${abilitiesHtml}</div></div>` : ''}
        ${itemHtml     ? `<div class="info-row"><span class="info-label">Item</span><div>${itemHtml}</div></div>` : ''}
        ${c.size       ? `<div class="info-row"><span class="info-label">Size</span><span>${c.size}</span></div>` : ''}
        ${c.movement   ? `<div class="info-row"><span class="info-label">Movement</span><span>${c.movement}</span></div>` : ''}
      </div>
    </div>` : '';

  // --- HP / VP adjusters ---
  const typeCalcBtn = c.type === 'pokemon'
    ? `<button class="combat-type-calc-btn" data-combatant-id="${c.id}">🧮<br>Damage<br>Calculator</button>`
    : '';
  const critRow = c.type === 'pokemon' ? `
      <div class="hpvp-adjust-row" style="margin-top:0.35rem;">
        <span class="hpvp-stat-label">Crit</span>
        <button class="hpvp-btn" data-combatant-id="${c.id}" data-stat="crit" data-delta="-1">−</button>
        <input type="number" class="hpvp-input" value="${c.critMod || 0}" data-combatant-id="${c.id}" data-stat="crit">
        <span class="hpvp-max"></span>
        <button class="hpvp-btn" data-combatant-id="${c.id}" data-stat="crit" data-delta="1">+</button>
      </div>` : '';
  const hpvpSection = `
    <div class="expanded-hpvp-section">
      <div class="expanded-section-label">Adjust Stats</div>
      <div class="hpvp-hpvp-wrapper">
        <div class="hpvp-hpvp-left">
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

  const statSection = `
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

  const statusSection = `
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
          const lockTitle = isLocked
            ? (isDice ? `Roll d6 — recharges on ${rs.range}` : `Recharges after ${rs.type === 'SR' ? 'Short' : 'Long'} Rest`)
            : moveName;
          const rollBtn = isDice && isLocked
            ? `<button class="combat-dice-recharge-btn" data-move="${moveName}" data-combatant-id="${c.id}" title="Roll d6 to recharge">🎲 Roll</button>`
            : '';
          return `<div class="combat-move-row">
            <button class="combat-move-item ${isLocked ? 'move-locked' : ''}"
              data-move="${moveName}" data-combatant-id="${c.id}"
              ${isLocked ? 'disabled' : ''}
              title="${lockTitle}"
            >${moveName}${chargeText}</button>${rollBtn}</div>`;
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
      background: #1a1a2e;
      background-image: radial-gradient(circle at 1px 1px, rgba(255,255,255,0.04) 1px, transparent 0);
      background-size: 32px 32px;
      color: #e0e0e0;
      font-family: inherit;
      padding-bottom: 2rem;
    }
    .combat-header-bar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0.8rem 1rem;
      background: rgba(0,0,0,0.4);
      border-bottom: 1px solid rgba(255,255,255,0.08);
      position: sticky; top: 0; z-index: 10;
    }
    .combat-header-title { font-size: 1.2rem; font-weight: 700; color: #FFD700; text-transform: uppercase; letter-spacing: 1px; }
    .combat-round-label { font-size: 1rem; font-weight: 700; color: #a0a0c0; }
    .combat-back-btn {
      background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);
      color: #e0e0e0; padding: 0.4rem 0.8rem; border-radius: 6px; cursor: pointer; font-size: 0.9rem;
    }
    .combat-end-btn {
      background: linear-gradient(135deg, #c0392b, #922b21); border: none;
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
    .setup-pokemon-card img { width: 48px; height: 48px; object-fit: contain; }
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
    .combat-card-img { width: 60px; height: 60px; object-fit: contain; flex-shrink: 0; border-radius: 8px; background: rgba(255,255,255,0.04); }
    .combat-card-body { flex: 1; min-width: 0; }
    .combat-card-name-row { display: flex; align-items: center; flex-wrap: wrap; gap: 0.3rem; margin-bottom: 0.35rem; }
    .combat-card-name { font-weight: 700; font-size: 1rem; }
    .fainted-name { text-decoration: line-through; color: #888; }
    .combat-card-level { font-size: 0.78rem; color: #aaa; }
    .combat-initiative-badge { margin-left: auto; font-size: 0.72rem; color: #FFD700; font-weight: 600; }
    .combat-card-stats-group { background: rgba(255,255,255,0.04); border-radius: 6px; padding: 0.2rem 0.45rem; margin-bottom: 0.2rem; }
    .combat-card-ac-line { font-size: 0.76rem; color: #c0c0c0; margin-bottom: 0.18rem; }
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
    .status-remove-hint { font-size: 0.68rem; color: #888; }

    /* Moves */
    .expanded-moves-list { display: flex; flex-wrap: wrap; gap: 0.35rem; }
    .combat-move-row { display: flex; align-items: center; gap: 0.3rem; }
    .combat-move-item { padding: 0.3rem 0.7rem; border-radius: 14px; border: none; font-size: 0.78rem; font-weight: 600; cursor: pointer; transition: transform 0.1s; background: #888; color: #fff; }
    .combat-move-item:active { transform: scale(0.95); }
    .combat-move-item.move-locked { opacity: 0.4; cursor: not-allowed; background: #555 !important; color: #999 !important; }
    .combat-dice-recharge-btn { padding: 0.25rem 0.5rem; border-radius: 10px; border: 1px solid rgba(255,165,0,0.6); background: rgba(255,165,0,0.15); color: #FFA500; font-size: 0.74rem; font-weight: 700; cursor: pointer; transition: background 0.15s; white-space: nowrap; }
    .combat-dice-recharge-btn:hover { background: rgba(255,165,0,0.35); }

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
    .popup-content { background: linear-gradient(135deg,#2a2a2a,#1f1f1f); border: 3px solid #FFDE00; border-radius: 20px; padding: clamp(1.5rem,3vw,2.5rem); max-width: min(90vw,600px); max-height: 80vh; overflow-y: auto; position: relative; box-shadow: 0 15px 40px rgba(0,0,0,0.8); width: 92%; }
    .popup-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: clamp(1rem,2vh,1.5rem); padding-bottom: clamp(0.75rem,1.5vh,1rem); border-bottom: 2px solid #FFDE00; }
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
    .inventory-main { flex: 1; display: flex; flex-direction: column; padding: clamp(1rem,2.5vw,1.5rem); background: linear-gradient(135deg,#2a2a2a,#1f1f1f); overflow: hidden; }
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
    .hpvp-hpvp-wrapper { display: flex; align-items: stretch; gap: 0.4rem; }
    .hpvp-hpvp-left { flex: 1; min-width: 0; display: flex; flex-direction: row; align-items: stretch; gap: 0.2rem; }
    .hpvp-hpvp-rows { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .hpvp-hpvp-right { flex: 1; min-width: 0; }
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
  `;
}

// Evaluated once at module load — avoids re-building and re-parsing the stylesheet on every phase transition
const COMBAT_CSS = getCombatCSS();

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

function attachSetupListeners() {
  document.getElementById('combatBackBtn')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('navigate', { detail: { route: 'trainer-card' } }));
  });

  const startBtn = document.getElementById('startCombatBtn');

  document.querySelectorAll('.setup-pokemon-card').forEach(card => {
    card.addEventListener('click', () => {
      card.classList.toggle('selected');
      startBtn.disabled = document.querySelectorAll('.setup-pokemon-card.selected').length === 0;
    });
  });

  startBtn?.addEventListener('click', () => {
    loadCombatMoves();
    const selectedKeys = [...document.querySelectorAll('.setup-pokemon-card.selected')].map(el => el.dataset.pokemonKey);
    const combatants = [buildTrainerCombatant(), ...selectedKeys.map(k => buildPokemonCombatant(k))];
    saveCombatState({ phase: 'initiative', round: 1, activeTurnIndex: 0, combatants });
    const content = document.getElementById('content');
    content.innerHTML = renderCombat();
    attachCombatListeners();
  });
}

// ------------------------------ INITIATIVE ---------------------------------

function attachInitiativeListeners(state) {
  document.getElementById('combatBackBtn')?.addEventListener('click', () => {
    sessionStorage.removeItem('combatState');
    document.getElementById('content').innerHTML = renderCombat();
    attachCombatListeners();
  });

  document.querySelectorAll('.initiative-bonus-input').forEach(input => {
    input.addEventListener('input', () => recalcInitiativeTotal(input.id.replace('bonus_', ''), state));
  });

  document.getElementById('beginBattleBtn')?.addEventListener('click', () => {
    state.combatants.forEach(c => {
      c.initiativeBonus = parseInt(document.getElementById(`bonus_${c.id}`)?.value) || 0;
      c.initiativeTotal = c.initiativeScore + c.initiativeBonus;
    });
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

function attachBattleListeners(state) {
  _battleState = state;
  loadCombatMoves();
  initializeRechargeStates(state);

  document.getElementById('endCombatBtn')?.addEventListener('click', () => endCombat(state));

  const battleList = document.getElementById('battleList');
  if (battleList) {
    battleList.addEventListener('click', e => {
      if (e.target.closest('.end-turn-btn')) {
        endTurnForCombatant(e.target.closest('.end-turn-btn').dataset.combatantId, state);
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
        removeStatusEffect(badge.dataset.combatantId, badge.dataset.effect, state); return;
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
      const diceRechargeBtn = e.target.closest('.combat-dice-recharge-btn');
      if (diceRechargeBtn) {
        rollDiceRecharge(diceRechargeBtn.dataset.move, diceRechargeBtn.dataset.combatantId, state); return;
      }
      const moveItem = e.target.closest('.combat-move-item');
      if (moveItem && !moveItem.disabled) {
        showCombatMoveDetails(moveItem.dataset.move, moveItem.dataset.combatantId, state); return;
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

  // Move popup close
  document.getElementById('closeCombatMovePopup')?.addEventListener('click', () => {
    document.getElementById('combatMovePopup').style.display = 'none';
  });
  document.getElementById('combatMovePopup')?.addEventListener('click', e => {
    if (e.target.id === 'combatMovePopup') e.target.style.display = 'none';
  });

  // Confirm popup
  document.getElementById('confirmCombatMoveNo')?.addEventListener('click', () => {
    document.getElementById('combatMoveConfirmPopup').style.display = 'none';
  });
  document.getElementById('combatMoveConfirmPopup')?.addEventListener('click', e => {
    if (e.target.id === 'combatMoveConfirmPopup') e.target.style.display = 'none';
  });
  document.getElementById('confirmCombatMoveYes')?.addEventListener('click', () => {
    const btn = document.getElementById('useCombatMoveBtn');
    const vpCost = parseInt(btn?.dataset.vpCost) || 0;
    const combatantId = btn?.dataset.combatantId;
    const moveName = btn?.dataset.moveName;
    if (!combatantId) return;

    const c = state.combatants.find(x => x.id === combatantId);
    if (!c) return;

    // Deduct VP (overflow to HP)
    let newVp = c.currentVp - vpCost;
    let newHp = c.currentHp;
    if (newVp < 0) { newHp = Math.max(0, newHp + newVp); newVp = 0; }
    c.currentHp = newHp;
    c.currentVp = newVp;

    // Decrement recharge charges
    if (c.rechargeStates && c.rechargeStates[moveName]) {
      c.rechargeStates[moveName].chargesLeft = Math.max(0, c.rechargeStates[moveName].chargesLeft - 1);
    }

    saveCombatState(state);
    document.getElementById('combatMoveConfirmPopup').style.display = 'none';
    document.getElementById('combatMovePopup').style.display = 'none';
    rerenderBattle(state);
  });

  applyMoveColors();
}

function rerenderBattle(state) {
  const battleList = document.getElementById('battleList');
  if (!battleList) return;
  battleList.innerHTML = state.combatants.map((c, idx) => renderCombatCard(c, idx === state.activeTurnIndex)).join('');
  applyMoveColors();
}

function rollDiceRecharge(moveName, combatantId, state) {
  const c = state.combatants.find(x => x.id === combatantId);
  if (!c || !c.rechargeStates || !c.rechargeStates[moveName]) return;
  const rs = c.rechargeStates[moveName];
  const roll = Math.floor(Math.random() * 6) + 1;
  const [low, high] = rs.range.split('-').map(Number);
  if (roll >= low && roll <= high) {
    rs.chargesLeft = 1;
    saveCombatState(state);
    rerenderBattle(state);
    showToast(`Rolled ${roll} — ${moveName} recharged!`, 'success');
  } else {
    showToast(`Rolled ${roll} — ${moveName} did not recharge (needs ${rs.range}).`, 'warning');
  }
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
  if (btn.dataset.stat === 'hp') c.currentHp = Math.max(0, Math.min(c.currentHp + delta, c.maxHp));
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

function endTurnForCombatant(combatantId, state) {
  const c = state.combatants.find(x => x.id === combatantId);
  if (!c) return;

  const remaining = [];
  for (const se of c.statusEffects) {
    if (se.name === 'Poison' || se.name === 'Burn') {
      const dmg = c.proficiency;
      c.currentHp = Math.max(0, c.currentHp - dmg);
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

  // Advance to next living combatant
  const total = state.combatants.length;
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

  state.combatants.forEach((cc, idx) => { if (idx !== next) cc.isExpanded = false; });
  saveCombatState(state);
  rerenderBattle(state);
}

function addStatusEffect(combatantId, effectName, state, description = '') {
  const c = state.combatants.find(x => x.id === combatantId);
  if (!c || c.statusEffects.find(s => s.name === effectName)) return;
  const entry = { name: effectName, duration: -1 };
  if (description) entry.description = description;
  c.statusEffects.push(entry);
  saveCombatState(state);
  rerenderBattle(state);
}

function removeStatusEffect(combatantId, effectName, state) {
  const c = state.combatants.find(x => x.id === combatantId);
  if (!c) return;
  c.statusEffects = c.statusEffects.filter(s => s.name !== effectName);
  saveCombatState(state);
  rerenderBattle(state);
}

// ============================================================================
// MOVE POPUP
// ============================================================================

function showCombatMoveDetails(moveName, combatantId, state) {
  if (!_moves) { showToast('Move data not loaded.', 'warning'); return; }
  const move = _moveMap.get(moveName);
  if (!move) { showToast(`Move "${moveName}" not found.`, 'warning'); return; }

  const c = state.combatants.find(x => x.id === combatantId);
  if (!c) return;

  const trainerData = JSON.parse(sessionStorage.getItem('trainerData') || '[]');
  const trainerPath = trainerData[25] || '';
  const trainerLevel = parseInt(trainerData[2]) || 1;
  const specializationsStr = trainerData[24] || '';

  const { attackBonus, damageBonus, attackBreakdown, damageBreakdown, damageDice } = computeMoveData(
    move,
    {
      types: c.types || [],
      strMod: c.strMod, dexMod: c.dexMod, conMod: c.conMod,
      intMod: c.intMod, wisMod: c.wisMod, chaMod: c.chaMod,
      proficiency: c.proficiency,
      stabBonusValue: c.stabBonusValue || 2,
      level: c.level,
    },
    { path: trainerPath, level: trainerLevel, specializationsStr }
  );

  const bgColor = getMoveTypeColor(move[1]);
  const textColor = getTextColorForBackground(bgColor);

  const header = document.getElementById('combatMovePopupHeader');
  const body = document.getElementById('combatMovePopupBody');
  if (header) { header.style.backgroundColor = bgColor; header.style.color = textColor; }
  if (body) { body.style.backgroundColor = bgColor; body.style.color = textColor; }
  const closeBtn = header?.querySelector('.combat-popup-close');
  if (closeBtn) { closeBtn.style.color = textColor; }

  document.getElementById('combatMoveNamePopup').textContent = move[0];
  document.getElementById('combatMoveTypePopup').textContent = move[1];
  document.getElementById('cMoveModifier').textContent = move[2] || '—';
  document.getElementById('cMoveAction').textContent = move[3] || '—';
  document.getElementById('cMoveVP').textContent = move[4] || '0';
  document.getElementById('cMoveDuration').textContent = move[5] || '—';
  document.getElementById('cMoveRange').textContent = move[6] || '—';
  document.getElementById('cMoveSize').textContent = c.size || '—';
  const critModEl = document.getElementById('cMoveCritMod');
  if (critModEl) critModEl.textContent = c.critMod > 0 ? `+${c.critMod}` : c.critMod < 0 ? `${c.critMod}` : '0';
  document.getElementById('cMoveDescription').textContent = move[7] || '';
  const higherEl = document.getElementById('cMoveHigher');
  if (higherEl) higherEl.textContent = move[8] ? `Higher Levels: ${move[8]}` : '';
  document.getElementById('cAttackBonus').textContent = formatMod(attackBonus);
  document.getElementById('cAttackBreakdown').textContent = attackBreakdown;
  if (damageDice) {
    document.getElementById('cDamageBonus').textContent = damageBonus > 0 ? `${damageDice} + ${damageBonus}` : damageDice;
  } else {
    document.getElementById('cDamageBonus').textContent = damageBonus > 0 ? formatMod(damageBonus) : '—';
  }
  document.getElementById('cDamageBreakdown').textContent = damageBreakdown;

  // Held items
  const heldItemsEl = document.getElementById('cHeldItems');
  if (heldItemsEl) {
    const heldItemNames = (c.item || '').split(',').map(s => s.trim()).filter(Boolean);
    if (heldItemNames.length > 0) {
      const items = getCachedItems();
      heldItemsEl.innerHTML = '<strong>Held Items:</strong>' + heldItemNames.map(name => {
        const dbItem = items.find(i => i.name === name);
        return dbItem
          ? `<div style="margin-top:0.3rem;"><strong>${dbItem.name}:</strong> ${dbItem.effect || dbItem.description || 'No description'}</div>`
          : `<div style="margin-top:0.3rem;"><strong>${name}:</strong> No description available</div>`;
      }).join('');
      heldItemsEl.style.display = '';
    } else {
      heldItemsEl.style.display = 'none';
    }
  }

  // Trainer path sections
  _renderCombatBattleDice(trainerData, trainerPath);
  _renderCombatTactician(trainerData, trainerPath, trainerLevel);
  _renderCombatCommander(trainerData, trainerPath, trainerLevel);

  const vpCost = parseInt(move[4]) || 0;
  const useBtn = document.getElementById('useCombatMoveBtn');
  if (useBtn) {
    useBtn.dataset.vpCost = vpCost;
    useBtn.dataset.combatantId = combatantId;
    useBtn.dataset.moveName = moveName;
    useBtn.onclick = () => {
      document.getElementById('combatConfirmText').textContent = `Use ${moveName} (${vpCost} VP)?`;
      document.getElementById('combatMoveConfirmPopup').style.display = 'flex';
    };
  }

  document.getElementById('combatMovePopup').style.display = 'flex';
}

function _renderCombatBattleDice(trainerData, trainerPath) {
  const container = document.getElementById('cBattleDiceContainer');
  if (!container) return;
  if (trainerPath !== 'Ace Trainer') { container.innerHTML = ''; return; }

  const battleDiceData = trainerData[45] || '';
  let maxCharges = 0, currentCharges = 0;
  if (battleDiceData) {
    const parts = battleDiceData.split('-').map(p => p.trim());
    if (parts.length === 2) { maxCharges = parseInt(parts[0]) || 0; currentCharges = parseInt(parts[1]) || 0; }
  }

  let dotsHTML = '<div class="charge-dots">';
  for (let i = 0; i < maxCharges; i++) dotsHTML += `<span class="charge-dot ${i < currentCharges ? 'filled' : 'empty'}"></span>`;
  dotsHTML += '</div>';

  container.innerHTML = `
    <div class="battle-dice-container">
      <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:0.5rem;">
        <strong>Battle Dice (d6):</strong> ${dotsHTML}
      </div>
      <div style="display:flex;align-items:center;gap:0.8rem;justify-content:space-between;">
        <div style="font-size:0.85rem;opacity:0.9;">Add 1d6 to your next attack or damage roll</div>
        <button class="use-battle-dice-button" id="cUseBattleDiceBtn" ${currentCharges <= 0 ? 'disabled' : ''} style="flex-shrink:0;">Use Battle Dice</button>
      </div>
    </div>
  `;

  document.getElementById('cUseBattleDiceBtn')?.addEventListener('click', () => {
    if (currentCharges <= 0) return;
    currentCharges--;
    trainerData[45] = `${maxCharges} - ${currentCharges}`;
    sessionStorage.setItem('trainerData', JSON.stringify(trainerData));
    TrainerAPI.update(trainerData).catch(e => console.error('Battle dice sync:', e));
    const dots = container.querySelectorAll('.charge-dot');
    dots.forEach((dot, i) => { dot.classList.toggle('filled', i < currentCharges); dot.classList.toggle('empty', i >= currentCharges); });
    if (currentCharges <= 0) document.getElementById('cUseBattleDiceBtn').disabled = true;
    showToast('Battle Dice used! Roll 1d6 and add to attack or damage.', 'success');
  });
}

function _renderCombatTactician(trainerData, trainerPath, trainerLevel) {
  const container = document.getElementById('cTacticianContainer');
  if (!container) return;
  if (trainerPath !== 'Tactician' || trainerLevel < 5) { container.innerHTML = ''; return; }

  let currentTP = parseInt(trainerData[49], 10) || 0;
  const maxTP = parseInt(trainerData[2], 10) || 1;

  function buildTPDots(tp, max) {
    let html = '<div class="charge-dots" style="display:inline-flex;gap:clamp(0.3rem,0.6vw,0.5rem);">';
    for (let i = 0; i < max; i++) html += `<span class="tp-dot ${i < tp ? 'filled' : 'empty'}"></span>`;
    return html + '</div>';
  }

  function updateTP() {
    container.querySelectorAll('.tp-dot').forEach((dot, i) => {
      dot.classList.toggle('filled', i < currentTP); dot.classList.toggle('empty', i >= currentTP);
    });
    const empBtn = document.getElementById('cUseEmpoweredStrike');
    if (empBtn) empBtn.disabled = currentTP < 2;
    const shieldBtn = document.getElementById('cUseTacticalShield');
    if (shieldBtn) shieldBtn.disabled = currentTP < 1;
    const shieldInput = document.getElementById('cTacticalShieldInput');
    if (shieldInput) shieldInput.max = Math.min(3, currentTP);
    const pressBtn = document.getElementById('cUseTacticalPressure');
    if (pressBtn) pressBtn.disabled = currentTP < 1;
    const pressInput = document.getElementById('cTacticalPressureInput');
    if (pressInput) pressInput.max = Math.min(5, currentTP);
  }

  function spendTP(amount) {
    currentTP = Math.max(0, currentTP - amount);
    trainerData[49] = currentTP;
    sessionStorage.setItem('trainerData', JSON.stringify(trainerData));
    updateTP();
    TrainerAPI.update(trainerData).catch(e => console.error('Tactician TP sync:', e));
  }

  let abilitiesHTML = `
    <div class="tactician-ability">
      <div style="display:flex;align-items:center;gap:0.8rem;justify-content:space-between;">
        <div>
          <strong>Empowered Strike</strong> <span style="opacity:0.7;font-size:0.85rem;">(2 TP)</span>
          <div style="font-size:0.85rem;opacity:0.9;margin-top:0.2rem;">Roll damage dice twice, take the highest</div>
        </div>
        <button class="use-tactician-button" id="cUseEmpoweredStrike" ${currentTP < 2 ? 'disabled' : ''} style="flex-shrink:0;">Use</button>
      </div>
    </div>
  `;

  if (trainerLevel >= 9) {
    const shieldMax = Math.min(3, currentTP);
    abilitiesHTML += `
      <div class="tactician-ability">
        <div style="display:flex;align-items:center;gap:0.8rem;justify-content:space-between;">
          <div>
            <strong>Tactical Shield</strong> <span style="opacity:0.7;font-size:0.85rem;">(1-3 TP)</span>
            <div style="font-size:0.85rem;opacity:0.9;margin-top:0.2rem;">Reaction: Add to your Pokemon's AC</div>
          </div>
          <div style="display:flex;align-items:center;gap:0.5rem;flex-shrink:0;">
            <input type="number" class="tactician-input" id="cTacticalShieldInput" min="1" max="${shieldMax}" value="1" ${currentTP < 1 ? 'disabled' : ''}>
            <button class="use-tactician-button" id="cUseTacticalShield" ${currentTP < 1 ? 'disabled' : ''}>Use</button>
          </div>
        </div>
      </div>
    `;
  }

  if (trainerLevel >= 15) {
    const pressureMax = Math.min(5, currentTP);
    abilitiesHTML += `
      <div class="tactician-ability">
        <div style="display:flex;align-items:center;gap:0.8rem;justify-content:space-between;">
          <div>
            <strong>Tactical Pressure</strong> <span style="opacity:0.7;font-size:0.85rem;">(1-5 TP)</span>
            <div style="font-size:0.85rem;opacity:0.9;margin-top:0.2rem;">Increase move DC after opponent's save</div>
          </div>
          <div style="display:flex;align-items:center;gap:0.5rem;flex-shrink:0;">
            <input type="number" class="tactician-input" id="cTacticalPressureInput" min="1" max="${pressureMax}" value="1" ${currentTP < 1 ? 'disabled' : ''}>
            <button class="use-tactician-button" id="cUseTacticalPressure" ${currentTP < 1 ? 'disabled' : ''}>Use</button>
          </div>
        </div>
      </div>
    `;
  }

  container.innerHTML = `
    <div class="tactician-container">
      <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:0.6rem;">
        <strong>Tactician Points:</strong> ${buildTPDots(currentTP, maxTP)}
      </div>
      ${abilitiesHTML}
    </div>
  `;

  document.getElementById('cUseEmpoweredStrike')?.addEventListener('click', () => {
    if (currentTP >= 2) { spendTP(2); showToast('Empowered Strike! (2 TP) Roll damage dice twice and take the highest.', 'success'); }
  });
  document.getElementById('cUseTacticalShield')?.addEventListener('click', () => {
    const input = document.getElementById('cTacticalShieldInput');
    const amount = Math.max(1, Math.min(parseInt(input?.value, 10) || 1, 3, currentTP));
    if (currentTP >= amount) { spendTP(amount); showToast(`Tactical Shield! (${amount} TP) Add ${amount} to your Pokemon's AC for this attack.`, 'success'); }
  });
  document.getElementById('cUseTacticalPressure')?.addEventListener('click', () => {
    const input = document.getElementById('cTacticalPressureInput');
    const amount = Math.max(1, Math.min(parseInt(input?.value, 10) || 1, 5, currentTP));
    if (currentTP >= amount) { spendTP(amount); showToast(`Tactical Pressure! (${amount} TP) Increase the move's DC by ${amount}.`, 'success'); }
  });
}

function _renderCombatCommander(trainerData, trainerPath, trainerLevel) {
  const container = document.getElementById('cCommanderContainer');
  if (!container) return;
  if (trainerPath !== 'Commander' || trainerLevel < 9) { container.innerHTML = ''; return; }

  const surgeData = trainerData[50] || '1 - 1';
  const surgeParts = surgeData.split('-').map(p => p.trim());
  let surgeMax = parseInt(surgeParts[0], 10) || 1;
  let surgeCurrent = parseInt(surgeParts[1], 10) || 0;

  const chaModifier = parseInt(trainerData[32], 10) || 0;
  const rallyMaxCalc = Math.max(1, 1 + chaModifier);
  const rallyData = trainerData[51] || `${rallyMaxCalc} - ${rallyMaxCalc}`;
  const rallyParts = rallyData.split('-').map(p => p.trim());
  let rallyMax = parseInt(rallyParts[0], 10) || rallyMaxCalc;
  let rallyCurrent = parseInt(rallyParts[1], 10) || 0;

  function buildDots(current, max, cls) {
    let html = `<div class="${cls} charge-dots" style="display:inline-flex;gap:clamp(0.3rem,0.6vw,0.5rem);">`;
    for (let i = 0; i < max; i++) html += `<span class="commander-dot ${i < current ? 'filled' : 'empty'}"></span>`;
    return html + '</div>';
  }

  function updateCommanderUI() {
    container.querySelectorAll('.surge-dots .commander-dot').forEach((dot, i) => {
      dot.classList.toggle('filled', i < surgeCurrent); dot.classList.toggle('empty', i >= surgeCurrent);
    });
    const surgeBtn = document.getElementById('cUseSurgeCommand');
    if (surgeBtn) surgeBtn.disabled = surgeCurrent <= 0;
    container.querySelectorAll('.rally-dots .commander-dot').forEach((dot, i) => {
      dot.classList.toggle('filled', i < rallyCurrent); dot.classList.toggle('empty', i >= rallyCurrent);
    });
    const rallyBtn = document.getElementById('cUseRallyCry');
    if (rallyBtn) rallyBtn.disabled = rallyCurrent <= 0;
  }

  let commanderHTML = `
    <div class="commander-ability">
      <div style="display:flex;align-items:center;gap:0.8rem;justify-content:space-between;">
        <div>
          <strong>Show Me What You've Got</strong>
          <div style="font-size:0.85rem;opacity:0.9;margin-top:0.2rem;">Activate a move from one damage tier above</div>
        </div>
        <div style="display:flex;align-items:center;gap:0.5rem;flex-shrink:0;">
          ${buildDots(surgeCurrent, surgeMax, 'surge-dots')}
          <button class="use-commander-button" id="cUseSurgeCommand" ${surgeCurrent <= 0 ? 'disabled' : ''}>Use</button>
        </div>
      </div>
    </div>
  `;

  if (trainerLevel >= 15) {
    commanderHTML += `
      <div class="commander-ability">
        <div style="display:flex;align-items:center;gap:0.8rem;justify-content:space-between;">
          <div>
            <strong>We're a Team</strong>
            <div style="font-size:0.85rem;opacity:0.9;margin-top:0.2rem;">Your Pokemon and allies gain advantage on attacks until end of next turn</div>
          </div>
          <div style="display:flex;align-items:center;gap:0.5rem;flex-shrink:0;">
            ${buildDots(rallyCurrent, rallyMax, 'rally-dots')}
            <button class="use-commander-button" id="cUseRallyCry" ${rallyCurrent <= 0 ? 'disabled' : ''}>Use</button>
          </div>
        </div>
      </div>
    `;
  }

  container.innerHTML = `<div class="commander-container">${commanderHTML}</div>`;

  document.getElementById('cUseSurgeCommand')?.addEventListener('click', () => {
    if (surgeCurrent <= 0) return;
    surgeCurrent--;
    trainerData[50] = `${surgeMax} - ${surgeCurrent}`;
    sessionStorage.setItem('trainerData', JSON.stringify(trainerData));
    TrainerAPI.update(trainerData).catch(e => console.error('Surge sync:', e));
    updateCommanderUI();
    showToast("Show Me What You've Got! Activate a move from one damage tier above.", 'success');
  });
  document.getElementById('cUseRallyCry')?.addEventListener('click', () => {
    if (rallyCurrent <= 0) return;
    rallyCurrent--;
    trainerData[51] = `${rallyMax} - ${rallyCurrent}`;
    sessionStorage.setItem('trainerData', JSON.stringify(trainerData));
    TrainerAPI.update(trainerData).catch(e => console.error('Rally sync:', e));
    updateCommanderUI();
    showToast("We're a Team! Allies gain advantage on attacks until end of next turn.", 'success');
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
  const items = (td[20] || '').split(',').map(s => s.trim()).filter(Boolean);
  const idx = items.findIndex(s => {
    const m = s.match(/^(.+?)\s*\(x\d+\)$/);
    return (m ? m[1].trim() : s) === itemName;
  });
  if (idx === -1) return;
  const m = items[idx].match(/^(.+?)\s*\(x(\d+)\)$/);
  const qty = m ? parseInt(m[2]) : 1;
  if (qty <= 1) items.splice(idx, 1);
  else items[idx] = `${itemName} (x${qty - 1})`;
  td[20] = items.join(', ');
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

  // Result display + type button click handlers
  const resultEl = document.getElementById('typeCalcResult');
  resultEl.className = 'type-calc-result';
  resultEl.textContent = '';

  const popup = document.getElementById('combatTypeCalcPopup');
  popup.querySelectorAll('.combat-type-button').forEach(btn => {
    btn.addEventListener('click', () => {
      popup.querySelectorAll('.combat-type-button').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      const v = multMap[btn.dataset.type] ?? 1;
      if (v === 0) { resultEl.textContent = '0× — Immune!'; resultEl.className = 'type-calc-result type-calc-immune show'; }
      else if (v < 1) { resultEl.textContent = `${v}× — Not very effective`; resultEl.className = 'type-calc-result type-calc-resist show'; }
      else if (v > 1) { resultEl.textContent = `${v}× — Super effective!`; resultEl.className = 'type-calc-result type-calc-weak show'; }
      else { resultEl.textContent = '1× — Normal damage'; resultEl.className = 'type-calc-result type-calc-neutral show'; }
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
    if (hpAmt > 0) c.currentHp = Math.max(0, c.currentHp - hpAmt);
    if (vpAmt > 0) c.currentVp = Math.max(0, c.currentVp - vpAmt);
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

  if (!inventory || !itemsStr) {
    categoriesEl.innerHTML = '<li style="padding:1rem;color:#999;text-align:center;">No items in inventory</li>';
    document.getElementById('combatInventoryPopup').style.display = 'flex';
    return;
  }

  const itemsData = JSON.parse(itemsStr);
  const groupedItems = {};
  inventory.split(',').map(s => s.trim()).filter(Boolean).forEach(s => {
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

  for (const c of state.combatants) {
    if (c.type === 'trainer') {
      trainerData[34] = c.currentHp;
      trainerData[35] = c.currentVp;
      sessionStorage.setItem('trainerData', JSON.stringify(trainerData));
      TrainerAPI.update(trainerData).catch(e => console.error('Trainer sync:', e));

    } else if (c.type === 'pokemon') {
      const pokemonData = JSON.parse(sessionStorage.getItem(c.entityKey) || '[]');
      const pokemonName = pokemonData[2];
      pokemonData[45] = c.currentHp;
      pokemonData[46] = c.currentVp;

      // Save KnownMoves (recharge tracking)
      const knownMovesStr = buildKnownMovesString(c.rechargeStates || {});
      pokemonData[59] = knownMovesStr;

      // Save StatusCondition (active status effects)
      const statusCondStr = c.statusEffects.map(s => s.name).join(',');
      pokemonData[60] = statusCondStr;

      sessionStorage.setItem(c.entityKey, JSON.stringify(pokemonData));

      // Sync to API
      PokemonAPI.updateLiveStats(trainerName, pokemonName, 'HP', c.currentHp).catch(e => console.error('HP sync:', e));
      PokemonAPI.updateLiveStats(trainerName, pokemonName, 'VP', c.currentVp).catch(e => console.error('VP sync:', e));
      if (knownMovesStr) PokemonAPI.updateLiveStats(trainerName, pokemonName, 'KnownMoves', knownMovesStr).catch(e => console.error('KnownMoves sync:', e));
      if (statusCondStr) PokemonAPI.updateLiveStats(trainerName, pokemonName, 'StatusCondition', statusCondStr).catch(e => console.error('StatusCondition sync:', e));
    }
  }

  sessionStorage.removeItem('combatState');
  window.dispatchEvent(new CustomEvent('navigate', { detail: { route: 'trainer-card' } }));
}
