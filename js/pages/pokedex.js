// pokedex.html -- the players' Pokedex on its own page: the splash-screen start Benjakronk's site had (a random splash,
// the progress, "Tap to enter" on phones), then the Pokedex itself (js/pokedex/player-pokedex.js), kept up to date with
// the DM console's changes over the Pi's live-update stream.
import { EVENTS_URL } from '../api.js';
import { mountPlayerPokedex } from '../pokedex/player-pokedex.js';

const SPLASH_BAG_KEY = 'pdxSplashBag';

function setProgress(percent, text) {
  document.getElementById('pdxProgress').style.width = `${percent}%`;
  document.getElementById('pdxLoadingPercent').textContent = `${Math.round(percent)}%`;
  if (text) document.getElementById('pdxLoadingText').textContent = text;
}

/** A splash from the Pi's splash folder -- shuffle-bag style, so every one shows once before any repeats. */
async function showSplash() {
  try {
    const res = await fetch(`${window.location.origin}/api?route=game-data&action=splash-list`);
    const files = (await res.json()).splashFiles || [];
    if (!files.length) return;
    let bag = [];
    try { bag = JSON.parse(localStorage.getItem(SPLASH_BAG_KEY) || '[]').filter(f => files.includes(f)); } catch (e) { /* none */ }
    if (!bag.length) bag = [...files];
    const pick = bag.splice(Math.floor(Math.random() * bag.length), 1)[0];
    try { localStorage.setItem(SPLASH_BAG_KEY, JSON.stringify(bag)); } catch (e) { /* not kept */ }
    document.getElementById('pdxSplash').style.backgroundImage = `url("/splashes/${encodeURIComponent(pick)}")`;
  } catch (e) {
    // No splash: the loading screen just stays dark.
  }
}

function hideLoading() {
  const overlay = document.getElementById('pdxLoading');
  setProgress(100, 'Ready!');
  const touch = window.innerWidth <= 768 || 'ontouchstart' in window;
  setTimeout(() => {
    if (!touch) { overlay.classList.add('hidden'); return; }
    document.getElementById('pdxLoadingText').textContent = 'Tap to enter';
    overlay.classList.add('ready');
    overlay.addEventListener('click', () => overlay.classList.add('hidden'), { once: true });
  }, 300);
}

/** The Pi's live stream, cut down to what this page needs: the DM saved the Pokedex settings, or the connection came
 * back after a gap (or the page came back to the foreground) and whatever was pushed meanwhile is lost. */
function listenLive() {
  if (!EVENTS_URL) return;
  const source = new EventSource(EVENTS_URL);
  let opened = false;
  const resync = () => window.dispatchEvent(new CustomEvent('app:live-resync'));
  source.onopen = () => { if (opened) resync(); opened = true; };
  source.onmessage = (e) => {
    try {
      if (JSON.parse(e.data).dataset === 'pokedex-config') window.dispatchEvent(new CustomEvent('app:pokedex-config'));
    } catch (err) { /* not for us */ }
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') resync(); });
}

async function start() {
  showSplash();
  setProgress(10, 'Loading Pokédex...');
  // Opened from another page of the app: a back button to return there.
  const cameFromApp = document.referrer.startsWith(window.location.origin) && window.history.length > 1;
  const pokedex = mountPlayerPokedex(document.getElementById('pokedexRoot'), cameFromApp ? { onBack: () => window.history.back() } : {});
  try {
    await pokedex.ready;
  } catch (err) {
    setProgress(100, `Couldn't load the Pokédex: ${err.message}`);
    return;
  }
  listenLive();
  hideLoading();
}

start();
