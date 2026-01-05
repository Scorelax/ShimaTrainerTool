// Continue Journey Page - Trainer Selection with PIN
import { TrainerAPI } from '../api.js';

// Splash image configuration
const SPLASH_BASE_URL = 'https://raw.githubusercontent.com/Benjakronk/shima-pokedex/main/images/splashes/';
const MAX_SPLASH_IMAGES = 20; // Maximum number of splash images
const DEFAULT_BACKGROUND = 'https://raw.githubusercontent.com/Benjakronk/shima-pokedex/main/images/background/background.png';

// Select a random splash image with priority for "session"
async function selectSplashImage() {
  // Helper function to check if an image exists
  async function imageExists(url) {
    try {
      const response = await fetch(url, { method: 'HEAD' });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  // First, check if session.png exists
  const sessionUrl = `${SPLASH_BASE_URL}session.png`;
  if (await imageExists(sessionUrl)) {
    console.log('[Splash] Using session image:', sessionUrl);
    return sessionUrl;
  }

  // If no session image, pick a random splash image
  const randomNumber = Math.floor(Math.random() * MAX_SPLASH_IMAGES) + 1;
  const randomSplashUrl = `${SPLASH_BASE_URL}splash-${randomNumber}.png`;

  if (await imageExists(randomSplashUrl)) {
    console.log('[Splash] Using random splash image:', randomSplashUrl);
    return randomSplashUrl;
  }

  // Fallback to default background if splash image not found
  console.log('[Splash] No splash images found, using default background');
  return DEFAULT_BACKGROUND;
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
  selectSplashImage().then(url => {
    preloadedSplashImage = url;
    console.log('[Splash] Preloaded:', url);
  }).catch(err => {
    console.log('[Splash] Preload error:', err);
    preloadedSplashImage = 'https://raw.githubusercontent.com/Benjakronk/shima-pokedex/main/images/background/background.png';
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

      try {
        // Fetch trainer data with Pokemon
        updateLoadingProgress(10, 'Loading trainer data...');
        const response = await TrainerAPI.get(selectedTrainer.name);

        updateLoadingProgress(30, 'Processing trainer information...');
        // Store in session storage (matching original behavior)
        sessionStorage.setItem('trainerData', JSON.stringify(response.data.trainerData));
        response.data.pokemonData.forEach((pokemon) => {
          sessionStorage.setItem(`pokemon_${pokemon[2].toLowerCase()}`, JSON.stringify(pokemon));
        });

        // Store pokeball images
        sessionStorage.setItem('unlockedPokeSlotImage', 'https://raw.githubusercontent.com/Scorelax/PokemonDnD/main/Pokeball.png');
        sessionStorage.setItem('lockedPokeSlotImage', 'https://raw.githubusercontent.com/Scorelax/PokemonDnD/main/Grey%20Pokeball.png');

        updateLoadingProgress(50, 'Loading Pokemon data...');

        // Load complete Pokemon data (all registered Pokemon with abilities, moves, stats)
        // This is cached in session storage to avoid slow API calls later
        try {
          const completePokemonData = await import('../api.js').then(m => m.PokemonAPI.getRegisteredList());
          if (completePokemonData.status === 'success') {
            sessionStorage.setItem('completePokemonData', JSON.stringify(completePokemonData.data));
            console.log('[Cache] Stored complete Pokemon data for', completePokemonData.data.length, 'Pokemon');
          }
        } catch (error) {
          console.error('[Cache] Failed to load complete Pokemon data:', error);
          // Continue anyway - app will fall back to individual API calls if needed
        }

        // Load Pokedex config (visibility settings for Pokemon data)
        // This is cached in session storage to avoid API calls on every page
        try {
          const pokedexConfig = await import('../api.js').then(m => m.GameDataAPI.getPokedexConfig());
          if (pokedexConfig.status === 'success') {
            sessionStorage.setItem('pokedexConfig', JSON.stringify(pokedexConfig.data));
            console.log('[Cache] Stored Pokedex config');
          }
        } catch (error) {
          console.error('[Cache] Failed to load Pokedex config:', error);
          // Continue anyway - app will fall back to API call if needed
        }

        // Check if Pokemon Trainer or Conduit
        const trainerClass = response.data.trainerData[39]; // Index for trainer class

        if (trainerClass === "Pokemon Trainer") {
          // Load game data for Pokemon Trainer
          updateLoadingProgress(60, 'Loading game data...');
          const gameData = await import('../api.js').then(m => m.GameDataAPI.getAll());
          console.log('Game data response:', gameData);
          console.log('gameData keys:', Object.keys(gameData));
          console.log('Has .data property?', 'data' in gameData);

          // Check structure and use appropriate path
          const actualData = gameData.data || gameData;
          console.log('actualData keys:', Object.keys(actualData));

          updateLoadingProgress(75, 'Processing items and moves...');
          // Store game data in session storage
          sessionStorage.setItem('items', JSON.stringify(actualData.itemsData.items));
          sessionStorage.setItem('trainerPaths', JSON.stringify(actualData.trainerPaths));
          sessionStorage.setItem('specializations', JSON.stringify(actualData.specializations));
          sessionStorage.setItem('affinities', JSON.stringify(actualData.affinities));
          sessionStorage.setItem('moves', JSON.stringify(actualData.moves));
          sessionStorage.setItem('natures', JSON.stringify(actualData.natures));
          sessionStorage.setItem('trainerFeats', JSON.stringify(actualData.trainerFeatsData.trainerFeats));
          sessionStorage.setItem('skills', JSON.stringify(actualData.skillsData.skills));
          sessionStorage.setItem('pokemonFeats', JSON.stringify(actualData.pokemonFeatsData.pokemonFeats));
          sessionStorage.setItem('nationalities', JSON.stringify(actualData.nationalitiesData.nationalities));

          updateLoadingProgress(85, 'Loading splash images...');
          // Preload splash image for instant display on other pages
          const splashUrl = await selectSplashImage();
          sessionStorage.setItem('preloadedSplashImage', splashUrl);
          console.log('[Continue Journey] Preloaded splash image:', splashUrl);

          updateLoadingProgress(95, 'Almost ready...');
          // Navigate to trainer card
          window.dispatchEvent(new CustomEvent('navigate', {
            detail: { route: 'trainer-card' }
          }));
        } else {
          // Load conduit data
          updateLoadingProgress(60, 'Loading conduit data...');
          const conduitData = await import('../api.js').then(m => m.GameDataAPI.getConduit());
          console.log('Conduit data response:', conduitData);
          console.log('conduitData keys:', Object.keys(conduitData));

          // Check structure and use appropriate path
          const actualData = conduitData.data || conduitData;
          console.log('actualData keys:', Object.keys(actualData));

          updateLoadingProgress(75, 'Processing conduit abilities...');
          // Store conduit data in session storage
          sessionStorage.setItem('items', JSON.stringify(actualData.itemsData.items));
          sessionStorage.setItem('conduitFeatures', JSON.stringify(actualData.conduitFeatures));
          sessionStorage.setItem('battleStyles', JSON.stringify(actualData.battleStyles));
          sessionStorage.setItem('typeAwakenings', JSON.stringify(actualData.typeAwakening));
          sessionStorage.setItem('moves', JSON.stringify(actualData.moves));
          sessionStorage.setItem('natures', JSON.stringify(actualData.natures));
          sessionStorage.setItem('pokemonFeats', JSON.stringify(actualData.pokemonFeatsData.pokemonFeats));
          sessionStorage.setItem('nationalities', JSON.stringify(actualData.nationalitiesData.nationalities));

          updateLoadingProgress(95, 'Almost ready...');
          // Navigate to conduit card
          window.dispatchEvent(new CustomEvent('navigate', {
            detail: { route: 'conduit-card' }
          }));
        }

      } catch (err) {
        console.error('Error loading trainer:', err);
        updateLoadingProgress(0, 'Error loading data');
        // Show error in content area since modal is closed
        document.getElementById('content').innerHTML = `
          <div class="error" style="text-align: center; padding: 2rem; color: red;">
            <h2>Failed to load trainer data</h2>
            <p>${err.message}</p>
            <button onclick="window.location.reload()" style="margin-top: 1rem; padding: 0.5rem 1rem;">Retry</button>
          </div>
        `;
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
