// Renders a self-uploaded sprite URL (MP4) or a static image as the
// right kind of tag, and prefetches it correctly. The one place this
// decision is made -- every page that shows an owned Pokemon's sprite
// (trainer-card, pokemon-card, combat, my-pokemon, evolution, new-pokemon)
// goes through here instead of repeating <img>/<video> markup and error
// handling per call site.

// Allows a trailing cache-busting query string (e.g. `?t=<mtime>`, see
// upstream.local_sprite_url) after the extension -- plain `\.mp4$` would stop
// matching the moment one gets appended.
const IS_VIDEO = /\.mp4(\?|$)/i;

// The Pi's small copies of the animated sprites (pi-server sprite_previews.py: 360 px instead of 1080, a fraction of
// the size) -- for a page that only ever shows sprites small and many at once (the DM console, the display's preview),
// or, with { small: true }, for one small spot (the trainer card's slots, lists, battle tokens and picker portraits).
// The big views (Pokemon card, capture, evolution) keep the original. The Pi sends the original until a copy is made,
// so a sprite always shows.
let _previews = false;
const SPRITE_FILE = /^\/gifs\/([^?#]+\.mp4)(\?[^#]*)?$/i;

/** Turns the small sprite copies on for this page. */
export function useSpritePreviews(on = true) {
  _previews = !!on;
}

/** The URL to load for a sprite / picture: the small copy of an animated sprite when asked for or this page uses them. */
export function spriteSrc(url, small = false) {
  if (!(small || _previews) || !url) return url;
  const m = SPRITE_FILE.exec(String(url));
  return m ? `/sprite-previews/${m[1]}${m[2] || ''}` : url;
}

// Android WebView (the kiosk screens' Fully Kiosk Browser) draws its own grey play-button picture on a <video> that has
// no `poster` until it starts playing -- the play/pause icon seen on the display. Every sprite video gets this fully
// transparent 1x1 poster instead, and once its first frame is in, the poster is dropped (below) so that frame shows even
// if the video were held still.
export const BLANK_POSTER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
document.addEventListener('loadeddata', (e) => {
  const v = e.target;
  if (v instanceof HTMLVideoElement && v.getAttribute('poster') === BLANK_POSTER) v.removeAttribute('poster');
}, true);

/** For the screens nobody touches (the display, the board screen): a looping sprite that gets paused or stalls -- the
 * WebView does that now and then -- is started again, so none sits still. (Not for pages that pause videos on purpose:
 * the DM console, the display's preview.) */
export function keepVideosPlaying() {
  const kick = (e) => {
    const v = e.target;
    if (!(v instanceof HTMLVideoElement) || !v.loop || !v.autoplay || document.hidden || !v.isConnected) return;
    if (v.paused) v.play().catch(() => {});
  };
  ['pause', 'canplay', 'stalled', 'suspend'].forEach(type => document.addEventListener(type, kick, true));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) document.querySelectorAll('video[autoplay][loop]').forEach(v => { if (v.paused) v.play().catch(() => {}); });
  });
}

// A <video> can't just have its src swapped to a static fallback image and
// render correctly -- the element itself has to be replaced with a real
// <img>. Defined once here (not repeated per inline onerror string) and
// shared by both tag types for one consistent fallback path.
function spriteFallback(el) {
  const img = document.createElement('img');
  img.src = 'assets/Pokeball.png';
  if (el.className) img.className = el.className;
  if (el.alt) img.alt = el.alt;
  el.replaceWith(img);
}
window.__spriteFallback = spriteFallback;

/**
 * Builds the HTML for a sprite: <video> for a .mp4 URL, <img> otherwise (or
 * when url is falsy -- same Pokeball-fallback behavior as before).
 */
export function spriteMediaHtml(url, altText, className = '', id = '', { small = false } = {}) {
  const classAttr = className ? ` class="${className}"` : '';
  const idAttr = id ? ` id="${id}"` : '';
  url = spriteSrc(url, small);
  if (url && IS_VIDEO.test(url)) {
    // pointer-events:none is what actually stops Chrome's hover-triggered
    // play/pause + picture-in-picture overlay from appearing -- neither
    // disablepictureinpicture nor disableremoteplayback alone prevents the
    // hover chrome itself, only their respective icons once it's already
    // showing, and this is meant to be a purely decorative sprite with zero
    // interactivity. Callers that need clicks on the sprite area (e.g.
    // pokemon-card.js's evolution-confirm trigger) listen on the *container*
    // instead -- the click still lands there since a pointer-events:none
    // child is skipped during hit-testing.
    return `<video src="${url}"${idAttr}${classAttr} style="pointer-events:none" poster="${BLANK_POSTER}" autoplay muted loop playsinline disablepictureinpicture disableremoteplayback onerror="window.__spriteFallback(this)"></video>`;
  }
  // No src attribute at all when url is empty -- src="" triggers a real
  // (failing) request in some browsers before any real src is set, which
  // caused a brief Pokeball flash before this was fixed elsewhere; a
  // missing src attribute never fires a request or an error.
  const srcAttr = url ? ` src="${url}"` : '';
  return `<img${srcAttr} alt="${altText || ''}"${idAttr}${classAttr} decoding="async" onerror="window.__spriteFallback(this)">`;
}

/**
 * For updating an *existing* element after the page has already rendered
 * (evolution.js, new-pokemon.js), where a plain `el.src = url` can't switch
 * an <img> into a <video> on the fly. Rebuilds the tag fresh and replaces
 * the old element, preserving its id.
 */
export function renderSpriteInto(elementId, url, altText, className = '') {
  const el = document.getElementById(elementId);
  if (!el) return;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = spriteMediaHtml(url, altText, className);
  const newEl = wrapper.firstElementChild;
  newEl.id = elementId;
  el.replaceWith(newEl);
}

/**
 * Patches a portrait container's sprite in place, but ONLY rebuilds the
 * <video>/<img> when the image URL actually differs from what's already
 * showing there (tracked via a data-image attribute) -- an unchanged URL
 * leaves the existing element, and any loop it's mid-playing, untouched.
 * Unlike renderSpriteInto() above (always rebuilds, for a page's own
 * one-off elements addressed by id), this is for a *container* re-rendered
 * on every live push (see display.js/battle-map.js's participant strips),
 * where avoiding an unnecessary rebuild -- and the video-restart flicker
 * that comes with it -- is the entire point.
 */
export function patchPortraitMedia(containerEl, url, altText, { small = false } = {}) {
  if (!containerEl) return;
  const safeUrl = url || '';
  if (containerEl.dataset.image === safeUrl) return;
  containerEl.dataset.image = safeUrl;
  containerEl.innerHTML = spriteMediaHtml(url, altText, '', '', { small });
}

/**
 * Warms the browser's cache for a sprite URL without displaying it.
 * new Image() doesn't work for video -- fetch() does, for either type, but
 * .mp4 needs it specifically since Image() would just fail on it.
 */
export function prefetchSprite(url, { small = false } = {}) {
  url = spriteSrc(url, small);
  if (!url) return Promise.resolve();
  if (IS_VIDEO.test(url)) {
    return fetch(url).catch(() => {});
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = resolve;
    img.onerror = resolve;
    img.src = url;
  });
}
