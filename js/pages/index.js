// Landing Page (Index) - Continue Journey or Start New Adventure
import { GameDataAPI } from '../api.js';
import { audioManager } from '../utils/audio.js';
import { getSettings, saveSettings } from '../utils/settings.js';

export function renderIndex() {
  return `
    <div class="landing-page">
      <style>
        body, .content {
          background: linear-gradient(135deg, #c41111 0%, #970909 50%, #6e0404 100%);
          min-height: 100vh;
        }

        .landing-page {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 85vh;
          text-align: center;
          position: relative;
          padding: clamp(1rem, 3vh, 3rem);
        }

        /* Decorative Pokeball Background */
        .landing-page::before {
          content: '';
          position: absolute;
          width: min(50vw, 60vh);
          height: min(50vw, 60vh);
          background: radial-gradient(circle, rgba(255,255,255,0.05) 0%, transparent 70%);
          border-radius: 50%;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          z-index: 0;
          pointer-events: none;
        }

        .landing-title {
          font-size: clamp(2rem, 6vw, 4rem);
          color: white;
          margin-bottom: clamp(0.75rem, 2vh, 1.5rem);
          text-shadow: 0 clamp(2px, 0.8vh, 5px) clamp(6px, 2vw, 12px) rgba(0,0,0,0.5),
                       0 0 clamp(10px, 3vw, 25px) rgba(255,222,0,0.3);
          font-weight: 900;
          letter-spacing: clamp(1px, 0.3vw, 3px);
          position: relative;
          z-index: 1;
          animation: titleGlow 2s ease-in-out infinite alternate;
        }

        @keyframes titleGlow {
          from {
            text-shadow: 0 clamp(2px, 0.8vh, 5px) clamp(6px, 2vw, 12px) rgba(0,0,0,0.5),
                         0 0 clamp(10px, 3vw, 25px) rgba(255,222,0,0.3);
          }
          to {
            text-shadow: 0 clamp(2px, 0.8vh, 5px) clamp(8px, 2.5vw, 18px) rgba(0,0,0,0.7),
                         0 0 clamp(15px, 4vw, 35px) rgba(255,222,0,0.5);
          }
        }

        .landing-subtitle {
          font-size: clamp(1rem, 3vw, 1.8rem);
          color: #FFDE00;
          margin-bottom: clamp(2rem, 5vh, 4rem);
          text-shadow: 0 clamp(1px, 0.3vh, 3px) clamp(3px, 1vw, 7px) rgba(0,0,0,0.5);
          font-weight: 600;
          position: relative;
          z-index: 1;
        }

        .landing-buttons {
          display: flex;
          flex-direction: column;
          gap: clamp(1rem, 2.5vh, 2rem);
          width: 90%;
          max-width: min(60vw, 70vh);
          position: relative;
          z-index: 1;
        }

        .landing-button {
          padding: clamp(1.5rem, 3vh, 2.5rem) clamp(2rem, 5vw, 4rem);
          font-size: clamp(1.2rem, 3vw, 2rem);
          font-weight: bold;
          color: #333;
          background: linear-gradient(135deg, #FFFFFF 0%, #F5F5F5 100%);
          border: 2px solid var(--border-accent);
          border-radius: clamp(15px, 3vw, 30px);
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 clamp(5px, 1.5vh, 12px) clamp(15px, 3vw, 25px) rgba(0,0,0,0.3),
                      inset 0 clamp(-2px, -0.5vh, -4px) 0 rgba(0,0,0,0.1);
          position: relative;
          overflow: hidden;
        }

        .landing-button::before {
          content: '';
          position: absolute;
          top: 50%;
          left: 50%;
          width: 0;
          height: 0;
          border-radius: 50%;
          background: rgba(255,222,0,0.3);
          transform: translate(-50%, -50%);
          transition: width 0.5s, height 0.5s;
        }

        .landing-button:hover {
          transform: translateY(clamp(-5px, -1.2vh, -10px)) scale(1.02);
          box-shadow: 0 clamp(8px, 2vh, 16px) clamp(20px, 4vw, 35px) rgba(0,0,0,0.4),
                      inset 0 clamp(-2px, -0.5vh, -4px) 0 rgba(0,0,0,0.1),
                      0 0 clamp(15px, 3vw, 25px) rgba(255,222,0,0.6);
          border-color: #FFC700;
        }

        .landing-button:hover::before {
          width: clamp(200px, 40vw, 350px);
          height: clamp(200px, 40vw, 350px);
        }

        .landing-button:active {
          transform: translateY(clamp(-3px, -0.8vh, -6px)) scale(1.0);
          box-shadow: 0 clamp(4px, 1vh, 8px) clamp(10px, 2.5vw, 18px) rgba(0,0,0,0.3);
        }

        /* Cache Reset Button */
        .cache-reset-button {
          position: fixed;
          top: clamp(15px, 3vh, 20px);
          right: clamp(15px, 3vw, 20px);
          background: linear-gradient(135deg, #FF6B6B 0%, #EE5A5A 100%);
          color: white;
          border: 2px solid var(--border-accent);
          border-radius: clamp(8px, 2vw, 12px);
          padding: clamp(0.6rem, 1.5vh, 0.9rem) clamp(1rem, 2.5vw, 1.5rem);
          font-size: clamp(0.85rem, 2vw, 1rem);
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: clamp(0.3px, 0.2vw, 0.5px);
          cursor: pointer;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          z-index: 1000;
          display: flex;
          align-items: center;
          gap: clamp(0.3rem, 0.8vw, 0.5rem);
        }

        .cache-reset-button:hover {
          transform: translateY(-2px) scale(1.05);
          box-shadow: 0 6px 18px rgba(0,0,0,0.4),
                      0 0 15px rgba(255,222,0,0.5);
          background: linear-gradient(135deg, #FF5555 0%, #DD4444 100%);
        }

        .cache-reset-button:active {
          transform: translateY(0) scale(1.0);
          box-shadow: 0 3px 8px rgba(0,0,0,0.3);
        }

        .cache-reset-icon {
          font-size: clamp(1rem, 2.5vw, 1.3rem);
        }

        @media (max-width: 1024px) {
          .landing-buttons {
            max-width: min(65vw, 75vh);
          }
        }

        @media (max-width: 768px) {
          .landing-buttons {
            max-width: min(70vw, 80vh);
            gap: clamp(0.9rem, 2.2vh, 1.8rem);
          }
        }

        @media (max-width: 600px) {
          .landing-buttons {
            max-width: min(75vw, 85vh);
            gap: clamp(0.8rem, 2vh, 1.5rem);
          }

          .landing-button {
            padding: clamp(1.2rem, 2.5vh, 2rem) clamp(1.5rem, 4vw, 3rem);
          }
        }

        @media (max-width: 480px) {
          .landing-buttons {
            max-width: 85vw;
          }

          .landing-button {
            padding: clamp(1rem, 2vh, 1.5rem) clamp(1.2rem, 3.5vw, 2rem);
          }

          .cache-reset-button {
            padding: clamp(0.5rem, 1.2vh, 0.7rem) clamp(0.8rem, 2vw, 1rem);
            font-size: clamp(0.75rem, 1.8vw, 0.9rem);
          }
        }

        @media (max-width: 360px) {
          .landing-buttons {
            max-width: 90vw;
            gap: clamp(0.75rem, 1.8vh, 1.2rem);
          }

          .landing-page {
            padding: clamp(0.75rem, 2vh, 2rem);
          }
        }

        /* Cache Reset Modal */
        .cache-modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.65);
          z-index: 9999;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1rem;
        }

        .cache-modal {
          background: linear-gradient(145deg, #2a0808 0%, #1a0404 100%);
          border: 2px solid var(--border-accent);
          border-radius: clamp(12px, 2.5vw, 20px);
          padding: clamp(1.5rem, 4vw, 2.5rem) clamp(1.5rem, 5vw, 3rem);
          max-width: min(420px, 90vw);
          width: 100%;
          box-shadow: 0 8px 32px rgba(0,0,0,0.6), 0 0 30px rgba(255,222,0,0.15);
          text-align: center;
          animation: modalPop 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
        }

        @keyframes modalPop {
          from { transform: scale(0.85); opacity: 0; }
          to   { transform: scale(1);    opacity: 1; }
        }

        .cache-modal-icon {
          font-size: clamp(2rem, 6vw, 3rem);
          margin-bottom: 0.5rem;
        }

        .cache-modal-title {
          font-size: clamp(1.2rem, 3.5vw, 1.6rem);
          font-weight: 900;
          color: #FFDE00;
          margin: 0 0 0.75rem;
          text-shadow: 0 2px 8px rgba(0,0,0,0.5);
          letter-spacing: 0.5px;
        }

        .cache-modal-message {
          font-size: clamp(0.85rem, 2.2vw, 1rem);
          color: rgba(255,255,255,0.85);
          margin: 0 0 1.75rem;
          line-height: 1.5;
        }

        .cache-modal-buttons {
          display: flex;
          gap: 1rem;
          justify-content: center;
        }

        .cache-modal-btn {
          flex: 1;
          max-width: 140px;
          padding: clamp(0.6rem, 1.5vh, 0.85rem) 1rem;
          font-size: clamp(0.85rem, 2vw, 1rem);
          font-weight: 700;
          border-radius: clamp(8px, 2vw, 12px);
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          border: 2px solid transparent;
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }

        .cache-modal-cancel {
          background: rgba(255,255,255,0.1);
          color: rgba(255,255,255,0.8);
          border-color: rgba(255,255,255,0.25);
        }

        .cache-modal-cancel:hover {
          background: rgba(255,255,255,0.18);
          border-color: rgba(255,255,255,0.45);
          color: #fff;
        }

        .cache-modal-confirm {
          background: linear-gradient(135deg, #FF6B6B 0%, #C91010 100%);
          color: #fff;
          border-color: #FFDE00;
        }

        .cache-modal-confirm:hover {
          background: linear-gradient(135deg, #FF5555 0%, #A00808 100%);
          box-shadow: 0 4px 14px rgba(0,0,0,0.4), 0 0 14px rgba(255,222,0,0.4);
          transform: translateY(-2px);
        }

        .cache-modal-ok {
          background: linear-gradient(135deg, #4CAF50 0%, #2e7d32 100%);
          color: #fff;
          border-color: #FFDE00;
          width: 100%;
          max-width: 180px;
        }

        .cache-modal-ok:hover {
          background: linear-gradient(135deg, #43A047 0%, #1b5e20 100%);
          box-shadow: 0 4px 14px rgba(0,0,0,0.4), 0 0 14px rgba(255,222,0,0.4);
          transform: translateY(-2px);
        }

        /* Last Data Update Tag */
        .app-update-tag {
          position: fixed;
          bottom: clamp(8px, 1.5vh, 14px);
          right: clamp(10px, 2vw, 16px);
          font-family: monospace;
          font-size: clamp(0.65rem, 1.4vw, 0.8rem);
          font-weight: 500;
          color: rgba(255, 255, 255, 0.45);
          text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
          z-index: 1000;
          pointer-events: none;
        }

        /* Settings Modal */
        .settings-modal {
          text-align: left;
          max-width: min(440px, 90vw);
        }

        .settings-modal .cache-modal-title,
        .settings-modal .cache-modal-icon {
          text-align: center;
        }

        .settings-row {
          margin: 0 0 1.25rem;
        }

        .settings-row label {
          display: block;
          font-size: clamp(0.8rem, 2vw, 0.95rem);
          color: rgba(255,255,255,0.85);
          margin-bottom: 0.4rem;
        }

        .settings-row-checkbox {
          display: flex;
          align-items: center;
          gap: 0.6rem;
        }

        .settings-row-checkbox label {
          margin-bottom: 0;
          flex: 1;
        }

        .settings-row-checkbox input[type="checkbox"] {
          width: 1.2rem;
          height: 1.2rem;
          accent-color: #FFDE00;
          flex-shrink: 0;
        }

        .settings-row-value {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .settings-row-value input[type="range"] {
          flex: 1;
          accent-color: #FFDE00;
        }

        .settings-row-value span {
          font-family: monospace;
          font-size: 0.85rem;
          color: #FFDE00;
          min-width: 2.5em;
          text-align: right;
        }

        .settings-divider {
          height: 1px;
          background: rgba(255,255,255,0.15);
          margin: 1.25rem 0;
        }

        .settings-info {
          font-size: clamp(0.75rem, 1.8vw, 0.85rem);
          color: rgba(255,255,255,0.6);
          margin-bottom: 1.25rem;
          line-height: 1.6;
        }

        .settings-info span {
          color: rgba(255,255,255,0.85);
          font-family: monospace;
        }

        .settings-reset-btn {
          width: 100%;
          max-width: none;
          margin-bottom: 1rem;
        }
      </style>

      <!-- Cache Reset Confirm Modal -->
      <div id="cacheModal" class="cache-modal-overlay" style="display:none;">
        <div class="cache-modal">
          <div class="cache-modal-icon" id="cacheModalIcon">🔄</div>
          <h2 class="cache-modal-title" id="cacheModalTitle">Reset Cache?</h2>
          <p class="cache-modal-message" id="cacheModalMessage">This will clear all session data and reload the page.</p>
          <div class="cache-modal-buttons" id="cacheModalButtons">
            <button class="cache-modal-btn cache-modal-cancel" id="cacheModalCancel">Cancel</button>
            <button class="cache-modal-btn cache-modal-confirm" id="cacheModalConfirm">Reset</button>
          </div>
        </div>
      </div>

      <!-- Settings Modal -->
      <div id="settingsModal" class="cache-modal-overlay" style="display:none;">
        <div class="cache-modal settings-modal">
          <div class="cache-modal-icon">⚙️</div>
          <h2 class="cache-modal-title">Settings</h2>

          <div class="settings-row">
            <label for="volumeSlider">Volume</label>
            <div class="settings-row-value">
              <input type="range" id="volumeSlider" min="0" max="100" step="1">
              <span id="volumeValue">80</span>
            </div>
          </div>

          <div class="settings-row settings-row-checkbox">
            <label for="syncMusicCheckbox">Synchronize music across devices</label>
            <input type="checkbox" id="syncMusicCheckbox">
          </div>

          <div class="settings-row">
            <label for="idleSplashSlider">Show splash art after idle (minutes)</label>
            <div class="settings-row-value">
              <input type="range" id="idleSplashSlider" min="5" max="30" step="1">
              <span id="idleSplashValue">10</span>
            </div>
          </div>

          <div class="settings-divider"></div>

          <div class="settings-info">
            Last data update: <span id="settingsLastUpdate">—</span>
          </div>

          <button class="cache-modal-btn cache-modal-confirm settings-reset-btn" id="settingsResetCacheButton">
            🔄 Reset Cache
          </button>

          <div class="cache-modal-buttons">
            <button class="cache-modal-btn cache-modal-ok" id="settingsCloseButton" style="max-width:none;">Close</button>
          </div>
        </div>
      </div>

      <!-- Settings Button -->
      <button class="cache-reset-button" id="settingsButton">
        <span class="cache-reset-icon">⚙️</span>
        <span>Settings</span>
      </button>

      <h1 class="landing-title">Shima Pokemon D&D</h1>
      <div class="landing-subtitle">Your Adventure Awaits</div>

      <div class="landing-buttons">
        <button class="landing-button" data-route="continue-journey">
          Continue Journey
        </button>
        <button class="landing-button" data-route="new-journey">
          Start New Adventure
        </button>
      </div>

      <div class="app-update-tag">Last data update: <span id="appUpdateTag"></span></div>
    </div>
  `;
}

