// Landing Page (Index) - Continue Journey or Start New Adventure
export function renderIndex() {
  return `
    <div class="landing-page">
      <style>
        body, .content {
          background: linear-gradient(135deg, #EE1515 0%, #C91010 50%, #A00808 100%);
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
          border: clamp(3px, 0.5vw, 6px) solid #FFDE00;
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
          border: clamp(2px, 0.5vw, 3px) solid #FFDE00;
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
          border: 2px solid #FFDE00;
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

      <!-- Cache Reset Button -->
      <button class="cache-reset-button" id="cacheResetButton">
        <span class="cache-reset-icon">🔄</span>
        <span>Reset Cache</span>
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
    </div>
  `;
}

export function attachIndexListeners() {
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

  document.getElementById('cacheResetButton')?.addEventListener('click', () => {
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
      document.getElementById('cacheModalConfirm')?.addEventListener('click', () => {
        // Clear sessionStorage
        sessionStorage.clear();

        // Clear localStorage (if used)
        localStorage.clear();

        // Clear any service worker cache if present
        if ('caches' in window) {
          caches.keys().then(names => { names.forEach(name => caches.delete(name)); });
        }

        // Unregister service workers if present
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.getRegistrations().then(registrations => {
            registrations.forEach(r => r.unregister());
          });
        }

        // Show success state
        showCacheModal({
          icon: '✅',
          title: 'Cache Cleared!',
          message: 'All session data has been cleared. The page will now reload.',
          buttons: `<button class="cache-modal-btn cache-modal-ok" id="cacheModalOk">OK</button>`,
        });

        setTimeout(() => {
          document.getElementById('cacheModalOk')?.addEventListener('click', () => {
            window.location.reload(true);
          });
        }, 0);
      });
    }, 0);
  });
}
