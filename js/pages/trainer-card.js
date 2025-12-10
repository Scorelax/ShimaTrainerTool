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
          padding: clamp(2rem, 4vh, 3rem) clamp(1rem, 3vw, 2rem) clamp(2rem, 4vh, 3rem);
          min-height: 100vh;
          position: relative;
          box-sizing: border-box;
        }

        /* Title */
        .page-title {
          color: white;
          font-size: clamp(2.5rem, 6vw, 4rem);
          text-transform: uppercase;
          letter-spacing: clamp(1px, 0.5vw, 3px);
          text-shadow: 0 clamp(3px, 1vh, 6px) clamp(10px, 2vh, 15px) rgba(0,0,0,0.8);
          font-weight: 900;
          margin-bottom: clamp(1rem, 2vh, 1.5rem);
          text-align: center;
        }

        /* Trainer and Utility Container */
        .trainer-utility-wrapper {
          position: relative;
          display: flex;
          justify-content: center;
          align-items: flex-end;
          margin-bottom: clamp(2rem, 4vh, 3rem);
          width: 100%;
          max-width: 900px;
        }

        /* Trainer Section */
        .trainer-section {
          display: flex;
          flex-direction: column;
          align-items: center;
          z-index: 1;
        }

        .trainer-image-container {
          width: clamp(200px, 25vw, 280px);
          height: clamp(200px, 25vw, 280px);
          margin-bottom: clamp(0.75rem, 1.5vh, 1rem);
          cursor: pointer;
          transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.3s;
          border-radius: clamp(15px, 3vw, 25px);
          overflow: hidden;
          border: clamp(4px, 0.7vw, 6px) solid #FFDE00;
          box-shadow: 0 clamp(10px, 2vh, 15px) clamp(25px, 5vh, 40px) rgba(0,0,0,0.5);
          background: white;
        }

        .trainer-image-container:hover {
          transform: translateY(clamp(-5px, -1.2vh, -8px)) scale(1.02);
          box-shadow: 0 clamp(15px, 3vh, 25px) clamp(40px, 8vh, 60px) rgba(0,0,0,0.6),
                      0 0 clamp(20px, 4vw, 30px) rgba(255,222,0,0.6);
        }

        .trainer-image {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .trainer-name {
          font-size: clamp(1.3rem, 3vw, 2rem);
          font-weight: 900;
          color: #FFDE00;
          margin-bottom: clamp(0.3rem, 0.8vh, 0.5rem);
          text-shadow: 0 2px 8px rgba(0,0,0,0.8);
          text-align: center;
        }

        .trainer-level {
          font-size: clamp(1rem, 2.2vw, 1.5rem);
          color: white;
          font-weight: 600;
          text-shadow: 0 2px 6px rgba(0,0,0,0.6);
          text-align: center;
        }

        /* Utility Slot - Positioned to the right */
        .utility-container {
          position: absolute;
          right: 0;
          bottom: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          margin-left: clamp(1rem, 2vw, 1.5rem);
        }

        .utility-label {
          color: white;
          font-size: clamp(1rem, 2vw, 1.4rem);
          font-weight: 900;
          text-transform: uppercase;
          margin-bottom: clamp(0.5rem, 1vh, 0.75rem);
          text-shadow: 0 2px 6px rgba(0,0,0,0.6);
        }

        .utility-slot {
          width: clamp(120px, 20vw, 180px);
          display: flex;
          flex-direction: column;
          align-items: center;
          background: transparent;
          padding: 0;
          border-radius: 0;
          border: none;
          cursor: pointer;
          transition: transform 0.3s, filter 0.3s;
        }

        .utility-slot.empty {
          opacity: 0.6;
          cursor: default;
        }

        .utility-slot:not(.empty):hover {
          transform: translateY(clamp(-3px, -0.8vh, -5px));
          filter: brightness(1.1) drop-shadow(0 0 clamp(10px, 2vw, 15px) rgba(255,222,0,0.6));
        }

        .utility-slot img {
          width: 100%;
          height: auto;
          aspect-ratio: 1;
          border-radius: clamp(12px, 2.5vw, 18px);
          object-fit: cover;
          margin-bottom: clamp(0.5rem, 1vh, 0.75rem);
          border: clamp(3px, 0.6vw, 4px) solid #FFDE00;
          box-shadow: 0 clamp(8px, 1.5vh, 12px) clamp(20px, 4vh, 30px) rgba(0,0,0,0.5);
          background-color: #fff;
        }

        .utility-slot .pokemon-name {
          font-size: clamp(0.85rem, 1.8vw, 1.1rem);
          font-weight: 700;
          color: #333;
          text-align: center;
          margin-bottom: clamp(0.1rem, 0.3vh, 0.2rem);
        }

        .utility-slot .pokemon-level {
          font-size: clamp(0.75rem, 1.5vw, 0.95rem);
          color: #666;
          text-align: center;
        }

        /* Party Section */
        .party-section {
          width: 100%;
          max-width: 900px;
          margin-bottom: clamp(2rem, 4vh, 3rem);
        }

        .party-section h2 {
          text-align: center;
          color: white;
          margin-bottom: clamp(1.5rem, 3vh, 2rem);
          font-size: clamp(1.5rem, 3.5vw, 2.5rem);
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: clamp(0.5px, 0.3vw, 1px);
          text-shadow: 0 clamp(2px, 0.8vh, 4px) clamp(6px, 1.5vh, 10px) rgba(0,0,0,0.8);
        }

        .party-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: clamp(1rem, 2vw, 1.5rem);
        }

        .pokemon-slot {
          display: flex;
          flex-direction: column;
          align-items: center;
          background: transparent;
          padding: 0;
          border-radius: 0;
          border: none;
          cursor: pointer;
          transition: transform 0.3s, filter 0.3s;
        }

        .pokemon-slot.empty {
          cursor: default;
          opacity: 0.6;
        }

        .pokemon-slot.locked {
          cursor: default;
          opacity: 0.3;
        }

        .pokemon-slot:not(.empty):not(.locked):hover {
          transform: translateY(clamp(-5px, -1.2vh, -8px)) scale(1.05);
          filter: brightness(1.1) drop-shadow(0 0 clamp(15px, 3vw, 25px) rgba(255,222,0,0.6));
        }

        .pokemon-slot img {
          width: 100%;
          height: auto;
          aspect-ratio: 1;
          border-radius: clamp(12px, 2.5vw, 18px);
          object-fit: cover;
          margin-bottom: clamp(0.5rem, 1vh, 0.75rem);
          border: clamp(3px, 0.6vw, 4px) solid #FFDE00;
          box-shadow: 0 clamp(8px, 1.5vh, 12px) clamp(20px, 4vh, 30px) rgba(0,0,0,0.5);
          background-color: #fff;
        }

        .pokemon-slot .pokemon-name {
          font-size: clamp(0.95rem, 2vw, 1.3rem);
          margin-bottom: clamp(0.2rem, 0.5vh, 0.3rem);
          color: #333;
          text-align: center;
          font-weight: 700;
        }

        .pokemon-slot .pokemon-level {
          font-size: clamp(0.85rem, 1.8vw, 1.1rem);
          color: #666;
          text-align: center;
        }

        /* My Pokemon Button */
        .my-pokemon-button {
          background: linear-gradient(135deg, #3B4CCA 0%, #2A3BA0 100%);
          color: white;
          padding: clamp(1rem, 2vh, 1.5rem) clamp(2rem, 4vw, 3rem);
          border: clamp(3px, 0.6vw, 4px) solid #FFDE00;
          border-radius: clamp(15px, 3vw, 25px);
          font-size: clamp(1.2rem, 2.5vw, 1.8rem);
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: clamp(0.5px, 0.3vw, 1px);
          cursor: pointer;
          box-shadow: 0 clamp(8px, 1.5vh, 12px) clamp(20px, 4vh, 30px) rgba(0,0,0,0.4);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .my-pokemon-button:hover {
          transform: translateY(clamp(-3px, -0.8vh, -5px));
          box-shadow: 0 clamp(12px, 2.5vh, 18px) clamp(30px, 6vh, 45px) rgba(0,0,0,0.5),
                      0 0 clamp(20px, 4vw, 30px) rgba(59, 76, 202, 0.5);
        }

        .my-pokemon-button:active {
          transform: translateY(0);
          box-shadow: 0 clamp(5px, 1vh, 8px) clamp(12px, 2vh, 18px) rgba(0,0,0,0.4);
        }

        /* Back Button */
        .back-button {
          position: fixed;
          top: clamp(15px, 3vh, 25px);
          left: clamp(15px, 3vw, 25px);
          background: linear-gradient(135deg, #FFFFFF 0%, #F5F5F5 100%);
          color: #333;
          width: clamp(45px, 9vw, 60px);
          height: clamp(45px, 9vw, 60px);
          border: clamp(3px, 0.6vw, 4px) solid #FFDE00;
          border-radius: 50%;
          font-size: clamp(1.6rem, 3.5vw, 2.2rem);
          font-weight: 900;
          cursor: pointer;
          box-shadow: 0 clamp(8px, 2vh, 12px) clamp(20px, 4vh, 30px) rgba(0,0,0,0.4);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          padding: 0;
        }

        .back-button:hover {
          transform: scale(1.15);
          box-shadow: 0 clamp(12px, 3vh, 18px) clamp(30px, 6vh, 45px) rgba(0,0,0,0.5),
                      0 0 clamp(20px, 4vw, 30px) rgba(255,222,0,0.6);
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
        }

        .exit-modal.active {
          display: flex;
        }

        .exit-modal-content {
          background: linear-gradient(135deg, #FFFFFF 0%, #F8F8F8 100%);
          border: clamp(4px, 0.7vw, 6px) solid #FFDE00;
          border-radius: clamp(20px, 4vw, 30px);
          padding: clamp(2rem, 4vh, 3rem);
          box-shadow: 0 clamp(15px, 3vh, 25px) clamp(40px, 8vh, 60px) rgba(0,0,0,0.6),
                      inset 0 clamp(-4px, -0.8vh, -6px) 0 rgba(0,0,0,0.05);
          text-align: center;
          width: 90%;
          max-width: 500px;
        }

        .exit-modal-content h2 {
          font-size: clamp(1.8rem, 4vw, 2.5rem);
          margin-bottom: clamp(0.75rem, 1.5vh, 1rem);
          color: #333;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: clamp(0.5px, 0.3vw, 1px);
        }

        .exit-modal-content p {
          font-size: clamp(1rem, 2.2vw, 1.4rem);
          color: #666;
          margin-bottom: clamp(1.5rem, 3vh, 2rem);
        }

        .exit-buttons {
          display: flex;
          gap: clamp(0.75rem, 1.5vw, 1rem);
          justify-content: center;
        }

        .exit-confirm {
          background: linear-gradient(135deg, #EE1515 0%, #C91010 100%);
          color: white;
          font-size: clamp(1.1rem, 2.3vw, 1.5rem);
          font-weight: 900;
          padding: clamp(0.75rem, 1.5vh, 1rem) clamp(1.5rem, 3vw, 2rem);
          border: none;
          border-radius: clamp(12px, 2.5vw, 18px);
          cursor: pointer;
          box-shadow: 0 clamp(5px, 1vh, 8px) clamp(12px, 2.5vh, 18px) rgba(238,21,21,0.4);
          transition: all 0.3s;
        }

        .exit-confirm:hover {
          transform: translateY(clamp(-2px, -0.5vh, -3px));
          box-shadow: 0 clamp(8px, 1.5vh, 12px) clamp(18px, 3.5vh, 25px) rgba(238,21,21,0.5);
        }

        .exit-cancel {
          background: linear-gradient(135deg, #4CAF50 0%, #45A049 100%);
          color: white;
          font-size: clamp(1.1rem, 2.3vw, 1.5rem);
          font-weight: 900;
          padding: clamp(0.75rem, 1.5vh, 1rem) clamp(1.5rem, 3vw, 2rem);
          border: none;
          border-radius: clamp(12px, 2.5vw, 18px);
          cursor: pointer;
          box-shadow: 0 clamp(5px, 1vh, 8px) clamp(12px, 2.5vh, 18px) rgba(76,175,80,0.4);
          transition: all 0.3s;
        }

        .exit-cancel:hover {
          transform: translateY(clamp(-2px, -0.5vh, -3px));
          box-shadow: 0 clamp(8px, 1.5vh, 12px) clamp(18px, 3.5vh, 25px) rgba(76,175,80,0.5);
        }

        /* Responsive adjustments */
        @media (max-width: 1024px) {
          .utility-container {
            position: static;
            margin-top: clamp(1rem, 2vh, 1.5rem);
            margin-left: 0;
          }

          .trainer-utility-wrapper {
            flex-direction: column;
            align-items: center;
          }
        }

        @media (max-width: 768px) {
          .party-grid {
            gap: clamp(0.75rem, 1.5vw, 1rem);
          }
        }
      </style>

      <!-- Back Button -->
      <button class="back-button" id="backButton">←</button>

      <!-- Title -->
      <h1 class="page-title">${trainerName}</h1>

      <!-- Trainer and Utility Container -->
      <div class="trainer-utility-wrapper">
        <!-- Trainer Section -->
        <div class="trainer-section">
          <div class="trainer-image-container" id="trainerImageContainer">
            <img src="${trainerImage}" alt="${trainerName}" class="trainer-image" onerror="this.src='assets/Pokeball.png'">
          </div>
          <div class="trainer-name">${trainerName}</div>
          <div class="trainer-level">Level ${trainerLevel}</div>
        </div>

        <!-- Utility Container -->
        <div class="utility-container">
          <div class="utility-label">Utility</div>
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
