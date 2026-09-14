// Shared combat display screen. A separate, login-free static page
// (see display.html) meant to run unattended on a TV or projector laptop --
// unlike every other page in this app it has no trainer identity, no audio
// preload sequence, no idle-splash screensaver, just: subscribe to the
// shared combat session over SSE and render it. Strictly read-only -- no
// control ever mutates combat state from here, so it's safe to leave open
// and untouched all session.
import { CombatAPI } from '../api.js';
import { initLiveUpdates } from '../utils/live-updates.js';
import { audioManager } from '../utils/audio.js';
import { getSettings, saveSettings } from '../utils/settings.js';
import { spriteMediaHtml } from '../utils/sprite-media.js';
import { preloadBattleAnimation, getBattleAnimationUrl } from '../utils/battle-animation.js';

let session = { active: false, participants: {}, turnOrder: [], turnIndex: 0, round: 0, reactingParticipantId: null };

async function init() {
  audioManager.setVolume(getSettings().volume);
  initLiveUpdates();

  const result = await CombatAPI.getState();
  if (result.status === 'success') session = result.data;
  render();
  preloadAllAnimations();

  window.addEventListener('app:combat-updated', (e) => {
    session = e.detail;
    render();
    preloadAllAnimations();
  });

  window.addEventListener('app:combat-animation', (e) => {
    playAnimationOverlay(e.detail.species);
  });
}

function preloadAllAnimations() {
  Object.values(session.participants).forEach(p => preloadBattleAnimation(p.name));
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function render() {
  const root = document.getElementById('displayRoot');
  if (!root) return;

  if (!session.active) {
    root.innerHTML = '<div class="display-empty">⚔️ Waiting for battle to start…</div>';
    return;
  }

  const activeId = session.reactingParticipantId || session.turnOrder[session.turnIndex];
  const spotlight = session.participants[activeId];
  const allParticipants = Object.values(session.participants);

  // Full re-render on every push -- fine while combat events are infrequent
  // (participants/turns/visibility). Once frequent per-move HP ticks land,
  // this will visibly restart every idle-sprite loop in the strip and is
  // worth revisiting to patch in place instead.
  root.innerHTML = `
    <div class="display-round">Round ${session.round}${session.reactingParticipantId ? ' · ⚡ Reaction in progress' : ''}</div>
    <div class="display-spotlight">${spotlight ? renderSpotlight(spotlight) : ''}</div>
    <div class="display-strip">${allParticipants.map(p => renderStripCard(p, p.id === activeId)).join('')}</div>
    <div class="display-anim-overlay" id="animOverlay" hidden></div>
    <div class="display-volume">🔊 <input type="range" id="displayVolume" min="0" max="100" value="${getSettings().volume}"></div>
  `;

  document.getElementById('displayVolume')?.addEventListener('input', (e) => {
    const value = parseInt(e.target.value, 10);
    audioManager.setVolume(value);
    saveSettings({ volume: value });
  });
}

function visibleTo(p, field) {
  // Allies are always fully shown to the table; enemies only show what the
  // DM has made visible (see routes_combat.py's per-participant visibility).
  return p.side === 'player' || p.visibility[field];
}

function barsHtml(p, sizeClass = '') {
  const hpPct = p.maxHP > 0 ? Math.max(0, Math.min(100, (p.currentHP / p.maxHP) * 100)) : 0;
  const vpPct = p.maxVP > 0 ? Math.max(0, Math.min(100, (p.currentVP / p.maxVP) * 100)) : 0;
  return `
    ${visibleTo(p, 'hp') ? `<div class="display-bar hp ${sizeClass}"><div class="display-bar-fill" style="width:${hpPct}%"></div></div>` : ''}
    ${visibleTo(p, 'vp') ? `<div class="display-bar vp ${sizeClass}"><div class="display-bar-fill" style="width:${vpPct}%"></div></div>` : ''}
  `;
}

function renderSpotlight(p) {
  const name = visibleTo(p, 'name') ? p.name : '???';
  return `
    <div class="display-spotlight-card">
      <div class="display-spotlight-portrait">${spriteMediaHtml(p.image, name)}</div>
      <div class="display-spotlight-name">${name}</div>
      <div class="display-spotlight-bars">${barsHtml(p)}</div>
    </div>`;
}

function renderStripCard(p, isActive) {
  const name = visibleTo(p, 'name') ? p.name : '???';
  const classes = ['display-strip-card', p.side];
  if (isActive) classes.push('active');
  if (p.status === 'spectating') classes.push('spectating');
  return `
    <div class="${classes.join(' ')}">
      <div class="display-strip-portrait">${spriteMediaHtml(p.image, name)}</div>
      <div class="display-strip-name">${name}</div>
      ${barsHtml(p)}
    </div>`;
}

// ---------------------------------------------------------------------------
// Move animation playback (triggered by routes_combat.py's play-animation)
// ---------------------------------------------------------------------------

async function playAnimationOverlay(species) {
  preloadBattleAnimation(species);
  const url = await getBattleAnimationUrl(species);
  const overlay = document.getElementById('animOverlay');
  if (!url || !overlay) return; // no uploaded clip for this species -- silently skip

  const video = document.createElement('video');
  video.src = url;
  video.playsInline = true;
  video.disablePictureInPicture = true;
  // Unlike the idle sprite loop (always muted) and the current combat page's
  // move-confirm popup (unmuted but never actually routed through app
  // volume), this ties playback volume to the same device-level setting the
  // slider above controls.
  video.volume = audioManager.volume;
  overlay.innerHTML = '';
  overlay.appendChild(video);
  overlay.hidden = false;

  try { await video.play(); } catch (err) { /* autoplay blocked -- leave the overlay showing a paused frame */ }

  await new Promise((resolve) => {
    video.addEventListener('ended', resolve, { once: true });
    video.addEventListener('error', resolve, { once: true });
    setTimeout(resolve, 8000); // safety cap, matches move-popup.js
  });

  overlay.hidden = true;
  overlay.innerHTML = '';
}

init();
