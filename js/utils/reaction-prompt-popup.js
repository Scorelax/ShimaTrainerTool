// Reactor-side half of the reaction-window system (see routes_combat.py's own
// module docstring, and utils/reaction-window.js for the attacker-side wait).
// Unlike every other popup in this app (called once, awaited, done), this one
// is driven externally by combat-wip.js's own live session updates -- call
// showReactionPromptIfEligible(session, myParticipantIds) on every push; it
// shows/updates/hides itself as session.pendingReaction changes, and no-ops
// when there's nothing relevant to this device. A 10-second countdown ticks
// locally against the window's own expiresAt; if it reaches 0 without the
// human answering, every one of this device's still-undecided eligible
// participants is auto-declined -- same trust model as this app's Move DC/
// stat popups, just with an actual timeout since "do nothing" needs to mean
// something here (an unopened reaction is a real answer -- opting out -- not
// merely a popup nobody happened to click through).
import { CombatAPI } from '../api.js';

function _injectStyles() {
  if (document.getElementById('reaction-prompt-styles')) return;
  const style = document.createElement('style');
  style.id = 'reaction-prompt-styles';
  style.textContent = `
    .reaction-prompt-overlay { position: fixed; top:0; left:0; width:100%; height:100%; background: rgba(0,0,0,0.6); z-index: 1300; justify-content: center; align-items: flex-start; padding-top: 4vh; }
    .reaction-prompt-box { background: #1e1e34; border: 2px solid #FFD700; border-radius: 16px; max-width: 400px; width: 90%; padding: 1.2rem; color: #e0e0e0; box-shadow: 0 10px 40px rgba(0,0,0,0.7); }
    .reaction-prompt-title { font-weight: 900; font-size: 1.1rem; margin-bottom: 0.3rem; text-transform: uppercase; color: #FFD700; }
    .reaction-prompt-desc { font-size: 0.9rem; color: #cfd0e0; margin-bottom: 0.7rem; }
    .reaction-prompt-timer { font-size: 0.85rem; color: #a0a0c0; margin-bottom: 0.8rem; }
    .reaction-prompt-timer strong { color: #FFD700; }
    .reaction-prompt-option { display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; background: rgba(255,255,255,0.06); border-radius: 10px; padding: 0.6rem 0.8rem; margin-bottom: 0.5rem; }
    .reaction-prompt-option-name { font-weight: 700; }
    .reaction-prompt-option-moves { font-size: 0.78rem; color: #a0a0c0; }
    .reaction-prompt-react-btn { padding: 0.5rem 0.9rem; background: linear-gradient(135deg, #4CAF50, #45A049); color: #fff; border: none; border-radius: 8px; font-weight: 700; cursor: pointer; }
    .reaction-prompt-ignore-btn { width: 100%; margin-top: 0.4rem; padding: 0.55rem; background: rgba(255,255,255,0.1); color: #e0e0e0; border: none; border-radius: 8px; font-weight: 700; cursor: pointer; }
  `;
  document.head.appendChild(style);
}

let _overlay = null;
let _tickTimer = null;
let _shownWindowId = null; // which pendingReaction.id is currently on screen, so a repeat push doesn't re-render/flicker
let _declinedThisWindow = new Set(); // participantIds this device already answered for, this window

function _ensureDom() {
  if (_overlay) return;
  _injectStyles();
  _overlay = document.createElement('div');
  _overlay.className = 'reaction-prompt-overlay';
  _overlay.id = 'reactionPromptPopup';
  _overlay.style.display = 'none';
  _overlay.innerHTML = `
    <div class="reaction-prompt-box">
      <div class="reaction-prompt-title">React?</div>
      <div class="reaction-prompt-desc" id="reactionPromptDesc"></div>
      <div class="reaction-prompt-timer">Time left: <strong id="reactionPromptTimer">10s</strong></div>
      <div id="reactionPromptOptions"></div>
      <button class="reaction-prompt-ignore-btn" id="reactionPromptIgnore">Don't React</button>
    </div>`;
  document.body.appendChild(_overlay);
  document.getElementById('reactionPromptIgnore').addEventListener('click', () => _declineAll());
}

function _hide() {
  if (_overlay) _overlay.style.display = 'none';
  if (_tickTimer) { clearInterval(_tickTimer); _tickTimer = null; }
  _shownWindowId = null;
  _declinedThisWindow = new Set();
}

async function _declineAll() {
  const ids = [..._currentMine];
  _hide();
  for (const id of ids) {
    try { await CombatAPI.declineReaction(id); } catch { /* window may have already closed -- fine */ }
  }
}

async function _react(participantId, onReacted) {
  _hide();
  try {
    await CombatAPI.reactionStart(participantId);
    onReacted?.(participantId);
  } catch (err) {
    // Someone else's "yes" landed first, or the window already closed -- nothing
    // more to do here, the next session push will reflect reality either way.
    console.warn('Reaction start failed (likely lost a race to another reactor):', err?.message || err);
  }
}

let _currentMine = new Set(); // the participant ids this device is currently being asked about

/**
 * Call on every session update. `session` is the live combat state,
 * `myParticipantIds` this device's own participant ids (Set or array),
 * `getName(id)` an optional lookup for a friendlier display name.
 * `onReacted(participantId)` fires once this device's own reaction-start
 * succeeds, so the caller can switch focus to that combatant's card.
 */
export function showReactionPromptIfEligible(session, myParticipantIds, { getName, onReacted } = {}) {
  const pr = session?.pendingReaction;
  const mineSet = myParticipantIds instanceof Set ? myParticipantIds : new Set(myParticipantIds || []);

  if (!pr) { _hide(); return; }

  const mine = Object.keys(pr.eligible || {}).filter(id => mineSet.has(id) && !pr.eligible[id].responded);
  if (!mine.length) { _hide(); return; }

  _currentMine = new Set(mine);

  if (_shownWindowId !== pr.id) {
    _ensureDom();
    _shownWindowId = pr.id;
    _declinedThisWindow = new Set();
    const anchorName = getName?.(pr.anchorId) || 'a participant';
    const triggerText = pr.trigger === 'damaged' ? `${anchorName} just took damage` : `${anchorName} is being targeted`;
    document.getElementById('reactionPromptDesc').textContent = `${triggerText}. You may react.`;
    document.getElementById('reactionPromptOptions').innerHTML = mine.map(id => `
      <div class="reaction-prompt-option" data-participant-id="${id}">
        <div>
          <div class="reaction-prompt-option-name">${getName?.(id) || id}</div>
          <div class="reaction-prompt-option-moves">${(pr.eligible[id].moves || []).join(', ')}</div>
        </div>
        <button class="reaction-prompt-react-btn" data-react-for="${id}">React</button>
      </div>`).join('');
    document.querySelectorAll('[data-react-for]').forEach(btn => {
      btn.addEventListener('click', () => _react(btn.dataset.reactFor, onReacted));
    });
    _overlay.style.display = 'flex';

    if (_tickTimer) clearInterval(_tickTimer);
    _tickTimer = setInterval(() => {
      const msLeft = pr.expiresAt - Date.now();
      const el = document.getElementById('reactionPromptTimer');
      if (el) el.textContent = `${Math.max(0, Math.ceil(msLeft / 1000))}s`;
      if (msLeft <= 0) _declineAll();
    }, 250);
  }
}
