// Combat Page — Full encounter tracker with initiative, status effects, and move integration

import { PokemonAPI, TrainerAPI } from '../api.js';
import { showToast } from '../utils/notifications.js';

// ============================================================================
// HELPER FUNCTIONS
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

  return {
    id: 'trainer',
    type: 'trainer',
    entityKey: 'trainerData',
    name: trainerData[1] || 'Trainer',
    image: trainerData[0] || 'assets/Pokeball.png',
    level,
    initiativeScore: dexMod,
    initiativeRoll: 0,
    initiativeBonus: 0,
    initiativeTotal: 0,
    ac,
    maxHp, currentHp,
    maxVp, currentVp,
    proficiency: computeProficiency(level),
    str, dex, con, int: int_, wis, cha,
    strMod, dexMod, conMod, intMod, wisMod, chaMod,
    moves: [],
    types: [],
    statusEffects: [],
    isExpanded: false
  };
}

function buildPokemonCombatant(pokemonKey) {
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

  // Parse learned moves based on level
  const moveIndices = [23, 24, 25, 26, 27, 28, 37];
  const requiredLevels = [1, 2, 6, 10, 14, 18, 0];
  const moves = [];
  moveIndices.forEach((idx, i) => {
    if (level >= requiredLevels[i] || (idx === 37 && pokemonData[idx])) {
      const movesAtIndex = pokemonData[idx] || '';
      if (movesAtIndex) {
        movesAtIndex.split(',').map(m => m.trim()).filter(m => m).forEach(m => moves.push(m));
      }
    }
  });

  const nickname = pokemonData[36] || '';
  const displayName = nickname || pokemonData[2] || 'Pokemon';

  return {
    id: pokemonKey,
    type: 'pokemon',
    entityKey: pokemonKey,
    name: displayName,
    image: pokemonData[1] || 'assets/Pokeball.png',
    level,
    initiativeScore: initiative,
    initiativeRoll: 0,
    initiativeBonus: 0,
    initiativeTotal: 0,
    ac: parseInt(pokemonData[8]) || 10,
    maxHp, currentHp,
    maxVp, currentVp,
    proficiency,
    stabBonusValue: parseInt(pokemonData[34]) || 2,
    str, dex, con, int: int_, wis, cha,
    strMod, dexMod, conMod, intMod, wisMod, chaMod,
    moves,
    types: [pokemonData[5], pokemonData[6]].filter(t => t),
    statusEffects: [],
    isExpanded: false
  };
}

// ============================================================================
// SESSION STATE HELPERS
// ============================================================================

function getCombatState() {
  const raw = sessionStorage.getItem('combatState');
  return raw ? JSON.parse(raw) : null;
}

function saveCombatState(state) {
  sessionStorage.setItem('combatState', JSON.stringify(state));
}

// ============================================================================
// RENDER
// ============================================================================

export function renderCombat() {
  const state = getCombatState();
  const phase = state ? state.phase : 'setup';

  if (phase === 'initiative') {
    return renderInitiativePhase(state);
  } else if (phase === 'battle') {
    return renderBattlePhase(state);
  } else {
    return renderSetupPhase();
  }
}

// -------------------------------- SETUP PHASE --------------------------------

