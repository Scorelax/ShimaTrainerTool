// Splash Image Utility - Shared across pages
// Only splash images are shown on loading screens (no default background fallback)

import { spriteMediaHtml } from './sprite-media.js';

const SPLASH_BASE_URL = 'https://raw.githubusercontent.com/Benjakronk/shima-pokedex/main/images/splashes/';
const SPLASH_API_URL = 'https://api.github.com/repos/Benjakronk/shima-pokedex/contents/images/splashes';
const FALLBACK_SPLASH_COUNT = 50; // Fallback if API call fails

// Same backend detection as api.js: anything not github.io is the pi-server,
// which mirrors the splash images locally (much faster than GitHub raw)
const SPLASH_FROM_PI_SERVER = window.location.protocol.startsWith('http')
  && !window.location.hostname.endsWith('github.io');

// Fetch the list of available splash images (cached per session).
// On the pi-server, prefer its local mirror; GitHub is the fallback.
async function getSplashList() {
  const cached = sessionStorage.getItem('splashImageList');
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (parsed.baseUrl) return parsed; // ignore pre-baseUrl cache entries
    } catch (e) { /* ignore bad cache */ }
  }

  if (SPLASH_FROM_PI_SERVER) {
    try {
      const response = await fetch(`${window.location.origin}/api?route=game-data&action=splash-list`);
      const data = await response.json();
      if (data.status === 'success' && data.splashFiles.length > 0) {
        const result = {
          splashFiles: data.splashFiles,
          hasSession: data.hasSession,
          baseUrl: '/splashes/'
        };
        sessionStorage.setItem('splashImageList', JSON.stringify(result));
        console.log(`[Splash] Using ${data.splashFiles.length} local splash images from the pi-server`);
        return result;
      }
      console.warn('[Splash] Pi splash mirror not available, falling back to GitHub');
    } catch (error) {
      console.warn('[Splash] Pi splash-list failed, falling back to GitHub:', error);
    }
  }

  try {
    const response = await fetch(SPLASH_API_URL);
    if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
    const files = await response.json();

    const splashFiles = [];
    let hasSession = false;

    for (const file of files) {
      if (file.name === 'session.png') {
        hasSession = true;
      } else if (file.name.match(/^splash-\d+\.png$/)) {
        splashFiles.push(file.name);
      }
    }

    const result = { splashFiles, hasSession, baseUrl: SPLASH_BASE_URL };
    sessionStorage.setItem('splashImageList', JSON.stringify(result));
    console.log(`[Splash] Found ${splashFiles.length} splash images, session.png: ${hasSession}`);
    return result;
  } catch (error) {
    console.warn('[Splash] Failed to fetch splash list from GitHub API:', error);
    const splashFiles = [];
    for (let i = 1; i <= FALLBACK_SPLASH_COUNT; i++) {
      splashFiles.push(`splash-${i}.png`);
    }
    return { splashFiles, hasSession: false, baseUrl: SPLASH_BASE_URL };
  }
}

/**
 * Preload a single image URL
 */
function preloadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      console.log('[Splash] Image preloaded successfully');
      resolve(url);
    };
    img.onerror = () => {
      console.log('[Splash] Image failed to load, using splash anyway');
      resolve(url);
    };
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
    const spriteReveal = document.getElementById('loading-sprite-reveal');
    if (spriteReveal) {
      spriteReveal.classList.remove('active');
      spriteReveal.innerHTML = '';
    }

    // Now show the loading screen
    loadingScreen.classList.add('active');
  }
}

/**
 * Show the loading screen with a Pokemon's sprite (video or image) in
 * place of splash art -- used when registering a Pokemon, so the player
 * sees the actual catch instead of generic splash art while the sound
 * plays. Call prefetchSprite() on the same URL ahead of time (e.g. while
 * the player is still filling out the form) so it's ready instantly here.
 */
export function showLoadingWithSprite(spriteUrl, altText) {
  const loadingScreen = document.getElementById('loading-screen');
  if (loadingScreen) {
    // Plain black background -- no splash art for this flow. 'none' (not
    // '') is required to actually override the CSS default TitleScreen.png,
    // not just clear back to it.
    loadingScreen.style.backgroundImage = 'none';
    const fill = document.getElementById('loading-progress-fill');
    const text = document.getElementById('loading-progress-text');
    if (fill) fill.style.width = '0%';
    if (text) text.textContent = 'Preparing...';
    loadingScreen.classList.add('active');
  }

  const spriteReveal = document.getElementById('loading-sprite-reveal');
  if (spriteReveal) {
    spriteReveal.innerHTML = spriteMediaHtml(spriteUrl, altText);
    spriteReveal.classList.add('active');
  }
}

/**
 * Hide loading screen
 */
export function hideLoading() {
  const loadingScreen = document.getElementById('loading-screen');
  if (loadingScreen) {
    loadingScreen.classList.remove('active');
    // Keep background image set for instant display next time
  }

  const spriteReveal = document.getElementById('loading-sprite-reveal');
  if (spriteReveal) {
    spriteReveal.classList.remove('active');
    spriteReveal.innerHTML = '';
  }
}
