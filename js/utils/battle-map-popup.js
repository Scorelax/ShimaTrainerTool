// Interactive in-app battle map popup -- lets a player VIEW the same board
// the table kiosk screen (battle-map.html) shows, and MOVE their own token:
// click it, click a destination cell to STAGE a move (distance/movement-type
// preview, no server call yet), then Confirm to actually commit it -- a
// deliberate extra step so a misclick can't burn real movement (the user's
// own call: hard-enforce the movement budget below, but only after an
// explicit confirm). Turn-gating is enforced both ways -- a token is only
// selectable when it's both yours (`owner` field, set by combat-wip.js's
// "Join as yourself" flow) AND the current turn holder, and the server
// re-checks the same thing (move-token in routes_combat.py, same authority
// model as use-move) so neither check can be bypassed from the client.
//
// Movement budget: each participant carries `speeds` ([{type, ft}, ...],
// see combat.js's buildTrainerCombatant/buildPokemonCombatant) and a
// server-tracked `movementUsed` (feet moved so far this turn, reset when
// their next turn starts -- see routes_combat.py's _advance_turn). A
// participant with no `speeds` at all (a DM's freeform enemy, or anyone
// added before this existed) gets no budget UI and no enforcement --
// move-token skips the check entirely for them.
//
// Mirrors move-popup.js's overlay pattern (create the DOM once, reuse
// across calls) and target-picker.js's self-contained-styles approach
// (injects its own copy of the shared .combat-popup-* base rules rather
// than assuming another module already did).
import { CombatAPI } from '../api.js';
import { patchPortraitMedia } from './sprite-media.js';
import { visibleToViewer } from './combat-visibility.js';
import { gridCellsHtml, gridTemplateStyle, cellRect, footprintForSize } from './battle-map-grid.js';
import { showCombatAlert } from './combat-alert.js';

