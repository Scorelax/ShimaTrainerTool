// Idle splash screensaver: after a period of inactivity, show a random splash
// image full-screen with a "Tap to continue" prompt. Purely a visual overlay
// on top of whatever page/form was already showing -- dismissing it never
// navigates or touches page state.
import { selectAndPreloadSplashImage } from './splash.js';
import { getSettings } from './settings.js';

let idleTimer = null;
let overlayShowing = false;

/**
 * Add a one-shot "Tap to continue" prompt to an already-visible full-screen
 * element; the next tap on it removes the prompt and calls onDismiss.
 * Shared by the idle overlay here and the post-login loading screen. Pass
 * showPrompt: false when the element already displays its own "tap to
 * continue" text elsewhere (e.g. the loading bar's own progress text) --
 * this then only wires up the tap-to-dismiss behavior.
 *
 * Deliberately listens for 'click' only, not 'touchstart': dismissing (and
 * navigating) on touchstart removes this element mid-tap, and the browser's
 * trailing synthetic click from that same physical tap then lands on
 * whatever page element is now underneath that screen position -- e.g.
 * tapping the loading screen right where trainer-card's "My Pokemon" button
 * ends up opened it immediately. 'click' is the last event in a tap
 * sequence, so nothing is left to bleed through afterward.
 */
export function showTapToContinue(element, onDismiss, { showPrompt = true } = {}) {
  if (!element) return;

  let prompt = null;
  if (showPrompt) {
    if (element.querySelector('.tap-to-continue-prompt')) return;
    prompt = document.createElement('div');
    prompt.className = 'tap-to-continue-prompt';
    prompt.textContent = 'Tap to continue';
    element.appendChild(prompt);
  }

  const dismiss = () => {
    if (prompt) prompt.remove();
    onDismiss();
  };
  element.addEventListener('click', dismiss, { once: true });
}

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  if (overlayShowing) return;
  const minutes = getSettings().idleSplashMinutes;
  idleTimer = setTimeout(showIdleOverlay, minutes * 60 * 1000);
}

async function showIdleOverlay() {
  const overlay = document.getElementById('idle-overlay');
  if (!overlay) return;
  overlayShowing = true;

  try {
    const splashUrl = await selectAndPreloadSplashImage();
    overlay.style.backgroundImage = `url('${splashUrl}')`;
  } catch (e) {
    console.warn('[IdleSplash] Failed to load splash image:', e);
  }

  overlay.classList.add('active');
  showTapToContinue(overlay, () => {
    overlay.classList.remove('active');
    overlayShowing = false;
    resetIdleTimer();
  });
}

/** Call once at app start. */
export function initIdleSplash() {
  ['click', 'touchstart', 'keydown', 'scroll'].forEach(evt => {
    document.addEventListener(evt, () => {
      if (!overlayShowing) resetIdleTimer();
    }, { passive: true });
  });
  resetIdleTimer();
}
