// Attract's own effect (see move-effects-schema.md's `reroll_damage` section):
// once the attacker fails the forced WIS save, they reroll the damage they
// already dealt and take the lower result. Shows the original amount, takes
// the new roll (the table's already-computed total, same convention as every
// other roll input in this app -- no modifier re-added here, the human
// already folded that in the first time), and reports the lower of the two.
// Resolves to the new roll (a number), or null if closed without one.
function _injectStyles() {
  if (document.getElementById('reroll-damage-popup-styles')) return;
  const style = document.createElement('style');
  style.id = 'reroll-damage-popup-styles';
  style.textContent = `
    .combat-popup-overlay { position: fixed; top:0; left:0; width:100%; height:100%; background: rgba(0,0,0,0.75); z-index: 1150; justify-content: center; align-items: center; backdrop-filter: blur(3px); }
    .combat-popup-content { background: #1e1e34; border: 1px solid rgba(255,255,255,0.12); border-radius: 16px; max-width: 380px; width: 92%; position: relative; box-shadow: 0 10px 40px rgba(0,0,0,0.6); color: #e0e0e0; }
    .combat-move-popup-header { padding: 1.1rem 1.2rem; border-radius: 16px 16px 0 0; border-bottom: 2px solid rgba(0,0,0,0.3); display: flex; align-items: center; gap: 0.6rem; position: relative; background: rgba(255,255,255,0.05); }
    .combat-move-popup-header h2 { margin: 0; font-size: 1.2rem; font-weight: 900; text-transform: uppercase; }
    .combat-popup-close { position: absolute; top: 0.8rem; right: 0.8rem; background: rgba(0,0,0,0.3); border: none; border-radius: 50%; width: 32px; height: 32px; font-size: 1.2rem; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; color: inherit; }
    .combat-move-popup-body { padding: 1rem 1.2rem; }
    .reroll-damage-desc { font-size: 0.9rem; color: #cfd0e0; margin-bottom: 0.8rem; }
    .reroll-damage-original { text-align: center; font-size: 0.95rem; margin-bottom: 1rem; }
    .reroll-damage-original strong { color: #FFD700; font-size: 1.3rem; }
    .reroll-damage-roll-label { display: block; font-size: 0.85rem; color: #a0a0c0; margin-bottom: 0.4rem; }
    .reroll-damage-roll-input {
      width: 100%; box-sizing: border-box; background: #1e1e2e; border: 1px solid rgba(255,255,255,0.2);
      color: #e0e0e0; border-radius: 6px; padding: 0.65rem 0.7rem; font-size: 1.05rem; margin-bottom: 0.7rem;
    }
    .reroll-damage-total { text-align: center; font-size: 0.9rem; color: #a0a0c0; margin-bottom: 1rem; min-height: 1.3em; }
    .reroll-damage-total strong { color: #FFD700; font-size: 1.1rem; }
    .combat-use-move-btn { width: 100%; padding: 0.75rem; background: linear-gradient(135deg, #4CAF50, #45A049); color: #fff; border: none; border-radius: 8px; font-size: 1rem; font-weight: 700; cursor: pointer; }
  `;
  document.head.appendChild(style);
}

let _overlay = null;
let _resolve = null;
let _originalAmount = 0;

function _ensureDom() {
  if (_overlay) return;
  _injectStyles();
  _overlay = document.createElement('div');
  _overlay.className = 'combat-popup-overlay';
  _overlay.id = 'rerollDamagePopup';
  _overlay.style.display = 'none';
  _overlay.innerHTML = `
    <div class="combat-popup-content">
      <div class="combat-move-popup-header">
        <button id="rerollDamageClose" class="combat-popup-close">×</button>
        <h2>Reroll Damage</h2>
      </div>
      <div class="combat-move-popup-body">
        <div class="reroll-damage-desc" id="rerollDamageDesc"></div>
        <div class="reroll-damage-original">Original damage: <strong id="rerollDamageOriginal"></strong></div>
        <label class="reroll-damage-roll-label" for="rerollDamageInput">New damage roll (total)</label>
        <input type="number" id="rerollDamageInput" class="reroll-damage-roll-input" placeholder="Enter the rerolled total…">
        <div class="reroll-damage-total" id="rerollDamageOutcome"></div>
        <button class="combat-use-move-btn" id="rerollDamageConfirm">Confirm</button>
      </div>
    </div>`;
  document.body.appendChild(_overlay);

  document.getElementById('rerollDamageClose').addEventListener('click', () => _close(null));
  _overlay.addEventListener('click', (e) => { if (e.target === _overlay) _close(null); });
  document.getElementById('rerollDamageInput').addEventListener('input', _updateOutcome);
  document.getElementById('rerollDamageInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') _confirm(); });
  document.getElementById('rerollDamageConfirm').addEventListener('click', _confirm);
}

function _close(result) {
  if (_overlay) _overlay.style.display = 'none';
  if (_resolve) { _resolve(result); _resolve = null; }
}

function _currentRoll() {
  const raw = parseInt(document.getElementById('rerollDamageInput').value, 10);
  return Number.isNaN(raw) ? null : raw;
}

function _updateOutcome() {
  const el = document.getElementById('rerollDamageOutcome');
  const raw = _currentRoll();
  if (raw === null) { el.innerHTML = ''; return; }
  const lower = Math.min(_originalAmount, raw);
  el.innerHTML = raw < _originalAmount
    ? `Lower — <strong>${lower}</strong> damage stands, ${_originalAmount - lower} HP refunded`
    : `Not lower — <strong>${_originalAmount}</strong> damage stands, nothing changes`;
}

function _confirm() {
  const raw = _currentRoll();
  if (raw === null) return;
  _close(raw);
}

/**
 * Shows the reroll input for Attract's failed-save effect. `originalAmount`
 * is the damage already applied (from the log entry _handleRerollDamage
 * found); `attackerName`/`targetName` fill the description line. Resolves
 * to the new roll (a plain number, whatever the human typed in), or null if
 * closed without entering one -- the caller decides what "closed" means
 * (nothing changes, same as any other cancelled popup in this app).
 */
export function promptRerollDamage({ originalAmount, attackerName = '?', targetName = '?' } = {}) {
  _ensureDom();
  _originalAmount = originalAmount;
  document.getElementById('rerollDamageDesc').textContent =
    `${attackerName} failed the WIS save -- reroll the damage dealt to ${targetName} and take the lower result.`;
  document.getElementById('rerollDamageOriginal').textContent = originalAmount;
  const input = document.getElementById('rerollDamageInput');
  input.value = '';
  _updateOutcome();
  _overlay.style.display = 'flex';
  setTimeout(() => input.focus(), 50);
  return new Promise((resolve) => { _resolve = resolve; });
}
