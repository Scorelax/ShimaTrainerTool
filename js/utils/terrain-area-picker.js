// "Where does the terrain go?" -- shown when a terrain move (Electric/Grassy/Misty/Psychic Terrain) is used. The
// caster sees the battle map with a circle around themselves pre-painted from the move's range, and can click or
// drag to paint/erase tiles (so a platform, a boat, an island can get the effect and the sea around it doesn't), or
// press "All map" for the whole battlefield. Resolves to { cells: ["col,row", ...] } for a marked area or
// { all: true } for the whole map. There is deliberately no cancel: by the time this opens the move's VP is already
// spent, so the caster has to say where it goes.
//
// The effect then applies to whoever is standing on those tiles (conditions.py's terrains_affecting on the server,
// move-effects.js's terrainsAffecting on the client) instead of to everybody in the battle.
import { patchPortraitMedia } from './sprite-media.js';
import { visibleToViewer } from './combat-visibility.js';
import { gridCellsHtml, gridTemplateStyle, cellRect, footprintForSize } from './battle-map-grid.js';
import { injectBattleMapStyles, circleCells, tokenCenter, ZONE_RGB, facingMarkerHtml } from './battle-map-view.js';

/** First distance in a move's range text -- "Self (30ft. radius)" -> 30, "Self (60ft. circle)" -> 60. null if none. */
export function radiusFtFromRange(rangeText) {
  const m = /(\d+)\s*(?:ft|feet|foot)/i.exec(String(rangeText || ''));
  return m ? Number(m[1]) : null;
}

function _injectStyles() {
  if (document.getElementById('terrain-area-picker-styles')) return;
  injectBattleMapStyles();
  const style = document.createElement('style');
  style.id = 'terrain-area-picker-styles';
  style.textContent = `
    .tap-overlay { position: fixed; inset: 0; z-index: 1100; display: flex; align-items: center; justify-content: center; background: rgba(2,3,10,0.85); backdrop-filter: blur(4px); }
    .tap-card { width: 94%; max-width: 640px; max-height: 94vh; overflow-y: auto; background: linear-gradient(180deg, #1a1d36, #11132a); border: 1px solid rgba(var(--zc), 0.45); border-radius: 18px; padding: 1rem 1.1rem 1.1rem; color: #e0e0e0; box-shadow: 0 14px 50px rgba(0,0,0,0.7), 0 0 30px rgba(var(--zc), 0.18); }
    .tap-title { margin: 0 0 0.2rem; font-size: 1.15rem; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase; color: rgb(var(--zc)); text-shadow: 0 0 12px rgba(var(--zc), 0.5); }
    .tap-sub { font-size: 0.82rem; color: #a0a8d0; margin-bottom: 0.7rem; }
    .tap-stage { touch-action: none; user-select: none; }
    .tap-stage .bmap-cell { cursor: crosshair; }
    .tap-stage .bmap-tokens { z-index: 2; }
    .tap-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin-top: 0.8rem; }
    .tap-actions button { border: none; border-radius: 999px; padding: 0.45rem 1rem; font-size: 0.85rem; font-weight: 700; cursor: pointer; background: rgba(255,255,255,0.1); color: #e8ecff; }
    .tap-actions button:hover { background: rgba(255,255,255,0.2); }
    .tap-actions .tap-confirm { margin-left: auto; background: linear-gradient(135deg, rgb(var(--zc)), rgba(var(--zc), 0.6)); color: #0b0d1a; box-shadow: 0 0 16px rgba(var(--zc), 0.45); }
    .tap-actions .tap-confirm:disabled { opacity: 0.4; cursor: not-allowed; box-shadow: none; }
    .tap-count { font-size: 0.8rem; color: #a0a8d0; }
  `;
  document.head.appendChild(style);
}

/**
 * @param {object} session   the shared combat session (needs board + participants)
 * @param {string} casterId  participant using the move -- the circle is centred on their token
 * @param {string} title     e.g. "Grassy Terrain"
 * @param {string} kind      terrain kind for the colour ('electric' | 'grassy' | 'misty' | 'psychic')
 * @param {number|null} radiusFt  the move's own radius, to pre-paint (null = start empty)
 * @returns {Promise<{cells: string[]} | {all: true}>}
 */
