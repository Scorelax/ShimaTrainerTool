// The table TV's screen (display.html) -- not the battle map (battle-map.html,
// the board), a separate screen. A login-free static page meant to run
// unattended on the TV: no trainer identity, no audio preload sequence, no
// idle-splash screensaver. Strictly read-only, so it's safe to leave open and
// untouched all session.
//
// What it shows is the DM's scene (js/utils/display-scene.js), set up in the
// DM console's Display module and pushed here live: a background of wherever
// the players are, with the trainers, NPCs and Pokemon they meet put on it.
// When a battle starts the background stays and the battle goes on top --
// whoever's turn it is, big, and the turn order along the bottom; the placed
// pictures are put away until it ends (unless the DM keeps them on). With
// nothing set up at all, the Shima Adventures title screen.
//
// display.html?preview is the DM console's small live preview of this screen:
// no SSE connection of its own (the console posts it the battle and the scene
// as they change -- see js/dm/display.js) and no move animations.
import { CombatAPI, DmAPI } from '../api.js';
import { initLiveUpdates } from '../utils/live-updates.js';
import { audioManager } from '../utils/audio.js';
import { getSettings } from '../utils/settings.js';
import { spriteMediaHtml, patchPortraitMedia, useSpritePreviews, keepVideosPlaying } from '../utils/sprite-media.js';
import { preloadBattleAnimation, getBattleAnimationUrl } from '../utils/battle-animation.js';
import { visibleToViewer } from '../utils/combat-visibility.js';
import { normaliseScene, renderScene, sceneHasContent, sceneOnScreen, battleOnDisplay } from '../utils/display-scene.js';

const PREVIEW = new URLSearchParams(location.search).has('preview');

let session = { active: false, participants: {}, turnOrder: [], turnIndex: 0, round: 0, reactingParticipantId: null };
let scene = normaliseScene(null);
let previewPaused = false;
// The preview: what the DM console posted so far -- the Pi's copy (fetched below, and answered later) never replaces it.
// It's the planned scene being worked on in the planner, which the Pi's display scene isn't.
let postedScene = false;
let postedSession = false;

/** The preview's videos pause while the DM console has the Display module put away, and play again when it's back. */
function syncPreviewPlayback() {
  document.querySelectorAll('video').forEach((v) => {
    if (previewPaused) v.pause();
    else if (v.paused && v.autoplay) v.play().catch(() => {});
  });
}

async function init() {
  audioManager.setVolume(getSettings().volume);

  if (PREVIEW) {
    // A small preview: the small sprite copies, and nothing plays while the DM is in another module.
    useSpritePreviews(true);
    window.addEventListener('message', (e) => {
      if (e.origin !== location.origin || e.data?.source !== 'dm-display') return;
      if (e.data.scene) { scene = normaliseScene(e.data.scene); postedScene = true; }
      if (e.data.session) { session = e.data.session; postedSession = true; }
      if ('paused' in e.data) previewPaused = !!e.data.paused;
      if (e.data.scene || e.data.session) { drawScene(); render(); }
      if (e.data.scene || e.data.session || 'paused' in e.data) syncPreviewPlayback();
    });
  } else {
    initLiveUpdates();
    keepVideosPlaying(); // nobody touches this screen: a sprite the WebView pauses starts again
  }

  const [result, savedScene] = await Promise.all([
    CombatAPI.getState(),
    DmAPI.getState('display-scene').catch(() => null),
  ]);
  if (result.status === 'success' && !postedSession) session = result.data;
  if (savedScene && !postedScene) scene = normaliseScene(savedScene);
  drawScene();
  render();
  if (!PREVIEW) preloadAllAnimations();

  window.addEventListener('app:combat-updated', (e) => {
    session = e.detail;
    drawScene();
    render();
    preloadAllAnimations();
  });

  window.addEventListener('app:combat-animation', (e) => {
    playAnimationOverlay(e.detail.species);
  });

  window.addEventListener('app:display-scene', (e) => {
    scene = normaliseScene(e.detail?.scene);
    render(); // the DM may have taken the battle off the screen, or put it back
    drawScene();
    render();
  });
  // Back after the connection dropped: whatever changed meanwhile.
  window.addEventListener('app:live-resync', async () => {
    const [r, s] = await Promise.all([CombatAPI.getState().catch(() => null), DmAPI.getState('display-scene').catch(() => null)]);
    if (r?.status === 'success') session = r.data;
    if (s) scene = normaliseScene(s);
    drawScene();
    render();
  });
}

function drawScene() {
  // A planned scene the DM put on over everything (the Display module's "Override"), else the scene -- without its
  // pictures during a battle unless they're kept on
  renderScene(document.getElementById('sceneStage'), scene.override || sceneOnScreen(scene, battleOnDisplay(scene, session)));
}

function preloadAllAnimations() {
  Object.values(session.participants).forEach(p => preloadBattleAnimation(p.name));
}

// ---------------------------------------------------------------------------
// Render -- the skeleton (spotlight card, strip) is
// built once and left alone; every subsequent push only patches text, bar
// widths and classes in place. Critically, a participant's portrait
// <video>/<img> is only ever rebuilt when its image URL actually changes --
// touching it on every push (the old full-innerHTML-rebuild approach) reset
// every idle-sprite loop back to frame 0 on every single combat event, which
// will be constant once per-move HP ticks exist instead of just occasional
// join/turn/visibility changes.
// ---------------------------------------------------------------------------

