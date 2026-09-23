// A tiny, non-interactive "Waiting for possible reactions..." overlay for the
// 'damaged' reaction family (see reaction-window.js) -- unlike the 'targeted'
// family, which pauses INSIDE an already-open popup (target-picker.js's own
// step), a damage-based wait happens after every popup involved has already
// closed, so there's no existing step to show it in. Just a small blocking
// indicator with a live countdown; nothing to click, it closes itself once
// the wait resolves.
import { waitForReactionWindow } from './reaction-window.js';

function _injectStyles() {
  if (document.getElementById('reaction-wait-overlay-styles')) return;
  const style = document.createElement('style');
  style.id = 'reaction-wait-overlay-styles';
  style.textContent = `
    .reaction-wait-overlay { position: fixed; top:0; left:0; width:100%; height:100%; background: rgba(0,0,0,0.55); z-index: 1250; display: none; justify-content: center; align-items: center; }
    .reaction-wait-box { background: #1e1e34; border: 1px solid rgba(255,255,255,0.15); border-radius: 14px; padding: 1.2rem 1.6rem; text-align: center; color: #e0e0e0; box-shadow: 0 10px 40px rgba(0,0,0,0.6); }
    .reaction-wait-box .msg { font-size: 0.95rem; margin-bottom: 0.4rem; }
    .reaction-wait-box .timer { font-size: 0.82rem; color: #a0a0c0; }
  `;
  document.head.appendChild(style);
}

let _overlay = null;

function _ensureDom() {
  if (_overlay) return;
  _injectStyles();
  _overlay = document.createElement('div');
  _overlay.className = 'reaction-wait-overlay';
  _overlay.id = 'reactionWaitOverlay';
  _overlay.innerHTML = `
    <div class="reaction-wait-box">
      <div class="msg">Waiting for possible reactions…</div>
      <div class="timer" id="reactionWaitOverlayTimer"></div>
    </div>`;
  document.body.appendChild(_overlay);
}

/** Opens a 'damaged' reaction window anchored on `anchorId` (whoever just took
 * damage) and shows this overlay only for as long as it's genuinely waiting
 * on someone -- no-ops visibly (never shown at all) when nobody's eligible,
 * same as target-picker.js's own version of this for the 'targeted' family. */
export async function waitForDamagedReactions(anchorId, attackerId, moveName) {
  _ensureDom();
  let shown = false;
  await waitForReactionWindow('damaged', anchorId, attackerId, moveName, (status) => {
    if (!status.opened) return;
    if (!shown) { shown = true; _overlay.style.display = 'flex'; }
    const secs = Math.ceil(status.msLeft / 1000);
    document.getElementById('reactionWaitOverlayTimer').textContent = `${secs}s`;
  });
  if (shown) _overlay.style.display = 'none';
}