function renderSetupPhase() {
  const trainerData = JSON.parse(sessionStorage.getItem('trainerData') || '[]');
  const trainerName = trainerData[1] || 'Trainer';
  const trainerImage = trainerData[0] || 'assets/Pokeball.png';
  const trainerLevel = parseInt(trainerData[2]) || 1;

  // Gather party pokemon
  const partyPokemon = [];
  for (const key of Object.keys(sessionStorage)) {
    if (!key.startsWith('pokemon_')) continue;
    const pData = JSON.parse(sessionStorage.getItem(key));
    const slot = parseInt(pData[38], 10);
    if (slot && slot >= 1 && slot <= 6) {
      const nickname = pData[36] || '';
      partyPokemon.push({
        key,
        name: nickname || pData[2] || 'Unknown',
        image: pData[1] || 'assets/Pokeball.png',
        level: parseInt(pData[4]) || 1,
        types: [pData[5], pData[6]].filter(t => t)
      });
    }
  }
  partyPokemon.sort((a, b) => {
    const sa = parseInt(JSON.parse(sessionStorage.getItem(a.key))[38]) || 99;
    const sb = parseInt(JSON.parse(sessionStorage.getItem(b.key))[38]) || 99;
    return sa - sb;
  });

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

        <button class="combat-start-btn" id="startCombatBtn" disabled>
          Start Combat →
        </button>
      </div>
    </div>
  `;
}

// ------------------------------ INITIATIVE PHASE ----------------------------

function renderInitiativePhase(state) {
  const rows = state.combatants.map(c => `
    <div class="initiative-row" data-combatant-id="${c.id}">
      <img src="${c.image}" alt="${c.name}" class="initiative-img" onerror="this.src='assets/Pokeball.png'">
      <div class="initiative-info">
        <div class="initiative-name">${c.name} <span class="initiative-level">Lv ${c.level}</span></div>
        <div class="initiative-score-label">Initiative Score: <strong>${c.initiativeScore}</strong></div>
      </div>
      <div class="initiative-roll-group">
        <button class="initiative-roll-btn" data-combatant-id="${c.id}">Roll</button>
        <input type="number" class="initiative-roll-input" id="roll_${c.id}"
               value="${c.initiativeRoll}" placeholder="d20" readonly>
        <span class="initiative-plus">+</span>
        <input type="number" class="initiative-bonus-input" id="bonus_${c.id}"
               value="${c.initiativeBonus}" placeholder="Bonus" min="-20" max="20">
        <span class="initiative-equals">= <strong id="total_${c.id}">${c.initiativeTotal}</strong></span>
      </div>
    </div>
  `).join('');

  return `
    <div class="combat-page">
      <style>${getCombatCSS()}</style>

      <div class="combat-header-bar">
        <button class="combat-back-btn" id="combatBackBtn">← Setup</button>
        <div class="combat-header-title">⚔️ Initiative</div>
        <div></div>
      </div>

      <div class="initiative-container">
        <p class="initiative-instructions">Roll initiative for each participant. Click <strong>Roll</strong> to auto-roll d20, then adjust the bonus if needed.</p>
        <div class="initiative-list" id="initiativeList">
          ${rows}
        </div>
        <button class="combat-start-btn" id="beginBattleBtn">
          Begin Battle →
        </button>
      </div>
    </div>
  `;
}

// ------------------------------- BATTLE PHASE --------------------------------

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

      <div class="battle-list" id="battleList">
        ${cards}
      </div>

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

      <!-- Use Move Confirm Popup -->
      <div class="combat-popup-overlay" id="combatMoveConfirmPopup" style="display:none;">
        <div class="combat-popup-content" style="max-width:360px; text-align:center; padding:2rem;">
          <h3 id="combatConfirmText" style="margin:0 0 1.5rem 0; color:#e0e0e0;"></h3>
          <div style="display:flex; gap:1rem;">
            <button id="confirmCombatMoveYes" class="combat-use-move-btn" style="flex:1;">Yes</button>
            <button id="confirmCombatMoveNo" class="combat-use-move-btn" style="flex:1; background: linear-gradient(135deg,#EE1515,#C91010);">No</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderCombatCard(c, isActive) {
  const fainted = c.currentHp <= 0;
  const activeClass = isActive ? 'combat-card--active' : '';
  const faintedClass = fainted ? 'combat-card--fainted' : '';

  const typeBadges = c.types.map(t => `<span class="type-badge type-${t.toLowerCase()}">${t}</span>`).join('');

  const statusBadges = c.statusEffects.map(se => {
    const durationText = se.duration === -1 ? '' : ` (${se.duration})`;
    return `<span class="status-badge status-${se.name.toLowerCase()}" data-combatant-id="${c.id}" data-effect="${se.name}">${se.name}${durationText}</span>`;
  }).join('');

  // HP/VP bar percentages
  const hpPct = c.maxHp > 0 ? Math.round((c.currentHp / c.maxHp) * 100) : 0;
  const vpPct = c.maxVp > 0 ? Math.round((c.currentVp / c.maxVp) * 100) : 0;

  // Expanded section
  let expandedHTML = '';
  if (c.isExpanded) {
    const addStatusBtns = ['Poison', 'Burn', 'Confusion', 'Paralysis', 'Sleep', 'Freeze']
      .filter(eff => !c.statusEffects.find(s => s.name === eff))
      .map(eff => `<button class="add-status-btn" data-combatant-id="${c.id}" data-effect="${eff}">${eff}</button>`)
      .join('');

    const movesSection = c.type === 'pokemon' && c.moves.length > 0 ? `
      <div class="expanded-moves-section">
        <div class="expanded-section-label">Moves</div>
        <div class="expanded-moves-list" id="moves_${c.id}">
          ${c.moves.map(m => `<button class="combat-move-item" data-move="${m}" data-combatant-id="${c.id}">${m}</button>`).join('')}
        </div>
      </div>
    ` : '';

    expandedHTML = `
      <div class="combat-card-expanded" id="expanded_${c.id}">
        <div class="expanded-hpvp-section">
          <div class="expanded-section-label">Adjust HP</div>
          <div class="hpvp-adjust-row">
            <button class="hpvp-btn" data-combatant-id="${c.id}" data-stat="hp" data-delta="-1">−</button>
            <input type="number" class="hpvp-input" id="hpInput_${c.id}" value="${c.currentHp}" min="0" max="${c.maxHp}" data-combatant-id="${c.id}" data-stat="hp">
            <span class="hpvp-max">/ ${c.maxHp}</span>
            <button class="hpvp-btn" data-combatant-id="${c.id}" data-stat="hp" data-delta="1">+</button>
          </div>
          <div class="expanded-section-label" style="margin-top:0.5rem;">Adjust VP</div>
          <div class="hpvp-adjust-row">
            <button class="hpvp-btn" data-combatant-id="${c.id}" data-stat="vp" data-delta="-1">−</button>
            <input type="number" class="hpvp-input" id="vpInput_${c.id}" value="${c.currentVp}" min="0" max="${c.maxVp}" data-combatant-id="${c.id}" data-stat="vp">
            <span class="hpvp-max">/ ${c.maxVp}</span>
            <button class="hpvp-btn" data-combatant-id="${c.id}" data-stat="vp" data-delta="1">+</button>
          </div>
        </div>
        <div class="expanded-status-section">
          <div class="expanded-section-label">Add Status</div>
          <div class="add-status-btns">${addStatusBtns}</div>
          ${statusBadges ? `<div class="expanded-section-label" style="margin-top:0.5rem;">Remove Status (tap badge)</div>` : ''}
        </div>
        ${movesSection}
      </div>
    `;
  }

  return `
    <div class="combat-card ${activeClass} ${faintedClass}" data-combatant-id="${c.id}" id="card_${c.id}">
      <div class="combat-card-main">
        <img src="${c.image}" alt="${c.name}" class="combat-card-img" onerror="this.src='assets/Pokeball.png'">
        <div class="combat-card-body">
          <div class="combat-card-name-row">
            <span class="combat-card-name ${fainted ? 'fainted-name' : ''}">${c.name}</span>
            <span class="combat-card-level">Lv ${c.level}</span>
            ${typeBadges}
            <span class="combat-initiative-badge">Init: ${c.initiativeTotal}</span>
          </div>
          <div class="combat-card-stats-row">
            <span>AC: <strong>${c.ac}</strong></span>
            <span class="stat-bar-wrap">
              HP: <strong>${c.currentHp}/${c.maxHp}</strong>
              <div class="mini-bar"><div class="mini-bar-fill hp-bar" style="width:${hpPct}%"></div></div>
            </span>
            <span class="stat-bar-wrap">
              VP: <strong>${c.currentVp}/${c.maxVp}</strong>
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
    </div>
  `;
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
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.8rem 1rem;
      background: rgba(0,0,0,0.4);
      border-bottom: 1px solid rgba(255,255,255,0.08);
      position: sticky;
      top: 0;
      z-index: 10;
    }
    .combat-header-title {
      font-size: 1.2rem;
      font-weight: 700;
      color: #FFD700;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .combat-round-label {
      font-size: 1rem;
      font-weight: 700;
      color: #a0a0c0;
    }
    .combat-back-btn {
      background: rgba(255,255,255,0.1);
      border: 1px solid rgba(255,255,255,0.2);
      color: #e0e0e0;
      padding: 0.4rem 0.8rem;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.9rem;
    }
    .combat-end-btn {
      background: linear-gradient(135deg, #c0392b, #922b21);
      border: none;
      color: #fff;
      padding: 0.4rem 0.8rem;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.9rem;
      font-weight: 600;
    }

    /* SETUP */
    .combat-setup-container {
      max-width: 600px;
      margin: 0 auto;
      padding: 1rem;
    }
    .setup-section-label {
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 1.5px;
      color: #888;
      text-transform: uppercase;
      margin: 1.2rem 0 0.4rem 0;
    }
    .setup-trainer-card {
      display: flex;
      align-items: center;
      gap: 0.8rem;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,215,0,0.3);
      border-radius: 10px;
      padding: 0.8rem 1rem;
    }
    .setup-trainer-card img {
      width: 56px;
      height: 56px;
      object-fit: contain;
      border-radius: 8px;
      background: rgba(255,255,255,0.05);
    }
    .setup-trainer-name { font-weight: 700; font-size: 1rem; }
    .setup-trainer-level { font-size: 0.85rem; color: #aaa; }
    .setup-pokemon-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .setup-pokemon-card {
      display: flex;
      align-items: center;
      gap: 0.8rem;
      background: rgba(255,255,255,0.04);
      border: 2px solid rgba(255,255,255,0.1);
      border-radius: 10px;
      padding: 0.6rem 0.8rem;
      cursor: pointer;
      transition: all 0.2s;
      position: relative;
    }
    .setup-pokemon-card.selected {
      border-color: #4CAF50;
      background: rgba(76,175,80,0.12);
    }
    .setup-check {
      position: absolute;
      top: 6px;
      right: 8px;
      font-size: 1rem;
      color: #4CAF50;
      opacity: 0;
      transition: opacity 0.2s;
    }
    .setup-pokemon-card.selected .setup-check { opacity: 1; }
    .setup-pokemon-card img {
      width: 48px;
      height: 48px;
      object-fit: contain;
    }
    .setup-pokemon-name { font-weight: 600; font-size: 0.95rem; }
    .setup-pokemon-level { font-size: 0.8rem; color: #aaa; }
    .setup-pokemon-types { display: flex; gap: 4px; margin-top: 2px; }
    .setup-empty { color: #888; font-style: italic; padding: 1rem; text-align: center; }
    .combat-start-btn {
      display: block;
      width: 100%;
      margin-top: 1.5rem;
      padding: 0.9rem;
      background: linear-gradient(135deg, #667eea, #764ba2);
      color: #fff;
      border: none;
      border-radius: 10px;
      font-size: 1.1rem;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s;
    }
    .combat-start-btn:disabled {
      background: rgba(255,255,255,0.1);
      color: #666;
      cursor: not-allowed;
    }

    /* INITIATIVE */
    .initiative-container {
      max-width: 600px;
      margin: 0 auto;
      padding: 1rem;
    }
    .initiative-instructions {
      font-size: 0.85rem;
      color: #aaa;
      margin-bottom: 1rem;
    }
    .initiative-list {
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
    }
    .initiative-row {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 10px;
      padding: 0.6rem 0.8rem;
      flex-wrap: wrap;
    }
    .initiative-img {
      width: 44px;
      height: 44px;
      object-fit: contain;
      flex-shrink: 0;
    }
    .initiative-info { flex: 1; min-width: 100px; }
    .initiative-name { font-weight: 600; font-size: 0.95rem; }
    .initiative-level { font-size: 0.75rem; color: #aaa; }
    .initiative-score-label { font-size: 0.8rem; color: #aaa; }
    .initiative-roll-group {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      flex-wrap: nowrap;
    }
    .initiative-roll-btn {
      background: linear-gradient(135deg, #FFD700, #FFA500);
      color: #000;
      border: none;
      border-radius: 6px;
      padding: 0.35rem 0.65rem;
      font-weight: 700;
      font-size: 0.85rem;
      cursor: pointer;
    }
    .initiative-roll-input, .initiative-bonus-input {
      width: 52px;
      padding: 0.3rem;
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 6px;
      color: #e0e0e0;
      text-align: center;
      font-size: 0.9rem;
    }
    .initiative-plus, .initiative-equals {
      font-size: 0.9rem;
      color: #aaa;
    }
    .initiative-equals strong {
      color: #FFD700;
      font-size: 1rem;
    }

    /* BATTLE CARDS */
    .battle-list {
      max-width: 700px;
      margin: 0 auto;
      padding: 0.8rem;
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
    }
    .combat-card {
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 12px;
      overflow: hidden;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .combat-card--active {
      border: 2px solid #FFD700;
      box-shadow: 0 0 12px rgba(255,215,0,0.4);
    }
    .combat-card--fainted {
      opacity: 0.5;
      filter: grayscale(0.6);
    }
    .combat-card-main {
      display: flex;
      gap: 0.7rem;
      padding: 0.7rem;
      cursor: pointer;
    }
    .combat-card-img {
      width: 60px;
      height: 60px;
      object-fit: contain;
      flex-shrink: 0;
      border-radius: 8px;
      background: rgba(255,255,255,0.04);
    }
    .combat-card-body { flex: 1; min-width: 0; }
    .combat-card-name-row {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.3rem;
      margin-bottom: 0.35rem;
    }
    .combat-card-name {
      font-weight: 700;
      font-size: 1rem;
    }
    .fainted-name {
      text-decoration: line-through;
      color: #888;
    }
    .combat-card-level {
      font-size: 0.78rem;
      color: #aaa;
    }
    .combat-initiative-badge {
      margin-left: auto;
      font-size: 0.72rem;
      color: #FFD700;
      font-weight: 600;
    }
    .combat-card-stats-row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      font-size: 0.82rem;
      margin-bottom: 0.2rem;
    }
    .combat-mods-row {
      font-size: 0.78rem;
      color: #c0c0c0;
      gap: 0.4rem;
    }
    .combat-mods-row small { color: #888; margin-left: 1px; }
    .stat-bar-wrap { display: flex; align-items: center; gap: 0.3rem; }
    .mini-bar {
      width: 48px;
      height: 5px;
      background: rgba(255,255,255,0.1);
      border-radius: 3px;
      overflow: hidden;
    }
    .mini-bar-fill { height: 100%; border-radius: 3px; transition: width 0.3s; }
    .hp-bar { background: #4CAF50; }
    .vp-bar { background: #2196F3; }
    .combat-card-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.4rem 0.7rem;
      background: rgba(0,0,0,0.2);
      border-top: 1px solid rgba(255,255,255,0.06);
      min-height: 36px;
    }
    .combat-status-badges { display: flex; gap: 0.3rem; flex-wrap: wrap; }
    .status-badge {
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 0.72rem;
      font-weight: 600;
      cursor: pointer;
    }
    .status-poison  { background: rgba(160,64,160,0.8); color: #fff; }
    .status-burn    { background: rgba(240,80,20,0.8);  color: #fff; }
    .status-confusion { background: rgba(255,215,0,0.8); color: #000; }
    .status-paralysis { background: rgba(255,200,0,0.8); color: #000; }
    .status-sleep   { background: rgba(100,100,180,0.8); color: #fff; }
    .status-freeze  { background: rgba(88,200,237,0.8); color: #000; }
    .end-turn-btn {
      background: linear-gradient(135deg, #e67e22, #d35400);
      color: #fff;
      border: none;
      border-radius: 6px;
      padding: 0.3rem 0.7rem;
      font-size: 0.82rem;
      font-weight: 600;
      cursor: pointer;
    }

    /* EXPANDED SECTION */
    .combat-card-expanded {
      padding: 0.7rem;
      background: rgba(0,0,0,0.3);
      border-top: 1px solid rgba(255,255,255,0.07);
    }
    .expanded-section-label {
      font-size: 0.68rem;
      font-weight: 700;
      letter-spacing: 1px;
      color: #888;
      text-transform: uppercase;
      margin-bottom: 0.3rem;
    }
    .hpvp-adjust-row {
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }
    .hpvp-btn {
      width: 28px;
      height: 28px;
      background: rgba(255,255,255,0.1);
      border: 1px solid rgba(255,255,255,0.2);
      color: #e0e0e0;
      border-radius: 6px;
      cursor: pointer;
      font-size: 1.1rem;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .hpvp-input {
      width: 56px;
      padding: 0.25rem;
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 6px;
      color: #e0e0e0;
      text-align: center;
      font-size: 0.9rem;
    }
    .hpvp-max { font-size: 0.85rem; color: #aaa; }
    .expanded-status-section { margin-top: 0.6rem; }
    .add-status-btns { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-bottom: 0.4rem; }
    .add-status-btn {
      padding: 0.25rem 0.6rem;
      font-size: 0.75rem;
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.15);
      color: #e0e0e0;
      border-radius: 12px;
      cursor: pointer;
    }
    .expanded-moves-section { margin-top: 0.6rem; }
    .expanded-moves-list { display: flex; flex-wrap: wrap; gap: 0.35rem; }
    .combat-move-item {
      padding: 0.3rem 0.7rem;
      border-radius: 14px;
      border: none;
      font-size: 0.78rem;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.1s;
      background: #888;
      color: #fff;
    }
    .combat-move-item:active { transform: scale(0.95); }

    /* MOVE POPUP */
    .combat-popup-overlay {
      position: fixed;
      top: 0; left: 0;
      width: 100%; height: 100%;
      background: rgba(0,0,0,0.75);
      z-index: 1000;
      justify-content: center;
      align-items: center;
      backdrop-filter: blur(3px);
    }
    .combat-popup-content {
      background: #1e1e34;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 16px;
      max-width: 560px;
      width: 92%;
      max-height: 85vh;
      overflow-y: auto;
      position: relative;
      box-shadow: 0 10px 40px rgba(0,0,0,0.6);
    }
    .combat-move-popup-header {
      padding: 1.1rem 1.2rem;
      border-radius: 16px 16px 0 0;
      border-bottom: 2px solid rgba(0,0,0,0.3);
      display: flex;
      align-items: center;
      gap: 0.6rem;
      flex-wrap: wrap;
      position: relative;
    }
    .combat-move-popup-header h2 {
      margin: 0;
      font-size: 1.4rem;
      font-weight: 900;
      text-transform: uppercase;
    }
    .combat-move-type-badge {
      padding: 0.2rem 0.7rem;
      border-radius: 12px;
      font-size: 0.85rem;
      font-weight: 700;
      background: rgba(255,255,255,0.25);
    }
    .combat-popup-close {
      position: absolute;
      top: 0.8rem;
      right: 0.8rem;
      background: rgba(0,0,0,0.3);
      border: none;
      border-radius: 50%;
      width: 32px;
      height: 32px;
      font-size: 1.2rem;
      font-weight: bold;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .combat-move-popup-body { padding: 1rem 1.2rem; }
    .combat-move-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 0.4rem;
      margin-bottom: 0.8rem;
      font-size: 0.88rem;
    }
    .combat-move-description {
      background: rgba(255,255,255,0.06);
      border-radius: 8px;
      padding: 0.7rem;
      font-size: 0.88rem;
      line-height: 1.5;
      margin-bottom: 0.6rem;
    }
    .combat-move-higher {
      font-size: 0.82rem;
      color: #aaa;
      margin-bottom: 0.8rem;
    }
    .combat-move-rolls-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 1rem;
      background: rgba(255,255,255,0.05);
      border-radius: 8px;
      padding: 0.7rem;
      margin-bottom: 1rem;
      font-size: 0.88rem;
    }
    .combat-roll-bonus {
      font-size: 1.15em;
      font-weight: bold;
    }
    .combat-roll-breakdown {
      font-size: 0.75em;
      color: #aaa;
      margin-top: 0.2rem;
    }
    .combat-use-move-btn {
      width: 100%;
      padding: 0.75rem;
      background: linear-gradient(135deg, #4CAF50, #45A049);
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 1rem;
      font-weight: 700;
      cursor: pointer;
    }

    /* TYPE BADGES */
    .type-badge {
      padding: 1px 7px;
      border-radius: 10px;
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
    }
    .type-normal    { background: #A8A878; color: #000; }
    .type-fighting  { background: #e68c2e; color: #000; }
    .type-flying    { background: #A890F0; color: #000; }
    .type-poison    { background: #A040A0; color: #fff; }
    .type-ground    { background: #A67C52; color: #fff; }
    .type-rock      { background: #a85d16; color: #fff; }
    .type-bug       { background: #A8B820; color: #000; }
    .type-ghost     { background: #705898; color: #fff; }
    .type-steel     { background: #bdbdbd; color: #000; }
    .type-fire      { background: #f02e07; color: #fff; }
    .type-water     { background: #1E90FF; color: #fff; }
    .type-grass     { background: #32CD32; color: #000; }
    .type-electric  { background: #FFD700; color: #000; }
    .type-psychic   { background: #F85888; color: #fff; }
    .type-ice       { background: #58c8ed; color: #000; }
    .type-dragon    { background: #280dd4; color: #fff; }
    .type-dark      { background: #282729; color: #fff; }
    .type-fairy     { background: #ed919f; color: #000; }
    .type-cosmic    { background: #120077; color: #fff; }
  `;
}

