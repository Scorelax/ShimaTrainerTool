// Trainer Card Page - Hub with Trainer Image, Party Slots, and Utility Slot

export function renderTrainerCard() {
  // Load trainer data from session storage
  const trainerDataStr = sessionStorage.getItem('trainerData');
  if (!trainerDataStr) {
    return '<div class="error">No trainer data found. Please return to the home page.</div>';
  }

  const trainerData = JSON.parse(trainerDataStr);

  // Extract trainer info (matching original indices)
  const trainerImage = trainerData[0] || 'assets/Pokeball.png';
  const trainerName = trainerData[1] || 'Unknown Trainer';
  const trainerLevel = parseInt(trainerData[2]) || 1;
  const trainerClass = trainerData[39] || 'Unknown Class';

  // Calculate number of pokeslots based on level (matching original logic)
  let numPokeSlots = 3; // Default
  if (trainerLevel >= 5 && trainerLevel <= 9) {
    numPokeSlots = 4;
  } else if (trainerLevel >= 10 && trainerLevel <= 15) {
    numPokeSlots = 5;
  } else if (trainerLevel >= 16) {
    numPokeSlots = 6;
  }

  // Load active party Pokemon from session storage (matching original logic)
  // Create array of 6 slots, filled based on slot number
  const partyPokemon = Array(6).fill(null);
  const allStorageKeys = Object.keys(sessionStorage);

  for (const key of allStorageKeys) {
    if (key.startsWith('pokemon_')) {
      const pokemonData = JSON.parse(sessionStorage.getItem(key));
      const slotNumber = parseInt(pokemonData[38], 10); // inactiveparty field contains slot number (1-6)

      if (slotNumber && slotNumber >= 1 && slotNumber <= 6) {
        partyPokemon[slotNumber - 1] = {
          name: pokemonData[2] || 'Unknown',
          nickname: pokemonData[36] || null,
          image: pokemonData[1] || 'assets/Pokeball.png',
          level: pokemonData[4] || 1,
          data: pokemonData
        };
      }
    }
  }

  // Load utility Pokemon (matching original logic)
  let utilityPokemon = null;
  for (const key of allStorageKeys) {
    if (key.startsWith('pokemon_')) {
      const pokemonData = JSON.parse(sessionStorage.getItem(key));
      const isUtility = pokemonData[56]; // utilityslot field

      if (isUtility === 1) {
        utilityPokemon = {
          name: pokemonData[2] || 'Unknown',
          nickname: pokemonData[36] || null,
          image: pokemonData[1] || 'assets/Pokeball.png',
          level: pokemonData[4] || 1,
          data: pokemonData
        };
        break;
      }
    }
  }

  // Load pokeball images
  const unlockedSlot = sessionStorage.getItem('unlockedPokeSlotImage') || 'https://raw.githubusercontent.com/Scorelax/PokemonDnD/main/Pokeball.png';
  const lockedSlot = sessionStorage.getItem('lockedPokeSlotImage') || 'https://raw.githubusercontent.com/Scorelax/PokemonDnD/main/Grey%20Pokeball.png';

  const html = `
    <div class="trainer-card-page">
      <style>
        body, .content {
          background: linear-gradient(to bottom, #f44336 80%, #ffffff 20%);
        }

        .trainer-card-page {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 2rem 1rem;
          min-height: 80vh;
        }

        .trainer-section {
          background: white;
          border-radius: 15px;
          padding: 2rem;
          margin-bottom: 2rem;
          box-shadow: 0 4px 10px rgba(0,0,0,0.2);
          text-align: center;
          width: 100%;
          max-width: 400px;
        }

        .trainer-image-container {
          width: 200px;
          height: 200px;
          margin: 0 auto 1rem;
          cursor: pointer;
          transition: transform 0.2s;
          border-radius: 50%;
          overflow: hidden;
          border: 4px solid #333;
        }

        .trainer-image-container:hover {
          transform: scale(1.05);
        }

        .trainer-image {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .trainer-name {
          font-size: 2rem;
          font-weight: bold;
          color: #333;
          margin-bottom: 0.5rem;
        }

        .trainer-level {
          font-size: 1.5rem;
          color: #666;
          margin-bottom: 0.5rem;
        }

        .trainer-class {
          font-size: 1.2rem;
          color: #667eea;
          font-weight: 600;
        }

        .party-and-utility-container {
          display: flex;
          gap: 1rem;
          width: 100%;
          max-width: 900px;
          margin-bottom: 2rem;
          justify-content: center;
          flex-wrap: wrap;
        }

        .party-section {
          background: white;
          border-radius: 15px;
          padding: 1.5rem;
          box-shadow: 0 4px 10px rgba(0,0,0,0.2);
          flex: 1;
          min-width: 300px;
          max-width: 600px;
        }

        .party-section h2 {
          text-align: center;
          color: #333;
          margin-bottom: 1.5rem;
          font-size: 1.8rem;
        }

        .party-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 1rem;
          margin-bottom: 1rem;
        }

        .pokemon-slot {
          aspect-ratio: 1;
          background: #f5f5f5;
          border: 3px solid #333;
          border-radius: 15px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s;
          padding: 0.5rem;
          position: relative;
        }

        .pokemon-slot:hover {
          transform: translateY(-4px);
          box-shadow: 0 4px 8px rgba(0,0,0,0.2);
        }

        .pokemon-slot.empty {
          cursor: default;
          opacity: 0.7;
        }

        .pokemon-slot.locked {
          cursor: default;
          opacity: 0.5;
          background: #e0e0e0;
        }

        .pokemon-slot img {
          width: 80%;
          height: 80%;
          object-fit: contain;
        }

        .pokemon-slot .pokemon-name {
          font-size: 0.9rem;
          font-weight: bold;
          text-align: center;
          margin-top: 0.25rem;
          color: #333;
        }

        .pokemon-slot .pokemon-level {
          font-size: 0.8rem;
          color: #666;
        }

        .utility-section {
          background: white;
          border-radius: 15px;
          padding: 1.5rem;
          box-shadow: 0 4px 10px rgba(0,0,0,0.2);
          width: 200px;
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .utility-section h2 {
          text-align: center;
          color: #333;
          margin-bottom: 1rem;
          font-size: 1.5rem;
        }

        .utility-slot {
          width: 150px;
          height: 150px;
          background: #f5f5f5;
          border: 3px solid #333;
          border-radius: 15px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s;
          padding: 0.5rem;
        }

        .utility-slot:hover {
          transform: translateY(-4px);
          box-shadow: 0 4px 8px rgba(0,0,0,0.2);
        }

        .utility-slot.empty {
          cursor: default;
          opacity: 0.7;
        }

        .utility-slot img {
          width: 80%;
          height: 80%;
          object-fit: contain;
        }

        .utility-slot .pokemon-name {
          font-size: 0.9rem;
          font-weight: bold;
          text-align: center;
          margin-top: 0.25rem;
          color: #333;
        }

        .my-pokemon-button {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 1rem 2rem;
          border: 3px solid white;
          border-radius: 50px;
          font-size: 1.5rem;
          font-weight: bold;
          cursor: pointer;
          box-shadow: 0 4px 10px rgba(0,0,0,0.3);
          transition: all 0.3s;
          margin-bottom: 2rem;
        }

        .my-pokemon-button:hover {
          transform: translateY(-4px);
          box-shadow: 0 6px 15px rgba(0,0,0,0.4);
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
          transition: all 0.3s;
        }

        .back-button:hover {
          transform: translateX(-50%) translateY(-4px);
          box-shadow: 0 6px 15px rgba(0,0,0,0.3);
        }

        /* Exit Confirmation Modal */
        .exit-modal {
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

        .exit-modal.active {
          display: flex;
        }

        .exit-modal-content {
          background-color: #ffffff;
          border-radius: 10px;
          padding: 30px;
          box-shadow: 0 0 10px rgba(0, 0, 0, 0.2);
          text-align: center;
          width: 90%;
          max-width: 500px;
          box-sizing: border-box;
        }

        .exit-modal-content h2 {
          font-size: 2rem;
          margin-bottom: 20px;
          color: #333;
        }

        .exit-buttons {
          display: flex;
          gap: 10px;
          justify-content: center;
          margin-top: 20px;
        }

        .exit-confirm {
          background-color: #f44336;
          color: white;
          font-size: 1.2rem;
          padding: 10px 20px;
          border: none;
          border-radius: 5px;
          cursor: pointer;
        }

        .exit-cancel {
          background-color: #4CAF50;
          color: white;
          font-size: 1.2rem;
          padding: 10px 20px;
          border: none;
          border-radius: 5px;
          cursor: pointer;
        }

        @media (max-width: 768px) {
          .party-and-utility-container {
            flex-direction: column;
            align-items: center;
          }

          .party-grid {
            grid-template-columns: repeat(2, 1fr);
          }

          .trainer-name {
            font-size: 1.5rem;
          }

          .trainer-level {
            font-size: 1.2rem;
          }
        }
      </style>

      <!-- Trainer Section -->
      <div class="trainer-section">
        <div class="trainer-image-container" id="trainerImageContainer">
          <img src="${trainerImage}" alt="${trainerName}" class="trainer-image" onerror="this.src='assets/Pokeball.png'">
        </div>
        <div class="trainer-name">${trainerName}</div>
        <div class="trainer-level">Level ${trainerLevel}</div>
        <div class="trainer-class">${trainerClass}</div>
      </div>

      <!-- Party and Utility Container -->
      <div class="party-and-utility-container">
        <!-- Party Section -->
        <div class="party-section">
          <h2>Active Party</h2>
          <div class="party-grid">
            ${Array.from({ length: 6 }, (_, i) => {
              const pokemon = partyPokemon[i];
              if (pokemon) {
                const displayName = pokemon.nickname || pokemon.name;
                return `
                  <div class="pokemon-slot" data-pokemon-name="${pokemon.name.toLowerCase()}">
                    <img src="${pokemon.image}" alt="${pokemon.name}" onerror="this.src='assets/Pokeball.png'">
                    <div class="pokemon-name">${displayName}</div>
                    <div class="pokemon-level">Level ${pokemon.level}</div>
                  </div>
                `;
              } else if (i < numPokeSlots) {
                // Empty unlocked slot
                return `
                  <div class="pokemon-slot empty">
                    <img src="${unlockedSlot}" alt="Empty Slot">
                  </div>
                `;
              } else {
                // Locked slot
                return `
                  <div class="pokemon-slot locked">
                    <img src="${lockedSlot}" alt="Locked Slot">
                  </div>
                `;
              }
            }).join('')}
          </div>
        </div>

        <!-- Utility Section -->
        <div class="utility-section">
          <h2>Utility</h2>
          ${utilityPokemon ? `
            <div class="utility-slot" data-pokemon-name="${utilityPokemon.name.toLowerCase()}">
              <img src="${utilityPokemon.image}" alt="${utilityPokemon.name}" onerror="this.src='assets/Pokeball.png'">
              <div class="pokemon-name">${utilityPokemon.nickname || utilityPokemon.name}</div>
              <div class="pokemon-level">Level ${utilityPokemon.level}</div>
            </div>
          ` : `
            <div class="utility-slot empty">
              <img src="${unlockedSlot}" alt="Empty Utility Slot">
            </div>
          `}
        </div>
      </div>

      <!-- My Pokemon Button -->
      <button class="my-pokemon-button" id="myPokemonButton">My Pokemon</button>

      <!-- Back Button -->
      <button class="back-button" id="backButton">Exit</button>

      <!-- Exit Confirmation Modal -->
      <div class="exit-modal" id="exitModal">
        <div class="exit-modal-content">
          <h2>Exit to Main Menu?</h2>
          <p>Are you sure you want to return to the main menu?</p>
          <div class="exit-buttons">
            <button class="exit-confirm" id="exitConfirm">Yes, Exit</button>
            <button class="exit-cancel" id="exitCancel">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  `;

  return html;
}

