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
import { visibleToViewer } from '../utils/combat-visibility.js';

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
// Render -- the skeleton (spotlight card, strip, overlay, volume slider) is
// built once and left alone; every subsequent push only patches text, bar
// widths and classes in place. Critically, a participant's portrait
// <video>/<img> is only ever rebuilt when its image URL actually changes --
// touching it on every push (the old full-innerHTML-rebuild approach) reset
// every idle-sprite loop back to frame 0 on every single combat event, which
// will be constant once per-move HP ticks exist instead of just occasional
// join/turn/visibility changes.
// ---------------------------------------------------------------------------

function render() {
  const root = document.getElementById('displayRoot');
  if (!root) return;

  if (!session.active) {
    root.innerHTML = '<div class="display-empty">⚔️ Waiting for battle to start…</div>';
    return;
  }

  ensureSkeleton(root);

  const activeId = session.reactingParticipantId || session.turnOrder[session.turnIndex];
  const roundEl = document.getElementById('displayRound');
  if (roundEl) {
    roundEl.textContent = `Round ${session.round}${session.reactingParticipantId ? ' · ⚡ Reaction in progress' : ''}`;
  }

  updateSpotlight(activeId);
  updateStrip(activeId);
}

/** Builds the fixed page structure once. No-op (and, crucially, doesn't
 * touch existing children) if it's already there -- the whole point is that
 * render() can be called on every SSE push without ever recreating this. */
function ensureSkeleton(root) {
  if (document.getElementById('displaySpotlightCard')) return;

  root.innerHTML = `
    <div class="display-round" id="displayRound"></div>
    <div class="display-spotlight">
      <div class="display-spotlight-card" id="displaySpotlightCard" hidden>
        <div class="display-spotlight-portrait" id="spotlightPortrait"></div>
        <div class="display-spotlight-name" id="spotlightName"></div>
        <div class="display-spotlight-bars" id="spotlightBars"></div>
      </div>
    </div>
    <div class="display-strip" id="displayStrip"></div>
    <div class="display-anim-overlay" id="animOverlay" hidden></div>
    <div class="display-volume">🔊 <input type="range" id="displayVolume" min="0" max="100" value="${getSettings().volume}"></div>
  `;

  document.getElementById('displayVolume')?.addEventListener('input', (e) => {
    const value = parseInt(e.target.value, 10);
    audioManager.setVolume(value);
    saveSettings({ volume: value });
  });
}

function barsHtml(p) {
  const hpPct = p.maxHP > 0 ? Math.max(0, Math.min(100, (p.currentHP / p.maxHP) * 100)) : 0;
  const vpPct = p.maxVP > 0 ? Math.max(0, Math.min(100, (p.currentVP / p.maxVP) * 100)) : 0;
  return `
    ${visibleToViewer(p, 'hp') ? `<div class="display-bar hp"><div class="display-bar-fill" style="width:${hpPct}%"></div></div>` : ''}
    ${visibleToViewer(p, 'vp') ? `<div class="display-bar vp"><div class="display-bar-fill" style="width:${vpPct}%"></div></div>` : ''}
  `;
}

/** Rebuilds a portrait's media element only when the image URL it's
 * currently showing differs from what it should show now -- an unchanged
 * URL leaves the existing <video>/<img> (and its playing loop) untouched. */
function patchPortrait(portraitEl, image, altText) {
  if (!portraitEl) return;
  const url = image || '';
  if (portraitEl.dataset.image === url) return;
  portraitEl.dataset.image = url;
  portraitEl.innerHTML = spriteMediaHtml(image, altText);
}

function updateSpotlight(activeId) {
  const card = document.getElementById('displaySpotlightCard');
  const p = session.participants[activeId];
  if (!card) return;
  if (!p) { card.hidden = true; return; }

  card.hidden = false;
  const name = visibleToViewer(p, 'name') ? p.name : '???';
  patchPortrait(document.getElementById('spotlightPortrait'), p.image, name);
  document.getElementById('spotlightName').textContent = name;
  document.getElementById('spotlightBars').innerHTML = barsHtml(p);
}

function updateStrip(activeId) {
  const stripEl = document.getElementById('displayStrip');
  if (!stripEl) return;

  const liveIds = new Set(Object.keys(session.participants));
  [...stripEl.children].forEach(card => {
    if (!liveIds.has(card.dataset.id)) card.remove();
  });

  // Turn order first (left to right), then anyone spectating (not in
  // turnOrder) appended after, so the strip still shows the whole table.
  const orderedIds = [
    ...session.turnOrder,
    ...Object.keys(session.participants).filter(id => !session.turnOrder.includes(id)),
  ];

  orderedIds.forEach((id, index) => {
    const p = session.participants[id];
    if (!p) return;

    let card = stripEl.querySelector(`[data-id="${id}"]`);
    if (!card) {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = `
        <div class="display-strip-card" data-id="${id}">
          <div class="display-strip-portrait" id="stripPortrait-${id}"></div>
          <div class="display-strip-name"></div>
          <div class="display-strip-bars"></div>
        </div>`;
      card = wrapper.firstElementChild;
    }

    const name = visibleToViewer(p, 'name') ? p.name : '???';
    card.className = ['display-strip-card', p.side,
      id === activeId ? 'active' : '',
      p.status === 'spectating' ? 'spectating' : ''].filter(Boolean).join(' ');
    card.querySelector('.display-strip-name').textContent = name;
    card.querySelector('.display-strip-bars').innerHTML = barsHtml(p);
    patchPortrait(card.querySelector('.display-strip-portrait'), p.image, name);

    // Reorder without recreating -- insertBefore on a node already in the
    // document moves it in place and does not restart its media playback.
    if (stripEl.children[index] !== card) {
      stripEl.insertBefore(card, stripEl.children[index] || null);
    }
  });
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
