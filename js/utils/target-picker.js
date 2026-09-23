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
import { attackRollContext, rollModeText, diceBonusOptionsFor } from './move-effects.js';
import { waitForReactionWindow } from './reaction-window.js';

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
    .target-picker-roll-notes { font-size: 0.82rem; margin-bottom: 0.8rem; line-height: 1.35; }
    .target-picker-roll-notes:empty { display: none; }
    .target-picker-roll-notes .mode { font-weight: 800; }
    .target-picker-roll-notes .mode.advantage { color: #2ecc71; }
    .target-picker-roll-notes .mode.disadvantage { color: #e74c3c; }
    .target-picker-roll-notes .note { color: #a0a0c0; }
    .target-picker-anim-media { width: 100%; max-height: 40vh; display: flex; align-items: center; justify-content: center; margin-bottom: 0.8rem; }
    .target-picker-anim-media:empty { display: none; }
    .target-picker-anim-media img, .target-picker-anim-media video { max-width: 100%; max-height: 40vh; border-radius: 12px; object-fit: contain; }
    .target-picker-reaction-wait-text { text-align: center; font-size: 1rem; color: #e0e0e0; padding: 1.5rem 0 0.5rem; }
    .target-picker-reaction-wait-timer { text-align: center; font-size: 0.85rem; color: #a0a0c0; padding-bottom: 1.5rem; }
    .target-picker-dice-row { display: flex; flex-direction: column; gap: 0.4rem; margin-bottom: 0.7rem; }
    .target-picker-dice-row:empty { display: none; margin: 0; }
    .target-picker-dice-btn { background: rgba(255,215,0,0.14) !important; border: 1px solid rgba(255,215,0,0.5) !important; color: #FFD700 !important; font-size: 0.85rem !important; padding: 0.5rem !important; }
    .target-picker-dice-input-row { display: flex; gap: 0.4rem; }
    .target-picker-dice-input-row input { flex: 1; box-sizing: border-box; background: #1e1e2e; border: 1px solid rgba(255,255,255,0.2); color: #e0e0e0; border-radius: 6px; padding: 0.5rem 0.6rem; font-size: 0.95rem; }
    .target-picker-dice-input-row button { flex-shrink: 0; padding: 0 0.9rem; }
    .target-picker-dice-used { font-size: 0.82rem; color: #2ecc71; padding: 0.5rem; text-align: center; background: rgba(46,204,113,0.1); border-radius: 8px; }
  `;
  document.head.appendChild(style);
}

let _overlay = null;
let _resolve = null;
let _attackModifier = 0;
let _damageModifier = 0;
let _speciesName = '';
// The attacking move's own name, needed for the reaction window ("Noble Roar --
// does anyone want to react to being targeted by this?") -- combat-wip.js's
// callers already know it, target-picker.js itself doesn't otherwise need it.
let _moveName = '';
let _selectedTargetId = null;
let _selectedTarget = null;
let _selectedTargetName = '';
// True for moves tagged guaranteed_hit (see combat-wip.js): the attack-roll
// step is skipped entirely -- picking a target goes straight to the damage
// roll, since there's nothing to roll against AC.
let _guaranteedHit = false;
// The natural d20 typed into the Attack Roll step, captured when the attack is
// resolved (see _confirmAttack) and handed back with the result so the caller
// can tell which natural-roll / crit effects triggered (null on a guaranteed
// hit: nothing rolled).
let _attackRoll = null;
// Live statuses that change this roll (see move-effects.js's attackRollContext): the attacker
// and the chosen target's participant records, and what they add up to for the selected target.
let _attacker = null;
let _atkCtx = null;
// Dice-based bonuses (Sharpen, Growth, Helping Hand -- see diceBonusOptionsFor) the
// attacker chose to spend on THIS attack roll: the running total they've added in,
// and which of those statuses still need use-status called once the roll is
// confirmed (only the ones with a `uses` end -- see _onDiceBonusSubmit).
let _diceBonusExtra = 0;
let _diceBonusConsume = [];

/** The attack modifier actually in force: the move's own plus any live attack-roll status
 * plus any dice bonus the player chose to add in on this roll. */
function _effectiveAttackMod() { return _attackModifier + (_atkCtx?.attackBonus || 0) + _diceBonusExtra; }

/** Renders the "Add <Move> (+1d4)" button row for the attacker's dice-based bonuses
 * eligible for an attack roll (empty/hidden when there are none). Clicking a button
 * swaps it for an inline "type what you rolled" input (see _onDiceBonusSubmit) rather
 * than a native prompt(), matching every other roll in this popup. */
function _renderDiceRow() {
  const row = document.getElementById('targetPickerDiceRow');
  const options = _guaranteedHit ? [] : diceBonusOptionsFor(_attacker, 'attack_rolls');
  row.innerHTML = options.map(o => `
    <button type="button" class="combat-use-move-btn target-picker-dice-btn" data-status-id="${o.statusId}" data-dice="${o.dice}" data-move="${o.moveName}" data-consumable="${o.consumable}">
      Add ${o.moveName} (+${o.dice})
    </button>`).join('');
  row.querySelectorAll('[data-status-id]').forEach(btn => {
    btn.addEventListener('click', () => _openDiceBonusInput(btn));
  });
}

/** Swaps a dice-bonus button for an inline number input + confirm, matching the
 * roll-input styling already used throughout this popup. */
function _openDiceBonusInput(btn) {
  const { statusId, dice, move, consumable } = btn.dataset;
  const wrap = document.createElement('div');
  wrap.className = 'target-picker-dice-input-row';
  wrap.innerHTML = `<input type="number" placeholder="Rolled ${dice}…"><button type="button" class="combat-use-move-btn">Add</button>`;
  btn.replaceWith(wrap);
  const input = wrap.querySelector('input');
  const submit = () => _onDiceBonusSubmit(wrap, input, { statusId, dice, move, consumable: consumable === 'true' });
  wrap.querySelector('button').addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  input.focus();
}

/** Folds a confirmed dice-bonus roll into the attack total, queues its status for
 * use-status IF it's a one-time bonus (Helping Hand), and replaces the input with a
 * plain "used" line -- staying-available bonuses (Sharpen/Growth) just show what was
 * added, still there next time this row is rendered fresh (a later attack roll). */
function _onDiceBonusSubmit(wrap, input, { statusId, dice, move, consumable }) {
  const raw = parseInt(input.value, 10);
  if (Number.isNaN(raw)) return;
  _diceBonusExtra += raw;
  if (consumable) _diceBonusConsume.push({ holderId: _attacker?.id, statusId });
  const used = document.createElement('div');
  used.className = 'target-picker-dice-used';
  used.textContent = `${move}: +${raw} (rolled ${dice}) added`;
  wrap.replaceWith(used);
  _updateAttackTotal();
}

/** Uses up every "next attack/roll" status that shaped this roll, plus any dice
 * bonus the player chose to spend on it (see _onDiceBonusSubmit) -- called once
 * the roll is confirmed. */
function _consume(ctx) {
  for (const c of ctx?.consume || []) CombatAPI.useStatus(c.holderId, c.statusId).catch(() => {});
  for (const c of _diceBonusConsume) CombatAPI.useStatus(c.holderId, c.statusId).catch(() => {});
  _diceBonusConsume = [];
}

function _notesHtml(ctx) {
  if (!ctx) return '';
  const mode = rollModeText(ctx.mode);
  const lines = ctx.notes.map(n => `<div class="note">${n}</div>`).join('');
  return `${mode ? `<div class="mode ${ctx.mode}">${mode}</div>` : ''}${lines}`;
}

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
        <div id="targetPickerReactionWait" hidden>
          <div class="target-picker-reaction-wait-text" id="targetPickerReactionWaitText">Waiting for possible reactions…</div>
          <div class="target-picker-reaction-wait-timer" id="targetPickerReactionWaitTimer"></div>
        </div>
        <div id="targetPickerStep2" hidden>
          <div class="target-picker-roll-target" id="targetPickerRollTarget"></div>
          <div class="target-picker-roll-notes" id="targetPickerRollNotes"></div>
          <div class="target-picker-dice-row" id="targetPickerDiceRow"></div>
          <label class="target-picker-roll-label" for="targetPickerAttackInput">Attack roll<span id="targetPickerAttackModifierNote"></span></label>
          <input type="number" id="targetPickerAttackInput" class="target-picker-roll-input" placeholder="Enter roll…">
          <div class="target-picker-roll-total" id="targetPickerAttackTotal"></div>
          <div class="target-picker-roll-actions">
            <button class="combat-use-move-btn target-picker-roll-back" id="targetPickerBack">← Back</button>
            <!-- Only shown when the target's AC isn't known at all (a DM's freeform PvE
                 enemy) -- see _showStep2's own comment: the app resolves the attack itself
                 whenever it can, this is the fallback for when it genuinely can't. -->
            <button class="combat-use-move-btn target-picker-miss-btn" id="targetPickerMiss" hidden>Attack Miss</button>
            <button class="combat-use-move-btn target-picker-hit-btn" id="targetPickerHit">Attack</button>
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
  document.getElementById('targetPickerBackToAttack').addEventListener('click', _backFromDamage);
  document.getElementById('targetPickerMiss').addEventListener('click', _confirmMiss);
  document.getElementById('targetPickerHit').addEventListener('click', _confirmAttack);
  document.getElementById('targetPickerConfirmRoll').addEventListener('click', _confirmDamageRoll);
  document.getElementById('targetPickerAttackInput').addEventListener('input', _updateAttackTotal);
  document.getElementById('targetPickerAttackInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') _confirmAttack();
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
  document.getElementById('targetPickerReactionWait').hidden = true;
  document.getElementById('targetPickerStep2').hidden = true;
  document.getElementById('targetPickerStep3').hidden = true;
  document.getElementById('targetPickerTitle').textContent = 'Choose a Target';
  _selectedTargetId = null;
  _selectedTarget = null;
}

/** Between picking a target and showing the Attack Roll step (or, on a
 * guaranteed hit, the damage roll directly): opens a reaction window for the
 * 'targeted' family (see reaction-window.js/routes_combat.py's own module
 * docstring) anchored on the target just picked, and waits it out before
 * continuing -- an opponent reacting to being targeted (Noble Roar, Withdraw,
 * ...) needs to land BEFORE the attack roll is entered, since it changes the
 * numbers that roll gets compared against. No-ops (proceeds immediately)
 * when nobody's eligible -- the overwhelming majority of moves, so this
 * almost never actually shows anything.
 *
 * A `block_attack` effect (Protect, King's Shield, Shield Guardian, Quick
 * Guard -- see move-effects-schema.md's own section) can end the whole
 * attack right here: waitForReactionWindow resolves {blocked: true,
 * blockerName} when the reactor used one, and this closes the popup
 * immediately instead of proceeding to the roll -- there's no attack roll,
 * no damage, nothing left for _resolveOneHit to do beyond logging it. Only
 * wired here (pickTarget's own fresh-target flow), not pickTargetAgain's
 * "hit again?" continuation -- a multi-hit move's later hits against the
 * same target already had their one reaction opportunity on the first. */
async function _afterTargetSelected(p, name) {
  document.getElementById('targetPickerStep1').hidden = true;
  document.getElementById('targetPickerReactionWait').hidden = false;
  document.getElementById('targetPickerTitle').textContent = 'Reaction Window';
  document.getElementById('targetPickerReactionWaitText').textContent = 'Waiting for possible reactions…';
  document.getElementById('targetPickerReactionWaitTimer').textContent = '';
  const reaction = await waitForReactionWindow('targeted', p.id, _attacker?.id, _moveName, (status) => {
    if (!status.opened) return;
    const secs = Math.ceil(status.msLeft / 1000);
    document.getElementById('targetPickerReactionWaitTimer').textContent = `${secs}s`;
  });
  document.getElementById('targetPickerReactionWait').hidden = true;
  if (reaction?.blocked) {
    _close({ targetId: p.id, blocked: true, blockerName: reaction.blockerName });
    return;
  }
  if (_guaranteedHit) _autoHit(p, name);
  else _showStep2(p, name);
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
  _atkCtx = _guaranteedHit ? null : attackRollContext(_attacker, _selectedTarget);
  document.getElementById('targetPickerRollNotes').innerHTML = _notesHtml(_atkCtx);
  _diceBonusExtra = 0;
  _diceBonusConsume = [];
  _renderDiceRow();
  const mod = _effectiveAttackMod();
  document.getElementById('targetPickerAttackModifierNote').textContent =
    mod ? ` (${mod >= 0 ? '+' : ''}${mod} modifier added automatically)` : '';
  // The app resolves the attack itself whenever the target's AC is on record (every
  // PvP participant, and any PvE stat-blocked one -- see routes_combat.py's own "no
  // reason to hide a PvP opponent's stats from the app itself" stance) -- the human
  // enters their roll, clicks Attack, and is told hit or miss; the AC number itself is
  // never shown (see _confirmAttack). Only a DM's freeform enemy with no AC on file at
  // all falls back to the human declaring it themselves, same two-button choice as
  // before. There's no reaction system yet to actually contest a resolved hit (see
  // combat-wip.js's own note on that) -- once one exists, it slots in between the roll
  // and the outcome, here.
  const acUnknown = _effectiveTargetAc() === null;
  document.getElementById('targetPickerMiss').hidden = !acUnknown;
  document.getElementById('targetPickerHit').textContent = acUnknown ? 'Attack Hit' : 'Attack';
  const input = document.getElementById('targetPickerAttackInput');
  input.value = '';
  _updateAttackTotal();
  setTimeout(() => input.focus(), 50);
}

function _currentAttackRoll() {
  const raw = parseInt(document.getElementById('targetPickerAttackInput').value, 10);
  return Number.isNaN(raw) ? null : raw;
}

/** The target's current AC (base + any live status delta, e.g. Crunch), or null when
 * none is on record at all (a DM's freeform PvE enemy) and the app has nothing to
 * resolve an attack against. Never shown to the human -- see _showStep2/_confirmAttack. */
function _effectiveTargetAc() {
  const base = _selectedTarget?.ac;
  if (!Number.isFinite(base)) return null;
  return base + (_atkCtx?.acDelta || 0);
}

function _updateAttackTotal() {
  const raw = _currentAttackRoll();
  const totalEl = document.getElementById('targetPickerAttackTotal');
  if (raw === null) { totalEl.innerHTML = ''; return; }
  // No AC shown here on purpose, even though the app itself knows it and uses it to
  // resolve the attack -- see _showStep2/_confirmAttack.
  totalEl.innerHTML = `Total: <strong>${raw + _effectiveAttackMod()}</strong>`;
}

/** Only reachable when the target's AC is unknown and _showStep2 fell back to the
 * two-button choice (see its own comment) -- the human declares a miss themselves,
 * same as the app would have on a failed AC comparison. */
function _confirmMiss() {
  const attackRoll = _currentAttackRoll();
  const rollMode = _atkCtx?.mode || 'normal';
  _consume(_atkCtx);
  _close({ targetId: _selectedTargetId, hit: false, attackRoll, rollMode });
}

/** Attack button (or Enter) -- resolves the roll against the target's AC itself
 * (roll + modifiers >= AC, live status deltas included) when it's known, so the human
 * never has to declare Hit or Miss by hand; falls back to _confirmMiss's manual pair
 * when it isn't (see _showStep2). A miss closes the popup right away -- nothing left to
 * roll. A hit shows the damage-roll step immediately (so there's no waiting before the
 * next input is ready), with the attacker's regular sprite looping there while the
 * roll is entered -- the one-shot battle animation only plays once the damage roll is
 * actually confirmed (see _confirmDamageRoll/_playAnimation). */
function _confirmAttack() {
  const attackRoll = _currentAttackRoll();
  if (attackRoll === null) return;
  _attackRoll = attackRoll;
  const targetAc = _effectiveTargetAc();
  if (targetAc !== null && attackRoll + _effectiveAttackMod() < targetAc) {
    _confirmMiss();
    return;
  }
  _showStep3();
}

/** Damage step's Back button. Called with no arguments on purpose -- wiring
 * _showStep2 straight to the click listener passed it the click event as its
 * target. A guaranteed hit has no attack-roll step to return to, so it goes
 * back to target selection instead. */
function _backFromDamage() {
  if (_guaranteedHit) _showStep1();
  else _showStep2();
}

/** guaranteed_hit moves: no attack roll, the hit is automatic. Goes straight
 * to the damage step for the given target (see _showStep3 for what shows
 * there while the roll is being entered). */
function _autoHit(p, name) {
  _attackRoll = null;
  _atkCtx = null; // nothing is rolled, so no roll modifiers apply
  _diceBonusExtra = 0; // no attack-roll step to offer a dice bonus on -- clear any stale value
  _diceBonusConsume = [];
  _selectedTarget = p;
  _selectedTargetName = name;
  _showStep3();
}

/** Plays the attacker's one-shot battle animation over the damage step's media
 * area, replacing the looping idle sprite _showStep3 put there -- called only
 * once the damage roll is actually confirmed (see _confirmDamageRoll), so it's
 * the last thing the player sees before the popup closes, not something
 * competing for their attention while they're still entering a roll. No-ops
 * (leaves the idle sprite as the last thing shown) when the species has no
 * registered battle animation. */
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
  document.getElementById('targetPickerStep1').hidden = true; // only visible here on the guaranteed-hit path
  document.getElementById('targetPickerStep2').hidden = true;
  document.getElementById('targetPickerStep3').hidden = false;
  document.getElementById('targetPickerTitle').textContent = 'Damage Roll';
  document.getElementById('targetPickerDamageTarget').innerHTML = `
    <div class="target-picker-portrait">${spriteMediaHtml(_selectedTarget.image, _selectedTargetName)}</div>
    <div class="target-picker-roll-target-name">${_selectedTargetName}</div>`;
  // The attacker's own regular (looping) sprite -- not the one-shot battle-animation
  // clip, which only plays once the roll is confirmed (see _playAnimation/
  // _confirmDamageRoll). _attacker is populated by both pickTarget and
  // pickTargetAgain's callers, so this is available on every path that reaches here.
  document.getElementById('targetPickerAnimMedia').innerHTML =
    spriteMediaHtml(_attacker?.image, _attacker?.name || 'Attacker');
  document.getElementById('targetPickerModifierNote').textContent =
    _damageModifier ? ` (${_damageModifier >= 0 ? '+' : ''}${_damageModifier} modifier added automatically)` : '';
  const input = document.getElementById('targetPickerRollInput');
  input.value = '';
  _updateRollTotal();
  document.getElementById('targetPickerConfirmRoll').disabled = false;
  setTimeout(() => input.focus(), 50);
}

function _updateRollTotal() {
  const raw = parseInt(document.getElementById('targetPickerRollInput').value, 10);
  const totalEl = document.getElementById('targetPickerRollTotal');
  totalEl.innerHTML = Number.isNaN(raw) ? '' : `Total: <strong>${raw + _damageModifier}</strong>`;
}

/** Confirm Damage -- plays the one-shot attack animation (see _playAnimation)
 * before closing, so it's the last thing shown, then closes. Disables the
 * button first (re-entrancy guard: a second click landing mid-animation would
 * otherwise both replay the animation and double-consume any "next roll"
 * status) -- no need to re-enable it after, _showStep3 already does that
 * fresh for the next time this step is reached. */
async function _confirmDamageRoll() {
  const raw = parseInt(document.getElementById('targetPickerRollInput').value, 10);
  if (Number.isNaN(raw)) return;
  const btn = document.getElementById('targetPickerConfirmRoll');
  if (btn.disabled) return;
  btn.disabled = true;
  const result = {
    targetId: _selectedTargetId, hit: true, rawRoll: raw,
    attackRoll: _attackRoll, attackTotal: _attackRoll === null ? null : _attackRoll + _effectiveAttackMod(),
    rollMode: _atkCtx?.mode || 'normal',
  };
  _consume(_atkCtx);
  await _playAnimation();
  _close(result);
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
 * then enter an attack roll (modifier added automatically, shown live). The
 * app itself resolves Hit or Miss from there (roll + modifiers vs. the
 * target's AC, live status deltas included) -- the AC number is never shown,
 * only the outcome, same as the user's own described flow (enter a roll,
 * click Attack, get told hit or miss; a reaction system will eventually slot
 * in between those two steps, once one exists -- see combat-wip.js). Falls
 * back to a human declaring Hit/Miss themselves (see _confirmMiss) only when
 * the target's AC isn't known at all (a DM's freeform PvE enemy). A Miss
 * resolves immediately (the move's VP cost was already spent before this
 * popup ever opened, so there's nothing left to do). A Hit moves on to a
 * damage roll (the attacker's regular sprite loops there; a one-shot battle
 * animation, if any, plays once the roll is confirmed), which resolves the
 * promise once confirmed. Resolves to {targetId, hit:false},
 * {targetId, hit:true, rawRoll, attackRoll, attackTotal}, or null if the
 * player picked "No Target" / closed the popup / there's no active session
 * to target into. attackRoll is the natural d20 that was typed in (also on a
 * miss; null on a guaranteed hit), attackTotal that plus the attack modifier
 * and any live attack-roll status.
 * The popup also shows what live statuses do to this roll (advantage/disadvantage,
 * attack-roll and target-AC changes -- `attacker` gives pickTargetAgain the
 * attacker's record; pickTarget reads it from the session) and uses up any
 * "next attack" effect once the roll is confirmed; rollMode reports the net mode. Safe to await unconditionally --
 * it resolves to null with no popup shown when there's nothing to target.
 *
 * guaranteedHit (moves tagged guaranteed_hit): the Attack Roll step is
 * skipped -- picking a target counts as a hit and goes straight to the
 * damage roll. The result shape is unchanged. No attack roll is entered, so
 * there's nothing to crit on either.
 *
 * The attacker is never offered as a target card -- the "No Target
 * (self-only move)" button already covers "this doesn't hit anyone else",
 * so a separate self-card would just be the same choice twice.
 */
export async function pickTarget(attackerId, { attackModifier = 0, damageModifier = 0, speciesName = '', guaranteedHit = false, moveName = '' } = {}) {
  const result = await CombatAPI.getState();
  const session = result.status === 'success' ? result.data : null;
  if (!session || !session.active) return null;

  const participants = Object.values(session.participants).filter(p => p.id !== attackerId);
  if (!participants.length) return null;

  _ensureDom();
  _attacker = session.participants[attackerId] || null;
  _attackModifier = attackModifier;
  _damageModifier = damageModifier;
  _speciesName = speciesName;
  _guaranteedHit = guaranteedHit;
  _moveName = moveName;
  document.getElementById('targetPickerAnimMedia').innerHTML = '';
  document.getElementById('targetPickerBack').style.display = '';
  document.getElementById('targetPickerBackToAttack').style.display = '';
  _showStep1();
  const grid = document.getElementById('targetPickerGrid');
  grid.innerHTML = participants.map(p => _cardHtml(p)).join('');
  grid.querySelectorAll('[data-target-id]').forEach(card => {
    card.addEventListener('click', () => {
      const p = session.participants[card.dataset.targetId];
      const name = visibleToViewer(p, 'name') ? p.name : '???';
      _selectedTargetId = card.dataset.targetId;
      _afterTargetSelected(p, name);
    });
  });

  _overlay.style.display = 'flex';
  return new Promise((resolve) => { _resolve = resolve; });
}

/**
 * The multi_hit_same_target counterpart to pickTarget -- resumes the flow
 * directly at the Attack Roll step against an ALREADY-known target,
 * skipping target selection entirely (see combat-wip.js's
 * _handleDamageResolved "hit again?" loop for Fury Attack/Rock Blast-style
 * moves, which are always locked to whoever the first hit landed on -- no
 * re-picking). Also reused for one target of a multi_hit_aoe move (see
 * combat-wip.js's _handleMultiHitAoe), where the target was already fixed
 * by the AoE target-selection step, not this popup. Same resolve shape as
 * pickTarget: {targetId, hit:false}, {targetId, hit:true, rawRoll}, or
 * null if closed. With guaranteedHit (see pickTarget) it opens directly at
 * the damage roll instead, with no step to go back to.
 */
export async function pickTargetAgain(target, targetName, { attackModifier = 0, damageModifier = 0, speciesName = '', guaranteedHit = false, attacker = null, moveName = '' } = {}) {
  _ensureDom();
  _attacker = attacker;
  _attackModifier = attackModifier;
  _damageModifier = damageModifier;
  _speciesName = speciesName;
  _guaranteedHit = guaranteedHit;
  _moveName = moveName;
  document.getElementById('targetPickerAnimMedia').innerHTML = '';
  _selectedTargetId = target.id;
  document.getElementById('targetPickerBack').style.display = 'none';
  document.getElementById('targetPickerBackToAttack').style.display = guaranteedHit ? 'none' : '';
  document.getElementById('targetPickerStep1').hidden = true;
  document.getElementById('targetPickerStep2').hidden = true;
  document.getElementById('targetPickerStep3').hidden = true;
  _overlay.style.display = 'flex';
  const result = new Promise((resolve) => { _resolve = resolve; });
  _afterTargetSelected(target, targetName);
  return result;
}
