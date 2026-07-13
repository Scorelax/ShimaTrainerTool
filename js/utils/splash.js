// Splash Image Utility - Shared across pages
// Only splash images are shown on loading screens (no default background fallback)

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
    if (splashUrl) {
      // Set background image first (before making visible)
      loadingScreen.style.backgroundImage = `url('${splashUrl}')`;
      // Force a reflow to ensure image is set before showing
      loadingScreen.offsetHeight;
    }
    // Now show the loading screen
    loadingScreen.classList.add('active');
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
}
