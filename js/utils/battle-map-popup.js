// Interactive in-app battle map popup -- lets a player VIEW the same board
// the table kiosk screen (battle-map.html) shows, and MOVE their own
// token(s) by clicking one, then clicking a destination cell. This is
// deliberately the simplest possible version: no turn-gating, no range/
// distance limits, no terrain blocking -- the user explicitly asked to
// prove movement works first and layer real movement rules on later.
// Ownership ("is this token mine") is enforced client-side only, via each
// participant's `owner` field (set by combat-wip.js's "Join as yourself"
// flow) -- see routes_combat.py's set-token-position, which stays
// unrestricted server-side, same trust model as this WIP tool's other
// DM-facing actions.
//
// Mirrors move-popup.js's overlay pattern (create the DOM once, reuse
// across calls) and target-picker.js's self-contained-styles approach
// (injects its own copy of the shared .combat-popup-* base rules rather
// than assuming another module already did).
import { CombatAPI } from '../api.js';
import { patchPortraitMedia } from './sprite-media.js';
import { visibleToViewer } from './combat-visibility.js';

function _injectStyles() {
  if (document.getElementById('battle-map-popup-styles')) return;
  const style = document.createElement('style');
  style.id = 'battle-map-popup-styles';
  style.textContent = `
    .combat-popup-overlay { position: fixed; top:0; left:0; width:100%; height:100%; background: rgba(0,0,0,0.75); z-index: 1000; justify-content: center; align-items: center; backdrop-filter: blur(3px); }
    .combat-popup-content { background: #1e1e34; border: 1px solid rgba(255,255,255,0.12); border-radius: 16px; max-width: 640px; width: 94%; max-height: 90vh; overflow-y: auto; position: relative; box-shadow: 0 10px 40px rgba(0,0,0,0.6); color: #e0e0e0; }
    .combat-move-popup-header { padding: 1.1rem 1.2rem; border-radius: 16px 16px 0 0; border-bottom: 2px solid rgba(0,0,0,0.3); display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; position: relative; background: rgba(255,255,255,0.05); }
    .combat-move-popup-header h2 { margin: 0; font-size: 1.4rem; font-weight: 900; text-transform: uppercase; }
    .combat-popup-close { position: absolute; top: 0.8rem; right: 0.8rem; background: rgba(0,0,0,0.3); border: none; border-radius: 50%; width: 32px; height: 32px; font-size: 1.2rem; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; color: inherit; }
    .combat-move-popup-body { padding: 1rem 1.2rem; }

    .bmap-hint { font-size: 0.8rem; color: #a0a0c0; margin-bottom: 0.6rem; }
    .bmap-stage { position: relative; width: 100%; aspect-ratio: 5 / 4; background: #0a0a12; border-radius: 8px; overflow: hidden; }
    .bmap-grid { position: absolute; inset: 0; display: grid; gap: 2px; background: #1a1a24; }
    .bmap-cell { background: #20202e; cursor: pointer; }
    .bmap-cell:hover { outline: 1px solid rgba(255,215,0,0.5); outline-offset: -1px; }
    .bmap-cell.marked {
      background: #4a3520; display: flex; align-items: center; justify-content: center;
      font-size: 0.6rem; color: #e0c080; overflow: hidden; text-align: center; padding: 1px; box-sizing: border-box;
    }
    .bmap-tokens { position: absolute; inset: 0; }
    .bmap-token {
      position: absolute; display: flex; flex-direction: column; align-items: center; justify-content: center;
      padding: 3px; box-sizing: border-box; pointer-events: none;
    }
    .bmap-token.mine { pointer-events: auto; cursor: pointer; }
    .bmap-token.selected { outline: 2px solid #FFD700; outline-offset: -2px; border-radius: 4px; }
    .bmap-token-portrait { width: 70%; height: 70%; }
    .bmap-token-portrait img, .bmap-token-portrait video { width: 100%; height: 100%; object-fit: contain; filter: drop-shadow(0 0 4px rgba(0,0,0,0.9)); }
    .bmap-token-name { font-size: 0.6rem; font-weight: 700; text-shadow: 0 1px 2px #000; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
    .bmap-token.player .bmap-token-name { color: #5dade2; }
    .bmap-token.enemy .bmap-token-name { color: #e57373; }
    .bmap-token.mine .bmap-token-name { color: #FFD700; }
  `;
  document.head.appendChild(style);
}

let _overlay = null;
let _session = null;
let _ownerName = null;
let _selectedTokenId = null;

