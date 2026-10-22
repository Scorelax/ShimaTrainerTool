// Interactive in-app battle map popup -- lets a player VIEW the same board the table kiosk screen
// (battle-map.html) shows, and MOVE / TURN their own token. Click your token (it's the only clickable one, and
// only on your turn) and a toolbar appears in the strip above the map (never over it): rotate left/right in 45-degree steps (or Q / E),
// and a cone / line tool you aim at any angle by dragging on the map (the token's own cone and line moves, at their length). Click a cell to STAGE a move (a distance preview,
// no server call yet), then Confirm to actually commit it -- a deliberate extra step so a misclick can't burn real
// movement (the user's own call: hard-enforce the movement budget below, but only after an explicit confirm).
// Cells the token can still reach with the movement it has left are tinted while it's selected.
//
// Turn-gating is enforced both ways -- a token is only selectable when it's both yours (`owner` field, set by
// combat-wip.js's "Join as yourself" flow) AND the current turn holder, and the server re-checks the same thing
// (move-token / rotate-token in routes_combat.py, same authority model as use-move) so neither check can be
// bypassed from the client. Moving also turns the token toward where it went (server side); rotating is free.
//
// Movement budget: each participant carries `speeds` ([{type, ft}, ...], see combat.js's
// buildTrainerCombatant/buildPokemonCombatant) and a server-tracked `movementUsed` (feet moved so far this turn,
// reset when their next turn starts -- see routes_combat.py's _advance_turn). A participant with no `speeds` at all
// (a DM's freeform enemy, or anyone added before this existed) gets no budget UI and no enforcement -- move-token
// skips the check entirely for them. This never asks (or cares) WHICH movement type a move actually uses -- the
// user's own call: that decision happens at the table, so the numbers here are purely informational per-type
// reference points.
//
// Terrain moves show up here too: tile-limited zones tint their tiles (colour per terrain), a whole-map terrain
// washes the whole stage, and a legend under the map lists what's active and for how long (battle-map-view.js).
//
// DM override (the user's ask, 2026-10-19): on the DM console's Map tab (`dmOverride`) the DM can pick ANY token -- a
// player's trainer or Pokemon too, whoever's turn it is -- and move, turn or lift it, after "Confirm DM override"
// (dm-place-token: no movement used, nothing in the way checked but the map's edge).
//
// Mirrors move-popup.js's overlay pattern (create the DOM once, reuse across calls) and target-picker.js's
// self-contained-styles approach (injects its own copy of the shared .combat-popup-* base rules rather than
// assuming another module already did).
import { CombatAPI } from '../api.js';
import { patchPortraitMedia } from './sprite-media.js';
import { visibleToViewer } from './combat-visibility.js';
import { gridCellsHtml, gridTemplateStyle, cellRect, footprintForSize, footprintCells, mapObjectsHtml } from './battle-map-grid.js';
import { showCombatAlert } from './combat-alert.js';
import { waitForOpenWindow } from './reaction-window.js';
import { moveCostFt, altitudeLimits, blockedCellOnPath, isLevitating, movementBudget } from './move-effects.js';
import { injectBattleMapStyles, zoneKindsByCell, legendHtml, spriteTransform, unwrapAngle, activeTerrainSummary } from './battle-map-view.js';
import { coneSquares, coneHits, coneOutlineSvg, injectConeStyles } from './cone-area.js';
import { attachMapZoom, zoomControlsHtml, injectMapZoomStyles } from './map-zoom.js';
import { lineFtFromRange, lineGeometry, lineAimOrigin, lineCells, lineCellsHtml, lineHits, lineGuideStyle, lineOutlineSvg, angleToPointer, injectLineStyles } from './line-area.js';


