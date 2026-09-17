// Reusable "pick a target, then roll damage against them" popup for the new
// shared combat tool. Visually mirrors move-popup.js's overlay (same
// .combat-popup-overlay/.combat-popup-content look) so it reads as part of
// the same UI rather than a bolted-on dialog -- but this module is used on
// pages that never load move-popup.js (combat-wip.js today), so it injects
// its own copy of those base rules rather than assuming they're already
// present. If a page happens to have both stylesheets injected (once
// this is wired into the legacy combat.js's real move-confirm flow), the
// duplicate rules are identical and harmless.
//
// This module has no dependency on combat.js, so wiring it into the legacy
// move-confirm flow later is just an import + a call to pickTarget() away.
import { CombatAPI } from '../api.js';
import { spriteMediaHtml } from './sprite-media.js';
import { visibleToViewer } from './combat-visibility.js';
import { getBattleAnimationUrl } from './battle-animation.js';

function _injectStyles() {
  if (document.getElementById('target-picker-styles')) return;
  const style = document.createElement('style');
  style.id = 'target-picker-styles';
  style.textContent = `
    .combat-popup-overlay { position: fixed; top:0; left:0; width:100%; height:100%; background: rgba(0,0,0,0.75); z-index: 1000; justify-content: center; align-items: center; backdrop-filter: blur(3px); }
    .combat-popup-content { background: #1e1e34; border: 1px solid rgba(255,255,255,0.12); border-radius: 16px; max-width: 560px; width: 92%; max-height: 85vh; overflow-y: auto; position: relative; box-shadow: 0 10px 40px rgba(0,0,0,0.6); color: #e0e0e0; }
    .combat-move-popup-header { padding: 1.1rem 1.2rem; border-radius: 16px 16px 0 0; border-bottom: 2px solid rgba(0,0,0,0.3); display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; position: relative; background: rgba(255,255,255,0.05); }
    .combat-move-popup-header h2 { margin: 0; font-size: 1.4rem; font-weight: 900; text-transform: uppercase; }
    .combat-popup-close { position: absolute; top: 0.8rem; right: 0.8rem; background: rgba(0,0,0,0.3); border: none; border-radius: 50%; width: 32px; height: 32px; font-size: 1.2rem; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; color: inherit; }
    .combat-move-popup-body { padding: 1rem 1.2rem; }
    .combat-use-move-btn { width: 100%; padding: 0.75rem; background: linear-gradient(135deg, #4CAF50, #45A049); color: #fff; border: none; border-radius: 8px; font-size: 1rem; font-weight: 700; cursor: pointer; }
    .target-picker-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 0.6rem; margin-top: 0.5rem; }
    .target-picker-card {
      background: rgba(255,255,255,0.06); border: 2px solid transparent; border-radius: 10px;
      padding: 0.6rem; text-align: center; cursor: pointer; color: inherit; font: inherit;
    }
    .target-picker-card:hover, .target-picker-card:focus-visible { border-color: #FFD700; background: rgba(255,215,0,0.08); }
    .target-picker-portrait { width: 56px; height: 56px; margin: 0 auto 0.3rem; }
    .target-picker-portrait img, .target-picker-portrait video { width: 100%; height: 100%; object-fit: contain; }
    .target-picker-name { font-size: 0.82rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .target-picker-bar { height: 5px; border-radius: 3px; background: rgba(255,255,255,0.15); overflow: hidden; margin-top: 0.25rem; }
    .target-picker-bar-fill { height: 100%; }
    .target-picker-bar.hp .target-picker-bar-fill { background: #2ecc71; }
    .target-picker-bar.vp .target-picker-bar-fill { background: #3498db; }
    .target-picker-empty { text-align: center; color: #a0a0c0; padding: 1rem; }
    .target-picker-skip { width: 100%; margin-top: 0.9rem; }
    .target-picker-roll-target {
      display: flex; align-items: center; gap: 0.7rem; background: rgba(255,255,255,0.05);
      border-radius: 10px; padding: 0.6rem; margin-bottom: 1rem;
    }
    .target-picker-roll-target .target-picker-portrait { width: 48px; height: 48px; margin: 0; flex-shrink: 0; }
    .target-picker-roll-target-name { font-weight: 700; font-size: 1.05rem; }
    .target-picker-roll-label { display: block; font-size: 0.85rem; color: #a0a0c0; margin-bottom: 0.4rem; }
    .target-picker-roll-label strong { color: #FFD700; }
    .target-picker-roll-input {
      width: 100%; box-sizing: border-box; background: #1e1e2e; border: 1px solid rgba(255,255,255,0.2);
      color: #e0e0e0; border-radius: 6px; padding: 0.65rem 0.7rem; font-size: 1.05rem; margin-bottom: 0.7rem;
    }
    .target-picker-roll-total { text-align: center; font-size: 0.9rem; color: #a0a0c0; margin-bottom: 1rem; min-height: 1.3em; }
    .target-picker-roll-total strong { color: #FFD700; font-size: 1.2rem; }
    .target-picker-roll-actions { display: flex; gap: 0.6rem; }
    .target-picker-roll-actions .combat-use-move-btn { flex: 1; }
    .target-picker-roll-back { background: rgba(255,255,255,0.1) !important; }
    .target-picker-hit-btn { background: linear-gradient(135deg, #4CAF50, #45A049) !important; }
    .target-picker-miss-btn { background: linear-gradient(135deg, #EE1515, #C91010) !important; }
    .target-picker-anim-media { width: 100%; max-height: 40vh; display: flex; align-items: center; justify-content: center; margin-bottom: 0.8rem; }
    .target-picker-anim-media:empty { display: none; }
    .target-picker-anim-media img, .target-picker-anim-media video { max-width: 100%; max-height: 40vh; border-radius: 12px; object-fit: contain; }
  `;
  document.head.appendChild(style);
}

