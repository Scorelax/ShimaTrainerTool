// New shared combat tool -- work in progress, Joey-only entry point (see combat.js setup header).
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
  .combat-wip-body { max-width: 600px; margin: 0 auto; padding: 3rem 1rem; text-align: center; }
  .combat-wip-body h2 { color: #FFD700; margin-bottom: 0.5rem; }
  .combat-wip-body p { color: #a0a0c0; line-height: 1.5; }
`;

export function renderCombatWip() {
  return `
    <div class="combat-wip-page">
      <style>${WIP_CSS}</style>
      <div class="combat-wip-header-bar">
        <button class="combat-wip-back-btn" id="combatWipBackBtn">← Back</button>
        <div class="combat-wip-title">🛠️ New Combat Tool (WIP)</div>
        <div></div>
      </div>
      <div class="combat-wip-body">
        <h2>Under construction</h2>
        <p>This is the shared combat tool being built alongside the current combat page. Nothing here yet -- check back as pieces land.</p>
      </div>
    </div>`;
}

export function attachCombatWipListeners() {
  document.getElementById('combatWipBackBtn')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('navigate', { detail: { route: 'combat' } }));
  });
}