function _injectStyles() {
  if (document.getElementById('battle-map-popup-styles')) return;
  injectBattleMapStyles();
  injectLineStyles();
  injectConeStyles();
  injectMapZoomStyles();
  const style = document.createElement('style');
  style.id = 'battle-map-popup-styles';
  style.textContent = `
    .combat-popup-overlay { position: fixed; top:0; left:0; width:100%; height:100%; background: rgba(2,3,10,0.82); z-index: 1000; justify-content: center; align-items: center; backdrop-filter: blur(4px); }
    .combat-popup-content { background: linear-gradient(180deg, #1a1d36, #11132a); border: 1px solid rgba(140,170,255,0.22); border-radius: 18px; max-width: 680px; width: 94%; max-height: 92vh; overflow-y: auto; position: relative; box-shadow: 0 14px 50px rgba(0,0,0,0.7); color: #e0e0e0; }
    .combat-move-popup-header { padding: 1rem 1.2rem; border-radius: 18px 18px 0 0; border-bottom: 1px solid rgba(140,170,255,0.18); display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; position: relative; background: rgba(255,255,255,0.03); }
    .combat-move-popup-header h2 { margin: 0; font-size: 1.25rem; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; }
    .bmap-round { margin-left: auto; margin-right: 2.4rem; font-size: 0.75rem; font-weight: 700; padding: 0.2rem 0.65rem; border-radius: 999px; background: rgba(140,170,255,0.14); border: 1px solid rgba(140,170,255,0.35); color: #b9c8ff; }
    .combat-popup-close { position: absolute; top: 0.8rem; right: 0.8rem; background: rgba(255,255,255,0.08); border: none; border-radius: 50%; width: 32px; height: 32px; font-size: 1.2rem; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; color: inherit; }
    .combat-popup-close:hover { background: rgba(255,255,255,0.18); }
    .combat-move-popup-body { padding: 1rem 1.2rem 1.2rem; }

    .bmap-hint { font-size: 0.8rem; color: #a0a8d0; margin-bottom: 0.6rem; min-height: 1.1em; }

    .bmap-move-panel {
      display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem;
      background: rgba(255,255,255,0.04); border: 1px solid rgba(140,170,255,0.2);
      border-radius: 12px; padding: 0.55rem 0.7rem; margin-bottom: 0.7rem; font-size: 0.85rem;
    }
    .bmap-move-chip { background: rgba(93,173,226,0.14); border: 1px solid rgba(93,173,226,0.4); border-radius: 999px; padding: 0.2rem 0.65rem; font-weight: 600; }
    .bmap-move-chip.depleted { color: #e77373; background: rgba(231,115,115,0.1); border-color: rgba(231,115,115,0.4); }
    .bmap-stage-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; width: 100%; }
    .bmap-stage-row button { border: none; border-radius: 999px; padding: 0.35rem 0.95rem; font-size: 0.85rem; font-weight: 700; cursor: pointer; }
    .bmap-confirm-btn { background: linear-gradient(135deg, #2ecc71, #1e8449); color: #fff; box-shadow: 0 0 14px rgba(46,204,113,0.4); }
    .bmap-confirm-btn:disabled { background: #444; color: #888; cursor: not-allowed; box-shadow: none; }
    .bmap-cancel-btn { background: rgba(255,255,255,0.12); color: #e0e0e0; }
    .bmap-stage-warning { color: #e77373; }
    .bmap-stage.line-aiming { touch-action: none; cursor: crosshair; }
    .bmap-stage-alt { font-weight: 800; color: #ffd76a; background: rgba(255,215,106,0.12); border: 1px solid rgba(255,215,106,0.45); border-radius: 999px; padding: 0.15rem 0.6rem; }
    /* a staged move: the token is drawn at its destination, the tile it left keeps a faint dashed outline */
    .bmap-token.moving { opacity: 0.9; pointer-events: none; }
    .bmap-token.moving .bmap-token-portrait { outline: 2px dashed #FFD700; outline-offset: 2px; }
    .bmap-toolbar button:disabled { opacity: 0.35; cursor: not-allowed; }
    .bmap-token-origin { position: absolute; box-sizing: border-box; pointer-events: none; border-radius: 14%; border: 2px dashed rgba(255,215,0,0.45); background: rgba(255,215,0,0.06); }
    /* the selected token's toolbar lives in this strip above the map, so it never covers the board */
    .bmap-toolbar-slot { display: flex; justify-content: center; min-height: 2.8rem; margin-bottom: 0.5rem; }
    .bmap-toolbar-slot .bmap-toolbar { position: static; transform: none; }
    .bmap-toolbar .tb-name { font-size: 0.8rem; font-weight: 700; padding: 0 0.5rem 0 0.4rem; color: #ffd76a; }
    /* the whole screen (map-zoom.js): header with the zoom buttons, then everything you press, then the map */
    .bmap-content .combat-move-popup-header { padding: 0.55rem 0.9rem; }
    .bmap-content .combat-move-popup-header h2 { font-size: 1.05rem; }
    .bmap-content .mz-controls { margin-left: auto; }
    .bmap-content .bmap-round { margin-left: 0.4rem; }
    .bmap-content .combat-move-popup-body { padding: 0.5rem 0.8rem 0.8rem; }
    .bmap-content .bmap-hint { margin-bottom: 0.4rem; }
    .bmap-content .bmap-move-panel { margin-bottom: 0.45rem; padding: 0.4rem 0.6rem; }
    .bmap-content .bmap-toolbar-slot { margin-bottom: 0.4rem; min-height: 2.6rem; }
    .bmap-content .bmap-legend:empty, .bmap-content .bmap-round:empty { display: none; }
    .bmap-move-panel[hidden] { display: none; }
    .bmap-content .bmap-legend { margin: 0 0 0.45rem; }
    /* inline (the DM console's Map tab): the same map filling its tab instead of floating over the page */
    .combat-popup-overlay.bmap-inline { position: relative; top: auto; left: auto; width: 100%; height: 100%; z-index: auto;
      background: none; backdrop-filter: none; }
    .bmap-inline .mz-fullcard { width: 100% !important; height: 100% !important; border-radius: 0; border: none; box-shadow: none; }
    .bmap-inline .combat-popup-close { display: none; }
    @media (max-width: 520px) { .bmap-content .combat-move-popup-header h2 { font-size: 0.9rem; } }
  `;
  document.head.appendChild(style);
}

let _overlay = null;
let _zoom = null; // map-zoom.js: the map fitted to the screen, zoomed on its own
let _session = null;
let _ownerName = null;
let _selectedTokenId = null;
let _dmOverride = false; // the DM console's Map tab: any token can be picked (see the header)
// A clicked-but-not-yet-confirmed destination for _selectedTokenId.
let _stagedDestination = null;
// The cone tool (cone-area.js): a cone from the selected token, aimed at any angle by dragging on the map, like the line.
// Its length is one of the token's own cone moves (cycled by tapping the length), or 15ft when it knows none.
let _coneOn = false;
let _coneChoice = 0;
// The line tool (line-area.js): a 5ft-wide strip from the selected token, aimed at any angle by dragging on the map.
// Its length is one of the token's own line moves (cycled by tapping the length), or 30ft when it knows none.
let _lineOn = false;
let _lineChoice = 0;
let _aimAngle = 0;   // where the line / cone points (degrees clockwise from up)
let _aiming = false; // a drag on the map is turning it
// The altitude (ft) the selected token is being sent to, or null to stay where it is -- changed by the toolbar's ▲ ▼,
// confirmed together with the staged cell (a pure climb stages the token's own cell).
let _stagedAlt = null;
// participantId -> the sprite's last drawn angle, unwrapped (see unwrapAngle), so a turn animates the short way round.
const _spriteAngles = new Map();

