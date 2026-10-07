// "Where does it appear?" -- shown when a trainer sends a Pokemon out (a switch, Baton Pass, U-turn / Volt Switch, Lunar Dance,
// Healing Wish). The Pokemon doesn't take the tile of the one it replaces: it lands on a free tile within 20ft (4 tiles) of its
// TRAINER, and the player picks which on the battle map. Legal tiles are tinted; the footprint of a bigger Pokemon (Large 2x2,
// Huge 3x3) is previewed under the cursor and must fit on the board, clear of every other token. routes_combat.py's
// `_switch_placement` is the authority and checks the same rules -- this just makes the legal choices visible.
//
// Resolves to { col, row } (the footprint's bottom-left tile, the same anchor convention as every token), or null if cancelled.
import { patchPortraitMedia } from './sprite-media.js';
import { visibleToViewer } from './combat-visibility.js';
import { gridCellsHtml, gridTemplateStyle, cellRect, footprintForSize, footprintCells } from './battle-map-grid.js';
import { injectBattleMapStyles, spriteTransform } from './battle-map-view.js';

export const SWITCH_RANGE_CELLS = 4; // 20ft -- keep in step with routes_combat.py's SWITCH_RANGE_CELLS

function _injectStyles() {
  if (document.getElementById('token-placement-picker-styles')) return;
  injectBattleMapStyles();
  const style = document.createElement('style');
  style.id = 'token-placement-picker-styles';
  style.textContent = `
    .tpp-overlay { position: fixed; inset: 0; z-index: 1100; display: flex; align-items: center; justify-content: center; background: rgba(2,3,10,0.85); backdrop-filter: blur(4px); }
    .tpp-card { width: 94%; max-width: 640px; max-height: 94vh; overflow-y: auto; background: linear-gradient(180deg, #1a1d36, #11132a); border: 1px solid rgba(93,173,226,0.45); border-radius: 18px; padding: 1rem 1.1rem 1.1rem; color: #e0e0e0; box-shadow: 0 14px 50px rgba(0,0,0,0.7); }
    .tpp-title { margin: 0 0 0.2rem; font-size: 1.15rem; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase; color: #8fd0ff; }
    .tpp-sub { font-size: 0.82rem; color: #a0a8d0; margin-bottom: 0.7rem; }
    .tpp-stage .bmap-cell.legal { background: rgba(93,173,226,0.2); box-shadow: inset 0 0 0 1px rgba(93,173,226,0.65); cursor: pointer; }
    .tpp-stage .bmap-cell.legal:hover { background: rgba(255,215,0,0.28); }
    .tpp-stage .bmap-cell:not(.legal) { cursor: not-allowed; }
    .tpp-stage .bmap-cell.chosen { background: rgba(255,215,0,0.38); box-shadow: inset 0 0 0 2px #FFD700, 0 0 12px rgba(255,215,0,0.6); }
    .tpp-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin-top: 0.8rem; }
    .tpp-actions button { border: none; border-radius: 999px; padding: 0.45rem 1rem; font-size: 0.85rem; font-weight: 700; cursor: pointer; background: rgba(255,255,255,0.1); color: #e8ecff; }
    .tpp-actions button:hover { background: rgba(255,255,255,0.2); }
    .tpp-actions .tpp-confirm { margin-left: auto; background: linear-gradient(135deg, #5dade2, #2e86c1); color: #07121c; }
    .tpp-actions .tpp-confirm:disabled { opacity: 0.4; cursor: not-allowed; }
  `;
  document.head.appendChild(style);
}

/** The anchor tiles where a Pokemon of `size` (cells per side) may be sent out: footprint on the board, clear of every token other
 * than the outgoing one's, and within SWITCH_RANGE_CELLS of the trainer (a trainer with no token leaves only the other two rules). */
export function legalSwitchTiles(session, { trainerId, outId, size }) {
  const { cols, rows } = session.board.grid;
  const tokens = session.board.tokens;
  const occupied = new Set();
  for (const [id, t] of Object.entries(tokens)) {
    if (id === outId) continue; // its tile is about to be free
    footprintCells(t.col, t.row, footprintForSize(session.participants[id]?.size)).forEach(c => occupied.add(`${c.col},${c.row}`));
  }
  const trainer = trainerId && tokens[trainerId];
  const legal = new Set();
  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      const cells = footprintCells(col, row, size);
      if (cells.some(c => c.col < 0 || c.col >= cols || c.row < 0 || c.row >= rows)) continue;
      if (cells.some(c => occupied.has(`${c.col},${c.row}`))) continue;
      if (trainer && Math.min(...cells.map(c => Math.max(Math.abs(c.col - trainer.col), Math.abs(c.row - trainer.row)))) > SWITCH_RANGE_CELLS) continue;
      legal.add(`${col},${row}`);
    }
  }
  return legal;
}

