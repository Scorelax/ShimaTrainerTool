// Combat Page — Full encounter tracker with initiative, status effects, and move integration

import { PokemonAPI, TrainerAPI } from '../api.js';
import { showToast } from '../utils/notifications.js';

// ============================================================================
// MOVE TYPE HELPERS
// ============================================================================

function getMoveTypeColor(moveType) {
  const colors = {
    "Normal": "#A8A878", "Fighting": "#e68c2e", "Flying": "#A890F0",
    "Poison": "#A040A0", "Ground": "#A67C52", "Rock": "#a85d16",
    "Bug": "#A8B820", "Ghost": "#705898", "Steel": "#bdbdbd",
    "Fire": "#f02e07", "Water": "#1E90FF", "Grass": "#32CD32",
    "Electric": "#FFD700", "Psychic": "#F85888", "Ice": "#58c8ed",
    "Dragon": "#280dd4", "Dark": "#282729", "Fairy": "#ed919f",
    "Cosmic": "#120077"
  };
  return colors[moveType] || "#ffffff";
}

function getTextColorForBackground(bgColor) {
  const hex = bgColor.replace('#', '');
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#000000' : '#ffffff';
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
  if (window.allMoves) return;
  const rawMovesData = sessionStorage.getItem('moves');
  if (!rawMovesData) return;
  try {
    const clean = JSON.parse(rawMovesData.replace(/\\"/g, '"').replace(/\\r/g, '').replace(/\\n/g, ''));
    window.allMoves = clean.map(move => move.map(item => (typeof item === 'string' ? item.trim() : item)));
  } catch (e) {
    console.error('Failed to parse moves data:', e);
  }
}

/**
 * Parse the action type string for recharge info.
 * e.g. "1 action, recharge (short rest)" → { maxCharges: 1, type: 'SR' }
 *      "1 action, 2 charges, recharge (short rest)" → { maxCharges: 2, type: 'SR' }
 *      "1 action, recharge (long rest)" → { maxCharges: 1, type: 'LR' }
 * Returns null if no recharge.
 */
function parseRecharge(actionType) {
  if (!actionType) return null;
  const lower = actionType.toLowerCase();
  if (!lower.includes('recharge')) return null;

  const rechargeMatch = lower.match(/recharge\s*\(([^)]+)\)/);
  if (!rechargeMatch) return null;

  const rechargeText = rechargeMatch[1];
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
 * Only includes moves that actually have recharge mechanics.
 */
function buildKnownMovesString(rechargeStates) {
  return Object.entries(rechargeStates)
    .map(([name, s]) => `${name}(${s.chargesLeft})(${s.type})`)
    .join(',');
}

/**
 * After allMoves is loaded, fill in any missing recharge states for pokemon combatants.
 * Called at the start of the battle phase.
 */
function initializeRechargeStates(state) {
  if (!window.allMoves) return;
  state.combatants.forEach(c => {
    if (c.type !== 'pokemon') return;
    if (!c.rechargeStates) c.rechargeStates = {};
    c.moves.forEach(moveName => {
      if (c.rechargeStates[moveName] !== undefined) return;
      const moveData = window.allMoves.find(m => m[0] === moveName);
      if (!moveData) return;
      const recharge = parseRecharge(moveData[3] || '');
      if (!recharge) return;
      c.rechargeStates[moveName] = { chargesLeft: recharge.maxCharges, maxCharges: recharge.maxCharges, type: recharge.type };
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

  const trainerAlertBonus = (trainerData[33] || '').split(',').some(f => f.trim() === 'Alert') ? 5 : 0;

  return {
    id: 'trainer', type: 'trainer', entityKey: 'trainerData',
    name: trainerData[1] || 'Trainer',
    image: trainerData[0] || 'assets/Pokeball.png',
    level, initiativeScore: dexMod, initiativeRoll: 0, initiativeBonus: trainerAlertBonus, initiativeTotal: dexMod + trainerAlertBonus,
    ac, maxHp, currentHp, maxVp, currentVp,
    proficiency: computeProficiency(level),
    str, dex, con, int: int_, wis, cha,
    strMod, dexMod, conMod, intMod, wisMod, chaMod,
    moves: [], types: [], rechargeStates: {},
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
  if (window.allMoves) {
    moves.forEach(moveName => {
      const moveData = window.allMoves.find(m => m[0] === moveName);
      if (!moveData) return;
      const recharge = parseRecharge(moveData[3] || '');
      if (!recharge) return;
      if (existingRecharges[moveName] !== undefined) {
        rechargeStates[moveName] = { chargesLeft: existingRecharges[moveName].chargesLeft, maxCharges: recharge.maxCharges, type: recharge.type };
      } else {
        rechargeStates[moveName] = { chargesLeft: recharge.maxCharges, maxCharges: recharge.maxCharges, type: recharge.type };
      }
    });
  }

  const pokemonAlertBonus = (pokemonData[50] || '').split(',').some(f => f.trim() === 'Alert') ? 5 : 0;

  return {
    id: pokemonKey, type: 'pokemon', entityKey: pokemonKey,
    name: pokemonData[36] || pokemonData[2] || 'Pokemon',
    image: pokemonData[1] || 'assets/Pokeball.png',
    level, initiativeScore: initiative, initiativeRoll: 0, initiativeBonus: pokemonAlertBonus, initiativeTotal: initiative + pokemonAlertBonus,
    ac: parseInt(pokemonData[8]) || 10,
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
      <style>${getCombatCSS()}</style>
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
        <span class="initiative-plus">Bonus:</span>
        <input type="number" class="initiative-bonus-input" id="bonus_${c.id}" value="${c.initiativeBonus}" placeholder="0" min="-20" max="20">
        <span class="initiative-equals">= <strong id="total_${c.id}">${c.initiativeTotal}</strong></span>
      </div>
    </div>`).join('');

  return `
    <div class="combat-page">
      <style>${getCombatCSS()}</style>
      <div class="combat-header-bar">
        <button class="combat-back-btn" id="combatBackBtn">← Setup</button>
        <div class="combat-header-title">⚔️ Initiative</div>
        <div></div>
      </div>
      <div class="initiative-container">
        <p class="initiative-instructions">Roll your d20 manually. Each participant's base initiative is pre-filled (Alert feat adds +5 automatically). Adjust the bonus field for any extra modifiers.</p>
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
      <style>${getCombatCSS()}</style>
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

  const statusBadges = c.statusEffects.map(se => {
    const dur = se.duration === -1 ? '' : ` (${se.duration})`;
    return `<span class="status-badge status-${se.name.toLowerCase()}" data-combatant-id="${c.id}" data-effect="${se.name}">${se.name}${dur}</span>`;
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
          <div class="combat-card-ac-row">
            <span>AC: <strong>${c.ac}</strong></span>
          </div>
          <div class="combat-card-stats-row">
            <span class="stat-bar-wrap">HP: <strong>${c.currentHp}/${c.maxHp}</strong>
              <div class="mini-bar"><div class="mini-bar-fill hp-bar" style="width:${hpPct}%"></div></div>
            </span>
            <span class="stat-bar-wrap">VP: <strong>${c.currentVp}/${c.maxVp}</strong>
              <div class="mini-bar"><div class="mini-bar-fill vp-bar" style="width:${vpPct}%"></div></div>
            </span>
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
  const items = JSON.parse(sessionStorage.getItem('items') || '[]');
  const dbItem = items.find(it => it.name === itemName);
  const desc = dbItem ? (dbItem.effect || dbItem.description || '') : '';
  return `<strong>${itemName}</strong>${desc ? `<span class="item-desc">: ${desc}</span>` : ''}`;
}

function renderExpandedSection(c, statusBadges) {
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
  const hpvpSection = `
    <div class="expanded-hpvp-section">
      <div class="expanded-section-label">Adjust HP / VP</div>
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
        <div class="stat-adjust-item">
          <div class="stat-adjust-name">AC <small>&nbsp;</small></div>
          <div class="stat-adjust-controls">
            <button class="stat-delta-btn" data-combatant-id="${c.id}" data-stat="ac" data-delta="-1">−</button>
            <input type="number" class="stat-adjust-val" value="${c.ac}" data-combatant-id="${c.id}" data-stat="ac">
            <button class="stat-delta-btn" data-combatant-id="${c.id}" data-stat="ac" data-delta="1">+</button>
          </div>
        </div>
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
      <div class="add-status-btns">${addStatusBtns}</div>
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
          const chargeText = rs ? ` (${rs.chargesLeft}/${rs.maxCharges} ${rs.type})` : '';
          return `<button class="combat-move-item ${isLocked ? 'move-locked' : ''}"
            data-move="${moveName}" data-combatant-id="${c.id}"
            ${isLocked ? 'disabled' : ''}
            title="${isLocked ? `Recharges after ${rs.type === 'SR' ? 'Short' : 'Long'} Rest` : moveName}"
          >${moveName}${chargeText}</button>`;
        }).join('')}
      </div>
    </div>` : '';

  return `
    <div class="combat-card-expanded" id="expanded_${c.id}">
      ${infoSection}
      ${hpvpSection}
      ${statSection}
      ${statusSection}
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
    .combat-card-ac-row { font-size: 0.82rem; margin-bottom: 0.15rem; }
    .combat-card-stats-row { display: flex; flex-wrap: wrap; gap: 0.5rem; font-size: 0.82rem; margin-bottom: 0.2rem; }
    .combat-mods-row { font-size: 0.78rem; color: #c0c0c0; gap: 0.4rem; }
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
    .hpvp-btn { width: 26px; height: 26px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: #e0e0e0; border-radius: 6px; cursor: pointer; font-size: 1.1rem; display: flex; align-items: center; justify-content: center; }
    .hpvp-input { width: 52px; padding: 0.22rem; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; color: #e0e0e0; text-align: center; font-size: 0.9rem; }
    .hpvp-max { font-size: 0.82rem; color: #aaa; }

    /* Stat adjusters */
    .stat-adjust-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.4rem; }
    @media (max-width: 480px) { .stat-adjust-grid { grid-template-columns: repeat(2, 1fr); } }
    .stat-adjust-item { background: rgba(255,255,255,0.04); border-radius: 6px; padding: 0.35rem 0.4rem; }
    .stat-adjust-name { font-size: 0.72rem; font-weight: 700; color: #ccc; margin-bottom: 0.2rem; }
    .stat-adjust-name small { color: #888; font-weight: 400; }
    .stat-adjust-controls { display: flex; align-items: center; gap: 0.3rem; }
    .stat-delta-btn { width: 22px; height: 22px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); color: #e0e0e0; border-radius: 4px; cursor: pointer; font-size: 1rem; display: flex; align-items: center; justify-content: center; padding: 0; line-height: 1; }
    .stat-adjust-val { width: 42px; padding: 0.18rem; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); border-radius: 4px; color: #e0e0e0; text-align: center; font-size: 0.82rem; }

    /* Status */
    .add-status-btns { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-bottom: 0.3rem; }
    .add-status-btn { padding: 0.22rem 0.55rem; font-size: 0.75rem; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); color: #e0e0e0; border-radius: 12px; cursor: pointer; }
    .status-remove-hint { font-size: 0.68rem; color: #888; }

    /* Moves */
    .expanded-moves-list { display: flex; flex-wrap: wrap; gap: 0.35rem; }
    .combat-move-item { padding: 0.3rem 0.7rem; border-radius: 14px; border: none; font-size: 0.78rem; font-weight: 600; cursor: pointer; transition: transform 0.1s; background: #888; color: #fff; }
    .combat-move-item:active { transform: scale(0.95); }
    .combat-move-item.move-locked { opacity: 0.4; cursor: not-allowed; background: #555 !important; color: #999 !important; }

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
    .combat-move-higher { font-size: 0.82rem; color: #aaa; margin-bottom: 0.8rem; }
    .combat-move-rolls-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; background: rgba(255,255,255,0.05); border-radius: 8px; padding: 0.7rem; margin-bottom: 1rem; font-size: 0.88rem; }
    .combat-roll-bonus { font-size: 1.15em; font-weight: bold; }
    .combat-roll-breakdown { font-size: 0.75em; color: #aaa; margin-top: 0.2rem; }
    .combat-use-move-btn { width: 100%; padding: 0.75rem; background: linear-gradient(135deg, #4CAF50, #45A049); color: #fff; border: none; border-radius: 8px; font-size: 1rem; font-weight: 700; cursor: pointer; }

    /* TYPE BADGES */
    .type-badge { padding: 1px 7px; border-radius: 10px; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; }
    .type-normal{background:#A8A878;color:#000}.type-fighting{background:#e68c2e;color:#000}.type-flying{background:#A890F0;color:#000}
    .type-poison{background:#A040A0;color:#fff}.type-ground{background:#A67C52;color:#fff}.type-rock{background:#a85d16;color:#fff}
    .type-bug{background:#A8B820;color:#000}.type-ghost{background:#705898;color:#fff}.type-steel{background:#bdbdbd;color:#000}
    .type-fire{background:#f02e07;color:#fff}.type-water{background:#1E90FF;color:#fff}.type-grass{background:#32CD32;color:#000}
    .type-electric{background:#FFD700;color:#000}.type-psychic{background:#F85888;color:#fff}.type-ice{background:#58c8ed;color:#000}
    .type-dragon{background:#280dd4;color:#fff}.type-dark{background:#282729;color:#fff}.type-fairy{background:#ed919f;color:#000}
    .type-cosmic{background:#120077;color:#fff}
  `;
}

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
      if (e.target.closest('.add-status-btn')) {
        const btn = e.target.closest('.add-status-btn');
        addStatusEffect(btn.dataset.combatantId, btn.dataset.effect, state); return;
      }
      if (e.target.closest('.status-badge')) {
        const badge = e.target.closest('.status-badge');
        removeStatusEffect(badge.dataset.combatantId, badge.dataset.effect, state); return;
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
        saveCombatState(state); rerenderBattle(state); return;
      }
      // Direct number input for stats
      const statInput = e.target.closest('.stat-adjust-val');
      if (statInput) {
        updateCombatantStat(statInput.dataset.combatantId, statInput.dataset.stat, 0, state, parseInt(statInput.value) || 0);
      }
    });
  }

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

function applyMoveColors() {
  if (!window.allMoves) return;
  document.querySelectorAll('.combat-move-item:not(.move-locked)').forEach(item => {
    const move = window.allMoves.find(m => m[0] === item.dataset.move);
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
  if (wrapped) { state.round++; showToast(`Round ${state.round} begins!`, 'info'); }
  state.activeTurnIndex = next;

  state.combatants.forEach((cc, idx) => { if (idx !== next) cc.isExpanded = false; });
  saveCombatState(state);
  rerenderBattle(state);
}

function addStatusEffect(combatantId, effectName, state) {
  const c = state.combatants.find(x => x.id === combatantId);
  if (!c || c.statusEffects.find(s => s.name === effectName)) return;
  c.statusEffects.push({ name: effectName, duration: -1 });
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
  if (!window.allMoves) { showToast('Move data not loaded.', 'warning'); return; }
  const move = window.allMoves.find(m => m[0] === moveName);
  if (!move) { showToast(`Move "${moveName}" not found.`, 'warning'); return; }

  const c = state.combatants.find(x => x.id === combatantId);
  if (!c) return;

  const trainerData = JSON.parse(sessionStorage.getItem('trainerData') || '[]');
  const trainerPath = trainerData[25] || '';
  const trainerLevel = parseInt(trainerData[2]) || 1;
  const specializationsStr = trainerData[24] || '';

  const moveType = move[1];
  const pokemonTypes = c.types || [];
  let hasSTAB = pokemonTypes.includes(moveType);

  const specializationToType = {
    'Bird Keeper':'Flying','Bug Maniac':'Bug','Camper':'Ground','Dragon Tamer':'Dragon','Engineer':'Electric',
    'Pyromaniac':'Fire','Gardener':'Grass','Martial Artist':'Fighting','Mountaineer':'Rock','Mystic':'Ghost',
    'Steel Worker':'Steel','Psychic':'Psychic','Swimmer':'Water','Charmer':'Fairy','Shadow':'Dark',
    'Alchemist':'Poison','Team Player':'Normal','Ice Skater':'Ice'
  };

  if (!hasSTAB && trainerPath === 'Type Master' && trainerLevel >= 15 && specializationsStr) {
    const specTypes = specializationsStr.split(',').map(s => specializationToType[s.trim()]).filter(Boolean);
    if (pokemonTypes.some(pt => specTypes.includes(pt))) hasSTAB = true;
  }

  let typeMasterDamageBonus = 0, typeMasterAttackBonus = 0;
  if (trainerPath === 'Type Master' && trainerLevel >= 3 && specializationsStr) {
    const specTypes = specializationsStr.split(',').map(s => specializationToType[s.trim()]).filter(Boolean);
    if (specTypes.includes(moveType)) pokemonTypes.forEach(pt => { if (specTypes.includes(pt)) typeMasterDamageBonus++; });
    if (trainerLevel >= 5 && pokemonTypes.some(pt => specTypes.includes(pt))) typeMasterAttackBonus = 2;
  }

  const aceBonus = (trainerPath === 'Ace Trainer' && trainerLevel >= 3) ? 1 : 0;
  const modMap = { STR: c.strMod, DEX: c.dexMod, CON: c.conMod, INT: c.intMod, WIS: c.wisMod, CHA: c.chaMod };
  const moveModifiers = (move[2] || '').split('/').map(m => m.trim().toUpperCase());
  const allowedMods = moveModifiers.map(m => modMap[m]).filter(v => v !== undefined);
  const highestMod = allowedMods.length > 0 ? Math.max(...allowedMods) : 0;
  const usedStat = moveModifiers.find(m => modMap[m] === highestMod) || '';

  const profBonus = hasSTAB ? c.proficiency : 0;
  const attackBonus = profBonus + highestMod + aceBonus + typeMasterAttackBonus;
  const desc = move[7] || '';
  const includeStatInDmg = /\+\s*MOVE/i.test(desc);
  const stabBonus = hasSTAB ? (c.stabBonusValue || 2) : 0;
  const damageBonus = stabBonus + (includeStatInDmg ? highestMod : 0) + aceBonus + typeMasterDamageBonus;

  const atkParts = [];
  if (profBonus > 0) atkParts.push(`Proficiency +${profBonus}`);
  if (highestMod !== 0) atkParts.push(`${usedStat} ${formatMod(highestMod)}`);
  if (aceBonus > 0) atkParts.push(`Ace Trainer +${aceBonus}`);
  if (typeMasterAttackBonus > 0) atkParts.push(`Type Master +${typeMasterAttackBonus}`);

  const dmgParts = [];
  if (stabBonus > 0) dmgParts.push(`STAB +${stabBonus}`);
  if (includeStatInDmg && highestMod !== 0) dmgParts.push(`${usedStat} ${formatMod(highestMod)}`);
  if (aceBonus > 0) dmgParts.push(`Ace Trainer +${aceBonus}`);
  if (typeMasterDamageBonus > 0) dmgParts.push(`Type Master +${typeMasterDamageBonus}`);

  const bgColor = getMoveTypeColor(moveType);
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
  document.getElementById('cMoveDescription').textContent = desc;
  const higherEl = document.getElementById('cMoveHigher');
  if (higherEl) higherEl.textContent = move[8] ? `Higher Levels: ${move[8]}` : '';
  document.getElementById('cAttackBonus').textContent = formatMod(attackBonus);
  document.getElementById('cAttackBreakdown').textContent = atkParts.length ? `(${atkParts.join(', ')})` : '';
  document.getElementById('cDamageBonus').textContent = formatMod(damageBonus);
  document.getElementById('cDamageBreakdown').textContent = dmgParts.length ? `(${dmgParts.join(', ')})` : '';

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
