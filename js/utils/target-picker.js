// Reusable "pick a target from the live combat session" popup for the new
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
    .target-picker-card.self { opacity: 0.7; }
    .target-picker-portrait { width: 56px; height: 56px; margin: 0 auto 0.3rem; }
    .target-picker-portrait img, .target-picker-portrait video { width: 100%; height: 100%; object-fit: contain; }
    .target-picker-name { font-size: 0.82rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .target-picker-bar { height: 5px; border-radius: 3px; background: rgba(255,255,255,0.15); overflow: hidden; margin-top: 0.25rem; }
    .target-picker-bar-fill { height: 100%; }
    .target-picker-bar.hp .target-picker-bar-fill { background: #2ecc71; }
    .target-picker-bar.vp .target-picker-bar-fill { background: #3498db; }
    .target-picker-empty { text-align: center; color: #a0a0c0; padding: 1rem; }
    .target-picker-skip { width: 100%; margin-top: 0.9rem; }
  `;
  document.head.appendChild(style);
}

let _overlay = null;
let _resolve = null;

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
        <h2>Choose a Target</h2>
      </div>
      <div class="combat-move-popup-body">
        <div class="target-picker-grid" id="targetPickerGrid"></div>
        <button class="combat-use-move-btn target-picker-skip" id="targetPickerSkip">No Target (self-only move)</button>
      </div>
    </div>
  `;
  document.body.appendChild(_overlay);

  document.getElementById('targetPickerClose').addEventListener('click', () => _close(null));
  _overlay.addEventListener('click', (e) => { if (e.target === _overlay) _close(null); });
  document.getElementById('targetPickerSkip').addEventListener('click', () => _close(null));
}

function _close(result) {
  if (_overlay) _overlay.style.display = 'none';
  if (_resolve) { _resolve(result); _resolve = null; }
}

function _cardHtml(p, isSelf) {
  const name = visibleToViewer(p, 'name') ? p.name : '???';
  const hpPct = p.maxHP > 0 ? Math.max(0, Math.min(100, (p.currentHP / p.maxHP) * 100)) : 0;
  const vpPct = p.maxVP > 0 ? Math.max(0, Math.min(100, (p.currentVP / p.maxVP) * 100)) : 0;
  return `
    <button type="button" class="target-picker-card${isSelf ? ' self' : ''}" data-target-id="${p.id}">
      <div class="target-picker-portrait">${spriteMediaHtml(p.image, name)}</div>
      <div class="target-picker-name">${name}${isSelf ? ' (you)' : ''}</div>
      ${visibleToViewer(p, 'hp') ? `<div class="target-picker-bar hp"><div class="target-picker-bar-fill" style="width:${hpPct}%"></div></div>` : ''}
      ${visibleToViewer(p, 'vp') ? `<div class="target-picker-bar vp"><div class="target-picker-bar-fill" style="width:${vpPct}%"></div></div>` : ''}
    </button>`;
}

/**
 * Shows the target picker and resolves to the chosen participant's id, or
 * null if the player picked "No Target" / closed the popup / there's no
 * active session to target into. Safe to await unconditionally -- it
 * resolves to null with no popup shown when there's nothing to target.
 *
 * attackerId is never excluded from the list (marked "(you)" instead) --
 * some moves legitimately target the user, so that's a UI hint, not a filter.
 */
export async function pickTarget(attackerId) {
  const result = await CombatAPI.getState();
  const session = result.status === 'success' ? result.data : null;
  if (!session || !session.active) return null;

  const participants = Object.values(session.participants);
  if (!participants.length) return null;

  _ensureDom();
  const grid = document.getElementById('targetPickerGrid');
  grid.innerHTML = participants.map(p => _cardHtml(p, p.id === attackerId)).join('');
  grid.querySelectorAll('[data-target-id]').forEach(card => {
    card.addEventListener('click', () => _close(card.dataset.targetId));
  });

  _overlay.style.display = 'flex';
  return new Promise((resolve) => { _resolve = resolve; });
}
