// The players' adventure map (the DM console's Adventure module, routes_combat.py's start_adventure) -- its own map,
// apart from the battle map (the user's call, 2026-10-21): just the surroundings, filling the screen, for walking round
// on. No turns, no movement limit, no cone / line or turning: tap your trainer or one of your Pokémon (gold ring), then
// tap where it goes and it walks there (the server turns it the way it went). Tap it again, or ✕, to let it go.
//
// The same board as the battle map (grid, background, the DM's objects, the tokens -- battle-map-grid.js and
// battle-map-view.js draw them) and the same zoom (map-zoom.js: − / + / Fit, pinch, Ctrl + wheel). The server still
// says no to a blocked square or a token that doesn't fit, and while the DM has moving paused (session.adventure.canMove).
//
// showAdventureMap(container, session, trainerName) puts it in `container`; updateAdventureMap(session) on every live
// push (no-op once the page is gone).
import { CombatAPI } from '../api.js';
import { patchPortraitMedia } from './sprite-media.js';
import { visibleToViewer } from './combat-visibility.js';
import { gridCellsHtml, gridTemplateStyle, cellRect, footprintForSize, mapObjectsHtml } from './battle-map-grid.js';
import { showCombatAlert } from './combat-alert.js';
import { injectBattleMapStyles, spriteTransform, unwrapAngle } from './battle-map-view.js';
import { attachMapZoom, zoomControlsHtml, injectMapZoomStyles } from './map-zoom.js';

function _injectStyles() {
  if (document.getElementById('adventure-map-styles')) return;
  injectBattleMapStyles();
  injectMapZoomStyles();
  const style = document.createElement('style');
  style.id = 'adventure-map-styles';
  style.textContent = `
    /* pinned to its box (combat-wip.js's .wip-adventure), so the map inside can never make it bigger */
    .amap { position: absolute; inset: 0; display: flex; }
    .amap .amap-viewport { flex: 1 1 auto; min-height: 0; padding: 6px; border-radius: 0; background: none; }
    .amap .bmap-stage { border-radius: 8px; }
    /* the zoom buttons float in the bottom-right corner, over the map */
    .amap-zoom { position: absolute; right: 10px; bottom: 10px; z-index: 5; padding: 4px; border-radius: 999px;
      background: rgba(14,16,32,0.82); box-shadow: 0 4px 14px rgba(0,0,0,0.5); }
    .amap-zoom .mz-level { display: none; }
    /* the token being moved: its name and a ✕, floating in the bottom-left corner (the zoom buttons have the right) */
    .amap-picked { position: absolute; left: 10px; bottom: 10px; z-index: 6; max-width: calc(100% - 150px); box-sizing: border-box;
      display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem 0.45rem 0.4rem 0.9rem; border-radius: 999px;
      background: rgba(14,16,32,0.9); border: 1px solid rgba(255,215,0,0.55); box-shadow: 0 4px 14px rgba(0,0,0,0.5);
      color: #e8ecff; font-size: 0.85rem; }
    .amap-picked[hidden] { display: none; }
    .amap-picked b { color: #ffd76a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .amap-picked span { white-space: nowrap; color: #b9c0e0; font-size: 0.78rem; }
    .amap-picked button { flex: 0 0 auto; border: none; border-radius: 50%; width: 1.9rem; height: 1.9rem; cursor: pointer;
      background: rgba(255,255,255,0.12); color: #e8ecff; font-size: 0.9rem; font-weight: 800; }
  `;
  document.head.appendChild(style);
}

let _root = null;
let _zoom = null;
let _session = null;
let _ownerName = null;
let _pickedId = null;
let _pending = null;               // { id, col, row } -- a move sent, drawn there until the server answers
const _spriteAngles = new Map();   // participantId -> the sprite's last drawn angle, unwrapped (turns go the short way)

export function showAdventureMap(container, session, trainerName) {
  _injectStyles();
  _session = session;
  _ownerName = trainerName;
  _pickedId = null;
  _pending = null;
  _spriteAngles.clear();
  container.innerHTML = `
    <div class="amap">
      <div class="amap-viewport" id="amapViewport">
        <div class="bmap-stage" id="amapStage">
          <div class="bmap-grid" id="amapGrid"></div>
          <div class="bmap-objects" id="amapObjects"></div>
          <div class="bmap-tokens" id="amapTokens"></div>
        </div>
      </div>
      <div class="amap-zoom" id="amapZoom">${zoomControlsHtml()}</div>
      <div class="amap-picked" id="amapPicked" hidden></div>
    </div>`;
  _root = container.firstElementChild;
  _zoom = attachMapZoom({
    viewport: _root.querySelector('#amapViewport'),
    stage: _root.querySelector('#amapStage'),
    getGrid: () => _session?.board?.grid,
    controls: _root.querySelector('#amapZoom'),
  });
  // a tap on the ground: the picked token walks there
  _root.querySelector('#amapGrid').addEventListener('click', (e) => {
    const cell = e.target.closest('[data-cell]');
    if (!cell || !_pickedId || _pending) return;
    const [col, row] = cell.dataset.cell.split(',').map(Number);
    _move(_pickedId, col, row);
  });
  _root.querySelector('#amapTokens').addEventListener('click', (e) => {
    const el = e.target.closest('.bmap-token.my-turn');
    if (!el) return;
    _pickedId = _pickedId === el.dataset.id ? null : el.dataset.id;
    _render();
  });
  _root.querySelector('#amapPicked').addEventListener('click', (e) => {
    if (e.target.closest('[data-act="drop"]')) { _pickedId = null; _render(); }
  });
  _render();
  _zoom.reset(); // opens on the whole map
}

