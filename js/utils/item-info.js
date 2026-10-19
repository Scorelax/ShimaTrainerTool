// The inventory popups' item card (trainer info, Pokemon card, the battle -- each has its own copy of the popup): the
// item's picture as an icon beside its name, with how many and its category on a line under it, and a tighter layout
// for the description / effect so the card has room for it (the user's call, 2026-10-19). The pictures are the item
// list's `image` (pi-server/app/routes_gamedata.py: the item pictures folder, files named after the item); an item
// without one -- or the trainer's own custom items -- shows the bag, faded.

const PLACEHOLDER = 'assets/Bag.png';

let _items = { raw: null, byName: new Map() }; // the item list in sessionStorage, by lowercase name

function itemListEntry(name) {
  const raw = sessionStorage.getItem('items');
  if (raw !== _items.raw) {
    let list = [];
    try { list = JSON.parse(raw || '[]'); } catch (e) { /* none */ }
    _items = { raw, byName: new Map(list.map(i => [String(i.name).toLowerCase(), i])) };
  }
  return _items.byName.get(String(name || '').toLowerCase()) || null;
}

/** The card's header, in place of its plain name heading: the icon, then the name (`nameId`, the id the page already
 * uses for it) and the line under it. */
export function itemHeadHtml(nameId) {
  return `<div class="item-head">
    <span class="item-icon placeholder"><img src="${PLACEHOLDER}" alt="" draggable="false"></span>
    <div class="item-head-text"><h3 class="item-name" id="${nameId}">Select an item</h3><div class="item-meta"></div></div>
  </div>`;
}

/** Shows `item` ({name, quantity or qty, isCustom / custom / fullData.isCustom}) in the header around `nameEl`. No item:
 * `title` alone (nothing picked yet, or "Add an item"). */
export function showItemHead(nameEl, item, title = 'Select an item') {
  if (!nameEl) return;
  const head = nameEl.closest('.item-head');
  const icon = head?.querySelector('.item-icon');
  const meta = head?.querySelector('.item-meta');
  if (!item) {
    nameEl.textContent = title;
    if (meta) meta.textContent = '';
    setIcon(icon, '');
    return;
  }
  const custom = !!(item.isCustom || item.custom || item.fullData?.isCustom);
  const listed = custom ? null : itemListEntry(item.name);
  const count = item.quantity ?? item.qty;
  nameEl.textContent = item.name;
  if (meta) meta.textContent = [count != null ? `×${count}` : '', custom ? 'Your own item' : listed?.category || ''].filter(Boolean).join(' · ');
  setIcon(icon, listed?.image || '');
}

function setIcon(icon, url) {
  if (!icon) return;
  const img = icon.querySelector('img');
  icon.classList.toggle('placeholder', !url);
  img.onerror = () => { icon.classList.add('placeholder'); img.onerror = null; img.src = PLACEHOLDER; };
  img.src = url || PLACEHOLDER;
}

// The card's look -- scoped to the item card / the inventory popup (the pages' own rules are less specific, and other
// popups reuse class names like .detail-section).
const CSS = `
  .inventory-popup-content .inventory-main { padding: clamp(0.7rem, 1.6vw, 1.1rem); }
  .inventory-popup-content .item-info-card { padding: clamp(0.8rem, 1.6vw, 1.15rem); margin-bottom: clamp(0.6rem, 1.2vh, 0.85rem); }
  .item-info-card .item-head {
    display: flex; align-items: center; gap: clamp(0.6rem, 1.4vw, 0.9rem);
    /* room on the right for the popup's close button */
    padding: 0 clamp(2.2rem, 4.5vw, 2.8rem) clamp(0.55rem, 1vh, 0.75rem) 0;
    margin-bottom: clamp(0.6rem, 1.2vh, 0.85rem); border-bottom: 2px solid rgba(255, 222, 0, 0.3);
  }
  .item-info-card .item-icon {
    flex: none; width: clamp(52px, 8vw, 72px); height: clamp(52px, 8vw, 72px); border-radius: 12px; overflow: hidden;
    display: flex; align-items: center; justify-content: center;
    background: radial-gradient(circle at 50% 40%, rgba(255, 255, 255, 0.14), rgba(0, 0, 0, 0.25));
    border: 1px solid rgba(255, 222, 0, 0.35); box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.4);
  }
  .item-info-card .item-icon img { width: 88%; height: 88%; object-fit: contain; }
  .item-info-card .item-icon.placeholder img { width: 58%; height: 58%; opacity: 0.35; }
  .item-info-card .item-head-text { min-width: 0; }
  .item-info-card .item-name {
    font-size: clamp(1.05rem, 2.3vw, 1.4rem); line-height: 1.15; margin: 0; padding: 0; border: none;
    letter-spacing: 0.5px; overflow-wrap: anywhere;
  }
  .item-info-card .item-meta { margin-top: 0.25rem; font-size: clamp(0.72rem, 1.4vw, 0.82rem); font-weight: 700; color: #a8a8a8; letter-spacing: 0.3px; }
  .item-info-card .item-meta:empty { display: none; }
  /* each section as tall as its text (they used to split the card in half, leaving gaps under short texts) */
  .item-info-card .item-details { flex: none; gap: clamp(0.55rem, 1.2vh, 0.8rem); }
  .item-info-card .detail-section { flex: none; }
  .item-info-card .detail-section h4 { font-size: clamp(0.66rem, 1.3vw, 0.76rem); letter-spacing: 1px; margin: 0 0 0.3rem; color: rgba(255, 222, 0, 0.85); }
  .item-info-card .detail-section p { font-size: clamp(0.82rem, 1.6vw, 0.95rem); line-height: 1.5; }
  .item-info-card .detail-divider { height: 1px; }
  /* Add / Use / Edit / Remove on one row (two on a narrow screen) */
  .inventory-popup-content .inventory-actions { flex-direction: row; flex-wrap: wrap; justify-content: center; }
  .inventory-popup-content .inventory-actions-row { display: contents; }
  @media (max-width: 640px) {
    .inventory-popup-content .inventory-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem; }
    .inventory-popup-content .inventory-actions .action-btn { width: 100%; padding-left: 0.4rem; padding-right: 0.4rem; }
  }
  @media (max-width: 480px) {
    .item-info-card .item-icon { width: 40px; height: 40px; border-radius: 9px; }
    .item-info-card .item-head { padding-right: 1.9rem; gap: 0.5rem; }
  }
`;

if (typeof document !== 'undefined' && !document.getElementById('itemInfoStyles')) {
  const style = document.createElement('style');
  style.id = 'itemInfoStyles';
  style.textContent = CSS;
  document.head.appendChild(style);
}