function _injectStyles() {
  if (document.getElementById('battle-map-popup-styles')) return;
  const style = document.createElement('style');
  style.id = 'battle-map-popup-styles';
  style.textContent = `
    .combat-popup-overlay { position: fixed; top:0; left:0; width:100%; height:100%; background: rgba(0,0,0,0.75); z-index: 1000; justify-content: center; align-items: center; backdrop-filter: blur(3px); }
    .combat-popup-content { background: #1e1e34; border: 1px solid rgba(255,255,255,0.12); border-radius: 16px; max-width: 640px; width: 94%; max-height: 90vh; overflow-y: auto; position: relative; box-shadow: 0 10px 40px rgba(0,0,0,0.6); color: #e0e0e0; }
    .combat-move-popup-header { padding: 1.1rem 1.2rem; border-radius: 16px 16px 0 0; border-bottom: 2px solid rgba(0,0,0,0.3); display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; position: relative; background: rgba(255,255,255,0.05); }
    .combat-move-popup-header h2 { margin: 0; font-size: 1.4rem; font-weight: 900; text-transform: uppercase; }
    .combat-popup-close { position: absolute; top: 0.8rem; right: 0.8rem; background: rgba(0,0,0,0.3); border: none; border-radius: 50%; width: 32px; height: 32px; font-size: 1.2rem; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; color: inherit; }
    .combat-move-popup-body { padding: 1rem 1.2rem; }

    .bmap-hint { font-size: 0.8rem; color: #a0a0c0; margin-bottom: 0.6rem; }

    .bmap-move-panel {
      display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem;
      background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12);
      border-radius: 8px; padding: 0.55rem 0.7rem; margin-bottom: 0.6rem; font-size: 0.85rem;
    }
    .bmap-move-chip { background: rgba(255,255,255,0.08); border-radius: 6px; padding: 0.2rem 0.55rem; }
    .bmap-move-chip.depleted { color: #e77373; }
    .bmap-stage-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; width: 100%; }
    .bmap-stage-row select {
      background: #1e1e2e; border: 1px solid rgba(255,255,255,0.2); color: #e0e0e0;
      border-radius: 6px; padding: 0.25rem 0.4rem; font-size: 0.85rem;
    }
    .bmap-stage-row button {
      border: none; border-radius: 6px; padding: 0.3rem 0.75rem; font-size: 0.85rem; font-weight: 600; cursor: pointer;
    }
    .bmap-confirm-btn { background: linear-gradient(135deg, #27ae60, #1e8449); color: #fff; }
    .bmap-confirm-btn:disabled { background: #444; color: #888; cursor: not-allowed; }
    .bmap-cancel-btn { background: rgba(255,255,255,0.12); color: #e0e0e0; }
    .bmap-stage-warning { color: #e77373; }

    /* aspect-ratio is set inline per-render from the board's own cols/rows
       (see _applyStageAspect) -- gridTemplateStyle only ever divides this
       box into equal fractions, it doesn't know or care about shape, so
       nothing here keeps cells square for a grid size other than whatever
       one aspect-ratio value happened to be hardcoded. */
    .bmap-stage { position: relative; width: 100%; background: #0a0a12; border-radius: 8px; overflow: hidden; background-size: cover; background-position: center; }
    .bmap-grid { position: absolute; inset: 0; display: grid; gap: 2px; background: #1a1a24; }
    /* Translucent instead of solid once a background image is set, so the
       artwork actually shows through the grid instead of being fully
       covered by it -- unmarked cells only; .marked/.taken stay opaque
       since those are meaningful state, not "empty ground". */
    .bmap-stage.has-bg .bmap-grid { background: rgba(26,26,36,0.35); }
    .bmap-cell { background: #20202e; cursor: pointer; }
    .bmap-stage.has-bg .bmap-cell { background: rgba(32,32,46,0.35); }
    .bmap-cell:hover { outline: 1px solid rgba(255,215,0,0.5); outline-offset: -1px; }
    .bmap-cell.marked {
      background: #4a3520; display: flex; align-items: center; justify-content: center;
      font-size: 0.6rem; color: #e0c080; overflow: hidden; text-align: center; padding: 1px; box-sizing: border-box;
    }
    /* The staged-but-not-yet-confirmed destination cell. */
    .bmap-cell.staged { outline: 2px solid #FFD700; outline-offset: -2px; }
    /* pointer-events:none on the container (not just the default-none
       individual tokens below) -- without it, this full-stage layer sits on
       top of .bmap-grid in paint order and, having no click handler of its
       own, silently swallows every click meant for a cell underneath except
       where it exactly overlaps a .my-turn token (which opts back in below).
       That's what made clicking a destination cell to move to do nothing --
       selecting your own token still worked since that click landed on the
       token itself. See .placement-tokens for the same fix already applied
       to the placement screen's equivalent layer. */
    .bmap-tokens { position: absolute; inset: 0; pointer-events: none; }
    .bmap-token {
      position: absolute; display: flex; flex-direction: column; align-items: center; justify-content: center;
      padding: 3px; box-sizing: border-box; pointer-events: none;
    }
    /* .my-turn is the only clickable state -- .mine alone (yours, but not
       your turn right now) is shown (gold portrait outline) but not
       interactive. */
    .bmap-token.my-turn { pointer-events: auto; cursor: pointer; }
    .bmap-token.my-turn:not(.selected) { outline: 2px solid rgba(255,215,0,0.55); outline-offset: -2px; border-radius: 4px; }
    .bmap-token.selected { outline: 2px solid #FFD700; outline-offset: -2px; border-radius: 4px; box-shadow: 0 0 10px rgba(255,215,0,0.6); }
    /* Portrait fills the whole cell now that there's no name label to leave
       room for -- side/ownership, previously conveyed by the name's text
       color, moves to an outline on the portrait itself instead. */
    .bmap-token-portrait { width: 100%; height: 100%; }
    .bmap-token-portrait img, .bmap-token-portrait video { width: 100%; height: 100%; object-fit: contain; filter: drop-shadow(0 0 4px rgba(0,0,0,0.9)); }
    .bmap-token.player .bmap-token-portrait { outline: 2px solid rgba(93,173,226,0.55); outline-offset: -2px; border-radius: 4px; }
    .bmap-token.enemy .bmap-token-portrait { outline: 2px solid rgba(231,115,115,0.55); outline-offset: -2px; border-radius: 4px; }
    .bmap-token.mine .bmap-token-portrait { outline: 2px solid rgba(255,215,0,0.55); outline-offset: -2px; border-radius: 4px; }
  `;
  document.head.appendChild(style);
}

