// Continue Journey Page - Trainer Selection with PIN
import { TrainerAPI } from '../api.js';

export async function renderContinueJourney() {
  // Fetch trainers
  const response = await TrainerAPI.getAll();
  const trainers = response.data || [];

  const html = `
    <div class="continue-journey-page">
      <style>
        body, .content {
          background: linear-gradient(to bottom, #f44336 80%, #ffffff 20%);
        }

        .continue-journey-page h1 {
          margin-top: 1.5rem;
          margin-bottom: 1.5rem;
          color: white;
          text-align: center;
          font-size: 2.5rem;
        }

        .trainer-container {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 1rem;
          width: 100%;
          max-width: 1200px;
          margin: 0 auto;
          padding: 1rem;
          box-sizing: border-box;
          justify-items: center;
        }

        .trainer-box {
          max-width: 200px;
          aspect-ratio: 1;
          background-color: #ffffff;
          border: 2px solid #333333;
          border-radius: 15px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: space-around;
          padding: 0.5rem;
          cursor: pointer;
          transition: transform 0.2s, box-shadow 0.2s;
          box-sizing: border-box;
        }

        .trainer-box:hover {
          transform: translateY(-4px);
          box-shadow: 0 0 10px rgba(0, 0, 0, 0.2);
        }

        .trainer-image {
          width: 100%;
          height: 100%;
          object-fit: cover;
          border-radius: 10px;
          box-shadow: 0 0 5px rgba(0, 0, 0, 0.1);
        }

        .trainer-name {
          font-size: 1.2rem;
          margin-top: 0.5rem;
          text-align: center;
          color: #333333;
          font-weight: bold;
        }

        /* PIN Modal */
        .pin-modal {
          display: none;
          position: fixed;
          left: 0;
          top: 0;
          width: 100%;
          height: 100%;
          background-color: rgba(0, 0, 0, 0.5);
          z-index: 9999;
          justify-content: center;
          align-items: center;
        }

        .pin-modal.active {
          display: flex;
        }

        .pin-modal-content {
          background-color: #ffffff;
          border-radius: 10px;
          padding: 30px;
          box-shadow: 0 0 10px rgba(0, 0, 0, 0.2);
          text-align: center;
          width: 90%;
          max-width: 500px;
          box-sizing: border-box;
        }

        .pin-modal-content h2 {
          font-size: 2rem;
          margin-bottom: 20px;
          color: #333;
        }

        .pin-error {
          color: red;
          margin: 10px 0;
          min-height: 20px;
          font-weight: bold;
        }

        .pin-input {
          width: 200px;
          height: 60px;
          font-size: 1.8rem;
          padding: 15px;
          border-radius: 10px;
          border: 2px solid #333;
          box-sizing: border-box;
          margin-bottom: 20px;
          text-align: center;
        }

        .pin-buttons {
          display: flex;
          gap: 10px;
          justify-content: center;
        }

        .pin-submit {
          background-color: #4CAF50;
          color: white;
          font-size: 1.2rem;
          padding: 10px 20px;
          border: none;
          border-radius: 5px;
          cursor: pointer;
        }

        .pin-cancel {
          background-color: #f44336;
          color: white;
          font-size: 1.2rem;
          padding: 10px 20px;
          border: none;
          border-radius: 5px;
          cursor: pointer;
        }

        .back-button {
          position: fixed;
          bottom: 40px;
          left: 50%;
          transform: translateX(-50%);
          background: white;
          color: #333;
          padding: 15px 30px;
          border: 2px solid #333;
          border-radius: 50px;
          font-size: 1.2rem;
          font-weight: bold;
          cursor: pointer;
          box-shadow: 0 4px 10px rgba(0,0,0,0.2);
        }

        @media (max-width: 768px) {
          .trainer-container {
            grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
          }

          .trainer-box {
            max-width: 150px;
          }
        }
      </style>

      <h1>Continue Journey</h1>

      <div class="trainer-container">
        ${trainers.map(trainer => `
          <div class="trainer-box" data-trainer-id="${trainer.id}" data-trainer-name="${trainer.name}" data-trainer-pin="${trainer.pinCode}">
            <img class="trainer-image" src="${trainer.image || 'assets/Pokeball.png'}" alt="${trainer.name}">
            <div class="trainer-name">${trainer.name || 'Unnamed Trainer'}</div>
          </div>
        `).join('')}
      </div>

      <button class="back-button" data-route="index">Back</button>

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

      // Show loading
      document.getElementById('content').innerHTML = '<div class="loading">Loading trainer data...</div>';

      try {
        // Fetch trainer data with Pokemon
        const response = await TrainerAPI.get(selectedTrainer.name);

        // Store in session storage (matching original behavior)
        sessionStorage.setItem('trainerData', JSON.stringify(response.data.trainerData));
        response.data.pokemonData.forEach((pokemon) => {
          sessionStorage.setItem(`pokemon_${pokemon[2].toLowerCase()}`, JSON.stringify(pokemon));
        });

        // Store pokeball images
        sessionStorage.setItem('unlockedPokeSlotImage', 'https://raw.githubusercontent.com/Scorelax/PokemonDnD/main/Pokeball.png');
        sessionStorage.setItem('lockedPokeSlotImage', 'https://raw.githubusercontent.com/Scorelax/PokemonDnD/main/Grey%20Pokeball.png');

        // Check if Pokemon Trainer or Conduit
        const trainerClass = response.data.trainerData[39]; // Index for trainer class

        if (trainerClass === "Pokemon Trainer") {
          // Load game data for Pokemon Trainer
          const gameData = await import('../api.js').then(m => m.GameDataAPI.getAll());
          console.log('Game data response:', gameData);
          console.log('gameData keys:', Object.keys(gameData));
          console.log('Has .data property?', 'data' in gameData);

          // Check structure and use appropriate path
          const actualData = gameData.data || gameData;
          console.log('actualData keys:', Object.keys(actualData));

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

          // Navigate to trainer card
          window.dispatchEvent(new CustomEvent('navigate', {
            detail: { route: 'trainer-card' }
          }));
        } else {
          // Load conduit data
          const conduitData = await import('../api.js').then(m => m.GameDataAPI.getConduit());
          console.log('Conduit data response:', conduitData);
          console.log('conduitData keys:', Object.keys(conduitData));

          // Check structure and use appropriate path
          const actualData = conduitData.data || conduitData;
          console.log('actualData keys:', Object.keys(actualData));

          // Store conduit data in session storage
          sessionStorage.setItem('items', JSON.stringify(actualData.itemsData.items));
          sessionStorage.setItem('conduitFeatures', JSON.stringify(actualData.conduitFeatures));
          sessionStorage.setItem('battleStyles', JSON.stringify(actualData.battleStyles));
          sessionStorage.setItem('typeAwakenings', JSON.stringify(actualData.typeAwakening));
          sessionStorage.setItem('moves', JSON.stringify(actualData.moves));
          sessionStorage.setItem('natures', JSON.stringify(actualData.natures));
          sessionStorage.setItem('pokemonFeats', JSON.stringify(actualData.pokemonFeatsData.pokemonFeats));
          sessionStorage.setItem('nationalities', JSON.stringify(actualData.nationalitiesData.nationalities));

          // Navigate to conduit card
          window.dispatchEvent(new CustomEvent('navigate', {
            detail: { route: 'conduit-card' }
          }));
        }

      } catch (err) {
        console.error('Error loading trainer:', err);
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
