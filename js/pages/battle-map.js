// Battle map display screen. A second, separate, login-free static page
// (see battle-map.html) meant to run on its own physical screen alongside
// display.html -- purely spatial (token positions, terrain), never HP/VP,
// which stays on the combat/HP screen. Same architecture as display.js: no
// trainer identity, no SPA boot sequence, just subscribe to the shared
// combat session over SSE and render its 'board' state (see
// pi-server/app/routes_combat.py).
import { CombatAPI } from '../api.js';
import { initLiveUpdates } from '../utils/live-updates.js';
import { patchPortraitMedia } from '../utils/sprite-media.js';
import { visibleToViewer } from '../utils/combat-visibility.js';
import { footprintForSize } from '../utils/battle-map-grid.js';

let session = { active: false, participants: {}, board: null };

async function init() {
  initLiveUpdates();

  const result = await CombatAPI.getState();
  if (result.status === 'success') session = result.data;
  render();

  window.addEventListener('app:combat-updated', (e) => {
    session = e.detail;
    render();
  });
}

// ---------------------------------------------------------------------------
// Render -- grid cells never hold media, so they're cheap to fully rebuild
// on every push (dimensions/terrain can change any time the DM edits them).
// Tokens are a separate, absolutely-positioned layer patched in place with
// the same "only rebuild the portrait when its image URL changes" discipline
// display.js established, so a token's idle sprite loop never restarts just
// because an unrelated cell was marked or another token moved.
// ---------------------------------------------------------------------------

function render() {
  const stage = document.getElementById('mapStage');
  if (!stage) return;

  const active = !!(session.active && session.board);
  stage.classList.toggle('active', active);
  // Idle state (no active battle) is pure CSS -- see battle-map.html's own
  // .map-empty-bg rule -- nothing else to update while it's showing.
  if (!active) return;

  updateBackground();
  updateGrid();
  updateTokens();
}

/** See battle-map.html's own comment on .map-bg/.map-empty-bg for why the
 * background image still rotates 90deg via a live CSS transform while the
 * grid/tokens below don't -- this page rotates the board to match the
 * table's landscape screen, but the player-facing popup/placement screens
 * never do. */
function updateBackground() {
  const stage = document.getElementById('mapStage');
  const bg = document.getElementById('mapBg');
  if (!stage || !bg) return;
  const url = session.board.backgroundImage;
  stage.classList.toggle('has-bg', !!url);
  bg.style.backgroundImage = url ? `url(${url})` : '';
}

/** Screen-space equivalent of battle-map-grid.js's cellRect(), pre-rotated
 * 90deg clockwise in the math instead of via a live CSS transform on
 * rendered pixels -- see battle-map.html's .map-bg comment for why. Same
 * (col, row, size) inputs/bottom-left-footprint convention as the shared
 * cellRect(), just solving for where that footprint lands once the whole
 * board is rotated 90deg clockwise to fit the landscape screen: the
 * board's column axis becomes the screen's vertical axis, and the board's
 * row axis becomes the screen's horizontal axis (reversed, since row 0 is
 * the board's top edge, which rotates to the screen's right edge). */
function screenCellRect(board, col, row, size = 1) {
  const { cols, rows } = board.grid;
  return {
    left: `${((rows - row - 1) / rows) * 100}%`,
    top: `${(col / cols) * 100}%`,
    width: `${(size / rows) * 100}%`,
    height: `${(size / cols) * 100}%`,
  };
}

function updateGrid() {
  const gridEl = document.getElementById('mapGrid');
  if (!gridEl) return;

  const { cols, rows } = session.board.grid;
  // Swapped from the board's own (cols, rows) to match screenCellRect()'s
  // rotation -- the board's column count becomes the screen's row count
  // and vice versa.
  gridEl.style.gridTemplateColumns = `repeat(${rows}, 1fr)`;
  gridEl.style.gridTemplateRows = `repeat(${cols}, 1fr)`;

  // Emitted in row-major order for the *screen* grid above, not the
  // board's own -- screen row = board col (ascending), screen col = board
  // row (descending), same mapping screenCellRect() uses.
  const cells = [];
  for (let col = 0; col < cols; col++) {
    for (let row = rows - 1; row >= 0; row--) {
      const terrain = session.board.cells[`${col},${row}`]?.terrain || '';
      const classes = terrain ? 'map-cell marked' : 'map-cell';
      cells.push(`<div class="${classes}"${terrain ? ` title="${terrain}"` : ''}>${terrain}</div>`);
    }
  }
  gridEl.innerHTML = cells.join('');
}

function updateTokens() {
  const layer = document.getElementById('mapTokens');
  if (!layer) return;

  const tokens = session.board.tokens;

  const liveIds = new Set(Object.keys(tokens));
  [...layer.children].forEach(el => {
    if (!liveIds.has(el.dataset.id)) el.remove();
  });

  Object.entries(tokens).forEach(([id, pos]) => {
    const p = session.participants[id];
    if (!p) return; // stale token with no matching participant -- shouldn't happen (remove-participant cleans up), skip defensively

    let el = layer.querySelector(`[data-id="${id}"]`);
    if (!el) {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = `
        <div class="map-token" data-id="${id}">
          <div class="map-token-portrait"></div>
        </div>`;
      el = wrapper.firstElementChild;
      layer.appendChild(el);
    }

    const name = visibleToViewer(p, 'name') ? p.name : '???';
    Object.assign(el.style, screenCellRect(session.board, pos.col, pos.row, footprintForSize(p.size)));
    el.className = `map-token ${p.side}`;
    el.title = name;
    patchPortraitMedia(el.querySelector('.map-token-portrait'), p.image, name);
  });
}

init();
