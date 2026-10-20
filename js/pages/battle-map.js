// Battle map display screen. A second, separate, login-free static page
// (see battle-map.html) meant to run on its own physical screen alongside
// display.html -- purely spatial (token positions, terrain), never HP/VP,
// which stays on the combat/HP screen. Same architecture as display.js: no
// trainer identity, no SPA boot sequence, just subscribe to the shared
// combat session over SSE and render its 'board' state (see
// pi-server/app/routes_combat.py).
//
// Outside a battle it shows the region map in 3D (js/region-map/region-map.js), view only: the DM turns, zooms and
// moves it from the DM console's PokeNav (js/dm/pokenav.js), pushed here live ('region-map-view'); nobody at the
// table can touch it. The flat painting stays under it while it loads, or if this screen can't draw 3D.
import { CombatAPI, DmAPI } from '../api.js';
import { initLiveUpdates } from '../utils/live-updates.js';
import { patchPortraitMedia, keepVideosPlaying } from '../utils/sprite-media.js';
import { keepScreenAwake } from '../utils/screen-awake.js';
import { visibleToViewer } from '../utils/combat-visibility.js';
import { footprintForSize, mapObjectsHtml, MAP_OBJECT_CSS, MAP_MARK_CSS, trapCellsOf, trapCellClass } from '../utils/battle-map-grid.js';
import { zoneKindsByCell, legendHtml, activeTerrainSummary, spriteTransform, unwrapAngle } from '../utils/battle-map-view.js';

let session = { active: false, participants: {}, board: null };

async function init() {
  // The DM's map pictures and difficult / blocked squares -- the same styles the in-app maps use.
  const style = document.createElement('style');
  style.textContent = MAP_OBJECT_CSS + MAP_MARK_CSS;
  document.head.appendChild(style);
  initLiveUpdates();
  keepVideosPlaying(); // nobody touches this screen: a sprite the WebView pauses starts again
  keepScreenAwake(); // ...and it mustn't dim or sleep on the table monitor

  const result = await CombatAPI.getState();
  if (result.status === 'success') session = result.data;
  render();

  window.addEventListener('app:combat-updated', (e) => {
    session = e.detail;
    render();
  });

  mountRegion();
}

/** The region map, loaded once and kept (put away during a battle, drawn nothing meanwhile), following the DM. */
async function mountRegion() {
  const box = document.getElementById('mapRegion');
  try {
    const [{ mountRegionMap }, view] = await Promise.all([
      import('../region-map/region-map.js'),
      DmAPI.getState('region-map-view').catch(() => null),
    ]);
    const map = mountRegionMap(document.getElementById('mapRegionMap'), { viewOnly: true, rememberStyle: false });
    // Its names: the DM's locations marked on the map (not the secret ones), fetched again when the DM changes them; the
    // towns the map was made with until any are marked.
    const showLocations = async () => {
      const list = await DmAPI.getState('locations').catch(() => undefined);
      if (list === undefined) return;
      const marked = Array.isArray(list) ? list.filter(l => l && l.shape && !l.secret) : [];
      map.setLocations(marked.length ? marked : null);
    };
    // ...and where the party is (the DM's PokeNav, 'party-location'), unless the DM keeps it off this screen
    const showParty = async () => {
      const p = await DmAPI.getState('party-location').catch(() => undefined);
      if (p !== undefined) map.setParty(p && p.onBoard !== false ? p.locationId : null);
    };
    showLocations();
    showParty();
    window.addEventListener('app:dm-state', (e) => {
      if (e.detail?.key === 'locations') showLocations();
      if (e.detail?.key === 'party-location') showParty();
    });
    window.addEventListener('app:live-resync', () => { showLocations(); showParty(); });
    let steered = !!view;
    if (view) map.setView(view);
    window.addEventListener('app:region-map-view', (e) => {
      if (!e.detail?.view) return;
      steered = true;
      map.setView(e.detail.view, { smooth: true });
    });
    // Back after the connection dropped: wherever the DM left it meanwhile.
    window.addEventListener('app:live-resync', async () => {
      const v = await DmAPI.getState('region-map-view').catch(() => null);
      if (v) { steered = true; map.setView(v, { smooth: true }); }
    });
    await map.ready;
    // Never steered yet (and not while loading either): the whole island lying along the screen, north to the right
    // (like the painting was)
    if (!steered) map.home({ ms: 0, azimuth: Math.PI / 2, fill: true });
    box.classList.add('ready');
  } catch (err) {
    console.warn('[BattleMap] The region map could not be shown -- the painting stays:', err);
  }
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

  // An adventure the DM has taken off this screen (the PokeNav module's "On the table screen") leaves the region map up.
  const adventureAway = session.battleType === 'adventure' && session.adventure?.onScreen === 'region';
  const active = !!(session.active && session.board) && !adventureAway;
  stage.classList.toggle('active', active);
  // Idle state (no active battle): battle-map.html's .map-empty-bg shows the
  // Shima map -- but the token layer sits above it (z-index 3), so the
  // battle's tokens, grid, legend and terrain wash are cleared here, or the
  // last battle's trainer and Pokemon would stay drawn over the map.
  if (!active) {
    clearBattleLayers(stage);
    return;
  }

  updateBackground();
  updateGrid();
  updateObjects();
  updateTokens();
  updateTerrainOverlay();
}