// ============================================================================
// LISTENERS
// ============================================================================

export function attachCombatListeners() {
  const state = getCombatState();
  const phase = state ? state.phase : 'setup';

  if (phase === 'initiative') {
    attachInitiativeListeners(state);
  } else if (phase === 'battle') {
    attachBattleListeners(state);
  } else {
    attachSetupListeners();
  }
}

// ----------------------------- SETUP LISTENERS ------------------------------

function attachSetupListeners() {
  // Back button
  document.getElementById('combatBackBtn')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('navigate', { detail: { route: 'trainer-card' } }));
  });

  const startBtn = document.getElementById('startCombatBtn');

  // Pokemon card toggles
  document.querySelectorAll('.setup-pokemon-card').forEach(card => {
    card.addEventListener('click', () => {
      card.classList.toggle('selected');
      const anySelected = document.querySelectorAll('.setup-pokemon-card.selected').length > 0;
      startBtn.disabled = !anySelected;
    });
  });

  // Start combat button
  startBtn?.addEventListener('click', () => {
    const selectedKeys = [...document.querySelectorAll('.setup-pokemon-card.selected')]
      .map(el => el.dataset.pokemonKey);

    const combatants = [buildTrainerCombatant()];
    for (const key of selectedKeys) {
      combatants.push(buildPokemonCombatant(key));
    }

    const state = {
      phase: 'initiative',
      round: 1,
      activeTurnIndex: 0,
      combatants
    };
    saveCombatState(state);

    // Re-render initiative phase
    const content = document.getElementById('content');
    content.innerHTML = renderCombat();
    attachCombatListeners();
  });
}

