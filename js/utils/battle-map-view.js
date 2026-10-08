// Shared look-and-feel + geometry helpers for every interactive battle-map surface (the in-app popup in
// battle-map-popup.js, the terrain-area picker in terrain-area-picker.js, and combat-wip.js's placement
// screen). One stylesheet, so the three can't drift apart -- the read-only kiosk page (battle-map.html) is
// a separate static page and carries its own lighter copy of the same palette.
//
// Class names are the long-standing .bmap-* / .placement-* ones, restyled here: thin glowing grid lines
// instead of boxed cells, square tokens with a side-coloured frame whose sprite turns to face the way the token faces, and
// colour-coded terrain zones. Nothing here knows about game rules beyond the terrain kinds' colours.
import { terrainKindOf, weatherKindOf } from './move-effects.js';

/** RGB triples (not hex) so CSS can use them at any alpha: rgba(var(--zc), .2). */
export const ZONE_RGB = {
  electric: '247,208,44',
  grassy: '82,200,90',
  misty: '242,154,200',
  psychic: '232,80,156',
  sunny: '255,170,60',
  rain: '80,150,255',
  sandstorm: '214,176,100',
  hail: '170,225,255',
  spikes: '214,120,70',
  fissure: '160,120,80',
  rototiller: '140,200,70',
  fortune_ring: '255,214,120',
  ion_deluge: '110,200,255',
  magic_room: '190,120,255',
  wonder_room: '120,130,255',
  other: '127,166,255',
};

/** Colour/class key for a terrain or weather (or a zone of either). */
export function zoneKind(field) {
  return terrainKindOf(field) || weatherKindOf(field) || (ZONE_RGB[field?.rule] ? field.rule : 'other');
}

/** "col,row" -> the kinds of every tile-limited terrain/weather zone covering that cell (first one paints it). */
export function zoneKindsByCell(session) {
  const map = new Map();
  for (const z of [...(session?.terrainZones || []), ...(session?.weatherZones || [])]) {
    const kind = zoneKind(z);
    for (const c of z.cells || []) {
      if (!map.has(c)) map.set(c, []);
      map.get(c).push(kind);
    }
  }
  return map;
}

/** One entry per active terrain/weather for the legend and the whole-map wash:
 * { name, kind, scope: 'all' | 'zone', roundsLeft, concentration, id, key: 'terrain' | 'weather' }. */
export function activeTerrainSummary(session) {
  const out = [];
  const left = (t) => (t.expiresRound != null && session.round != null ? Math.max(0, t.expiresRound - session.round) : null);
  for (const key of ['terrain', 'weather']) {
    if (session?.[key]) out.push({ name: session[key].name, kind: zoneKind(session[key]), scope: 'all', roundsLeft: left(session[key]), key });
    for (const z of session?.[key + 'Zones'] || []) {
      out.push({ name: z.name, kind: zoneKind(z), scope: 'zone', roundsLeft: left(z), concentration: !!z.concentration, id: z.id, key });
    }
  }
  // Trick Room isn't a place on the map but it is a rule of the battlefield worth showing next to the zones.
  if (session?.trickRoom) out.push({ name: 'Trick Room', kind: 'psychic', scope: 'rule', roundsLeft: null, key: 'rule', note: 'initiative reversed' });
  else if (session?.trickRoomFlip) out.push({ name: 'Trick Room', kind: 'psychic', scope: 'rule', roundsLeft: null, key: 'rule', note: 'twists the turn order next round' });
  return out;
}

/** The legend chips. `removable` (the in-app popup only) adds an ✕ on each marked-area chip to end it by hand --
 * how a concentration weather is dropped when its caster loses concentration. */
