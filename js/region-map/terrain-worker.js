// The 3D land built from a new painting (make-terrain.js) away from the page, so the DM console keeps answering for the
// few seconds it takes (js/dm/map-upload.js, the user's call, 2026-10-20).
// In: { rgba, W, H, options } -> out: { step } while it works, then { done: terrain } or { error }.
import { buildTerrain } from './make-terrain.js';

self.onmessage = async (e) => {
  const { rgba, W, H, options } = e.data;
  try {
    const t = await buildTerrain(rgba, W, H, { ...options, onStep: step => self.postMessage({ step }) });
    self.postMessage({ done: t }, [t.height.buffer, t.topo.buffer, t.shade.buffer, t.land.buffer, t.lines.buffer]);
  } catch (err) {
    self.postMessage({ error: err.message || String(err) });
  }
};