export function attachTrainerCardListeners() {
  // Trainer image click - navigate to trainer info
  document.getElementById('trainerImageContainer')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('navigate', {
      detail: { route: 'trainer-info' }
    }));
  });

  // Pokemon slot clicks - navigate to pokemon card
  document.querySelectorAll('.pokemon-slot[data-pokemon-name]').forEach(slot => {
    slot.addEventListener('click', () => {
      const pokemonName = slot.dataset.pokemonName;
      window.dispatchEvent(new CustomEvent('navigate', {
        detail: {
          route: 'pokemon-card',
          pokemonName: pokemonName
        }
      }));
    });
  });

  // Utility slot click
  document.querySelector('.utility-slot[data-pokemon-name]')?.addEventListener('click', () => {
    const pokemonName = document.querySelector('.utility-slot[data-pokemon-name]').dataset.pokemonName;
    window.dispatchEvent(new CustomEvent('navigate', {
      detail: {
        route: 'pokemon-card',
        pokemonName: pokemonName
      }
    }));
  });

  // My Pokemon button
  document.getElementById('myPokemonButton')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('navigate', {
      detail: { route: 'my-pokemon' }
    }));
  });

  // Back button - show exit confirmation
  document.getElementById('backButton')?.addEventListener('click', () => {
    document.getElementById('exitModal').classList.add('active');
  });

  // Exit confirm
  document.getElementById('exitConfirm')?.addEventListener('click', () => {
    // Clear session storage
    sessionStorage.clear();

    // Navigate to index
    window.dispatchEvent(new CustomEvent('navigate', {
      detail: { route: 'index' }
    }));
  });

  // Exit cancel
  document.getElementById('exitCancel')?.addEventListener('click', () => {
    document.getElementById('exitModal').classList.remove('active');
  });
}