/** The DM's map pictures (trees, rocks...), drawn turned with the rest of this sideways board. Pictures are rebuilt
 * only when the objects actually change, never on an unrelated push. */
function updateObjects() {
  const layer = document.getElementById('mapObjects');
  if (!layer) return;
  const html = mapObjectsHtml(session.board, { tv: true });
  if (layer._html !== html) { layer.innerHTML = html; layer._html = html; }
}

function clearBattleLayers(stage) {
  ['mapTokens', 'mapGrid', 'mapLegend', 'mapObjects'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.innerHTML = ''; el._html = ''; }
  });
  stage.className = stage.className.replace(/\bglobal-\w+/g, '').trim();
}

/** Whole-map terrain washes the stage; the legend lists everything active and for how long. */
function updateTerrainOverlay() {
  const stage = document.getElementById('mapStage');
  const legend = document.getElementById('mapLegend');
  if (!stage || !legend) return;
  stage.className = stage.className.replace(/\bglobal-\w+/g, '').trim();
  const globalKind = activeTerrainSummary(session).find(t => t.scope === 'all')?.kind;
  if (globalKind) stage.classList.add(`global-${globalKind}`);
  legend.innerHTML = legendHtml(session);
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
  const zones = zoneKindsByCell(session);
  const traps = trapCellsOf(session.board); // revealed ones only -- the table never sees a hidden trap
  for (let col = 0; col < cols; col++) {
    for (let row = rows - 1; row >= 0; row--) {
      const terrain = session.board.cells[`${col},${row}`]?.terrain || '';
      const zone = zones.get(`${col},${row}`);
      const mark = session.board.marks?.[`${col},${row}`]; // the DM's difficult / blocked squares
      const trap = trapCellClass(traps, `${col},${row}`);
      const classes = ['map-cell', terrain ? 'marked' : '', zone ? `zone-${zone[0]}` : '', mark ? `mark-${mark}` : '', trap?.cls].filter(Boolean).join(' ');
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
          <div class="map-disk">
            <div class="map-token-portrait"><div class="map-sprite"></div></div>
          </div>
        </div>`;
      el = wrapper.firstElementChild;
      layer.appendChild(el);
    }

    const name = visibleToViewer(p, 'name') ? p.name : '???';
    Object.assign(el.style, screenCellRect(session.board, pos.col, pos.row, footprintForSize(p.size)));
    const altitude = pos.z || 0;
    el.className = `map-token ${p.side}${altitude > 0 ? ' airborne' : altitude < 0 ? ' burrowed' : ''}`;
    el.querySelector('.map-alt')?.remove();
    if (altitude) el.querySelector('.map-disk').insertAdjacentHTML('beforeend', `<span class="map-alt">${altitude > 0 ? '↑' : '↓'}${Math.abs(altitude)}ft</span>`);
    el.title = name;
    const sprite = el.querySelector('.map-sprite');
    patchPortraitMedia(sprite, p.image, name);
    // The board is shown rotated 90deg clockwise, so a token facing "up" on the board points right on this screen.
    // Kept unwrapped on the element so a turn animates the short way round (315 -> 0 is +45, not a full spin).
    const target = (pos.facing || 0) + 90;
    el._angle = el._angle === undefined ? target : unwrapAngle(el._angle, target);
    sprite.style.transform = spriteTransform(el._angle);
  });
}

init();