// "Updated 2h ago" from an ISO timestamp; falls back gracefully when unset
// (e.g. Apps Script backend, which never sends X-Data-Version at all).
function formatLastUpdate(iso) {
  if (!iso) return 'unknown';
  const then = new Date(iso);
  if (isNaN(then)) return 'unknown';
  const minutes = Math.floor((Date.now() - then.getTime()) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function attachIndexListeners() {
  const updateTag = document.getElementById('appUpdateTag');
  if (updateTag) updateTag.textContent = formatLastUpdate(localStorage.getItem('lastDataUpdate'));

  // Show TitleScreen loading screen immediately when Continue Journey is clicked
  const continueBtn = document.querySelector('[data-route="continue-journey"]');
  if (continueBtn) {
    continueBtn.addEventListener('click', () => {
      const loadingScreen = document.getElementById('loading-screen');
      if (loadingScreen) {
        loadingScreen.style.backgroundImage = "url('assets/TitleScreen.png')";
        const progressContainer = loadingScreen.querySelector('.loading-progress-container');
        if (progressContainer) progressContainer.style.display = 'none';
        loadingScreen.classList.add('active');
      }
    }, { capture: true });
  }

  // Cache Reset Button — custom modal
  const cacheModal   = document.getElementById('cacheModal');
  const modalTitle   = document.getElementById('cacheModalTitle');
  const modalIcon    = document.getElementById('cacheModalIcon');
  const modalMessage = document.getElementById('cacheModalMessage');
  const modalButtons = document.getElementById('cacheModalButtons');

  const showCacheModal = ({ icon, title, message, buttons }) => {
    modalIcon.textContent    = icon;
    modalTitle.textContent   = title;
    modalMessage.textContent = message;
    modalButtons.innerHTML   = buttons;
    cacheModal.style.display = 'flex';
  };

  const hideCacheModal = () => { cacheModal.style.display = 'none'; };

  // Close on overlay click
  cacheModal?.addEventListener('click', (e) => { if (e.target === cacheModal) hideCacheModal(); });

  // Settings modal
  const settingsModal = document.getElementById('settingsModal');
  const showSettingsModal = () => { settingsModal.style.display = 'flex'; };
  const hideSettingsModal = () => { settingsModal.style.display = 'none'; };
  settingsModal?.addEventListener('click', (e) => { if (e.target === settingsModal) hideSettingsModal(); });

  const volumeSlider = document.getElementById('volumeSlider');
  const volumeValue = document.getElementById('volumeValue');
  const syncMusicCheckbox = document.getElementById('syncMusicCheckbox');
  const idleSplashSlider = document.getElementById('idleSplashSlider');
  const idleSplashValue = document.getElementById('idleSplashValue');

  document.getElementById('settingsButton')?.addEventListener('click', () => {
    const settings = getSettings();
    volumeSlider.value = settings.volume;
    volumeValue.textContent = settings.volume;
    syncMusicCheckbox.checked = settings.syncMusic;
    idleSplashSlider.value = settings.idleSplashMinutes;
    idleSplashValue.textContent = settings.idleSplashMinutes;
    document.getElementById('settingsLastUpdate').textContent =
      formatLastUpdate(localStorage.getItem('lastDataUpdate'));
    showSettingsModal();
  });

  document.getElementById('settingsCloseButton')?.addEventListener('click', hideSettingsModal);

  volumeSlider?.addEventListener('input', () => {
    volumeValue.textContent = volumeSlider.value;
    audioManager.setVolume(parseInt(volumeSlider.value, 10));
  });
  volumeSlider?.addEventListener('change', () => {
    saveSettings({ volume: parseInt(volumeSlider.value, 10) });
  });

  syncMusicCheckbox?.addEventListener('change', () => {
    saveSettings({ syncMusic: syncMusicCheckbox.checked });
  });

  idleSplashSlider?.addEventListener('input', () => {
    idleSplashValue.textContent = idleSplashSlider.value;
  });
  idleSplashSlider?.addEventListener('change', () => {
    saveSettings({ idleSplashMinutes: parseInt(idleSplashSlider.value, 10) });
  });

  document.getElementById('settingsResetCacheButton')?.addEventListener('click', () => {
    hideSettingsModal();
    showCacheModal({
      icon: '🔄',
      title: 'Reset Cache?',
      message: 'This will clear all session data and reload the page.',
      buttons: `
        <button class="cache-modal-btn cache-modal-cancel" id="cacheModalCancel">Cancel</button>
        <button class="cache-modal-btn cache-modal-confirm" id="cacheModalConfirm">Reset</button>
      `,
    });

    // Attach buttons after injecting HTML
    setTimeout(() => {
      document.getElementById('cacheModalCancel')?.addEventListener('click', hideCacheModal);
      document.getElementById('cacheModalConfirm')?.addEventListener('click', async () => {
        // Show progress while the server refreshes its data
        showCacheModal({
          icon: '⏳',
          title: 'Refreshing...',
          message: 'Fetching fresh game data on the server. This usually takes a few seconds.',
          buttons: '',
        });

        // Refresh the SERVER-side upstream cache in place (pokemon dex,
        // moves, items, pokedex config) so the data is fresh AND the cache
        // stays warm. Best-effort: keep going even if the backend is
        // unreachable.
        try {
          await GameDataAPI.clearServerCache();
        } catch (e) {
          console.warn('Server cache clear failed (continuing):', e.message);
        }

        // Clear sessionStorage
        sessionStorage.clear();

        // Clear localStorage, but keep device preferences (volume/sync/idle
        // timer) -- those are settings, not cached server data, and this
        // button is the reason they never seemed to "stick".
        const savedSettings = localStorage.getItem('appSettings');
        localStorage.clear();
        if (savedSettings) localStorage.setItem('appSettings', savedSettings);

        // Show success state
        showCacheModal({
          icon: '✅',
          title: 'Cache Cleared!',
          message: 'Server and device caches have been cleared. The page will now reload.',
          buttons: `<button class="cache-modal-btn cache-modal-ok" id="cacheModalOk">OK</button>`,
        });

        setTimeout(() => {
          document.getElementById('cacheModalOk')?.addEventListener('click', () => {
            window.location.reload();
          });
        }, 0);
      });
    }, 0);
  });
}