// -------------------------- INITIATIVE LISTENERS ----------------------------

function attachInitiativeListeners(state) {
  // Back button
  document.getElementById('combatBackBtn')?.addEventListener('click', () => {
    sessionStorage.removeItem('combatState');
    const content = document.getElementById('content');
    content.innerHTML = renderCombat();
    attachCombatListeners();
  });

  // Roll buttons
  document.querySelectorAll('.initiative-roll-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.combatantId;
      const roll = Math.floor(Math.random() * 20) + 1;
      const rollInput = document.getElementById(`roll_${id}`);
      if (rollInput) rollInput.value = roll;
      recalcInitiativeTotal(id, state);
    });
  });

  // Bonus inputs
  document.querySelectorAll('.initiative-bonus-input').forEach(input => {
    input.addEventListener('input', () => {
      const id = input.id.replace('bonus_', '');
      recalcInitiativeTotal(id, state);
    });
  });

  // Begin Battle
  document.getElementById('beginBattleBtn')?.addEventListener('click', () => {
    // Read final totals from DOM into state
    state.combatants.forEach(c => {
      const rollInput = document.getElementById(`roll_${c.id}`);
      const bonusInput = document.getElementById(`bonus_${c.id}`);
      c.initiativeRoll = parseInt(rollInput?.value) || 0;
      c.initiativeBonus = parseInt(bonusInput?.value) || 0;
      c.initiativeTotal = c.initiativeScore + c.initiativeRoll + c.initiativeBonus;
    });

    // Sort descending by total
    state.combatants.sort((a, b) => b.initiativeTotal - a.initiativeTotal);
    state.phase = 'battle';
    state.activeTurnIndex = 0;
    saveCombatState(state);

    const content = document.getElementById('content');
    content.innerHTML = renderCombat();
    attachCombatListeners();
  });
}

