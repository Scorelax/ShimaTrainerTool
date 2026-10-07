// Spikes-style hazard hit: "<creature> entered / started its turn in the Spikes -- roll the damage, make the DEX save."
// The server only queues the hit (routes_combat.py's _queue_hazards); the dice and the save are the table's, same as every
// other roll in this tool, so this asks for the damage total and whether the save passed, and the server applies it
// (half, rounded down, on a pass) through the ordinary typed-damage path via resolve-hazard.
//
// One popup per queued hit. If another device resolves it first, closeHazardPopup(id) takes this one down.

const _open = new Map(); // hazard id -> () => void (closes that popup without resolving)

function _injectStyles() {
  if (document.getElementById('hazard-popup-styles')) return;
  const style = document.createElement('style');
  style.id = 'hazard-popup-styles';
  style.textContent = `
    .hz-overlay { position: fixed; inset: 0; z-index: 1200; display: flex; align-items: center; justify-content: center; background: rgba(2,3,10,0.82); backdrop-filter: blur(4px); }
    .hz-card { width: 92%; max-width: 420px; background: linear-gradient(180deg, #2a1d1a, #16110f); border: 1px solid rgba(214,120,70,0.6); border-radius: 18px; padding: 1.1rem 1.2rem 1.2rem; color: #ecdcd2; box-shadow: 0 14px 50px rgba(0,0,0,0.7), 0 0 30px rgba(214,120,70,0.2); }
    .hz-title { margin: 0 0 0.3rem; font-size: 1.2rem; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase; color: #ff9a62; }
    .hz-line { font-size: 0.92rem; margin: 0.25rem 0; }
    .hz-line strong { color: #ffd2b0; }
    .hz-roll { display: flex; align-items: center; gap: 0.6rem; margin: 0.8rem 0 0.4rem; }
    .hz-roll input { width: 5.2rem; padding: 0.5rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.25); background: rgba(0,0,0,0.35); color: #fff; font-size: 1.1rem; text-align: center; }
    .hz-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.9rem; }
    .hz-actions button { flex: 1 1 auto; border: none; border-radius: 999px; padding: 0.55rem 0.9rem; font-size: 0.88rem; font-weight: 700; cursor: pointer; color: #fff; }
    .hz-fail { background: linear-gradient(135deg, #e74c3c, #a93226); }
    .hz-pass { background: linear-gradient(135deg, #2ecc71, #1e8449); }
    .hz-skip { background: rgba(255,255,255,0.14); }
  `;
  document.head.appendChild(style);
}

/** Takes down the popup for a hazard another device already resolved. */
export function closeHazardPopup(id) {
  _open.get(id)?.();
}

export function isHazardPopupOpen(id) {
  return _open.has(id);
}

/**
 * @param {object} hazard  a queued entry from session.pendingHazards
 * @returns {Promise<{roll: number, saved: boolean} | {roll: null} | null>}  null if taken down by closeHazardPopup
 */
export function promptHazard(hazard) {
  _injectStyles();
  return new Promise((resolve) => {
    const flat = hazard.flat ? (hazard.flat > 0 ? ` + ${hazard.flat}` : ` - ${Math.abs(hazard.flat)}`) : '';
    const overlay = document.createElement('div');
    overlay.className = 'hz-overlay';
    overlay.innerHTML = `
      <div class="hz-card">
        <h3 class="hz-title">${hazard.zoneName}</h3>
        <div class="hz-line"><strong>${hazard.participantName}</strong> ${hazard.trigger === 'enter' ? 'entered' : 'started their turn in'} the ${hazard.zoneName}.</div>
        <div class="hz-line">Roll <strong>${hazard.dice}${flat}</strong> ${hazard.damageType} damage.</div>
        ${hazard.ability ? `<div class="hz-line">${hazard.participantName} makes a <strong>${hazard.ability}</strong> save${hazard.dc ? ` against DC <strong>${hazard.dc}</strong>` : ''} for half.</div>` : ''}
        <div class="hz-roll"><label for="hzRoll">Damage rolled</label><input id="hzRoll" type="number" min="0" inputmode="numeric" placeholder="total"></div>
        <div class="hz-actions">
          <button type="button" class="hz-fail" data-act="fail">Save failed — full</button>
          <button type="button" class="hz-pass" data-act="pass">Save passed — half</button>
          <button type="button" class="hz-skip" data-act="skip">No damage</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('#hzRoll');
    setTimeout(() => input.focus(), 50);

    const finish = (value) => { _open.delete(hazard.id); overlay.remove(); resolve(value); };
    _open.set(hazard.id, () => finish(null));
    overlay.addEventListener('click', (e) => {
      const act = e.target.closest('button')?.dataset.act;
      if (!act) return;
      if (act === 'skip') return finish({ roll: null });
      const roll = parseInt(input.value, 10);
      if (!Number.isFinite(roll) || roll < 0) { input.focus(); input.style.borderColor = '#e74c3c'; return; }
      finish({ roll, saved: act === 'pass' });
    });
  });
}