export function pickTerrainArea({ session, casterId, title, kind, radiusFt }) {
  _injectStyles();
  return new Promise((resolve) => {
    const board = session.board;
    const { cols, rows } = board.grid;
    const caster = session.participants[casterId];
    const casterPos = board.tokens[casterId];
    const rgb = ZONE_RGB[kind] || ZONE_RGB.other;

    const painted = new Set();
    const circle = () => {
      if (!casterPos || !radiusFt) return new Set();
      const c = tokenCenter(casterPos, footprintForSize(caster?.size));
      return circleCells(board, c.x, c.y, radiusFt / 5);
    };
    circle().forEach(c => painted.add(c));

    const overlay = document.createElement('div');
    overlay.className = 'tap-overlay';
    overlay.innerHTML = `
      <div class="tap-card" style="--zc:${rgb}">
        <h3 class="tap-title">${title}</h3>
        <div class="tap-sub">Mark where it takes effect${radiusFt ? ` — pre-filled with a ${radiusFt}ft circle around ${caster?.name || 'the caster'}` : ''}. Click or drag to paint tiles; start a drag on a painted tile to erase. Only creatures standing on these tiles are affected.</div>
        <div class="bmap-stage tap-stage" style="aspect-ratio:${cols} / ${rows}; --zc:${rgb}">
          <div class="bmap-grid"></div>
          <div class="bmap-tokens"></div>
        </div>
        <div class="tap-actions">
          ${radiusFt && casterPos ? `<button type="button" data-act="circle">⭕ ${radiusFt}ft circle</button>` : ''}
          <button type="button" data-act="all">🗺️ All map</button>
          <button type="button" data-act="clear">Clear</button>
          <span class="tap-count"></span>
          <button type="button" class="tap-confirm" data-act="confirm">Confirm area</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const stage = overlay.querySelector('.tap-stage');
    const grid = overlay.querySelector('.bmap-grid');
    const tokenLayer = overlay.querySelector('.bmap-tokens');
    const countEl = overlay.querySelector('.tap-count');
    const confirmBtn = overlay.querySelector('.tap-confirm');

    if (board.backgroundImage) {
      stage.classList.add('has-bg');
      stage.style.backgroundImage = `url(${board.backgroundImage})`;
    }
    grid.setAttribute('style', gridTemplateStyle(board));
    grid.innerHTML = gridCellsHtml(board, 'bmap-cell');

    // Tokens for context only -- the caster ringed in gold.
    Object.entries(board.tokens).forEach(([id, pos]) => {
      const p = session.participants[id];
      if (!p) return;
      const el = document.createElement('div');
      el.className = `bmap-token ${p.side}${id === casterId ? ' mine' : ''}`;
      Object.assign(el.style, cellRect(board, pos.col, pos.row, footprintForSize(p.size)));
      const name = visibleToViewer(p, 'name') ? p.name : '???';
      el.title = name;
      el.innerHTML = `<div class="bmap-token-portrait"></div>${facingMarkerHtml(pos.facing || 0)}`;
      patchPortraitMedia(el.querySelector('.bmap-token-portrait'), p.image, name);
      tokenLayer.appendChild(el);
    });

    const cellEls = new Map([...grid.querySelectorAll('[data-cell]')].map(el => [el.dataset.cell, el]));
    const refresh = () => {
      cellEls.forEach((el, key) => el.classList.toggle('painting', painted.has(key)));
      countEl.textContent = `${painted.size} tile${painted.size === 1 ? '' : 's'}`;
      confirmBtn.disabled = painted.size === 0;
    };
    refresh();

    const done = (value) => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      overlay.remove();
      resolve(value);
    };

    let mode = null; // 'add' | 'remove' while a drag is in progress
    const stop = () => { mode = null; };
    const paintAt = (x, y) => {
      const key = document.elementFromPoint(x, y)?.closest?.('[data-cell]')?.dataset.cell;
      if (!key || !cellEls.has(key)) return;
      if (mode === 'add') painted.add(key); else painted.delete(key);
      refresh();
    };
    grid.addEventListener('pointerdown', (e) => {
      const key = e.target.closest('[data-cell]')?.dataset.cell;
      if (!key) return;
      e.preventDefault();
      mode = painted.has(key) ? 'remove' : 'add';
      paintAt(e.clientX, e.clientY);
    });
    grid.addEventListener('pointermove', (e) => { if (mode) paintAt(e.clientX, e.clientY); });
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);

    overlay.addEventListener('click', (e) => {
      const act = e.target.closest('button')?.dataset.act;
      if (!act) return;
      if (act === 'circle') { painted.clear(); circle().forEach(c => painted.add(c)); refresh(); }
      else if (act === 'clear') { painted.clear(); refresh(); }
      else if (act === 'all') done({ all: true });
      else if (act === 'confirm' && painted.size) done({ cells: [...painted] });
    });
  });
}
