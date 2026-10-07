// Shared look-and-feel + geometry helpers for every interactive battle-map surface (the in-app popup in
// battle-map-popup.js, the terrain-area picker in terrain-area-picker.js, and combat-wip.js's placement
// screen). One stylesheet, so the three can't drift apart -- the read-only kiosk page (battle-map.html) is
// a separate static page and carries its own lighter copy of the same palette.
//
// Class names are the long-standing .bmap-* / .placement-* ones, restyled here: thin glowing grid lines
// instead of boxed cells, square tokens with a side-coloured frame whose sprite turns to face the way the token faces, and
// colour-coded terrain zones. Nothing here knows about game rules beyond the terrain kinds' colours.
import { terrainKindOf } from './move-effects.js';

/** RGB triples (not hex) so CSS can use them at any alpha: rgba(var(--zc), .2). */
export const ZONE_RGB = {
  electric: '247,208,44',
  grassy: '82,200,90',
  misty: '242,154,200',
  psychic: '232,80,156',
  other: '127,166,255',
};

export function zoneKind(terrain) {
  return terrainKindOf(terrain) || 'other';
}

/** "col,row" -> the kinds of every tile-limited terrain zone covering that cell (first one paints it). */
export function zoneKindsByCell(session) {
  const map = new Map();
  for (const z of session?.terrainZones || []) {
    const kind = zoneKind(z);
    for (const c of z.cells || []) {
      if (!map.has(c)) map.set(c, []);
      map.get(c).push(kind);
    }
  }
  return map;
}

/** One entry per active terrain for the legend/banner: { name, kind, scope: 'all' | 'zone', roundsLeft }. */
export function activeTerrainSummary(session) {
  const out = [];
  const left = (t) => (t.expiresRound != null && session.round != null ? Math.max(0, t.expiresRound - session.round) : null);
  if (session?.terrain) out.push({ name: session.terrain.name, kind: zoneKind(session.terrain), scope: 'all', roundsLeft: left(session.terrain) });
  for (const z of session?.terrainZones || []) out.push({ name: z.name, kind: zoneKind(z), scope: 'zone', roundsLeft: left(z) });
  return out;
}

export function legendHtml(session) {
  const items = activeTerrainSummary(session);
  if (!items.length) return '';
  return items.map(t => {
    const rounds = t.roundsLeft == null ? '' : ` · ${t.roundsLeft} round${t.roundsLeft === 1 ? '' : 's'} left`;
    return `<span class="bmap-legend-chip" style="--zc:${ZONE_RGB[t.kind]}"><i></i>${t.name} <small>${t.scope === 'all' ? 'whole map' : 'marked area'}${rounds}</small></span>`;
  }).join('');
}

/** Centre of an NxN footprint anchored at its bottom-left cell, in (fractional) cell coordinates. */
export function tokenCenter(pos, size = 1) {
  return { x: pos.col + (size - 1) / 2, y: pos.row - (size - 1) / 2 };
}

/** Cells (as a Set of "col,row") whose centre lies within `radiusCells` of the given centre. */
export function circleCells(board, cx, cy, radiusCells) {
  const { cols, rows } = board.grid;
  const out = new Set();
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      if (Math.hypot(c - cx, r - cy) <= radiusCells + 0.35) out.add(`${c},${r}`);
    }
  }
  return out;
}

/** The cells a 90-degree cone of `lengthCells` reaches from (cx, cy) when facing `facing` degrees clockwise from up. */
export function coneCells(board, cx, cy, facing, lengthCells) {
  const { cols, rows } = board.grid;
  const out = new Set();
  const rad = (facing * Math.PI) / 180;
  const fx = Math.sin(rad), fy = -Math.cos(rad);
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const dx = c - cx, dy = r - cy;
      const dist = Math.hypot(dx, dy);
      if (dist < 0.5 || dist > lengthCells + 0.35) continue;
      // Within 45 degrees of the facing direction on either side.
      if ((dx * fx + dy * fy) / dist >= Math.cos(Math.PI / 4) - 0.001) out.add(`${c},${r}`);
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
    .bmap-cell.zone-electric { --zc: ${ZONE_RGB.electric}; }
    .bmap-cell.zone-grassy { --zc: ${ZONE_RGB.grassy}; }
    .bmap-cell.zone-misty { --zc: ${ZONE_RGB.misty}; }
    .bmap-cell.zone-psychic { --zc: ${ZONE_RGB.psychic}; }
    .bmap-cell.zone-other { --zc: ${ZONE_RGB.other}; }
    /* whole-map terrain: one tinted wash over the whole stage instead of per cell */
    .bmap-stage.global-electric::after, .bmap-stage.global-grassy::after, .bmap-stage.global-misty::after,
    .bmap-stage.global-psychic::after, .bmap-stage.global-other::after {
      content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 1;
      box-shadow: inset 0 0 50px rgba(var(--zc), 0.45); background: rgba(var(--zc), 0.06);
    }
    .bmap-stage.global-electric { --zc: ${ZONE_RGB.electric}; } .bmap-stage.global-grassy { --zc: ${ZONE_RGB.grassy}; }
    .bmap-stage.global-misty { --zc: ${ZONE_RGB.misty}; } .bmap-stage.global-psychic { --zc: ${ZONE_RGB.psychic}; }
    .bmap-stage.global-other { --zc: ${ZONE_RGB.other}; }
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