/** Every live push: the map follows it (nothing once the page is gone). */
export function updateAdventureMap(session) {
  _session = session;
  if (_root?.isConnected) _render();
}

/** Whether the viewer may walk `id` now: their own, and the DM hasn't paused moving. */
function _canMove(id) {
  const p = _session?.participants?.[id];
  return !!p && !!_ownerName && p.owner === _ownerName && _session.adventure?.canMove !== false;
}

function _move(id, col, row) {
  const at = _session.board.tokens[id];
  if (!at || (at.col === col && at.row === row)) return;
  _pending = { id, col, row };
  _render();
  CombatAPI.moveToken(id, col, row)
    .then((res) => { if (res?.data?.participants && (!_session?.version || (res.data.version || 0) >= _session.version)) _session = res.data; })
    .catch(err => showCombatAlert(err.message, { title: 'Adventure' }))
    .finally(() => { _pending = null; if (_root?.isConnected) _render(); });
}

function _render() {
  if (!_root || !_session?.board) return;
  if (_pickedId && !_canMove(_pickedId)) _pickedId = null; // left, or the DM paused moving
  const board = _session.board;
  const stage = _root.querySelector('#amapStage');
  const { cols, rows } = board.grid;
  stage.style.aspectRatio = `${cols} / ${rows}`;
  const url = board.backgroundImage;
  stage.classList.toggle('has-bg', !!url);
  stage.style.backgroundImage = url ? `url(${url})` : '';
  _zoom?.refit(); // the DM may have changed the map's size

  // the grid only when it changed (it's every square of the map)
  const grid = _root.querySelector('#amapGrid');
  const gridHtml = gridCellsHtml(board, 'bmap-cell');
  const gridStyle = gridTemplateStyle(board);
  if (grid._html !== gridHtml || grid._style !== gridStyle) {
    grid.setAttribute('style', gridStyle);
    grid.innerHTML = gridHtml;
    grid._html = gridHtml; grid._style = gridStyle;
  }
  const objects = _root.querySelector('#amapObjects');
  const objectsHtml = mapObjectsHtml(board);
  if (objects._html !== objectsHtml) { objects.innerHTML = objectsHtml; objects._html = objectsHtml; }

  _renderTokens();

  const picked = _root.querySelector('#amapPicked');
  const p = _pickedId && _session.participants[_pickedId];
  picked.hidden = !p;
  if (p) {
    picked.innerHTML = `<b>${_esc(visibleToViewer(p, 'name') ? p.name : '???')}</b><span>tap where to go</span>`
      + '<button type="button" data-act="drop" title="Let go" aria-label="Let go">✕</button>';
  }
}

/** The tokens, kept from one draw to the next (so a step slides across instead of jumping). */
function _renderTokens() {
  const layer = _root.querySelector('#amapTokens');
  const tokens = _session.board.tokens || {};
  const seen = new Set();
  Object.entries(tokens).forEach(([id, pos]) => {
    const p = _session.participants[id];
    if (!p) return;
    seen.add(id);
    let el = layer.querySelector(`.bmap-token[data-id="${CSS.escape(id)}"]`);
    if (!el) {
      el = document.createElement('div');
      el.dataset.id = id;
      el.innerHTML = '<div class="bmap-token-portrait"><div class="bmap-sprite"></div></div>';
      layer.appendChild(el);
    }
    const mine = !!_ownerName && p.owner === _ownerName;
    const classes = ['bmap-token', p.side];
    if (mine) classes.push('mine');
    if (_canMove(id)) classes.push('my-turn'); // tappable
    if (id === _pickedId) classes.push('selected');
    el.className = classes.join(' ');
    const name = visibleToViewer(p, 'name') ? p.name : '???';
    el.title = name;
    const at = _pending?.id === id ? _pending : pos;
    Object.assign(el.style, cellRect(_session.board, at.col, at.row, footprintForSize(p.size)));
    const sprite = el.querySelector('.bmap-sprite');
    if (sprite._image !== p.image) { patchPortraitMedia(sprite, p.image, name, { small: true }); sprite._image = p.image; }
    const previous = _spriteAngles.has(id) ? _spriteAngles.get(id) : (pos.facing || 0);
    const angle = unwrapAngle(previous, pos.facing || 0);
    _spriteAngles.set(id, angle);
    sprite.style.transform = spriteTransform(angle);
  });
  layer.querySelectorAll('.bmap-token[data-id]').forEach((el) => { if (!seen.has(el.dataset.id)) el.remove(); });
}

function _esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
