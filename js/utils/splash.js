// Splash Image Utility - Shared across pages
// Selects splash images with priority for "session" images

const SPLASH_BASE_URL = 'https://raw.githubusercontent.com/Benjakronk/shima-pokedex/main/images/splashes/';
const MAX_SPLASH_IMAGES = 20; // Maximum number of splash images
const DEFAULT_BACKGROUND = 'https://raw.githubusercontent.com/Benjakronk/shima-pokedex/main/images/background/background.png';

// Helper function to check if an image exists
async function imageExists(url) {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    return response.ok;
  } catch (error) {
    return false;
  }
}

/**
 * Select a random splash image with priority for "session" images
 * @returns {Promise<string>} URL of the selected splash image
 */
export async function selectSplashImage() {
  // First, try to get the session image
  const sessionUrl = `${SPLASH_BASE_URL}session.png`;

  if (await imageExists(sessionUrl)) {
    console.log('[Splash] Using session image:', sessionUrl);
    return sessionUrl;
  }

  // If no session image, pick a random splash image
  const randomNumber = Math.floor(Math.random() * MAX_SPLASH_IMAGES) + 1;
  const randomSplashUrl = `${SPLASH_BASE_URL}splash-${randomNumber}.png`;

  if (await imageExists(randomSplashUrl)) {
    console.log('[Splash] Using random splash image:', randomSplashUrl);
    return randomSplashUrl;
  }

  // Fallback to default background if splash image not found
  console.log('[Splash] No splash images found, using default background');
  return DEFAULT_BACKGROUND;
}

/**
 * Show loading screen with a splash image
 * @param {string} splashUrl - URL of the splash image to use
 */
export function showLoadingWithSplash(splashUrl) {
  const loadingScreen = document.getElementById('loading-screen');
  if (loadingScreen) {
    if (splashUrl) {
      loadingScreen.style.backgroundImage = `url('${splashUrl}')`;
    }
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
    // Reset background image
    loadingScreen.style.backgroundImage = '';
  }
}
