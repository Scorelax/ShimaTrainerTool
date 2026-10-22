// The DM's setup map, drawn the way the table TV shows it (battle-map.js: board cols run DOWN the screen, board rows
// run ACROSS it, row 0 at the right edge) -- shared by the map setup (map-editor.js), the battle setup's placement map
// (creature-setup.js) and the setup overview's preview. Everything in the setup is stored in board coordinates.
import { mapObjectsHtml, footprintForSize, footprintCells, trapCellsOf, trapCellClass } from '../utils/battle-map-grid.js';
import { isLevitating } from '../utils/move-effects.js';
import { spriteTransform } from '../utils/battle-map-view.js';
import { escapeHtml } from './dm-common.js';

// Horizontal or vertical (the user's call, 2026-10-21): the DM picks, in the map setup, whether the map is shown here
// the way the table TV shows it (horizontal, the default) or a quarter turn left -- upright, the way the board's own
// pictures are drawn and the players see the table from their side, like the PokéNav's region map. Only this screen
// changes: everything is still stored in board coordinates, and the table TV is the same either way. Kept on this
// computer; the map setup (and the adventure's map, the battle's Edit map) and the battle setup's placement map follow it.
const UPRIGHT_KEY = 'dm-battle-map-upright';
export function mapUpright() {
  try { return localStorage.getItem(UPRIGHT_KEY) === '1'; } catch { return false; }
}
export function setMapUpright(on) {
  try { localStorage.setItem(UPRIGHT_KEY, on ? '1' : '0'); } catch { /* not kept */ }
}

/** The map's width on the page: as wide as it can be (up to `avail`, a CSS length, tall), its shape kept -- whichever
 * way it's shown. `wrap` holds what mapStageHtml made. */
export function sizeStage(wrap, m, avail) {
  const turned = wrap?.querySelector('.dm-map-turn');
  const outer = turned || wrap?.querySelector('.dm-map-stage');
  if (outer) outer.style.width = `min(100%, calc((${avail}) * ${turned ? m.cols / m.rows : m.rows / m.cols}))`;
}

/** Where pointer event `e` is on `el` (the map's grid or stage), in the map's own unturned terms: { x, y } from its top
 * left, in a box { w, h } -- the same numbers whichever way the map is shown. */
export function pointOn(el, e) {
  const r = el.getBoundingClientRect();
  if (!el.closest('.dm-map-turn')) return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
  // turned a quarter left: its own right points up the screen, its own down to the right
  return { x: r.bottom - e.clientY, y: e.clientX - r.left, w: r.height, h: r.width };
}

/** A step (dx, dy) as it looks on screen -> the same step in the map's own terms. */
export function screenStep(dx, dy, upright) {
  return upright ? [-dy, dx] : [dx, dy];
}

export function boardOf(setup) {
  const m = setup.map;
  return { grid: { cols: m.cols, rows: m.rows }, objects: m.objects || [], marks: m.marks || {}, traps: m.traps || [], cells: {}, tokens: {} };
}

/** A creature token's footprint on the sideways screen -- battle-map.js's screenCellRect. Its (col, row) anchor is the
 * footprint's bottom-left on the board, which is its top-left on this screen. */
export function tokenScreenRect(m, col, row, size) {
  return { left: `${((m.rows - row - 1) / m.rows) * 100}%`, top: `${(col / m.cols) * 100}%`, width: `${(size / m.rows) * 100}%`, height: `${(size / m.cols) * 100}%` };
}

/** The whole map: background, grid (cells carry data-cell="col,row" when `interactive`), objects, the creatures that
 * have a starting square (`selectedId` highlighted), and an empty ghost layer for previews. */
