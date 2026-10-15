// "Aim the line" -- the "select from the map" step for a line move (Hyper Beam's "80 foot line, 5ft wide"). Shows the
// battle map with a 5ft-wide strip coming out of the caster; drag (or tap) anywhere on the map to swing it round to any
// angle, or nudge it 5° at a time. Creatures the strip catches are ringed live (a yellow ring on the edge of it), and the
// confirm hands their ids back to the multi-target picker to tick (still adjustable there). See line-area.js for the
// geometry and the edge rule.
import { patchPortraitMedia } from './sprite-media.js';
import { visibleToViewer } from './combat-visibility.js';
import { gridCellsHtml, gridTemplateStyle, cellRect, footprintForSize, mapObjectsHtml } from './battle-map-grid.js';
import { injectBattleMapStyles, spriteTransform } from './battle-map-view.js';
import { coneSquares, coneHits, coneOutlineSvg, injectConeStyles } from './cone-area.js';
import { lineGeometry, lineAimOrigin, lineCells, lineCellsHtml, lineHits, lineReachBox, inLineReach, aimAtCreature, lineGuideStyle, lineOutlineSvg, angleToPointer, injectLineStyles } from './line-area.js';

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
    .lap-cone-shape, .lap-line-shape { position: absolute; inset: 0; z-index: 1; pointer-events: none; }
    .lap-stage .bmap-token.untargetable { opacity: 0.35; filter: grayscale(1); }
    .lap-stage .bmap-cell.line-reach { background: rgba(255,140,60,0.1); box-shadow: inset 0 0 0 1px rgba(255,160,80,0.25); }
    .lap-stage .bmap-token.line-aim .bmap-token-portrait { outline: 2px dashed #fff3; outline-offset: 3px; }
    .lap-aim { font-size: 0.82rem; margin-top: 0.6rem; color: #c8cff5; }
    .lap-hits { font-size: 0.85rem; margin-top: 0.3rem; min-height: 1.2em; color: #ffcf9e; }
    .lap-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin-top: 0.8rem; }
    .lap-actions button { border: none; border-radius: 999px; padding: 0.45rem 1rem; font-size: 0.85rem; font-weight: 700; cursor: pointer; background: rgba(255,255,255,0.1); color: #e8ecff; }
    .lap-actions button:hover { background: rgba(255,255,255,0.2); }
    .lap-height { font-size: 0.8rem; color: #9fd8ff; min-width: 4.5em; text-align: center; }
    .lap-actions .lap-confirm { margin-left: auto; background: linear-gradient(135deg, #ff9a50, #e0662a); color: #1a0b02; box-shadow: 0 0 16px rgba(255,120,50,0.45); }
    /* A big caster's own squares (tap one to fire from it) and the one chosen. */
    .lap-own { position: absolute; z-index: 3; pointer-events: none; box-sizing: border-box; border: 2px dashed rgba(130,200,255,0.75); border-radius: 4px; }
    .lap-start-mark { position: absolute; z-index: 3; pointer-events: none; box-sizing: border-box; border: 3px solid #7fd0ff; border-radius: 4px;
      background: rgba(127,208,255,0.28); box-shadow: 0 0 12px rgba(127,208,255,0.8); }
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

/** A caster bigger than one square chooses which of its own squares the line / cone starts from (its front left, its
 * front right...): their outline, the chosen square's mark, and which own square (if any) a pointer event is on. */
function _startPicker(stage, board, casterPos, n) {
  const own = document.createElement('div');
  own.className = 'lap-own';
  const mark = document.createElement('div');
  mark.className = 'lap-start-mark';
  mark.hidden = true;
  if (n > 1) {
    Object.assign(own.style, cellRect(board, casterPos.col, casterPos.row, n));
    stage.append(own, mark);
  }
  return {
    show(start) {
      mark.hidden = !start;
      if (start) Object.assign(mark.style, cellRect(board, start.col, start.row, 1));
    },
    /** The caster's own square under the pointer, or null (always null for a one-square caster). */
    squareAt(e) {
      if (n <= 1) return null;
      const r = stage.getBoundingClientRect();
      const col = Math.floor(((e.clientX - r.left) / r.width) * board.grid.cols);
      const row = Math.floor(((e.clientY - r.top) / r.height) * board.grid.rows);
      const inside = col >= casterPos.col && col <= casterPos.col + n - 1 && row >= casterPos.row - n + 1 && row <= casterPos.row;
      return inside ? { col, row } : null;
    },
  };
}

/** The tilt buttons, and -- for a caster taller than one square -- the start-height buttons (from its lowest point up
 * to its own height). */
function _heightButtonsHtml(n, tiltStep) {
  return `<button type="button" data-act="tiltDown" title="Tilt it ${tiltStep}° down">▼ Tilt</button>`
    + `<button type="button" data-act="tiltUp" title="Tilt it ${tiltStep}° up">▲ Tilt</button>`
    + (n > 1 ? `<button type="button" data-act="lower" title="Start it 5ft lower">▼ Start</button><span class="lap-height"></span>`
      + `<button type="button" data-act="raise" title="Start it 5ft higher, up to its own height">▲ Start</button>` : '');
}

/** Partial cover from where the line / cone starts (the user's rule, 2026-10-15): a hit becomes an edge hit, an edge
 * hit a miss (`partialCover`: id -> "Partial cover (Rock)"; `partialAs` 'edge'). For a move that rolls to hit
 * ('disadvantage') nothing moves -- that creature's attack roll gets disadvantage instead (combat-wip.js). */
function _coverStep(hits, edges, partialCover, partialAs) {
  if (!partialCover?.size || partialAs !== 'edge') return { hits, edges };
  const out = { hits: [], edges: [] };
  hits.forEach((id) => {
    const edge = edges.includes(id);
    if (!partialCover.has(id)) { out.hits.push(id); if (edge) out.edges.push(id); return; }
    if (edge) return; // edge + partial cover: a miss
    out.hits.push(id); out.edges.push(id); // hit + partial cover: the edge
  });
  return out;
}

/** "from Onix's lowest point" / "from 10ft up Onix" -- where the move comes out, in the aim line. */
function _startText(name, layer, flyingNote) {
  return layer ? `from ${layer * 5}ft up ${name}${flyingNote}` : `from ${name}'s lowest point${flyingNote}`;
}

/**
 * @param {object} session  the shared combat session (board + participants)
 * @param {string} casterId the line comes out of this creature's token
 * @param {string} title    e.g. "Hyper Beam"
 * @param {number} lengthFt the line's length (lineFtFromRange of the move's range)
 * @returns {Promise<{ids: string[], edgeIds: string[], angle: number, pitch: number} | null>}  null when cancelled; edgeIds
 *   are the ones only on the edge of it (line-area.js's lineHits)
 */
export function pickLineArea({ session, casterId, title, lengthFt, targetableIds = null, blockedNotes = null, partialCover = null, partialAs = 'edge', confirmLabel = 'Select targets in the line' }) {
  _injectStyles();
  return new Promise((resolve) => {
    const board = session.board;
    const { cols, rows } = board.grid;
    const casterPos = board.tokens[casterId];
    const caster = session.participants[casterId];
    if (!casterPos) { resolve(null); return; }
    const casterSize = footprintForSize(caster?.size);
    let angle = casterPos.facing || 0;
    let start = null; // a big caster's own square the beam starts from (null = the middle of it)
    let layer = 0;    // how many 5ft up its own height it starts (0 = its lowest point)
    const org = () => ({ ...(start || {}), layer }); // line-area.js's `start`

    const overlay = document.createElement('div');
    overlay.className = 'lap-overlay';
    overlay.innerHTML = `
      <div class="lap-card">
        <h3 class="lap-title">${title}</h3>
        <div class="lap-sub">A ${lengthFt}ft line, a 5ft-wide beam from ${caster?.name || 'the caster'}. Drag on the map to aim it level — any angle, not just along the grid — or tap a creature to tilt the beam straight at it (up at a flyer, down from the air). It reaches ${lengthFt / 5} squares out at any angle; a square more than half inside the beam is hit (shaded), one more than a quarter up to half inside is the edge of it (dashed: a save for nothing, or half damage on a fail), and less misses. Greyed-out creatures are out of its reach.${casterSize > 1 ? ` ${caster?.name || 'The caster'} fills several squares: tap one of them (outlined) to fire from there -- its front left, its front right... -- and tap it again to go back to ${casterSize % 2 ? 'the middle' : 'the square facing the aim'}.` : ''}</div>
        <div class="bmap-stage lap-stage" style="aspect-ratio:${cols} / ${rows}">
          <div class="bmap-grid"></div>
          <div class="bmap-line-cells"></div>
          <div class="lap-line-shape"></div>
          <div class="bmap-line guide"></div>
          <div class="bmap-objects">${mapObjectsHtml(board)}</div>
          <div class="bmap-tokens"></div>
        </div>
        <div class="lap-aim"></div>
        <div class="lap-hits"></div>
        <div class="lap-actions">
          <button type="button" data-act="left" title="Turn 5° left">⟲ 5°</button>
          <button type="button" data-act="right" title="Turn 5° right">⟳ 5°</button>
          ${_heightButtonsHtml(casterSize, 5)}
          <button type="button" data-act="cancel">Cancel</button>
          <button type="button" class="lap-confirm" data-act="confirm">${confirmLabel}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const stage = overlay.querySelector('.lap-stage');
    const grid = overlay.querySelector('.bmap-grid');
    const tokenLayer = overlay.querySelector('.bmap-tokens');
    const lineEl = overlay.querySelector('.bmap-line');
    const lineCellsEl = overlay.querySelector('.bmap-line-cells');
    const lineShapeEl = overlay.querySelector('.lap-line-shape');
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
    let edges = [];      // the ones only on the edge of it
    const starts = _startPicker(stage, board, casterPos, casterSize);
    const refresh = () => {
      const g = lineGeometry(casterPos, casterSize, angle, lengthFt, pitch, org());
      lineEl.setAttribute('style', lineGuideStyle(board, g, angle));
      lineShapeEl.innerHTML = lineOutlineSvg(board, g, angle); // the 5ft beam itself, not just its middle
      lineCellsEl.innerHTML = lineCellsHtml(board, lineCells(casterPos, casterSize, angle, lengthFt, pitch, org(), board.grid));
      starts.show(start);
      const heightEl = overlay.querySelector('.lap-height');
      if (heightEl) heightEl.textContent = `Start ${layer * 5}ft`;
      const caught = lineHits(session, casterId, angle, lengthFt, pitch, org());
      ({ hits, edges } = _coverStep(caught.ids.filter(id => aimable.has(id)), caught.edgeIds.filter(id => aimable.has(id)), partialCover, partialAs));
      tokenEls.forEach((el, id) => {
        el.classList.toggle('line-hit', hits.includes(id));
        el.classList.toggle('line-edge', edges.includes(id));
        el.classList.toggle('line-aim', id === aimedAt);
      });
      const tilt = Math.round(Math.abs(pitch));
      aimEl.textContent = aimedAt
        ? `Aimed at ${nameOf(aimedAt)}${heightOf(aimedAt)}${tilt ? `: tilted ${tilt}° ${pitch > 0 ? 'up' : 'down'}. Drag to level it again` : ' (level)'}. Tap the same square again for another creature there.`
        : `${tilt ? `Tilted ${tilt}° ${pitch > 0 ? 'up' : 'down'}` : 'Level'}, ${_startText(caster?.name || 'the caster', layer, heightOf(casterId))}${tilt ? '' : ' -- it passes under flyers'}. Tilt it, or tap a creature to aim the beam at it.`;
      const names = ids => ids.map(id => `${nameOf(id)}${heightOf(id)}${partialCover?.has(id) ? ' (partial cover)' : ''}`).join(', ');
      const full = hits.filter(id => !edges.includes(id));
      hitsEl.textContent = hits.length
        ? [full.length ? `In the line: ${names(full)}` : '', edges.length ? `On the edge: ${names(edges)}` : ''].filter(Boolean).join(' · ')
        : 'Nobody in the line yet.';
    };
    refresh();

    let aiming = false;
    const aim = (e) => {
      angle = angleToPointer(stage, board, lineAimOrigin(casterPos, casterSize, org()), e.clientX, e.clientY);
      pitch = 0; aimedAt = null; refresh();
    };
    stage.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const own = starts.squareAt(e);
      if (own) {
        // One of the caster's own squares: fire from there (the same square again: back to the middle).
        start = start && start.col === own.col && start.row === own.row ? null : own;
        if (aimedAt) ({ angle, pitch } = aimAtCreature(session, casterId, aimedAt, angle, org()));
        refresh();
        return;
      }
      const id = _creatureAt(stage, session, aimable, e, aimedAt);
      if (id) {
        // Tap a creature: the beam tilts to go straight through the middle of it.
        ({ angle, pitch } = aimAtCreature(session, casterId, id, angle, org()));
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
      else if (act === 'tiltUp' || act === 'tiltDown') { pitch = Math.max(-80, Math.min(80, pitch + (act === 'tiltUp' ? 5 : -5))); aimedAt = null; refresh(); }
      else if (act === 'raise' || act === 'lower') {
        layer = Math.max(0, Math.min(casterSize - 1, layer + (act === 'raise' ? 1 : -1)));
        if (aimedAt) ({ angle, pitch } = aimAtCreature(session, casterId, aimedAt, angle, org()));
        refresh();
      }
      else if (act === 'cancel') { overlay.remove(); resolve(null); }
      else if (act === 'confirm') { overlay.remove(); resolve({ ids: hits, edgeIds: edges, angle, pitch, start: org() }); }
    });
  });
}

/** "Self (15ft. cone)" / "40ft. cone" -> 15 / 40; null for anything else. */
export function coneFtFromRange(rangeText) {
  const m = /(\d+)\s*ft\.?\s*cone/i.exec(String(rangeText || ''));
  return m ? Number(m[1]) : null;
}

/**
 * "Aim the cone" -- the cone counterpart of pickLineArea. The cone is a 90-degree wedge out of the caster's edge that
 * turns to any angle like the line (cone-area.js): drag toward where it should point, or nudge it 5° at a time. It's a
 * pyramid in 3D, so it spreads upward as it goes and catches a flyer only where it has grown tall enough; tap a creature
 * in reach to tilt it straight at it. Its outline and the squares under it are drawn -- hit squares shaded, edge ones
 * dashed -- and everyone it covers is listed.
 * @returns {Promise<{ids: string[], edgeIds: string[], angle: number, pitch: number} | null>}  null when cancelled; edgeIds
 *   are the ones only on the edge of it (cone-area.js's coneHits)
 */
export function pickConeArea({ session, casterId, title, lengthFt, targetableIds = null, blockedNotes = null, partialCover = null, partialAs = 'edge', confirmLabel = 'Select targets in the cone' }) {
  _injectStyles();
  injectConeStyles();
  return new Promise((resolve) => {
    const board = session.board;
    const { cols, rows } = board.grid;
    const casterPos = board.tokens[casterId];
    const caster = session.participants[casterId];
    if (!casterPos) { resolve(null); return; }
    const casterSize = footprintForSize(caster?.size);
    let angle = casterPos.facing || 0;
    let start = null; // a big caster's own square the cone comes out of (null = the middle, or the square facing the aim)
    let layer = 0;    // how many 5ft up its own height it starts (0 = its lowest point)
    let pitch = 0;    // level unless tilted or aimed at a creature
    let aimedAt = null;
    const org = () => ({ ...(start || {}), layer }); // cone-area.js's `start`

    const overlay = document.createElement('div');
    overlay.className = 'lap-overlay';
    overlay.innerHTML = `
      <div class="lap-card">
        <h3 class="lap-title">${title}</h3>
        <div class="lap-sub">A ${lengthFt}ft cone from ${caster?.name || 'the caster'}. Drag on the map to aim it level — any angle, not just along the grid — or tap a creature to tilt the cone straight at it (up at a flyer, down from the air). It reaches ${lengthFt / 5} squares out; a square more than half inside it is hit (shaded), one more than a quarter up to half inside is the edge of it (dashed: a save for nothing, or half damage on a fail), and less misses. Greyed-out creatures are out of its reach.${casterSize > 1 ? ` ${caster?.name || 'The caster'} fills several squares: tap one of them (outlined) to fire from there -- its front left, its front right... -- and tap it again to go back to ${casterSize % 2 ? 'the middle' : 'the square facing the aim'}.` : ''}</div>
        <div class="bmap-stage lap-stage" style="aspect-ratio:${cols} / ${rows}">
          <div class="bmap-grid"></div>
          <div class="bmap-line-cells"></div>
          <div class="lap-cone-shape"></div>
          <div class="bmap-objects">${mapObjectsHtml(board)}</div>
          <div class="bmap-tokens"></div>
        </div>
        <div class="lap-aim"></div>
        <div class="lap-hits"></div>
        <div class="lap-actions">
          <button type="button" data-act="left" title="Turn 5° left">⟲ 5°</button>
          <button type="button" data-act="right" title="Turn 5° right">⟳ 5°</button>
          ${_heightButtonsHtml(casterSize, 15)}
          <button type="button" data-act="cancel">Cancel</button>
          <button type="button" class="lap-confirm" data-act="confirm">${confirmLabel}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const stage = overlay.querySelector('.lap-stage');
    const grid = overlay.querySelector('.bmap-grid');
    const tokenLayer = overlay.querySelector('.bmap-tokens');
    const cellsEl = overlay.querySelector('.bmap-line-cells');
    const shapeEl = overlay.querySelector('.lap-cone-shape');
    const aimEl = overlay.querySelector('.lap-aim');
    const hitsEl = overlay.querySelector('.lap-hits');
    if (board.backgroundImage) {
      stage.classList.add('has-bg');
      stage.style.backgroundImage = `url(${board.backgroundImage})`;
    }
    grid.setAttribute('style', gridTemplateStyle(board));
    grid.innerHTML = gridCellsHtml(board, 'bmap-cell');

    const targetable = targetableIds ? new Set(targetableIds) : null;
    const tokenEls = _buildTokens(session, board, casterId, tokenLayer, targetable, blockedNotes);
    // Who the cone could reach at all (on the map and in height, its length from the caster) -- everyone else is greyed
    // out, and only these can be tapped to aim at.
    const aimable = new Set(Object.keys(board.tokens).filter(id => id !== casterId && (!targetable || targetable.has(id))
      && inLineReach(session, casterId, id, lengthFt)));
    tokenEls.forEach((el, id) => { if (id !== casterId && !aimable.has(id)) el.classList.add('untargetable'); });
    const nameOf = id => (visibleToViewer(session.participants[id], 'name') ? session.participants[id].name : '???');
    const heightOf = id => { const z = board.tokens[id]?.z || 0; return z > 0 ? ` (${z}ft up)` : ''; };

    let hits = [];
    let edges = [];   // the ones only on the edge of it
    const starts = _startPicker(stage, board, casterPos, casterSize);
    const refresh = () => {
      cellsEl.innerHTML = lineCellsHtml(board, coneSquares(casterPos, casterSize, angle, lengthFt, pitch, org(), board.grid));
      shapeEl.innerHTML = coneOutlineSvg(board, casterPos, casterSize, angle, lengthFt, pitch, org());
      starts.show(start);
      const heightEl = overlay.querySelector('.lap-height');
      if (heightEl) heightEl.textContent = `Start ${layer * 5}ft`;
      const caught = coneHits(session, casterId, angle, lengthFt, pitch, org());
      ({ hits, edges } = _coverStep(caught.ids.filter(id => aimable.has(id)), caught.edgeIds.filter(id => aimable.has(id)), partialCover, partialAs));
      tokenEls.forEach((el, id) => {
        el.classList.toggle('line-hit', hits.includes(id));
        el.classList.toggle('line-edge', edges.includes(id));
        el.classList.toggle('line-aim', id === aimedAt);
      });
      const tilt = Math.round(Math.abs(pitch));
      aimEl.textContent = aimedAt
        ? `Aimed at ${nameOf(aimedAt)}${heightOf(aimedAt)}${tilt ? `: tilted ${tilt}° ${pitch > 0 ? 'up' : 'down'}` : ''}. Drag to level it again; tap the same square again for another creature there.`
        : `${tilt ? `Tilted ${tilt}° ${pitch > 0 ? 'up' : 'down'}` : 'Level'}, ${_startText(caster?.name || 'the caster', layer, heightOf(casterId))} -- it spreads upward as it goes (as high as it is wide). Tilt it, or tap a creature to aim the cone at it.`;
      const names = ids => ids.map(id => `${nameOf(id)}${heightOf(id)}${partialCover?.has(id) ? ' (partial cover)' : ''}`).join(', ');
      const full = hits.filter(id => !edges.includes(id));
      hitsEl.textContent = hits.length
        ? [full.length ? `In the cone: ${names(full)}` : '', edges.length ? `On the edge: ${names(edges)}` : ''].filter(Boolean).join(' · ')
        : 'Nobody in the cone yet.';
    };
    refresh();

    let aiming = false;
    const aim = (e) => {
      angle = angleToPointer(stage, board, lineAimOrigin(casterPos, casterSize, org()), e.clientX, e.clientY);
      pitch = 0; aimedAt = null; refresh();
    };
    stage.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const own = starts.squareAt(e);
      if (own) {
        // One of the caster's own squares: fire from there (the same square again: back to the default).
        start = start && start.col === own.col && start.row === own.row ? null : own;
        if (aimedAt) ({ angle, pitch } = aimAtCreature(session, casterId, aimedAt, angle, org()));
        refresh();
        return;
      }
      const id = _creatureAt(stage, session, aimable, e, aimedAt);
      if (id) {
        // Tap a creature: the cone tilts to point straight at the middle of it.
        ({ angle, pitch } = aimAtCreature(session, casterId, id, angle, org()));
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
      else if (act === 'tiltUp' || act === 'tiltDown') { pitch = Math.max(-75, Math.min(75, pitch + (act === 'tiltUp' ? 15 : -15))); aimedAt = null; refresh(); }
      else if (act === 'raise' || act === 'lower') {
        layer = Math.max(0, Math.min(casterSize - 1, layer + (act === 'raise' ? 1 : -1)));
        if (aimedAt) ({ angle, pitch } = aimAtCreature(session, casterId, aimedAt, angle, org()));
        refresh();
      }
      else if (act === 'cancel') { overlay.remove(); resolve(null); }
      else if (act === 'confirm') { overlay.remove(); resolve({ ids: hits, edgeIds: edges, angle, pitch, start: org() }); }
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
