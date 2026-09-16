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
 * underneath regardless of the grid's current size. */
export function cellRect(board, col, row) {
  const { cols, rows } = board.grid;
  return {
    left: `${(col / cols) * 100}%`,
    top: `${(row / rows) * 100}%`,
    width: `${(1 / cols) * 100}%`,
    height: `${(1 / rows) * 100}%`,
  };
}