export function legendHtml(session, { removable = false } = {}) {
  const items = activeTerrainSummary(session);
  if (!items.length) return '';
  return items.map(t => {
    const rounds = t.roundsLeft == null ? '' : ` · ${t.roundsLeft} round${t.roundsLeft === 1 ? '' : 's'} left`;
    const conc = t.concentration ? ' · concentration' : '';
    const x = removable && t.id ? `<button type="button" class="bmap-legend-x" data-key="${t.key}" data-id="${t.id}" title="End this">✕</button>` : '';
    return `<span class="bmap-legend-chip" style="--zc:${ZONE_RGB[t.kind]}"><i></i>${t.name} <small>${t.scope === 'rule' ? t.note : (t.scope === 'all' ? 'whole map' : 'marked area') + rounds + conc}</small>${x}</span>`;
  }).join('');
}

/** Cells (as a Set of "col,row") within `radiusCells` squares of a tile or a creature's footprint. */
export function squareCells(board, col, row, size, radiusCells) {
  // Diagonals cost the same as straight moves on this grid, so "everything within N squares" is a square: a 15ft area
  // around a single tile is 7x7 (3 squares out on every side, diagonals included). Around a bigger creature it's measured
  // from the edge of its footprint (`col`/`row` = the footprint's bottom-left cell, `size` its width in cells).
  const { cols, rows } = board.grid;
  const out = new Set();
  const left = col - radiusCells, right = col + (size || 1) - 1 + radiusCells;
  const top = row - (size || 1) + 1 - radiusCells, bottom = row + radiusCells;
  for (let c = Math.max(0, left); c <= Math.min(cols - 1, right); c++) {
    for (let r = Math.max(0, top); r <= Math.min(rows - 1, bottom); r++) out.add(`${c},${r}`);
  }
  return out;
}

/** The cells a cone of `lengthCells` covers from a token at `pos` (its footprint's bottom-left cell) of `size` cells, facing
 * `facing` degrees clockwise from up. Grid cones, the table's rule: facing straight, row k in front is 2k-1 cells wide
 * (a 15ft cone: 1, 3, 5 = 9 squares); facing a diagonal, it's the lengthCells x lengthCells block off that corner (3x3 = 9
 * squares). A bigger creature casts the same cone, from the footprint cell it faces out of: the corner cell for a diagonal,
 * the middle of the facing edge otherwise (left/top of the two middle cells on an even-sized edge). Cells off the board are
 * dropped. */
export function coneCells(board, pos, size, facing, lengthCells) {
  const { cols, rows } = board.grid;
  const out = new Set();
  const add = (c, r) => { if (c >= 0 && r >= 0 && c < cols && r < rows) out.add(`${c},${r}`); };
  const n = size || 1;
  const dir = ((Math.round((facing || 0) / 45) % 8) + 8) % 8; // 0 up, 1 up-right, 2 right, ... 7 up-left
  const dx = [0, 1, 1, 1, 0, -1, -1, -1][dir];
  const dy = [-1, -1, 0, 1, 1, 1, 0, -1][dir];
  // The one footprint cell the cone comes out of.
  const mid = Math.floor((n - 1) / 2);
  const left = pos.col, top = pos.row - n + 1;
  const ox = dx > 0 ? left + n - 1 : dx < 0 ? left : left + mid;
  const oy = dy > 0 ? top + n - 1 : dy < 0 ? top : top + mid;
  const x0 = ox, x1 = ox, y0 = oy, y1 = oy;
  for (let k = 1; k <= lengthCells; k++) {
    if (dx === 0) {
      const r = dy < 0 ? y0 - k : y1 + k;
      for (let c = x0 - (k - 1); c <= x1 + (k - 1); c++) add(c, r);
    } else if (dy === 0) {
      const c = dx > 0 ? x1 + k : x0 - k;
      for (let r = y0 - (k - 1); r <= y1 + (k - 1); r++) add(c, r);
    } else {
      // Diagonal: column k of the block off the corner the token faces.
      const c = dx > 0 ? x1 + k : x0 - k;
      for (let j = 1; j <= lengthCells; j++) add(c, dy < 0 ? y0 - j : y1 + j);
    }
  }
  return out;
}

