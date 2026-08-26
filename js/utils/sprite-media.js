// Renders a self-uploaded sprite URL (MP4 or GIF) or a static image as the
// right kind of tag, and prefetches it correctly. The one place this
// decision is made -- every page that shows an owned Pokemon's sprite
// (trainer-card, pokemon-card, combat, my-pokemon, evolution, new-pokemon)
// goes through here instead of repeating <img>/<video> markup and error
// handling per call site.

const IS_VIDEO = /\.mp4$/i;

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
export function spriteMediaHtml(url, altText, className = '', id = '') {
  const classAttr = className ? ` class="${className}"` : '';
  const idAttr = id ? ` id="${id}"` : '';
  if (url && IS_VIDEO.test(url)) {
    return `<video src="${url}"${idAttr}${classAttr} autoplay muted loop playsinline onerror="window.__spriteFallback(this)"></video>`;
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
 * Warms the browser's cache for a sprite URL without displaying it.
 * new Image() doesn't work for video -- fetch() does, for either type, but
 * .mp4 needs it specifically since Image() would just fail on it.
 */
export function prefetchSprite(url) {
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