function recalcInitiativeTotal(id, state) {
  const c = state.combatants.find(x => x.id === id);
  if (!c) return;
  const rollVal = parseInt(document.getElementById(`roll_${id}`)?.value) || 0;
  const bonusVal = parseInt(document.getElementById(`bonus_${id}`)?.value) || 0;
  const total = c.initiativeScore + rollVal + bonusVal;
  const totalEl = document.getElementById(`total_${id}`);
  if (totalEl) totalEl.textContent = total;
}

// ---------------------------- BATTLE LISTENERS ------------------------------

function attachBattleListeners(state) {
  loadCombatMoves();

  // End Combat
  document.getElementById('endCombatBtn')?.addEventListener('click', () => {
    endCombat(state);
  });

  // Card click → toggle expand (delegate)
  const battleList = document.getElementById('battleList');
  if (battleList) {
    battleList.addEventListener('click', (e) => {
      // End Turn button
      const endTurnBtn = e.target.closest('.end-turn-btn');
      if (endTurnBtn) {
        e.stopPropagation();
        endTurnForCombatant(endTurnBtn.dataset.combatantId, state);
        return;
      }

      // HP/VP +/- buttons
      const hpvpBtn = e.target.closest('.hpvp-btn');
      if (hpvpBtn) {
        e.stopPropagation();
        handleHpVpDelta(hpvpBtn, state);
        return;
      }

      // Add status buttons
      const addStatusBtn = e.target.closest('.add-status-btn');
      if (addStatusBtn) {
        e.stopPropagation();
        addStatusEffect(addStatusBtn.dataset.combatantId, addStatusBtn.dataset.effect, state);
        return;
      }

      // Status badge click → remove
      const statusBadge = e.target.closest('.status-badge');
      if (statusBadge) {
        e.stopPropagation();
        removeStatusEffect(statusBadge.dataset.combatantId, statusBadge.dataset.effect, state);
        return;
      }

      // Move item click
      const moveItem = e.target.closest('.combat-move-item');
      if (moveItem) {
        e.stopPropagation();
        showCombatMoveDetails(moveItem.dataset.move, moveItem.dataset.combatantId, state);
        return;
      }

      // HP/VP input change (direct input)
      const hpvpInput = e.target.closest('.hpvp-input');
      if (hpvpInput) {
        e.stopPropagation();
        return; // handled by change event below
      }

      // Card main click → toggle expand
      const card = e.target.closest('.combat-card');
      if (card) {
        const id = card.dataset.combatantId;
        const c = state.combatants.find(x => x.id === id);
        if (c) {
          c.isExpanded = !c.isExpanded;
          saveCombatState(state);
          rerenderBattle(state);
        }
      }
    });

    // HP/VP direct input
    battleList.addEventListener('change', (e) => {
      const input = e.target.closest('.hpvp-input');
      if (!input) return;
      const id = input.dataset.combatantId;
      const stat = input.dataset.stat;
      const val = parseInt(input.value) || 0;
      const c = state.combatants.find(x => x.id === id);
      if (!c) return;
      if (stat === 'hp') c.currentHp = Math.max(0, Math.min(val, c.maxHp));
      if (stat === 'vp') c.currentVp = Math.max(0, Math.min(val, c.maxVp));
      saveCombatState(state);
      rerenderBattle(state);
    });
  }

  // Apply move colors to move buttons
  applyMoveColors();

  // Move popup close / outside click
  const movePopup = document.getElementById('combatMovePopup');
  if (movePopup) {
    document.getElementById('closeCombatMovePopup')?.addEventListener('click', () => {
      movePopup.style.display = 'none';
    });
    movePopup.addEventListener('click', (e) => {
      if (e.target === movePopup) movePopup.style.display = 'none';
    });
  }

  // Confirm popup buttons
  document.getElementById('confirmCombatMoveNo')?.addEventListener('click', () => {
    document.getElementById('combatMoveConfirmPopup').style.display = 'none';
  });
  document.getElementById('combatMoveConfirmPopup')?.addEventListener('click', (e) => {
    if (e.target.id === 'combatMoveConfirmPopup') e.target.style.display = 'none';
  });

  // Use Move confirm — Yes
  document.getElementById('confirmCombatMoveYes')?.addEventListener('click', () => {
    const btn = document.getElementById('useCombatMoveBtn');
    const vpCost = parseInt(btn?.dataset.vpCost) || 0;
    const combatantId = btn?.dataset.combatantId;
    if (!combatantId) return;

    const c = state.combatants.find(x => x.id === combatantId);
    if (!c) return;

    let newVp = c.currentVp - vpCost;
    let newHp = c.currentHp;
    if (newVp < 0) {
      newHp = Math.max(0, newHp + newVp);
      newVp = 0;
    }
    c.currentHp = newHp;
    c.currentVp = newVp;
    saveCombatState(state);

    document.getElementById('combatMoveConfirmPopup').style.display = 'none';
    document.getElementById('combatMovePopup').style.display = 'none';
    rerenderBattle(state);
  });
}

