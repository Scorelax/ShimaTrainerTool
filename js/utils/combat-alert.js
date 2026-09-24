// A single-button "OK" popup styled like the rest of the combat tool's own
// popups (move-popup.js / target-picker.js's .combat-popup-overlay look),
// used in place of the browser's native alert() -- this app deliberately
// suppresses toast notifications for tablet play (see notifications.js), and
// a native alert() blocks the whole tab (stealing focus, pausing playing
// media) rather than just showing a message, which is the opposite of that
// same "don't interrupt the table" intent. Despite the "combat" name, this
// is the only real working modal-alert in the app (notifications.js's own
// showError/showSuccess are no-ops, toasts intentionally suppressed) -- a
// few non-combat pages (pokemon-card.js, trainer-info.js, trainer-card.js)
// import it too for exactly that reason, not a copy/paste mistake.
function _injectStyles() {
  if (document.getElementById('combat-alert-styles')) return;
  const style = document.createElement('style');
  style.id = 'combat-alert-styles';
  style.textContent = `
    .combat-alert-overlay { position: fixed; top:0; left:0; width:100%; height:100%; background: rgba(0,0,0,0.75); z-index: 1100; justify-content: center; align-items: center; backdrop-filter: blur(3px); }
    .combat-alert-box { background: #1e1e34; border: 1px solid rgba(255,255,255,0.12); border-radius: 16px; max-width: 380px; width: 90%; padding: 1.4rem; text-align: center; color: #e0e0e0; box-shadow: 0 10px 40px rgba(0,0,0,0.6); }
    .combat-alert-title { font-weight: 800; font-size: 1.05rem; margin-bottom: 0.5rem; }
    .combat-alert-message { font-size: 0.95rem; line-height: 1.5; margin-bottom: 1.1rem; white-space: pre-line; }
    .combat-alert-ok { width: 100%; padding: 0.65rem; background: linear-gradient(135deg, #4CAF50, #45A049); color: #fff; border: none; border-radius: 8px; font-size: 1rem; font-weight: 700; cursor: pointer; }
    .combat-alert-actions { display: flex; gap: 0.7rem; }
    .combat-alert-actions .combat-alert-ok { flex: 1; }
    .combat-alert-cancel { background: rgba(255,255,255,0.1) !important; }
    .combat-alert-number-input {
      width: 100%; box-sizing: border-box; background: #1e1e2e; border: 1px solid rgba(255,255,255,0.2);
      color: #e0e0e0; border-radius: 6px; padding: 0.6rem 0.7rem; font-size: 1.1rem; text-align: center;
      margin-bottom: 1rem;
    }
  `;
  document.head.appendChild(style);
}

let _overlay = null;
let _resolve = null;
let _confirmOverlay = null;
let _confirmResolve = null;

function _ensureDom() {
  if (_overlay) return;
  _injectStyles();
  _overlay = document.createElement('div');
  _overlay.className = 'combat-alert-overlay';
  _overlay.id = 'combatAlertPopup';
  _overlay.style.display = 'none';
  _overlay.innerHTML = `
    <div class="combat-alert-box">
      <div class="combat-alert-title" id="combatAlertTitle"></div>
      <div class="combat-alert-message" id="combatAlertMessage"></div>
      <button class="combat-alert-ok" id="combatAlertOk">OK</button>
    </div>`;
  document.body.appendChild(_overlay);
  const close = () => { _overlay.style.display = 'none'; if (_resolve) { _resolve(); _resolve = null; } };
  document.getElementById('combatAlertOk').addEventListener('click', close);
  _overlay.addEventListener('click', (e) => { if (e.target === _overlay) close(); });
}

/** Shows a styled, non-blocking "OK" popup and resolves once dismissed --
 * drop-in replacement for `alert(message)` in the combat tool's own pages. */
export function showCombatAlert(message, { title = '' } = {}) {
  _ensureDom();
  document.getElementById('combatAlertTitle').textContent = title;
  document.getElementById('combatAlertTitle').style.display = title ? 'block' : 'none';
  document.getElementById('combatAlertMessage').textContent = message;
  _overlay.style.display = 'flex';
  return new Promise((resolve) => { _resolve = resolve; });
}

