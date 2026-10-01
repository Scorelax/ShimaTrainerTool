// A "pick one of a participant's own CURRENT statuses" popup -- a different
// shape from effects-popup.js's own dropdowns (type/stat choices pick from a
// small FIXED vocabulary known ahead of time) or move-popup/target-picker's
// own flows (all driven by a move's own pre-authored effects). This instead
// lists whatever's ACTUALLY live on a specific participant right now, read
// straight off their `.statuses` array -- Psycho Shift's own "choose which
// [condition] to transfer" and Searing Flame's own "burn away one [stat]
// effect" both need exactly this, and neither has a fixed list to draw a
// dropdown from the way a stat name or a Pokémon type does. Same
// combat-alert.js-style styling/overlay convention as every other small
// popup in this app, built fresh here since nothing else needed a
// pick-one-of-a-dynamic-list shape before.
import { statusLabel, describeEnds } from './move-effects.js';

function _injectStyles() {
  if (document.getElementById('status-picker-styles')) return;
  const style = document.createElement('style');
  style.id = 'status-picker-styles';
  style.textContent = `
    .status-picker-overlay { position: fixed; top:0; left:0; width:100%; height:100%; background: rgba(0,0,0,0.75); z-index: 1100; justify-content: center; align-items: center; backdrop-filter: blur(3px); }
    .status-picker-box { background: #1e1e34; border: 1px solid rgba(255,255,255,0.12); border-radius: 16px; max-width: 420px; width: 90%; max-height: 80vh; overflow-y: auto; padding: 1.2rem; color: #e0e0e0; box-shadow: 0 10px 40px rgba(0,0,0,0.6); }
    .status-picker-title { font-weight: 800; font-size: 1.05rem; margin-bottom: 0.3rem; }
    .status-picker-message { font-size: 0.88rem; color: #a0a0c0; margin-bottom: 0.8rem; }
    .status-picker-option { display: block; width: 100%; text-align: left; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 0.6rem 0.7rem; margin-bottom: 0.5rem; color: #e0e0e0; cursor: pointer; }
    .status-picker-option:hover { background: rgba(255,255,255,0.12); }
    .status-picker-name { font-weight: 700; }
    .status-picker-sub { font-size: 0.78rem; color: #a0a0c0; }
    .status-picker-empty { font-size: 0.9rem; color: #a0a0c0; text-align: center; padding: 0.6rem 0; }
    .status-picker-cancel { width: 100%; padding: 0.6rem; background: rgba(255,255,255,0.1); color: #e0e0e0; border: none; border-radius: 8px; font-weight: 700; cursor: pointer; margin-top: 0.3rem; }
  `;
  document.head.appendChild(style);
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let _overlay = null;
let _resolve = null;

function _ensureDom() {
  if (_overlay) return;
  _injectStyles();
  _overlay = document.createElement('div');
  _overlay.className = 'status-picker-overlay';
  _overlay.id = 'statusPickerPopup';
  _overlay.style.display = 'none';
  document.body.appendChild(_overlay);
  _overlay.addEventListener('click', (e) => { if (e.target === _overlay) _close(null); });
}

function _close(result) {
  _overlay.style.display = 'none';
  if (_resolve) { _resolve(result); _resolve = null; }
}

/**
 * Shows every status in `statuses` (already pre-filtered by the caller --
 * see Psycho Shift/Searing Flame's own handlers for the "which kind
 * qualifies" logic) as a clickable option, and resolves to whichever one the
 * human picks, or null if cancelled/closed/nothing was eligible to begin
 * with (shown as a plain message, not an empty clickable list).
 */
export async function pickOneStatus(statuses, { title = 'Choose one', message = '' } = {}) {
  _ensureDom();
  const body = !statuses.length
    ? '<div class="status-picker-empty">Nothing eligible right now.</div>'
    : statuses.map((s, i) => `
      <button class="status-picker-option" data-idx="${i}">
        <div class="status-picker-name">${esc(statusLabel(s))}</div>
        <div class="status-picker-sub">${esc(describeEnds(s.ends))}${s.sourceName ? ` · from ${esc(s.sourceName)}` : ''}</div>
      </button>`).join('');
  _overlay.innerHTML = `
    <div class="status-picker-box">
      <div class="status-picker-title">${esc(title)}</div>
      ${message ? `<div class="status-picker-message">${esc(message)}</div>` : ''}
      ${body}
      <button class="status-picker-cancel" id="statusPickerCancel">Cancel</button>
    </div>`;
  _overlay.querySelectorAll('[data-idx]').forEach((btn) => {
    btn.addEventListener('click', () => _close(statuses[Number(btn.dataset.idx)]));
  });
  document.getElementById('statusPickerCancel').addEventListener('click', () => _close(null));
  _overlay.style.display = 'flex';
  return new Promise((resolve) => { _resolve = resolve; });
}
