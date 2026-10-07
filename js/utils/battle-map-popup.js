// Interactive in-app battle map popup -- lets a player VIEW the same board the table kiosk screen
// (battle-map.html) shows, and MOVE / TURN their own token. Click your token (it's the only clickable one, and
// only on your turn) and a small floating bar appears next to it: rotate left/right in 45-degree steps (or Q / E),
// and a cone/line preview so you can see what a facing would hit. Click a cell to STAGE a move (a distance preview,
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
// Mirrors move-popup.js's overlay pattern (create the DOM once, reuse across calls) and target-picker.js's
// self-contained-styles approach (injects its own copy of the shared .combat-popup-* base rules rather than
// assuming another module already did).
import { CombatAPI } from '../api.js';
import { patchPortraitMedia } from './sprite-media.js';
import { visibleToViewer } from './combat-visibility.js';
import { gridCellsHtml, gridTemplateStyle, cellRect, footprintForSize } from './battle-map-grid.js';
import { showCombatAlert } from './combat-alert.js';
import { waitForOpenWindow } from './reaction-window.js';
import { moveCostFt, canClimb } from './move-effects.js';
import { injectBattleMapStyles, zoneKindsByCell, legendHtml, tokenCenter, coneCells, spriteTransform, unwrapAngle, activeTerrainSummary } from './battle-map-view.js';

const CONE_LENGTHS_FT = [0, 15, 30, 60]; // 0 = preview off

