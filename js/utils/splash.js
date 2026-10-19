// Splash Image Utility - Shared across pages
// Only splash images are shown on loading screens (no default background fallback)

import { spriteMediaHtml } from './sprite-media.js';

// The splashes on the Pi (pi-server media.SPLASH_DIR).
const SPLASH_BASE_URL = '/splashes/';

// Both the splash-list fetch below and the <img> preload need a hard timeout --
// without one, a stalled connection (a flaky Tailscale hop to the pi-server)
// leaves the promise neither resolved nor rejected, forever. That's
// silent and easy to miss: continue-journey.js's own preload-while-the-player-picks-a-
// trainer call (see attachContinueJourneyListeners) just never finishes, so the
// fullscreen loading background stays on the CSS default (TitleScreen.png) instead of
// a real splash -- and the LATER, blocking `await selectAndPreloadSplashImage()` in the
// actual login flow hangs on the exact same call, freezing the progress bar at "Loading
// splash images..." with no error ever shown (a restart just gets a fresh connection
// attempt that happens to succeed). Matches api.js's own AbortController pattern.
const SPLASH_LIST_TIMEOUT = 8000;   // a tiny JSON filename list -- shouldn't legitimately take long
const IMAGE_PRELOAD_TIMEOUT = 8000; // resolves anyway on timeout, same as it already does on a real load error

function _fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timeoutId));
}

// Fetch the list of available splash images from the Pi (cached per session once it has any; an empty or failed
// list is asked again next time).
async function getSplashList() {
  const cached = sessionStorage.getItem('splashImageList');
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (parsed.baseUrl === SPLASH_BASE_URL) return parsed; // older entries may point at GitHub
    } catch (e) { /* ignore bad cache */ }
  }

  try {
    const response = await _fetchWithTimeout(`${window.location.origin}/api?route=game-data&action=splash-list`, SPLASH_LIST_TIMEOUT);
    const data = await response.json();
    if (data.status === 'success' && (data.splashFiles.length > 0 || data.hasSession)) {
      const result = { splashFiles: data.splashFiles, hasSession: data.hasSession, baseUrl: SPLASH_BASE_URL };
      sessionStorage.setItem('splashImageList', JSON.stringify(result));
      return result;
    }
    console.warn('[Splash] No splash images on the Pi');
  } catch (error) {
    console.warn('[Splash] Splash list failed:', error);
  }
  return { splashFiles: [], hasSession: false, baseUrl: SPLASH_BASE_URL };
}

/**
 * Preload a single image URL. Always resolves within IMAGE_PRELOAD_TIMEOUT --
 * a stalled load (connection drops mid-download without ever firing a hard
 * error) gets the same "give up and use the URL anyway" treatment as a real
 * onerror, rather than leaving the caller waiting forever.
 */
function preloadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(url);
    };
    img.onload = () => {
      console.log('[Splash] Image preloaded successfully');
      finish();
    };
    img.onerror = () => {
      console.log('[Splash] Image failed to load, using splash anyway');
      finish();
    };
    const timer = setTimeout(() => {
      console.log('[Splash] Image preload timed out, using splash anyway');
      finish();
    }, IMAGE_PRELOAD_TIMEOUT);
    img.src = url;
  });
}

/**
 * Select and preload a random splash image (prioritizes session.png if it exists)
 */
export async function selectAndPreloadSplashImage() {
  const { splashFiles, hasSession, baseUrl } = await getSplashList();

  if (hasSession) {
    const sessionUrl = `${baseUrl}session.png`;
    console.log('[Splash] Using session splash:', sessionUrl);
    return preloadImage(sessionUrl);
  }
  // None on the Pi: the loading screen keeps its default background.
  if (!splashFiles.length) return '';

  const randomFile = splashFiles[Math.floor(Math.random() * splashFiles.length)];
  const splashUrl = `${baseUrl}${randomFile}`;

  console.log('[Splash] Selected splash image:', splashUrl);
  return preloadImage(splashUrl);
}

/**
 * Show loading screen with a splash image
 * @param {string} splashUrl - URL of the splash image to use
 */