function _ensureDom() {
  if (_overlay) return;
  _injectStyles();
  _overlay = document.createElement('div');
  _overlay.className = 'combat-popup-overlay';
  _overlay.id = 'battleMapPopup';
  _overlay.style.display = 'none';
  _overlay.innerHTML = `
    <div class="combat-popup-content bmap-content mz-fullcard">
      <div class="combat-move-popup-header">
        <button id="battleMapClose" class="combat-popup-close">×</button>
        <h2>🗺️ Battle Map</h2>
        <span id="bmapZoomControls">${zoomControlsHtml()}</span>
        <span class="bmap-round" id="bmapRound"></span>
      </div>
      <div class="combat-move-popup-body mz-fill">
        <div class="bmap-hint" id="bmapHint"></div>
        <div class="bmap-move-panel" id="bmapMovePanel" hidden></div>
        <div class="bmap-toolbar-slot" id="bmapToolbarSlot"></div>
        <div class="bmap-legend" id="bmapLegend"></div>
        <div id="bmapViewport">
          <div class="bmap-stage" id="bmapStage">
            <div class="bmap-grid" id="bmapGrid"></div>
            <div class="bmap-objects" id="bmapObjects"></div>
            <div class="bmap-tokens" id="bmapTokens"></div>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(_overlay);
  _zoom = attachMapZoom({
    viewport: document.getElementById('bmapViewport'),
    stage: document.getElementById('bmapStage'),
    getGrid: () => _session?.board?.grid,
    controls: document.getElementById('bmapZoomControls'),
  });

  document.getElementById('battleMapClose').addEventListener('click', _close);
  document.getElementById('bmapLegend').addEventListener('click', (e) => {
    const x = e.target.closest('.bmap-legend-x');
    if (x) CombatAPI.removeFieldZone(x.dataset.key, x.dataset.id).catch(err => showCombatAlert(err.message, { title: 'Error' }));
  });
  _overlay.addEventListener('click', (e) => { if (e.target === _overlay && !_overlay.classList.contains('bmap-inline')) _close(); });
  // Line / cone tool: press and drag anywhere on the map to sweep it round (a tap aims it straight at that spot).
  const stage = document.getElementById('bmapStage');
  stage.addEventListener('pointerdown', (e) => {
    if (!(_lineOn || _coneOn) || !_selected()) return;
    e.preventDefault();
    _aiming = true;
    stage.setPointerCapture?.(e.pointerId);
    _aimTool(e);
  });
  stage.addEventListener('pointermove', (e) => { if (_aiming) _aimTool(e); });
  const stopAiming = () => { _aiming = false; };
  stage.addEventListener('pointerup', stopAiming);
  stage.addEventListener('pointercancel', stopAiming);
  document.addEventListener('keydown', (e) => {
    if (!_overlay || _overlay.style.display === 'none' || !_selectedTokenId) return;
    if (e.key === 'q' || e.key === 'Q') _rotate(-45);
    else if (e.key === 'e' || e.key === 'E') _rotate(45);
    else if (e.key === 'Escape') { _selectedTokenId = null; _stagedDestination = null; _stagedAlt = null; _render(); }
  });
}

function _close() {
  if (_overlay) _overlay.style.display = 'none';
  _selectedTokenId = null;
  _stagedDestination = null; _stagedAlt = null;
}

/** Opens the popup for `trainerName` (whoever's using this device) showing
 * `session`'s board. Re-openable/re-callable freely -- each call just
 * re-renders against the given session. `selectId` starts with that token
 * already selected (Disengage: straight into moving) -- only when it's the
 * viewer's own token and its turn, the same rule a click follows. */
export function showBattleMap(session, trainerName, { selectId = null, container = null, dmOverride = false } = {}) {
  _session = session;
  _ownerName = trainerName;
  _dmOverride = !!dmOverride;
  const pre = selectId && session.participants?.[selectId];
  _selectedTokenId = pre && session.board?.tokens?.[selectId] && pre.owner === trainerName
    && (_adventure(session) || selectId === _activeParticipantId(session)) ? selectId : null;
  _stagedDestination = null; _stagedAlt = null;
  _ensureDom();
  // `container`: shown inside it (the DM console's Map tab) instead of over the page.
  const host = container || document.body;
  if (_overlay.parentElement !== host) host.appendChild(_overlay);
  _overlay.classList.toggle('bmap-inline', !!container);
  _overlay.style.display = 'flex';
  _render();
  _zoom.reset(); // opens on the whole map, fitted to the screen
}

/** Closes the map -- one shown inside a container goes back to being a popup (hidden) for next time. */
export function hideBattleMap() {
  if (!_overlay) return;
  _close();
  if (_overlay.classList.contains('bmap-inline')) {
    _overlay.classList.remove('bmap-inline');
    document.body.appendChild(_overlay);
  }
}

/** Call on every live session push so the popup stays current while open;
 * no-ops (and doesn't re-render) when the popup isn't showing. */
export function updateBattleMap(session) {
  _session = session;
  if (_overlay && _overlay.style.display !== 'none') _render();
}

/** Whoever currently has the floor -- reacting participant if one's mid-
 * reaction, otherwise the normal turn holder. Same definition as
 * routes_combat.py's _active_participant_id, kept in sync manually since
 * there's no shared module between Python and JS for this. */
/** An adventure (the DM console's Adventure module): no turns and no movement limit -- each player moves their own
 * tokens whenever they like (routes_combat.py's _adventure_move). */
function _adventure(session = _session) {
  return session?.battleType === 'adventure';
}

function _activeParticipantId(session) {
  if (session.reactingParticipantId) return session.reactingParticipantId;
  if (session.turnOrder && session.turnOrder.length) return session.turnOrder[session.turnIndex];
  return null;
}

/** Feet `p` can still move this turn under its best movement type -- its speeds with every buff, debuff and swap
 * applied (move-effects.js's movementBudget, the same number the server enforces), minus the single shared
 * movementUsed counter (switching between speeds still draws from one pool, 5e's own rule). null with no speeds. */
function _bestRemainingFt(p) {
  if (_adventure() || _overriding()) return null; // no movement limit on an adventure, nor for the DM's override
  return movementBudget(p)?.remaining ?? null;
}

/** Grid distance between two cells in feet -- Chebyshev (diagonal costs the
 * same as straight), not 5e's stricter 5/10ft alternating-diagonal rule.
 * Matches routes_combat.py's own _move_token calc exactly (kept in sync
 * manually, same as _activeParticipantId above) since the client needs to
 * preview the same number the server will actually enforce. */
function _distanceFt(fromCol, fromRow, toCol, toRow, p = null, z0 = 0, z1 = 0) {
  // Difficult ground (Fissure) doubles the cost of the tiles entered, and climbing costs 1ft per foot -- see move-effects.js's
  // moveCostFt, which mirrors the server's charge exactly.
  return p ? moveCostFt(_session, p, fromCol, fromRow, toCol, toRow, z0, z1) : Math.max(Math.abs(toCol - fromCol), Math.abs(toRow - fromRow)) * 5;
}

/** Steps the selected token's target altitude by `delta` ft (never below the ground) and stages the move there. */
function _stepAltitude(delta) {
  const sel = _selected();
  if (!sel) return;
  // Flyers go as high as they like, hover-only creatures stay within 5ft, burrowers can go below the ground.
  const [low, high] = altitudeLimits(sel.p);
  const z0 = sel.pos.z || 0;
  let next = (_stagedAlt ?? z0) + delta;
  if (low !== null) next = Math.max(Math.min(low, z0), next);
  if (high !== null) next = Math.min(Math.max(high, z0), next);
  _stagedAlt = next === (sel.pos.z || 0) && !_stagedDestination ? null : next;
  if (_stagedAlt !== null && !_stagedDestination) _stagedDestination = { col: sel.pos.col, row: sel.pos.row };
  _render();
}

/** Turns the selected token by `delta` degrees (a multiple of 45). Applied locally right away so it feels instant;
 * the server's push confirms it, and a rejection puts it back. */
function _rotate(delta) {
  const id = _selectedTokenId;
  const token = id && _session?.board?.tokens?.[id];
  if (!token) return;
  const before = token.facing || 0;
  const next = (((before + delta) % 360) + 360) % 360;
  token.facing = next;
  _render();
  (_overriding() ? CombatAPI.dmPlaceToken(id, { col: token.col, row: token.row, facing: next, z: token.z || 0 }) : CombatAPI.rotateToken(id, next)).catch(err => {
    token.facing = before;
    _render();
    showCombatAlert(err.message, { title: 'Error' });
  });
}

function _render() {
  if (!_session || !_session.board) return;

  const roundEl = document.getElementById('bmapRound');
  if (roundEl) roundEl.textContent = _session.started || _session.round ? `Round ${_session.round ?? 1}` : '';

  const hint = document.getElementById('bmapHint');
  if (hint) {
    if (_overriding()) {
      const name = _session.participants[_selectedTokenId]?.name || 'it';
      hint.textContent = _stagedDestination ? `Confirm the DM override to move ${name} there -- or click a different cell.`
        : `DM override: click a cell to move ${name} there · ⟲ ⟳ turn it at once. No movement is used, and it doesn't have to be its turn.`;
    } else if (_stagedDestination) {
      hint.textContent = 'Confirm the move, or click a different cell.';
    } else if (_selectedTokenId && (_lineOn || _coneOn)) {
      const tool = _lineOn ? 'line' : 'cone';
      hint.textContent = `Drag on the map to aim the ${tool} (any angle) · tap the length to switch ${tool} move · turn ${_lineOn ? 'Line' : 'Cone'} off to move again.`;
    } else if (_selectedTokenId) {
      hint.textContent = 'Click a cell to move there · ⟲ ⟳ (or Q / E) to turn · Cone / Line to aim one and see who it would catch.';
    } else if (_adventure()) {
      hint.textContent = 'Click one of your tokens (gold ring) to move or turn it -- there are no turns on an adventure.';
    } else {
      const activeId = _activeParticipantId(_session);
      const activeIsMine = !!activeId && _session.participants[activeId]?.owner === _ownerName;
      hint.textContent = activeIsMine
        ? 'Click your active token (gold ring) to move or turn it.'
        : "It's not your turn -- you can only move or turn a token on your own turn.";
    }
  }
  _renderMovePanel();
  _renderStage();
  _zoom?.refit(); // the grid may have changed size (the DM's map editor)
  // While aiming a line or cone, a drag on the map turns it instead of scrolling the page (phones).
  document.getElementById('bmapStage')?.classList.toggle('line-aiming', (_lineOn || _coneOn) && !!_selected());
  _renderGrid();
  _renderObjects();
  _renderTokens();
  _renderToolbar();
  const legend = document.getElementById('bmapLegend');
  if (legend) legend.innerHTML = legendHtml(_session, { removable: true });
}