function _ensureDom() {
  if (_overlay) return;
  _injectStyles();
  _overlay = document.createElement('div');
  _overlay.className = 'combat-popup-overlay';
  _overlay.id = 'battleMapPopup';
  _overlay.style.display = 'none';
  _overlay.innerHTML = `
    <div class="combat-popup-content">
      <div class="combat-move-popup-header">
        <button id="battleMapClose" class="combat-popup-close">×</button>
        <h2>🗺️ Battle Map</h2>
      </div>
      <div class="combat-move-popup-body">
        <div class="bmap-hint" id="bmapHint"></div>
        <div class="bmap-stage">
          <div class="bmap-grid" id="bmapGrid"></div>
          <div class="bmap-tokens" id="bmapTokens"></div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(_overlay);

  document.getElementById('battleMapClose').addEventListener('click', _close);
  _overlay.addEventListener('click', (e) => { if (e.target === _overlay) _close(); });
}

function _close() {
  if (_overlay) _overlay.style.display = 'none';
  _selectedTokenId = null;
}

/** Opens the popup for `trainerName` (whoever's using this device) showing
 * `session`'s board. Re-openable/re-callable freely -- each call just
 * re-renders against the given session. */
export function showBattleMap(session, trainerName) {
  _session = session;
  _ownerName = trainerName;
  _selectedTokenId = null;
  _ensureDom();
  _render();
  _overlay.style.display = 'flex';
}

/** Call on every live session push so the popup stays current while open;
 * no-ops (and doesn't re-render) when the popup isn't showing. */
export function updateBattleMap(session) {
  _session = session;
  if (_overlay && _overlay.style.display !== 'none') _render();
}

function _render() {
  if (!_session || !_session.board) return;
  const hint = document.getElementById('bmapHint');
  if (hint) {
    hint.textContent = _selectedTokenId
      ? 'Click a cell to move there.'
      : 'Click one of your own tokens (gold name), then click a cell to move it.';
  }
  _renderGrid();
  _renderTokens();
}

function _renderGrid() {
  const gridEl = document.getElementById('bmapGrid');
  if (!gridEl) return;
  const { cols, rows } = _session.board.grid;
  gridEl.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  gridEl.style.gridTemplateRows = `repeat(${rows}, 1fr)`;

  const cells = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const terrain = _session.board.cells[`${col},${row}`]?.terrain || '';
      const classes = terrain ? 'bmap-cell marked' : 'bmap-cell';
      cells.push(`<div class="${classes}" data-cell="${col},${row}"${terrain ? ` title="${terrain}"` : ''}>${terrain}</div>`);
    }
  }
  gridEl.innerHTML = cells.join('');

  gridEl.querySelectorAll('[data-cell]').forEach(cell => {
    cell.addEventListener('click', () => {
      if (!_selectedTokenId) return; // nothing selected -- clicking empty ground does nothing
      const [col, row] = cell.dataset.cell.split(',').map(Number);
      const movingId = _selectedTokenId;
      _selectedTokenId = null;
      CombatAPI.setTokenPosition(movingId, col, row).catch(err => alert(err.message));
    });
  });
}

function _renderTokens() {
  const layer = document.getElementById('bmapTokens');
  if (!layer) return;
  const { cols, rows } = _session.board.grid;
  const tokens = _session.board.tokens;

  layer.innerHTML = '';
  Object.entries(tokens).forEach(([id, pos]) => {
    const p = _session.participants[id];
    if (!p) return;

    const isMine = !!_ownerName && p.owner === _ownerName;
    const el = document.createElement('div');
    el.className = `bmap-token ${p.side}${isMine ? ' mine' : ''}${id === _selectedTokenId ? ' selected' : ''}`;
    el.dataset.id = id;
    el.style.left = `${(pos.col / cols) * 100}%`;
    el.style.top = `${(pos.row / rows) * 100}%`;
    el.style.width = `${(1 / cols) * 100}%`;
    el.style.height = `${(1 / rows) * 100}%`;
    el.innerHTML = `<div class="bmap-token-portrait"></div><div class="bmap-token-name"></div>`;

    const name = visibleToViewer(p, 'name') ? p.name : '???';
    el.querySelector('.bmap-token-name').textContent = name;
    patchPortraitMedia(el.querySelector('.bmap-token-portrait'), p.image, name);

    if (isMine) {
      el.addEventListener('click', () => {
        _selectedTokenId = _selectedTokenId === id ? null : id;
        _render();
      });
    }

    layer.appendChild(el);
  });
}