export function showLoadingWithSplash(splashUrl) {
  const loadingScreen = document.getElementById('loading-screen');
  if (loadingScreen) {
    // Set background image first (before making visible). Always assign,
    // even when falsy (falls back to the CSS default) -- otherwise a prior
    // showLoadingWithSprite() call's inline 'none' would linger and leave
    // this black instead of showing splash art.
    loadingScreen.style.backgroundImage = splashUrl ? `url('${splashUrl}')` : '';
    // Force a reflow to ensure image is set before showing
    loadingScreen.offsetHeight;

    // #loading-screen's progress bar/status text are shared, persistent DOM
    // elements (defined once in index.html) that any flow can write to via
    // updateLoadingProgress() -- continue-journey.js's own login sequence
    // ends by setting these to 100%/"Tap to continue" and never resets them
    // afterward. Without this, a completely unrelated later use of this
    // same generic loading screen (registering a Pokemon, evolution's
    // splash fallback) would inherit that leftover state: the bar already
    // full and the text claiming tappable-and-ready, even though nothing
    // in THAT flow is actually listening for a tap -- exactly what looked
    // like "the prompt appeared before it actually worked". Reset to the
    // neutral defaults from index.html here so every fresh use starts
    // clean; a caller doing its own real progress reporting (like
    // continue-journey.js) immediately overwrites this with real values
    // right after anyway.
    const fill = document.getElementById('loading-progress-fill');
    const text = document.getElementById('loading-progress-text');
    if (fill) fill.style.width = '0%';
    if (text) text.textContent = 'Preparing...';

    // Clear any leftover sprite reveal from a previous showLoadingWithSprite()
    // call (e.g. registering a Pokemon) so it can't show through here too.
    // Clears the media/caption *contents*, not #loading-sprite-reveal
    // itself -- that element's own children are permanent (defined in
    // index.html), so wiping its innerHTML would delete them for good.
    loadingScreen.classList.remove('sprite-reveal-mode');
    document.getElementById('loading-sprite-reveal')?.classList.remove('active');
    const spriteMedia = document.getElementById('loading-sprite-media');
    if (spriteMedia) spriteMedia.innerHTML = '';
    const spriteCaption = document.getElementById('loading-sprite-caption');
    if (spriteCaption) spriteCaption.textContent = '';

    // Now show the loading screen
    loadingScreen.classList.add('active');
  }
}

/**
 * Show the loading screen with a Pokemon's sprite (video or image) and a
 * caption in place of splash art -- used when registering a Pokemon, so
 * the player sees the actual catch (with "<Trainer> caught a <Pokemon>!")
 * instead of generic splash art while the sound plays. Uses the app's own
 * red gradient background instead of the plain black/TitleScreen default,
 * so it matches the rest of the app. Call prefetchSprite() on the same URL
 * ahead of time (e.g. while the player is still filling out the form) so
 * it's ready instantly here.
 */
export function showLoadingWithSprite(spriteUrl, altText, captionText = '') {
  const loadingScreen = document.getElementById('loading-screen');
  if (loadingScreen) {
    // 'none' (not '') is required to actually override the CSS default
    // TitleScreen.png background-image, not just clear back to it --
    // sprite-reveal-mode supplies its own background instead.
    loadingScreen.style.backgroundImage = 'none';
    loadingScreen.classList.add('sprite-reveal-mode');
    const fill = document.getElementById('loading-progress-fill');
    const text = document.getElementById('loading-progress-text');
    if (fill) fill.style.width = '0%';
    if (text) text.textContent = 'Preparing...';
    loadingScreen.classList.add('active');
  }

  const spriteMedia = document.getElementById('loading-sprite-media');
  if (spriteMedia) spriteMedia.innerHTML = spriteMediaHtml(spriteUrl, altText);

  const spriteCaption = document.getElementById('loading-sprite-caption');
  if (spriteCaption) spriteCaption.textContent = captionText;

  const spriteReveal = document.getElementById('loading-sprite-reveal');
  if (spriteReveal) spriteReveal.classList.add('active');
}

/**
 * Hide loading screen
 */
export function hideLoading() {
  const loadingScreen = document.getElementById('loading-screen');
  if (loadingScreen) {
    loadingScreen.classList.remove('active');
    loadingScreen.classList.remove('sprite-reveal-mode');
    // Keep background image set for instant display next time
  }

  // See showLoadingWithSplash() -- clear contents, not the permanent
  // container elements themselves.
  document.getElementById('loading-sprite-reveal')?.classList.remove('active');
  const spriteMedia = document.getElementById('loading-sprite-media');
  if (spriteMedia) spriteMedia.innerHTML = '';
  const spriteCaption = document.getElementById('loading-sprite-caption');
  if (spriteCaption) spriteCaption.textContent = '';
}