/** Shows the active mover's remaining-movement chips (whenever it's your
 * own turn, whether or not you've selected the token yet -- the user's own
 * ask: know how far you can move before you've even clicked anything) and,
 * once a destination is staged, a distance/confirm row. Purely a reference
 * display -- which movement type actually covers a given move is a table
 * decision, never asked here (see this file's own header comment); the
 * only question this UI (or move-token itself) answers is whether the
 * distance is possible under ANY of the participant's types at all.
 * Hidden entirely for a participant with no `speeds` recorded at all. */
function _renderMovePanel() {
  const panel = document.getElementById('bmapMovePanel');
  if (!panel) return;
  if (_overriding()) { _renderOverridePanel(panel); return; }

  // An adventure moves whichever of the player's own tokens is picked, as far as it likes.
  const adventure = _adventure();
  const activeId = adventure ? _selectedTokenId : _activeParticipantId(_session);
  const p = activeId && _session.participants[activeId]?.owner === _ownerName
    ? _session.participants[activeId] : null;
  const budget = p ? (adventure ? { speeds: [], remaining: Infinity } : movementBudget(p)) : null;
  if (!budget || (adventure && !_stagedDestination)) { panel.hidden = true; return; }
  panel.hidden = false;

  const ftText = (n) => (Number.isInteger(n) ? n : Math.round(n * 10) / 10);
  const chips = budget.speeds.map(s =>
    `<span class="bmap-move-chip${s.remaining <= 0 ? ' depleted' : ''}">${s.type}: ${ftText(s.remaining)}/${ftText(s.ft)}ft</span>`).join('');

  let stageRow = '';
  if (_stagedDestination && _selectedTokenId === activeId) {
    const current = _session.board.tokens[activeId];
    const z0 = current?.z || 0;
    const z1 = _stagedAlt ?? z0;
    const distance = current ? _distanceFt(current.col, current.row, _stagedDestination.col, _stagedDestination.row, p, z0, z1) : 0;
    const canMove = distance <= budget.remaining;

    // A depth change is easy to stage by accident (one tap on ▼/▲), so it gets its own highlighted line and the
    // button says what it will do.
    const altLine = (z1 !== z0
      ? `<span class="bmap-stage-alt">${z1 < 0 ? '⛏' : z1 > 0 ? '🪽' : '⬇'} Ends ${_altText(z1)} (now ${_altText(z0)})</span>` : '')
      + (_sharesSpaceAt(activeId, _stagedDestination.col, _stagedDestination.row, z1)
        ? '<span class="bmap-stage-alt">↔ Someone is already there -- fine to pass through, but ending the turn here pushes it to a free square beside them</span>' : '');
    const confirmLabel = z1 < 0 && z1 !== z0 ? 'Confirm Burrow' : z1 > 0 && z1 !== z0 ? 'Confirm Climb' : 'Confirm Move';
    stageRow = canMove ? `
        <div class="bmap-stage-row">
          <span>Move ${distance}ft</span>
          ${altLine}
          <button type="button" class="bmap-confirm-btn" id="bmapConfirmMove">${confirmLabel}</button>
          <button type="button" class="bmap-cancel-btn" id="bmapCancelStage">Cancel</button>
        </div>` : `
        <div class="bmap-stage-row">
          <span class="bmap-stage-warning">Not enough movement left to reach that cell (needs ${distance}ft).</span>
          <button type="button" class="bmap-cancel-btn" id="bmapCancelStage">Cancel</button>
        </div>`;
  }

  panel.innerHTML = `${chips}${stageRow}`;

  document.getElementById('bmapCancelStage')?.addEventListener('click', () => {
    _stagedDestination = null; _stagedAlt = null;
    _render();
  });
  document.getElementById('bmapConfirmMove')?.addEventListener('click', (e) => {
    const movingId = _selectedTokenId;
    const { col, row } = _stagedDestination;
    const altitude = _stagedAlt;
    // The token stays drawn on its new square until the server answers -- then the answer itself redraws the map
    // (api.js applies it at once), so a slow or dropped live connection can't leave it looking like it snapped back.
    e.currentTarget.disabled = true;
    e.currentTarget.textContent = 'Moving…';
    const done = () => {
      if (_selectedTokenId === movingId) { _selectedTokenId = null; _stagedDestination = null; _stagedAlt = null; }
      _render();
    };
    CombatAPI.moveToken(movingId, col, row, altitude === null ? undefined : altitude)
      // Walking away from a hostile creature can open a reaction window (Pursuit) that nobody else is waiting on -- run its clock.
      .then(res => {
        if (res?.data?.participants && (!_session?.version || (res.data.version || 0) >= _session.version)) _session = res.data;
        done();
        if (res?.data?.pendingReaction) waitForOpenWindow();
      })
      .catch(err => { done(); showCombatAlert(err.message, { title: 'Error' }); });
  });
}

