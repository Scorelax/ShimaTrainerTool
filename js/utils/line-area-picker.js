// "Aim the line" -- the "select from the map" step for a line move (Hyper Beam's "80 foot line, 5ft wide"). Shows the
// battle map with a 5ft-wide strip coming out of the caster; drag (or tap) anywhere on the map to swing it round to any
// angle, or nudge it 5° at a time. Creatures the strip touches are ringed live, and the confirm hands their ids back to the
// multi-target picker to tick (still adjustable there). See line-area.js for the geometry.
import { patchPortraitMedia } from './sprite-media.js';
import { visibleToViewer } from './combat-visibility.js';
import { gridCellsHtml, gridTemplateStyle, cellRect, footprintForSize, footprintCells } from './battle-map-grid.js';
import { injectBattleMapStyles, spriteTransform, coneCells } from './battle-map-view.js';
import { lineGeometry, lineHitIds, lineStyle, angleToPointer, injectLineStyles } from './line-area.js';

function _injectStyles() {
  if (document.getElementById('line-area-picker-styles')) return;
  injectBattleMapStyles();
  injectLineStyles();
  const style = document.createElement('style');
  style.id = 'line-area-picker-styles';
  style.textContent = `
    .lap-overlay { position: fixed; inset: 0; z-index: 1100; display: flex; align-items: center; justify-content: center; background: rgba(2,3,10,0.85); backdrop-filter: blur(4px); }
    .lap-card { width: 94%; max-width: 640px; max-height: 94vh; overflow-y: auto; background: linear-gradient(180deg, #1a1d36, #11132a); border: 1px solid rgba(255,150,80,0.45); border-radius: 18px; padding: 1rem 1.1rem 1.1rem; color: #e0e0e0; box-shadow: 0 14px 50px rgba(0,0,0,0.7); }
    .lap-title { margin: 0 0 0.2rem; font-size: 1.15rem; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase; color: #ffb27a; }
    .lap-sub { font-size: 0.82rem; color: #a0a8d0; margin-bottom: 0.7rem; }
    .lap-stage { touch-action: none; user-select: none; cursor: crosshair; }
    .lap-stage .bmap-tokens { z-index: 2; pointer-events: none; }
    .lap-hits { font-size: 0.85rem; margin-top: 0.6rem; min-height: 1.2em; color: #ffcf9e; }
    .lap-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin-top: 0.8rem; }
    .lap-actions button { border: none; border-radius: 999px; padding: 0.45rem 1rem; font-size: 0.85rem; font-weight: 700; cursor: pointer; background: rgba(255,255,255,0.1); color: #e8ecff; }
    .lap-actions button:hover { background: rgba(255,255,255,0.2); }
    .lap-actions .lap-confirm { margin-left: auto; background: linear-gradient(135deg, #ff9a50, #e0662a); color: #1a0b02; box-shadow: 0 0 16px rgba(255,120,50,0.45); }
  `;
  document.head.appendChild(style);
}

/**
 * @param {object} session  the shared combat session (board + participants)
 * @param {string} casterId the line comes out of this creature's token
 * @param {string} title    e.g. "Hyper Beam"
 * @param {number} lengthFt the line's length (lineFtFromRange of the move's range)
 * @returns {Promise<{ids: string[], angle: number} | null>}  null when cancelled
 */
