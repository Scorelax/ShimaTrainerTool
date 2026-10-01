// A read-only-board, "click an unoccupied cell within range" popup for a
// move's own GRANTED reposition -- Strafe's own "fly to a position within
// 30ft. of the target" and Pasta Portal's own "reappear at an unoccupied
// point within range" both need this exact shape: pick a destination, NOT
// ordinary budgeted movement (no speed/movementUsed check at all, same
// "ignoring your flying speed"/"disappear and reappear" wording neither
// move treats as a normal move action).
//
// Deliberately a NEW, separate overlay/module rather than retrofitting
// battle-map-popup.js's own stage/confirm click flow -- that's a live,
// heavily-used tool built for ORDINARY budgeted movement (Teleport was
// explicitly deferred earlier specifically to avoid a blind refactor of
// it). This reuses battle-map-grid.js's own pure rendering helpers (the
// same ones that module already uses) but owns its own DOM/state
// entirely, so nothing about ordinary movement can regress from building
// this. Resolved via CombatAPI.setTokenPosition -- the SAME unrestricted
// DM/setup action Ally Switch's own teleport_swap already reuses, since
// this is explicitly not a `move-token` call either.
import { CombatAPI } from '../api.js';
import { gridCellsHtml, gridTemplateStyle, cellRect, footprintForSize, footprintCells } from './battle-map-grid.js';
import { patchPortraitMedia } from './sprite-media.js';
import { visibleToViewer } from './combat-visibility.js';
import { showCombatAlert } from './combat-alert.js';

function _injectStyles() {
  if (document.getElementById('reposition-picker-styles')) return;
  const style = document.createElement('style');
  style.id = 'reposition-picker-styles';
  style.textContent = `
    .combat-popup-overlay { position: fixed; top:0; left:0; width:100%; height:100%; background: rgba(0,0,0,0.75); z-index: 1300; justify-content: center; align-items: center; backdrop-filter: blur(3px); }
    .combat-popup-content { background: #1e1e34; border: 1px solid rgba(255,255,255,0.12); border-radius: 16px; max-width: 640px; width: 94%; max-height: 90vh; overflow-y: auto; position: relative; box-shadow: 0 10px 40px rgba(0,0,0,0.6); color: #e0e0e0; }
    .combat-move-popup-header { padding: 1.1rem 1.2rem; border-radius: 16px 16px 0 0; border-bottom: 2px solid rgba(0,0,0,0.3); display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; position: relative; background: rgba(255,255,255,0.05); }
    .combat-move-popup-header h2 { margin: 0; font-size: 1.2rem; font-weight: 900; text-transform: uppercase; }
    .combat-popup-close { position: absolute; top: 0.8rem; right: 0.8rem; background: rgba(0,0,0,0.3); border: none; border-radius: 50%; width: 32px; height: 32px; font-size: 1.2rem; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; color: inherit; }
    .combat-move-popup-body { padding: 1rem 1.2rem; }
    .rpick-hint { font-size: 0.85rem; color: #cfd0e0; margin-bottom: 0.6rem; }
    .rpick-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin-bottom: 0.6rem; }
    .rpick-row button { border: none; border-radius: 6px; padding: 0.4rem 0.9rem; font-size: 0.85rem; font-weight: 700; cursor: pointer; }
    .rpick-confirm-btn { background: linear-gradient(135deg, #27ae60, #1e8449); color: #fff; }
    .rpick-confirm-btn:disabled { background: #444; color: #888; cursor: not-allowed; }
    .rpick-cancel-btn { background: rgba(255,255,255,0.12); color: #e0e0e0; }
    .rpick-stage { position: relative; width: 100%; background: #0a0a12; border-radius: 8px; overflow: hidden; background-size: cover; background-position: center; }
    .rpick-grid { position: absolute; inset: 0; display: grid; gap: 2px; background: #1a1a24; }
    .rpick-stage.has-bg .rpick-grid { background: rgba(26,26,36,0.35); }
    .rpick-cell { background: #20202e; }
    .rpick-stage.has-bg .rpick-cell { background: rgba(32,32,46,0.35); }
    .rpick-cell.in-range { cursor: pointer; }
    .rpick-cell.in-range:hover { outline: 1px solid rgba(255,215,0,0.5); outline-offset: -1px; }
    .rpick-cell.out-of-range { opacity: 0.35; }
    .rpick-cell.occupied { opacity: 0.35; }
    .rpick-cell.staged { outline: 2px solid #FFD700; outline-offset: -2px; }
    .rpick-cell.anchor { outline: 2px solid rgba(231,115,115,0.7); outline-offset: -2px; }
    .rpick-tokens { position: absolute; inset: 0; pointer-events: none; }
    .rpick-token { position: absolute; display: flex; padding: 3px; box-sizing: border-box; }
    .rpick-token-portrait { width: 100%; height: 100%; }
    .rpick-token-portrait img, .rpick-token-portrait video { width: 100%; height: 100%; object-fit: contain; filter: drop-shadow(0 0 4px rgba(0,0,0,0.9)); }
  `;
  document.head.appendChild(style);
}

let _overlay = null;
let _resolve = null;