/** DM override: where the picked token goes, and "Confirm DM override" (dm-place-token -- anyone's token, any time). */
function _renderOverridePanel(panel) {
  const sel = _selected();
  if (!sel || !_stagedDestination) { panel.hidden = true; return; }
  panel.hidden = false;
  const z0 = sel.pos.z || 0;
  const z1 = _stagedAlt ?? z0;
  panel.innerHTML = `
    <div class="bmap-stage-row bmap-override-row">
      <span>⚠ Move <b>${sel.p.name}</b> to (${_stagedDestination.col}, ${_stagedDestination.row})${z1 !== z0 ? `, ${_altText(z1)}` : ''} -- a DM override: ${sel.p.owner && sel.p.owner !== _ownerName ? `${sel.p.owner}'s token, ` : ''}no movement used</span>
      <button type="button" class="bmap-confirm-btn" id="bmapConfirmOverride">Confirm DM override</button>
      <button type="button" class="bmap-cancel-btn" id="bmapCancelStage">Cancel</button>
    </div>`;
  document.getElementById('bmapCancelStage').addEventListener('click', () => { _stagedDestination = null; _stagedAlt = null; _render(); });
  document.getElementById('bmapConfirmOverride').addEventListener('click', (e) => {
    const id = sel.id;
    const { col, row } = _stagedDestination;
    e.currentTarget.disabled = true;
    e.currentTarget.textContent = 'Moving…';
    CombatAPI.dmPlaceToken(id, { col, row, facing: sel.pos.facing || 0, z: z1 })
      .then((res) => { if (res?.data?.participants) _session = res.data; })
      .catch(err => showCombatAlert(err.message, { title: 'DM override' }))
      .finally(() => { if (_selectedTokenId === id) { _stagedDestination = null; _stagedAlt = null; } _render(); });
  });
}

/** Whether `pid` standing at (col, row), z ft up, would share space with another creature -- the same square at the same
 * height (routes_combat.py's _push_out_of_shared_space moves it aside if it ends its turn like that). */
function _sharesSpaceAt(pid, col, row, z) {
  const n = footprintForSize(_session.participants[pid]?.size);
  const mine = new Set(footprintCells(col, row, n).map(c => `${c.col},${c.row}`));
  return Object.entries(_session.board.tokens).some(([id, t]) => {
    const p = _session.participants[id];
    if (id === pid || !p || p.status !== 'participating') return false;
    const m = footprintForSize(p.size);
    const tz = t.z || 0;
    return tz < z + 5 * n && z < tz + 5 * m && footprintCells(t.col, t.row, m).some(c => mine.has(`${c.col},${c.row}`));
  });
}

/** Keeps cells square for WHATEVER grid size is currently set (not just the
 * default) -- gridTemplateStyle divides the stage into equal fractions
 * regardless of shape, so the stage's own aspect-ratio has to be kept in
 * sync by hand here. Also applies/clears the background image and the
 * whole-map terrain wash. */
function _renderStage() {
  const stageEl = document.getElementById('bmapStage');
  if (!stageEl) return;
  const { cols, rows } = _session.board.grid;
  stageEl.style.aspectRatio = `${cols} / ${rows}`;
  const url = _session.board.backgroundImage;
  stageEl.classList.toggle('has-bg', !!url);
  stageEl.style.backgroundImage = url ? `url(${url})` : '';
  const globalKind = activeTerrainSummary(_session).find(t => t.scope === 'all')?.kind;
  stageEl.className = stageEl.className.replace(/\bglobal-\w+/g, '').trim();
  if (globalKind) stageEl.classList.add(`global-${globalKind}`);
}

/** Whether `id` may be moved the normal way by this viewer right now: its own token, on its turn (any time on an adventure). */
function _ownMove(id) {
  const p = _session?.participants?.[id];
  return !!p && !!_ownerName && p.owner === _ownerName && (_adventure() || id === _activeParticipantId(_session));
}

/** The DM moving a token it couldn't move the normal way (someone else's, or not its turn) -- DM override. */
function _overriding() {
  return _dmOverride && !!_selectedTokenId && !_ownMove(_selectedTokenId);
}

/** The selected token (if any) as { id, p, pos, size } -- the one thing the reach/cone overlays and toolbar key off. */
function _selected() {
  const id = _selectedTokenId;
  const pos = id && _session.board.tokens[id];
  const p = id && _session.participants[id];
  return pos && p ? { id, p, pos, size: footprintForSize(p.size) } : null;
}

function _renderGrid() {
  const gridEl = document.getElementById('bmapGrid');
  if (!gridEl) return;
  const sel = _selected();
  const zones = zoneKindsByCell(_session);

  // Reach: cells the selected mover can still afford (Chebyshev distance x 5ft, same as the server's budget check).
  const bestRemaining = sel ? _bestRemainingFt(sel.p) : null;

  gridEl.setAttribute('style', gridTemplateStyle(_session.board));
  const html = gridCellsHtml(_session.board, 'bmap-cell', (col, row) => {
    const key = `${col},${row}`;
    const classes = [];
    const zone = zones.get(key);
    if (zone) classes.push(`zone-${zone[0]}`);
    const z0 = sel?.pos.z || 0;
    if (sel && bestRemaining !== null && _distanceFt(sel.pos.col, sel.pos.row, col, row, sel.p, z0, _stagedAlt ?? z0) <= bestRemaining
        && !_blockedOnTheWay(sel, col, row)) classes.push('reach');
    if (_stagedDestination && col === _stagedDestination.col && row === _stagedDestination.row) classes.push('staged');
    return classes.join(' ');
  });
  // The same squares as last time (most pushes -- someone else's turn, a log line): left as they are, clicks and all
  // (the clicks read the selection when they happen)
  if (gridEl._html === html) return;
  gridEl._html = html;
  gridEl.innerHTML = html;

  gridEl.querySelectorAll('[data-cell]').forEach(cell => {
    const [col, row] = cell.dataset.cell.split(',').map(Number);
    cell.addEventListener('click', () => {
      if (!_selectedTokenId) return; // nothing selected -- clicking empty ground does nothing
      if (_lineOn || _coneOn) return; // the line / cone tool owns the map's clicks (aiming) until it's turned off
      const own = _selected();
      // Standing still isn't a move (movement comes in 5ft steps) -- unless an altitude change is staged with it.
      if (own && own.pos.col === col && own.pos.row === row && (_stagedAlt === null || _stagedAlt === (own.pos.z || 0))) return;
      const wall = own && !_overriding() && _blockedOnTheWay(own, col, row);
      if (wall) {
        showCombatAlert(`You can't move through (${wall[0]}, ${wall[1]}) -- that square is blocked.`, { title: 'Blocked' });
        return;
      }
      _stagedDestination = { col, row };
      _render();
    });
  });
}

