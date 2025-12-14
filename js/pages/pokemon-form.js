// Pokemon Form Page - Register new Pokemon for trainer

import { PokemonAPI, GameDataAPI } from '../api.js';
import { showSuccess, showError } from '../utils/notifications.js';

export function renderPokemonForm() {
  // Load selected Pokemon data from session storage
  const selectedPokemonData = JSON.parse(sessionStorage.getItem('selectedPokemonData'));
  const natures = JSON.parse(sessionStorage.getItem('natures') || '[]');
  const items = JSON.parse(sessionStorage.getItem('items') || '[]');

  if (!selectedPokemonData) {
    return '<div class="error">No Pokemon selected. Please go back and select a Pokemon.</div>';
  }

  const pokemonName = selectedPokemonData[1] || 'Unknown';

  const html = `
    <div class="pokemon-form-page">
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

        .pokemon-form-page::before {
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
          z-index: 0;
        }

        .pokemon-form-page {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 2vh 1vw;
          min-height: 80vh;
          position: relative;
        }

        .pokemon-form-page > * {
          position: relative;
          z-index: 1;
        }

        .pokemon-form-page h1 {
          color: white;
          margin-bottom: 2vh;
          font-size: clamp(1.5rem, 4vw, 2.5rem);
          text-transform: uppercase;
          letter-spacing: clamp(0.5px, 0.5vw, 2px);
          text-shadow: 0 clamp(2px, 0.5vh, 4px) clamp(5px, 1.5vh, 10px) rgba(0,0,0,0.8);
          font-weight: 900;
        }

        .form-container {
          width: 100%;
          max-width: clamp(400px, 60vw, 600px);
          background: linear-gradient(135deg, #FFFFFF 0%, #F8F8F8 100%);
          padding: clamp(1.5rem, 3vw, 2.5rem);
          border-radius: clamp(15px, 3vw, 25px);
          border: clamp(2px, 0.5vw, 4px) solid #FFDE00;
          box-shadow: 0 clamp(10px, 2vh, 15px) clamp(25px, 5vh, 40px) rgba(0,0,0,0.4),
                      inset 0 clamp(-2px, -0.5vh, -4px) 0 rgba(0,0,0,0.05);
          margin-bottom: 2vh;
          max-height: 70vh;
          overflow-y: auto;
        }

        .form-group {
          margin-bottom: clamp(1rem, 2vh, 1.5rem);
        }

        .form-group label {
          display: block;
          font-weight: bold;
          font-size: clamp(1rem, 2vw, 1.2rem);
          margin-bottom: clamp(0.3rem, 1vh, 0.5rem);
          color: #333;
        }

        .form-group input[type="number"],
        .form-group input[type="text"],
        .form-group select {
          width: 100%;
          padding: clamp(0.5rem, 1.5vh, 0.75rem);
          font-size: clamp(0.9rem, 1.8vw, 1.1rem);
          border: clamp(1px, 0.3vw, 2px) solid #ccc;
          border-radius: clamp(3px, 0.8vw, 5px);
          box-sizing: border-box;
        }

        .form-group input:focus,
        .form-group select:focus {
          border-color: #f44336;
          outline: none;
        }

        .abilities-container {
          padding: clamp(0.75rem, 1.5vh, 1rem);
          border: clamp(2px, 0.4vw, 3px) solid #FFDE00;
          border-radius: clamp(10px, 2vw, 15px);
          max-height: clamp(250px, 40vh, 350px);
          overflow-y: auto;
          background: linear-gradient(135deg, #FFFFFF 0%, #F8F8F8 100%);
        }

        .checkbox-item {
          display: flex;
          align-items: flex-start;
          margin-bottom: clamp(0.75rem, 1.5vh, 1rem);
        }

        .checkbox-item input[type="checkbox"] {
          margin-right: clamp(0.5rem, 1vw, 0.75rem);
          margin-top: clamp(0.15rem, 0.4vh, 0.25rem);
          transform: scale(clamp(1.2, 0.3vw, 1.5));
          cursor: pointer;
        }

        .checkbox-item label {
          font-size: clamp(0.95rem, 1.8vw, 1.1rem);
          cursor: pointer;
          margin: 0;
        }

        .ability-description {
          font-size: clamp(0.8rem, 1.5vw, 0.9rem);
          color: #666;
          font-weight: normal;
          margin-top: clamp(0.2rem, 0.5vh, 0.3rem);
          line-height: 1.3;
          display: block;
        }

        .button-group {
          display: flex;
          gap: clamp(0.75rem, 2vw, 1rem);
          justify-content: center;
          margin-top: clamp(1.5rem, 3vh, 2rem);
        }

        .button {
          padding: clamp(0.75rem, 1.5vh, 1rem) clamp(1.5rem, 3vw, 2rem);
          border: none;
          border-radius: clamp(3px, 0.8vw, 5px);
          font-size: clamp(1rem, 2vw, 1.2rem);
          font-weight: bold;
          cursor: pointer;
          transition: all 0.3s;
        }

        .button-primary {
          background: linear-gradient(135deg, #4CAF50 0%, #45A049 100%);
          color: white;
          border: clamp(2px, 0.4vw, 3px) solid #FFDE00;
          border-radius: clamp(10px, 2vw, 15px);
          font-size: clamp(1rem, 2vw, 1.2rem);
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: clamp(0.5px, 0.2vw, 1px);
          box-shadow: 0 clamp(5px, 1vh, 8px) clamp(12px, 2.5vh, 20px) rgba(0,0,0,0.3);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .button-primary:hover {
          transform: translateY(clamp(-1px, -0.3vh, -2px));
          box-shadow: 0 clamp(8px, 1.5vh, 12px) clamp(20px, 3.5vh, 30px) rgba(0,0,0,0.4),
                      0 0 clamp(15px, 2.5vh, 20px) rgba(76,175,80,0.5);
        }

        .button-secondary {
          background: linear-gradient(135deg, #EE1515 0%, #C91010 100%);
          color: white;
          border: clamp(2px, 0.4vw, 3px) solid #333;
          border-radius: clamp(10px, 2vw, 15px);
          font-size: clamp(1rem, 2vw, 1.2rem);
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: clamp(0.5px, 0.2vw, 1px);
          box-shadow: 0 clamp(5px, 1vh, 8px) clamp(12px, 2.5vh, 20px) rgba(0,0,0,0.3);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .button-secondary:hover {
          transform: translateY(clamp(-1px, -0.3vh, -2px));
          box-shadow: 0 clamp(8px, 1.5vh, 12px) clamp(20px, 3.5vh, 30px) rgba(0,0,0,0.4),
                      0 0 clamp(15px, 2.5vh, 20px) rgba(238,21,21,0.5);
        }

        @media (max-width: 1024px) {
          .form-container {
            max-width: clamp(400px, 65vw, 600px);
          }
        }

        @media (max-width: 768px) {
          .form-container {
            max-width: clamp(400px, 70vw, 600px);
          }

          .button-group {
            gap: clamp(0.65rem, 1.8vw, 0.9rem);
          }
        }

        @media (max-width: 600px) {
          .form-container {
            max-width: clamp(350px, 75vw, 550px);
          }

          .button-group {
            gap: clamp(0.6rem, 1.5vw, 0.8rem);
          }
        }

        @media (max-width: 480px) {
          .form-container {
            max-width: 85vw;
            padding: clamp(1.2rem, 2.5vw, 2rem);
          }

          .button-group {
            flex-direction: column;
            gap: clamp(0.75rem, 1.5vh, 1rem);
          }

          .button {
            width: 100%;
          }
        }

        @media (max-width: 360px) {
          .form-container {
            max-width: 90vw;
            padding: clamp(1rem, 2vw, 1.5rem);
          }
        }
      </style>

      <h1>Register ${pokemonName}</h1>

      <div class="form-container">
        <form id="pokemonForm">
          <div class="form-group">
            <label for="level">Level</label>
            <input type="number" id="level" name="level" value="1" min="1" max="100" required />
          </div>

          <div class="form-group">
            <label for="nature">Nature</label>
            <select id="nature" name="nature" required>
              ${natures.map(n => `
                <option value="${n.name}">${n.name}</option>
              `).join('')}
            </select>
          </div>

          <div class="form-group">
            <label for="loyalty">Loyalty</label>
            <input type="number" id="loyalty" name="loyalty" value="0" min="-10" max="10" required />
          </div>

          <!-- Abilities Section -->
          <div class="form-group">
            <label>Abilities</label>
            <div class="abilities-container" id="abilitiesContent">
              <!-- Abilities will be populated dynamically -->
            </div>
          </div>

          <div class="form-group">
            <label for="heldItem">Held Item</label>
            <input type="text" id="heldItem" name="heldItem" list="heldItemList" autocomplete="off" />
            <datalist id="heldItemList">
              ${items.map(item => `
                <option value="${item.name}">
              `).join('')}
            </datalist>
          </div>

          <div class="form-group">
            <label for="nickname">Nickname</label>
            <input type="text" id="nickname" name="nickname" />
          </div>

          <!-- Buttons -->
          <div class="button-group">
            <button type="submit" class="button button-primary">Register Pokémon</button>
            <button type="button" class="button button-secondary" id="cancelButton">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `;

  return html;
}

