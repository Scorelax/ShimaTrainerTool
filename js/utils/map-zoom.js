// Fit-to-screen and zoom for the battle map popups (battle-map-popup.js and the map pickers -- line / cone / wall, terrain
// area, send-out tile, reposition). The popup fills the screen with its buttons above the map; the map starts fitted to
// the space left and zooms in and out on its own -- the page itself never zooms (the playtest's call, 2026-10-16: a big
// map was hard to use, and its buttons ended up off screen).
//
// The stage keeps every token, cell and shape in percentages of its own size, so zooming is just giving it a bigger
// width and height inside a scrolling viewport. Zoom with the − / + buttons, Ctrl + mouse wheel or a trackpad pinch
// (which the browser would otherwise use on the page), or two fingers on a touch screen -- which also pan. One finger
// scrolls the zoomed map, except on a map where a drag draws or aims (touch-action: none there) -- two fingers pan it.

const MIN_ZOOM = 1;
const MAX_ZOOM = 6;

export function injectMapZoomStyles() {
  if (document.getElementById('map-zoom-styles')) return;
  const style = document.createElement('style');
  style.id = 'map-zoom-styles';
  style.textContent = `
    /* the popup card: the whole screen, a column -- title, text and buttons on top, the map filling the rest */
    .mz-fullcard {
      width: calc(100vw - 16px) !important; max-width: none !important;
      height: calc(100vh - 16px) !important; height: calc(100dvh - 16px) !important; max-height: none !important;
      overflow-x: hidden !important; overflow-y: auto !important; display: flex !important; flex-direction: column; box-sizing: border-box;
    }
    /* the map takes whatever height is left (never under 160px -- on a tiny screen the card scrolls instead) */
    .mz-fullcard > *, .mz-fill > * { flex-shrink: 0; }
    .mz-fullcard > .mz-fill { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
    .mz-fullcard > .mz-viewport, .mz-fill > .mz-viewport { flex: 1 1 0; }
    .mz-viewport {
      position: relative; display: flex; overflow: auto; min-height: 160px; padding: 4px; box-sizing: border-box;
      border-radius: 14px; background: rgba(0,0,0,0.22); touch-action: pan-x pan-y; overscroll-behavior: contain;
    }
    /* margin:auto centres a map smaller than the viewport and still lets a bigger one scroll to every edge */
    /* never eased (a reduced-motion setting would otherwise ease every property, size included, by a hair -- enough for the
       zoom to measure the old size) */
    .mz-viewport > .mz-stage { margin: auto; flex: 0 0 auto; min-width: 0; min-height: 0; max-width: none; max-height: none; transition-property: none; }
    .mz-controls { display: inline-flex; align-items: center; gap: 0.25rem; }
    .mz-controls .mz-btn {
      border: 1px solid rgba(140,170,255,0.4); background: rgba(140,170,255,0.14); color: #e8ecff; cursor: pointer;
      border-radius: 999px; min-width: 2.1rem; height: 2.1rem; padding: 0 0.6rem; font-size: 1rem; font-weight: 800; font-family: inherit;
    }
    .mz-controls .mz-btn:hover:not(:disabled) { background: rgba(140,170,255,0.28); }
    .mz-controls .mz-btn:disabled { opacity: 0.35; cursor: default; }
    .mz-controls .mz-fit { font-size: 0.78rem; }
    .mz-controls .mz-level { min-width: 3.2em; text-align: center; font-size: 0.78rem; font-weight: 700; color: #b9c8ff; }
    /* a long explanation above the map: two lines, tap for the rest */
    .mz-clamp { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; cursor: pointer; }
    .mz-clamp.open { display: block; }
  `;
  document.head.appendChild(style);
}

/** − / zoom level / + / Fit, for wherever the popup keeps its buttons (attachMapZoom wires them). */
export function zoomControlsHtml() {
  return `<span class="mz-controls">
      <button type="button" class="mz-btn" data-mz="out" title="Zoom out (Ctrl + mouse wheel, or pinch)">−</button>
      <span class="mz-level">100%</span>
      <button type="button" class="mz-btn" data-mz="in" title="Zoom in (Ctrl + mouse wheel, or pinch)">+</button>
      <button type="button" class="mz-btn mz-fit" data-mz="fit" title="Show the whole map">Fit</button>
    </span>`;
}

/** Tap a long explanation to open it in full (and again to fold it back to two lines). */
export function clampText(el) {
  if (!el) return;
  el.classList.add('mz-clamp');
  el.title = 'Tap to read it all';
  el.addEventListener('click', () => el.classList.toggle('open'));
}

/**
 * Makes `stage` (a .bmap-stage-style element whose content is laid out in percentages) fit inside `viewport` and zoom.
 * `getGrid()` returns the board's { cols, rows } (read on every fit, so a map the DM resizes keeps square cells);
 * `controls` holds the zoomControlsHtml() buttons. Returns { refit, reset } -- refit after the popup is shown or its
 * board changes, reset to go back to the whole map.
 */
