// Splash Image Utility - Shared across pages
// Only splash images are shown on loading screens (no default background fallback)

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
