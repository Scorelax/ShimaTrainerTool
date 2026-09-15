// New shared combat tool -- work in progress, open to every trainer (see
// combat.js setup header) so multiple people can log in as different
// trainers and actually test the shared/live parts together. The old
// combat page keeps being what's actually used to play until the real
// switchover. Phase 1 vertical slice: prove the combat-session schema and
// the real-time SSE plumbing (pi-server/app/routes_combat.py) hold up,
// before any real game logic or player-facing UI is built on top. Open
// this page in two tabs and add/remove/advance a session in one -- the
// other should update within the SSE stream's normal latency, with no
// manual refresh.
import { CombatAPI } from '../api.js';
import { pickTarget } from '../utils/target-picker.js';

const WIP_CSS = `
  .combat-wip-page { min-height: 100vh; background: #14141f; color: #e0e0e0; font-family: inherit; }
  .combat-wip-header-bar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 0.75rem 1rem; background: rgba(0,0,0,0.3); border-bottom: 1px solid rgba(255,255,255,0.1);
  }
  .combat-wip-title { font-size: 1.2rem; font-weight: 700; color: #FFD700; text-transform: uppercase; letter-spacing: 1px; }
  .combat-wip-back-btn {
    background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);
    color: #e0e0e0; padding: 0.4rem 0.8rem; border-radius: 6px; cursor: pointer; font-size: 0.9rem;
  }
  .combat-wip-body { max-width: 700px; margin: 0 auto; padding: 1.5rem 1rem 3rem; }
  .combat-wip-empty { text-align: center; padding: 3rem 1rem; }
  .combat-wip-empty h2 { color: #FFD700; margin-bottom: 0.5rem; }
  .combat-wip-empty p { color: #a0a0c0; line-height: 1.5; margin-bottom: 1.5rem; }
  .combat-wip-btn-primary, .combat-wip-btn-danger, .combat-wip-btn-secondary {
    border: none; border-radius: 6px; padding: 0.6rem 1.2rem; font-size: 0.95rem;
    font-weight: 600; cursor: pointer; color: #fff;
  }
  .combat-wip-btn-primary { background: linear-gradient(135deg, #27ae60, #1e8449); }
  .combat-wip-btn-danger { background: linear-gradient(135deg, #c0392b, #922b21); }
  .combat-wip-btn-secondary { background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); }
  .combat-wip-round-bar {
    display: flex; align-items: center; justify-content: space-between;
    background: rgba(255,255,255,0.05); border-radius: 8px; padding: 0.75rem 1rem; margin-bottom: 1rem;
  }
  .combat-wip-round-label { font-weight: 700; color: #FFD700; }
  .combat-wip-reacting-note { color: #e67e22; font-size: 0.85rem; }
  .combat-wip-add-form {
    display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center;
    background: rgba(255,255,255,0.05); border-radius: 8px; padding: 0.75rem; margin-bottom: 1rem;
  }
  .combat-wip-add-form input, .combat-wip-add-form select {
    background: #1e1e2e; border: 1px solid rgba(255,255,255,0.2); color: #e0e0e0;
    border-radius: 4px; padding: 0.4rem 0.5rem; font-size: 0.85rem;
  }
  .combat-wip-add-form input[type="text"] { flex: 1; min-width: 100px; }
  .combat-wip-add-form input[type="number"] { width: 64px; }
  .combat-wip-participant-list { display: flex; flex-direction: column; gap: 0.5rem; }
  .combat-wip-participant {
    display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem;
    background: rgba(255,255,255,0.05); border: 1px solid transparent; border-radius: 8px; padding: 0.6rem 0.8rem;
  }
  .combat-wip-participant.active-turn { border-color: #FFD700; background: rgba(255,215,0,0.08); }
  .combat-wip-participant.reacting { border-color: #e67e22; background: rgba(230,126,34,0.1); }
  .combat-wip-participant.spectating { opacity: 0.55; }
  .combat-wip-side-badge { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; padding: 0.15rem 0.4rem; border-radius: 4px; }
  .combat-wip-side-badge.player { background: #2980b9; }
  .combat-wip-side-badge.enemy { background: #922b21; }
  .combat-wip-p-name { font-weight: 600; }
  .combat-wip-p-stats { color: #a0a0c0; font-size: 0.8rem; }
  .combat-wip-p-controls { margin-left: auto; display: flex; flex-wrap: wrap; gap: 0.35rem; }
  .combat-wip-p-controls button {
    background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: #e0e0e0;
    border-radius: 4px; padding: 0.25rem 0.5rem; font-size: 0.75rem; cursor: pointer;
  }
  .combat-wip-p-controls button:disabled { opacity: 0.35; cursor: not-allowed; }
  .combat-wip-p-controls button.on { background: #27ae60; border-color: #27ae60; }
  .combat-wip-p-controls button.remove { background: #922b21; border-color: #922b21; }
`;