let _overlay = null;
let _resolve = null;
let _attackModifier = 0;
let _damageModifier = 0;
let _speciesName = '';
let _selectedTargetId = null;
let _selectedTarget = null;
let _selectedTargetName = '';

function _ensureDom() {
  if (_overlay) return;
  _injectStyles();
  _overlay = document.createElement('div');
  _overlay.className = 'combat-popup-overlay';
  _overlay.id = 'targetPickerPopup';
  _overlay.style.display = 'none';
  _overlay.innerHTML = `
    <div class="combat-popup-content" style="max-width:420px;">
      <div class="combat-move-popup-header">
        <button id="targetPickerClose" class="combat-popup-close">×</button>
        <h2 id="targetPickerTitle">Choose a Target</h2>
      </div>
      <div class="combat-move-popup-body">
        <div id="targetPickerStep1">
          <div class="target-picker-grid" id="targetPickerGrid"></div>
          <button class="combat-use-move-btn target-picker-skip" id="targetPickerSkip">No Target (self-only move)</button>
        </div>
        <div id="targetPickerStep2" hidden>
          <div class="target-picker-roll-target" id="targetPickerRollTarget"></div>
          <label class="target-picker-roll-label" for="targetPickerAttackInput">Attack roll<span id="targetPickerAttackModifierNote"></span></label>
          <input type="number" id="targetPickerAttackInput" class="target-picker-roll-input" placeholder="Enter roll…">
          <div class="target-picker-roll-total" id="targetPickerAttackTotal"></div>
          <div class="target-picker-roll-actions">
            <button class="combat-use-move-btn target-picker-roll-back" id="targetPickerBack">← Back</button>
            <button class="combat-use-move-btn target-picker-miss-btn" id="targetPickerMiss">Attack Miss</button>
            <button class="combat-use-move-btn target-picker-hit-btn" id="targetPickerHit">Attack Hit</button>
          </div>
        </div>
        <div id="targetPickerStep3" hidden>
          <div class="target-picker-anim-media" id="targetPickerAnimMedia"></div>
          <div class="target-picker-roll-target" id="targetPickerDamageTarget"></div>
          <label class="target-picker-roll-label" for="targetPickerRollInput">Damage roll<span id="targetPickerModifierNote"></span></label>
          <input type="number" id="targetPickerRollInput" class="target-picker-roll-input" placeholder="Enter roll…">
          <div class="target-picker-roll-total" id="targetPickerRollTotal"></div>
          <div class="target-picker-roll-actions">
            <button class="combat-use-move-btn target-picker-roll-back" id="targetPickerBackToAttack">← Back</button>
            <button class="combat-use-move-btn" id="targetPickerConfirmRoll">Confirm Damage</button>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(_overlay);

  document.getElementById('targetPickerClose').addEventListener('click', () => _close(null));
  _overlay.addEventListener('click', (e) => { if (e.target === _overlay) _close(null); });
  document.getElementById('targetPickerSkip').addEventListener('click', () => _close(null));
  document.getElementById('targetPickerBack').addEventListener('click', _showStep1);
  document.getElementById('targetPickerBackToAttack').addEventListener('click', _showStep2);
  document.getElementById('targetPickerMiss').addEventListener('click', _confirmMiss);
  document.getElementById('targetPickerHit').addEventListener('click', _confirmHit);
  document.getElementById('targetPickerConfirmRoll').addEventListener('click', _confirmDamageRoll);
  document.getElementById('targetPickerAttackInput').addEventListener('input', _updateAttackTotal);
  document.getElementById('targetPickerAttackInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') _confirmHit();
  });
  document.getElementById('targetPickerRollInput').addEventListener('input', _updateRollTotal);
  document.getElementById('targetPickerRollInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') _confirmDamageRoll();
  });
}

function _close(result) {
  if (_overlay) _overlay.style.display = 'none';
  if (_resolve) { _resolve(result); _resolve = null; }
}

function _showStep1() {
  document.getElementById('targetPickerStep1').hidden = false;
  document.getElementById('targetPickerStep2').hidden = true;
  document.getElementById('targetPickerStep3').hidden = true;
  document.getElementById('targetPickerTitle').textContent = 'Choose a Target';
  _selectedTargetId = null;
  _selectedTarget = null;
}

/** Attack-roll step -- entered fresh from a target card, or returned to via
 * step 3's Back button (no args then, reusing the already-selected target). */
function _showStep2(p, name) {
  if (p) { _selectedTarget = p; _selectedTargetName = name; }
  document.getElementById('targetPickerStep1').hidden = true;
  document.getElementById('targetPickerStep2').hidden = false;
  document.getElementById('targetPickerStep3').hidden = true;
  document.getElementById('targetPickerTitle').textContent = 'Attack Roll';
  document.getElementById('targetPickerRollTarget').innerHTML = `
    <div class="target-picker-portrait">${spriteMediaHtml(_selectedTarget.image, _selectedTargetName)}</div>
    <div class="target-picker-roll-target-name">${_selectedTargetName}</div>`;
  document.getElementById('targetPickerAttackModifierNote').textContent =
    _attackModifier ? ` (${_attackModifier >= 0 ? '+' : ''}${_attackModifier} modifier added automatically)` : '';
  const input = document.getElementById('targetPickerAttackInput');
  input.value = '';
  _updateAttackTotal();
  setTimeout(() => input.focus(), 50);
}

function _updateAttackTotal() {
  const raw = parseInt(document.getElementById('targetPickerAttackInput').value, 10);
  const totalEl = document.getElementById('targetPickerAttackTotal');
  totalEl.innerHTML = Number.isNaN(raw) ? '' : `Total: <strong>${raw + _attackModifier}</strong>`;
}

function _confirmMiss() {
  _close({ targetId: _selectedTargetId, hit: false });
}

/** Attack Hit -- plays the attacker's battle animation (if one exists) right
 * here, then advances to the damage-roll step. This is the animation's
 * correct place in the flow: after a target is chosen and the attack is
 * confirmed to land, not the instant "Use Move" is clicked (see move-popup.js,
 * which skips its own earlier inline animation for exactly this case). */
async function _confirmHit() {
  await _playAnimation();
  _showStep3();
}

async function _playAnimation() {
  if (!_speciesName) return;
  const url = await getBattleAnimationUrl(_speciesName);
  if (!url) return;
  const media = document.getElementById('targetPickerAnimMedia');
  if (!media) return;
  const video = document.createElement('video');
  video.src = url;
  video.playsInline = true;
  video.disablePictureInPicture = true;
  media.innerHTML = '';
  media.appendChild(video);
  await new Promise((resolve) => {
    if (video.readyState >= 3) { resolve(); return; }
    video.addEventListener('canplay', resolve, { once: true });
    video.addEventListener('error', resolve, { once: true });
    setTimeout(resolve, 3000);
  });
  try { await video.play(); } catch { return; }
  await new Promise((resolve) => {
    video.addEventListener('ended', resolve, { once: true });
    video.addEventListener('error', resolve, { once: true });
    setTimeout(resolve, 8000);
  });
}

function _showStep3() {
  document.getElementById('targetPickerStep2').hidden = true;
  document.getElementById('targetPickerStep3').hidden = false;
  document.getElementById('targetPickerTitle').textContent = 'Damage Roll';
  document.getElementById('targetPickerDamageTarget').innerHTML = `
    <div class="target-picker-portrait">${spriteMediaHtml(_selectedTarget.image, _selectedTargetName)}</div>
    <div class="target-picker-roll-target-name">${_selectedTargetName}</div>`;
  document.getElementById('targetPickerModifierNote').textContent =
    _damageModifier ? ` (${_damageModifier >= 0 ? '+' : ''}${_damageModifier} modifier added automatically)` : '';
  const input = document.getElementById('targetPickerRollInput');
  input.value = '';
  _updateRollTotal();
  setTimeout(() => input.focus(), 50);
}

function _updateRollTotal() {
  const raw = parseInt(document.getElementById('targetPickerRollInput').value, 10);
  const totalEl = document.getElementById('targetPickerRollTotal');
  totalEl.innerHTML = Number.isNaN(raw) ? '' : `Total: <strong>${raw + _damageModifier}</strong>`;
}

function _confirmDamageRoll() {
  const raw = parseInt(document.getElementById('targetPickerRollInput').value, 10);
  if (Number.isNaN(raw)) return;
  _close({ targetId: _selectedTargetId, hit: true, rawRoll: raw });
}

function _cardHtml(p) {
  const name = visibleToViewer(p, 'name') ? p.name : '???';
  const hpPct = p.maxHP > 0 ? Math.max(0, Math.min(100, (p.currentHP / p.maxHP) * 100)) : 0;
  const vpPct = p.maxVP > 0 ? Math.max(0, Math.min(100, (p.currentVP / p.maxVP) * 100)) : 0;
  return `
    <button type="button" class="target-picker-card" data-target-id="${p.id}">
      <div class="target-picker-portrait">${spriteMediaHtml(p.image, name)}</div>
      <div class="target-picker-name">${name}</div>
      ${visibleToViewer(p, 'hp') ? `<div class="target-picker-bar hp"><div class="target-picker-bar-fill" style="width:${hpPct}%"></div></div>` : ''}
      ${visibleToViewer(p, 'vp') ? `<div class="target-picker-bar vp"><div class="target-picker-bar-fill" style="width:${vpPct}%"></div></div>` : ''}
    </button>`;
}

/**
 * Shows the combined target/attack-roll/damage-roll popup: pick who it hits,
 * then enter an attack roll (modifier added automatically, shown live) and
 * declare Attack Hit or Attack Miss yourself -- same as this game's other
 * rolls, the app shows the total but a human compares it to the target's AC
 * and decides, it doesn't auto-resolve hit/miss. A Miss resolves immediately
 * (the move's VP cost was already spent before this popup ever opened, so
 * there's nothing left to do). A Hit plays the attacker's battle animation
 * (if any) and moves on to a damage roll, which resolves the promise once
 * confirmed. Resolves to {targetId, hit:false}, {targetId, hit:true,
 * rawRoll}, or null if the player picked "No Target" / closed the popup /
 * there's no active session to target into. Safe to await unconditionally --
 * it resolves to null with no popup shown when there's nothing to target.
 *
 * The attacker is never offered as a target card -- the "No Target
 * (self-only move)" button already covers "this doesn't hit anyone else",
 * so a separate self-card would just be the same choice twice.
 */
export async function pickTarget(attackerId, { attackModifier = 0, damageModifier = 0, speciesName = '' } = {}) {
  const result = await CombatAPI.getState();
  const session = result.status === 'success' ? result.data : null;
  if (!session || !session.active) return null;

  const participants = Object.values(session.participants).filter(p => p.id !== attackerId);
  if (!participants.length) return null;

  _ensureDom();
  _attackModifier = attackModifier;
  _damageModifier = damageModifier;
  _speciesName = speciesName;
  document.getElementById('targetPickerAnimMedia').innerHTML = '';
  _showStep1();
  const grid = document.getElementById('targetPickerGrid');
  grid.innerHTML = participants.map(p => _cardHtml(p)).join('');
  grid.querySelectorAll('[data-target-id]').forEach(card => {
    card.addEventListener('click', () => {
      const p = session.participants[card.dataset.targetId];
      _selectedTargetId = card.dataset.targetId;
      _showStep2(p, visibleToViewer(p, 'name') ? p.name : '???');
    });
  });

  _overlay.style.display = 'flex';
  return new Promise((resolve) => { _resolve = resolve; });
}
