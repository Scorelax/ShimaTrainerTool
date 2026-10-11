// Shared grid-cell markup for every interactive battle-map surface (the
// in-app popup in battle-map-popup.js, and the placement screen in
// combat-wip.js) -- one implementation so terrain-cell rendering can't
// drift between them. The read-only kiosk page (battle-map.html/js/pages/
// battle-map.js) builds its own cells directly since it never needs click
// handling and lives in a fully separate static page.

/**
 * HTML for every cell in board.grid, in row-major order, each carrying a
 * data-cell="col,row" attribute for a caller to attach click handlers to.
 * Marked (terrain) cells get the 'marked' class and show the terrain text; `classFor(col, row)` may add more classes.
 */
export function gridCellsHtml(board, cellClass = 'bmap-cell', classFor = null) {
  const { cols, rows } = board.grid;
  const cells = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const terrain = board.cells[`${col},${row}`]?.terrain || '';
      // classFor(col, row) -> extra classes for this cell (terrain zones, reach/cone overlays, ...), or ''.
      const extra = classFor ? classFor(col, row) : '';
      const mark = board.marks?.[`${col},${row}`]; // the DM's difficult / blocked squares
      const classes = [cellClass, terrain ? 'marked' : '', mark ? `mark-${mark}` : '', extra].filter(Boolean).join(' ');
      cells.push(`<div class="${classes}" data-cell="${col},${row}"${terrain ? ` title="${terrain}"` : ''}>${terrain}</div>`);
    }
  }
  return cells.join('');
}

/** Inline style for the grid container -- grid-template-columns/rows sized
 * from board.grid. */
export function gridTemplateStyle(board) {
  const { cols, rows } = board.grid;
  return `grid-template-columns:repeat(${cols}, 1fr); grid-template-rows:repeat(${rows}, 1fr);`;
}

/** Percentage-based position/size for an element at (col, row) on this grid
 * -- the same absolute-positioning approach display tokens and hover ghosts
 * both use, so they always land in exactly the same place as the cells
 * underneath regardless of the grid's current size. `size` (in cells, 1 by
 * default) spans a size-N Pokemon's full NxN footprint (see
 * footprintForSize) -- (col, row) is always the footprint's BOTTOM-LEFT
 * cell (the one actually clicked to place/move it), so the block extends
 * rightward and *upward* from there, matching how row indices increase
 * downward the same way gridCellsHtml lays them out. */
export function cellRect(board, col, row, size = 1) {
  const { cols, rows } = board.grid;
  const topRow = row - size + 1;
  return {
    left: `${(col / cols) * 100}%`,
    top: `${(topRow / rows) * 100}%`,
    width: `${(size / cols) * 100}%`,
    height: `${(size / rows) * 100}%`,
  };
}

/** A participant's footprint in cells (an NxN square) from their stored
 * `size` string (see combat.js's buildPokemonCombatant, pokemonData[57] --
 * a freeform sheet column, not a fixed enum, so this only special-cases
 * the two values the game currently distinguishes for map purposes and
 * falls back to 1 for everything else: Tiny/Small/Medium/blank/unknown, and
 * every trainer (who have no `size` at all). More tiers (e.g. Gargantuan)
 * are additive later, not a breaking change. */
export function footprintForSize(size) {
  const s = (size || '').trim().toLowerCase();
  if (s === 'large') return 2;
  if (s === 'huge') return 3;
  return 1;
}

// ---------------------------------------------------------------------------
// Map objects -- the pictures the DM places in the DM console's map editor (board.objects, see routes_combat.py's
// _EMPTY_STATE): a tree, a rock, a log... Unlike a token, an object's (col, row) is its TOP-LEFT cell and it spans
// w x h cells. `rot` turns the picture in 90-degree steps, and `crop` ([x0, y0, x1, y1], fractions of the picture) is
// the part of it that isn't transparent -- that part is stretched to fill the object's cells exactly, so a log lying
// in the middle of a square picture still fills a 3x1 strip.
// ---------------------------------------------------------------------------

/** Every cell an object covers, as {col, row}. */
export function objectCells(o) {
  const out = [];
  for (let dc = 0; dc < (o.w || 1); dc++) for (let dr = 0; dr < (o.h || 1); dr++) out.push({ col: o.col + dc, row: o.row + dr });
  return out;
}

/** Position/size of an object on the board as drawn everywhere except the table TV (cols across, rows down). */
export function objectRect(board, o) {
  const { cols, rows } = board.grid;
  return { left: `${(o.col / cols) * 100}%`, top: `${(o.row / rows) * 100}%`, width: `${((o.w || 1) / cols) * 100}%`, height: `${((o.h || 1) / rows) * 100}%` };
}