let session = null;
let combatUpdateHandler = null;

export async function renderCombatWip() {
  const result = await CombatAPI.getState();
  session = result.status === 'success' ? result.data : { active: false };
  return `
    <div class="combat-wip-page">
      <style>${WIP_CSS}</style>
      <div class="combat-wip-header-bar">
        <button class="combat-wip-back-btn" id="combatWipBackBtn">← Back</button>
        <div class="combat-wip-title">🛠️ New Combat Tool (WIP)</div>
        <div></div>
      </div>
      <div class="combat-wip-body" id="combatWipBody">${renderBody(session)}</div>
    </div>`;
}

function renderBody(state) {
  if (!state || !state.active) {
    return `
      <div class="combat-wip-empty">
        <h2>No active session</h2>
        <p>Phase 1 slice: create a session, add test participants, and confirm the turn order / reaction rules sync live across every open tab.</p>
        <button class="combat-wip-btn-primary" id="createSessionBtn">Create Session</button>
      </div>`;
  }

  const activeId = state.turnOrder[state.turnIndex];
  const orderLabel = state.turnOrder.map(id => state.participants[id]?.name || '?').join(' → ') || '(no participants yet)';

  return `
    <div class="combat-wip-round-bar">
      <div>
        <div class="combat-wip-round-label">Round ${state.round}</div>
        <div style="font-size:0.8rem;color:#a0a0c0;">${orderLabel}</div>
        ${state.reactingParticipantId ? `<div class="combat-wip-reacting-note">⚡ ${state.participants[state.reactingParticipantId]?.name} is reacting out of turn</div>` : ''}
      </div>
      <div style="display:flex; gap:0.5rem;">
        <button class="combat-wip-btn-secondary" id="advanceTurnBtn" ${state.reactingParticipantId ? 'disabled' : ''}>Advance Turn →</button>
        <button class="combat-wip-btn-danger" id="endSessionBtn">End Session</button>
      </div>
    </div>

    <form class="combat-wip-add-form" id="addParticipantForm">
      <input type="text" name="name" placeholder="Name" required>
      <select name="side">
        <option value="player">Player</option>
        <option value="enemy">Enemy</option>
      </select>
      <select name="status">
        <option value="participating">Participating</option>
        <option value="spectating">Spectating</option>
      </select>
      <input type="number" name="maxHP" placeholder="HP" value="20" min="0">
      <input type="number" name="maxVP" placeholder="VP" value="10" min="0">
      <input type="text" name="type1" placeholder="Type 1 (optional)" style="width:110px;">
      <input type="text" name="type2" placeholder="Type 2 (optional)" style="width:110px;">
      <button type="submit" class="combat-wip-btn-primary">Add</button>
    </form>

    <div class="combat-wip-participant-list">
      ${Object.values(state.participants).map(p => renderParticipant(p, state, activeId)).join('') || '<p style="color:#a0a0c0;">No participants yet.</p>'}
    </div>`;
}

function renderParticipant(p, state, activeId) {
  const isActive = p.id === activeId && !state.reactingParticipantId;
  const isReacting = p.id === state.reactingParticipantId;
  const canReact = p.status === 'participating' && !p.reactionUsed && !state.reactingParticipantId && p.id !== activeId;
  const classes = ['combat-wip-participant'];
  if (isActive) classes.push('active-turn');
  if (isReacting) classes.push('reacting');
  if (p.status === 'spectating') classes.push('spectating');

  const visToggle = (field, label) => `
    <button class="${p.visibility[field] ? 'on' : ''}" data-vis-id="${p.id}" data-vis-field="${field}" data-vis-value="${p.visibility[field] ? 0 : 1}">
      ${label} ${p.visibility[field] ? '👁️' : '🚫'}
    </button>`;

  return `
    <div class="${classes.join(' ')}">
      <span class="combat-wip-side-badge ${p.side}">${p.side}</span>
      <span class="combat-wip-p-name">${p.name}</span>
      <span class="combat-wip-p-stats">HP ${p.currentHP}/${p.maxHP} · VP ${p.currentVP}/${p.maxVP}${[p.type1, p.type2].filter(Boolean).length ? ' · ' + [p.type1, p.type2].filter(Boolean).join('/') : ''}</span>
      <div class="combat-wip-p-controls">
        <button data-toggle-status="${p.id}" data-next-status="${p.status === 'participating' ? 'spectating' : 'participating'}">
          ${p.status === 'participating' ? 'Bench' : 'Join Fight'}
        </button>
        <button data-reaction="${p.id}" ${canReact ? '' : 'disabled'}>⚡ React${p.reactionUsed ? ' (used)' : ''}</button>
        ${p.side === 'enemy' ? visToggle('hp', 'HP') + visToggle('vp', 'VP') + visToggle('name', 'Name') : ''}
        <button data-use-move="${p.id}" title="Only works when it's this participant's turn (or they're reacting) -- server enforces it">⚔️ Use Move</button>
        <button data-play-anim="${p.id}" data-anim-species="${p.name}" title="Test the display screen's animation playback">🎬 Play Anim</button>
        <button class="remove" data-remove="${p.id}">Remove</button>
      </div>
    </div>`;
}