/** The DM's blocked squares only stop a move that ends on the ground (a flyer passes over, a Levitate / hovering creature
 * floats over, a burrower goes under) --
 * [col, row] of the first one in the way, or null. The server checks the same (routes_combat.py's _move_token). */
function _blockedOnTheWay(sel, col, row) {
  const z1 = _stagedAlt ?? (sel.pos.z || 0);
  return z1 === 0 && !isLevitating(sel.p) ? blockedCellOnPath(_session, sel.pos.col, sel.pos.row, col, row, sel.size) : null;
}

/** The DM's map pictures (trees, rocks...) -- under the tokens, above the grid. Rebuilt only when they change. */
function _renderObjects() {
  const layer = document.getElementById('bmapObjects');
  if (!layer) return;
  const html = mapObjectsHtml(_session.board);
  if (layer._html !== html) { layer.innerHTML = html; layer._html = html; }
}

function _renderTokens() {
  const layer = document.getElementById('bmapTokens');
  if (!layer) return;
  const tokens = _session.board.tokens;
  const activeId = _activeParticipantId(_session);

  // The tokens are drawn again on every push, but each one's sprite (a looping video) is carried over to its new token
  // rather than loaded and started again -- unless its picture changed
  const shown = new Map();
  layer.querySelectorAll('.bmap-token[data-id] .bmap-sprite[data-image]').forEach((s) => {
    if (s.firstElementChild) shown.set(s.closest('.bmap-token').dataset.id, { image: s.dataset.image, nodes: [...s.children] });
  });
  layer.innerHTML = '';
  Object.entries(tokens).forEach(([id, pos]) => {
    const p = _session.participants[id];
    if (!p) return;

    const isMine = !!_ownerName && p.owner === _ownerName;
    const isMyTurn = isMine && (_adventure() || id === activeId); // an adventure has no turns
    const classes = ['bmap-token', p.side];
    if (isMine) classes.push('mine');
    if (isMyTurn) classes.push('my-turn');
    if (id === _selectedTokenId) classes.push('selected');
    if ((pos.z || 0) > 0) classes.push('airborne');

    // A staged move is shown live: the token is drawn where it's going (and at the staged altitude), with a faint outline
    // left on the tile it came from. Nothing is sent until Confirm; Cancel puts it back.
    const staged = id === _selectedTokenId && _stagedDestination;
    const shownAt = staged ? _stagedDestination : pos;
    const shownZ = staged && _stagedAlt !== null ? _stagedAlt : (pos.z || 0);
    const burrowedClass = classes.indexOf('burrowed');
    if (burrowedClass >= 0) classes.splice(burrowedClass, 1);
    if (shownZ < 0) classes.push('burrowed');
    if (staged) {
      classes.push('moving');
      const origin = document.createElement('div');
      origin.className = `bmap-token-origin ${p.side}`;
      Object.assign(origin.style, cellRect(_session.board, pos.col, pos.row, footprintForSize(p.size)));
      layer.appendChild(origin);
    }
    if (shownZ > 0 && !classes.includes('airborne')) classes.push('airborne');
    if (shownZ === 0) { const i = classes.indexOf('airborne'); if (i >= 0) classes.splice(i, 1); }

    const el = document.createElement('div');
    el.className = classes.join(' ');
    el.dataset.id = id;
    const name = visibleToViewer(p, 'name') ? p.name : '???';
    el.title = name;
    Object.assign(el.style, cellRect(_session.board, shownAt.col, shownAt.row, footprintForSize(p.size)));
    el.innerHTML = `<div class="bmap-token-portrait"><div class="bmap-sprite"></div></div>${shownZ > 0 ? `<span class="bmap-alt">↑${shownZ}ft</span>` : shownZ < 0 ? `<span class="bmap-alt">↓${-shownZ}ft</span>` : ''}`;
    const sprite = el.querySelector('.bmap-sprite');
    const kept = shown.get(id);
    if (kept && kept.image === (p.image || '')) { sprite.dataset.image = kept.image; sprite.append(...kept.nodes); }
    else patchPortraitMedia(sprite, p.image, name, { small: true });
    // The tokens are rebuilt every render, so start at the last drawn angle and let the transition carry it to the new one.
    const previous = _spriteAngles.has(id) ? _spriteAngles.get(id) : (pos.facing || 0);
    const angle = unwrapAngle(previous, pos.facing || 0);
    _spriteAngles.set(id, angle);
    sprite.style.transform = spriteTransform(previous);
    if (angle !== previous) requestAnimationFrame(() => requestAnimationFrame(() => { sprite.style.transform = spriteTransform(angle); }));

    // While a move is staged the token sits on the cell it's going to -- let clicks fall through to the cells beneath it.
    // The DM's override picks any token (outlined in orange).
    if (_dmOverride && !isMyTurn) classes.push('dm-override');
    el.className = classes.join(' ');
    if ((isMyTurn || _dmOverride) && !staged) {
      el.addEventListener('click', () => {
        if ((_lineOn || _coneOn) && _selectedTokenId) return; // aiming -- a tap on the token is part of the drag
        _selectedTokenId = _selectedTokenId === id ? null : id;
        _stagedDestination = null; _stagedAlt = null;
        _render();
      });
    }

    layer.appendChild(el);
  });
  _renderLine();
  _renderCone();
}