let _overlay = null;
let _session = null;
let _ownerName = null;
let _selectedTokenId = null;
// A clicked-but-not-yet-confirmed destination for _selectedTokenId, plus
// whichever movement type the Confirm button will actually move with (see
// _eligibleTypes -- auto-picked when only one type can reach it, otherwise
// left null until the player picks one from the chooser).
let _stagedDestination = null;
let _stagedMoveType = null;

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
      </div>
      <div class="combat-move-popup-body">
        <div class="bmap-hint" id="bmapHint"></div>
        <div class="bmap-move-panel" id="bmapMovePanel" hidden></div>
        <div class="bmap-stage" id="bmapStage">
          <div class="bmap-grid" id="bmapGrid"></div>
          <div class="bmap-tokens" id="bmapTokens"></div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(_overlay);

  document.getElementById('battleMapClose').addEventListener('click', _close);
  _overlay.addEventListener('click', (e) => { if (e.target === _overlay) _close(); });
}

function _close() {
  if (_overlay) _overlay.style.display = 'none';
  _selectedTokenId = null;
  _stagedDestination = null;
  _stagedMoveType = null;
}

/** Opens the popup for `trainerName` (whoever's using this device) showing
 * `session`'s board. Re-openable/re-callable freely -- each call just
 * re-renders against the given session. */