function render() {
  const layer = document.getElementById('battleLayer');
  if (!layer) return;
  // the DM can put the regular screen back during a battle -- or a planned scene over it for a while (scene.override)
  const inBattle = !scene.override && battleOnDisplay(scene, session);
  document.getElementById('idleLogo').hidden = inBattle || sceneHasContent(scene.override || scene);
  layer.hidden = !inBattle;
  if (!inBattle) return;

  ensureSkeleton(layer);

  const activeId = session.reactingParticipantId || session.turnOrder[session.turnIndex];
  const roundEl = document.getElementById('displayRound');
  if (roundEl) {
    roundEl.textContent = `Round ${session.round}${session.reactingParticipantId ? ' · ⚡ Reaction' : ''}`;
  }

  updateSpotlight(activeId);
  updateStrip(activeId);
}

/** Builds the battle layer once. No-op (and, crucially, doesn't touch
 * existing children) if it's already there -- the whole point is that
 * render() can be called on every SSE push without ever recreating this. */
function ensureSkeleton(layer) {
  if (document.getElementById('displaySpotlightCard')) return;

  layer.innerHTML = `
    <div class="display-round" id="displayRound"></div>
    <div class="display-spotlight">
      <div class="display-spotlight-card" id="displaySpotlightCard" hidden>
        <div class="display-spotlight-portrait" id="spotlightPortrait"></div>
        <div class="display-spotlight-plate">
          <div class="display-spotlight-turn" id="spotlightTurn"></div>
          <div class="display-spotlight-name" id="spotlightName"></div>
          <div class="display-spotlight-bars" id="spotlightBars"></div>
        </div>
      </div>
    </div>
    <div class="display-strip" id="displayStrip"></div>
  `;
}

/** A creature's HP / VP bars -- for the DM's creatures, only the ones the DM shows the players (hpBar / vpBar). */
function barsHtml(p) {
  const hpPct = p.maxHP > 0 ? Math.max(0, Math.min(100, (p.currentHP / p.maxHP) * 100)) : 0;
  const vpPct = p.maxVP > 0 ? Math.max(0, Math.min(100, (p.currentVP / p.maxVP) * 100)) : 0;
  return `
    ${visibleToViewer(p, 'hpBar') ? `<div class="display-bar hp"><div class="display-bar-fill" style="width:${hpPct}%"></div></div>` : ''}
    ${visibleToViewer(p, 'vpBar') ? `<div class="display-bar vp"><div class="display-bar-fill" style="width:${vpPct}%"></div></div>` : ''}
  `;
}

function updateSpotlight(activeId) {
  const card = document.getElementById('displaySpotlightCard');
  const p = session.participants[activeId];
  if (!card) return;
  if (!p) { card.hidden = true; return; }

  card.hidden = false;
  const name = visibleToViewer(p, 'name') ? p.name : '???';
  patchPortraitMedia(document.getElementById('spotlightPortrait'), p.image, name);
  document.getElementById('spotlightTurn').textContent = session.reactingParticipantId === activeId ? '⚡ Reacting' : 'Turn';
  document.getElementById('spotlightName').textContent = p.level && visibleToViewer(p, 'level') ? `${name} · Lv ${p.level}` : name;
  document.getElementById('spotlightBars').innerHTML = barsHtml(p).trim();
}

function updateStrip(activeId) {
  const stripEl = document.getElementById('displayStrip');
  if (!stripEl) return;

  // The DM's creatures held back (not in the fight yet) stay a surprise: not in the strip at all. A player's benched
  // Pokemon still show, greyed.
  const heldBack = (p) => p.status === 'spectating' && (!p.owner || p.owner === 'DM');
  const liveIds = new Set(Object.keys(session.participants).filter(id => !heldBack(session.participants[id])));
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
    if (!p || heldBack(p)) return;

    let card = stripEl.querySelector(`[data-id="${id}"]`);
    if (!card) {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = `
        <div class="display-strip-card" data-id="${id}">
          <div class="display-strip-reaction"></div>
          <div class="display-strip-bonus"></div>
          <div class="display-strip-portrait" id="stripPortrait-${id}"></div>
          <div class="display-strip-name"></div>
          <div class="display-strip-level"></div>
          <div class="display-strip-bars"></div>
        </div>`;
      card = wrapper.firstElementChild;
    }

    const name = visibleToViewer(p, 'name') ? p.name : '???';
    card.className = ['display-strip-card', p.side,
      id === activeId ? 'active' : '',
      p.status === 'spectating' ? 'spectating' : ''].filter(Boolean).join(' ');
    card.querySelector('.display-strip-name').textContent = name;
    card.querySelector('.display-strip-level').textContent = p.level && visibleToViewer(p, 'level') ? `Lv ${p.level}` : '';
    card.querySelector('.display-strip-bars').innerHTML = barsHtml(p);
    patchPortraitMedia(card.querySelector('.display-strip-portrait'), p.image, name);

    // A greyed-out bolt means "hasn't reacted yet, still eligible"; a lit
    // one means "already used" -- shown either way (not just on use) so
    // the table can see at a glance who still has a reaction in reserve.
    // Meaningless for a benched/spectating combatant, so hidden there.
    const reactionEl = card.querySelector('.display-strip-reaction');
    if (reactionEl) {
      reactionEl.textContent = p.status === 'participating' ? '⚡' : '';
      reactionEl.classList.toggle('used', !!p.reactionUsed);
    }
    const bonusEl = card.querySelector('.display-strip-bonus');
    if (bonusEl) {
      bonusEl.textContent = p.status === 'participating' ? '✦' : '';
      bonusEl.classList.toggle('used', !!p.bonusActionUsed);
    }

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
  if (PREVIEW) return;
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
  // volume), this ties playback volume to the device's saved volume setting
  // (no slider on this screen -- music comes from the DM's own laptop).
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
