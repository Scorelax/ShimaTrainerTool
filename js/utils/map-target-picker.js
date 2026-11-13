// "Pick on the map" (the user's call, 2026-11-12): instead of the grid of target cards, the battle map itself -- tap a
// creature to target it. The same map, tokens, zoom and tap rules as the line / cone pickers (line-area-picker.js):
// creatures that can't be targeted are greyed out (tapping one says why), creatures stacked on one square take turns
// with each tap. Nothing happens until Confirm, so a mis-tap on a small token costs nothing. Used by the single-target
// picker (target-picker.js) and, for a move with no area to place, the "who's caught in it" one (multi-target-picker.js).
import { visibleToViewer } from './combat-visibility.js';
import { gridCellsHtml, gridTemplateStyle, mapObjectsHtml } from './battle-map-grid.js';
import { attachMapZoom, zoomControlsHtml, clampText } from './map-zoom.js';
import { injectPickerStyles, buildPickerTokens, creatureAt } from './line-area-picker.js';

function _injectStyles() {
  injectPickerStyles();
  if (document.getElementById('map-target-picker-styles')) return;
  const style = document.createElement('style');
  style.id = 'map-target-picker-styles';
  style.textContent = `
    .mtgt-stage { cursor: pointer; }
    /* magenta, so it can't be mixed up with the caster's own gold ring or the blue / red sides */
    .mtgt-stage .bmap-token.picked .bmap-token-portrait { box-shadow: 0 0 0 3px #ff4fd8, 0 0 18px 5px rgba(255,79,216,0.85); }
    .mtgt-picked { font-size: 0.9rem; font-weight: 700; color: #ff8be6; min-height: 1.3em; }
    .mtgt-picked .why { color: #ff8a80; }
    .mtgt-picked .cover { color: #f0b232; font-weight: 600; }
    .mtgt-card .lap-title { color: #ffe07a; }
    .mtgt-card { border-color: rgba(255,215,0,0.4); }
    .lap-actions .mtgt-confirm { margin-left: auto; background: linear-gradient(135deg, #ffd84d, #e0a800); color: #1a1202; box-shadow: 0 0 16px rgba(255,200,40,0.4); }
    .lap-actions .mtgt-confirm:disabled { opacity: 0.4; cursor: not-allowed; box-shadow: none; }
  `;
  document.head.appendChild(style);
}

/**
 * @param {object} session      the shared combat session (board + participants)
 * @param {string} casterId     who's using the move (ringed as "mine", never pickable)
 * @param {string} title        e.g. "Thunderbolt" or "Attack 2 of 3"
 * @param {string[]} pickableIds who can be picked; everyone else on the map is greyed out
 * @param {Map} [whyNot]        id -> why it can't be picked ("Out of range (45ft away)")
 * @param {Map} [partialCover]  id -> "Partial cover (Rock)", said when it's picked
 * @param {boolean} [multiple]  tap to tick and untick several (the "who's caught in it" picker); otherwise one
 * @param {string[]} [selected] already ticked (multiple)
 * @returns {Promise<string|string[]|null>} the picked id (or ids, with `multiple`), or null when closed without one
 */
