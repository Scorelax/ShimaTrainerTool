// A "file explorer" popup for picking things (the user's call, 2026-10-19): a search bar on top, the choices as a grid of
// cards with their pictures, one or several picked (multi), and optionally an "Add hidden" box. Used by the map editor's
// Add to the map sections (Pokemon, NPCs, objects, items), the Admin module's evolution criteria (an item, a move)...
import { patchPortraitMedia } from '../utils/sprite-media.js';
import { escapeHtml, openDmModal } from './dm-common.js';

const SHOWN_MAX = 300; // cards drawn at once -- the search narrows it down

/**
 * openPicker({ title, items: [{ key, label, sub, image, search }], multi, hiddenOption, confirmLabel, hint, emptyText,
 *   imageFallback, compact })
 * -> Promise<{ keys: [...], hidden: bool } | null> (null: closed without picking). `image` may be an animated sprite.
 * `compact`: no pictures at all -- a list of names (moves).
 */
export function openPicker({ title, items, multi = false, hiddenOption = false, confirmLabel = null, hint = '',
  emptyText = 'Nothing to pick from.', imageFallback = 'assets/Pokeball.png', compact = false, hiddenDefault = false }) {
  const picked = new Set();
  let hidden = hiddenDefault;
  return openDmModal({
    title,
    wide: true,
    html: `
      <div class="dm-picker${compact ? ' compact' : ''}">
        <div class="dm-picker-bar">
          <input class="dm-input" data-pk-search placeholder="Search…" autocomplete="off">
          ${hiddenOption ? `<label class="dm-check dm-picker-hidden" title="Put them on hidden -- only you see them until you show them"><input type="checkbox" data-pk-hidden ${hidden ? 'checked' : ''}><span>🙈 Add hidden</span></label>` : ''}
        </div>
        ${hint ? `<div class="dm-hint">${hint}</div>` : ''}
        <div class="dm-picker-grid" data-pk-grid></div>
        <div class="dm-picker-foot">
          <span class="dm-hint" data-pk-count></span>
          <span><button class="dm-btn" data-pk-cancel>Cancel</button>
          ${multi ? `<button class="dm-btn primary" data-pk-ok disabled>${escapeHtml(confirmLabel || 'Add')}</button>` : ''}</span>
        </div>
      </div>`,
    buttons: [],
    onOpen: (body, close) => {
      body.closest('.dm-modal').querySelector('.dm-modal-foot').remove(); // the picker has its own buttons
      const grid = body.querySelector('[data-pk-grid]');
      const search = body.querySelector('[data-pk-search]');
      const okBtn = body.querySelector('[data-pk-ok]');
      const count = body.querySelector('[data-pk-count]');
      const done = () => close({ keys: [...picked], hidden });
      const draw = () => {
        const q = search.value.trim().toLowerCase();
        const hits = items.filter(it => !q || `${it.label} ${it.sub || ''} ${it.search || ''}`.toLowerCase().includes(q));
        grid.innerHTML = hits.slice(0, SHOWN_MAX).map(it => `
          <button type="button" class="dm-picker-card${picked.has(it.key) ? ' picked' : ''}" data-pk="${escapeHtml(it.key)}" title="${escapeHtml(it.label)}">
            ${compact ? '' : `<span class="dm-picker-img" data-img="${escapeHtml(it.image || '')}"></span>`}
            <span class="dm-picker-name">${escapeHtml(it.label)}</span>
            ${it.sub ? `<small>${it.subHtml ? it.sub : escapeHtml(it.sub)}</small>` : ''}
            ${multi ? '<span class="dm-picker-tick">✓</span>' : ''}
          </button>`).join('')
          + (hits.length > SHOWN_MAX ? `<div class="dm-hint dm-picker-more">…and ${hits.length - SHOWN_MAX} more -- search to narrow it down.</div>` : '')
          + (hits.length ? '' : `<div class="dm-hint dm-picker-more">${items.length ? 'Nothing matches that.' : escapeHtml(emptyText)}</div>`);
        grid.querySelectorAll('[data-img]').forEach((el) => {
          if (el.dataset.img) patchPortraitMedia(el, el.dataset.img, '', { small: true });
          else el.innerHTML = `<img src="${imageFallback}" alt="" style="opacity:0.3">`;
        });
      };
      const refreshCount = () => {
        if (!multi) return;
        okBtn.disabled = !picked.size;
        okBtn.textContent = picked.size ? `${confirmLabel || 'Add'} (${picked.size})` : (confirmLabel || 'Add');
        count.textContent = picked.size ? `${picked.size} picked` : 'Click to pick -- as many as you like';
      };
      grid.addEventListener('click', (e) => {
        const card = e.target.closest('[data-pk]');
        if (!card) return;
        const key = card.dataset.pk;
        if (!multi) { picked.add(key); done(); return; }
        if (picked.has(key)) picked.delete(key); else picked.add(key);
        card.classList.toggle('picked', picked.has(key));
        refreshCount();
      });
      grid.addEventListener('dblclick', (e) => { if (multi && e.target.closest('[data-pk]') && picked.size) done(); });
      search.addEventListener('input', draw);
      search.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const first = grid.querySelector('[data-pk]');
        if (!multi && first) { picked.add(first.dataset.pk); done(); }
      });
      body.querySelector('[data-pk-hidden]')?.addEventListener('change', (e) => { hidden = e.target.checked; });
      body.querySelector('[data-pk-cancel]').addEventListener('click', () => close(null));
      okBtn?.addEventListener('click', done);
      draw();
      refreshCount();
      setTimeout(() => search.focus(), 30);
    },
  });
}