function handleHpVpDelta(btn, state) {
  const id = btn.dataset.combatantId;
  const stat = btn.dataset.stat;
  const delta = parseInt(btn.dataset.delta) || 0;
  const c = state.combatants.find(x => x.id === id);
  if (!c) return;
  if (stat === 'hp') c.currentHp = Math.max(0, Math.min(c.currentHp + delta, c.maxHp));
  if (stat === 'vp') c.currentVp = Math.max(0, Math.min(c.currentVp + delta, c.maxVp));
  saveCombatState(state);
  rerenderBattle(state);
}

function rerenderBattle(state) {
  const battleList = document.getElementById('battleList');
  if (!battleList) return;
  battleList.innerHTML = state.combatants.map((c, idx) =>
    renderCombatCard(c, idx === state.activeTurnIndex)
  ).join('');
  applyMoveColors();
}

function applyMoveColors() {
  if (!window.allMoves) return;
  document.querySelectorAll('.combat-move-item').forEach(item => {
    const moveName = item.dataset.move;
    const move = window.allMoves.find(m => m[0] === moveName);
    if (move) {
      const bg = getMoveTypeColor(move[1]);
      const fg = getTextColorForBackground(bg);
      item.style.backgroundColor = bg;
      item.style.color = fg;
    }
  });
}

