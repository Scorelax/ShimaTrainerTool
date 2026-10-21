// The items' pictures fetched ahead, in the background (the user's call, 2026-10-21: item pictures should show
// "basically instantly" all through the app). Once the app has the item list -- the player's game data on starting a
// journey, the DM console's a few seconds after it opens -- every item's picture is asked for, a few at a time while
// nothing else is going on. The Pi sends each as a small WebP copy and lets the browser keep it for good (its URL
// changes when the picture does: pi-server/app/main.py's item_image), so from then on every item picture -- the
// inventory, a held item, the DM's Items popups, an item lying on the battle map -- comes straight out of the
// browser's cache. Nothing is kept here: the browser's cache does the keeping.
const AT_ONCE = 3;
const _asked = new Set();

/** Every picture among `items` ([{ image }]) not asked for yet, fetched in the background. */
export function warmItemPictures(items) {
  const urls = [...new Set((Array.isArray(items) ? items : []).map(i => i?.image).filter(u => typeof u === 'string' && u && !_asked.has(u)))];
  if (!urls.length) return;
  urls.forEach(u => _asked.add(u));
  const idle = window.requestIdleCallback ? fn => window.requestIdleCallback(fn, { timeout: 3000 }) : fn => setTimeout(fn, 300);
  const next = () => {
    const url = urls.shift();
    if (!url) return;
    const img = new Image();
    img.onload = img.onerror = () => idle(next);
    img.src = url;
  };
  idle(() => { for (let i = 0; i < AT_ONCE; i++) next(); });
}
