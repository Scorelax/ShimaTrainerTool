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
          padding: clamp(1rem, 2vh, 1.5rem) clamp(1rem, 3vw, 2rem) clamp(1rem, 2vh, 1.5rem);
          min-height: auto;
          position: relative;
          box-sizing: border-box;
        }

        /* Trainer and Utility Container */
        .trainer-utility-wrapper {
          position: relative;
          margin-bottom: clamp(1rem, 2vh, 1.5rem);
          width: 100%;
          min-height: clamp(300px, 35vw, 400px);
          display: flex;
          justify-content: center;
          align-items: flex-start;
        }

        /* Trainer Section */
        .trainer-section {
          display: flex;
          flex-direction: column;
          align-items: center;
          z-index: 2;
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
          left: calc(50% + clamp(130px, 18vw, 180px));
          bottom: clamp(2.5rem, 5vh, 3.5rem);
          display: flex;
          flex-direction: column;
          align-items: center;
          z-index: 1;
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
          width: 85%;
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
          font-size: clamp(1.1rem, 2.4vw, 1.5rem);
          font-weight: 900;
          color: #FFDE00;
          text-align: center;
          margin-bottom: clamp(0.2rem, 0.5vh, 0.3rem);
          text-shadow: 0 2px 6px rgba(0,0,0,0.8);
        }

        .utility-slot .pokemon-level {
          font-size: clamp(0.95rem, 2vw, 1.3rem);
          color: white;
          text-align: center;
          font-weight: 600;
          text-shadow: 0 2px 4px rgba(0,0,0,0.6);
        }

        /* Party Section */
        .party-section {
          width: 100%;
          max-width: 900px;
          margin-bottom: clamp(1.5rem, 3vh, 2rem);
        }

        .party-section h2 {
          display: none;
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
          width: 85%;
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
          font-size: clamp(1.1rem, 2.4vw, 1.5rem);
          margin-bottom: clamp(0.2rem, 0.5vh, 0.3rem);
          color: #FFDE00;
          text-align: center;
          font-weight: 900;
          text-shadow: 0 2px 6px rgba(0,0,0,0.8);
        }

        .pokemon-slot .pokemon-level {
          font-size: clamp(0.95rem, 2vw, 1.3rem);
          color: white;
          text-align: center;
          font-weight: 600;
          text-shadow: 0 2px 4px rgba(0,0,0,0.6);
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

        /* Bottom Buttons Container */
        .bottom-buttons-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: clamp(0.8rem, 1.5vh, 1.2rem);
        }

        .rest-buttons-row {
          display: flex;
          gap: clamp(1rem, 2vw, 1.5rem);
        }

        .rest-btn {
          display: flex;
          align-items: center;
          gap: clamp(0.3rem, 0.6vw, 0.5rem);
          padding: clamp(0.5rem, 1vh, 0.75rem) clamp(1rem, 2vw, 1.5rem);
          border: clamp(2px, 0.4vw, 3px) solid rgba(255,222,0,0.6);
          border-radius: clamp(10px, 2vw, 15px);
          color: white;
          font-weight: 800;
          font-size: clamp(0.8rem, 1.6vw, 1rem);
          text-transform: uppercase;
          letter-spacing: clamp(0.3px, 0.2vw, 0.5px);
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 clamp(4px, 0.8vh, 6px) clamp(10px, 2vh, 15px) rgba(0,0,0,0.3);
        }

        .short-rest-btn {
          background: linear-gradient(135deg, #E8A317 0%, #C68A0A 100%);
        }

        .long-rest-btn {
          background: linear-gradient(135deg, #3B4CCA 0%, #2E3FA0 100%);
        }

        .rest-btn:hover {
          transform: translateY(clamp(-2px, -0.5vh, -3px));
          box-shadow: 0 clamp(8px, 1.5vh, 12px) clamp(20px, 4vh, 30px) rgba(0,0,0,0.4),
                      0 0 clamp(15px, 3vw, 20px) rgba(255,222,0,0.4);
        }

        .rest-btn:active {
          transform: translateY(0);
        }

        .rest-btn-icon {
          font-size: clamp(1rem, 2vw, 1.3rem);
        }

        /* Poké Center - Mirrored utility slot on the left */
        .pokecenter-container {
          position: absolute;
          right: calc(50% + clamp(130px, 18vw, 180px));
          bottom: clamp(2.5rem, 5vh, 3.5rem);
          display: flex;
          flex-direction: column;
          align-items: center;
          z-index: 1;
          cursor: pointer;
        }

        .pokecenter-label {
          color: white;
          font-size: clamp(1rem, 2vw, 1.4rem);
          font-weight: 900;
          text-transform: uppercase;
          margin-bottom: clamp(0.5rem, 1vh, 0.75rem);
          text-shadow: 0 2px 6px rgba(0,0,0,0.6);
        }

        .pokecenter-slot {
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

        .pokecenter-slot:hover {
          transform: translateY(clamp(-3px, -0.8vh, -5px));
          filter: brightness(1.1) drop-shadow(0 0 clamp(10px, 2vw, 15px) rgba(255,222,0,0.6));
        }

        .pokecenter-slot img {
          width: 85%;
          height: auto;
          aspect-ratio: 1;
          border-radius: clamp(12px, 2.5vw, 18px);
          object-fit: cover;
          margin-bottom: clamp(0.5rem, 1vh, 0.75rem);
          border: clamp(3px, 0.6vw, 4px) solid #FFDE00;
          box-shadow: 0 clamp(8px, 1.5vh, 12px) clamp(20px, 4vh, 30px) rgba(0,0,0,0.5);
          background-color: #fff;
        }

        .pokecenter-slot .pokecenter-name {
          font-size: clamp(1.1rem, 2.4vw, 1.5rem);
          font-weight: 900;
          color: #FFDE00;
          text-align: center;
          margin-bottom: clamp(0.2rem, 0.5vh, 0.3rem);
          text-shadow: 0 2px 6px rgba(0,0,0,0.8);
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

        .exit-confirm:hover {
          transform: translateY(clamp(-2px, -0.5vh, -3px));
          box-shadow: 0 clamp(8px, 1.5vh, 12px) clamp(18px, 3.5vh, 25px) rgba(76,175,80,0.5);
        }

        .exit-cancel {
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

        .exit-cancel:hover {
          transform: translateY(clamp(-2px, -0.5vh, -3px));
          box-shadow: 0 clamp(8px, 1.5vh, 12px) clamp(18px, 3.5vh, 25px) rgba(238,21,21,0.5);
        }

        /* Tablet - keep layout, adjust sizes */
        @media (max-width: 768px) {
          .trainer-image-container {
            width: clamp(140px, 22vw, 200px);
            height: clamp(140px, 22vw, 200px);
          }

          .utility-container {
            left: calc(50% + clamp(90px, 14vw, 130px));
          }

          .utility-slot {
            width: clamp(80px, 16vw, 130px);
          }

          .pokecenter-container {
            right: calc(50% + clamp(90px, 14vw, 130px));
          }

          .pokecenter-slot {
            width: clamp(80px, 16vw, 130px);
          }

          .trainer-utility-wrapper {
            min-height: clamp(220px, 30vw, 300px);
          }
        }

        /* Mobile phones - keep side-by-side layout */
        @media (max-width: 480px) {
          .trainer-image-container {
            width: clamp(100px, 28vw, 150px);
            height: clamp(100px, 28vw, 150px);
            border-width: clamp(2px, 0.5vw, 4px);
          }

          .trainer-name {
            font-size: clamp(0.9rem, 2.5vw, 1.3rem);
          }

          .trainer-level {
            font-size: clamp(0.75rem, 2vw, 1rem);
          }

          .utility-container {
            left: calc(50% + clamp(70px, 18vw, 100px));
            bottom: clamp(1.5rem, 4vh, 2.5rem);
          }

          .utility-slot {
            width: clamp(60px, 18vw, 100px);
          }

          .utility-label {
            font-size: clamp(0.7rem, 1.8vw, 1rem);
          }

          .utility-slot .pokemon-name {
            font-size: clamp(0.7rem, 1.8vw, 1rem);
          }

          .utility-slot .pokemon-level {
            font-size: clamp(0.6rem, 1.5vw, 0.85rem);
          }

          .pokecenter-container {
            right: calc(50% + clamp(70px, 18vw, 100px));
            bottom: clamp(1.5rem, 4vh, 2.5rem);
          }

          .pokecenter-slot {
            width: clamp(60px, 18vw, 100px);
          }

          .pokecenter-label {
            font-size: clamp(0.7rem, 1.8vw, 1rem);
          }

          .pokecenter-slot .pokecenter-name {
            font-size: clamp(0.7rem, 1.8vw, 1rem);
          }

          .trainer-utility-wrapper {
            min-height: clamp(160px, 38vw, 240px);
          }

          .party-grid {
            gap: clamp(0.5rem, 1.5vw, 1rem);
          }

          .pokemon-slot img {
            border-width: clamp(2px, 0.4vw, 3px);
          }

          .pokemon-slot .pokemon-name {
            font-size: clamp(0.7rem, 1.8vw, 1rem);
          }

          .pokemon-slot .pokemon-level {
            font-size: clamp(0.6rem, 1.5vw, 0.85rem);
          }

          .my-pokemon-button {
            padding: clamp(0.6rem, 1.5vh, 1rem) clamp(1.2rem, 3vw, 2rem);
            font-size: clamp(0.9rem, 2.2vw, 1.3rem);
            border-width: clamp(2px, 0.4vw, 3px);
          }
        }

        /* Very small screens - even more compact but keep layout */
        @media (max-width: 360px) {
          .trainer-image-container {
            width: clamp(80px, 24vw, 110px);
            height: clamp(80px, 24vw, 110px);
          }

          .trainer-name {
            font-size: clamp(0.8rem, 2.2vw, 1rem);
          }

          .trainer-level {
            font-size: clamp(0.65rem, 1.8vw, 0.85rem);
          }

          .utility-container {
            left: calc(50% + clamp(55px, 15vw, 75px));
            bottom: clamp(1rem, 3vh, 2rem);
          }

          .utility-slot {
            width: clamp(50px, 15vw, 70px);
          }

          .utility-label {
            font-size: clamp(0.6rem, 1.5vw, 0.8rem);
            margin-bottom: clamp(0.25rem, 0.5vh, 0.4rem);
          }

          .utility-slot .pokemon-name {
            font-size: clamp(0.6rem, 1.5vw, 0.8rem);
          }

          .pokecenter-container {
            right: calc(50% + clamp(55px, 15vw, 75px));
            bottom: clamp(1rem, 3vh, 2rem);
          }

          .pokecenter-slot {
            width: clamp(50px, 15vw, 70px);
          }

          .pokecenter-label {
            font-size: clamp(0.6rem, 1.5vw, 0.8rem);
            margin-bottom: clamp(0.25rem, 0.5vh, 0.4rem);
          }

          .pokecenter-slot .pokecenter-name {
            font-size: clamp(0.6rem, 1.5vw, 0.8rem);
          }

          .utility-slot .pokemon-level {
            font-size: clamp(0.5rem, 1.3vw, 0.7rem);
          }

          .trainer-utility-wrapper {
            min-height: clamp(130px, 35vw, 180px);
            margin-bottom: clamp(0.5rem, 1vh, 1rem);
          }

          .party-grid {
            gap: clamp(0.4rem, 1vw, 0.75rem);
          }

          .pokemon-slot .pokemon-name {
            font-size: clamp(0.6rem, 1.5vw, 0.8rem);
          }

          .pokemon-slot .pokemon-level {
            font-size: clamp(0.5rem, 1.3vw, 0.7rem);
          }

          .my-pokemon-button {
            padding: clamp(0.5rem, 1.2vh, 0.8rem) clamp(1rem, 2.5vw, 1.5rem);
            font-size: clamp(0.8rem, 2vw, 1.1rem);
          }

          .back-button {
            width: clamp(35px, 10vw, 45px);
            height: clamp(35px, 10vw, 45px);
            font-size: clamp(1.2rem, 3vw, 1.6rem);
          }
        }
      </style>

      <!-- Back Button -->
      <button class="back-button" id="backButton">←</button>

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

        <!-- Poké Center - Mirrored on left -->
        <div class="pokecenter-container" id="pokemonCenterBtn">
          <div class="pokecenter-label">Poké Center</div>
          <div class="pokecenter-slot">
            <img src="assets/pokecenter.png" alt="Poké Center">
          </div>
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

      <!-- My Pokemon Button with Rest Buttons -->
      <div class="bottom-buttons-container">
        <button class="my-pokemon-button" id="myPokemonButton">My Pokemon</button>
        <div class="rest-buttons-row">
          <button class="rest-btn short-rest-btn" id="shortRestBtn">
            <span class="rest-btn-icon">☀️</span>
            <span class="rest-btn-label">Short Rest</span>
          </button>
          <button class="rest-btn long-rest-btn" id="longRestBtn">
            <span class="rest-btn-icon">🌙</span>
            <span class="rest-btn-label">Long Rest</span>
          </button>
        </div>
      </div>

      <!-- Pokemon Center Confirmation Modal -->
      <div class="exit-modal" id="pokemonCenterModal">
        <div class="exit-modal-content">
          <h2>Poké Center</h2>
          <p>Fully restore HP, VP, HD and VD for the trainer and all Pokémon?</p>
          <div class="exit-buttons">
            <button class="exit-confirm" id="pokemonCenterConfirm">Yes, Restore All</button>
            <button class="exit-cancel" id="pokemonCenterCancel">Cancel</button>
          </div>
        </div>
      </div>

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
      sessionStorage.setItem('previousRoute', 'trainer-card');
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
    sessionStorage.setItem('previousRoute', 'trainer-card');
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

  // Rest buttons - navigate to trainer-info and auto-trigger rest
  document.getElementById('shortRestBtn')?.addEventListener('click', () => {
    sessionStorage.setItem('pendingRest', 'short');
    window.dispatchEvent(new CustomEvent('navigate', {
      detail: { route: 'trainer-info' }
    }));
  });

  document.getElementById('longRestBtn')?.addEventListener('click', () => {
    sessionStorage.setItem('pendingRest', 'long');
    window.dispatchEvent(new CustomEvent('navigate', {
      detail: { route: 'trainer-info' }
    }));
  });

  // Pokemon Center button - show confirmation
  document.getElementById('pokemonCenterBtn')?.addEventListener('click', () => {
    document.getElementById('pokemonCenterModal').classList.add('active');
  });

  document.getElementById('pokemonCenterCancel')?.addEventListener('click', () => {
    document.getElementById('pokemonCenterModal').classList.remove('active');
  });

  document.getElementById('pokemonCenterConfirm')?.addEventListener('click', () => {
    document.getElementById('pokemonCenterModal').classList.remove('active');

    const trainerDataRaw = sessionStorage.getItem('trainerData');
    if (!trainerDataRaw) return;

    const trainerData = JSON.parse(trainerDataRaw);

    // Restore trainer HP, VP, HD, VD to max
    trainerData[34] = parseInt(trainerData[11], 10); // currentHP = maxHP
    trainerData[35] = parseInt(trainerData[12], 10); // currentVP = maxVP
    trainerData[47] = parseInt(trainerData[3], 10);  // currentHD = maxHD
    trainerData[48] = parseInt(trainerData[4], 10);  // currentVD = maxVD

    // Refill all buff charges
    const trainerLevel = parseInt(trainerData[2], 10);
    if (window.getMaxCharges) {
      trainerData[40] = window.getMaxCharges('Second Wind', trainerLevel);
      trainerData[41] = window.getMaxCharges('Rapid Orders', trainerLevel);
      trainerData[42] = window.getMaxCharges('Unbreakable Bond', trainerLevel);
      trainerData[43] = window.getMaxCharges('Elemental Synergy', trainerLevel);
      trainerData[44] = window.getMaxCharges('Master Trainer', trainerLevel);
    }

    // Refill battle dice for Ace Trainer
    const trainerPath = trainerData[25] || '';
    if (trainerPath === 'Ace Trainer' && trainerLevel >= 5) {
      const wisModifier = Math.floor((parseInt(trainerData[9], 10) - 10) / 2);
      const maxBattleDice = 1 + wisModifier;
      trainerData[45] = `${maxBattleDice} - ${maxBattleDice}`;
    }

    sessionStorage.setItem('trainerData', JSON.stringify(trainerData));

    // Restore ALL Pokemon (active party and stored)
    const allPokemonKeys = Object.keys(sessionStorage).filter(key => key.startsWith('pokemon_'));
    const pokemonToUpdate = [];

    allPokemonKeys.forEach(key => {
      const pokemonData = JSON.parse(sessionStorage.getItem(key));
      if (!pokemonData) return;

      // Restore HP, VP, HD, VD to max
      pokemonData[45] = parseInt(pokemonData[10], 10); // currentHP = maxHP
      pokemonData[46] = parseInt(pokemonData[12], 10); // currentVP = maxVP
      pokemonData[54] = parseInt(pokemonData[9], 10);  // currentHD = maxHD
      pokemonData[55] = parseInt(pokemonData[11], 10); // currentVD = maxVD

      sessionStorage.setItem(key, JSON.stringify(pokemonData));
      pokemonToUpdate.push(pokemonData);
    });

    // Update database in background
    import('../api.js').then(({ TrainerAPI, PokemonAPI }) => {
      TrainerAPI.update(trainerData).then(() => {
        console.log('Pokemon Center: trainer data saved');
      }).catch(err => console.error('Pokemon Center: trainer save error:', err));

      pokemonToUpdate.forEach(pokemon => {
        PokemonAPI.update(pokemon).then(() => {
          console.log(`Pokemon Center: ${pokemon[2]} saved`);
        }).catch(err => console.error(`Pokemon Center: ${pokemon[2]} save error:`, err));
      });
    });

    // Reload to reflect changes
    window.location.reload();
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