/** The selected token's line moves as { label, ft } (from the logged-in device's move list), or a plain 30ft line. */
function _lineOptions(p) {
  let rows = [];
  try { rows = JSON.parse(sessionStorage.getItem('moves') || '[]'); } catch { /* no move list -- generic line */ }
  const opts = (p?.moves || []).map(name => {
    const ft = lineFtFromRange(rows.find(r => r.name === name)?.range);
    return ft ? { label: name, ft } : null;
  }).filter(Boolean);
  return opts.length ? opts : [{ label: '', ft: 30 }];
}

function _lineOption(p) {
  const opts = _lineOptions(p);
  return opts[_lineChoice % opts.length];
}

/** The selected token's cone moves as { label, ft } ("Self (15ft. cone)", "40ft. cone"), or a plain 15ft cone. */
function _coneOptions(p) {
  let rows = [];
  try { rows = JSON.parse(sessionStorage.getItem('moves') || '[]'); } catch { /* no move list -- generic cone */ }
  const opts = (p?.moves || []).map(name => {
    const m = /(\d+)\s*ft\.?\s*cone/i.exec(String(rows.find(r => r.name === name)?.range || ''));
    return m ? { label: name, ft: Number(m[1]) } : null;
  }).filter(Boolean);
  return opts.length ? opts : [{ label: '', ft: 15 }];
}

function _coneOption(p) {
  const opts = _coneOptions(p);
  return opts[_coneChoice % opts.length];
}

/** Draws the cone from the selected token -- its outline, the squares it hits (shaded) or only edges (dashed) -- and
 * rings everyone it catches (cone-area.js), the same way the line tool does. */
function _renderCone() {
  const layer = document.getElementById('bmapTokens');
  const sel = _selected();
  if (!layer || !_coneOn || !sel) return;
  const { ft } = _coneOption(sel.p);
  let cellsEl = layer.querySelector('.bmap-line-cells');
  if (!cellsEl) {
    cellsEl = document.createElement('div');
    cellsEl.className = 'bmap-line-cells';
    layer.prepend(cellsEl);
  }
  cellsEl.innerHTML = lineCellsHtml(_session.board, coneSquares(sel.pos, sel.size, _aimAngle, ft, 0, null, _session.board.grid));
  let shape = layer.querySelector('.bmap-cone-shape');
  if (!shape) {
    shape = document.createElement('div');
    shape.className = 'bmap-cone-shape';
    shape.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
    layer.prepend(shape);
  }
  shape.innerHTML = coneOutlineSvg(_session.board, sel.pos, sel.size, _aimAngle, ft);
  const caught = coneHits(_session, sel.id, _aimAngle, ft);
  const hits = new Set(caught.ids), edges = new Set(caught.edgeIds);
  layer.querySelectorAll('.bmap-token[data-id]').forEach((el) => {
    el.classList.toggle('line-hit', hits.has(el.dataset.id));
    el.classList.toggle('line-edge', edges.has(el.dataset.id));
  });
}

