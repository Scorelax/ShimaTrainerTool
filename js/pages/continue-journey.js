// Continue Journey Page - Trainer Selection with PIN
import { TrainerAPI } from '../api.js';
import { selectAndPreloadSplashImage } from '../utils/splash.js';

// ============================================================================
// KNOWN MOVES SYNC
// Run once after moves are loaded into sessionStorage on login.
// Ensures pokemonData[59] (KnownMoves) is up-to-date: new recharge moves are
// added at full charges, stale moves are pruned, existing charge counts are kept.
// ============================================================================

function _parseRechargeForSync(actionType) {
  if (!actionType) return null;
  const lower = actionType.toLowerCase();
  if (!lower.includes('recharge')) return null;
  const m = lower.match(/recharge\s*\(([^)]+)\)/);
  if (!m) return null;
  const type = m[1].includes('long') ? 'LR' : 'SR';
  const chargeMatch = actionType.match(/(\d+)\s+charges?/i);
  return { maxCharges: chargeMatch ? parseInt(chargeMatch[1]) : 1, type };
}

function _parseKnownMovesForSync(str) {
  const result = {};
  if (!str) return result;
  str.split(',').map(s => s.trim()).filter(Boolean).forEach(part => {
    const match = part.match(/^(.+?)\((\d+)\)\((\w+)\)$/);
    if (match) result[match[1]] = { chargesLeft: parseInt(match[2]), type: match[3] };
  });
  return result;
}

function syncKnownMovesForAllPokemon() {
  const allMoves = JSON.parse(sessionStorage.getItem('moves') || '[]');
  if (allMoves.length === 0) return;

  const trainerName = JSON.parse(sessionStorage.getItem('trainerData') || '[]')[1] || '';
  const pokemonKeys = Object.keys(sessionStorage).filter(k => k.startsWith('pokemon_'));

  pokemonKeys.forEach(key => {
    const pokemonData = JSON.parse(sessionStorage.getItem(key));
    if (!pokemonData) return;

    const level = parseInt(pokemonData[4]) || 1;

    // Collect all moves this Pokemon currently knows (same logic as buildPokemonCombatant)
    const moveIndices =   [23, 24, 25, 26, 27, 28, 37];
    const requiredLevels = [ 1,  2,  6, 10, 14, 18,  0];
    const currentMoves = [];
    moveIndices.forEach((idx, i) => {
      if (level >= requiredLevels[i] || (idx === 37 && pokemonData[idx])) {
        const raw = pokemonData[idx] || '';
        if (raw) raw.split(',').map(m => m.trim()).filter(Boolean).forEach(m => currentMoves.push(m));
      }
    });

    // Build new KnownMoves map: preserve existing charges, add new recharge moves at full
    const existing = _parseKnownMovesForSync(pokemonData[59] || '');
    const updated = {};
    currentMoves.forEach(moveName => {
      const moveData = allMoves.find(m => m[0] === moveName);
      if (!moveData) return;
      const recharge = _parseRechargeForSync(moveData[3] || '');
      if (!recharge) return;
      // If we already track this move keep its current charge count; otherwise start at max
      updated[moveName] = existing[moveName] !== undefined
        ? existing[moveName]
        : { chargesLeft: recharge.maxCharges, type: recharge.type };
    });

    const oldStr = pokemonData[59] || '';
    const newStr = Object.entries(updated)
      .map(([n, s]) => `${n}(${s.chargesLeft})(${s.type})`).join(',');

    if (oldStr !== newStr) {
      pokemonData[59] = newStr;
      sessionStorage.setItem(key, JSON.stringify(pokemonData));

      // Persist to database in background (only if there is a value to write)
      if (trainerName && pokemonData[2]) {
        import('../api.js').then(({ PokemonAPI }) => {
          PokemonAPI.updateLiveStats(trainerName, pokemonData[2], 'KnownMoves', newStr)
            .catch(e => console.error(`KnownMoves sync failed for ${pokemonData[2]}:`, e));
        });
      }

      console.log(`[KnownMoves] Synced ${pokemonData[2]}: "${oldStr || '(empty)'}" → "${newStr || '(none)'}"`);
    }
  });
}