/** CSS transform that turns a token's sprite to face `deg` (clockwise from up; the sprite as drawn is "facing up").
 * A square turned off the 90-degree grid sticks out of its tile, so it's scaled down to still fit -- 1 at 0/90/180/270,
 * about 0.71 at the 45-degree diagonals. `deg` may be any real angle (see unwrapAngle). */
export function spriteTransform(deg) {
  const rad = (deg * Math.PI) / 180;
  const fit = 1 / (Math.abs(Math.cos(rad)) + Math.abs(Math.sin(rad)));
  return `rotate(${deg}deg) scale(${fit.toFixed(4)})`;
}

/** The angle equivalent to `target` (mod 360) that is nearest `prev`, so a CSS transition turns the short way round
 * (315 -> 0 is a +45 turn, not a -315 spin). Callers keep the unwrapped value for the next call. */
export function unwrapAngle(prev, target) {
  const delta = ((((target - prev) % 360) + 540) % 360) - 180;
  return prev + delta;
}

export function injectBattleMapStyles() {
  if (document.getElementById('battle-map-view-styles')) return;
  const style = document.createElement('style');
  style.id = 'battle-map-view-styles';
  style.textContent = `
    /* ---- stage ---- */
    .bmap-stage, .placement-stage {
      position: relative; width: 100%; overflow: hidden; border-radius: 14px;
      background: radial-gradient(ellipse at 50% 35%, #161a33 0%, #0a0c1c 60%, #05060e 100%);
      background-size: cover; background-position: center;
      box-shadow: 0 0 0 1px rgba(140,170,255,0.18), 0 8px 30px rgba(0,0,0,0.55), inset 0 0 60px rgba(0,0,0,0.55);
    }
    .bmap-stage.has-bg, .placement-stage.has-bg { box-shadow: 0 0 0 1px rgba(140,170,255,0.25), 0 8px 30px rgba(0,0,0,0.55); }
    .bmap-grid, .placement-grid, .tap-grid { position: absolute; inset: 0; display: grid; gap: 0; background: transparent; touch-action: manipulation; }

    /* ---- cells: hairline grid, soft hover glow ---- */
    .bmap-cell {
      position: relative; cursor: pointer; background: transparent;
      box-shadow: inset 0 0 0 0.5px rgba(140,170,255,0.13); transition: background 0.12s ease;
    }
    .bmap-stage.has-bg .bmap-cell, .placement-stage.has-bg .bmap-cell { box-shadow: inset 0 0 0 0.5px rgba(255,255,255,0.22); }
    .bmap-cell:hover { background: rgba(255,215,0,0.12); box-shadow: inset 0 0 0 1px rgba(255,215,0,0.55); outline: none; }
    .bmap-cell.marked {
      background: rgba(214,160,70,0.2); display: flex; align-items: center; justify-content: center;
      font-size: 0.6rem; color: #f0d090; overflow: hidden; text-align: center; padding: 1px; box-sizing: border-box;
      box-shadow: inset 0 0 0 1px rgba(214,160,70,0.5);
    }
    .bmap-cell.taken { background: rgba(231,76,60,0.18); cursor: not-allowed; }
    .bmap-cell.taken:hover { box-shadow: inset 0 0 0 1px rgba(231,76,60,0.7); background: rgba(231,76,60,0.22); }
    .bmap-cell.staged { background: rgba(255,215,0,0.2); box-shadow: inset 0 0 0 2px #FFD700, 0 0 14px rgba(255,215,0,0.55); z-index: 2; }
    /* where the selected token can reach with the movement it has left */
    .bmap-cell.reach { background: rgba(93,173,226,0.14); box-shadow: inset 0 0 0 0.5px rgba(93,173,226,0.5); }
    .bmap-cell.reach:hover { background: rgba(255,215,0,0.2); }
    /* the cone/line preview from the selected token's facing */
    .bmap-cell.cone { background: rgba(255,140,60,0.28); box-shadow: inset 0 0 0 1px rgba(255,160,80,0.65); }

    /* ---- terrain zones: tinted, hatched, glowing edge ---- */
    .bmap-cell[class*="zone-"] {
      background:
        repeating-linear-gradient(45deg, rgba(var(--zc), 0.16) 0 6px, rgba(var(--zc), 0.05) 6px 12px);
      box-shadow: inset 0 0 0 1px rgba(var(--zc), 0.5), inset 0 0 10px rgba(var(--zc), 0.25);
    }
    ${Object.entries(ZONE_RGB).map(([k, rgb]) => `.bmap-cell.zone-${k} { --zc: ${rgb}; }`).join('\n    ')}
    /* whole-map terrain: one tinted wash over the whole stage instead of per cell */
    ${Object.keys(ZONE_RGB).map(k => `.bmap-stage.global-${k}::after`).join(', ')} {
      content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 1;
      box-shadow: inset 0 0 50px rgba(var(--zc), 0.45); background: rgba(var(--zc), 0.06);
    }
    ${Object.entries(ZONE_RGB).map(([k, rgb]) => `.bmap-stage.global-${k} { --zc: ${rgb}; }`).join('\n    ')}
    .bmap-cell.painting { background: rgba(var(--zc, 255,215,0), 0.38); box-shadow: inset 0 0 0 1px rgba(var(--zc, 255,215,0), 0.9); }

    .bmap-legend { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.6rem; }
    .bmap-legend:empty { display: none; }
    .bmap-legend-chip {
      display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.78rem; font-weight: 600;
      padding: 0.25rem 0.65rem; border-radius: 999px; color: #e8ecff;
      background: rgba(var(--zc), 0.14); border: 1px solid rgba(var(--zc), 0.5);
    }
    .bmap-legend-chip i { width: 9px; height: 9px; border-radius: 50%; background: rgb(var(--zc)); box-shadow: 0 0 8px rgb(var(--zc)); }
    .bmap-legend-chip small { font-weight: 500; opacity: 0.7; }
    .bmap-legend-x { border: none; background: rgba(255,255,255,0.12); color: #e8ecff; width: 1.2rem; height: 1.2rem; border-radius: 50%; font-size: 0.7rem; cursor: pointer; padding: 0; line-height: 1; }
    .bmap-legend-x:hover { background: rgba(231,76,60,0.6); }

    /* ---- tokens ---- */
    .bmap-tokens, .placement-tokens { position: absolute; inset: 0; pointer-events: none; z-index: 3; }
    .bmap-token, .placement-token {
      position: absolute; display: flex; align-items: center; justify-content: center;
      padding: 3px; box-sizing: border-box; pointer-events: none; --ring: 200,200,220;
      transition: left 0.28s ease, top 0.28s ease;
    }
    .bmap-token.player, .placement-token.player { --ring: 93,173,226; }
    .bmap-token.enemy, .placement-token.enemy { --ring: 231,115,115; }
    .bmap-token.mine { --ring: 255,215,0; }
    .bmap-token.my-turn { pointer-events: auto; cursor: pointer; }
    .bmap-token-portrait, .placement-token-portrait {
      position: relative; width: 100%; height: 100%; border-radius: 14%;
      display: flex; align-items: center; justify-content: center;
      background: radial-gradient(circle at 50% 30%, rgba(255,255,255,0.14), rgba(8,10,22,0.7) 75%);
      box-shadow: 0 0 0 2px rgba(var(--ring), 0.9), 0 0 14px -1px rgba(var(--ring), 0.75), inset 0 0 10px rgba(0,0,0,0.5);
    }
    /* the sprite fills its square tile, so animated sprites keep their full shape */
    .bmap-token-portrait img, .bmap-token-portrait video, .placement-token-portrait img, .placement-token-portrait video {
      width: 100%; height: 100%; object-fit: contain; filter: drop-shadow(0 2px 3px rgba(0,0,0,0.85));
    }
    .bmap-token.selected .bmap-token-portrait { animation: bmapPulse 1.5s ease-in-out infinite; }
    @keyframes bmapPulse {
      0%, 100% { box-shadow: 0 0 0 2px rgb(255,215,0), 0 0 12px 1px rgba(255,215,0,0.7), inset 0 0 10px rgba(0,0,0,0.6); }
      50% { box-shadow: 0 0 0 3px rgb(255,215,0), 0 0 24px 5px rgba(255,215,0,0.85), inset 0 0 10px rgba(0,0,0,0.6); }
    }
    /* the sprite turns inside its (fixed) frame to show which way the token faces */
    .bmap-sprite { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; transition: transform 0.25s ease; }

    /* ---- altitude: a flyer is drawn lifted off its tile with a shadow on the ground and an altitude badge ---- */
    .bmap-token.airborne .bmap-token-portrait { transform: translateY(-14%); box-shadow: 0 0 0 2px rgba(var(--ring), 0.9), 0 0 14px -1px rgba(var(--ring), 0.75); }
    .bmap-token.airborne::before {
      content: ''; position: absolute; left: 14%; right: 14%; bottom: 3%; height: 16%; border-radius: 50%;
      background: radial-gradient(ellipse at center, rgba(0,0,0,0.65), rgba(0,0,0,0) 70%);
    }
    /* ---- burrowed: sunk into its tile, earthy and dimmed, with a depth badge ---- */
    .bmap-token.burrowed .bmap-token-portrait {
      transform: translateY(10%); filter: sepia(0.6) brightness(0.65);
      box-shadow: 0 0 0 2px rgba(150,110,60,0.95), inset 0 -10px 14px rgba(70,45,20,0.8);
    }
    .bmap-token.burrowed .bmap-alt { background: rgb(176,130,72); }
    .bmap-alt {
      position: absolute; top: -2px; right: -2px; z-index: 3; font-size: 0.62rem; font-weight: 800; line-height: 1;
      padding: 0.15rem 0.35rem; border-radius: 999px; color: #0b0d1a; background: rgb(var(--ring)); box-shadow: 0 0 6px rgba(var(--ring), 0.8);
    }

    /* ---- floating action bar over a selected token ---- */
    .bmap-toolbar {
      position: absolute; z-index: 6; display: flex; align-items: center; gap: 0.25rem; padding: 0.3rem;
      background: rgba(18,20,40,0.88); border: 1px solid rgba(140,170,255,0.35); border-radius: 999px;
      box-shadow: 0 6px 22px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,0,0,0.4); backdrop-filter: blur(6px);
      transform: translate(-50%, 0); white-space: nowrap; pointer-events: auto;
    }
    .bmap-toolbar.above { transform: translate(-50%, -100%); }
    .bmap-toolbar button {
      border: none; background: rgba(255,255,255,0.08); color: #e8ecff; font-size: 1rem; font-weight: 700;
      min-width: 2.1rem; height: 2.1rem; padding: 0 0.6rem; border-radius: 999px; cursor: pointer; transition: background 0.12s, transform 0.08s;
    }
    .bmap-toolbar button:hover { background: rgba(255,215,0,0.28); }
    .bmap-toolbar button:active { transform: scale(0.92); }
    .bmap-toolbar button.on { background: rgba(255,140,60,0.55); }
    .bmap-toolbar .tb-sep { width: 1px; height: 1.3rem; background: rgba(255,255,255,0.18); }
    .bmap-toolbar .tb-label { font-size: 0.72rem; font-weight: 600; opacity: 0.75; padding: 0 0.3rem; }
  `;
  document.head.appendChild(style);
}
