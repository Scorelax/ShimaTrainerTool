// Where the region map's trees, rocks and peaks stand (object-places.js) worked out away from the page, so the map keeps
// answering meanwhile (the user's call, 2026-10-25; region-map.js starts it once the map's shown).
// In: { rgba, W, H, kind, metres } -> out: { done: placeObjects' result } or { error }.
import { placeObjects } from './object-places.js';

self.onmessage = (e) => {
  try {
    const placed = placeObjects(e.data);
    self.postMessage({ done: placed }, [placed.data.buffer]);
  } catch (err) {
    self.postMessage({ error: err.message || String(err) });
  }
};