// Progress tracking utility
function updateLoadingProgress(percent, text) {
  const fill = document.getElementById('loading-progress-fill');
  const progressText = document.getElementById('loading-progress-text');

  if (fill) {
    fill.style.width = `${percent}%`;
  }
  if (progressText && text) {
    progressText.textContent = text;
  }
}

export async function renderContinueJourney() {
  // Fetch trainers
  const response = await TrainerAPI.getAll();
  const trainers = response.data || [];

  const html = `
    <div class="continue-journey-page">
      <style>
        body, .content {
          background: linear-gradient(135deg, #EE1515 0%, #C91010 50%, #A00808 100%);
          min-height: 100vh;
        }

        .continue-journey-page h1 {
          margin-top: 2vh;
          margin-bottom: 2vh;
          color: white;
          text-align: center;
          font-size: clamp(1.5rem, 4vw, 2.5rem);
          font-weight: 900;
          letter-spacing: clamp(0.5px, 0.15vw, 1.5px);
          text-shadow: 0 clamp(2px, 0.8vh, 5px) clamp(6px, 2vw, 12px) rgba(0,0,0,0.5),
                       0 0 clamp(10px, 3vw, 25px) rgba(255,222,0,0.3);
        }

        .continue-journey-page {
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .trainer-list-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 90%;
          max-width: min(100vw, 1200px);
        }

        .trainer-container {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: clamp(1rem, 3vw, 2.5rem);
          width: 100%;
          margin-bottom: clamp(1.5rem, 5vh, 3rem);
        }

        .trainer-box {
          display: flex;
          flex-direction: column;
          align-items: center;
          background: transparent;
          padding: 0;
          cursor: pointer;
          transition: transform 0.3s, filter 0.3s;
        }

        .trainer-box:hover {
          transform: translateY(clamp(-3px, -0.8vh, -5px));
          filter: brightness(1.1) drop-shadow(0 0 clamp(10px, 2vw, 15px) rgba(255,222,0,0.6));
        }

        .trainer-image {
          width: 85%;
          height: auto;
          aspect-ratio: 1;
          border-radius: clamp(12px, 2.5vw, 18px);
          object-fit: cover;
          margin-bottom: clamp(0.5rem, 1vh, 0.75rem);
          border: clamp(3px, 0.6vw, 4px) solid #FFDE00;
          box-shadow: 0 clamp(8px, 1.5vh, 12px) clamp(20px, 4vh, 30px) rgba(0,0,0,0.5);
          background-color: #fff;
          cursor: pointer;
        }

        .trainer-name {
          font-size: clamp(0.9rem, 1.8vw, 1.3rem);
          text-align: center;
          color: white;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: clamp(0.5px, 0.1vw, 1px);
          text-shadow: 0 clamp(2px, 0.5vh, 3px) clamp(4px, 1vh, 6px) rgba(0,0,0,0.8);
        }

        /* PIN Modal */
        .pin-modal {
          display: none;
          position: fixed;
          left: 0;
          top: 0;
          width: 100%;
          height: 100%;
          background-color: rgba(0, 0, 0, 0.7);
          backdrop-filter: blur(clamp(3px, 0.8vw, 8px));
          z-index: 9999;
          justify-content: center;
          align-items: center;
          animation: fadeIn 0.3s ease;
        }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        .pin-modal.active {
          display: flex;
        }

        .pin-modal-content {
          background: linear-gradient(135deg, #FFFFFF 0%, #F5F5F5 100%);
          border: clamp(2px, 0.4vw, 5px) solid #FFDE00;
          border-radius: clamp(15px, 3vw, 30px);
          padding: 3vh 3vw;
          box-shadow: 0 clamp(10px, 3vh, 25px) clamp(30px, 8vw, 70px) rgba(0,0,0,0.5),
                      inset 0 clamp(-3px, -0.6vh, -5px) 0 rgba(0,0,0,0.05);
          text-align: center;
          width: 90%;
          max-width: min(50vw, 60vh);
          box-sizing: border-box;
          animation: slideUp 0.3s ease;
        }

        @keyframes slideUp {
          from {
            transform: translateY(clamp(30px, 8vh, 60px));
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }

        .pin-modal-content h2 {
          font-size: clamp(1.5rem, 3vw, 2.5rem);
          margin-bottom: clamp(1rem, 2.5vh, 2rem);
          color: #333;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: clamp(0.5px, 0.15vw, 1.5px);
        }

        .pin-error {
          color: #EE1515;
          margin: clamp(0.75rem, 2vh, 1.5rem) 0;
          min-height: clamp(20px, 3vh, 30px);
          font-weight: bold;
          font-size: clamp(0.9rem, 2vw, 1.3rem);
        }

        .pin-input {
          width: clamp(180px, 30vw, 250px);
          height: clamp(50px, 10vh, 80px);
          font-size: clamp(1.5rem, 3vw, 2.5rem);
          font-weight: bold;
          padding: clamp(10px, 2vh, 20px);
          border-radius: clamp(10px, 2vw, 20px);
          border: clamp(2px, 0.4vw, 5px) solid #FFDE00;
          box-sizing: border-box;
          margin-bottom: clamp(1.5rem, 3vh, 2.5rem);
          text-align: center;
          box-shadow: inset 0 clamp(1px, 0.3vh, 3px) clamp(3px, 0.8vw, 8px) rgba(0,0,0,0.1);
          transition: all 0.3s;
        }

        .pin-input:focus {
          outline: none;
          border-color: #FFC700;
          box-shadow: inset 0 clamp(1px, 0.3vh, 3px) clamp(3px, 0.8vw, 8px) rgba(0,0,0,0.1),
                      0 0 clamp(10px, 3vw, 25px) rgba(255,222,0,0.4);
        }

        .pin-buttons {
          display: flex;
          gap: clamp(0.75rem, 2vw, 1.5rem);
          justify-content: center;
        }

        .pin-submit {
          background: linear-gradient(135deg, #4CAF50 0%, #45A049 100%);
          color: white;
          font-size: clamp(1rem, 2.2vw, 1.5rem);
          font-weight: bold;
          padding: clamp(0.75rem, 1.5vh, 1.5rem) clamp(1.5rem, 3vw, 2.5rem);
          border: none;
          border-radius: clamp(10px, 2vw, 20px);
          cursor: pointer;
          box-shadow: 0 clamp(3px, 1vh, 8px) clamp(10px, 2.5vw, 20px) rgba(76,175,80,0.4);
          transition: all 0.3s;
        }

        .pin-submit:hover {
          transform: translateY(clamp(-2px, -0.5vh, -4px));
          box-shadow: 0 clamp(5px, 1.5vh, 12px) clamp(15px, 3vw, 25px) rgba(76,175,80,0.5);
        }

        .pin-submit:active {
          transform: translateY(clamp(-1px, -0.3vh, -2px));
        }

        .pin-cancel {
          background: linear-gradient(135deg, #EE1515 0%, #C91010 100%);
          color: white;
          font-size: clamp(1rem, 2.2vw, 1.5rem);
          font-weight: bold;
          padding: clamp(0.75rem, 1.5vh, 1.5rem) clamp(1.5rem, 3vw, 2.5rem);
          border: none;
          border-radius: clamp(10px, 2vw, 20px);
          cursor: pointer;
          box-shadow: 0 clamp(3px, 1vh, 8px) clamp(10px, 2.5vw, 20px) rgba(238,21,21,0.4);
          transition: all 0.3s;
        }

        .pin-cancel:hover {
          transform: translateY(clamp(-2px, -0.5vh, -4px));
          box-shadow: 0 clamp(5px, 1.5vh, 12px) clamp(15px, 3vw, 25px) rgba(238,21,21,0.5);
        }

        .pin-cancel:active {
          transform: translateY(clamp(-1px, -0.3vh, -2px));
        }

        .back-button {
          position: fixed;
          top: clamp(10px, 2vh, 30px);
          left: clamp(10px, 2vw, 30px);
          background: linear-gradient(135deg, #FFFFFF 0%, #F5F5F5 100%);
          color: #333;
          width: clamp(40px, 8vw, 70px);
          height: clamp(40px, 8vw, 70px);
          border: clamp(2px, 0.3vw, 4px) solid #FFDE00;
          border-radius: 50%;
          font-size: clamp(1.2rem, 3vw, 2.5rem);
          font-weight: bold;
          cursor: pointer;
          box-shadow: 0 clamp(5px, 1.5vh, 12px) clamp(15px, 3vw, 25px) rgba(0,0,0,0.3);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          padding: 0;
        }

        .back-button:hover {
          transform: scale(1.1);
          box-shadow: 0 clamp(8px, 2vh, 16px) clamp(20px, 4vw, 35px) rgba(0,0,0,0.4),
                      0 0 clamp(15px, 3vw, 25px) rgba(255,222,0,0.5);
          border-color: #FFC700;
        }

        .back-button:active {
          transform: scale(1.05);
        }

        /* Tablet - keep 3 columns, adjust sizes */
        @media (max-width: 768px) {
          .trainer-container {
            gap: clamp(0.75rem, 2vw, 1.5rem);
          }

          .trainer-image {
            border-width: clamp(2px, 0.5vw, 3px);
          }

          .trainer-name {
            font-size: clamp(0.8rem, 1.6vw, 1.1rem);
          }
        }

        /* Mobile phones - keep 3 columns */
        @media (max-width: 480px) {
          .continue-journey-page h1 {
            font-size: clamp(1.2rem, 3.5vw, 1.8rem);
            margin-top: 1.5vh;
            margin-bottom: 1.5vh;
          }

          .trainer-container {
            gap: clamp(0.5rem, 1.5vw, 1rem);
          }

          .trainer-image {
            border-width: clamp(2px, 0.4vw, 3px);
            border-radius: clamp(8px, 2vw, 12px);
          }

          .trainer-name {
            font-size: clamp(0.7rem, 1.5vw, 0.95rem);
          }

          .back-button {
            width: clamp(35px, 9vw, 50px);
            height: clamp(35px, 9vw, 50px);
            font-size: clamp(1rem, 2.5vw, 1.8rem);
          }
        }

        /* Very small screens - keep 3 columns, more compact */
        @media (max-width: 360px) {
          .continue-journey-page h1 {
            font-size: clamp(1rem, 3vw, 1.4rem);
            margin-top: 1vh;
            margin-bottom: 1vh;
          }

          .trainer-list-container {
            width: 95%;
          }

          .trainer-container {
            gap: clamp(0.4rem, 1vw, 0.75rem);
          }

          .trainer-image {
            width: 90%;
            border-width: 2px;
            border-radius: clamp(6px, 1.5vw, 10px);
          }

          .trainer-name {
            font-size: clamp(0.6rem, 1.4vw, 0.8rem);
          }

          .trainer-box:hover {
            transform: translateY(-2px);
          }

          .back-button {
            width: clamp(30px, 8vw, 40px);
            height: clamp(30px, 8vw, 40px);
            font-size: clamp(0.9rem, 2.2vw, 1.4rem);
            top: clamp(8px, 1.5vh, 15px);
            left: clamp(8px, 1.5vw, 15px);
          }

          .pin-modal-content {
            padding: 2.5vh 4vw;
            width: 95%;
            max-width: min(90vw, 75vh);
          }

          .pin-modal-content h2 {
            font-size: clamp(1.2rem, 2.5vw, 1.8rem);
            margin-bottom: clamp(0.75rem, 2vh, 1.5rem);
          }

          .pin-input {
            width: clamp(140px, 40vw, 200px);
            height: clamp(40px, 8vh, 60px);
            font-size: clamp(1.2rem, 2.5vw, 2rem);
          }

          .pin-submit, .pin-cancel {
            font-size: clamp(0.85rem, 1.8vw, 1.2rem);
            padding: clamp(0.5rem, 1.2vh, 1rem) clamp(1rem, 2.5vw, 1.8rem);
          }
        }

      </style>

      <h1>Continue Journey</h1>

      <div class="trainer-list-container">
        <div class="trainer-container">
          ${trainers.map(trainer => `
            <div class="trainer-box" data-trainer-id="${trainer.id}" data-trainer-name="${trainer.name}" data-trainer-pin="${trainer.pinCode}">
              <img class="trainer-image" src="${trainer.image || 'assets/Pokeball.png'}" alt="${trainer.name}">
              <div class="trainer-name">${trainer.name || 'Unnamed Trainer'}</div>
            </div>
          `).join('')}
        </div>
      </div>

      <button class="back-button" data-route="index">←</button>

      <!-- PIN Modal -->
      <div class="pin-modal" id="pinModal">
        <div class="pin-modal-content">
          <h2>Enter PIN Code</h2>
          <div class="pin-error" id="pinError"></div>
          <input type="text" class="pin-input" id="pinInput" maxlength="4" pattern="\\d*" placeholder="4-digit PIN" />
          <div class="pin-buttons">
            <button class="pin-submit" id="pinSubmit">Submit</button>
            <button class="pin-cancel" id="pinCancel">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  `;

  return html;
}

