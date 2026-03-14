// Shared move details popup — used by combat.js and pokemon-card.js.
// Creates the popup DOM once (appended to document.body) and populates it on each call.

import { getMoveTypeColor, getTextColorForBackground } from './pokemon-types.js';
import { PokemonAPI, TrainerAPI } from '../api.js';
import { showToast } from './notifications.js';

// ── CSS injection ─────────────────────────────────────────────────────────────

function _injectStyles() {
  if (document.getElementById('move-popup-styles')) return;
  const style = document.createElement('style');
  style.id = 'move-popup-styles';
  style.textContent = `
    .combat-popup-overlay { position: fixed; top:0; left:0; width:100%; height:100%; background: rgba(0,0,0,0.75); z-index: 1000; justify-content: center; align-items: center; backdrop-filter: blur(3px); }
    .combat-popup-content { background: #1e1e34; border: 1px solid rgba(255,255,255,0.12); border-radius: 16px; max-width: 560px; width: 92%; max-height: 85vh; overflow-y: auto; position: relative; box-shadow: 0 10px 40px rgba(0,0,0,0.6); }
    .combat-move-popup-header { padding: 1.1rem 1.2rem; border-radius: 16px 16px 0 0; border-bottom: 2px solid rgba(0,0,0,0.3); display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; position: relative; }
    .combat-move-popup-header h2 { margin: 0; font-size: 1.4rem; font-weight: 900; text-transform: uppercase; }
    .combat-move-type-badge { padding: 0.2rem 0.7rem; border-radius: 12px; font-size: 0.85rem; font-weight: 700; background: rgba(255,255,255,0.25); }
    .combat-popup-close { position: absolute; top: 0.8rem; right: 0.8rem; background: rgba(0,0,0,0.3); border: none; border-radius: 50%; width: 32px; height: 32px; font-size: 1.2rem; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; color: inherit; }
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
    .charge-dots { display: flex; gap: 5px; align-items: center; }
    .charge-dot { width: clamp(10px,2vw,14px); height: clamp(10px,2vw,14px); border-radius: 50%; display: inline-block; box-shadow: 0 2px 4px rgba(0,0,0,0.3); }
    .charge-dot.filled { background: linear-gradient(135deg,#4CAF50,#45A049); border: 2px solid #FFDE00; box-shadow: 0 0 8px rgba(76,175,80,0.6); }
    .charge-dot.empty { background: rgba(100,100,100,0.4); border: 2px solid rgba(150,150,150,0.5); }
    .tp-dot, .commander-dot { width: clamp(10px,2vw,14px); height: clamp(10px,2vw,14px); border-radius: 50%; display: inline-block; box-shadow: 0 2px 4px rgba(0,0,0,0.3); }
    .tp-dot.filled, .commander-dot.filled { background: linear-gradient(135deg,#4CAF50,#45A049); border: 2px solid #FFDE00; box-shadow: 0 0 8px rgba(76,175,80,0.6); }
    .tp-dot.empty, .commander-dot.empty { background: rgba(100,100,100,0.4); border: 2px solid rgba(150,150,150,0.5); }
  `;
  document.head.appendChild(style);
}

// ── DOM creation ──────────────────────────────────────────────────────────────

function _createPopupDOM() {
  const overlay = document.createElement('div');
  overlay.className = 'combat-popup-overlay';
  overlay.id = 'combatMovePopup';
  overlay.style.display = 'none';
  overlay.innerHTML = `
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
          <div><strong>Critical Hit:</strong> <span id="cMoveCritMod"></span></div>
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
  `;
  document.body.appendChild(overlay);

  const confirmOverlay = document.createElement('div');
  confirmOverlay.className = 'combat-popup-overlay';
  confirmOverlay.id = 'combatMoveConfirmPopup';
  confirmOverlay.style.display = 'none';
  confirmOverlay.innerHTML = `
    <div class="combat-popup-content" style="max-width:360px;text-align:center;padding:2rem;">
      <h3 id="combatConfirmText" style="margin:0 0 1.5rem 0;color:#e0e0e0;"></h3>
      <div style="display:flex;gap:1rem;">
        <button id="confirmCombatMoveYes" class="combat-use-move-btn" style="flex:1;">Yes</button>
        <button id="confirmCombatMoveNo" class="combat-use-move-btn" style="flex:1;background:linear-gradient(135deg,#EE1515,#C91010);">No</button>
      </div>
    </div>
  `;
  document.body.appendChild(confirmOverlay);

  // Static one-time listeners
  document.getElementById('closeCombatMovePopup').addEventListener('click', () => {
    overlay.style.display = 'none';
  });
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.style.display = 'none';
  });

  document.getElementById('useCombatMoveBtn').addEventListener('click', () => {
    const btn = document.getElementById('useCombatMoveBtn');
    document.getElementById('combatConfirmText').textContent =
      `Use ${btn.dataset.moveName} (${btn.dataset.vpCost} VP)?`;
    confirmOverlay.style.display = 'flex';
  });

  document.getElementById('confirmCombatMoveNo').addEventListener('click', () => {
    confirmOverlay.style.display = 'none';
  });
  confirmOverlay.addEventListener('click', e => {
    if (e.target === confirmOverlay) confirmOverlay.style.display = 'none';
  });

  document.getElementById('confirmCombatMoveYes').addEventListener('click', () => {
    const btn = document.getElementById('useCombatMoveBtn');
    const moveName = btn.dataset.moveName;
    const vpCost = parseInt(btn.dataset.vpCost) || 0;
    if (overlay._onUseMove) overlay._onUseMove(moveName, vpCost);
    confirmOverlay.style.display = 'none';
    overlay.style.display = 'none';
  });
}

