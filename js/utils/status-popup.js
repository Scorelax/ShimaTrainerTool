// Detail popup for one live effect on a participant (opened by clicking its
// badge): what it is, who put it there, how it ends and how long is left, plus
// the ways to end it -- roll its save, use up one of its uses, or remove it by
// hand (a cure, a human ruling). Resolves to 'save' | 'use' | 'remove' | null
// (closed); combat-wip.js does the actual save popup / server call.
import { statusLabel, describeStatusEnds } from './move-effects.js';

function _injectStyles() {
  if (document.getElementById('status-popup-styles')) return;
  const style = document.createElement('style');
  style.id = 'status-popup-styles';
  style.textContent = `
    .combat-popup-overlay { position: fixed; top:0; left:0; width:100%; height:100%; background: rgba(0,0,0,0.75); z-index: 1100; justify-content: center; align-items: center; backdrop-filter: blur(3px); }
    .combat-popup-content { background: #1e1e34; border: 1px solid rgba(255,255,255,0.12); border-radius: 16px; max-width: 560px; width: 92%; max-height: 85vh; overflow-y: auto; position: relative; box-shadow: 0 10px 40px rgba(0,0,0,0.6); color: #e0e0e0; }
    .combat-move-popup-header { padding: 1.1rem 1.2rem; border-radius: 16px 16px 0 0; border-bottom: 2px solid rgba(0,0,0,0.3); display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; position: relative; background: rgba(255,255,255,0.05); }
    .combat-move-popup-header h2 { margin: 0; font-size: 1.3rem; font-weight: 900; text-transform: uppercase; }
    .combat-popup-close { position: absolute; top: 0.8rem; right: 0.8rem; background: rgba(0,0,0,0.3); border: none; border-radius: 50%; width: 32px; height: 32px; font-size: 1.2rem; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; color: inherit; }
    .combat-move-popup-body { padding: 1rem 1.2rem; }
    .combat-use-move-btn { width: 100%; padding: 0.75rem; background: linear-gradient(135deg, #4CAF50, #45A049); color: #fff; border: none; border-radius: 8px; font-size: 1rem; font-weight: 700; cursor: pointer; }
    .status-popup-row { display: flex; gap: 0.6rem; margin-bottom: 0.5rem; font-size: 0.9rem; }
    .status-popup-key { width: 5.5rem; flex-shrink: 0; color: #a0a0c0; }
    .status-popup-actions { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 1rem; }
    .status-popup-remove { background: linear-gradient(135deg, #EE1515, #C91010) !important; }
    .status-popup-secondary { background: rgba(255,255,255,0.1) !important; }
  `;
  document.head.appendChild(style);
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** `holderName` = who has it; `status` = the stored status; `round` = the session's
 * current round (for "rounds left"). */
export function showStatusDetail(holderName, status, round) {
  _injectStyles();
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'combat-popup-overlay';
    overlay.style.display = 'flex';
    const from = status.sourceName ? `${status.sourceName}${status.moveName ? `'s ${status.moveName}` : ''}` : (status.moveName || '—');
    const hasSave = (status.ends || []).some(e => e.type === 'save');
    const hasUses = (status.ends || []).some(e => e.type === 'uses' && e.left > 0);
    const rows = [
      ['On', holderName],
      ['From', from],
      ['Ends', describeStatusEnds(status, round)],
      status.dc ? ['Move DC', status.dc] : null,
      status.note ? ['Note', status.note] : null,
    ].filter(Boolean).map(([k, v]) => `<div class="status-popup-row"><span class="status-popup-key">${k}</span><span>${esc(v)}</span></div>`).join('');
    overlay.innerHTML = `
      <div class="combat-popup-content" style="max-width:420px;">
        <div class="combat-move-popup-header">
          <button class="combat-popup-close" data-act="close">×</button>
          <h2>${esc(statusLabel(status))}</h2>
        </div>
        <div class="combat-move-popup-body">
          ${rows}
          <div class="status-popup-actions">
            ${hasSave ? '<button class="combat-use-move-btn" data-act="save">Roll the saving throw</button>' : ''}
            ${hasUses ? '<button class="combat-use-move-btn" data-act="use">Use it up (it applied to a roll)</button>' : ''}
            <button class="combat-use-move-btn status-popup-remove" data-act="remove">Remove it</button>
            <button class="combat-use-move-btn status-popup-secondary" data-act="close">Close</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (e.target !== overlay && !act) return;
      overlay.remove();
      resolve(act === 'save' || act === 'use' || act === 'remove' ? act : null);
    });
  });
}