export function attachContinueJourneyListeners() {
  let selectedTrainer = null;
  let preloadedSplashImage = null;

  // Preload splash image in background while user selects trainer
  console.log('[Splash] Preloading splash image...');
  selectAndPreloadSplashImage().then(url => {
    preloadedSplashImage = url;
    console.log('[Splash] Preloaded:', url);
  }).catch(err => {
    console.log('[Splash] Preload error:', err);
    // No fallback - splash images should always exist
  });

  // Trainer box click handlers
  document.querySelectorAll('.trainer-box').forEach(box => {
    box.addEventListener('click', () => {
      selectedTrainer = {
        id: box.dataset.trainerId,
        name: box.dataset.trainerName,
        pinCode: box.dataset.trainerPin
      };

      // Show PIN modal
      const modal = document.getElementById('pinModal');
      const input = document.getElementById('pinInput');
      const error = document.getElementById('pinError');

      modal.classList.add('active');
      input.value = '';
      error.textContent = '';
      input.focus();
    });
  });

  // PIN submit
  document.getElementById('pinSubmit')?.addEventListener('click', async () => {
    const input = document.getElementById('pinInput');
    const error = document.getElementById('pinError');

    if (input.value === selectedTrainer.pinCode.toString()) {
      // Correct PIN - load trainer data
      document.getElementById('pinModal').classList.remove('active');

      // Show fullscreen loading background immediately with preloaded splash image
      const loadingScreen = document.getElementById('loading-screen');
      if (preloadedSplashImage) {
        loadingScreen.style.backgroundImage = `url('${preloadedSplashImage}')`;
      }
      loadingScreen.classList.add('active');
      updateLoadingProgress(0, 'Connecting to server...');

      // Track which step we're at so the error screen can report it precisely
      let _step = 'connecting to server';
      const _ts  = () => new Date().toISOString();
      const _log  = (msg, ...a) => console.log( `[Login ${_ts()}] ${msg}`, ...a);
      const _warn = (msg, ...a) => console.warn(`[Login ${_ts()}] ⚠ ${msg}`, ...a);
      const _err  = (msg, ...a) => console.error(`[Login ${_ts()}] ✖ ${msg}`, ...a);

      const _showError = (step, err) => {
        _err(`FAILED at step "${step}"`, err);
        loadingScreen.classList.remove('active');
        document.getElementById('content').innerHTML = `
          <div style="
            display:flex;flex-direction:column;align-items:center;justify-content:center;
            min-height:60vh;padding:2rem;text-align:center;
          ">
            <div style="
              background:rgba(30,30,40,0.95);border:2px solid #EE1515;border-radius:16px;
              padding:2rem 2.5rem;max-width:480px;width:100%;
              box-shadow:0 8px 32px rgba(0,0,0,0.6);
            ">
              <div style="font-size:2.5rem;margin-bottom:0.75rem;">⚠️</div>
              <h2 style="color:#EE1515;margin:0 0 0.5rem;font-size:1.4rem;text-transform:uppercase;letter-spacing:1px;">
                Failed to load
              </h2>
              <p style="color:#aaa;margin:0 0 0.4rem;font-size:0.9rem;">
                Step: <strong style="color:#fff;">${step}</strong>
              </p>
              <p style="color:#888;font-size:0.8rem;margin:0 0 1.5rem;word-break:break-word;">
                ${err?.message || 'Unknown error'}
              </p>
              <button onclick="window.location.reload()" style="
                background:linear-gradient(135deg,#EE1515,#C91010);color:white;
                border:none;border-radius:8px;padding:0.75rem 2rem;
                font-size:1rem;font-weight:700;cursor:pointer;letter-spacing:0.5px;
                text-transform:uppercase;
              ">↺ Retry</button>
              <p style="color:#555;font-size:0.72rem;margin:0.75rem 0 0;">
                Check the browser console (F12) for detailed logs.
              </p>
            </div>
          </div>
        `;
      };

      try {
        // ── Step 1: Trainer + Pokemon data ────────────────────────────────────
        _step = 'loading trainer data';
        _log(`Fetching trainer "${selectedTrainer.name}"...`);
        updateLoadingProgress(10, 'Loading trainer data...');
        const t1 = Date.now();
        const response = await TrainerAPI.get(selectedTrainer.name);
        _log(`Trainer data OK in ${Date.now()-t1}ms — Pokemon: ${response.data.pokemonData?.length ?? 0}, trainerData fields: ${response.data.trainerData?.length ?? 0}`);

        _step = 'storing trainer data';
        sessionStorage.setItem('trainerData', JSON.stringify(response.data.trainerData));
        response.data.pokemonData.forEach((pokemon) => {
          sessionStorage.setItem(`pokemon_${pokemon[2].toLowerCase()}`, JSON.stringify(pokemon));
        });
        _log(`Stored trainerData + ${response.data.pokemonData.length} pokemon_* keys`);

        sessionStorage.setItem('unlockedPokeSlotImage', 'https://raw.githubusercontent.com/Scorelax/PokemonDnD/main/Pokeball.png');
        sessionStorage.setItem('lockedPokeSlotImage', 'https://raw.githubusercontent.com/Scorelax/PokemonDnD/main/Grey%20Pokeball.png');

        updateLoadingProgress(30, 'Processing trainer information...');

        // ── Step 2 (optional): Complete Pokemon list ──────────────────────────
        _step = 'caching complete Pokemon list';
        updateLoadingProgress(50, 'Loading Pokemon data...');
        try {
          _log('Fetching complete Pokemon list...');
          const t2 = Date.now();
          const completePokemonData = await import('../api.js').then(m => m.PokemonAPI.getRegisteredList());
          if (completePokemonData.status === 'success') {
            sessionStorage.setItem('completePokemonData', JSON.stringify(completePokemonData.data));
            _log(`Complete Pokemon list cached: ${completePokemonData.data.length} entries in ${Date.now()-t2}ms`);
          } else {
            _warn('Complete Pokemon list — unexpected status:', completePokemonData.status);
          }
        } catch (e) {
          _warn('Optional step skipped (complete Pokemon list):', e.message);
        }

        // ── Step 3 (optional): Pokedex config ────────────────────────────────
        _step = 'caching Pokedex config';
        try {
          _log('Fetching Pokedex config...');
          const t3 = Date.now();
          const pokedexConfig = await import('../api.js').then(m => m.GameDataAPI.getPokedexConfig());
          if (pokedexConfig.status === 'success') {
            sessionStorage.setItem('pokedexConfig', JSON.stringify(pokedexConfig.data));
            _log(`Pokedex config cached in ${Date.now()-t3}ms`);
          } else {
            _warn('Pokedex config — unexpected status:', pokedexConfig.status);
          }
        } catch (e) {
          _warn('Optional step skipped (Pokedex config):', e.message);
        }

        // ── Step 4: Game data (critical) ──────────────────────────────────────
        const trainerClass = response.data.trainerData[39];
        _log(`Trainer class: "${trainerClass}"`);

        if (trainerClass === "Pokemon Trainer") {
          _step = 'loading game data';
          updateLoadingProgress(60, 'Loading game data...');
          _log('Fetching game data (getAll)...');
          const t4 = Date.now();
          const gameData = await import('../api.js').then(m => m.GameDataAPI.getAll());
          const actualData = gameData.data || gameData;
          _log(`Game data OK in ${Date.now()-t4}ms. Keys: [${Object.keys(actualData).join(', ')}]`);

          const requiredKeys = ['itemsData','trainerPaths','specializations','affinities','moves','natures','trainerFeatsData','skillsData','pokemonFeatsData','nationalitiesData'];
          const missing = requiredKeys.filter(k => !actualData[k]);
          if (missing.length) _warn(`Game data missing keys: [${missing.join(', ')}]`);

          _step = 'storing game data';
          updateLoadingProgress(75, 'Processing items and moves...');
          sessionStorage.setItem('items',           JSON.stringify(actualData.itemsData.items));
          sessionStorage.setItem('trainerPaths',    JSON.stringify(actualData.trainerPaths));
          sessionStorage.setItem('specializations', JSON.stringify(actualData.specializations));
          sessionStorage.setItem('affinities',      JSON.stringify(actualData.affinities));
          sessionStorage.setItem('moves',           JSON.stringify(actualData.moves));
          sessionStorage.setItem('natures',         JSON.stringify(actualData.natures));
          sessionStorage.setItem('trainerFeats',    JSON.stringify(actualData.trainerFeatsData.trainerFeats));
          sessionStorage.setItem('skills',          JSON.stringify(actualData.skillsData.skills));
          sessionStorage.setItem('pokemonFeats',    JSON.stringify(actualData.pokemonFeatsData.pokemonFeats));
          sessionStorage.setItem('nationalities',   JSON.stringify(actualData.nationalitiesData.nationalities));
          _log('Game data stored in sessionStorage');

          _step = 'syncing known moves';
          syncKnownMovesForAllPokemon();

          _step = 'preloading splash image';
          updateLoadingProgress(85, 'Loading splash images...');
          const splashUrl = await selectAndPreloadSplashImage();
          sessionStorage.setItem('preloadedSplashImage', splashUrl);
          _log('Splash image preloaded:', splashUrl);

          updateLoadingProgress(95, 'Almost ready...');
          _log('Navigating to trainer-card');
          window.dispatchEvent(new CustomEvent('navigate', { detail: { route: 'trainer-card' } }));

        } else {
          _step = 'loading conduit data';
          updateLoadingProgress(60, 'Loading conduit data...');
          _log('Fetching conduit data (getConduit)...');
          const t4 = Date.now();
          const conduitData = await import('../api.js').then(m => m.GameDataAPI.getConduit());
          const actualData = conduitData.data || conduitData;
          _log(`Conduit data OK in ${Date.now()-t4}ms. Keys: [${Object.keys(actualData).join(', ')}]`);

          const requiredKeys = ['itemsData','conduitFeatures','battleStyles','typeAwakening','moves','natures','pokemonFeatsData','nationalitiesData'];
          const missing = requiredKeys.filter(k => !actualData[k]);
          if (missing.length) _warn(`Conduit data missing keys: [${missing.join(', ')}]`);

          _step = 'storing conduit data';
          updateLoadingProgress(75, 'Processing conduit abilities...');
          sessionStorage.setItem('items',           JSON.stringify(actualData.itemsData.items));
          sessionStorage.setItem('conduitFeatures', JSON.stringify(actualData.conduitFeatures));
          sessionStorage.setItem('battleStyles',    JSON.stringify(actualData.battleStyles));
          sessionStorage.setItem('typeAwakenings',  JSON.stringify(actualData.typeAwakening));
          sessionStorage.setItem('moves',           JSON.stringify(actualData.moves));
          sessionStorage.setItem('natures',         JSON.stringify(actualData.natures));
          sessionStorage.setItem('pokemonFeats',    JSON.stringify(actualData.pokemonFeatsData.pokemonFeats));
          sessionStorage.setItem('nationalities',   JSON.stringify(actualData.nationalitiesData.nationalities));
          _log('Conduit data stored in sessionStorage');

          _step = 'syncing known moves';
          syncKnownMovesForAllPokemon();

          updateLoadingProgress(95, 'Almost ready...');
          _log('Navigating to conduit-card');
          window.dispatchEvent(new CustomEvent('navigate', { detail: { route: 'conduit-card' } }));
        }

      } catch (err) {
        _showError(_step, err);
      }

    } else {
      // Wrong PIN
      error.textContent = 'Wrong PIN code';
      setTimeout(() => {
        error.textContent = '';
      }, 3000);
      input.value = '';
      input.focus();
    }
  });

  // PIN cancel
  document.getElementById('pinCancel')?.addEventListener('click', () => {
    document.getElementById('pinModal').classList.remove('active');
  });

  // Allow Enter key to submit
  document.getElementById('pinInput')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('pinSubmit').click();
    }
  });
}
