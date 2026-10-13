// "Aim the line" -- the "select from the map" step for a line move (Hyper Beam's "80 foot line, 5ft wide"). Shows the
// battle map with a 5ft-wide strip coming out of the caster; drag (or tap) anywhere on the map to swing it round to any
// angle, or nudge it 5° at a time. Creatures the strip touches are ringed live, and the confirm hands their ids back to the
// multi-target picker to tick (still adjustable there). See line-area.js for the geometry.
import { patchPortraitMedia } from './sprite-media.js';
import { visibleToViewer } from './combat-visibility.js';
import { gridCellsHtml, gridTemplateStyle, cellRect, footprintForSize, mapObjectsHtml } from './battle-map-grid.js';
import { injectBattleMapStyles, spriteTransform } from './battle-map-view.js';
import { coneOrigin, levelCone, inConeReach, coneHitIds, coneShadowCells, coneAimAt } from './cone-area.js';
import { lineGeometry, lineHitIds, lineReachBox, inLineReach, aimAtCreature, lineStyle, angleToPointer, injectLineStyles } from './line-area.js';

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
    .lap-stage .bmap-token.untargetable { opacity: 0.35; filter: grayscale(1); }
    .lap-stage .bmap-cell.line-reach { background: rgba(255,140,60,0.1); box-shadow: inset 0 0 0 1px rgba(255,160,80,0.25); }
    .lap-stage .bmap-token.line-aim .bmap-token-portrait { outline: 2px dashed #fff3; outline-offset: 3px; }
    .lap-aim { font-size: 0.82rem; margin-top: 0.6rem; color: #c8cff5; }
    .lap-hits { font-size: 0.85rem; margin-top: 0.3rem; min-height: 1.2em; color: #ffcf9e; }
    .lap-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin-top: 0.8rem; }
    .lap-actions button { border: none; border-radius: 999px; padding: 0.45rem 1rem; font-size: 0.85rem; font-weight: 700; cursor: pointer; background: rgba(255,255,255,0.1); color: #e8ecff; }
    .lap-actions button:hover { background: rgba(255,255,255,0.2); }
    .lap-actions .lap-confirm { margin-left: auto; background: linear-gradient(135deg, #ff9a50, #e0662a); color: #1a0b02; box-shadow: 0 0 16px rgba(255,120,50,0.45); }
  `;
  document.head.appendChild(style);
}

// The board's tokens, greyed out when the move can't target them (underground, in another dimension, behind full cover
// from the caster... -- `targetable` is the multi-target picker's own list of ids; null means everyone). `blockedNotes`
// (id -> "Full cover (Wall)") says why in the tooltip.
function _buildTokens(session, board, casterId, tokenLayer, targetable, blockedNotes = null) {
  const tokenEls = new Map();
  Object.entries(board.tokens).forEach(([id, pos]) => {
    const p = session.participants[id];
    if (!p) return;
    const el = document.createElement('div');
    const out = id !== casterId && targetable && !targetable.has(id);
    el.className = `bmap-token ${p.side}${id === casterId ? ' mine' : ''}${(pos.z || 0) > 0 ? ' airborne' : ''}${out ? ' untargetable' : ''}`;
    Object.assign(el.style, cellRect(board, pos.col, pos.row, footprintForSize(p.size)));
    const name = visibleToViewer(p, 'name') ? p.name : '???';
    el.title = out ? `${name} (${blockedNotes?.get(id) || "can't be targeted by this move"})` : name;
    el.innerHTML = `<div class="bmap-token-portrait"><div class="bmap-sprite" style="transform:${spriteTransform(pos.facing || 0)}"></div></div>`;
    patchPortraitMedia(el.querySelector('.bmap-sprite'), p.image, name, { small: true });
    tokenLayer.appendChild(el);
    tokenEls.set(id, el);
  });
  return tokenEls;
}

/**
 * @param {object} session  the shared combat session (board + participants)
 * @param {string} casterId the line comes out of this creature's token
 * @param {string} title    e.g. "Hyper Beam"
 * @param {number} lengthFt the line's length (lineFtFromRange of the move's range)
 * @returns {Promise<{ids: string[], angle: number, pitch: number} | null>}  null when cancelled
 */
export function pickLineArea({ session, casterId, title, lengthFt, targetableIds = null, blockedNotes = null, confirmLabel = 'Select targets in the line' }) {
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
        <div class="lap-sub">A ${lengthFt}ft line, a 5ft-wide beam from ${caster?.name || 'the caster'}. Drag on the map to aim it level — any angle, not just along the grid — or tap a creature to tilt the beam straight at it (up at a flyer, down from the air). It reaches the edge of the shaded squares (${lengthFt / 5} squares straight, diagonally or up); greyed-out creatures are out of its reach. Everyone the beam touches is selected.</div>
        <div class="bmap-stage lap-stage" style="aspect-ratio:${cols} / ${rows}">
          <div class="bmap-grid"></div>
          <div class="bmap-line"></div>
          <div class="bmap-objects">${mapObjectsHtml(board)}</div>
          <div class="bmap-tokens"></div>
        </div>
        <div class="lap-aim"></div>
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
    const aimEl = overlay.querySelector('.lap-aim');
    const hitsEl = overlay.querySelector('.lap-hits');
    if (board.backgroundImage) {
      stage.classList.add('has-bg');
      stage.style.backgroundImage = `url(${board.backgroundImage})`;
    }
    grid.setAttribute('style', gridTemplateStyle(board));
    grid.innerHTML = gridCellsHtml(board, 'bmap-cell');
    // Lightly shade every square within the line's reach (diagonals count 5ft, so it's a square box).
    const box = lineReachBox(casterPos, casterSize, lengthFt);
    grid.querySelectorAll('[data-cell]').forEach((el) => {
      const [c, r] = el.dataset.cell.split(',').map(Number);
      if (c >= box.c0 && c <= box.c1 && r >= box.r0 && r <= box.r1) el.classList.add('line-reach');
    });

    const targetable = targetableIds ? new Set(targetableIds) : null;
    const tokenEls = _buildTokens(session, board, casterId, tokenLayer, targetable, blockedNotes);
    // Who the beam could reach at all (on the map and in height) -- everyone else is greyed out, and only these can be
    // tapped to aim at.
    const aimable = new Set(Object.keys(board.tokens).filter(id => id !== casterId && (!targetable || targetable.has(id))
      && inLineReach(session, casterId, id, lengthFt)));
    tokenEls.forEach((el, id) => { if (id !== casterId && !aimable.has(id)) el.classList.add('untargetable'); });
    const nameOf = id => (visibleToViewer(session.participants[id], 'name') ? session.participants[id].name : '???');
    const heightOf = id => { const z = board.tokens[id]?.z || 0; return z > 0 ? ` (${z}ft up)` : ''; };

    let pitch = 0;       // level unless aimed at a creature
    let aimedAt = null;  // the creature it was aimed at
    let hits = [];
    const refresh = () => {
      const g = lineGeometry(casterPos, casterSize, angle, lengthFt, pitch);
      lineEl.setAttribute('style', lineStyle(board, g, angle));
      hits = lineHitIds(session, casterId, angle, lengthFt, pitch).filter(id => aimable.has(id));
      tokenEls.forEach((el, id) => {
        el.classList.toggle('line-hit', hits.includes(id));
        el.classList.toggle('line-aim', id === aimedAt);
      });
      const tilt = Math.round(Math.abs(pitch));
      aimEl.textContent = aimedAt
        ? `Aimed at ${nameOf(aimedAt)}${heightOf(aimedAt)}${tilt ? `: tilted ${tilt}° ${pitch > 0 ? 'up' : 'down'}. Drag to level it again` : ' (level)'}. Tap the same square again for another creature there.`
        : `Level, at ${caster?.name || 'the caster'}'s height${heightOf(casterId)} -- it passes under flyers. Tap a creature to aim the beam at it.`;
      const names = hits.map(id => `${nameOf(id)}${heightOf(id)}`);
      hitsEl.textContent = names.length ? `In the line: ${names.join(', ')}` : 'Nobody in the line yet.';
    };
    refresh();

    const origin = lineGeometry(casterPos, casterSize, 0, lengthFt).o;
    let aiming = false;
    const aim = (e) => { angle = angleToPointer(stage, board, origin, e.clientX, e.clientY); pitch = 0; aimedAt = null; refresh(); };
    stage.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const id = _creatureAt(stage, session, aimable, e, aimedAt);
      if (id) {
        // Tap a creature: the beam tilts to go straight through the middle of it.
        ({ angle, pitch } = aimAtCreature(session, casterId, id, angle));
        aimedAt = id;
        refresh();
        return;
      }
      aiming = true; stage.setPointerCapture?.(e.pointerId); aim(e);
    });
    stage.addEventListener('pointermove', (e) => { if (aiming) aim(e); });
    const stop = () => { aiming = false; };
    stage.addEventListener('pointerup', stop);
    stage.addEventListener('pointercancel', stop);

    overlay.addEventListener('click', (e) => {
      const act = e.target.closest('button')?.dataset.act;
      if (!act) return;
      if (act === 'left') { angle = (angle + 355) % 360; aimedAt = null; refresh(); }
      else if (act === 'right') { angle = (angle + 5) % 360; aimedAt = null; refresh(); }
      else if (act === 'cancel') { overlay.remove(); resolve(null); }
      else if (act === 'confirm') { overlay.remove(); resolve({ ids: hits, angle, pitch }); }
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
 * corner -- battle-map-view.js's coneCells). Drag toward where it should point, or turn it 45° at a time; it's a real cone in
 * 3D (cone-area.js), so it spreads upward as it goes and catches a flyer only where it has grown tall enough. Tap a creature
 * in reach to tilt the cone straight at it. The squares under it are shaded and everyone it covers is listed.
 * @returns {Promise<{ids: string[], angle: number, pitch: number} | null>}  null when cancelled
 */
export function pickConeArea({ session, casterId, title, lengthFt, targetableIds = null, blockedNotes = null, confirmLabel = 'Select targets in the cone' }) {
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
        <div class="lap-sub">A ${lengthFt}ft cone from ${caster?.name || 'the caster'}. Drag on the map toward where it should point (level, in 8 directions), or use the buttons — or tap a creature to tilt the cone straight at it (up at a flyer, down from the air). The shaded squares are where it covers the ground; ringed creatures are caught (in the air too); greyed-out ones are out of its reach.</div>
        <div class="bmap-stage lap-stage" style="aspect-ratio:${cols} / ${rows}">
          <div class="bmap-grid"></div>
          <div class="bmap-objects">${mapObjectsHtml(board)}</div>
          <div class="bmap-tokens"></div>
        </div>
        <div class="lap-aim"></div>
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
    const aimEl = overlay.querySelector('.lap-aim');
    const hitsEl = overlay.querySelector('.lap-hits');
    if (board.backgroundImage) {
      stage.classList.add('has-bg');
      stage.style.backgroundImage = `url(${board.backgroundImage})`;
    }
    grid.setAttribute('style', gridTemplateStyle(board));
    grid.innerHTML = gridCellsHtml(board, 'bmap-cell');
    const cellEls = new Map([...grid.querySelectorAll('[data-cell]')].map(el => [el.dataset.cell, el]));

    const targetable = targetableIds ? new Set(targetableIds) : null;
    const tokenEls = _buildTokens(session, board, casterId, tokenLayer, targetable, blockedNotes);
    const lengthCells = Math.floor(lengthFt / 5);
    // Who the cone could reach at all (on the map and in height) -- everyone else is greyed out, and only these can be
    // tapped to aim at. Reach is measured from the middle of the caster (a level cone's own origin is on its edge).
    const middle = coneOrigin(casterPos, casterSize);
    const aimable = new Set(Object.keys(board.tokens).filter(id => id !== casterId && (!targetable || targetable.has(id))
      && inConeReach(session, id, middle, lengthCells + Math.floor(casterSize / 2))));
    tokenEls.forEach((el, id) => { if (id !== casterId && !aimable.has(id)) el.classList.add('untargetable'); });
    const nameOf = id => (visibleToViewer(session.participants[id], 'name') ? session.participants[id].name : '???');
    const heightOf = id => { const z = board.tokens[id]?.z || 0; return z > 0 ? ` (${z}ft up)` : ''; };

    let tilted = null; // { id, origin, axis, pitch } once aimed at a creature; null = level, along the grid
    let hits = [];
    const refresh = () => {
      const level = levelCone(angle);
      const origin = tilted ? tilted.origin : coneOrigin(casterPos, casterSize, level.dir);
      const axis = tilted ? tilted.axis : level.axis;
      const cells = coneShadowCells(board, origin, axis, lengthCells);
      cellEls.forEach((el, key) => el.classList.toggle('cone', cells.has(key)));
      hits = coneHitIds(session, casterId, origin, axis, lengthCells).filter(id => aimable.has(id));
      tokenEls.forEach((el, id) => {
        el.classList.toggle('line-hit', hits.includes(id));
        el.classList.toggle('line-aim', id === tilted?.id);
      });
      const tilt = tilted ? Math.round(Math.abs(tilted.pitch)) : 0;
      aimEl.textContent = tilted
        ? `Aimed at ${nameOf(tilted.id)}${heightOf(tilted.id)}${tilt ? `: tilted ${tilt}° ${tilted.pitch > 0 ? 'up' : 'down'}` : ''}. Drag to level it again; tap the same square again for another creature there.`
        : `Level, at ${caster?.name || 'the caster'}'s height${heightOf(casterId)} -- it spreads upward as it goes (as high as it is wide). Tap a creature to aim the cone at it.`;
      const names = hits.map(id => `${nameOf(id)}${heightOf(id)}`);
      hitsEl.textContent = names.length ? `In the cone: ${names.join(', ')}` : 'Nobody in the cone yet.';
    };
    refresh();

    const origin = lineGeometry(casterPos, casterSize, 0, lengthFt).o;
    let aiming = false;
    const aim = (e) => { angle = snap(angleToPointer(stage, board, origin, e.clientX, e.clientY)); tilted = null; refresh(); };
    stage.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const id = _creatureAt(stage, session, aimable, e, tilted?.id);
      if (id) {
        // Tap a creature: the cone tilts to point straight at it.
        tilted = { id, ...coneAimAt(session, casterId, id) };
        refresh();
        return;
      }
      aiming = true; stage.setPointerCapture?.(e.pointerId); aim(e);
    });
    stage.addEventListener('pointermove', (e) => { if (aiming) aim(e); });
    const stop = () => { aiming = false; };
    stage.addEventListener('pointerup', stop);
    stage.addEventListener('pointercancel', stop);

    overlay.addEventListener('click', (e) => {
      const act = e.target.closest('button')?.dataset.act;
      if (!act) return;
      if (act === 'left') { angle = (angle + 315) % 360; tilted = null; refresh(); }
      else if (act === 'right') { angle = (angle + 45) % 360; tilted = null; refresh(); }
      else if (act === 'cancel') { overlay.remove(); resolve(null); }
      else if (act === 'confirm') { overlay.remove(); resolve({ ids: hits, angle, pitch: tilted ? tilted.pitch : 0 }); }
    });
  });
}

/** The creature (one of `ids`) whose footprint covers the map square under the pointer, or null. Creatures stacked on
 * one square (a flyer above one on the ground) take turns: tapping again moves on from `current` to the next, lowest
 * first. */
function _creatureAt(stage, session, ids, e, current = null) {
  const { cols, rows } = session.board.grid;
  const r = stage.getBoundingClientRect();
  const c = Math.floor(((e.clientX - r.left) / r.width) * cols);
  const rr = Math.floor(((e.clientY - r.top) / r.height) * rows);
  const here = [...ids].filter((id) => {
    const pos = session.board.tokens[id];
    const n = footprintForSize(session.participants[id].size);
    return c >= pos.col && c <= pos.col + n - 1 && rr >= pos.row - n + 1 && rr <= pos.row;
  }).sort((a, b) => (session.board.tokens[a].z || 0) - (session.board.tokens[b].z || 0));
  if (!here.length) return null;
  const i = here.indexOf(current);
  return here[(i + 1) % here.length];
}
