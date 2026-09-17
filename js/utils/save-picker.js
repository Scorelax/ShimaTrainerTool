// Reusable "pick a target, show the Move DC, declare Save Success/Fail"
// popup for moves tagged TRIGGER SAVING THROW in the user's own move
// categorization (see combat.js's moveCategoriesFor). Mirrors
// target-picker.js's structure closely (same base .combat-popup-* styles,
// same self-contained-styles approach, same "the app shows the numbers, a
// human compares them and declares the outcome" philosophy already used for
// Attack Hit/Miss) but for a fundamentally different roll: here the TARGET
// rolls against the ATTACKER's Move DC, not the attacker rolling against the
// target's AC, so there's no attack-roll step at all.
//
// Deliberately single-target only for now -- of the moves categorized so
// far, the overwhelming majority (13 of 15 in Bug/Cosmic/Dark) are
// single-target saves; the couple of AoE saves (e.g. Judgment) can still be
// run through this once per target, just not in one pass. Extending this to
// a real "everyone in range" flow is future work, not a blocker for the
// single-target case working now.
import { CombatAPI } from '../api.js';
import { spriteMediaHtml } from './sprite-media.js';
import { visibleToViewer } from './combat-visibility.js';
import { getBattleAnimationUrl } from './battle-animation.js';

function _injectStyles() {
  if (document.getElementById('save-picker-styles')) return;
  const style = document.createElement('style');
  style.id = 'save-picker-styles';
  style.textContent = `
    .combat-popup-overlay { position: fixed; top:0; left:0; width:100%; height:100%; background: rgba(0,0,0,0.75); z-index: 1000; justify-content: center; align-items: center; backdrop-filter: blur(3px); }
    .combat-popup-content { background: #1e1e34; border: 1px solid rgba(255,255,255,0.12); border-radius: 16px; max-width: 560px; width: 92%; max-height: 85vh; overflow-y: auto; position: relative; box-shadow: 0 10px 40px rgba(0,0,0,0.6); color: #e0e0e0; }
    .combat-move-popup-header { padding: 1.1rem 1.2rem; border-radius: 16px 16px 0 0; border-bottom: 2px solid rgba(0,0,0,0.3); display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; position: relative; background: rgba(255,255,255,0.05); }
    .combat-move-popup-header h2 { margin: 0; font-size: 1.4rem; font-weight: 900; text-transform: uppercase; }
    .combat-popup-close { position: absolute; top: 0.8rem; right: 0.8rem; background: rgba(0,0,0,0.3); border: none; border-radius: 50%; width: 32px; height: 32px; font-size: 1.2rem; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; color: inherit; }
    .combat-move-popup-body { padding: 1rem 1.2rem; }
    .combat-use-move-btn { width: 100%; padding: 0.75rem; background: linear-gradient(135deg, #4CAF50, #45A049); color: #fff; border: none; border-radius: 8px; font-size: 1rem; font-weight: 700; cursor: pointer; }
    .save-picker-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 0.6rem; margin-top: 0.5rem; }
    .save-picker-card {
      background: rgba(255,255,255,0.06); border: 2px solid transparent; border-radius: 10px;
      padding: 0.6rem; text-align: center; cursor: pointer; color: inherit; font: inherit;
    }
    .save-picker-card:hover, .save-picker-card:focus-visible { border-color: #FFD700; background: rgba(255,215,0,0.08); }
    .save-picker-portrait { width: 56px; height: 56px; margin: 0 auto 0.3rem; }
    .save-picker-portrait img, .save-picker-portrait video { width: 100%; height: 100%; object-fit: contain; }
    .save-picker-name { font-size: 0.82rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .save-picker-empty { text-align: center; color: #a0a0c0; padding: 1rem; }
    .save-picker-skip { width: 100%; margin-top: 0.9rem; }
    .save-picker-dc-target {
      display: flex; align-items: center; gap: 0.7rem; background: rgba(255,255,255,0.05);
      border-radius: 10px; padding: 0.6rem; margin-bottom: 1rem;
    }
    .save-picker-dc-target .save-picker-portrait { width: 48px; height: 48px; margin: 0; flex-shrink: 0; }
    .save-picker-dc-target-name { font-weight: 700; font-size: 1.05rem; }
    .save-picker-dc-value { text-align: center; font-size: 1rem; margin-bottom: 1rem; }
    .save-picker-dc-value strong { color: #FFD700; font-size: 1.4rem; }
    .save-picker-outcome-actions { display: flex; gap: 0.6rem; }
    .save-picker-outcome-actions .combat-use-move-btn { flex: 1; }
    .save-picker-back { background: rgba(255,255,255,0.1) !important; }
    .save-picker-pass-btn { background: linear-gradient(135deg, #4CAF50, #45A049) !important; }
    .save-picker-fail-btn { background: linear-gradient(135deg, #EE1515, #C91010) !important; }
    .save-picker-anim-media { width: 100%; max-height: 40vh; display: flex; align-items: center; justify-content: center; margin-bottom: 0.8rem; }
    .save-picker-anim-media:empty { display: none; }
    .save-picker-anim-media img, .save-picker-anim-media video { max-width: 100%; max-height: 40vh; border-radius: 12px; object-fit: contain; }
    .save-picker-roll-label { display: block; font-size: 0.85rem; color: #a0a0c0; margin-bottom: 0.4rem; }
    .save-picker-roll-label strong { color: #FFD700; }
    .save-picker-roll-input {
      width: 100%; box-sizing: border-box; background: #1e1e2e; border: 1px solid rgba(255,255,255,0.2);
      color: #e0e0e0; border-radius: 6px; padding: 0.65rem 0.7rem; font-size: 1.05rem; margin-bottom: 0.7rem;
    }
    .save-picker-roll-total { text-align: center; font-size: 0.9rem; color: #a0a0c0; margin-bottom: 1rem; min-height: 1.3em; }
    .save-picker-roll-total strong { color: #FFD700; font-size: 1.2rem; }
  `;
  document.head.appendChild(style);
}