export function showBattleMap(session, trainerName) {
  _session = session;
  _ownerName = trainerName;
  _selectedTokenId = null;
  _stagedDestination = null;
  _stagedMoveType = null;
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
function _distanceFt(fromCol, fromRow, toCol, toRow) {
  return Math.max(Math.abs(toCol - fromCol), Math.abs(toRow - fromRow)) * 5;
}

function _render() {
  if (!_session || !_session.board) return;

  const hint = document.getElementById('bmapHint');
  if (hint) {
    if (_stagedDestination) {
      hint.textContent = 'Confirm the move below, or click a different cell.';
    } else if (_selectedTokenId) {
      hint.textContent = 'Click a cell to move there.';
    } else {
      const activeId = _activeParticipantId(_session);
      const activeIsMine = !!activeId && _session.participants[activeId]?.owner === _ownerName;
      hint.textContent = activeIsMine
        ? 'Click your active token (gold outline) to select it, then click a cell to move it.'
        : "It's not your turn -- you can only move a token on your own turn.";
    }
  }
  _renderMovePanel();
  _renderStage();
  _renderGrid();
  _renderTokens();
}

/** Shows the active mover's remaining-movement chips (whenever it's your
 * own turn, whether or not you've selected the token yet -- the user's own
 * ask: know how far you can move before you've even clicked anything) and,
 * once a destination is staged, the distance/type-chooser/confirm row.
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
    const distance = current ? _distanceFt(current.col, current.row, _stagedDestination.col, _stagedDestination.row) : 0;
    const eligible = p.speeds.filter(s => _remainingFt(p, s.type) >= distance);
    if (!_stagedMoveType && eligible.length === 1) _stagedMoveType = eligible[0].type;
    if (_stagedMoveType && !eligible.some(s => s.type === _stagedMoveType)) _stagedMoveType = null;

    if (!eligible.length) {
      stageRow = `
        <div class="bmap-stage-row">
          <span class="bmap-stage-warning">Not enough movement left to reach that cell (needs ${distance}ft).</span>
          <button type="button" class="bmap-cancel-btn" id="bmapCancelStage">Cancel</button>
        </div>`;
    } else {
      const typeChooser = eligible.length > 1
        ? `<select id="bmapMoveTypeSelect">
            <option value="">Move via…</option>
            ${eligible.map(s => `<option value="${s.type}"${s.type === _stagedMoveType ? ' selected' : ''}>${s.type}</option>`).join('')}
          </select>`
        : `<span>via ${eligible[0].type}</span>`;
      stageRow = `
        <div class="bmap-stage-row">
          <span>Move ${distance}ft</span>
          ${typeChooser}
          <button type="button" class="bmap-confirm-btn" id="bmapConfirmMove"${_stagedMoveType ? '' : ' disabled'}>Confirm Move</button>
          <button type="button" class="bmap-cancel-btn" id="bmapCancelStage">Cancel</button>
        </div>`;
    }
  }

  panel.innerHTML = `${chips}${stageRow}`;

  document.getElementById('bmapMoveTypeSelect')?.addEventListener('change', (e) => {
    _stagedMoveType = e.target.value || null;
    _render();
  });
  document.getElementById('bmapCancelStage')?.addEventListener('click', () => {
    _stagedDestination = null;
    _stagedMoveType = null;
    _render();
  });
  document.getElementById('bmapConfirmMove')?.addEventListener('click', () => {
    const movingId = _selectedTokenId;
    const { col, row } = _stagedDestination;
    const moveType = _stagedMoveType;
    _selectedTokenId = null;
    _stagedDestination = null;
    _stagedMoveType = null;
    CombatAPI.moveToken(movingId, col, row, moveType).catch(err => showCombatAlert(err.message, { title: 'Error' }));
    _render();
  });
}

/** Keeps cells square for WHATEVER grid size is currently set (not just the
 * default) -- gridTemplateStyle divides the stage into equal fractions
 * regardless of shape, so the stage's own aspect-ratio has to be kept in
 * sync by hand here. Also applies/clears the background image + its
 * has-bg translucency hook on the cells (see the CSS). */
function _renderStage() {
  const stageEl = document.getElementById('bmapStage');
  if (!stageEl) return;
  const { cols, rows } = _session.board.grid;
  stageEl.style.aspectRatio = `${cols} / ${rows}`;
  const url = _session.board.backgroundImage;
  stageEl.classList.toggle('has-bg', !!url);
  stageEl.style.backgroundImage = url ? `url(${url})` : '';
}

function _renderGrid() {
  const gridEl = document.getElementById('bmapGrid');
  if (!gridEl) return;
  gridEl.setAttribute('style', gridTemplateStyle(_session.board));
  gridEl.innerHTML = gridCellsHtml(_session.board, 'bmap-cell');

  gridEl.querySelectorAll('[data-cell]').forEach(cell => {
    const [col, row] = cell.dataset.cell.split(',').map(Number);
    if (_stagedDestination && col === _stagedDestination.col && row === _stagedDestination.row) {
      cell.classList.add('staged');
    }
    cell.addEventListener('click', () => {
      if (!_selectedTokenId) return; // nothing selected -- clicking empty ground does nothing
      // Re-clicking the same cell while it's already staged re-stages it
      // (clears a stale type pick) rather than doing nothing -- cheap to
      // just always reset both, no real cost to it.
      _stagedDestination = { col, row };
      _stagedMoveType = null;
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

    const el = document.createElement('div');
    el.className = classes.join(' ');
    el.dataset.id = id;
    const name = visibleToViewer(p, 'name') ? p.name : '???';
    el.title = name;
    Object.assign(el.style, cellRect(_session.board, pos.col, pos.row, footprintForSize(p.size)));
    el.innerHTML = `<div class="bmap-token-portrait"></div>`;
    patchPortraitMedia(el.querySelector('.bmap-token-portrait'), p.image, name);

    if (isMyTurn) {
      el.addEventListener('click', () => {
        _selectedTokenId = _selectedTokenId === id ? null : id;
        _stagedDestination = null;
        _stagedMoveType = null;
        _render();
      });
    }

    layer.appendChild(el);
  });
}
