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
          background: linear-gradient(to bottom, #f44336 80%, #ffffff 20%);
        }

        .pokemon-form-page {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 2rem 1rem;
          min-height: 80vh;
        }

        .pokemon-form-page h1 {
          color: white;
          margin-bottom: 2rem;
          font-size: 2.5rem;
        }

        .form-container {
          width: 100%;
          max-width: 600px;
          background-color: white;
          padding: 2.5rem;
          border-radius: 10px;
          box-shadow: 0 4px 10px rgba(0,0,0,0.2);
          margin-bottom: 2rem;
          max-height: 70vh;
          overflow-y: auto;
        }

        .form-group {
          margin-bottom: 1.5rem;
        }

        .form-group label {
          display: block;
          font-weight: bold;
          font-size: 1.2rem;
          margin-bottom: 0.5rem;
          color: #333;
        }

        .form-group input[type="number"],
        .form-group input[type="text"],
        .form-group select {
          width: 100%;
          padding: 0.75rem;
          font-size: 1.1rem;
          border: 2px solid #ccc;
          border-radius: 5px;
          box-sizing: border-box;
        }

        .form-group input:focus,
        .form-group select:focus {
          border-color: #f44336;
          outline: none;
        }

        .collapsible-section {
          margin-bottom: 1.5rem;
        }

        .collapsible-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1rem;
          background: #f44336;
          color: white;
          border-radius: 5px;
          cursor: pointer;
          font-size: 1.3rem;
          font-weight: bold;
        }

        .collapsible-header:hover {
          background: #d32f2f;
        }

        .arrow {
          transition: transform 0.3s;
        }

        .arrow.open {
          transform: rotate(90deg);
        }

        .collapsible-content {
          display: none;
          padding: 1rem;
          border: 2px solid #f44336;
          border-top: none;
          border-radius: 0 0 5px 5px;
          max-height: 300px;
          overflow-y: auto;
        }

        .collapsible-content.open {
          display: block;
        }

        .checkbox-item {
          display: flex;
          align-items: flex-start;
          margin-bottom: 1rem;
        }

        .checkbox-item input[type="checkbox"] {
          margin-right: 0.75rem;
          margin-top: 0.25rem;
          transform: scale(1.5);
          cursor: pointer;
        }

        .checkbox-item label {
          font-size: 1.1rem;
          cursor: pointer;
          margin: 0;
        }

        .ability-description {
          font-size: 0.9rem;
          color: #666;
          font-weight: normal;
          margin-top: 0.3rem;
          line-height: 1.3;
          display: block;
        }

        .button-group {
          display: flex;
          gap: 1rem;
          justify-content: center;
          margin-top: 2rem;
        }

        .button {
          padding: 1rem 2rem;
          border: none;
          border-radius: 5px;
          font-size: 1.2rem;
          font-weight: bold;
          cursor: pointer;
          transition: all 0.3s;
        }

        .button-primary {
          background-color: #4CAF50;
          color: white;
        }

        .button-primary:hover {
          background-color: #45a049;
        }

        .button-secondary {
          background-color: #f44336;
          color: white;
        }

        .button-secondary:hover {
          background-color: #d32f2f;
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
          <div class="collapsible-section">
            <div class="collapsible-header" id="abilitiesHeader">
              <span>Abilities</span>
              <span class="arrow" id="abilitiesArrow">▶</span>
            </div>
            <div class="collapsible-content" id="abilitiesContent">
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

  // Collapsible abilities section
  const header = document.getElementById('abilitiesHeader');
  const content = document.getElementById('abilitiesContent');
  const arrow = document.getElementById('abilitiesArrow');

  header?.addEventListener('click', () => {
    content.classList.toggle('open');
    arrow.classList.toggle('open');
  });

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