export function attachMapZoom({ viewport, stage, getGrid, controls }) {
  injectMapZoomStyles();
  viewport.classList.add('mz-viewport');
  stage.classList.add('mz-stage');
  let zoom = 1;
  let pendingAnchor = null;
  let anchorFrame = 0;

  // The map point (as a fraction of the map) under `focus` right now.
  const pointAt = (focus) => {
    const r = stage.getBoundingClientRect();
    return r.width && r.height ? { fx: (focus.x - r.left) / r.width, fy: (focus.y - r.top) / r.height } : null;
  };

  /** Sizes the map for the current zoom. With `focus` (a screen point), the map point under it stays there -- or, given
   * `fixedAnchor`, that map point is brought under it (a pinch: the spot first between the fingers follows them). */
  const fit = (focus, fixedAnchor = null) => {
    const grid = getGrid();
    if (!grid?.cols || !grid?.rows) return;
    const cs = getComputedStyle(viewport);
    const w = viewport.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const h = viewport.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (w <= 0 || h <= 0) return; // not on screen yet
    // Where the focus point sits on the map, so it stays under the finger / cursor as the map grows or shrinks.
    let anchor = null;
    if (focus) {
      // Several steps before the next frame (fast clicks, a wheel burst) keep the point measured first: the map in between
      // isn't laid out yet, so measuring again would be off.
      anchor = fixedAnchor || (anchorFrame ? pendingAnchor.anchor : pointAt(focus));
    }
    const cell = Math.min(w / grid.cols, h / grid.rows) * zoom;
    // Whole pixels, rounded down: a fitted map a fraction too big would bring up a scrollbar, shrink the space, and refit.
    stage.style.width = `${Math.floor(cell * grid.cols)}px`;
    stage.style.height = `${Math.floor(cell * grid.rows)}px`;
    if (anchor) {
      // Scrolled once the new size is laid out (a frame later -- measured straight away it can still be the old one).
      pendingAnchor = { anchor, focus };
      if (!anchorFrame) anchorFrame = requestAnimationFrame(() => {
        anchorFrame = 0;
        const { anchor: a, focus: f } = pendingAnchor;
        const r = stage.getBoundingClientRect();
        viewport.scrollLeft += r.left + a.fx * r.width - f.x;
        viewport.scrollTop += r.top + a.fy * r.height - f.y;
      });
    }
    const level = controls?.querySelector('.mz-level');
    if (level) level.textContent = `${Math.round(zoom * 100)}%`;
    const out = controls?.querySelector('[data-mz="out"]');
    const inn = controls?.querySelector('[data-mz="in"]');
    if (out) out.disabled = zoom <= MIN_ZOOM;
    if (inn) inn.disabled = zoom >= MAX_ZOOM;
  };

  const centre = () => {
    const r = viewport.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  const setZoom = (next, focus = centre(), fixedAnchor = null) => {
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    fit(focus, fixedAnchor);
  };

  controls?.addEventListener('click', (e) => {
    const act = e.target.closest('[data-mz]')?.dataset.mz;
    if (act === 'in') setZoom(zoom * 1.4);
    else if (act === 'out') setZoom(zoom / 1.4);
    else if (act === 'fit') setZoom(1);
  });

  // Ctrl + wheel, and a trackpad pinch (sent as Ctrl + wheel): the map, not the page. A plain wheel scrolls it as usual.
  viewport.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setZoom(zoom * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025)), { x: e.clientX, y: e.clientY });
  }, { passive: false });

  // Two fingers: pinch to zoom around them, move them to pan. Taken over from the browser (no page zoom).
  let pinch = null;
  const touchInfo = (t) => {
    const [a, b] = [t[0], t[1]];
    return { dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
  };
  viewport.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 2) return;
    if (e.cancelable) e.preventDefault();
    const info = touchInfo(e.touches);
    pinch = { startDist: info.dist || 1, startZoom: zoom, anchor: pointAt(info) };
  }, { passive: false });
  viewport.addEventListener('touchmove', (e) => {
    if (!pinch || e.touches.length !== 2) return;
    if (e.cancelable) e.preventDefault();
    const info = touchInfo(e.touches);
    setZoom(pinch.startZoom * (info.dist / pinch.startDist), { x: info.x, y: info.y }, pinch.anchor);
  }, { passive: false });
  const endPinch = (e) => { if (e.touches.length < 2) pinch = null; };
  viewport.addEventListener('touchend', endPinch);
  viewport.addEventListener('touchcancel', endPinch);
  // iOS Safari's own pinch gesture would zoom the page.
  viewport.addEventListener('gesturestart', (e) => e.preventDefault());
  viewport.addEventListener('gesturechange', (e) => e.preventDefault());

  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => fit()).observe(viewport);
  else window.addEventListener('resize', () => fit());

  return {
    refit: () => fit(),
    reset: () => { zoom = 1; fit(); viewport.scrollLeft = 0; viewport.scrollTop = 0; },
  };
}
