// Checkbox target-selection popup for multi_hit_aoe moves (see combat-wip.js's
// _handleMultiHitAoe) -- "who's actually in the blast radius" isn't
// something this app tracks automatically (no precise range/positioning
// checks exist yet, see battle-map-popup.js's own deferred range/distance
// note), so a human picks who was caught in it, same "app shows the
// structure, a human supplies the table-specific answer" pattern as
// everything else in this flow. Resolving each selected target's actual
// hit (save or attack roll, damage or not) happens elsewhere -- this popup
// only returns WHO, not what happens to them.
import { CombatAPI } from '../api.js';
import { spriteMediaHtml } from './sprite-media.js';
import { visibleToViewer } from './combat-visibility.js';

function _injectStyles() {
  if (document.getElementById('multi-target-picker-styles')) return;
  const style = document.createElement('style');
  style.id = 'multi-target-picker-styles';
  style.textContent = `
    .combat-popup-overlay { position: fixed; top:0; left:0; width:100%; height:100%; background: rgba(0,0,0,0.75); z-index: 1000; justify-content: center; align-items: center; backdrop-filter: blur(3px); }
    .combat-popup-content { background: #1e1e34; border: 1px solid rgba(255,255,255,0.12); border-radius: 16px; max-width: 480px; width: 92%; max-height: 85vh; overflow-y: auto; position: relative; box-shadow: 0 10px 40px rgba(0,0,0,0.6); color: #e0e0e0; }
    .combat-move-popup-header { padding: 1.1rem 1.2rem; border-radius: 16px 16px 0 0; border-bottom: 2px solid rgba(0,0,0,0.3); display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; position: relative; background: rgba(255,255,255,0.05); }
    .combat-move-popup-header h2 { margin: 0; font-size: 1.4rem; font-weight: 900; text-transform: uppercase; }
    .combat-popup-close { position: absolute; top: 0.8rem; right: 0.8rem; background: rgba(0,0,0,0.3); border: none; border-radius: 50%; width: 32px; height: 32px; font-size: 1.2rem; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; color: inherit; }
    .combat-move-popup-body { padding: 1rem 1.2rem; }
    .combat-use-move-btn { width: 100%; padding: 0.75rem; background: linear-gradient(135deg, #4CAF50, #45A049); color: #fff; border: none; border-radius: 8px; font-size: 1rem; font-weight: 700; cursor: pointer; }
    .combat-use-move-btn:disabled { opacity: 0.45; cursor: not-allowed; }
    .mtp-hint { font-size: 0.8rem; color: #a0a0c0; margin-bottom: 0.7rem; }
    .mtp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 0.6rem; margin-bottom: 1rem; }
    .mtp-card {
      background: rgba(255,255,255,0.06); border: 2px solid transparent; border-radius: 10px;
      padding: 0.6rem; text-align: center; cursor: pointer; color: inherit; font: inherit; position: relative;
    }
    .mtp-card.selected { border-color: #FFD700; background: rgba(255,215,0,0.12); }
    .mtp-portrait { width: 52px; height: 52px; margin: 0 auto 0.3rem; }
    .mtp-portrait img, .mtp-portrait video { width: 100%; height: 100%; object-fit: contain; }
    .mtp-name { font-size: 0.8rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .mtp-check { position: absolute; top: 4px; right: 4px; width: 18px; height: 18px; border-radius: 4px; border: 2px solid rgba(255,255,255,0.4); background: rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; font-size: 0.75rem; }
    .mtp-card.selected .mtp-check { background: #FFD700; border-color: #FFD700; color: #1e1e34; }
  `;
  document.head.appendChild(style);
}

let _overlay = null;
let _resolve = null;
let _selected = new Set();

function _ensureDom() {
  if (_overlay) return;
  _injectStyles();
  _overlay = document.createElement('div');
  _overlay.className = 'combat-popup-overlay';
  _overlay.id = 'multiTargetPickerPopup';
  _overlay.style.display = 'none';
  _overlay.innerHTML = `
    <div class="combat-popup-content">
      <div class="combat-move-popup-header">
        <button id="mtpClose" class="combat-popup-close">×</button>
        <h2>Who's Caught In It?</h2>
      </div>
      <div class="combat-move-popup-body">
        <div class="mtp-hint">Tap everyone this move actually hit -- the app doesn't track blast range automatically.</div>
        <div class="mtp-grid" id="mtpGrid"></div>
        <button class="combat-use-move-btn" id="mtpConfirm" disabled>Confirm Targets</button>
      </div>
    </div>
  `;
  document.body.appendChild(_overlay);
  document.getElementById('mtpClose').addEventListener('click', () => _close(null));
  _overlay.addEventListener('click', (e) => { if (e.target === _overlay) _close(null); });
  document.getElementById('mtpConfirm').addEventListener('click', () => _close([..._selected]));
}

function _close(result) {
  if (_overlay) _overlay.style.display = 'none';
  if (_resolve) { _resolve(result); _resolve = null; }
}

function _cardHtml(p) {
  const name = visibleToViewer(p, 'name') ? p.name : '???';
  return `
    <button type="button" class="mtp-card" data-target-id="${p.id}">
      <div class="mtp-check">✓</div>
      <div class="mtp-portrait">${spriteMediaHtml(p.image, name)}</div>
      <div class="mtp-name">${name}</div>
    </button>`;
}

/**
 * Shows the checkbox target grid, resolves to an array of selected
 * participant ids (empty array if confirmed with none checked), or null if
 * closed without confirming.
 */
export async function pickMultipleTargets(casterId) {
  const result = await CombatAPI.getState();
  const session = result.status === 'success' ? result.data : null;
  if (!session || !session.active) return null;

  const participants = Object.values(session.participants).filter(p => p.id !== casterId);
  if (!participants.length) return null;

  _ensureDom();
  _selected = new Set();
  const grid = document.getElementById('mtpGrid');
  grid.innerHTML = participants.map(p => _cardHtml(p)).join('');
  const confirmBtn = document.getElementById('mtpConfirm');
  confirmBtn.disabled = true;
  grid.querySelectorAll('[data-target-id]').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.targetId;
      if (_selected.has(id)) { _selected.delete(id); card.classList.remove('selected'); }
      else { _selected.add(id); card.classList.add('selected'); }
      confirmBtn.disabled = _selected.size === 0;
    });
  });

  _overlay.style.display = 'flex';
  return new Promise((resolve) => { _resolve = resolve; });
}