let _overlay = null;
let _resolve = null;
let _dc = 0;
let _damageModifier = 0;
let _speciesName = '';
let _hasDamage = false;
let _selectedTargetId = null;
let _selectedTarget = null;
let _selectedTargetName = '';

function _ensureDom() {
  if (_overlay) return;
  _injectStyles();
  _overlay = document.createElement('div');
  _overlay.className = 'combat-popup-overlay';
  _overlay.id = 'savePickerPopup';
  _overlay.style.display = 'none';
  _overlay.innerHTML = `
    <div class="combat-popup-content" style="max-width:420px;">
      <div class="combat-move-popup-header">
        <button id="savePickerClose" class="combat-popup-close">×</button>
        <h2 id="savePickerTitle">Choose a Target</h2>
      </div>
      <div class="combat-move-popup-body">
        <div id="savePickerStep1">
          <div class="save-picker-grid" id="savePickerGrid"></div>
          <button class="combat-use-move-btn save-picker-skip" id="savePickerSkip">No Target (self-only move)</button>
        </div>
        <div id="savePickerStep2" hidden>
          <div class="save-picker-dc-target" id="savePickerDcTarget"></div>
          <div class="save-picker-dc-value">Move DC: <strong id="savePickerDcValue"></strong></div>
          <div class="save-picker-outcome-actions">
            <button class="combat-use-move-btn save-picker-back" id="savePickerBack">← Back</button>
            <button class="combat-use-move-btn save-picker-pass-btn" id="savePickerPass">Save Success</button>
            <button class="combat-use-move-btn save-picker-fail-btn" id="savePickerFail">Save Fail</button>
          </div>
        </div>
        <div id="savePickerStep3" hidden>
          <div class="save-picker-anim-media" id="savePickerAnimMedia"></div>
          <div class="save-picker-dc-target" id="savePickerDamageTarget"></div>
          <label class="save-picker-roll-label" for="savePickerRollInput">Damage roll<span id="savePickerModifierNote"></span></label>
          <input type="number" id="savePickerRollInput" class="save-picker-roll-input" placeholder="Enter roll…">
          <div class="save-picker-roll-total" id="savePickerRollTotal"></div>
          <button class="combat-use-move-btn" id="savePickerConfirmRoll">Confirm Damage</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(_overlay);

  document.getElementById('savePickerClose').addEventListener('click', () => _close(null));
  _overlay.addEventListener('click', (e) => { if (e.target === _overlay) _close(null); });
  document.getElementById('savePickerSkip').addEventListener('click', () => _close(null));
  document.getElementById('savePickerBack').addEventListener('click', _showStep1);
  document.getElementById('savePickerPass').addEventListener('click', _confirmPass);
  document.getElementById('savePickerFail').addEventListener('click', _confirmFail);
  document.getElementById('savePickerConfirmRoll').addEventListener('click', _confirmDamageRoll);
  document.getElementById('savePickerRollInput').addEventListener('input', _updateRollTotal);
  document.getElementById('savePickerRollInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') _confirmDamageRoll();
  });
}

function _close(result) {
  if (_overlay) _overlay.style.display = 'none';
  if (_resolve) { _resolve(result); _resolve = null; }
}

function _showStep1() {
  document.getElementById('savePickerStep1').hidden = false;
  document.getElementById('savePickerStep2').hidden = true;
  document.getElementById('savePickerStep3').hidden = true;
  document.getElementById('savePickerTitle').textContent = 'Choose a Target';
  _selectedTargetId = null;
  _selectedTarget = null;
}

function _showStep2(p, name) {
  if (p) { _selectedTarget = p; _selectedTargetName = name; }
  document.getElementById('savePickerStep1').hidden = true;
  document.getElementById('savePickerStep2').hidden = false;
  document.getElementById('savePickerStep3').hidden = true;
  document.getElementById('savePickerTitle').textContent = 'Saving Throw';
  document.getElementById('savePickerDcTarget').innerHTML = `
    <div class="save-picker-portrait">${spriteMediaHtml(_selectedTarget.image, _selectedTargetName)}</div>
    <div class="save-picker-dc-target-name">${_selectedTargetName}</div>`;
  document.getElementById('savePickerDcValue').textContent = _dc;
}

function _confirmPass() {
  _close({ targetId: _selectedTargetId, passed: true });
}

/** Save Fail -- plays the attacker's battle animation (if one exists), then
 * either asks for a damage roll (moves with a damage component) or resolves
 * immediately (pure status/effect moves -- see combat-wip.js's
 * _handleSaveTriggered for how those get logged instead). */
async function _confirmFail() {
  await _playAnimation();
  if (_hasDamage) {
    _showStep3();
  } else {
    _close({ targetId: _selectedTargetId, passed: false });
  }
}

async function _playAnimation() {
  if (!_speciesName) return;
  const url = await getBattleAnimationUrl(_speciesName);
  if (!url) return;
  const media = document.getElementById('savePickerAnimMedia');
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
  document.getElementById('savePickerStep2').hidden = true;
  document.getElementById('savePickerStep3').hidden = false;
  document.getElementById('savePickerTitle').textContent = 'Damage Roll';
  document.getElementById('savePickerDamageTarget').innerHTML = `
    <div class="save-picker-portrait">${spriteMediaHtml(_selectedTarget.image, _selectedTargetName)}</div>
    <div class="save-picker-dc-target-name">${_selectedTargetName}</div>`;
  document.getElementById('savePickerModifierNote').textContent =
    _damageModifier ? ` (${_damageModifier >= 0 ? '+' : ''}${_damageModifier} modifier added automatically)` : '';
  const input = document.getElementById('savePickerRollInput');
  input.value = '';
  _updateRollTotal();
  setTimeout(() => input.focus(), 50);
}

function _updateRollTotal() {
  const raw = parseInt(document.getElementById('savePickerRollInput').value, 10);
  const totalEl = document.getElementById('savePickerRollTotal');
  totalEl.innerHTML = Number.isNaN(raw) ? '' : `Total: <strong>${raw + _damageModifier}</strong>`;
}

function _confirmDamageRoll() {
  const raw = parseInt(document.getElementById('savePickerRollInput').value, 10);
  if (Number.isNaN(raw)) return;
  _close({ targetId: _selectedTargetId, passed: false, rawRoll: raw });
}

function _cardHtml(p) {
  const name = visibleToViewer(p, 'name') ? p.name : '???';
  return `
    <button type="button" class="save-picker-card" data-target-id="${p.id}">
      <div class="save-picker-portrait">${spriteMediaHtml(p.image, name)}</div>
      <div class="save-picker-name">${name}</div>
    </button>`;
}

/**
 * Shows the target/DC/outcome popup for a save-triggered move: pick who has
 * to save, see the Move DC, and declare Save Success or Save Fail yourself
 * (same "app shows the number, a human compares it and declares the
 * outcome" pattern as the Attack Roll flow -- this app has no digital dice
 * and no way to know the target's own save modifier). On a Fail, the
 * attacker's battle animation plays and -- only for moves with an actual
 * damage component -- a damage roll follows. Resolves to
 * {targetId, passed:true}, {targetId, passed:false} (no damage component),
 * {targetId, passed:false, rawRoll} (has one), or null if closed/no target.
 */
export async function pickSaveTarget(casterId, { dc = 0, damageModifier = 0, speciesName = '', hasDamage = false } = {}) {
  const result = await CombatAPI.getState();
  const session = result.status === 'success' ? result.data : null;
  if (!session || !session.active) return null;

  const participants = Object.values(session.participants).filter(p => p.id !== casterId);
  if (!participants.length) return null;

  _ensureDom();
  _dc = dc;
  _damageModifier = damageModifier;
  _speciesName = speciesName;
  _hasDamage = hasDamage;
  document.getElementById('savePickerAnimMedia').innerHTML = '';
  _showStep1();
  const grid = document.getElementById('savePickerGrid');
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