export function attachPokemonFormListeners() {
  const selectedPokemonData = JSON.parse(sessionStorage.getItem('selectedPokemonData'));

  // Populate abilities
  populateAbilityOptions(selectedPokemonData);

  // Cancel button
  document.getElementById('cancelButton')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('navigate', {
      detail: { route: 'my-pokemon' }
    }));
  });

  // Form submission
  document.getElementById('pokemonForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await handleFormSubmit();
  });
}

function populateAbilityOptions(selectedPokemonData) {
  const abilitiesContent = document.getElementById('abilitiesContent');
  if (!abilitiesContent) return;

  abilitiesContent.innerHTML = '';

  // Get all three possible abilities (indices 6, 7, 8)
  // 0 = primary, 1 = secondary, 2 = hidden
  const abilities = [
    selectedPokemonData[6],
    selectedPokemonData[7],
    selectedPokemonData[8]
  ];

  abilities.forEach((abilityData, slotIndex) => {
    // Skip empty abilities
    if (!abilityData) return;

    // Parse ability data (format: "AbilityName,Description")
    const parts = abilityData.split(',');
    const abilityName = parts[0].trim();
    const abilityDescription = parts.slice(1).join(',').trim();

    // Create checkbox container
    const div = document.createElement('div');
    div.className = 'checkbox-item';

    // Create checkbox
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `ability${slotIndex}`;
    checkbox.name = 'abilities';
    // Store slotIndex:name;description format
    checkbox.value = slotIndex + ':' + abilityName + ';' + abilityDescription;

    // Create label with name and description
    const label = document.createElement('label');
    label.htmlFor = `ability${slotIndex}`;
    label.innerHTML = `<strong>${abilityName}</strong><span class="ability-description">${abilityDescription}</span>`;

    div.appendChild(checkbox);
    div.appendChild(label);
    abilitiesContent.appendChild(div);
  });
}

