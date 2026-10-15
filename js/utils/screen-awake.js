// Keeps a screen nobody touches awake -- the battle map on the table monitor (battle-map.js) mustn't dim or go to sleep
// mid-session. Two ways, since the screen may be any browser or a TV box's WebView:
//   1. the Screen Wake Lock API (https only -- the Pi is served over Tailscale's https), asked for again whenever the
//      page is shown again (the browser drops it when the page is hidden) and on the first touch or key, for a browser
//      that wants one first;
//   2. a tiny silent black video (assets/keep-awake.mp4, 2s, 64x64) looping out of sight -- many TV boxes and WebViews
//      keep the screen on while a video plays, wake lock or not.

let _lock = null;
let _started = false;

async function _requestLock() {
  if (!('wakeLock' in navigator) || document.visibilityState !== 'visible' || _lock) return;
  try {
    _lock = await navigator.wakeLock.request('screen');
    _lock.addEventListener('release', () => { _lock = null; });
  } catch (err) {
    _lock = null; // not allowed yet (no touch so far, or a battery saver) -- tried again on the next chance
    console.info('Screen wake lock:', err?.message || err);
  }
}

function _startVideo() {
  const video = document.createElement('video');
  video.src = 'assets/keep-awake.mp4';
  video.muted = true;
  video.loop = true;
  video.autoplay = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('aria-hidden', 'true');
  // Out of sight but still "on screen" (a display:none video doesn't count as playing for the screen).
  video.style.cssText = 'position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1;';
  document.body.appendChild(video);
  const play = () => video.play().catch(() => {});
  play();
  // A WebView may pause it (backgrounded, or no autoplay before a touch): start it again.
  video.addEventListener('pause', () => setTimeout(play, 1000));
  return play;
}

export function keepScreenAwake() {
  if (_started) return;
  _started = true;
  const playVideo = _startVideo();
  _requestLock();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { _requestLock(); playVideo(); }
  });
  // A browser that only allows it after the page was touched: the first touch, click or key asks again.
  const retry = () => { _requestLock(); playVideo(); };
  ['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, retry, { passive: true }));
}