// ── Trainer path sections ─────────────────────────────────────────────────────

function _renderBattleDice(trainerData) {
  const container = document.getElementById('cBattleDiceContainer');
  if (!container) return;
  if ((trainerData[25] || '') !== 'Ace Trainer') { container.innerHTML = ''; return; }

  const battleDiceData = trainerData[45] || '';
  let maxCharges = 0, currentCharges = 0;
  if (battleDiceData) {
    const parts = battleDiceData.split('-').map(p => p.trim());
    if (parts.length === 2) { maxCharges = parseInt(parts[0]) || 0; currentCharges = parseInt(parts[1]) || 0; }
  }

  let dotsHTML = '<div class="charge-dots">';
  for (let i = 0; i < maxCharges; i++) {
    dotsHTML += `<span class="charge-dot ${i < currentCharges ? 'filled' : 'empty'}"></span>`;
  }
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
    dots.forEach((dot, i) => {
      dot.classList.toggle('filled', i < currentCharges);
      dot.classList.toggle('empty', i >= currentCharges);
    });
    if (currentCharges <= 0) document.getElementById('cUseBattleDiceBtn').disabled = true;
    showToast('Battle Dice used! Roll 1d6 and add to attack or damage.', 'success');
  });
}

function _renderTactician(trainerData) {
  const container = document.getElementById('cTacticianContainer');
  if (!container) return;
  const trainerPath = trainerData[25] || '';
  const trainerLevel = parseInt(trainerData[2]) || 1;
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
      dot.classList.toggle('filled', i < currentTP);
      dot.classList.toggle('empty', i >= currentTP);
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

function _renderCommander(trainerData) {
  const container = document.getElementById('cCommanderContainer');
  if (!container) return;
  const trainerPath = trainerData[25] || '';
  const trainerLevel = parseInt(trainerData[2]) || 1;
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
      dot.classList.toggle('filled', i < surgeCurrent);
      dot.classList.toggle('empty', i >= surgeCurrent);
    });
    const surgeBtn = document.getElementById('cUseSurgeCommand');
    if (surgeBtn) surgeBtn.disabled = surgeCurrent <= 0;
    container.querySelectorAll('.rally-dots .commander-dot').forEach((dot, i) => {
      dot.classList.toggle('filled', i < rallyCurrent);
      dot.classList.toggle('empty', i >= rallyCurrent);
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

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Show the shared move details popup.
 *
 * @param {object} params
 * @param {Array}  params.move          - Move data array [name, type, modifier, actionType, vpCost, duration, range, desc, higherLevels]
 * @param {object} params.computedData  - { attackBonus, damageBonus, attackBreakdown, damageBreakdown, damageDice }
 * @param {string} [params.heldItemsHTML] - HTML string for held items (falsy = hide panel)
 * @param {string} [params.size]        - Pokemon size string
 * @param {number} [params.critMod]     - Critical hit modifier
 * @param {Array}  params.trainerData   - Full trainer data array
 * @param {function} [params.onUseMove] - Callback(moveName, vpCost) invoked after user confirms
 */
export function showMovePopup({ move, computedData, heldItemsHTML, size, critMod, trainerData, onUseMove }) {
  _injectStyles();

  let popup = document.getElementById('combatMovePopup');
  if (!popup) {
    _createPopupDOM();
    popup = document.getElementById('combatMovePopup');
  }

  // Store callback — accessed by the static confirmCombatMoveYes listener
  popup._onUseMove = onUseMove || null;

  const { attackBonus, damageBonus, attackBreakdown, damageBreakdown, damageDice } = computedData;
  const fmtMod = v => v >= 0 ? `+${v}` : `${v}`;

  // Header colours
  const bgColor = getMoveTypeColor(move[1]);
  const textColor = getTextColorForBackground(bgColor);
  const header = document.getElementById('combatMovePopupHeader');
  const body = document.getElementById('combatMovePopupBody');
  if (header) { header.style.backgroundColor = bgColor; header.style.color = textColor; }
  if (body) { body.style.backgroundColor = bgColor; body.style.color = textColor; }
  const closeBtn = header?.querySelector('.combat-popup-close');
  if (closeBtn) closeBtn.style.color = textColor;

  // Move fields
  document.getElementById('combatMoveNamePopup').textContent = move[0];
  document.getElementById('combatMoveTypePopup').textContent = move[1];
  document.getElementById('cMoveModifier').textContent = move[2] || '—';
  document.getElementById('cMoveAction').textContent = move[3] || '—';
  document.getElementById('cMoveVP').textContent = move[4] || '0';
  document.getElementById('cMoveDuration').textContent = move[5] || '—';
  document.getElementById('cMoveRange').textContent = move[6] || '—';
  document.getElementById('cMoveSize').textContent = size || '—';

  const critEl = document.getElementById('cMoveCritMod');
  if (critEl) {
    critEl.textContent = (critMod ?? 0) > 0 ? `+${critMod}` : (critMod ?? 0) < 0 ? `${critMod}` : '0';
  }

  document.getElementById('cMoveDescription').textContent = move[7] || '';
  const higherEl = document.getElementById('cMoveHigher');
  if (higherEl) higherEl.textContent = move[8] ? `Higher Levels: ${move[8]}` : '';

  // Roll bonuses
  document.getElementById('cAttackBonus').textContent = fmtMod(attackBonus);
  document.getElementById('cAttackBreakdown').textContent = attackBreakdown;
  if (damageDice) {
    document.getElementById('cDamageBonus').textContent =
      damageBonus > 0 ? `${damageDice} + ${damageBonus}` : damageDice;
  } else {
    document.getElementById('cDamageBonus').textContent =
      damageBonus > 0 ? fmtMod(damageBonus) : '—';
  }
  document.getElementById('cDamageBreakdown').textContent = damageBreakdown;

  // Held items
  const heldItemsEl = document.getElementById('cHeldItems');
  if (heldItemsEl) {
    if (heldItemsHTML) {
      heldItemsEl.innerHTML = heldItemsHTML;
      heldItemsEl.style.display = '';
    } else {
      heldItemsEl.style.display = 'none';
    }
  }

  // Trainer path sections
  _renderBattleDice(trainerData);
  _renderTactician(trainerData);
  _renderCommander(trainerData);

  // Use Move button dataset
  const useBtn = document.getElementById('useCombatMoveBtn');
  if (useBtn) {
    useBtn.dataset.moveName = move[0];
    useBtn.dataset.vpCost = move[4] || 0;
  }

  popup.style.display = 'flex';
}

// ── Drain heal popup for pokemon-card page ────────────────────────────────────

/**
 * Show the drain heal popup when a drain move is used outside combat.
 * Prompts for damage dealt, applies floor(damage/2) as HP healing.
 *
 * @param {Array}  pokemonData  - Pokemon data array (index 2=name, 44=maxHp, 45=currentHp)
 * @param {string} moveName
 * @param {Array}  trainerData  - Trainer data array (index 1=trainerName)
 */
export function showDrainHealPopupForCard(pokemonData, moveName, trainerData) {
  let popup = document.getElementById('cardDrainHealPopup');
  if (!popup) {
    popup = document.createElement('div');
    popup.id = 'cardDrainHealPopup';
    popup.className = 'combat-popup-overlay';
    popup.style.display = 'none';
    popup.innerHTML = `
      <div class="combat-popup-content" style="max-width:420px;padding:2rem;">
        <h3 id="cardDrainHealTitle" style="margin:0 0 0.4rem 0;color:#4CAF50;text-align:center;font-size:1.2rem;"></h3>
        <p id="cardDrainHealTarget" style="text-align:center;color:#aaa;margin:0 0 1.4rem 0;font-size:0.9rem;"></p>
        <div style="margin-bottom:1rem;">
          <label style="display:block;color:#FFDE00;font-weight:700;text-transform:uppercase;margin-bottom:0.5rem;font-size:0.88rem;">Damage dealt to opponent:</label>
          <input type="number" id="cardDrainDamageInput" min="0" placeholder="Enter damage dealt..."
            style="width:100%;padding:0.7rem 1rem;background:#3a3a3a;border:2px solid #555;border-radius:8px;color:white;font-size:1rem;box-sizing:border-box;">
        </div>
        <div style="text-align:center;margin-bottom:1.2rem;">
          <span style="color:#FFDE00;font-weight:700;text-transform:uppercase;font-size:0.88rem;">HP Restored: </span>
          <span id="cardDrainHealTotal" style="color:#4CAF50;font-weight:900;font-size:1.1rem;">—</span>
        </div>
        <div style="display:flex;gap:0.8rem;">
          <button id="cardDrainHealConfirm" class="combat-use-move-btn" style="flex:1;background:linear-gradient(135deg,#2E7D32,#1B5E20);" disabled>Apply Heal</button>
          <button id="cardDrainHealSkip" class="combat-use-move-btn" style="flex:1;background:linear-gradient(135deg,#555,#333);">Skip</button>
        </div>
      </div>
    `;
    document.body.appendChild(popup);
  }

  // Populate header info
  const currentHp = parseInt(pokemonData[45]) || 0;
  const maxHp = parseInt(pokemonData[44]) || 0;
  document.getElementById('cardDrainHealTitle').textContent = `🌿 ${moveName} — Drain Heal`;
  document.getElementById('cardDrainHealTarget').textContent =
    `${pokemonData[2]} — ${currentHp}/${maxHp} HP`;
  document.getElementById('cardDrainHealTotal').textContent = '—';

  // Clone input + buttons to remove stale listeners
  const oldInput = document.getElementById('cardDrainDamageInput');
  const newInput = oldInput.cloneNode(true);
  newInput.value = '';
  oldInput.parentNode.replaceChild(newInput, oldInput);

  const oldConfirm = document.getElementById('cardDrainHealConfirm');
  const newConfirm = oldConfirm.cloneNode(true);
  newConfirm.disabled = true;
  oldConfirm.parentNode.replaceChild(newConfirm, oldConfirm);

  const oldSkip = document.getElementById('cardDrainHealSkip');
  const newSkip = oldSkip.cloneNode(true);
  oldSkip.parentNode.replaceChild(newSkip, oldSkip);

  document.getElementById('cardDrainDamageInput').addEventListener('input', function () {
    const dmg = parseInt(this.value);
    const totalEl = document.getElementById('cardDrainHealTotal');
    const confirmBtn = document.getElementById('cardDrainHealConfirm');
    if (!isNaN(dmg) && dmg >= 0) {
      const heal = Math.floor(dmg / 2);
      totalEl.textContent = `${heal} HP`;
      confirmBtn.disabled = heal <= 0;
    } else {
      totalEl.textContent = '—';
      confirmBtn.disabled = true;
    }
  });

  document.getElementById('cardDrainHealConfirm').addEventListener('click', function () {
    const dmg = parseInt(document.getElementById('cardDrainDamageInput').value);
    if (isNaN(dmg) || dmg < 0) return;
    const heal = Math.floor(dmg / 2);
    if (heal <= 0) return;

    const newHp = Math.min((parseInt(pokemonData[45]) || 0) + heal, parseInt(pokemonData[44]) || 0);
    pokemonData[45] = newHp;
    sessionStorage.setItem(`pokemon_${pokemonData[2].toLowerCase()}`, JSON.stringify(pokemonData));

    // Update UI elements on the pokemon-card battle page
    const maxHpVal = parseInt(pokemonData[44]) || 0;
    const hpDisplay = document.getElementById('combatCurrentHP');
    if (hpDisplay) hpDisplay.textContent = `${newHp} / ${maxHpVal}`;
    const hpVal = document.getElementById('currentHpValue');
    if (hpVal) hpVal.textContent = newHp;

    PokemonAPI.updateLiveStats(trainerData[1], pokemonData[2], 'HP', newHp)
      .catch(e => console.error('Drain HP sync:', e));

    showToast(`${pokemonData[2]}: ${moveName} drained ${heal} HP!`, 'success');
    popup.style.display = 'none';
  });

  document.getElementById('cardDrainHealSkip').addEventListener('click', function () {
    popup.style.display = 'none';
  });

  popup.style.display = 'flex';
}