// ============================================================================
// BATTLE LOGIC
// ============================================================================

function endTurnForCombatant(combatantId, state) {
  const c = state.combatants.find(x => x.id === combatantId);
  if (!c) return;

  // Apply status effects
  const remaining = [];
  for (const se of c.statusEffects) {
    if (se.name === 'Poison') {
      const dmg = c.proficiency;
      c.currentHp = Math.max(0, c.currentHp - dmg);
      showToast(`${c.name}: Poison! −${dmg} HP`, 'warning');
    } else if (se.name === 'Burn') {
      const dmg = c.proficiency;
      c.currentHp = Math.max(0, c.currentHp - dmg);
      showToast(`${c.name}: Burn! −${dmg} HP`, 'warning');
    } else if (se.name === 'Confusion') {
      showToast(`${c.name}: Confused! Remember to roll a confusion check.`, 'info');
    } else if (se.name === 'Paralysis') {
      showToast(`${c.name}: Paralyzed! May be unable to move.`, 'warning');
    } else if (se.name === 'Sleep') {
      showToast(`${c.name}: Asleep! Roll to wake up.`, 'info');
    } else if (se.name === 'Freeze') {
      showToast(`${c.name}: Frozen! Roll to thaw.`, 'info');
    }

    if (se.duration === -1) {
      remaining.push(se);
    } else {
      const newDur = se.duration - 1;
      if (newDur > 0) remaining.push({ ...se, duration: newDur });
    }
  }
  c.statusEffects = remaining;

  // Advance turn
  const total = state.combatants.length;
  let next = state.activeTurnIndex;
  let wrapped = false;
  for (let i = 1; i <= total; i++) {
    const candidate = (state.activeTurnIndex + i) % total;
    if (candidate <= state.activeTurnIndex) wrapped = true;
    if (state.combatants[candidate].currentHp > 0) {
      next = candidate;
      break;
    }
  }
  if (wrapped || next < state.activeTurnIndex) {
    state.round++;
    showToast(`Round ${state.round} begins!`, 'info', 2000);
  }

  // If all fainted, just advance anyway
  if (state.combatants.every(x => x.currentHp <= 0)) {
    next = (state.activeTurnIndex + 1) % total;
  }

  state.activeTurnIndex = next;

  // Close any expanded sections for non-active
  state.combatants.forEach((cc, idx) => {
    if (idx !== next) cc.isExpanded = false;
  });

  saveCombatState(state);
  rerenderBattle(state);
}