function _ensureDom() {
  if (_overlay) return;
  _injectStyles();
  _overlay = document.createElement('div');
  _overlay.className = 'combat-popup-overlay';
  _overlay.id = 'repositionPickerPopup';
  _overlay.style.display = 'none';
  _overlay.innerHTML = `
    <div class="combat-popup-content">
      <div class="combat-move-popup-header">
        <button id="rpickClose" class="combat-popup-close">×</button>
        <h2 id="rpickTitle">Choose a cell</h2>
      </div>
      <div class="combat-move-popup-body">
        <div class="rpick-hint" id="rpickHint"></div>
        <div class="rpick-row" id="rpickConfirmRow"></div>
        <div class="rpick-stage" id="rpickStage">
          <div class="rpick-grid" id="rpickGrid"></div>
          <div class="rpick-tokens" id="rpickTokens"></div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(_overlay);
  document.getElementById('rpickClose').addEventListener('click', () => _close(null));
  _overlay.addEventListener('click', (e) => { if (e.target === _overlay) _close(null); });
}

function _close(result) {
  if (_overlay) _overlay.style.display = 'none';
  if (_resolve) { _resolve(result); _resolve = null; }
}

function _distanceFt(fromCol, fromRow, toCol, toRow) {
  return Math.max(Math.abs(toCol - fromCol), Math.abs(toRow - fromRow)) * 5;
}

let _state = null;

function _occupiedCells(session, excludeTokenId) {
  const occupied = new Set();
  for (const [id, pos] of Object.entries(session.board.tokens || {})) {
    if (id === excludeTokenId) continue;
    const p = session.participants[id];
    const size = footprintForSize(p?.size);
    for (const c of footprintCells(pos.col, pos.row, size)) occupied.add(`${c.col},${c.row}`);
  }
  return occupied;
}

function _render() {
  const { session, tokenId, anchorCol, anchorRow, maxFt, hint, staged, occupied } = _state;
  document.getElementById('rpickHint').textContent = staged
    ? 'Confirm the move below, or click a different cell.'
    : hint;

  const confirmRow = document.getElementById('rpickConfirmRow');
  confirmRow.innerHTML = staged
    ? `<span>Move to (${staged.col}, ${staged.row})</span>
       <button type="button" class="rpick-confirm-btn" id="rpickConfirm">Confirm</button>
       <button type="button" class="rpick-cancel-btn" id="rpickCancelStage">Cancel</button>`
    : '';
  document.getElementById('rpickCancelStage')?.addEventListener('click', () => { _state.staged = null; _render(); });
  document.getElementById('rpickConfirm')?.addEventListener('click', async () => {
    const dest = _state.staged;
    try {
      await CombatAPI.setTokenPosition(tokenId, dest.col, dest.row);
    } catch (err) {
      showCombatAlert(err.message, { title: 'Error' });
      return;
    }
    _close(dest);
  });

  const stageEl = document.getElementById('rpickStage');
  const { cols, rows } = session.board.grid;
  stageEl.style.aspectRatio = `${cols} / ${rows}`;
  const bgUrl = session.board.backgroundImage;
  stageEl.classList.toggle('has-bg', !!bgUrl);
  stageEl.style.backgroundImage = bgUrl ? `url(${bgUrl})` : '';

  const gridEl = document.getElementById('rpickGrid');
  gridEl.setAttribute('style', gridTemplateStyle(session.board));
  gridEl.innerHTML = gridCellsHtml(session.board, 'rpick-cell');
  gridEl.querySelectorAll('[data-cell]').forEach((cell) => {
    const [col, row] = cell.dataset.cell.split(',').map(Number);
    const dist = _distanceFt(anchorCol, anchorRow, col, row);
    const inRange = dist <= maxFt;
    const isOccupied = occupied.has(`${col},${row}`);
    if (col === anchorCol && row === anchorRow) cell.classList.add('anchor');
    if (!inRange) cell.classList.add('out-of-range');
    else if (isOccupied) cell.classList.add('occupied');
    else cell.classList.add('in-range');
    if (staged && col === staged.col && row === staged.row) cell.classList.add('staged');
    if (inRange && !isOccupied) {
      cell.addEventListener('click', () => { _state.staged = { col, row }; _render(); });
    }
  });

  const tokenLayer = document.getElementById('rpickTokens');
  tokenLayer.innerHTML = '';
  Object.entries(session.board.tokens || {}).forEach(([id, pos]) => {
    const p = session.participants[id];
    if (!p) return;
    const el = document.createElement('div');
    el.className = 'rpick-token';
    const name = visibleToViewer(p, 'name') ? p.name : '???';
    el.title = name;
    Object.assign(el.style, cellRect(session.board, pos.col, pos.row, footprintForSize(p.size)));
    el.innerHTML = '<div class="rpick-token-portrait"></div>';
    patchPortraitMedia(el.querySelector('.rpick-token-portrait'), p.image, name);
    tokenLayer.appendChild(el);
  });
}

/**
 * Shows the board (read-only -- every token's CURRENT position, no
 * ordinary movement UI at all) and lets the human click one unoccupied
 * cell within `maxFt` of (`anchorCol`, `anchorRow`) to move `tokenId`
 * there. Resolves to `{col, row}` once confirmed (the move already
 * happened server-side via setTokenPosition by the time this resolves),
 * or null if closed/cancelled without confirming. No board at all (no
 * battle map set up for this session) resolves to null immediately --
 * same "can't offer it, tell the table to place it by hand" fallback tone
 * as every other "can't auto-detect" spot in this app.
 */
export function pickRepositionCell(session, tokenId, anchorCol, anchorRow, maxFt, { title = 'Choose a cell', hint = 'Click an unoccupied cell within range.' } = {}) {
  if (!session?.board?.grid) return Promise.resolve(null);
  _ensureDom();
  document.getElementById('rpickTitle').textContent = title;
  _state = { session, tokenId, anchorCol, anchorRow, maxFt, hint, staged: null, occupied: _occupiedCells(session, tokenId) };
  _render();
  _overlay.style.display = 'flex';
  return new Promise((resolve) => { _resolve = resolve; });
}