export function mapStageHtml(setup, { interactive = false, selectedId = null, preview = false, upright = false } = {}) {
  const m = setup.map;
  const traps = trapCellsOf(boardOf(setup), true); // the DM's own screen: hidden traps too
  const cells = [];
  for (let col = 0; col < m.cols; col++) {
    for (let row = m.rows - 1; row >= 0; row--) {
      const mark = m.marks?.[`${col},${row}`];
      const trap = trapCellClass(traps, `${col},${row}`);
      const trapAttr = trap ? ` title="${escapeHtml(trap.title)}"` : '';
      cells.push(`<div class="dm-map-cell${mark ? ` mark-${mark}` : ''}${trap ? ` ${trap.cls}` : ''}"${trapAttr}${interactive ? ` data-cell="${col},${row}"` : ''}></div>`);
    }
  }
  // A hidden creature with a spot (the adventure's, or one an encounter brought along) is on the map, see-through
  const tokens = setup.creatures.filter(c => c.position).map(c => {
    const r = tokenScreenRect(m, c.position.col, c.position.row, footprintForSize(c.participant?.size));
    // turned the way it faces, like the table TV (battle-map.js): the board lies a quarter turn right on this screen, so
    // facing up the board points right here (shown upright, the map's own quarter turn left takes it along)
    const face = spriteTransform((Number(c.position.facing) || 0) + 90);
    return `<div class="dm-map-token${c.id === selectedId ? ' selected' : ''}${c.hidden || c.heldBack ? ' dm-token-hidden' : ''}" data-token="${c.id}" title="${escapeHtml(c.name)}${c.hidden || c.heldBack ? ' (hidden from the players)' : ''}"
      style="left:${r.left};top:${r.top};width:${r.width};height:${r.height}"><div class="dm-map-token-art" data-img="${escapeHtml(c.participant?.image || '')}" style="--face:${face}"></div></div>`;
  }).join('');
  // shown upright: the map in a box of its turned shape, turned a quarter left inside it (dm-console.css)
  return `${upright ? `<div class="dm-map-turn" style="aspect-ratio:${m.cols} / ${m.rows}">` : ''}
    <div class="dm-map-stage${preview ? ' dm-map-preview' : ''}${m.background ? ' has-bg' : ''}" style="aspect-ratio:${m.rows} / ${m.cols}">
      <div class="dm-map-bg"${m.background ? ` style="background-image:url('${escapeHtml(m.background)}')"` : ''}></div>
      <div class="dm-map-grid" style="grid-template-columns:repeat(${m.rows},1fr);grid-template-rows:repeat(${m.cols},1fr)">${cells.join('')}</div>
      <div class="bmap-objects">${mapObjectsHtml(boardOf(setup), { tv: true, all: true })}</div>
      <div class="dm-map-tokens">${tokens}</div>
      <div class="dm-map-ghost"></div>
    </div>${upright ? '</div>' : ''}`;
}

// Where a creature the DM puts on the map looks at first (the user's call, 2026-10-22): towards the players' side of the
// board -- left on the map shown horizontally, down shown upright, down on the players' own map too.
export const PLACED_FACING = 180;

/** What mapStageHtml would draw for `setup` (plus `extra`, the caller's own say in it -- who's selected, the way it's
 * shown...) as one text: the same text, the same map, so a change elsewhere needn't draw it again. */
export function stageKey(setup, ...extra) {
  return JSON.stringify([setup.map, (setup.creatures || []).map(c => [c.id, c.name, c.position, c.z, c.participant?.size,
    c.participant?.image, !!(c.hidden || c.heldBack)]), ...extra]);
}

/** The sprites showing in `box`'s picture holders (patchPortraitMedia's), kept before it's drawn again. The returned
 * `put(holder)` moves one showing the holder's picture (data-img) into it and says whether there was one -- so looping
 * videos aren't loaded and started again on every redraw (several Pidgeys: one each). */
export function keepSprites(box) {
  const shown = new Map();
  box?.querySelectorAll('[data-image]').forEach((el) => {
    if (!el.firstElementChild) return;
    if (!shown.has(el.dataset.image)) shown.set(el.dataset.image, []);
    shown.get(el.dataset.image).push([...el.children]);
  });
  return (el) => {
    const kept = shown.get(el.dataset.img)?.shift();
    if (!kept) return false;
    el.dataset.image = el.dataset.img;
    el.append(...kept);
    return true;
  };
}

/** Why creature `c` can't start at board cell (col, row), or '' -- off the map, on a blocked square (unless it floats:
 * Levitate, hovering), or on top of another creature. */
export function creatureSpotProblem(setup, c, col, row) {
  const m = setup.map;
  const cells = footprintCells(col, row, footprintForSize(c.participant?.size));
  if (cells.some(p => p.col < 0 || p.row < 0 || p.col >= m.cols || p.row >= m.rows)) return "It doesn't fit there.";
  if (!isLevitating(c.participant) && cells.some(p => m.marks?.[`${p.col},${p.row}`] === 'blocked')) return 'That square is blocked.';
  const taken = new Set();
  setup.creatures.forEach(o => {
    if (o.id === c.id || !o.position || o.heldBack) return;
    footprintCells(o.position.col, o.position.row, footprintForSize(o.participant?.size)).forEach(p => taken.add(`${p.col},${p.row}`));
  });
  if (cells.some(p => taken.has(`${p.col},${p.row}`))) return 'Another creature is standing there.';
  return '';
}