async function handleFormSubmit() {
  const form = document.getElementById('pokemonForm');
  const trainerData = JSON.parse(sessionStorage.getItem('trainerData'));
  const selectedPokemonData = JSON.parse(sessionStorage.getItem('selectedPokemonData'));
  const natures = JSON.parse(sessionStorage.getItem('natures') || '[]');

  if (!trainerData || !selectedPokemonData) {
    showError('Missing trainer or Pokemon data');
    return;
  }

  // Show loading
  document.getElementById('content').innerHTML = '<div class="loading">Registering Pokemon...</div>';

  try {
    // Gather form data
    const level = parseInt(form.level.value);
    const nature = form.nature.value;
    const loyalty = parseInt(form.loyalty.value);
    const heldItem = form.heldItem.value;
    const nickname = form.nickname.value;

    // Get selected abilities
    const selectedAbilities = Array.from(document.querySelectorAll('input[name="abilities"]:checked'))
      .map(cb => cb.value)
      .join('|');

    // Apply nature modifiers to stats
    const natureData = natures.find(n => n.name === nature);
    let modifiedPokemonData = [...selectedPokemonData];

    if (natureData) {
      const boostStat = natureData.boostStat?.toLowerCase();
      const nerfStat = natureData.nerfStat?.toLowerCase();
      const boostAmount = parseInt(natureData.boostAmount) || 0;
      const nerfAmount = parseInt(natureData.nerfAmount) || 0;

      if (boostStat) {
        const statIndex = 16 + getStatIndex(boostStat);
        modifiedPokemonData[statIndex] = (modifiedPokemonData[statIndex] || 0) + boostAmount;
      }
      if (nerfStat) {
        const statIndex = 16 + getStatIndex(nerfStat);
        modifiedPokemonData[statIndex] = (modifiedPokemonData[statIndex] || 0) - nerfAmount;
      }
    }

    // Format movement and senses data
    const movementData = selectedPokemonData[31] || {};
    const sensesData = selectedPokemonData[32] || {};

    const movementDataString = [
      movementData.walking || '-',
      movementData.climbing || '-',
      movementData.flying || '-',
      movementData.hovering || '-',
      movementData.swimming || '-',
      movementData.burrowing || '-'
    ].join(', ');

    const sensesDataString = [
      sensesData.sight || '-',
      sensesData.hearing || '-',
      sensesData.smell || '-',
      sensesData.tremorsense || '-',
      sensesData.echolocation || '-',
      sensesData.telepathy || '-',
      sensesData.blindsight || '-',
      sensesData.darkvision || '-',
      sensesData.truesight || '-'
    ].join(', ');

    // Get type effectiveness
    const typeResponse = await GameDataAPI.getTypeEffectiveness(
      selectedPokemonData[4],
      selectedPokemonData[5]
    );
    const typematchupsString = typeResponse.effectiveness ?
      typeResponse.effectiveness.join(', ') : '';

    // Build new Pokemon data array
    const newPokemonData = [
      trainerData[1],              // Trainer name
      selectedPokemonData[0],      // Image
      selectedPokemonData[1],      // Name
      selectedPokemonData[2],      // Dex Entry
      level,                       // Level
      selectedPokemonData[4],      // Primary Type
      selectedPokemonData[5],      // Secondary Type
      selectedAbilities,           // Abilities
      selectedPokemonData[9],      // AC
      selectedPokemonData[10],     // Hit Dice
      '',                          // HP (to be calculated)
      selectedPokemonData[12],     // Vitality Dice
      '',                          // VP (to be calculated)
      movementDataString,          // Speed
      selectedPokemonData[15],     // Total Stats
      modifiedPokemonData[16],     // Strength
      modifiedPokemonData[17],     // Dexterity
      modifiedPokemonData[18],     // Constitution
      modifiedPokemonData[19],     // Intelligence
      modifiedPokemonData[20],     // Wisdom
      modifiedPokemonData[21],     // Charisma
      selectedPokemonData[22],     // Saving Throws
      selectedPokemonData[23],     // Skills
      selectedPokemonData[24],     // Starting Moves
      selectedPokemonData[25],     // Level 2 Moves
      selectedPokemonData[26],     // Level 6 Moves
      selectedPokemonData[27],     // Level 10 Moves
      selectedPokemonData[28],     // Level 14 Moves
      selectedPokemonData[29],     // Level 18 Moves
      selectedPokemonData[30],     // Evolution Requirement
      '',                          // Initiative (to be calculated)
      '',                          // Proficiency Bonus (to be calculated)
      nature,                      // Nature
      loyalty,                     // Loyalty
      '',                          // STAB (to be calculated)
      heldItem,                    // Held Item
      nickname,                    // Nickname
      '',                          // Custom Moves
      '',                          // In Active Party
      '',                          // STR Modifier (to be calculated)
      '',                          // DEX Modifier (to be calculated)
      '',                          // CON Modifier (to be calculated)
      '',                          // INT Modifier (to be calculated)
      '',                          // WIS Modifier (to be calculated)
      '',                          // CHA Modifier (to be calculated)
      '',                          // currentHP
      '',                          // currentVP
      '',                          // currentAC
      '',                          // comments
      sensesDataString,            // Senses
      '',                          // Feats
      '',                          // Gear
      selectedPokemonData[33],     // Flavor text
      typematchupsString           // Type matchups
    ];

    // Register the Pokemon
    const response = await PokemonAPI.register(trainerData[1], newPokemonData);

    if (response.status === 'success') {
      // Update session storage with new Pokemon
      const finalPokemonData = response.newPokemonData || newPokemonData;
      sessionStorage.setItem(`pokemon_${selectedPokemonData[1].toLowerCase()}`, JSON.stringify(finalPokemonData));

      // Update complete Pokemon data
      const completePokemonData = JSON.parse(sessionStorage.getItem('completePokemonData') || '[]');
      completePokemonData.push(finalPokemonData);
      sessionStorage.setItem('completePokemonData', JSON.stringify(completePokemonData));

      showSuccess(`${trainerData[1]} caught a ${selectedPokemonData[1]}!`);

      // Navigate to my pokemon page
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('navigate', {
          detail: { route: 'my-pokemon' }
        }));
      }, 2000);
    } else {
      showError(response.message || 'Failed to register Pokemon');
      // Reload form
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('navigate', {
          detail: { route: 'pokemon-form' }
        }));
      }, 2000);
    }
  } catch (error) {
    console.error('Error registering Pokemon:', error);
    showError('Failed to register Pokemon');
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('navigate', {
        detail: { route: 'pokemon-form' }
      }));
    }, 2000);
  }
}

function getStatIndex(statName) {
  const statMapping = {
    'strength': 0,
    'dexterity': 1,
    'constitution': 2,
    'intelligence': 3,
    'wisdom': 4,
    'charisma': 5,
    'ac': -7
  };
  return statMapping[statName] || 0;
}