export function attachCombatWipListeners() {
  document.getElementById('combatWipBackBtn')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('navigate', { detail: { route: 'combat' } }));
  });

  // Re-render in place on every live combat push (see live-updates.js) --
  // this is the actual thing this slice exists to prove out.
  if (combatUpdateHandler) window.removeEventListener('app:combat-updated', combatUpdateHandler);
  combatUpdateHandler = (e) => {
    session = e.detail;
    const body = document.getElementById('combatWipBody');
    if (body) body.innerHTML = renderBody(session);
    attachBodyListeners();
  };
  window.addEventListener('app:combat-updated', combatUpdateHandler);

  attachBodyListeners();
}

function attachBodyListeners() {
  document.getElementById('createSessionBtn')?.addEventListener('click', async () => {
    await CombatAPI.createSession();
  });

  document.getElementById('endSessionBtn')?.addEventListener('click', async () => {
    await CombatAPI.endSession();
  });

  document.getElementById('advanceTurnBtn')?.addEventListener('click', async () => {
    try { await CombatAPI.advanceTurn(); } catch (err) { alert(err.message); }
  });

  document.getElementById('addParticipantForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const data = new FormData(form);
    const maxHP = parseInt(data.get('maxHP'), 10) || 0;
    const maxVP = parseInt(data.get('maxVP'), 10) || 0;
    await CombatAPI.addParticipant({
      name: data.get('name'),
      side: data.get('side'),
      status: data.get('status'),
      maxHP, currentHP: maxHP,
      maxVP, currentVP: maxVP,
      type1: data.get('type1') || '',
      type2: data.get('type2') || '',
    });
    form.reset();
  });

  document.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', () => CombatAPI.removeParticipant(btn.dataset.remove));
  });

  document.querySelectorAll('[data-toggle-status]').forEach(btn => {
    btn.addEventListener('click', () => CombatAPI.setStatus(btn.dataset.toggleStatus, btn.dataset.nextStatus));
  });

  document.querySelectorAll('[data-reaction]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try { await CombatAPI.reactionStart(btn.dataset.reaction); } catch (err) { alert(err.message); }
    });
  });

  document.querySelectorAll('[data-use-move]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.useMove;
      const move = prompt('Move name (VP cost is looked up server-side from the moves dataset):');
      if (!move) return;
      const targetId = await pickTarget(id) || undefined;
      const rollStr = targetId ? prompt('Dice roll result (the raw number rolled at the table, optional):', '') : '';
      const diceRoll = rollStr ? parseInt(rollStr, 10) : undefined;
      try {
        const result = await CombatAPI.useMove(id, move, { targetId, diceRoll });
        if (result.multiplier !== undefined) {
          alert(`${result.multiplier}× effectiveness -- ${result.damageApplied} damage applied`);
        }
      } catch (err) { alert(err.message); }
    });
  });

  document.querySelectorAll('[data-play-anim]').forEach(btn => {
    btn.addEventListener('click', () => {
      const species = prompt('Species name for the animation clip (must match an uploaded battle-animation filename):', btn.dataset.animSpecies);
      if (species) CombatAPI.playAnimation(btn.dataset.playAnim, species);
    });
  });

  document.querySelectorAll('[data-vis-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      CombatAPI.setVisibility(btn.dataset.visId, btn.dataset.visField, btn.dataset.visValue === '1');
    });
  });

  if (session && session.reactingParticipantId) {
    document.getElementById('advanceTurnBtn')?.insertAdjacentHTML('afterend',
      '<button class="combat-wip-btn-secondary" id="reactionEndBtn">End Reaction</button>');
    document.getElementById('reactionEndBtn')?.addEventListener('click', () => CombatAPI.reactionEnd());
  }
}
