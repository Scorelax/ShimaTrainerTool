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
          background:
            radial-gradient(circle at 20% 80%, rgba(255, 222, 0, 0.15) 0%, transparent 50%),
            radial-gradient(circle at 80% 20%, rgba(59, 76, 202, 0.15) 0%, transparent 50%),
            radial-gradient(circle at 40% 40%, rgba(238, 21, 21, 0.3) 0%, transparent 40%),
            linear-gradient(to bottom, #EE1515 0%, #C91010 50%, #A00808 100%);
          min-height: 100vh;
          position: relative;
          overflow-x: hidden;
        }

        body::before, .content::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-image:
            radial-gradient(circle, rgba(255, 255, 255, 0.03) 1px, transparent 1px),
            radial-gradient(circle, rgba(255, 255, 255, 0.03) 1px, transparent 1px);
          background-size: 50px 50px, 80px 80px;
          background-position: 0 0, 40px 40px;
          pointer-events: none;
          opacity: 0.5;
        }

        .trainer-card-page {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 2rem 1rem;
          min-height: 85vh;
          position: relative;
        }

        .trainer-utility-container {
          position: relative;
          display: flex;
          justify-content: center;
          margin-bottom: 20px;
          width: 100%;
        }

        .trainer-section {
          background: transparent;
          border: none;
          padding: 20px;
          box-shadow: none;
          text-align: center;
        }

        .utility-side-container {
          position: absolute;
          right: 20px;
          top: 240px;
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .trainer-image-container {
          width: 300px;
          height: 300px;
          margin: 0 auto 10px;
          cursor: pointer;
          transition: transform 0.2s, box-shadow 0.2s;
          border-radius: 10px;
          overflow: hidden;
          border: none;
          box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        }

        .trainer-image-container:hover {
          transform: translateY(-5px);
          box-shadow: 0 4px 8px rgba(0,0,0,0.2);
        }

        .trainer-image {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .trainer-name {
          font-size: 1.5rem;
          font-weight: 700;
          color: white;
          margin-bottom: 5px;
        }

        .trainer-level {
          font-size: 1.5rem;
          color: white;
          margin-bottom: 5px;
          font-weight: 400;
        }

        .trainer-class {
          display: none;
        }

        .party-section {
          background: transparent;
          border: none;
          padding: 20px;
          box-shadow: none;
          width: 100%;
          max-width: 650px;
          margin: 0 auto 20px;
        }

        .party-section h2 {
          text-align: center;
          color: white;
          margin-bottom: 10px;
          font-size: 1.5rem;
          font-weight: 700;
        }

        .party-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 5px;
          margin-bottom: 10px;
        }

        .pokemon-slot {
          display: flex;
          flex-direction: column;
          align-items: center;
          background: transparent;
          padding: 10px;
          cursor: pointer;
        }

        .pokemon-slot.empty {
          cursor: default;
          opacity: 0.5;
        }

        .pokemon-slot.locked {
          cursor: default;
          opacity: 0.3;
        }

        .pokemon-slot img {
          width: 170px;
          height: 170px;
          border-radius: 10px;
          object-fit: cover;
          background-color: #f0f0f0;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          transition: transform 0.2s, box-shadow 0.2s;
          margin-bottom: 10px;
        }

        .pokemon-slot:hover img {
          transform: translateY(-5px);
          box-shadow: 0 4px 8px rgba(0,0,0,0.2);
        }

        .pokemon-slot .pokemon-name {
          font-size: 1.5rem;
          margin-bottom: 5px;
          color: white;
          text-align: center;
        }

        .pokemon-slot .pokemon-level {
          font-size: 1.5rem;
          margin-bottom: 5px;
          color: white;
          text-align: center;
        }

        .utility-side-container h3 {
          color: white;
          font-size: 1.2rem;
          font-weight: 700;
          margin-bottom: 8px;
        }

        .utility-slot {
          width: 130px;
          height: 130px;
          border-radius: 10px;
          cursor: pointer;
          transition: transform 0.2s;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: transparent;
          padding: 8px;
          text-align: center;
        }

        .utility-slot.empty {
          cursor: default;
          opacity: 0.5;
        }

        .utility-slot img {
          width: 100%;
          height: 100%;
          object-fit: contain;
          transition: transform 0.2s, box-shadow 0.2s;
          margin-bottom: 10px;
        }

        .utility-slot:hover img {
          transform: translateY(-5px);
          box-shadow: 0 4px 8px rgba(0,0,0,0.2);
        }

        .utility-slot .pokemon-name {
          font-size: 1.1rem;
          margin-bottom: 3px;
          color: white;
          text-align: center;
        }

        .utility-slot .pokemon-level {
          font-size: 1.1rem;
          margin-bottom: 3px;
          color: white;
          text-align: center;
        }

        .my-pokemon-button {
          background: linear-gradient(135deg, #3B4CCA 0%, #2A3BA0 100%);
          color: white;
          padding: 10px 20px;
          border: 2px solid #FFDE00;
          border-radius: 10px;
          font-size: 1.5rem;
          font-weight: 700;
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(0,0,0,0.2);
          transition: transform 0.2s, box-shadow 0.2s;
          margin-bottom: 20px;
        }

        .my-pokemon-button:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 8px rgba(0,0,0,0.2);
        }

        .my-pokemon-button:active {
          transform: translateY(0);
        }

        .back-button {
          position: fixed;
          top: 20px;
          left: 20px;
          background: linear-gradient(135deg, #FFFFFF 0%, #F5F5F5 100%);
          color: #333;
          width: 50px;
          height: 50px;
          border: 3px solid #FFDE00;
          border-radius: 50%;
          font-size: 1.8rem;
          font-weight: bold;
          cursor: pointer;
          box-shadow: 0 8px 20px rgba(0,0,0,0.3);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          padding: 0;
        }

        .back-button:hover {
          transform: scale(1.1);
          box-shadow: 0 12px 30px rgba(0,0,0,0.4),
                      0 0 20px rgba(255,222,0,0.5);
          border-color: #FFC700;
        }

        .back-button:active {
          transform: scale(1.05);
        }

        /* Exit Confirmation Modal */
        .exit-modal {
          display: none;
          position: fixed;
          left: 0;
          top: 0;
          width: 100%;
          height: 100%;
          background-color: rgba(0, 0, 0, 0.7);
          backdrop-filter: blur(5px);
          z-index: 9999;
          justify-content: center;
          align-items: center;
          animation: fadeIn 0.3s ease;
        }

        .exit-modal.active {
          display: flex;
        }

        .exit-modal-content {
          background: linear-gradient(135deg, #FFFFFF 0%, #F5F5F5 100%);
          border: 4px solid #FFDE00;
          border-radius: 25px;
          padding: 3rem 2rem;
          box-shadow: 0 20px 60px rgba(0,0,0,0.5),
                      inset 0 -4px 0 rgba(0,0,0,0.05);
          text-align: center;
          width: 90%;
          max-width: 500px;
          box-sizing: border-box;
          animation: slideUp 0.3s ease;
        }

        .exit-modal-content h2 {
          font-size: 2.2rem;
          margin-bottom: 1rem;
          color: #333;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 1px;
        }

        .exit-modal-content p {
          font-size: 1.2rem;
          color: #666;
          margin-bottom: 2rem;
        }

        .exit-buttons {
          display: flex;
          gap: 1rem;
          justify-content: center;
          margin-top: 2rem;
        }

        .exit-confirm {
          background: linear-gradient(135deg, #EE1515 0%, #C91010 100%);
          color: white;
          font-size: 1.3rem;
          font-weight: bold;
          padding: 1rem 2rem;
          border: none;
          border-radius: 15px;
          cursor: pointer;
          box-shadow: 0 5px 15px rgba(238,21,21,0.4);
          transition: all 0.3s;
        }

        .exit-confirm:hover {
          transform: translateY(-3px);
          box-shadow: 0 8px 20px rgba(238,21,21,0.5);
        }

        .exit-confirm:active {
          transform: translateY(-1px);
        }

        .exit-cancel {
          background: linear-gradient(135deg, #4CAF50 0%, #45A049 100%);
          color: white;
          font-size: 1.3rem;
          font-weight: bold;
          padding: 1rem 2rem;
          border: none;
          border-radius: 15px;
          cursor: pointer;
          box-shadow: 0 5px 15px rgba(76,175,80,0.4);
          transition: all 0.3s;
        }

        .exit-cancel:hover {
          transform: translateY(-3px);
          box-shadow: 0 8px 20px rgba(76,175,80,0.5);
        }

        .exit-cancel:active {
          transform: translateY(-1px);
        }

        @media (max-width: 1024px) {
          .utility-side-container {
            position: static;
            margin-top: 20px;
          }
        }

        @media (max-width: 768px) {
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

      <!-- Trainer and Utility Container -->
      <div class="trainer-utility-container">
        <!-- Trainer Section -->
        <div class="trainer-section">
          <div class="trainer-image-container" id="trainerImageContainer">
            <img src="${trainerImage}" alt="${trainerName}" class="trainer-image" onerror="this.src='assets/Pokeball.png'">
          </div>
          <div class="trainer-name">${trainerName}</div>
          <div class="trainer-level">Level ${trainerLevel}</div>
          <div class="trainer-class">${trainerClass}</div>
        </div>

        <!-- Utility Side Container -->
        <div class="utility-side-container">
          <h3>Utility</h3>
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

      <!-- My Pokemon Button -->
      <button class="my-pokemon-button" id="myPokemonButton">My Pokemon</button>

      <!-- Back Button -->
      <button class="back-button" id="backButton">←</button>

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
