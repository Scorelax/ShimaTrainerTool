// Preload cache for self-uploaded per-species "use move" battle animations
// (see upstream.BATTLE_ANIMATION_DIR on the Pi). Combat pages know every
// Pokemon involved as soon as they load, well before any move gets
// confirmed, so preloadBattleAnimation() is called then -- by the time the
// player clicks Yes on a move, the clip (if one exists for that species) is
// already sitting in the browser's cache and can start playing instantly.

import { PokemonAPI } from '../api.js';
import { prefetchSprite } from './sprite-media.js';

// speciesKey -> { url: string|null, ready: Promise<void> }
const _cache = new Map();

function _key(speciesName) {
  return (speciesName || '').trim().toLowerCase();
}

/**
 * Kicks off the lookup + prefetch for a species, if not already in flight.
 * Fire-and-forget -- call as soon as the species is known.
 */
export function preloadBattleAnimation(speciesName) {
  const key = _key(speciesName);
  if (!key || _cache.has(key)) return;

  const entry = { url: null, ready: null };
  entry.ready = PokemonAPI.getBattleAnimation(speciesName)
    .then(result => {
      if (result.status === 'success' && result.url) {
        entry.url = result.url;
        return prefetchSprite(result.url);
      }
    })
    .catch(() => {});
  _cache.set(key, entry);
}

/**
 * Resolves to the animation URL for this species, or null if none exists
 * (or preloadBattleAnimation() was never called for it). Awaiting this
 * resolves instantly once the initial preload has finished.
 */
export async function getBattleAnimationUrl(speciesName) {
  const entry = _cache.get(_key(speciesName));
  if (!entry) return null;
  await entry.ready;
  return entry.url;
}