/**
 * @param {object} session   the shared combat session
 * @param {string} trainerId the trainer participant whose Pokemon is being sent out (its token is the 20ft anchor)
 * @param {string} outId     the Pokemon leaving (its tile is freed)
 * @param {object} incoming  the Pokemon coming in -- { name, image, size }
 */
export function pickSwitchTile({ session, trainerId, outId, incoming }) {
  _injectStyles();
  return new Promise((resolve) => {
    const board = session.board;
    const { cols, rows } = board.grid;
    const size = footprintForSize(incoming.size);
    const legal = legalSwitchTiles(session, { trainerId, outId, size });

    const overlay = document.createElement('div');
    overlay.className = 'tpp-overlay';
    overlay.innerHTML = `
      <div class="tpp-card">
        <h3 class="tpp-title">Send out ${incoming.name}</h3>
        <div class="tpp-sub">Pick where it appears -- any free tile within 20ft of your trainer (blue).${legal.size ? '' : ' There is no free tile in range!'}</div>
        <div class="bmap-stage tpp-stage" style="aspect-ratio:${cols} / ${rows}">
          <div class="bmap-grid"></div>
          <div class="bmap-tokens"></div>
        </div>
        <div class="tpp-actions">
          <button type="button" data-act="cancel">Cancel</button>
          <button type="button" class="tpp-confirm" data-act="confirm" disabled>Send out here</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const stage = overlay.querySelector('.tpp-stage');
    const grid = overlay.querySelector('.bmap-grid');
    const tokenLayer = overlay.querySelector('.bmap-tokens');
    const confirmBtn = overlay.querySelector('.tpp-confirm');
    if (board.backgroundImage) { stage.classList.add('has-bg'); stage.style.backgroundImage = `url(${board.backgroundImage})`; }

    let chosen = null;
    const paint = () => {
      grid.setAttribute('style', gridTemplateStyle(board));
      const chosenCells = chosen ? new Set(footprintCells(chosen.col, chosen.row, size).map(c => `${c.col},${c.row}`)) : new Set();
      grid.innerHTML = gridCellsHtml(board, 'bmap-cell', (c, r) => [legal.has(`${c},${r}`) ? 'legal' : '', chosenCells.has(`${c},${r}`) ? 'chosen' : ''].filter(Boolean).join(' '));
      grid.querySelectorAll('.bmap-cell.legal').forEach(cell => cell.addEventListener('click', () => {
        const [col, row] = cell.dataset.cell.split(',').map(Number);
        chosen = { col, row };
        paint();
      }));
      confirmBtn.disabled = !chosen;
    };
    paint();

    // Everyone on the map for context -- the trainer ringed gold, the Pokemon leaving faded (its tile is about to be free).
    Object.entries(board.tokens).forEach(([id, pos]) => {
      const p = session.participants[id];
      if (!p) return;
      const el = document.createElement('div');
      el.className = `bmap-token ${p.side}${id === trainerId ? ' mine' : ''}`;
      Object.assign(el.style, cellRect(board, pos.col, pos.row, footprintForSize(p.size)));
      if (id === outId) el.style.opacity = '0.4';
      const name = visibleToViewer(p, 'name') ? p.name : '???';
      el.title = name;
      el.innerHTML = `<div class="bmap-token-portrait"><div class="bmap-sprite" style="transform:${spriteTransform(pos.facing || 0)}"></div></div>`;
      patchPortraitMedia(el.querySelector('.bmap-sprite'), p.image, name);
      tokenLayer.appendChild(el);
    });

    overlay.addEventListener('click', (e) => {
      const act = e.target.closest('button')?.dataset.act;
      if (act === 'cancel') { overlay.remove(); resolve(null); }
      else if (act === 'confirm' && chosen) { overlay.remove(); resolve(chosen); }
    });
  });
}