function _ensureConfirmDom() {
  if (_confirmOverlay) return;
  _injectStyles();
  _confirmOverlay = document.createElement('div');
  _confirmOverlay.className = 'combat-alert-overlay';
  _confirmOverlay.id = 'combatConfirmPopup2';
  _confirmOverlay.style.display = 'none';
  _confirmOverlay.innerHTML = `
    <div class="combat-alert-box">
      <div class="combat-alert-title" id="combatConfirmTitle2"></div>
      <div class="combat-alert-message" id="combatConfirmMessage2"></div>
      <div class="combat-alert-actions">
        <button class="combat-alert-ok combat-alert-cancel" id="combatConfirmNo2"></button>
        <button class="combat-alert-ok" id="combatConfirmYes2"></button>
      </div>
    </div>`;
  document.body.appendChild(_confirmOverlay);
  const close = (result) => { _confirmOverlay.style.display = 'none'; if (_confirmResolve) { _confirmResolve(result); _confirmResolve = null; } };
  document.getElementById('combatConfirmYes2').addEventListener('click', () => close(true));
  document.getElementById('combatConfirmNo2').addEventListener('click', () => close(false));
  _confirmOverlay.addEventListener('click', (e) => { if (e.target === _confirmOverlay) close(false); });
}

/** Yes/No variant of showCombatAlert -- for "hit again?"-style loops
 * (multi_hit_same_target/multi_hit_choice, see combat-wip.js) where the
 * app needs an actual answer, not just an acknowledgement. Resolves to
 * true/false; closing without choosing (backdrop click) counts as false. */
export function showCombatConfirm(message, { title = '', yesLabel = 'Yes', noLabel = 'No' } = {}) {
  _ensureConfirmDom();
  document.getElementById('combatConfirmTitle2').textContent = title;
  document.getElementById('combatConfirmTitle2').style.display = title ? 'block' : 'none';
  document.getElementById('combatConfirmMessage2').textContent = message;
  document.getElementById('combatConfirmYes2').textContent = yesLabel;
  document.getElementById('combatConfirmNo2').textContent = noLabel;
  _confirmOverlay.style.display = 'flex';
  return new Promise((resolve) => { _confirmResolve = resolve; });
}

let _promptOverlay = null;
let _promptResolve = null;

function _ensurePromptDom() {
  if (_promptOverlay) return;
  _injectStyles();
  _promptOverlay = document.createElement('div');
  _promptOverlay.className = 'combat-alert-overlay';
  _promptOverlay.id = 'combatPromptPopup';
  _promptOverlay.style.display = 'none';
  _promptOverlay.innerHTML = `
    <div class="combat-alert-box">
      <div class="combat-alert-title" id="combatPromptTitle"></div>
      <div class="combat-alert-message" id="combatPromptMessage"></div>
      <input type="number" class="combat-alert-number-input" id="combatPromptInput" inputmode="numeric">
      <div class="combat-alert-actions">
        <button class="combat-alert-ok combat-alert-cancel" id="combatPromptCancel">Cancel</button>
        <button class="combat-alert-ok" id="combatPromptOk">OK</button>
      </div>
    </div>`;
  document.body.appendChild(_promptOverlay);
  const submit = () => {
    const val = parseInt(document.getElementById('combatPromptInput').value, 10);
    close(Number.isNaN(val) ? null : val);
  };
  const close = (result) => { _promptOverlay.style.display = 'none'; if (_promptResolve) { _promptResolve(result); _promptResolve = null; } };
  document.getElementById('combatPromptOk').addEventListener('click', submit);
  document.getElementById('combatPromptCancel').addEventListener('click', () => close(null));
  document.getElementById('combatPromptInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  _promptOverlay.addEventListener('click', (e) => { if (e.target === _promptOverlay) close(null); });
}

/** A numeric-input variant of showCombatConfirm -- for a move whose damage
 * depends on something this app has no other way to know (Formation
 * Strike's own "how many creatures are in your formation"), asked once per
 * use rather than tracked as state. Resolves to the entered integer, or
 * null if cancelled/closed/left blank -- the caller decides what null
 * means for its own move (Formation Strike treats it as "cancel the move
 * entirely", not "assume 1"). */
export function showCombatPrompt(message, { title = '', defaultValue = '', min = 1 } = {}) {
  _ensurePromptDom();
  document.getElementById('combatPromptTitle').textContent = title;
  document.getElementById('combatPromptTitle').style.display = title ? 'block' : 'none';
  document.getElementById('combatPromptMessage').textContent = message;
  const input = document.getElementById('combatPromptInput');
  input.value = defaultValue;
  input.min = min;
  _promptOverlay.style.display = 'flex';
  setTimeout(() => input.focus(), 50);
  return new Promise((resolve) => { _promptResolve = resolve; });
}
