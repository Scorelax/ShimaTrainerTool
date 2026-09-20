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
import { saveModifierFor, saveRollContext, rollModeText } from './move-effects.js';

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
    .save-picker-suggested { outline: 3px solid #FFD700; outline-offset: 2px; }
    .save-picker-roll-notes { font-size: 0.82rem; margin-bottom: 0.8rem; line-height: 1.35; }
    .save-picker-roll-notes:empty { display: none; }
    .save-picker-roll-notes .mode { font-weight: 800; }
    .save-picker-roll-notes .mode.advantage { color: #2ecc71; }
    .save-picker-roll-notes .mode.disadvantage { color: #e74c3c; }
    .save-picker-roll-notes .note { color: #a0a0c0; }
  `;
  document.head.appendChild(style);
}

let _overlay = null;
let _resolve = null;
let _saveAbility = null;   // "STR".."CHA" when the caller knows which save this is (drives the auto modifier)
let _saveModifier = null;  // the target's save modifier for that ability, null when their sheet has no data
let _moveUser = null;      // the participant whose move this is (their "saves against its moves" statuses apply)
let _saveCtx = null;       // live-status modifiers for the selected target's save (see move-effects.js's saveRollContext)
let _pendingSave = null;   // {saveRoll, saveTotal, failBy} captured when Save Success/Fail is clicked
let _dc = 0;
let _manualDc = false; // true when the DC isn't known ahead of time -- the human types it in (see resolveReactiveSave's fallback)
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
          <div class="save-picker-dc-value" id="savePickerDcDisplay">Move DC: <strong id="savePickerDcValue"></strong></div>
          <div id="savePickerDcInputWrap" hidden>
            <label class="save-picker-roll-label" for="savePickerDcInput">Their Move DC (ask the table)</label>
            <input type="number" id="savePickerDcInput" class="save-picker-roll-input" placeholder="Enter DC…">
          </div>
          <div class="save-picker-roll-notes" id="savePickerRollNotes"></div>
          <label class="save-picker-roll-label" for="savePickerSaveInput" id="savePickerSaveLabel">Saving throw roll</label>
          <input type="number" id="savePickerSaveInput" class="save-picker-roll-input" placeholder="Enter their roll (optional)…">
          <div class="save-picker-roll-total" id="savePickerSaveTotal"></div>
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
  document.getElementById('savePickerDcInput').addEventListener('input', _updateManualDcButtons);
  document.getElementById('savePickerDcInput').addEventListener('input', _updateSaveTotal);
  document.getElementById('savePickerSaveInput').addEventListener('input', _updateSaveTotal);
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
  _saveCtx = saveRollContext(_selectedTarget, _moveUser, _saveAbility);
  const baseModifier = saveModifierFor(_selectedTarget, _saveAbility);
  // Live changes only mean something on top of a known modifier; with no sheet data the human types the total.
  _saveModifier = baseModifier === null ? null : baseModifier + _saveCtx.modifierDelta;
  const modeText = rollModeText(_saveCtx.mode);
  document.getElementById('savePickerRollNotes').innerHTML =
    `${modeText ? `<div class="mode ${_saveCtx.mode}">${modeText}</div>` : ''}${_saveCtx.notes.map(n => `<div class="note">${n}</div>`).join('')}`;
  const abilityText = _saveAbility ? ` (${_saveAbility})` : '';
  const modText = _saveModifier === null
    ? (_saveAbility ? ' — no ability data, enter the total' : '')
    : ` (${_saveModifier >= 0 ? '+' : ''}${_saveModifier} modifier added automatically)`;
  document.getElementById('savePickerSaveLabel').textContent = `Saving throw roll${abilityText}${modText}`;
  document.getElementById('savePickerSaveInput').value = '';
  _updateSaveTotal();
  document.getElementById('savePickerDcTarget').innerHTML = `
    <div class="save-picker-portrait">${spriteMediaHtml(_selectedTarget.image, _selectedTargetName)}</div>
    <div class="save-picker-dc-target-name">${_selectedTargetName}</div>`;
  document.getElementById('savePickerDcDisplay').hidden = _manualDc;
  document.getElementById('savePickerDcInputWrap').hidden = !_manualDc;
  if (_manualDc) {
    const input = document.getElementById('savePickerDcInput');
    input.value = '';
    setTimeout(() => input.focus(), 50);
  } else {
    document.getElementById('savePickerDcValue').textContent = _dc;
    document.getElementById('savePickerPass').disabled = false;
    document.getElementById('savePickerFail').disabled = false;
  }
  _updateManualDcButtons();
}

/** In manual-DC mode, Pass/Fail stay disabled until a DC has actually been
 * typed in -- there's no sensible default to fall back to (unlike every
 * other roll in this app, this one has no auto-computed number behind it
 * at all until the human supplies one). No-op (buttons just stay enabled)
 * when not in manual mode. */
function _updateManualDcButtons() {
  if (!_manualDc) return;
  const dc = parseInt(document.getElementById('savePickerDcInput').value, 10);
  const disabled = Number.isNaN(dc);
  document.getElementById('savePickerPass').disabled = disabled;
  document.getElementById('savePickerFail').disabled = disabled;
}

function _currentDc() {
  if (!_manualDc) return _dc;
  return parseInt(document.getElementById('savePickerDcInput').value, 10) || 0;
}

/** The typed save roll (null when none was entered). */
function _currentSaveRoll() {
  const raw = parseInt(document.getElementById('savePickerSaveInput').value, 10);
  return Number.isNaN(raw) ? null : raw;
}

/** Live "Total X vs DC Y -- fails by Z" line, and an outline on whichever of
 * Save Success/Save Fail the roll says. Only a suggestion: a human still
 * clicks one (advantage, a reroll, a circumstance the sheet doesn't know). */
function _updateSaveTotal() {
  const totalEl = document.getElementById('savePickerSaveTotal');
  const passBtn = document.getElementById('savePickerPass');
  const failBtn = document.getElementById('savePickerFail');
  passBtn.classList.remove('save-picker-suggested');
  failBtn.classList.remove('save-picker-suggested');
  const raw = _currentSaveRoll();
  const dc = _currentDc();
  if (raw === null) { totalEl.innerHTML = ''; return; }
  const total = raw + (_saveModifier || 0);
  if (!dc) { totalEl.innerHTML = `Total: <strong>${total}</strong>`; return; }
  const passed = total >= dc;
  (passed ? passBtn : failBtn).classList.add('save-picker-suggested');
  totalEl.innerHTML = `Total: <strong>${total}</strong> vs DC ${dc} — ${passed ? 'passes' : `fails by ${dc - total}`}`;
}

/** {saveRoll, saveTotal, failBy} for the current inputs. failBy is how far the
 * total fell short of the DC (0 if a human declared a fail the roll doesn't
 * show), or null on a pass / when no roll was entered. */
function _captureSave(passed) {
  const raw = _currentSaveRoll();
  if (raw === null) return { saveRoll: null, saveTotal: null, failBy: null };
  const total = raw + (_saveModifier || 0);
  const dc = _currentDc();
  return { saveRoll: raw, saveTotal: total, failBy: passed || !dc ? null : Math.max(0, dc - total) };
}

/** Uses up every "next roll" status that shaped this save -- called once Success/Fail is chosen. */
function _consume() {
  for (const c of _saveCtx?.consume || []) CombatAPI.useStatus(c.holderId, c.statusId).catch(() => {});
}

function _confirmPass() {
  _consume();
  _close({ targetId: _selectedTargetId, passed: true, dc: _currentDc(), rollMode: _saveCtx?.mode || 'normal', ..._captureSave(true) });
}

/** Save Fail -- plays the attacker's battle animation (if one exists), then
 * either asks for a damage roll (moves with a damage component) or resolves
 * immediately (pure status/effect moves -- see combat-wip.js's
 * _handleSaveTriggered for how those get logged instead). */
async function _confirmFail() {
  _pendingSave = { ..._captureSave(false), dc: _currentDc(), rollMode: _saveCtx?.mode || 'normal' }; // read before the animation / damage step
  _consume();
  await _playAnimation();
  if (_hasDamage) {
    _showStep3();
  } else {
    _close({ targetId: _selectedTargetId, passed: false, ..._pendingSave });
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
  _close({ targetId: _selectedTargetId, passed: false, rawRoll: raw, ...(_pendingSave || {}) });
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
 * The "already-have-a-target" counterpart to pickSaveTarget -- skips
 * straight to the DC/Pass-Fail step, no target grid, no Back button. Two
 * callers, two different needs: combat-wip.js's _handleSecondarySave (a
 * move that already resolved an attack roll and only THEN triggers a save
 * for a secondary consequence, e.g. Temporal Fang -- never has a damage
 * component here, the primary attack already applied that) and
 * _handleMultiHitAoe (one target of an AoE save move like Judgment, which
 * DOES still need its own damage roll on a Fail -- hence hasDamage/
 * damageModifier/speciesName being plumbed through same as pickSaveTarget
 * itself). Resolves to {targetId, passed:true}, {targetId, passed:false}
 * (no damage component), or {targetId, passed:false, rawRoll} (has one) --
 * each also carrying dc and, when a save roll was typed in, {saveRoll,
 * saveTotal, failBy} (failBy null on a pass). `ability` (STR..CHA) makes the
 * target's save modifier auto-add; `title` replaces the popup heading;
 * `moveUser` is the participant whose move this is, so their "saves against its
 * moves" statuses apply (pickSaveTarget reads it from the session). The popup
 * banners live-status effects on the save (advantage/disadvantage, ability and
 * save bonuses), folds the numeric ones into the total, uses up "next roll"
 * effects once Success/Fail is chosen, and reports the net rollMode.
 */
export async function confirmSecondarySave(target, targetName, { dc = 0, hasDamage = false, damageModifier = 0, speciesName = '', ability = null, title = 'Secondary Saving Throw', moveUser = null } = {}) {
  _ensureDom();
  _moveUser = moveUser;
  _dc = dc;
  _manualDc = false;
  _hasDamage = hasDamage;
  _damageModifier = damageModifier;
  _speciesName = speciesName;
  _saveAbility = ability;
  _pendingSave = null;
  _selectedTargetId = target.id;
  _showStep2(target, targetName);
  document.getElementById('savePickerBack').style.display = 'none';
  document.getElementById('savePickerTitle').textContent = title;
  _overlay.style.display = 'flex';
  return new Promise((resolve) => { _resolve = resolve; });
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
export async function pickSaveTarget(casterId, { dc = 0, damageModifier = 0, speciesName = '', hasDamage = false, ability = null } = {}) {
  const result = await CombatAPI.getState();
  const session = result.status === 'success' ? result.data : null;
  if (!session || !session.active) return null;

  const participants = Object.values(session.participants).filter(p => p.id !== casterId);
  if (!participants.length) return null;

  _ensureDom();
  _moveUser = session.participants[casterId] || null;
  _dc = dc;
  _manualDc = false;
  _damageModifier = damageModifier;
  _speciesName = speciesName;
  _hasDamage = hasDamage;
  _saveAbility = ability;
  _pendingSave = null;
  document.getElementById('savePickerAnimMedia').innerHTML = '';
  document.getElementById('savePickerBack').style.display = '';
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

/**
 * Reactive-save fallback for when auto-detect can't find/trust a recent
 * attacker (see combat-wip.js's _handleReactiveSave) -- pick who attacked
 * you from the full participant list, then type in their Move DC yourself
 * (nothing computed here; ask the table). No damage-roll follow-up, same
 * reasoning as confirmSecondarySave -- this is always the reactor's own
 * save against a consequence that already happened, never a fresh attack.
 * Resolves to {targetId, passed, dc} (dc is whatever was typed in), or
 * null if closed/no one to pick.
 */
export async function pickManualSaveTarget(casterId, { speciesName = '' } = {}) {
  const result = await CombatAPI.getState();
  const session = result.status === 'success' ? result.data : null;
  if (!session || !session.active) return null;

  const participants = Object.values(session.participants).filter(p => p.id !== casterId);
  if (!participants.length) return null;

  _ensureDom();
  _dc = 0;
  _manualDc = true;
  _hasDamage = false;
  _saveAbility = null;
  _moveUser = null;
  _pendingSave = null;
  _speciesName = speciesName;
  document.getElementById('savePickerAnimMedia').innerHTML = '';
  document.getElementById('savePickerBack').style.display = '';
  _showStep1();
  document.getElementById('savePickerTitle').textContent = 'Who Attacked You?';
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