export function pickTargetOnMap({ session, casterId, title = 'Choose a Target', pickableIds, whyNot = null, partialCover = null, multiple = false, selected = [] }) {
  _injectStyles();
  return new Promise((resolve) => {
    const board = session?.board;
    if (!board?.tokens) { resolve(null); return; }
    const { cols, rows } = board.grid;
    const pickable = new Set(pickableIds.filter(id => board.tokens[id]));
    const nameOf = id => (visibleToViewer(session.participants[id], 'name') ? session.participants[id].name : '???');
    const picked = new Set(multiple ? selected.filter(id => pickable.has(id)) : []);
    let last = null; // the creature tapped last (stacked creatures take turns from it)

    const overlay = document.createElement('div');
    overlay.className = 'lap-overlay';
    overlay.innerHTML = `
      <div class="lap-card mtgt-card">
        <h3 class="lap-title">${title}</h3>
        <div class="lap-sub">${multiple ? 'Tap every creature it hits (tap again to take one off)' : 'Tap the creature to target'}, then confirm. Greyed-out creatures can't be targeted -- tap one to see why. Two creatures on one square (a flyer over one on the ground): tap again for the other.</div>
        <div class="mtgt-picked"></div>
        <div class="lap-actions">
          ${zoomControlsHtml()}
          <button type="button" data-act="cancel">Back to the list</button>
          <button type="button" class="mtgt-confirm" data-act="confirm" disabled>Confirm</button>
        </div>
        <div class="lap-viewport">
          <div class="bmap-stage lap-stage mtgt-stage" style="aspect-ratio:${cols} / ${rows}">
            <div class="bmap-grid"></div>
            <div class="bmap-objects">${mapObjectsHtml(board)}</div>
            <div class="bmap-tokens"></div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.lap-card').classList.add('mz-fullcard');
    clampText(overlay.querySelector('.lap-sub'));
    attachMapZoom({ viewport: overlay.querySelector('.lap-viewport'), stage: overlay.querySelector('.lap-stage'), getGrid: () => board.grid, controls: overlay.querySelector('.lap-actions') }).refit();

    const stage = overlay.querySelector('.lap-stage');
    const grid = overlay.querySelector('.bmap-grid');
    if (board.backgroundImage) {
      stage.classList.add('has-bg');
      stage.style.backgroundImage = `url(${board.backgroundImage})`;
    }
    grid.setAttribute('style', gridTemplateStyle(board));
    grid.innerHTML = gridCellsHtml(board, 'bmap-cell');
    const tokenEls = buildPickerTokens(session, board, casterId, overlay.querySelector('.bmap-tokens'), pickable, whyNot);
    const pickedEl = overlay.querySelector('.mtgt-picked');
    const confirmBtn = overlay.querySelector('[data-act="confirm"]');
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    const refresh = (why = '') => {
      tokenEls.forEach((el, id) => el.classList.toggle('picked', picked.has(id)));
      const names = [...picked].map(id => `${esc(nameOf(id))}${partialCover?.has(id) ? ` <span class="cover">(${esc(partialCover.get(id))}: disadvantage)</span>` : ''}`);
      pickedEl.innerHTML = why ? `<span class="why">${esc(why)}</span>`
        : names.length ? `${multiple ? 'Picked' : 'Target'}: ${names.join(', ')}` : 'Nobody picked yet.';
      confirmBtn.disabled = !picked.size;
      confirmBtn.textContent = multiple ? `Confirm${picked.size ? ` (${picked.size})` : ''}` : picked.size ? `Target ${nameOf([...picked][0])}` : 'Confirm';
    };
    refresh();

    // A tap (not a scroll of the zoomed map): the creature under it
    stage.addEventListener('click', (e) => {
      const id = creatureAt(stage, session, Object.keys(board.tokens).filter(x => x !== casterId && session.participants[x]), e, last);
      last = id;
      if (!id) return;
      if (!pickable.has(id)) { refresh(`${nameOf(id)}: ${whyNot?.get(id) || "can't be targeted by this move"}`); return; }
      if (multiple) { if (picked.has(id)) picked.delete(id); else picked.add(id); }
      else { picked.clear(); picked.add(id); }
      refresh();
    });

    const done = (result) => { overlay.remove(); resolve(result); };
    overlay.addEventListener('click', (e) => {
      const act = e.target.closest('button')?.dataset.act;
      if (act === 'cancel') done(null);
      else if (act === 'confirm' && picked.size) done(multiple ? [...picked] : [...picked][0]);
    });
  });
}

/** Whether there's a map to pick on: the board has tokens for any of `ids`. */
export function canPickOnMap(session, ids) {
  const tokens = session?.board?.tokens;
  return !!tokens && ids.some(id => tokens[id]);
}

/** Who can be picked from a filterTargetable / markOutOfRange list (target-picker.js, multi-target-picker.js), and why
 * the others can't. */
export function mapPickOptions(list) {
  const whyNot = new Map();
  list?.outOfRange?.forEach((note, id) => whyNot.set(id, `out of range -- ${note}${list.reachFt ? ` (reach ${list.reachFt}ft)` : ''}`));
  list?.noSight?.forEach((note, id) => whyNot.set(id, `${note} -- no line of sight`));
  return { pickableIds: list.map(p => p.id).filter(id => !whyNot.has(id)), whyNot, partialCover: list?.partialCover || null };
}