export function pickLineArea({ session, casterId, title, lengthFt, confirmLabel = 'Select targets in the line' }) {
  _injectStyles();
  return new Promise((resolve) => {
    const board = session.board;
    const { cols, rows } = board.grid;
    const casterPos = board.tokens[casterId];
    const caster = session.participants[casterId];
    if (!casterPos) { resolve(null); return; }
    const casterSize = footprintForSize(caster?.size);
    let angle = casterPos.facing || 0;

    const overlay = document.createElement('div');
    overlay.className = 'lap-overlay';
    overlay.innerHTML = `
      <div class="lap-card">
        <h3 class="lap-title">${title}</h3>
        <div class="lap-sub">A ${lengthFt}ft line, 5ft wide, from ${caster?.name || 'the caster'}. Drag or tap anywhere on the map to aim it — any angle, not just along the grid. Everyone it touches is selected.</div>
        <div class="bmap-stage lap-stage" style="aspect-ratio:${cols} / ${rows}">
          <div class="bmap-grid"></div>
          <div class="bmap-line"></div>
          <div class="bmap-tokens"></div>
        </div>
        <div class="lap-hits"></div>
        <div class="lap-actions">
          <button type="button" data-act="left" title="Turn 5° left">⟲ 5°</button>
          <button type="button" data-act="right" title="Turn 5° right">⟳ 5°</button>
          <button type="button" data-act="cancel">Cancel</button>
          <button type="button" class="lap-confirm" data-act="confirm">${confirmLabel}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const stage = overlay.querySelector('.lap-stage');
    const grid = overlay.querySelector('.bmap-grid');
    const tokenLayer = overlay.querySelector('.bmap-tokens');
    const lineEl = overlay.querySelector('.bmap-line');
    const hitsEl = overlay.querySelector('.lap-hits');
    if (board.backgroundImage) {
      stage.classList.add('has-bg');
      stage.style.backgroundImage = `url(${board.backgroundImage})`;
    }
    grid.setAttribute('style', gridTemplateStyle(board));
    grid.innerHTML = gridCellsHtml(board, 'bmap-cell');

    const tokenEls = new Map();
    Object.entries(board.tokens).forEach(([id, pos]) => {
      const p = session.participants[id];
      if (!p) return;
      const el = document.createElement('div');
      el.className = `bmap-token ${p.side}${id === casterId ? ' mine' : ''}${(pos.z || 0) > 0 ? ' airborne' : ''}`;
      Object.assign(el.style, cellRect(board, pos.col, pos.row, footprintForSize(p.size)));
      const name = visibleToViewer(p, 'name') ? p.name : '???';
      el.title = name;
      el.innerHTML = `<div class="bmap-token-portrait"><div class="bmap-sprite" style="transform:${spriteTransform(pos.facing || 0)}"></div></div>`;
      patchPortraitMedia(el.querySelector('.bmap-sprite'), p.image, name);
      tokenLayer.appendChild(el);
      tokenEls.set(id, el);
    });

    let hits = [];
    const refresh = () => {
      const g = lineGeometry(casterPos, casterSize, angle, lengthFt);
      lineEl.setAttribute('style', lineStyle(board, g, angle));
      hits = lineHitIds(session, casterId, angle, lengthFt);
      tokenEls.forEach((el, id) => el.classList.toggle('line-hit', hits.includes(id)));
      const names = hits.map(id => (visibleToViewer(session.participants[id], 'name') ? session.participants[id].name : '???'));
      hitsEl.textContent = names.length ? `In the line: ${names.join(', ')}` : 'Nobody in the line yet.';
    };
    refresh();

    const origin = lineGeometry(casterPos, casterSize, 0, lengthFt).o;
    let aiming = false;
    const aim = (e) => { angle = angleToPointer(stage, board, origin, e.clientX, e.clientY); refresh(); };
    stage.addEventListener('pointerdown', (e) => { e.preventDefault(); aiming = true; stage.setPointerCapture?.(e.pointerId); aim(e); });
    stage.addEventListener('pointermove', (e) => { if (aiming) aim(e); });
    const stop = () => { aiming = false; };
    stage.addEventListener('pointerup', stop);
    stage.addEventListener('pointercancel', stop);

    overlay.addEventListener('click', (e) => {
      const act = e.target.closest('button')?.dataset.act;
      if (!act) return;
      if (act === 'left') { angle = (angle + 355) % 360; refresh(); }
      else if (act === 'right') { angle = (angle + 5) % 360; refresh(); }
      else if (act === 'cancel') { overlay.remove(); resolve(null); }
      else if (act === 'confirm') { overlay.remove(); resolve({ ids: hits, angle }); }
    });
  });
}

/** "Self (15ft. cone)" / "40ft. cone" -> 15 / 40; null for anything else. */
export function coneFtFromRange(rangeText) {
  const m = /(\d+)\s*ft\.?\s*cone/i.exec(String(rangeText || ''));
  return m ? Number(m[1]) : null;
}

/**
 * "Aim the cone" -- the cone counterpart of pickLineArea. The cone comes out of the caster and points in one of the 8 grid
 * directions (the table's grid cones: straight ahead each row is 2 squares wider, a diagonal is a square block off the
 * corner -- battle-map-view.js's coneCells). Drag or tap toward where it should point, or turn it 45° at a time; the squares
 * it covers are shaded and everyone standing on one is listed (a flyer higher than the cone is long is out of it).
 * @returns {Promise<{ids: string[], angle: number} | null>}  null when cancelled
 */
export function pickConeArea({ session, casterId, title, lengthFt, confirmLabel = 'Select targets in the cone' }) {
  _injectStyles();
  return new Promise((resolve) => {
    const board = session.board;
    const { cols, rows } = board.grid;
    const casterPos = board.tokens[casterId];
    const caster = session.participants[casterId];
    if (!casterPos) { resolve(null); return; }
    const casterSize = footprintForSize(caster?.size);
    const snap = (deg) => ((Math.round(deg / 45) * 45) % 360 + 360) % 360;
    let angle = snap(casterPos.facing || 0);

    const overlay = document.createElement('div');
    overlay.className = 'lap-overlay';
    overlay.innerHTML = `
      <div class="lap-card">
        <h3 class="lap-title">${title}</h3>
        <div class="lap-sub">A ${lengthFt}ft cone from ${caster?.name || 'the caster'}. Drag or tap toward where it should point (it turns in 8 directions), or use the buttons. Everyone in the shaded squares is selected.</div>
        <div class="bmap-stage lap-stage" style="aspect-ratio:${cols} / ${rows}">
          <div class="bmap-grid"></div>
          <div class="bmap-tokens"></div>
        </div>
        <div class="lap-hits"></div>
        <div class="lap-actions">
          <button type="button" data-act="left" title="Turn 45° left">⟲ 45°</button>
          <button type="button" data-act="right" title="Turn 45° right">⟳ 45°</button>
          <button type="button" data-act="cancel">Cancel</button>
          <button type="button" class="lap-confirm" data-act="confirm">${confirmLabel}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const stage = overlay.querySelector('.lap-stage');
    const grid = overlay.querySelector('.bmap-grid');
    const tokenLayer = overlay.querySelector('.bmap-tokens');
    const hitsEl = overlay.querySelector('.lap-hits');
    if (board.backgroundImage) {
      stage.classList.add('has-bg');
      stage.style.backgroundImage = `url(${board.backgroundImage})`;
    }
    grid.setAttribute('style', gridTemplateStyle(board));
    grid.innerHTML = gridCellsHtml(board, 'bmap-cell');
    const cellEls = new Map([...grid.querySelectorAll('[data-cell]')].map(el => [el.dataset.cell, el]));

    const tokenEls = new Map();
    Object.entries(board.tokens).forEach(([id, pos]) => {
      const p = session.participants[id];
      if (!p) return;
      const el = document.createElement('div');
      el.className = `bmap-token ${p.side}${id === casterId ? ' mine' : ''}${(pos.z || 0) > 0 ? ' airborne' : ''}`;
      Object.assign(el.style, cellRect(board, pos.col, pos.row, footprintForSize(p.size)));
      const name = visibleToViewer(p, 'name') ? p.name : '???';
      el.title = name;
      el.innerHTML = `<div class="bmap-token-portrait"><div class="bmap-sprite" style="transform:${spriteTransform(pos.facing || 0)}"></div></div>`;
      patchPortraitMedia(el.querySelector('.bmap-sprite'), p.image, name);
      tokenLayer.appendChild(el);
      tokenEls.set(id, el);
    });

    let hits = [];
    const refresh = () => {
      const cells = coneCells(board, casterPos, casterSize, angle, lengthFt / 5);
      cellEls.forEach((el, key) => el.classList.toggle('cone', cells.has(key)));
      const casterZ = casterPos.z || 0;
      hits = Object.entries(board.tokens).filter(([id, pos]) => {
        if (id === casterId || !session.participants[id]) return false;
        if (Math.abs((pos.z || 0) - casterZ) > lengthFt) return false;
        return footprintCells(pos.col, pos.row, footprintForSize(session.participants[id].size)).some(c => cells.has(`${c.col},${c.row}`));
      }).map(([id]) => id);
      tokenEls.forEach((el, id) => el.classList.toggle('line-hit', hits.includes(id)));
      const names = hits.map(id => (visibleToViewer(session.participants[id], 'name') ? session.participants[id].name : '???'));
      hitsEl.textContent = names.length ? `In the cone: ${names.join(', ')}` : 'Nobody in the cone yet.';
    };
    refresh();

    const origin = lineGeometry(casterPos, casterSize, 0, lengthFt).o;
    let aiming = false;
    const aim = (e) => { angle = snap(angleToPointer(stage, board, origin, e.clientX, e.clientY)); refresh(); };
    stage.addEventListener('pointerdown', (e) => { e.preventDefault(); aiming = true; stage.setPointerCapture?.(e.pointerId); aim(e); });
    stage.addEventListener('pointermove', (e) => { if (aiming) aim(e); });
    const stop = () => { aiming = false; };
    stage.addEventListener('pointerup', stop);
    stage.addEventListener('pointercancel', stop);

    overlay.addEventListener('click', (e) => {
      const act = e.target.closest('button')?.dataset.act;
      if (!act) return;
      if (act === 'left') { angle = (angle + 315) % 360; refresh(); }
      else if (act === 'right') { angle = (angle + 45) % 360; refresh(); }
      else if (act === 'cancel') { overlay.remove(); resolve(null); }
      else if (act === 'confirm') { overlay.remove(); resolve({ ids: hits, angle }); }
    });
  });
}