function _injectStyles() {
  if (document.getElementById('battle-map-popup-styles')) return;
  injectBattleMapStyles();
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
  `;
  document.head.appendChild(style);
}

let _overlay = null;
let _session = null;
let _ownerName = null;
let _selectedTokenId = null;
// A clicked-but-not-yet-confirmed destination for _selectedTokenId.
let _stagedDestination = null;
// Index into CONE_LENGTHS_FT -- the cone preview length for the selected token (0 = off). Kept across selections.
let _coneIdx = 0;
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
    <div class="combat-popup-content">
      <div class="combat-move-popup-header">
        <button id="battleMapClose" class="combat-popup-close">×</button>
        <h2>🗺️ Battle Map</h2>
        <span class="bmap-round" id="bmapRound"></span>
      </div>
      <div class="combat-move-popup-body">
        <div class="bmap-hint" id="bmapHint"></div>
        <div class="bmap-move-panel" id="bmapMovePanel" hidden></div>
        <div class="bmap-stage" id="bmapStage">
          <div class="bmap-grid" id="bmapGrid"></div>
          <div class="bmap-tokens" id="bmapTokens"></div>
        </div>
        <div class="bmap-legend" id="bmapLegend"></div>
      </div>
    </div>
  `;
  document.body.appendChild(_overlay);

  document.getElementById('battleMapClose').addEventListener('click', _close);
  document.getElementById('bmapLegend').addEventListener('click', (e) => {
    const x = e.target.closest('.bmap-legend-x');
    if (x) CombatAPI.removeFieldZone(x.dataset.key, x.dataset.id).catch(err => showCombatAlert(err.message, { title: 'Error' }));
  });
  _overlay.addEventListener('click', (e) => { if (e.target === _overlay) _close(); });
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
 * re-renders against the given session. */
export function showBattleMap(session, trainerName) {
  _session = session;
  _ownerName = trainerName;
  _selectedTokenId = null;
  _stagedDestination = null; _stagedAlt = null;
  _ensureDom();
  _render();
  _overlay.style.display = 'flex';
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
function _activeParticipantId(session) {
  if (session.reactingParticipantId) return session.reactingParticipantId;
  if (session.turnOrder && session.turnOrder.length) return session.turnOrder[session.turnIndex];
  return null;
}

/** Feet of `type` movement `p` has left this turn -- speeds' own max minus
 * the single shared movementUsed counter (see routes_combat.py's
 * _move_token comment: switching between multiple speeds still draws from
 * one pool, same as 5e's own rule for a creature with more than one
 * speed), floored at 0. */
function _remainingFt(p, type) {
  const s = (p.speeds || []).find(x => x.type === type);
  if (!s) return 0;
  return Math.max(0, s.ft - (p.movementUsed || 0));
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
  const next = Math.max(0, (_stagedAlt ?? (sel.pos.z || 0)) + delta);
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
  CombatAPI.rotateToken(id, next).catch(err => {
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
    if (_stagedDestination) {
      hint.textContent = 'Confirm the move below, or click a different cell.';
    } else if (_selectedTokenId) {
      hint.textContent = 'Click a cell to move there · ⟲ ⟳ (or Q / E) to turn · the cone shows what a facing would hit.';
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
  _renderGrid();
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

  const activeId = _activeParticipantId(_session);
  const p = activeId && _session.participants[activeId]?.owner === _ownerName
    ? _session.participants[activeId] : null;
  if (!p || !(p.speeds || []).length) { panel.hidden = true; return; }
  panel.hidden = false;

  const chips = p.speeds.map(s => {
    const remaining = _remainingFt(p, s.type);
    return `<span class="bmap-move-chip${remaining <= 0 ? ' depleted' : ''}">${s.type}: ${remaining}/${s.ft}ft</span>`;
  }).join('');

  let stageRow = '';
  if (_stagedDestination && _selectedTokenId === activeId) {
    const current = _session.board.tokens[activeId];
    const z0 = current?.z || 0;
    const z1 = _stagedAlt ?? z0;
    const distance = current ? _distanceFt(current.col, current.row, _stagedDestination.col, _stagedDestination.row, p, z0, z1) : 0;
    const bestRemaining = Math.max(...p.speeds.map(s => _remainingFt(p, s.type)));
    const canMove = distance <= bestRemaining;

    stageRow = canMove ? `
        <div class="bmap-stage-row">
          <span>Move ${distance}ft${z1 !== z0 ? ` · altitude ${z0} → ${z1}ft` : ''}</span>
          <button type="button" class="bmap-confirm-btn" id="bmapConfirmMove">Confirm Move</button>
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
  document.getElementById('bmapConfirmMove')?.addEventListener('click', () => {
    const movingId = _selectedTokenId;
    const { col, row } = _stagedDestination;
    const altitude = _stagedAlt;
    _selectedTokenId = null;
    _stagedDestination = null; _stagedAlt = null;
    _stagedAlt = null;
    CombatAPI.moveToken(movingId, col, row, altitude === null ? undefined : altitude)
      // Walking away from a hostile creature can open a reaction window (Pursuit) that nobody else is waiting on -- run its clock.
      .then(res => { if (res?.data?.pendingReaction) waitForOpenWindow(); })
      .catch(err => showCombatAlert(err.message, { title: 'Error' }));
    _render();
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
  const bestRemaining = sel && (sel.p.speeds || []).length ? Math.max(...sel.p.speeds.map(s => _remainingFt(sel.p, s.type))) : null;
  const coneFt = CONE_LENGTHS_FT[_coneIdx];
  let cone = null;
  if (sel && coneFt) {
    const c = tokenCenter(sel.pos, sel.size);
    cone = coneCells(_session.board, c.x, c.y, sel.pos.facing || 0, coneFt / 5);
  }

  gridEl.setAttribute('style', gridTemplateStyle(_session.board));
  gridEl.innerHTML = gridCellsHtml(_session.board, 'bmap-cell', (col, row) => {
    const key = `${col},${row}`;
    const classes = [];
    const zone = zones.get(key);
    if (zone) classes.push(`zone-${zone[0]}`);
    const z0 = sel?.pos.z || 0;
    if (sel && bestRemaining !== null && _distanceFt(sel.pos.col, sel.pos.row, col, row, sel.p, z0, _stagedAlt ?? z0) <= bestRemaining) classes.push('reach');
    if (cone?.has(key)) classes.push('cone');
    if (_stagedDestination && col === _stagedDestination.col && row === _stagedDestination.row) classes.push('staged');
    return classes.join(' ');
  });

  gridEl.querySelectorAll('[data-cell]').forEach(cell => {
    const [col, row] = cell.dataset.cell.split(',').map(Number);
    cell.addEventListener('click', () => {
      if (!_selectedTokenId) return; // nothing selected -- clicking empty ground does nothing
      const own = _selected();
      // Standing still isn't a move (movement comes in 5ft steps) -- unless an altitude change is staged with it.
      if (own && own.pos.col === col && own.pos.row === row && (_stagedAlt === null || _stagedAlt === (own.pos.z || 0))) return;
      _stagedDestination = { col, row };
      _render();
    });
  });
}

function _renderTokens() {
  const layer = document.getElementById('bmapTokens');
  if (!layer) return;
  const tokens = _session.board.tokens;
  const activeId = _activeParticipantId(_session);

  layer.innerHTML = '';
  Object.entries(tokens).forEach(([id, pos]) => {
    const p = _session.participants[id];
    if (!p) return;

    const isMine = !!_ownerName && p.owner === _ownerName;
    const isMyTurn = isMine && id === activeId;
    const classes = ['bmap-token', p.side];
    if (isMine) classes.push('mine');
    if (isMyTurn) classes.push('my-turn');
    if (id === _selectedTokenId) classes.push('selected');
    if ((pos.z || 0) > 0) classes.push('airborne');

    const el = document.createElement('div');
    el.className = classes.join(' ');
    el.dataset.id = id;
    const name = visibleToViewer(p, 'name') ? p.name : '???';
    el.title = name;
    Object.assign(el.style, cellRect(_session.board, pos.col, pos.row, footprintForSize(p.size)));
    el.innerHTML = `<div class="bmap-token-portrait"><div class="bmap-sprite"></div></div>${(pos.z || 0) > 0 ? `<span class="bmap-alt">↑${pos.z}ft</span>` : ''}`;
    const sprite = el.querySelector('.bmap-sprite');
    patchPortraitMedia(sprite, p.image, name);
    // The tokens are rebuilt every render, so start at the last drawn angle and let the transition carry it to the new one.
    const previous = _spriteAngles.has(id) ? _spriteAngles.get(id) : (pos.facing || 0);
    const angle = unwrapAngle(previous, pos.facing || 0);
    _spriteAngles.set(id, angle);
    sprite.style.transform = spriteTransform(previous);
    if (angle !== previous) requestAnimationFrame(() => requestAnimationFrame(() => { sprite.style.transform = spriteTransform(angle); }));

    if (isMyTurn) {
      el.addEventListener('click', () => {
        _selectedTokenId = _selectedTokenId === id ? null : id;
        _stagedDestination = null; _stagedAlt = null;
        _render();
      });
    }

    layer.appendChild(el);
  });
}

/** The floating rotate / cone bar next to the selected token -- below it, or above when the token sits low on the map. */
function _renderToolbar() {
  const stage = document.getElementById('bmapStage');
  if (!stage) return;
  stage.querySelector('#bmapToolbar')?.remove();
  const sel = _selected();
  if (!sel) return;

  const { cols, rows } = _session.board.grid;
  const topRow = sel.pos.row - sel.size + 1;
  const above = (sel.pos.row + 1) / rows > 0.62;
  const bar = document.createElement('div');
  bar.id = 'bmapToolbar';
  bar.className = `bmap-toolbar${above ? ' above' : ''}`;
  bar.style.left = `${Math.min(88, Math.max(12, ((sel.pos.col + sel.size / 2) / cols) * 100))}%`;
  bar.style.top = `${above ? (topRow / rows) * 100 : ((sel.pos.row + 1) / rows) * 100}%`;
  const coneFt = CONE_LENGTHS_FT[_coneIdx];
  bar.innerHTML = `
    <button type="button" data-act="left" title="Turn left 45° (Q)">⟲</button>
    <button type="button" data-act="right" title="Turn right 45° (E)">⟳</button>
    <span class="tb-sep"></span>
    ${canClimb(sel.p) ? `<button type="button" data-act="down" title="Descend 5ft">▼</button><span class="tb-label">${_stagedAlt ?? (sel.pos.z || 0)}ft</span><button type="button" data-act="up" title="Climb 5ft">▲</button><span class="tb-sep"></span>` : ''}
    <button type="button" data-act="cone" class="${coneFt ? 'on' : ''}" title="Cone preview from this facing">◔ ${coneFt ? coneFt + 'ft' : 'Cone'}</button>
    <button type="button" data-act="close" title="Deselect (Esc)">✕</button>`;
  bar.addEventListener('click', (e) => {
    e.stopPropagation();
    const act = e.target.closest('button')?.dataset.act;
    if (act === 'left') _rotate(-45);
    else if (act === 'right') _rotate(45);
    else if (act === 'up') _stepAltitude(5);
    else if (act === 'down') _stepAltitude(-5);
    else if (act === 'cone') { _coneIdx = (_coneIdx + 1) % CONE_LENGTHS_FT.length; _render(); }
    else if (act === 'close') { _selectedTokenId = null; _stagedDestination = null; _stagedAlt = null; _render(); }
  });
  stage.appendChild(bar);
}
