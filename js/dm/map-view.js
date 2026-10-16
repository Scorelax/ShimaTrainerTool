// The DM's setup map, drawn the way the table TV shows it (battle-map.js: board cols run DOWN the screen, board rows
// run ACROSS it, row 0 at the right edge) -- shared by the map setup (map-editor.js), the battle setup's placement map
// (creature-setup.js) and the setup overview's preview. Everything in the setup is stored in board coordinates.
import { mapObjectsHtml, footprintForSize, footprintCells, trapCellsOf, trapCellClass } from '../utils/battle-map-grid.js';
import { isLevitating } from '../utils/move-effects.js';
import { escapeHtml } from './dm-common.js';

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
export function mapStageHtml(setup, { interactive = false, selectedId = null, preview = false } = {}) {
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
  const tokens = setup.creatures.filter(c => c.position && !c.heldBack).map(c => {
    const r = tokenScreenRect(m, c.position.col, c.position.row, footprintForSize(c.participant?.size));
    return `<div class="dm-map-token${c.id === selectedId ? ' selected' : ''}" data-token="${c.id}" title="${escapeHtml(c.name)}"
      style="left:${r.left};top:${r.top};width:${r.width};height:${r.height}"><div class="dm-map-token-art" data-img="${escapeHtml(c.participant?.image || '')}"></div></div>`;
  }).join('');
  return `
    <div class="dm-map-stage${preview ? ' dm-map-preview' : ''}${m.background ? ' has-bg' : ''}" style="aspect-ratio:${m.rows} / ${m.cols}">
      <div class="dm-map-bg"${m.background ? ` style="background-image:url('${escapeHtml(m.background)}')"` : ''}></div>
      <div class="dm-map-grid" style="grid-template-columns:repeat(${m.rows},1fr);grid-template-rows:repeat(${m.cols},1fr)">${cells.join('')}</div>
      <div class="bmap-objects">${mapObjectsHtml(boardOf(setup), { tv: true, all: true })}</div>
      <div class="dm-map-tokens">${tokens}</div>
      <div class="dm-map-ghost"></div>
    </div>`;
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
