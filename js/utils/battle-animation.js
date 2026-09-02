// Preload cache for self-uploaded per-species "use move" battle animations
// (see upstream.BATTLE_ANIMATION_DIR on the Pi). Combat pages know every
// Pokemon involved as soon as they load, well before any move gets
// confirmed, so preloadBattleAnimation() is called then -- by the time the
// player clicks Yes on a move, the clip (if one exists for that species) is
// already sitting fully in memory and can start playing instantly.
//
// Deliberately NOT using sprite-media.js's prefetchSprite() for this --
// that does a bare `fetch(url)` and never reads the body, so it resolves as
// soon as response headers arrive, not once the clip has actually finished
// downloading. That's fine for warming the HTTP cache as a hint, but it
// gave no real guarantee the video was playable yet -- whether it stalled
// mid-playback came down to network timing luck. Fetching the body as a
// Blob and playing from an in-memory object URL removes the network
// dependency at play time entirely.

import { PokemonAPI } from '../api.js';

// speciesKey -> { blobUrl: string|null, ready: Promise<void> }
const _cache = new Map();

function _key(speciesName) {
  return (speciesName || '').trim().toLowerCase();
}

/**
 * Kicks off the lookup + full-body preload for a species, if not already in
 * flight. Fire-and-forget -- call as soon as the species is known.
 */
export function preloadBattleAnimation(speciesName) {
  const key = _key(speciesName);
  if (!key || _cache.has(key)) return;

  const entry = { blobUrl: null, ready: null };
  entry.ready = PokemonAPI.getBattleAnimation(speciesName)
    .then(async result => {
      if (result.status !== 'success' || !result.url) return;
      const response = await fetch(result.url);
      if (!response.ok) return;
      const blob = await response.blob();
      entry.blobUrl = URL.createObjectURL(blob);
    })
    .catch(() => {});
  _cache.set(key, entry);
}

/**
 * Resolves to a fully-loaded, playable object URL for this species'
 * animation, or null if none exists (or preloadBattleAnimation() was never
 * called for it, or the fetch failed). Awaiting this resolves instantly
 * once the initial preload has finished -- and by then the whole clip is
 * already in memory, so playback can never stall on the network.
 */
export async function getBattleAnimationUrl(speciesName) {
  const entry = _cache.get(_key(speciesName));
  if (!entry) return null;
  await entry.ready;
  return entry.blobUrl;
}
