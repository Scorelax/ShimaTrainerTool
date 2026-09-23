// Dice-roll half of the `heal` effect kind (see move-effects-schema.md's own
// section) -- for a move whose heal amount is rolled ("regain 2d6 + MOVE hit
// points"), not derived from a drain's already-known damage figure (that half
// needs no roll at all, see combat-wip.js's _handleApplyHeal). Same "the app
// shows the structure, a human supplies the die roll" pattern as every other
// roll in this app -- no digital dice here.
function _injectStyles() {
  if (document.getElementById('heal-popup-styles')) return;
  const style = document.createElement('style');
  style.id = 'heal-popup-styles';
  style.textContent = `
    .combat-popup-overlay { position: fixed; top:0; left:0; width:100%; height:100%; background: rgba(0,0,0,0.75); z-index: 1150; justify-content: center; align-items: center; backdrop-filter: blur(3px); }
    .combat-popup-content { background: #1e1e34; border: 1px solid rgba(255,255,255,0.12); border-radius: 16px; max-width: 380px; width: 92%; position: relative; box-shadow: 0 10px 40px rgba(0,0,0,0.6); color: #e0e0e0; }
    .combat-move-popup-header { padding: 1.1rem 1.2rem; border-radius: 16px 16px 0 0; border-bottom: 2px solid rgba(0,0,0,0.3); display: flex; align-items: center; gap: 0.6rem; position: relative; background: rgba(255,255,255,0.05); }
    .combat-move-popup-header h2 { margin: 0; font-size: 1.2rem; font-weight: 900; text-transform: uppercase; }
    .combat-popup-close { position: absolute; top: 0.8rem; right: 0.8rem; background: rgba(0,0,0,0.3); border: none; border-radius: 50%; width: 32px; height: 32px; font-size: 1.2rem; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; color: inherit; }
    .combat-move-popup-body { padding: 1rem 1.2rem; }
    .heal-popup-desc { font-size: 0.9rem; color: #cfd0e0; margin-bottom: 0.8rem; }
    .heal-popup-roll-label { display: block; font-size: 0.85rem; color: #a0a0c0; margin-bottom: 0.4rem; }
    .heal-popup-roll-input {
      width: 100%; box-sizing: border-box; background: #1e1e2e; border: 1px solid rgba(255,255,255,0.2);
      color: #e0e0e0; border-radius: 6px; padding: 0.65rem 0.7rem; font-size: 1.05rem; margin-bottom: 0.7rem;
    }
    .heal-popup-total { text-align: center; font-size: 0.9rem; color: #a0a0c0; margin-bottom: 1rem; min-height: 1.3em; }
    .heal-popup-total strong { color: #2ecc71; font-size: 1.2rem; }
    .combat-use-move-btn { width: 100%; padding: 0.75rem; background: linear-gradient(135deg, #4CAF50, #45A049); color: #fff; border: none; border-radius: 8px; font-size: 1rem; font-weight: 700; cursor: pointer; }
  `;
  document.head.appendChild(style);
}

let _overlay = null;
let _resolve = null;
let _moveModBonus = 0;

function _ensureDom() {
  if (_overlay) return;
  _injectStyles();
  _overlay = document.createElement('div');
  _overlay.className = 'combat-popup-overlay';
  _overlay.id = 'healPopup';
  _overlay.style.display = 'none';
  _overlay.innerHTML = `
    <div class="combat-popup-content">
      <div class="combat-move-popup-header">
        <button id="healPopupClose" class="combat-popup-close">×</button>
        <h2>Heal Roll</h2>
      </div>
      <div class="combat-move-popup-body">
        <div class="heal-popup-desc" id="healPopupDesc"></div>
        <label class="heal-popup-roll-label" for="healPopupInput" id="healPopupLabel">Roll</label>
        <input type="number" id="healPopupInput" class="heal-popup-roll-input" placeholder="Enter what you rolled…">
        <div class="heal-popup-total" id="healPopupTotal"></div>
        <button class="combat-use-move-btn" id="healPopupConfirm">Confirm</button>
      </div>
    </div>`;
  document.body.appendChild(_overlay);

  document.getElementById('healPopupClose').addEventListener('click', () => _close(null));
  _overlay.addEventListener('click', (e) => { if (e.target === _overlay) _close(null); });
  document.getElementById('healPopupInput').addEventListener('input', _updateTotal);
  document.getElementById('healPopupInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') _confirm(); });
  document.getElementById('healPopupConfirm').addEventListener('click', _confirm);
}

function _close(result) {
  if (_overlay) _overlay.style.display = 'none';
  if (_resolve) { _resolve(result); _resolve = null; }
}

function _currentRoll() {
  const raw = parseInt(document.getElementById('healPopupInput').value, 10);
  return Number.isNaN(raw) ? null : raw;
}

function _updateTotal() {
  const el = document.getElementById('healPopupTotal');
  const raw = _currentRoll();
  if (raw === null) { el.innerHTML = ''; return; }
  el.innerHTML = `Total: <strong>${raw + _moveModBonus}</strong> HP`;
}

function _confirm() {
  const raw = _currentRoll();
  if (raw === null) return;
  _close(raw);
}

/**
 * Shows the roll input for a dice-based `heal` effect. `dice` is the formula
 * text ("2d6"), `moveModBonus` the already-computed MOVE-stat figure to add
 * on top (0 if the effect had no `moveMod`). Resolves to the TOTAL healed
 * (roll + moveModBonus, a plain number), or null if closed without entering
 * one.
 */
export function promptHealRoll({ dice, moveModBonus = 0, targetName = '?', moveName = '?' } = {}) {
  _ensureDom();
  _moveModBonus = moveModBonus;
  document.getElementById('healPopupDesc').textContent = `${moveName} heals ${targetName}.`;
  document.getElementById('healPopupLabel').textContent =
    `Roll ${dice}${moveModBonus ? ` (+${moveModBonus} from MOVE added automatically)` : ''}`;
  const input = document.getElementById('healPopupInput');
  input.value = '';
  _updateTotal();
  _overlay.style.display = 'flex';
  setTimeout(() => input.focus(), 50);
  return new Promise((resolve) => {
    _resolve = (raw) => resolve(raw === null ? null : raw + _moveModBonus);
  });
}
