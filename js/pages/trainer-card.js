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
          display: flex;
          align-items: flex-start;
          justify-content: center;
          gap: 2rem;
          margin-bottom: 2rem;
          width: 100%;
          max-width: 900px;
        }

        .trainer-section {
          background: transparent;
          border: none;
          border-radius: 25px;
          padding: 2rem;
          box-shadow: none;
          text-align: center;
          flex-shrink: 0;
        }

        .utility-side-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding-top: 180px;
          flex-shrink: 0;
        }

        .trainer-image-container {
          width: 220px;
          height: 220px;
          margin: 0 auto 1.5rem;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          border-radius: 30px;
          overflow: hidden;
          border: none;
          box-shadow: 0 10px 30px rgba(0,0,0,0.5),
                      0 0 30px rgba(255,222,0,0.3);
          position: relative;
          z-index: 1;
        }

        .trainer-image-container:hover {
          transform: scale(1.08);
          box-shadow: 0 15px 40px rgba(0,0,0,0.6),
                      0 0 40px rgba(255,222,0,0.5);
        }

        .trainer-image {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .trainer-name {
          font-size: 1.8rem;
          font-weight: 900;
          color: white;
          margin-bottom: 0.5rem;
          text-transform: uppercase;
          letter-spacing: 1px;
          position: relative;
          z-index: 1;
          text-shadow: 0 4px 10px rgba(0,0,0,0.8);
        }

        .trainer-level {
          font-size: 1.3rem;
          color: #FFDE00;
          margin-bottom: 0;
          font-weight: 700;
          position: relative;
          z-index: 1;
          text-shadow: 0 2px 5px rgba(0,0,0,0.8);
        }

        .trainer-class {
          display: none;
        }

        .party-section {
          background: transparent;
          border: none;
          border-radius: 25px;
          padding: 2rem;
          box-shadow: none;
          width: 100%;
          max-width: 650px;
          margin: 0 auto 2rem;
        }

        .party-section h2 {
          text-align: center;
          color: white;
          margin-bottom: 1.5rem;
          font-size: 1.5rem;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 1px;
          text-shadow: 0 4px 10px rgba(0,0,0,0.8);
        }

        .party-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 1.25rem;
          margin-bottom: 1rem;
        }

        .pokemon-slot {
          aspect-ratio: 1;
          background: transparent;
          border: none;
          border-radius: 18px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          padding: 0.75rem;
          position: relative;
          box-shadow: none;
        }

        .pokemon-slot:hover {
          transform: translateY(-8px) scale(1.05);
        }

        .pokemon-slot.empty {
          cursor: default;
          opacity: 0.5;
          background: transparent;
        }

        .pokemon-slot.empty:hover {
          transform: none;
        }

        .pokemon-slot.locked {
          cursor: default;
          opacity: 0.3;
          background: transparent;
        }

        .pokemon-slot.locked:hover {
          transform: none;
        }

        .pokemon-slot img {
          width: 80%;
          height: 80%;
          object-fit: contain;
          border-radius: 25px;
          box-shadow: 0 8px 25px rgba(0,0,0,0.5);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .pokemon-slot:hover img {
          box-shadow: 0 15px 40px rgba(0,0,0,0.6),
                      0 0 30px rgba(255,222,0,0.4);
        }

        .pokemon-slot .pokemon-name {
          font-size: 0.95rem;
          font-weight: 800;
          text-align: center;
          margin-top: 0.5rem;
          color: white;
          text-transform: uppercase;
          letter-spacing: 0.3px;
          text-shadow: 0 2px 5px rgba(0,0,0,0.8);
        }

        .pokemon-slot .pokemon-level {
          font-size: 0.85rem;
          color: #FFDE00;
          font-weight: 700;
          text-shadow: 0 2px 5px rgba(0,0,0,0.8);
        }

        .utility-side-container h3 {
          color: white;
          font-size: 1.2rem;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 1px;
          text-shadow: 0 2px 5px rgba(0,0,0,0.8);
          margin-bottom: 1rem;
        }

        .utility-slot {
          width: 160px;
          height: 160px;
          background: transparent;
          border: none;
          border-radius: 18px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          padding: 0.75rem;
          box-shadow: none;
        }

        .utility-slot:hover {
          transform: translateY(-10px) scale(1.08);
        }

        .utility-slot.empty {
          cursor: default;
          opacity: 0.5;
          background: transparent;
        }

        .utility-slot.empty:hover {
          transform: none;
        }

        .utility-slot img {
          width: 80%;
          height: 80%;
          object-fit: contain;
          border-radius: 25px;
          box-shadow: 0 8px 25px rgba(0,0,0,0.5);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .utility-slot:hover img {
          box-shadow: 0 15px 40px rgba(0,0,0,0.6),
                      0 0 30px rgba(59,76,202,0.5);
        }

        .utility-slot .pokemon-name {
          font-size: 0.95rem;
          font-weight: 800;
          text-align: center;
          margin-top: 0.5rem;
          color: white;
          text-transform: uppercase;
          letter-spacing: 0.3px;
          text-shadow: 0 2px 5px rgba(0,0,0,0.8);
        }

        .my-pokemon-button {
          background: linear-gradient(135deg, #3B4CCA 0%, #2A3BA0 100%);
          color: white;
          padding: 1rem 2.4rem;
          border: 3px solid #FFDE00;
          border-radius: 50px;
          font-size: 1.3rem;
          font-weight: 900;
          cursor: pointer;
          box-shadow: 0 10px 30px rgba(59,76,202,0.4),
                      inset 0 -3px 0 rgba(0,0,0,0.2);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          margin-bottom: 2rem;
          text-transform: uppercase;
          letter-spacing: 1px;
        }

        .my-pokemon-button:hover {
          transform: translateY(-6px) scale(1.02);
          box-shadow: 0 15px 40px rgba(59,76,202,0.5),
                      inset 0 -3px 0 rgba(0,0,0,0.2),
                      0 0 30px rgba(255,222,0,0.5);
          border-color: #FFC700;
        }

        .my-pokemon-button:active {
          transform: translateY(-3px) scale(1.0);
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
          .trainer-utility-container {
            flex-direction: column;
            align-items: center;
          }

          .utility-side-container {
            padding-top: 0;
            margin-top: 1rem;
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
