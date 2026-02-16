// Trainer Card Page - Hub with Trainer Image, Party Slots, and Utility Slot

import { showError } from '../utils/notifications.js';
import { audioManager } from '../utils/audio.js';

// Helper function to get max charges for a buff based on trainer level
function getMaxCharges(buffName, trainerLevel) {
  switch (buffName) {
    case 'Second Wind':
      if (trainerLevel >= 7) return 5;
      if (trainerLevel >= 3) return 2;
      return 0;
    case 'Rapid Orders':
      return trainerLevel >= 6 ? 1 : 0;
    case 'Unbreakable Bond':
      return trainerLevel >= 13 ? 1 : 0;
    case 'Elemental Synergy':
      return trainerLevel >= 18 ? 1 : 0;
    case 'Master Trainer':
      return trainerLevel >= 20 ? 2 : 0;
    default:
      return 0;
  }
}

// Short rest state management
let shortRestQueue = [];
let shortRestCurrentIndex = 0;

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

  // Extract badges from inventory
  const earnedBadges = [];
  const inventoryStr = trainerData[20] || '';
  const itemsDbStr = sessionStorage.getItem('items');
  if (inventoryStr && itemsDbStr) {
    const itemsDb = JSON.parse(itemsDbStr);
    const inventoryItems = inventoryStr.split(',').map(s => s.trim()).filter(Boolean);
    for (const itemEntry of inventoryItems) {
      // Inventory format: "ItemName xQuantity" or just "ItemName"
      const itemName = itemEntry.replace(/\s*x\d+$/i, '').trim();
      const dbItem = itemsDb.find(it => it.name === itemName);
      if (dbItem && dbItem.type === 'Badges, Seals & Sigils' && itemName.includes('Badge')) {
        earnedBadges.push({ name: dbItem.name, description: dbItem.effect || dbItem.description || '' });
      }
    }
  }

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

        /* Bottom Buttons Container - Single Row */
        .bottom-buttons-container {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: clamp(0.6rem, 1.2vw, 1rem);
          flex-wrap: wrap;
        }

        .my-pokemon-btn {
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
          background: linear-gradient(135deg, #3B4CCA 0%, #2A3BA0 100%);
        }

        .my-pokemon-btn:hover {
          transform: translateY(clamp(-2px, -0.5vh, -3px));
          box-shadow: 0 clamp(8px, 1.5vh, 12px) clamp(20px, 4vh, 30px) rgba(0,0,0,0.4),
                      0 0 clamp(15px, 3vw, 20px) rgba(255,222,0,0.4);
        }

        .my-pokemon-btn:active {
          transform: translateY(0);
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

        /* Popup Overlay Styles (for rest popups) */
        .popup-overlay {
          display: none;
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.7);
          z-index: 2000;
          justify-content: center;
          align-items: center;
          backdrop-filter: blur(3px);
        }

        .popup-overlay.active {
          display: flex;
        }

        .popup-content {
          background: linear-gradient(135deg, #2a2a2a 0%, #1f1f1f 100%);
          border: clamp(3px, 0.6vw, 5px) solid #FFDE00;
          border-radius: clamp(15px, 3vw, 20px);
          padding: clamp(1.5rem, 3vw, 2.5rem);
          max-width: min(90vw, 600px);
          max-height: 80vh;
          overflow-y: auto;
          position: relative;
          box-shadow: 0 15px 40px rgba(0,0,0,0.8);
        }

        .popup-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: clamp(1rem, 2vh, 1.5rem);
          padding-bottom: clamp(0.75rem, 1.5vh, 1rem);
          border-bottom: clamp(2px, 0.4vw, 3px) solid #FFDE00;
        }

        .popup-title {
          font-size: clamp(1.3rem, 3vw, 1.8rem);
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: clamp(0.5px, 0.3vw, 1px);
          color: #FFDE00;
          text-shadow: 0 2px 4px rgba(0,0,0,0.8);
        }

        .popup-close {
          background: linear-gradient(135deg, #EE1515 0%, #C91010 100%);
          color: white;
          border: clamp(2px, 0.4vw, 3px) solid #333;
          border-radius: 50%;
          width: clamp(35px, 7vw, 45px);
          height: clamp(35px, 7vw, 45px);
          font-size: clamp(1.2rem, 2.5vw, 1.6rem);
          font-weight: bold;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          flex-shrink: 0;
        }

        .popup-close:hover {
          transform: scale(1.1) rotate(90deg);
          box-shadow: 0 5px 15px rgba(0,0,0,0.4);
        }

        .popup-body {
          color: #e0e0e0;
          font-size: clamp(0.95rem, 2vw, 1.1rem);
          line-height: 1.6;
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

        /* Badge Collection */
        .badge-section {
          width: 100%;
          max-width: 900px;
          margin-top: clamp(1.5rem, 3vh, 2rem);
        }

        .badge-collection {
          display: grid;
          grid-template-columns: repeat(8, 1fr);
          gap: clamp(0.5rem, 1vw, 1rem);
          justify-items: center;
        }

        .badge-slot {
          display: flex;
          flex-direction: column;
          align-items: center;
          cursor: default;
          transition: transform 0.3s, filter 0.3s;
        }

        .badge-slot.earned {
          cursor: pointer;
        }

        .badge-slot.earned:hover {
          transform: translateY(clamp(-3px, -0.8vh, -5px));
          filter: brightness(1.1) drop-shadow(0 0 clamp(10px, 2vw, 15px) rgba(255,222,0,0.6));
        }

        .badge-slot img {
          width: 100%;
          height: auto;
          aspect-ratio: 1;
          border-radius: clamp(12px, 2.5vw, 18px);
          object-fit: cover;
          border: clamp(3px, 0.6vw, 4px) solid #FFDE00;
          box-shadow: 0 clamp(8px, 1.5vh, 12px) clamp(20px, 4vh, 30px) rgba(0,0,0,0.5);
          background-color: #fff;
        }

        .badge-slot.empty img {
          opacity: 0.3;
          border-color: rgba(255,222,0,0.3);
          box-shadow: none;
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

          .badge-collection {
            gap: clamp(0.4rem, 0.8vw, 0.75rem);
          }

          .badge-slot img {
            border-width: clamp(2px, 0.4vw, 3px);
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

          .my-pokemon-btn {
            font-size: clamp(0.7rem, 1.4vw, 0.9rem);
          }

          .badge-collection {
            grid-template-columns: repeat(4, 1fr);
            gap: clamp(0.5rem, 1.5vw, 1rem);
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

          .my-pokemon-btn {
            font-size: clamp(0.6rem, 1.3vw, 0.8rem);
          }

          .back-button {
            width: clamp(35px, 10vw, 45px);
            height: clamp(35px, 10vw, 45px);
            font-size: clamp(1.2rem, 3vw, 1.6rem);
          }

          .badge-collection {
            grid-template-columns: repeat(4, 1fr);
            gap: clamp(0.3rem, 0.8vw, 0.5rem);
          }

          .badge-slot img {
            border-width: 2px;
            border-radius: clamp(8px, 2vw, 12px);
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

      <!-- Buttons Row: Short Rest | My Pokemon | Long Rest -->
      <div class="bottom-buttons-container">
        <button class="rest-btn short-rest-btn" id="shortRestBtn">
          <span class="rest-btn-icon">☀️</span>
          <span class="rest-btn-label">Short Rest</span>
        </button>
        <button class="my-pokemon-btn" id="myPokemonButton">
          <span class="rest-btn-icon">💻</span>
          <span>My Pokemon</span>
        </button>
        <button class="rest-btn long-rest-btn" id="longRestBtn">
          <span class="rest-btn-icon">🌙</span>
          <span class="rest-btn-label">Long Rest</span>
        </button>
      </div>

      <!-- Badge Collection -->
      <div class="badge-section">
        <div class="badge-collection">
          ${Array.from({ length: 8 }, (_, i) => {
            const badge = earnedBadges[i];
            if (badge) {
              const kebabName = badge.name.toLowerCase().replace(/\s+/g, '-');
              const imgUrl = 'https://raw.githubusercontent.com/Benjakronk/shima-pokedex/main/images/badges/' + kebabName + '.png';
              return `
                <div class="badge-slot earned" data-badge-index="${i}">
                  <img src="${imgUrl}" alt="${badge.name}" onerror="this.src='assets/Locked_Badge.png'">
                </div>
              `;
            } else {
              return `
                <div class="badge-slot empty">
                  <img src="assets/Locked_Badge.png" alt="Empty Badge Slot">
                </div>
              `;
            }
          }).join('')}
        </div>
      </div>

      <!-- Badge Detail Popup -->
      <div class="popup-overlay" id="badgeDetailPopup">
        <div class="popup-content">
          <div class="popup-header">
            <div class="popup-title" id="badgeDetailTitle">Badge</div>
            <button class="popup-close" id="closeBadgeDetail">×</button>
          </div>
          <div class="popup-body" id="badgeDetailBody">
          </div>
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

      <!-- Short Rest Selection Popup -->
      <div class="popup-overlay" id="shortRestSelectionPopup">
        <div class="popup-content">
          <div class="popup-header">
            <div class="popup-title">SHORT REST</div>
            <button class="popup-close" id="closeShortRestSelection">×</button>
          </div>
          <div class="popup-body">
            <div id="shortRestSelectionList" style="display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1rem;">
              <!-- Dynamically populated -->
            </div>
            <div class="popup-footer">
              <button id="continueShortRestButton" class="popup-button">Continue</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Short Rest Healing Popup -->
      <div class="popup-overlay" id="shortRestHealingPopup">
        <div class="popup-content">
          <div class="popup-header">
            <div class="popup-title">SHORT REST - <span id="shortRestEntityName">Trainer</span></div>
            <button class="popup-close" id="closeShortRestHealing">×</button>
          </div>
          <div class="popup-body" style="color: #e0e0e0;">
            <div style="text-align: center; margin-bottom: 0.75rem; color: #aaa; font-size: 0.9rem;">
              <span id="shortRestProgress">1 / 1</span>
            </div>
            <div style="margin-bottom: 1rem;">
              <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                <span>Current HP:</span>
                <span id="shortRestCurrentHP">0 / 0</span>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span>Current VP:</span>
                <span id="shortRestCurrentVP">0 / 0</span>
              </div>
            </div>
            <div style="border-top: 1px solid #555; padding-top: 1rem; margin-bottom: 1rem;">
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem;">
                <label for="hdToUse" style="font-weight: 600;">HD to use:</label>
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                  <input type="number" id="hdToUse" min="0" value="0" style="width: 60px; padding: 0.5rem; border: 1px solid #555; border-radius: 4px; text-align: center; background: #3a3a3a; color: white;">
                  <span id="hdAvailable">/ 0 available</span>
                </div>
              </div>
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem;">
                <label for="hpToHeal" style="font-weight: 600;">HP healed:</label>
                <input type="number" id="hpToHeal" min="0" value="0" style="width: 80px; padding: 0.5rem; border: 1px solid #555; border-radius: 4px; text-align: center; background: #3a3a3a; color: white;">
              </div>
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem;">
                <label for="vdToUse" style="font-weight: 600;">VD to use:</label>
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                  <input type="number" id="vdToUse" min="0" value="0" style="width: 60px; padding: 0.5rem; border: 1px solid #555; border-radius: 4px; text-align: center; background: #3a3a3a; color: white;">
                  <span id="vdAvailable">/ 0 available</span>
                </div>
              </div>
              <div style="display: flex; align-items: center; justify-content: space-between;">
                <label for="vpToHeal" style="font-weight: 600;">VP healed:</label>
                <input type="number" id="vpToHeal" min="0" value="0" style="width: 80px; padding: 0.5rem; border: 1px solid #555; border-radius: 4px; text-align: center; background: #3a3a3a; color: white;">
              </div>
            </div>
            <div class="popup-footer">
              <button id="completeShortRestHealingButton" class="popup-button">Next</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Long Rest Pokemon Selection Popup -->
      <div class="popup-overlay" id="shortRestPokemonSelectionPopup">
        <div class="popup-content">
          <div class="popup-header">
            <div class="popup-title">SHORT REST</div>
            <button class="popup-close" id="closeShortRestPokemonSelection">×</button>
          </div>
          <div class="popup-body">
            <div class="pokemon-selection-grid"></div>
            <div class="popup-footer">
              <button id="completeShortRestButton" class="popup-button" disabled>Complete Short Rest</button>
            </div>
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

  // Badge tap interaction
  const badgeSlots = document.querySelectorAll('.badge-slot.earned');
  if (badgeSlots.length > 0) {
    // Rebuild earned badges list for popups
    const trainerDataForBadges = JSON.parse(sessionStorage.getItem('trainerData') || '[]');
    const inventoryStrForBadges = trainerDataForBadges[20] || '';
    const itemsDbForBadges = JSON.parse(sessionStorage.getItem('items') || '[]');
    const badgeList = [];
    if (inventoryStrForBadges && itemsDbForBadges.length) {
      const items = inventoryStrForBadges.split(',').map(s => s.trim()).filter(Boolean);
      for (const entry of items) {
        const name = entry.replace(/\s*x\d+$/i, '').trim();
        const dbItem = itemsDbForBadges.find(it => it.name === name);
        if (dbItem && dbItem.type === 'Badges, Seals & Sigils' && name.includes('Badge')) {
          badgeList.push({ name: dbItem.name, description: dbItem.effect || dbItem.description || '' });
        }
      }
    }

    badgeSlots.forEach(slot => {
      slot.addEventListener('click', () => {
        const idx = parseInt(slot.dataset.badgeIndex, 10);
        const badge = badgeList[idx];
        if (!badge) return;
        document.getElementById('badgeDetailTitle').textContent = badge.name;
        document.getElementById('badgeDetailBody').textContent = badge.description || 'No description available.';
        document.getElementById('badgeDetailPopup').classList.add('active');
      });
    });
  }

  document.getElementById('closeBadgeDetail')?.addEventListener('click', () => {
    document.getElementById('badgeDetailPopup').classList.remove('active');
  });

  document.getElementById('badgeDetailPopup')?.addEventListener('click', (e) => {
    if (e.target.id === 'badgeDetailPopup') {
      document.getElementById('badgeDetailPopup').classList.remove('active');
    }
  });

  // Rest buttons - open rest popups directly
  document.getElementById('shortRestBtn')?.addEventListener('click', () => {
    showShortRestSelectionPopup();
  });

  document.getElementById('longRestBtn')?.addEventListener('click', () => {
    handleLongRest();
  });

  // Pokemon Center button - show confirmation
  document.getElementById('pokemonCenterBtn')?.addEventListener('click', () => {
    document.getElementById('pokemonCenterModal').classList.add('active');
  });

  document.getElementById('pokemonCenterCancel')?.addEventListener('click', () => {
    document.getElementById('pokemonCenterModal').classList.remove('active');
  });

  document.getElementById('pokemonCenterConfirm')?.addEventListener('click', async () => {
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
    trainerData[40] = getMaxCharges('Second Wind', trainerLevel);
    trainerData[41] = getMaxCharges('Rapid Orders', trainerLevel);
    trainerData[42] = getMaxCharges('Unbreakable Bond', trainerLevel);
    trainerData[43] = getMaxCharges('Elemental Synergy', trainerLevel);
    trainerData[44] = getMaxCharges('Master Trainer', trainerLevel);

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

    // Play PokeCenter sound, then reload to reflect changes
    await audioManager.playSfxAndWait('PokeCenter');
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

  // Rest popup close listeners
  document.getElementById('closeShortRestPokemonSelection')?.addEventListener('click', () => {
    document.getElementById('shortRestPokemonSelectionPopup').classList.remove('active');
  });
  document.getElementById('closeShortRestSelection')?.addEventListener('click', () => {
    document.getElementById('shortRestSelectionPopup').classList.remove('active');
  });
  document.getElementById('closeShortRestHealing')?.addEventListener('click', () => {
    document.getElementById('shortRestHealingPopup').classList.remove('active');
  });
  document.getElementById('continueShortRestButton')?.addEventListener('click', () => startShortRestHealing());
  document.getElementById('completeShortRestHealingButton')?.addEventListener('click', () => processShortRestHealing());
}

// ============================================================================
// SHORT REST AND LONG REST FUNCTIONS
// ============================================================================

function handleLongRest() {
  const trainerDataRaw = sessionStorage.getItem('trainerData');
  if (!trainerDataRaw) {
    showError('Trainer data not found.');
    return;
  }

  const trainerData = JSON.parse(trainerDataRaw);

  // Get all Pokemon for this trainer from session storage
  const allPokemonKeys = Object.keys(sessionStorage).filter(key => key.startsWith('pokemon_'));

  if (allPokemonKeys.length === 0) {
    showError('No Pokemon data found.');
    return;
  }

  // Filter for active party Pokemon
  const activePokemon = [];
  for (const key of allPokemonKeys) {
    const pokemonDataStr = sessionStorage.getItem(key);
    if (!pokemonDataStr) continue;

    const pokemonData = JSON.parse(pokemonDataStr);

    // Check if this Pokemon is in active party (index 38 is slot number 1-6)
    const slotNumber = parseInt(pokemonData[38], 10);
    if (slotNumber && slotNumber >= 1 && slotNumber <= 6) {
      activePokemon.push(pokemonData);
    }
  }

  if (activePokemon.length === 0) {
    showError('No Pokemon in active party.');
    return;
  }

  // Show Pokemon selection popup for long rest
  showLongRestPokemonSelection(activePokemon);
}

function showShortRestSelectionPopup() {
  const trainerDataRaw = sessionStorage.getItem('trainerData');
  if (!trainerDataRaw) {
    showError('Trainer data not found.');
    return;
  }

  const trainerData = JSON.parse(trainerDataRaw);
  const trainerName = trainerData[1];

  // Get all active party Pokemon
  const allPokemonKeys = Object.keys(sessionStorage).filter(key => key.startsWith('pokemon_'));
  const activePokemon = [];

  allPokemonKeys.forEach(key => {
    const pokemon = JSON.parse(sessionStorage.getItem(key));
    const slotNumber = parseInt(pokemon[38], 10);
    if (slotNumber && slotNumber >= 1 && slotNumber <= 6) {
      activePokemon.push(pokemon);
    }
  });

  // Build selection list
  const selectionList = document.getElementById('shortRestSelectionList');
  selectionList.innerHTML = '';

  // Add trainer option
  const trainerCurrentHP = parseInt(trainerData[34], 10) || parseInt(trainerData[11], 10);
  const trainerMaxHP = parseInt(trainerData[11], 10);
  const trainerCurrentVP = parseInt(trainerData[35], 10) || parseInt(trainerData[12], 10);
  const trainerMaxVP = parseInt(trainerData[12], 10);
  const trainerMaxHD = parseInt(trainerData[3], 10) || 0;
  const trainerMaxVD = parseInt(trainerData[4], 10) || 0;
  const trainerCurrentHD = (trainerData[47] === '' || trainerData[47] === null || trainerData[47] === undefined) ? trainerMaxHD : parseInt(trainerData[47], 10);
  const trainerCurrentVD = (trainerData[48] === '' || trainerData[48] === null || trainerData[48] === undefined) ? trainerMaxVD : parseInt(trainerData[48], 10);

  const trainerItem = document.createElement('label');
  trainerItem.style.cssText = 'display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem; background: #f5f5f5; border-radius: 8px; cursor: pointer; color: #333;';
  trainerItem.innerHTML = `
    <input type="checkbox" value="trainer" style="width: 20px; height: 20px; cursor: pointer;">
    <div style="flex: 1;">
      <div style="font-weight: 700;">${trainerName} (Trainer)</div>
      <div style="font-size: 0.85rem; color: #666;">HP: ${trainerCurrentHP}/${trainerMaxHP} | VP: ${trainerCurrentVP}/${trainerMaxVP} | HD: ${trainerCurrentHD} | VD: ${trainerCurrentVD}</div>
    </div>
  `;
  selectionList.appendChild(trainerItem);

  // Add Pokemon options
  activePokemon.forEach(pokemon => {
    const pokemonName = pokemon[2];
    const currentHP = parseInt(pokemon[45], 10) || parseInt(pokemon[10], 10);
    const maxHP = parseInt(pokemon[10], 10);
    const currentVP = parseInt(pokemon[46], 10) || parseInt(pokemon[12], 10);
    const maxVP = parseInt(pokemon[12], 10);
    const pokemonMaxHD = parseInt(pokemon[9], 10) || 0;
    const pokemonMaxVD = parseInt(pokemon[11], 10) || 0;
    const currentHD = (pokemon[54] === '' || pokemon[54] === null || pokemon[54] === undefined) ? pokemonMaxHD : parseInt(pokemon[54], 10);
    const currentVD = (pokemon[55] === '' || pokemon[55] === null || pokemon[55] === undefined) ? pokemonMaxVD : parseInt(pokemon[55], 10);

    const pokemonItem = document.createElement('label');
    pokemonItem.style.cssText = 'display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem; background: #f5f5f5; border-radius: 8px; cursor: pointer; color: #333;';
    pokemonItem.innerHTML = `
      <input type="checkbox" value="pokemon_${pokemonName.toLowerCase()}" style="width: 20px; height: 20px; cursor: pointer;">
      <div style="flex: 1;">
        <div style="font-weight: 700;">${pokemonName}</div>
        <div style="font-size: 0.85rem; color: #666;">HP: ${currentHP}/${maxHP} | VP: ${currentVP}/${maxVP} | HD: ${currentHD} | VD: ${currentVD}</div>
      </div>
    `;
    selectionList.appendChild(pokemonItem);
  });

  // Show the popup
  document.getElementById('shortRestSelectionPopup')?.classList.add('active');
}

function startShortRestHealing() {
  const selectionList = document.getElementById('shortRestSelectionList');
  const checkboxes = selectionList.querySelectorAll('input[type="checkbox"]:checked');

  if (checkboxes.length === 0) {
    showError('Please select at least one trainer or Pokemon to heal.');
    return;
  }

  // Build the healing queue
  shortRestQueue = [];
  shortRestCurrentIndex = 0;

  const trainerData = JSON.parse(sessionStorage.getItem('trainerData'));

  checkboxes.forEach(checkbox => {
    if (checkbox.value === 'trainer') {
      shortRestQueue.push({
        type: 'trainer',
        name: trainerData[1],
        storageKey: 'trainerData'
      });
    } else {
      const storageKey = checkbox.value;
      const pokemon = JSON.parse(sessionStorage.getItem(storageKey));
      shortRestQueue.push({
        type: 'pokemon',
        name: pokemon[2],
        storageKey: storageKey
      });
    }
  });

  // Close selection popup and show first healing form
  document.getElementById('shortRestSelectionPopup')?.classList.remove('active');
  showShortRestHealingForm();
}

function showShortRestHealingForm() {
  if (shortRestCurrentIndex >= shortRestQueue.length) {
    // All done
    document.getElementById('shortRestHealingPopup')?.classList.remove('active');
    window.location.reload();
    return;
  }

  const entity = shortRestQueue[shortRestCurrentIndex];
  const isTrainer = entity.type === 'trainer';

  // Update title and progress
  document.getElementById('shortRestEntityName').textContent = entity.name;
  document.getElementById('shortRestProgress').textContent = `${shortRestCurrentIndex + 1} / ${shortRestQueue.length}`;

  // Get entity data
  let currentHD, currentVD, currentHP, maxHP, currentVP, maxVP;

  if (isTrainer) {
    const trainerData = JSON.parse(sessionStorage.getItem('trainerData'));
    const maxHD = parseInt(trainerData[3], 10) || 0;
    const maxVD = parseInt(trainerData[4], 10) || 0;
    currentHD = (trainerData[47] === '' || trainerData[47] === null || trainerData[47] === undefined) ? maxHD : parseInt(trainerData[47], 10);
    currentVD = (trainerData[48] === '' || trainerData[48] === null || trainerData[48] === undefined) ? maxVD : parseInt(trainerData[48], 10);
    currentHP = parseInt(trainerData[34], 10) || parseInt(trainerData[11], 10);
    maxHP = parseInt(trainerData[11], 10);
    currentVP = parseInt(trainerData[35], 10) || parseInt(trainerData[12], 10);
    maxVP = parseInt(trainerData[12], 10);
  } else {
    const pokemon = JSON.parse(sessionStorage.getItem(entity.storageKey));
    const maxHD = parseInt(pokemon[9], 10) || 0;
    const maxVD = parseInt(pokemon[11], 10) || 0;
    currentHD = (pokemon[54] === '' || pokemon[54] === null || pokemon[54] === undefined) ? maxHD : parseInt(pokemon[54], 10);
    currentVD = (pokemon[55] === '' || pokemon[55] === null || pokemon[55] === undefined) ? maxVD : parseInt(pokemon[55], 10);
    currentHP = parseInt(pokemon[45], 10) || parseInt(pokemon[10], 10);
    maxHP = parseInt(pokemon[10], 10);
    currentVP = parseInt(pokemon[46], 10) || parseInt(pokemon[12], 10);
    maxVP = parseInt(pokemon[12], 10);
  }

  // Update display values
  document.getElementById('shortRestCurrentHP').textContent = `${currentHP} / ${maxHP}`;
  document.getElementById('shortRestCurrentVP').textContent = `${currentVP} / ${maxVP}`;
  document.getElementById('hdAvailable').textContent = `/ ${currentHD} available`;
  document.getElementById('vdAvailable').textContent = `/ ${currentVD} available`;

  // Reset input fields
  const hdInput = document.getElementById('hdToUse');
  const vdInput = document.getElementById('vdToUse');
  const hpInput = document.getElementById('hpToHeal');
  const vpInput = document.getElementById('vpToHeal');
  hdInput.value = 0;
  hdInput.max = currentHD;
  vdInput.value = 0;
  vdInput.max = currentVD;
  hpInput.value = 0;
  vpInput.value = 0;

  // Update button text
  const button = document.getElementById('completeShortRestHealingButton');
  if (shortRestCurrentIndex === shortRestQueue.length - 1) {
    button.textContent = 'Complete Short Rest';
  } else {
    button.textContent = 'Next';
  }

  // Show the popup
  document.getElementById('shortRestHealingPopup')?.classList.add('active');
}

async function processShortRestHealing() {
  const entity = shortRestQueue[shortRestCurrentIndex];
  const isTrainer = entity.type === 'trainer';

  const hdToUse = parseInt(document.getElementById('hdToUse').value, 10) || 0;
  const vdToUse = parseInt(document.getElementById('vdToUse').value, 10) || 0;
  const hpToHeal = parseInt(document.getElementById('hpToHeal').value, 10) || 0;
  const vpToHeal = parseInt(document.getElementById('vpToHeal').value, 10) || 0;

  // Allow skipping (0 HD and 0 VD) - just move to next
  if (hdToUse === 0 && vdToUse === 0 && hpToHeal === 0 && vpToHeal === 0) {
    shortRestCurrentIndex++;
    showShortRestHealingForm();
    return;
  }

  const { TrainerAPI, PokemonAPI } = await import('../api.js');

  if (isTrainer) {
    // Process trainer healing
    const trainerData = JSON.parse(sessionStorage.getItem('trainerData'));
    const trMaxHD = parseInt(trainerData[3], 10) || 0;
    const trMaxVD = parseInt(trainerData[4], 10) || 0;
    const currentHD = (trainerData[47] === '' || trainerData[47] === null || trainerData[47] === undefined) ? trMaxHD : parseInt(trainerData[47], 10);
    const currentVD = (trainerData[48] === '' || trainerData[48] === null || trainerData[48] === undefined) ? trMaxVD : parseInt(trainerData[48], 10);

    if (hdToUse > currentHD) {
      showError(`Not enough HD available. You have ${currentHD}.`);
      return;
    }
    if (vdToUse > currentVD) {
      showError(`Not enough VD available. You have ${currentVD}.`);
      return;
    }

    const currentHP = parseInt(trainerData[34], 10) || parseInt(trainerData[11], 10);
    const currentVP = parseInt(trainerData[35], 10) || parseInt(trainerData[12], 10);
    const maxHP = parseInt(trainerData[11], 10);
    const maxVP = parseInt(trainerData[12], 10);

    const newHP = Math.min(currentHP + hpToHeal, maxHP);
    const newVP = Math.min(currentVP + vpToHeal, maxVP);

    trainerData[47] = currentHD - hdToUse;
    trainerData[48] = currentVD - vdToUse;
    trainerData[34] = newHP;
    trainerData[35] = newVP;

    sessionStorage.setItem('trainerData', JSON.stringify(trainerData));

    // Update database in background
    TrainerAPI.update(trainerData).catch(error => {
      console.error('Error updating trainer data:', error);
    });
  } else {
    // Process Pokemon healing
    const pokemon = JSON.parse(sessionStorage.getItem(entity.storageKey));
    const pkMaxHD = parseInt(pokemon[9], 10) || 0;
    const pkMaxVD = parseInt(pokemon[11], 10) || 0;
    const currentHD = (pokemon[54] === '' || pokemon[54] === null || pokemon[54] === undefined) ? pkMaxHD : parseInt(pokemon[54], 10);
    const currentVD = (pokemon[55] === '' || pokemon[55] === null || pokemon[55] === undefined) ? pkMaxVD : parseInt(pokemon[55], 10);

    if (hdToUse > currentHD) {
      showError(`Not enough HD available. You have ${currentHD}.`);
      return;
    }
    if (vdToUse > currentVD) {
      showError(`Not enough VD available. You have ${currentVD}.`);
      return;
    }

    const currentHP = parseInt(pokemon[45], 10) || parseInt(pokemon[10], 10);
    const currentVP = parseInt(pokemon[46], 10) || parseInt(pokemon[12], 10);
    const maxHP = parseInt(pokemon[10], 10);
    const maxVP = parseInt(pokemon[12], 10);

    const newHP = Math.min(currentHP + hpToHeal, maxHP);
    const newVP = Math.min(currentVP + vpToHeal, maxVP);

    pokemon[54] = currentHD - hdToUse;
    pokemon[55] = currentVD - vdToUse;
    pokemon[45] = newHP;
    pokemon[46] = newVP;

    sessionStorage.setItem(entity.storageKey, JSON.stringify(pokemon));

    // Update database in background
    PokemonAPI.update(pokemon).catch(error => {
      console.error('Error updating Pokemon data:', error);
    });
  }

  // Move to next entity
  shortRestCurrentIndex++;
  showShortRestHealingForm();
}

function showLongRestPokemonSelection(activePokemon) {
  const pokemonGrid = document.querySelector('.pokemon-selection-grid');
  const completeButton = document.getElementById('completeShortRestButton');
  const popupTitle = document.querySelector('#shortRestPokemonSelectionPopup .popup-title');

  pokemonGrid.innerHTML = '';
  completeButton.disabled = true;

  // Update popup title and button text for long rest
  if (popupTitle) {
    popupTitle.textContent = 'LONG REST';
  }
  if (completeButton) {
    completeButton.textContent = 'Complete Long Rest';
  }

  // Create selection item for each active Pokemon
  activePokemon.forEach(pokemon => {
    const pokemonName = pokemon[2];
    const currentHP = parseInt(pokemon[45], 10) || parseInt(pokemon[10], 10);
    const maxHP = parseInt(pokemon[10], 10);
    const currentVP = parseInt(pokemon[46], 10) || parseInt(pokemon[12], 10);
    const maxVP = parseInt(pokemon[12], 10);

    const item = document.createElement('div');
    item.className = 'trainer-path-item';
    item.innerHTML = `
      <div style="font-weight: 700; margin-bottom: 0.5rem;">${pokemonName}</div>
      <div style="font-size: 0.85rem; color: #666;">HP: ${currentHP}/${maxHP}</div>
      <div style="font-size: 0.85rem; color: #666;">VP: ${currentVP}/${maxVP}</div>
    `;
    item.onclick = () => selectLongRestPokemon(pokemon);
    pokemonGrid.appendChild(item);
  });

  // Show the popup
  document.getElementById('shortRestPokemonSelectionPopup')?.classList.add('active');
}

function selectLongRestPokemon(pokemon) {
  const completeButton = document.getElementById('completeShortRestButton');

  // Remove selected class from all items
  document.querySelectorAll('.pokemon-selection-grid .trainer-path-item').forEach(item => {
    item.classList.remove('selected');
  });

  // Add selected class to clicked item (find by Pokemon name)
  const pokemonName = pokemon[2];
  document.querySelectorAll('.pokemon-selection-grid .trainer-path-item').forEach(item => {
    if (item.querySelector('div').textContent === pokemonName) {
      item.classList.add('selected');
    }
  });

  // Enable complete button
  completeButton.disabled = false;
  completeButton.onclick = () => completeLongRest(pokemon);
}

async function completeLongRest(selectedPokemon) {
  if (!selectedPokemon) return;

  const trainerDataRaw = sessionStorage.getItem('trainerData');
  if (!trainerDataRaw) {
    showError('Trainer data not found.');
    return;
  }

  const trainerData = JSON.parse(trainerDataRaw);
  const trainerLevel = parseInt(trainerData[2], 10);

  // Restore trainer HP and VP to max
  const maxHP = parseInt(trainerData[11], 10);
  const maxVP = parseInt(trainerData[12], 10);
  trainerData[34] = maxHP;
  trainerData[35] = maxVP;

  // Refill all buff charges to max
  trainerData[40] = getMaxCharges('Second Wind', trainerLevel);
  trainerData[41] = getMaxCharges('Rapid Orders', trainerLevel);
  trainerData[42] = getMaxCharges('Unbreakable Bond', trainerLevel);
  trainerData[43] = getMaxCharges('Elemental Synergy', trainerLevel);
  trainerData[44] = getMaxCharges('Master Trainer', trainerLevel);

  // Refill battle dice for Ace Trainer (index 45)
  const trainerPath = trainerData[25] || '';
  if (trainerPath === 'Ace Trainer' && trainerLevel >= 5) {
    const wisModifier = Math.floor((parseInt(trainerData[9], 10) - 10) / 2);
    const maxBattleDice = 1 + wisModifier;
    trainerData[45] = `${maxBattleDice} - ${maxBattleDice}`;
  }

  // Restore half of HD dice and VD dice
  const maxHD = parseInt(trainerData[3], 10) || 0;
  const maxVD = parseInt(trainerData[4], 10) || 0;
  const currentHD = (trainerData[47] === '' || trainerData[47] === null || trainerData[47] === undefined) ? maxHD : parseInt(trainerData[47], 10);
  const currentVD = (trainerData[48] === '' || trainerData[48] === null || trainerData[48] === undefined) ? maxVD : parseInt(trainerData[48], 10);

  const hdToRestore = Math.floor(maxHD / 2);
  const vdToRestore = Math.floor(maxVD / 2);
  trainerData[47] = Math.min(currentHD + hdToRestore, maxHD);
  trainerData[48] = Math.min(currentVD + vdToRestore, maxVD);

  // Update session storage
  sessionStorage.setItem('trainerData', JSON.stringify(trainerData));

  // Restore half HD/VD for ALL active party Pokemon, and full HP/VP for the selected one
  const allPokemonKeys = Object.keys(sessionStorage).filter(key => key.startsWith('pokemon_'));
  const pokemonToUpdate = [];

  allPokemonKeys.forEach(key => {
    const pokemonData = JSON.parse(sessionStorage.getItem(key));
    if (!pokemonData) return;

    const slotNumber = parseInt(pokemonData[38], 10);
    if (!slotNumber || slotNumber < 1 || slotNumber > 6) return; // Skip non-active Pokemon

    // Restore half HD/VD for all active party Pokemon
    const pkMaxHD = parseInt(pokemonData[9], 10) || 0;
    const pkMaxVD = parseInt(pokemonData[11], 10) || 0;
    const pkCurrentHD = (pokemonData[54] === '' || pokemonData[54] === null || pokemonData[54] === undefined) ? pkMaxHD : parseInt(pokemonData[54], 10);
    const pkCurrentVD = (pokemonData[55] === '' || pokemonData[55] === null || pokemonData[55] === undefined) ? pkMaxVD : parseInt(pokemonData[55], 10);

    pokemonData[54] = Math.min(pkCurrentHD + Math.floor(pkMaxHD / 2), pkMaxHD);
    pokemonData[55] = Math.min(pkCurrentVD + Math.floor(pkMaxVD / 2), pkMaxVD);

    // Restore full HP/VP only for the selected Pokemon
    if (pokemonData[2] === selectedPokemon[2]) {
      pokemonData[45] = parseInt(pokemonData[10], 10);
      pokemonData[46] = parseInt(pokemonData[12], 10);
    }

    sessionStorage.setItem(key, JSON.stringify(pokemonData));
    pokemonToUpdate.push(pokemonData);
  });

  // Close selection popup and reload
  document.getElementById('shortRestPokemonSelectionPopup')?.classList.remove('active');
  window.location.reload();

  // Update database in background
  const { TrainerAPI, PokemonAPI } = await import('../api.js');

  TrainerAPI.update(trainerData).then(() => {
    console.log('Long rest trainer data saved to backend');
  }).catch(error => {
    console.error('Error saving trainer long rest to backend:', error);
  });

  pokemonToUpdate.forEach(pokemon => {
    PokemonAPI.update(pokemon).then(() => {
      console.log(`Long rest: ${pokemon[2]} saved to backend`);
    }).catch(error => {
      console.error(`Error saving ${pokemon[2]} long rest to backend:`, error);
    });
  });
}