/** Draws the line strip from the selected token and rings everyone it touches (see line-area.js). */
function _renderLine() {
  const layer = document.getElementById('bmapTokens');
  const sel = _selected();
  if (!layer || !_lineOn || !sel) return;
  const { ft } = _lineOption(sel.p);
  const g = lineGeometry(sel.pos, sel.size, _aimAngle, ft);
  let strip = layer.querySelector('.bmap-line');
  if (!strip) {
    strip = document.createElement('div');
    strip.className = 'bmap-line guide';
    layer.prepend(strip); // under the tokens, so the hit rings (not an orange wash) show who's in it
  }
  strip.setAttribute('style', lineGuideStyle(_session.board, g, _aimAngle));
  // The 5ft beam's own outline, so it's plain how much of each square it covers.
  let shape = layer.querySelector('.bmap-line-shape');
  if (!shape) {
    shape = document.createElement('div');
    shape.className = 'bmap-line-shape';
    shape.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
    layer.prepend(shape);
  }
  shape.innerHTML = lineOutlineSvg(_session.board, g, _aimAngle);
  // The squares it covers -- hit (shaded) or only its edge (dashed), line-area.js's lineCells.
  let cellsEl = layer.querySelector('.bmap-line-cells');
  if (!cellsEl) {
    cellsEl = document.createElement('div');
    cellsEl.className = 'bmap-line-cells';
    layer.prepend(cellsEl);
  }
  cellsEl.innerHTML = lineCellsHtml(_session.board, lineCells(sel.pos, sel.size, _aimAngle, ft, 0, null, _session.board.grid));
  const caught = lineHits(_session, sel.id, _aimAngle, ft);
  const hits = new Set(caught.ids), edges = new Set(caught.edgeIds);
  layer.querySelectorAll('.bmap-token[data-id]').forEach((el) => {
    el.classList.toggle('line-hit', hits.has(el.dataset.id));
    el.classList.toggle('line-edge', edges.has(el.dataset.id));
  });
}

/** Pointer on the map while the line or cone tool is on: aim it at the pointer (drag to sweep it round). */
function _aimTool(e) {
  const sel = _selected();
  const stage = document.getElementById('bmapStage');
  if (!sel || !stage) return;
  const origin = lineAimOrigin(sel.pos, sel.size);
  _aimAngle = angleToPointer(stage, _session.board, origin, e.clientX, e.clientY);
  _renderLine();
  _renderCone();
}

/** "20ft up" / "15ft underground" / "the ground". */
function _altText(z) {
  return z > 0 ? `${z}ft up` : z < 0 ? `${-z}ft underground` : 'the ground';
}

/** ▼ / altitude / ▲ for a creature that can leave the ground level -- fly, hover (5ft), or burrow (below 0). */
function _altitudeControlsHtml(sel) {
  const [low, high] = altitudeLimits(sel.p);
  const z = _stagedAlt ?? (sel.pos.z || 0);
  if (low === 0 && high === 0 && z === 0) return '';
  const label = z > 0 ? `↑${z}ft` : z < 0 ? `↓${-z}ft` : 'ground';
  const canDown = low === null || z > low;
  const canUp = high === null || z < high;
  const downTitle = z <= 0 ? 'Burrow 5ft deeper' : 'Descend 5ft';
  const upTitle = z < 0 ? 'Dig 5ft up' : high === 5 ? 'Hover up (5ft at most)' : 'Climb 5ft';
  return `<button type="button" data-act="down" title="${downTitle}"${canDown ? '' : ' disabled'}>▼</button><span class="tb-label">${label}</span>`
    + `<button type="button" data-act="up" title="${upTitle}"${canUp ? '' : ' disabled'}>▲</button><span class="tb-sep"></span>`;
}

/** The rotate / climb / cone bar for the selected token, in the strip above the map (it used to float next to the token,
 * which covered the middle of the board). The strip keeps its height when nothing is selected, so the map doesn't jump. */
function _renderToolbar() {
  const slot = document.getElementById('bmapToolbarSlot');
  if (!slot) return;
  slot.innerHTML = '';
  const sel = _selected();
  if (!sel) return;

  const bar = document.createElement('div');
  bar.id = 'bmapToolbar';
  bar.className = 'bmap-toolbar';
  const name = visibleToViewer(sel.p, 'name') ? sel.p.name : '???';
  bar.innerHTML = `
    <span class="tb-name">${name}</span>
    <button type="button" data-act="left" title="Turn left 45° (Q)">⟲</button>
    <button type="button" data-act="right" title="Turn right 45° (E)">⟳</button>
    <span class="tb-sep"></span>
    ${_altitudeControlsHtml(sel)}
    <button type="button" data-act="cone" class="${_coneOn ? 'on' : ''}" title="Show a cone you can aim at any angle">◔ Cone</button>
    <button type="button" data-act="line" class="${_lineOn ? 'on' : ''}" title="Show a 5ft-wide line you can aim at any angle">━ Line</button>
    ${_lineOn ? (() => { const o = _lineOption(sel.p); return `<button type="button" data-act="line-len" title="Switch line move">${o.ft}ft${o.label ? ` · ${o.label}` : ''}</button>`; })() : ''}
    ${_coneOn ? (() => { const o = _coneOption(sel.p); return `<button type="button" data-act="cone-len" title="Switch cone move">${o.ft}ft${o.label ? ` · ${o.label}` : ''}</button>`; })() : ''}
    <button type="button" data-act="close" title="Deselect (Esc)">✕</button>`;
  bar.addEventListener('click', (e) => {
    e.stopPropagation();
    const act = e.target.closest('button')?.dataset.act;
    if (act === 'left') _rotate(-45);
    else if (act === 'right') _rotate(45);
    else if (act === 'up') _stepAltitude(5);
    else if (act === 'down') _stepAltitude(-5);
    else if (act === 'cone' || act === 'line') {
      // One aiming tool at a time; it starts out pointing the way the token faces.
      const turnOn = act === 'cone' ? !_coneOn : !_lineOn;
      _coneOn = act === 'cone' && turnOn;
      _lineOn = act === 'line' && turnOn;
      if (turnOn) { _aimAngle = sel.pos.facing || 0; _stagedDestination = null; _stagedAlt = null; }
      _render();
    }
    else if (act === 'line-len') { _lineChoice++; _render(); }
    else if (act === 'cone-len') { _coneChoice++; _render(); }
    else if (act === 'close') { _selectedTokenId = null; _stagedDestination = null; _stagedAlt = null; _render(); }
  });
  slot.appendChild(bar);
}