function addStatusEffect(combatantId, effectName, state) {
  const c = state.combatants.find(x => x.id === combatantId);
  if (!c) return;
  if (!c.statusEffects.find(s => s.name === effectName)) {
    c.statusEffects.push({ name: effectName, duration: -1 });
    saveCombatState(state);
    rerenderBattle(state);
  }
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
  if (!window.allMoves) {
    showToast('Move data not loaded.', 'warning');
    return;
  }

  const move = window.allMoves.find(m => m[0] === moveName);
  if (!move) {
    showToast(`Move "${moveName}" not found.`, 'warning');
    return;
  }

  const c = state.combatants.find(x => x.id === combatantId);
  if (!c) return;

  const trainerData = JSON.parse(sessionStorage.getItem('trainerData') || '[]');
  const trainerPath = trainerData[25] || '';
  const trainerLevel = parseInt(trainerData[2]) || 1;
  const specializationsStr = trainerData[24] || '';

  const moveType = move[1];
  const pokemonTypes = c.types || [];
  let hasSTAB = pokemonTypes.includes(moveType);

  // Type Master STAB expansion
  const specializationToType = {
    'Bird Keeper': 'Flying', 'Bug Maniac': 'Bug', 'Camper': 'Ground',
    'Dragon Tamer': 'Dragon', 'Engineer': 'Electric', 'Pyromaniac': 'Fire',
    'Gardener': 'Grass', 'Martial Artist': 'Fighting', 'Mountaineer': 'Rock',
    'Mystic': 'Ghost', 'Steel Worker': 'Steel', 'Psychic': 'Psychic',
    'Swimmer': 'Water', 'Charmer': 'Fairy', 'Shadow': 'Dark',
    'Alchemist': 'Poison', 'Team Player': 'Normal', 'Ice Skater': 'Ice'
  };

  if (!hasSTAB && trainerPath === 'Type Master' && trainerLevel >= 15 && specializationsStr) {
    const specTypes = specializationsStr.split(',').map(s => specializationToType[s.trim()]).filter(t => t);
    if (pokemonTypes.some(pt => specTypes.includes(pt))) hasSTAB = true;
  }

  // Type Master damage bonus
  let typeMasterDamageBonus = 0;
  let typeMasterAttackBonus = 0;
  if (trainerPath === 'Type Master' && trainerLevel >= 3 && specializationsStr) {
    const specTypes = specializationsStr.split(',').map(s => specializationToType[s.trim()]).filter(t => t);
    if (specTypes.includes(moveType)) {
      pokemonTypes.forEach(pt => { if (specTypes.includes(pt)) typeMasterDamageBonus++; });
    }
    if (trainerLevel >= 5 && pokemonTypes.some(pt => specTypes.includes(pt))) {
      typeMasterAttackBonus = 2;
    }
  }

  const aceTrainerBonus = (trainerPath === 'Ace Trainer' && trainerLevel >= 3) ? 1 : 0;

  // Modifiers
  const modMap = { STR: c.strMod, DEX: c.dexMod, CON: c.conMod, INT: c.intMod, WIS: c.wisMod, CHA: c.chaMod };
  const moveModifiers = (move[2] || '').split('/').map(m => m.trim().toUpperCase());
  const allowedMods = moveModifiers.map(m => modMap[m]).filter(v => v !== undefined);
  const highestMod = allowedMods.length > 0 ? Math.max(...allowedMods) : 0;
  const usedStat = moveModifiers.find(m => modMap[m] === highestMod) || '';

  // Attack roll
  const profBonus = hasSTAB ? c.proficiency : 0;
  const attackBonus = profBonus + highestMod + aceTrainerBonus + typeMasterAttackBonus;

  // Damage roll
  const desc = move[7] || '';
  const includeStatInDmg = /\+\s*MOVE/i.test(desc);
  const stabBonus = hasSTAB ? (c.stabBonusValue || 2) : 0;
  const dmgStatMod = includeStatInDmg ? highestMod : 0;
  const damageBonus = stabBonus + dmgStatMod + aceTrainerBonus + typeMasterDamageBonus;

  // Breakdown strings
  const atkParts = [];
  if (profBonus > 0) atkParts.push(`Proficiency +${profBonus}`);
  if (highestMod !== 0) atkParts.push(`${usedStat} ${formatMod(highestMod)}`);
  if (aceTrainerBonus > 0) atkParts.push(`Ace Trainer +${aceTrainerBonus}`);
  if (typeMasterAttackBonus > 0) atkParts.push(`Type Master +${typeMasterAttackBonus}`);
  const atkBreakdown = atkParts.length ? `(${atkParts.join(', ')})` : '';

  const dmgParts = [];
  if (stabBonus > 0) dmgParts.push(`STAB +${stabBonus}`);
  if (includeStatInDmg && highestMod !== 0) dmgParts.push(`${usedStat} ${formatMod(highestMod)}`);
  if (aceTrainerBonus > 0) dmgParts.push(`Ace Trainer +${aceTrainerBonus}`);
  if (typeMasterDamageBonus > 0) dmgParts.push(`Type Master +${typeMasterDamageBonus}`);
  const dmgBreakdown = dmgParts.length ? `(${dmgParts.join(', ')})` : '';

  const vpCost = parseInt(move[4]) || 0;
  const bgColor = getMoveTypeColor(moveType);
  const textColor = getTextColorForBackground(bgColor);

  // Populate popup
  const header = document.getElementById('combatMovePopupHeader');
  const body = document.getElementById('combatMovePopupBody');
  if (header) {
    header.style.backgroundColor = bgColor;
    header.style.color = textColor;
    const closeBtn = header.querySelector('.combat-popup-close');
    if (closeBtn) {
      closeBtn.style.color = textColor;
      closeBtn.style.background = 'rgba(0,0,0,0.2)';
    }
  }
  if (body) {
    body.style.backgroundColor = bgColor;
    body.style.color = textColor;
  }

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
  document.getElementById('cAttackBreakdown').textContent = atkBreakdown;
  document.getElementById('cDamageBonus').textContent = formatMod(damageBonus);
  document.getElementById('cDamageBreakdown').textContent = dmgBreakdown;

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

  for (const c of state.combatants) {
    if (c.type === 'trainer') {
      trainerData[34] = c.currentHp;
      trainerData[35] = c.currentVp;
      sessionStorage.setItem('trainerData', JSON.stringify(trainerData));
      TrainerAPI.update(trainerData).catch(e => console.error('Trainer sync error:', e));
    } else if (c.type === 'pokemon') {
      const pokemonData = JSON.parse(sessionStorage.getItem(c.entityKey) || '[]');
      pokemonData[45] = c.currentHp;
      pokemonData[46] = c.currentVp;
      sessionStorage.setItem(c.entityKey, JSON.stringify(pokemonData));
      const pokemonName = pokemonData[2];
      const trainerName = trainerData[1];
      PokemonAPI.updateLiveStats(trainerName, pokemonName, 'HP', c.currentHp)
        .catch(e => console.error('Pokemon HP sync error:', e));
      PokemonAPI.updateLiveStats(trainerName, pokemonName, 'VP', c.currentVp)
        .catch(e => console.error('Pokemon VP sync error:', e));
    }
  }

  sessionStorage.removeItem('combatState');
  showToast('Combat ended. Stats saved.', 'success');
  window.dispatchEvent(new CustomEvent('navigate', { detail: { route: 'trainer-card' } }));
}
