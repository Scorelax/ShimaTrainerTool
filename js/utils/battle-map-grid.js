// Shared grid-cell markup for every interactive battle-map surface (the
// in-app popup in battle-map-popup.js, and the placement screen in
// combat-wip.js) -- one implementation so terrain-cell rendering can't
// drift between them. The read-only kiosk page (battle-map.html/js/pages/
// battle-map.js) builds its own cells directly since it never needs click
// handling and lives in a fully separate static page.

/**
 * HTML for every cell in board.grid, in row-major order, each carrying a
 * data-cell="col,row" attribute for a caller to attach click handlers to.
 * Marked (terrain) cells get the 'marked' class and show the terrain text.
 */
export function gridCellsHtml(board, cellClass = 'bmap-cell') {
  const { cols, rows } = board.grid;
  const cells = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const terrain = board.cells[`${col},${row}`]?.terrain || '';
      const classes = terrain ? `${cellClass} marked` : cellClass;
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
