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
import { cellRect, footprintForSize } from '../utils/battle-map-grid.js';

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
  const root = document.getElementById('mapRoot');
  if (!root) return;

  if (!session.active || !session.board) {
    root.innerHTML = '<div class="map-empty">🗺️ Waiting for battle to start…</div>';
    return;
  }

  ensureSkeleton(root);
  updateBackground();
  updateGrid();
  updateTokens();
}

function ensureSkeleton(root) {
  if (document.getElementById('mapGrid')) return;
  root.innerHTML = `
    <div class="map-stage" id="mapStage">
      <div class="map-rotor">
        <div class="map-bg" id="mapBg"></div>
        <div class="map-grid" id="mapGrid"></div>
        <div class="map-tokens" id="mapTokens"></div>
      </div>
    </div>`;
}

/** See .map-rotor's own comment in battle-map.html for why background,
 * grid and tokens all rotate 90deg together here but not on the player-
 * facing popup/placement screens. */
function updateBackground() {
  const stage = document.getElementById('mapStage');
  const bg = document.getElementById('mapBg');
  if (!stage || !bg) return;
  const url = session.board.backgroundImage;
  stage.classList.toggle('has-bg', !!url);
  bg.style.backgroundImage = url ? `url(${url})` : '';
}

function updateGrid() {
  const gridEl = document.getElementById('mapGrid');
  if (!gridEl) return;

  const { cols, rows } = session.board.grid;
  gridEl.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  gridEl.style.gridTemplateRows = `repeat(${rows}, 1fr)`;

  const cells = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
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
    Object.assign(el.style, cellRect(session.board, pos.col, pos.row, footprintForSize(p.size)));
    el.className = `map-token ${p.side}`;
    el.title = name;
    patchPortraitMedia(el.querySelector('.map-token-portrait'), p.image, name);
  });
}

init();