/** The same on the table TV's sideways board (battle-map.js's screenCellRect: board cols run DOWN the screen and board
 * rows run ACROSS it, row 0 at the right edge) -- also how the DM console's map editor shows the map. */
export function objectScreenRect(board, o) {
  const { cols, rows } = board.grid;
  const h = o.h || 1;
  return { left: `${((rows - o.row - h) / rows) * 100}%`, top: `${(o.col / cols) * 100}%`, width: `${(h / rows) * 100}%`, height: `${((o.w || 1) / cols) * 100}%` };
}

/** One object's markup. `turn` adds degrees on top of its own rotation (90 on the sideways TV board). The picture
 * lives in an inner box that has the object's own (unturned) shape -- for a quarter turn that box is the outer one's
 * height x width (container units), so after turning it fills the outer box exactly. */
export function mapObjectHtml(o, rect, turn = 0) {
  const rot = (((o.rot || 0) + turn) % 360 + 360) % 360;
  const [x0, y0, x1, y1] = Array.isArray(o.crop) && o.crop.length === 4 ? o.crop : [0, 0, 1, 1];
  const cw = Math.max(0.01, x1 - x0), ch = Math.max(0.01, y1 - y0);
  const img = `width:${(100 / cw).toFixed(3)}%;height:${(100 / ch).toFixed(3)}%;left:${(-x0 / cw * 100).toFixed(3)}%;top:${(-y0 / ch * 100).toFixed(3)}%`;
  const style = `left:${rect.left};top:${rect.top};width:${rect.width};height:${rect.height}`;
  const title = `${o.label || o.kind || ''}${o.height ? ` · ${o.height}ft tall` : ''}`;
  return `<div class="bmap-object" data-object-id="${o.id}" style="${style}" title="${title}">`
    + `<div class="bmap-object-art${rot % 180 ? ' swap' : ''}" style="transform:translate(-50%,-50%) rotate(${rot}deg)">`
    + `<img src="${o.url}" alt="" draggable="false" style="${img}"></div></div>`;
}

/** Every object on the board. `tv` draws them for the sideways table-TV board instead. */
export function mapObjectsHtml(board, { tv = false } = {}) {
  return (board?.objects || []).map(o => mapObjectHtml(o, tv ? objectScreenRect(board, o) : objectRect(board, o), tv ? 90 : 0)).join('');
}

/** Styles for the objects layer -- shared with the kiosk page (battle-map.html carries its own copy). */
export const MAP_OBJECT_CSS = `
  .bmap-objects { position: absolute; inset: 0; pointer-events: none; z-index: 2; }
  .bmap-object { position: absolute; container-type: size; }
  .bmap-object-art { position: absolute; left: 50%; top: 50%; width: 100%; height: 100%; }
  .bmap-object-art.swap { width: 100cqh; height: 100cqw; }
  .bmap-object-art img { position: absolute; max-width: none; filter: drop-shadow(0 3px 4px rgba(0,0,0,0.55)); }
`;

/** Styles for the DM's difficult / blocked squares (gridCellsHtml's mark-* classes) -- shared the same way. */
export const MAP_MARK_CSS = `
  .mark-difficult {
    background: repeating-linear-gradient(135deg, rgba(215,155,65,0.46) 0 4px, rgba(215,155,65,0.12) 4px 9px);
    box-shadow: inset 0 0 0 1px rgba(225,165,70,0.78);
  }
  .mark-blocked {
    background:
      repeating-linear-gradient(45deg, rgba(215,55,55,0.38) 0 3px, transparent 3px 8px),
      repeating-linear-gradient(-45deg, rgba(215,55,55,0.38) 0 3px, rgba(60,10,10,0.25) 3px 8px) !important;
    box-shadow: inset 0 0 0 1px rgba(231,76,60,0.75) !important;
  }
`;

/** Every cell an NxN footprint anchored at (col, row) (its bottom-left,
 * same convention as cellRect) actually covers -- used for occupancy/
 * bounds checks, which have to reason about individual cells rather than
 * the single percentage-based rect cellRect hands to a renderer. */
export function footprintCells(col, row, size) {
  const cells = [];
  for (let dc = 0; dc < size; dc++) {
    for (let dr = 0; dr < size; dr++) {
      cells.push({ col: col + dc, row: row - dr });
    }
  }
  return cells;
}
