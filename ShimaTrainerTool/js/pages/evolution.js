// Evolution Page - Evolve Pokemon with stat allocation

import { PokemonAPI, GameDataAPI } from '../api.js';
import { showSuccess, showError } from '../utils/notifications.js';

// Module-level state
let selectedPokemon = null;
let currentPokemon = null;
let availableSkillPoints = 0;
let allocatedSkillPoints = 0;
let evolutionOptions = [];

export function renderEvolution() {
  const selectedPokemonName = sessionStorage.getItem('selectedPokemonName');

  if (!selectedPokemonName) {
    return '<div class="error">No Pokemon selected. Please return to the trainer card.</div>';
  }

  const pokemonDataStr = sessionStorage.getItem(`pokemon_${selectedPokemonName.toLowerCase()}`);
  if (!pokemonDataStr) {
    return '<div class="error">Pokemon data not found. Please return to the trainer card.</div>';
  }

  currentPokemon = JSON.parse(pokemonDataStr);
  const pokemonName = currentPokemon[2] || 'Unknown';

  const html = `
    <div class="evolution-page">
      <style>
        body, .content {
          background: linear-gradient(to bottom, #f44336 80%, #ffffff 20%);
        }

        .evolution-page {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 2rem 1rem;
          min-height: 80vh;
        }

        .evolution-page h1 {
          color: white;
          margin-bottom: 2rem;
          font-size: 2.5rem;
        }

        .evolution-container {
          display: flex;
          justify-content: space-around;
          width: 90%;
          max-width: 1200px;
          flex-grow: 1;
          gap: 2rem;
        }

        .evolution-list {
          width: 45%;
          max-height: 65vh;
          overflow-y: auto;
          border: 2px solid black;
          border-radius: 10px;
          padding: 20px;
          background-color: white;
        }

        .evolution-list h2 {
          text-align: center;
          margin-top: 0;
          margin-bottom: 20px;
          font-size: 1.5rem;
        }

        .evolution-list ul {
          list-style: none;
          padding: 0;
          margin: 0;
        }

        .evolution-list li {
          font-size: 1.2rem;
          margin-bottom: 15px;
          cursor: pointer;
          padding: 10px;
          border-radius: 5px;
          transition: background-color 0.2s;
        }

        .evolution-list li:hover {
          background-color: #f0f0f0;
        }

        .evolution-list li.selected {
          background-color: #f44336;
          color: white;
        }

        .pokemon-details {
          width: 50%;
          text-align: center;
          display: none;
          color: black;
          background-color: white;
          border-radius: 10px;
          padding: 20px;
        }

        .pokemon-details.visible {
          display: block;
        }

        .pokemon-details img {
          width: 250px;
          height: 250px;
          background-color: #f0f0f0;
          border-radius: 10px;
          object-fit: contain;
          margin-bottom: 20px;
        }

        .pokemon-details .detail-item {
          font-size: 1.2rem;
          margin-bottom: 10px;
        }

        .evolve-button {
          background-color: #4CAF50;
          color: white;
          border: none;
          border-radius: 5px;
          padding: 15px 30px;
          font-size: 1.3rem;
          cursor: pointer;
          transition: background-color 0.3s;
          margin-top: 20px;
        }

        .evolve-button:hover {
          background-color: #45a049;
        }

        /* Modal styles */
        .modal {
          display: none;
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background-color: rgba(0, 0, 0, 0.5);
          justify-content: center;
          align-items: center;
          z-index: 1000;
        }

        .modal.visible {
          display: flex;
        }

        .modal-content {
          background-color: white;
          padding: 30px;
          border-radius: 10px;
          text-align: center;
          width: 450px;
          max-width: 90%;
        }

        .modal-content h2 {
          margin-top: 0;
          margin-bottom: 20px;
          font-size: 1.8rem;
        }

        .available-skill-points {
          font-size: 1.3rem;
          margin-bottom: 15px;
          font-weight: bold;
        }

        .remaining-points {
          font-size: 1.1rem;
          margin-bottom: 20px;
          color: #666;
        }

        .stat-input {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 15px;
          padding: 10px;
          background: #f5f5f5;
          border-radius: 5px;
        }

        .stat-input span {
          font-size: 1.1rem;
        }

        .stat-input .new-stat {
          color: #4CAF50;
          font-weight: bold;
        }

        .stat-input input {
          width: 60px;
          font-size: 1.1rem;
          padding: 5px;
          text-align: center;
          border: 1px solid #ccc;
          border-radius: 3px;
        }

        .modal-buttons {
          display: flex;
          gap: 10px;
          justify-content: center;
          margin-top: 20px;
        }

        .confirm-button {
          background-color: #4CAF50;
          color: white;
          border: none;
          padding: 12px 24px;
          font-size: 1.1rem;
          cursor: pointer;
          border-radius: 5px;
        }

        .confirm-button:hover {
          background-color: #45a049;
        }

        .cancel-button {
          background-color: #f44336;
          color: white;
          border: none;
          padding: 12px 24px;
          font-size: 1.1rem;
          cursor: pointer;
          border-radius: 5px;
        }

        .cancel-button:hover {
          background-color: #d32f2f;
        }

        /* Success message */
        .success-overlay {
          display: none;
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background-color: rgba(0, 0, 0, 0.5);
          z-index: 2000;
        }

        .success-message {
          display: none;
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background-color: white;
          padding: 30px;
          border-radius: 10px;
          text-align: center;
          z-index: 2001;
          border: 3px solid #4CAF50;
        }

        .success-message h2 {
          color: #4CAF50;
          margin-top: 0;
        }

        @media (max-width: 768px) {
          .evolution-container {
            flex-direction: column;
          }

          .evolution-list,
          .pokemon-details {
            width: 100%;
          }
        }
      </style>

      <h1>Evolve ${pokemonName}</h1>

      <div class="evolution-container">
        <div class="evolution-list">
          <h2>Select Evolution</h2>
          <ul id="pokemonList">
            <li>Loading evolution options...</li>
          </ul>
        </div>

        <div class="pokemon-details" id="pokemonDetails">
          <img src="" alt="Pokemon" id="pokemonImage" onerror="this.src='assets/Pokeball.png'">
          <div class="detail-item">Name: <strong id="pokemonName"></strong></div>
          <div class="detail-item">Dex Entry: <strong id="pokemonDexEntry"></strong></div>
          <div class="detail-item">Type: <strong id="pokemonType"></strong></div>
          <button class="evolve-button" id="evolveButton">Evolve Pokemon</button>
        </div>
      </div>

      <!-- Stat Allocation Modal -->
      <div id="evolutionModal" class="modal">
        <div class="modal-content">
          <h2>Allocate Stat Points</h2>
          <div class="available-skill-points">Available Points: <span id="availableSkillPoints">0</span></div>
          <div class="remaining-points">Remaining: <span id="remainingPoints">0</span></div>

          <div class="stat-input">
            <span>STR (<span id="currentStr">0</span> → <span class="new-stat" id="newStr">0</span>)</span>
            <input type="number" id="strPoints" value="0" min="0">
          </div>
          <div class="stat-input">
            <span>DEX (<span id="currentDex">0</span> → <span class="new-stat" id="newDex">0</span>)</span>
            <input type="number" id="dexPoints" value="0" min="0">
          </div>
          <div class="stat-input">
            <span>CON (<span id="currentCon">0</span> → <span class="new-stat" id="newCon">0</span>)</span>
            <input type="number" id="conPoints" value="0" min="0">
          </div>
          <div class="stat-input">
            <span>INT (<span id="currentInt">0</span> → <span class="new-stat" id="newInt">0</span>)</span>
            <input type="number" id="intPoints" value="0" min="0">
          </div>
          <div class="stat-input">
            <span>WIS (<span id="currentWis">0</span> → <span class="new-stat" id="newWis">0</span>)</span>
            <input type="number" id="wisPoints" value="0" min="0">
          </div>
          <div class="stat-input">
            <span>CHA (<span id="currentCha">0</span> → <span class="new-stat" id="newCha">0</span>)</span>
            <input type="number" id="chaPoints" value="0" min="0">
          </div>

          <div class="modal-buttons">
            <button class="confirm-button" id="confirmEvolutionBtn">Confirm</button>
            <button class="cancel-button" id="cancelEvolutionBtn">Cancel</button>
          </div>
        </div>
      </div>

      <!-- Success Message -->
      <div id="successOverlay" class="success-overlay"></div>
      <div id="successMessage" class="success-message">
        <h2>Evolution Successful!</h2>
        <p>Your Pokemon has evolved into <strong id="evolvedPokemonName"></strong>!</p>
      </div>
    </div>
  `;

  return html;
}

export function attachEvolutionListeners() {
  // Reset state
  selectedPokemon = null;
  allocatedSkillPoints = 0;
  evolutionOptions = [];

  // Load current Pokemon data
  const selectedPokemonName = sessionStorage.getItem('selectedPokemonName');
  const pokemonDataStr = sessionStorage.getItem(`pokemon_${selectedPokemonName.toLowerCase()}`);
  currentPokemon = JSON.parse(pokemonDataStr);

  // Display current stats in modal
  document.getElementById('currentStr').textContent = currentPokemon[15];
  document.getElementById('currentDex').textContent = currentPokemon[16];
  document.getElementById('currentCon').textContent = currentPokemon[17];
  document.getElementById('currentInt').textContent = currentPokemon[18];
  document.getElementById('currentWis').textContent = currentPokemon[19];
  document.getElementById('currentCha').textContent = currentPokemon[20];

  // Load evolution options
  loadEvolutionOptions();

  // Evolve button
  document.getElementById('evolveButton')?.addEventListener('click', evolvePokemon);

  // Modal buttons
  document.getElementById('confirmEvolutionBtn')?.addEventListener('click', confirmEvolution);
  document.getElementById('cancelEvolutionBtn')?.addEventListener('click', cancelEvolution);

  // Stat point inputs
  ['str', 'dex', 'con', 'int', 'wis', 'cha'].forEach(stat => {
    document.getElementById(`${stat}Points`)?.addEventListener('input', updateAllocatedPoints);
  });
}

async function loadEvolutionOptions() {
  const currentDexEntry = currentPokemon[3];

  try {
    const result = await PokemonAPI.getEvolutionOptions(currentDexEntry, 20);

    if (result.status === 'success') {
      evolutionOptions = result.data;
      displayEvolutionOptions(evolutionOptions);
    } else {
      showError('Failed to load evolution options');
      document.getElementById('pokemonList').innerHTML = '<li>Failed to load options</li>';
    }
  } catch (error) {
    console.error('Error loading evolution options:', error);
    showError('Failed to load evolution options');
    document.getElementById('pokemonList').innerHTML = '<li>Failed to load options</li>';
  }
}

function displayEvolutionOptions(options) {
  const pokemonList = document.getElementById('pokemonList');
  pokemonList.innerHTML = '';

  if (options.length === 0) {
    pokemonList.innerHTML = '<li>No evolution options available</li>';
    return;
  }

  options.forEach(pokemon => {
    const listItem = document.createElement('li');
    listItem.textContent = `#${pokemon[2]} - ${pokemon[1]}`;
    listItem.addEventListener('click', () => selectEvolution(pokemon, listItem));
    pokemonList.appendChild(listItem);
  });
}

async function selectEvolution(pokemon, listItem) {
  selectedPokemon = pokemon;

  // Update selected styling
  document.querySelectorAll('.evolution-list li').forEach(li => li.classList.remove('selected'));
  listItem.classList.add('selected');

  // Display details
  const imageUrl = pokemon[0] || await resolveImageUrl(pokemon[1], pokemon[2]);
  document.getElementById('pokemonImage').src = imageUrl;
  document.getElementById('pokemonName').textContent = pokemon[1];
  document.getElementById('pokemonDexEntry').textContent = pokemon[2];

  const typeText = pokemon[5] ? `${pokemon[4]} / ${pokemon[5]}` : pokemon[4];
  document.getElementById('pokemonType').textContent = typeText;

  document.getElementById('pokemonDetails').classList.add('visible');
}

async function resolveImageUrl(pokemonName, pokemonId) {
  const paddedId = pokemonId.toString().padStart(3, '0');
  const sanitizedName = pokemonName.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const baseFileName = `${paddedId}-${sanitizedName}`;

  const formats = ['png', 'jpg', 'jpeg', 'jfif'];
  const baseUrl = 'https://raw.githubusercontent.com/Benjakronk/shima-pokedex/main/images/';

  for (const format of formats) {
    const url = `${baseUrl}${baseFileName}.${format}`;
    if (await imageExists(url)) {
      return url;
    }
  }

  return 'assets/Pokeball.png';
}

function imageExists(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

function evolvePokemon() {
  if (!selectedPokemon) {
    showError('Please select an evolution first');
    return;
  }

  // Calculate available skill points
  const preEvolvedStats = currentPokemon[14];
  const evolvedStats = selectedPokemon[15];
  availableSkillPoints = evolvedStats - preEvolvedStats;

  document.getElementById('availableSkillPoints').textContent = availableSkillPoints;
  document.getElementById('remainingPoints').textContent = availableSkillPoints;

  // Reset inputs
  ['str', 'dex', 'con', 'int', 'wis', 'cha'].forEach(stat => {
    document.getElementById(`${stat}Points`).value = 0;
  });

  updateNewStats();

  // Show modal
  document.getElementById('evolutionModal').classList.add('visible');
}

function updateAllocatedPoints() {
  const str = parseInt(document.getElementById('strPoints').value) || 0;
  const dex = parseInt(document.getElementById('dexPoints').value) || 0;
  const con = parseInt(document.getElementById('conPoints').value) || 0;
  const int = parseInt(document.getElementById('intPoints').value) || 0;
  const wis = parseInt(document.getElementById('wisPoints').value) || 0;
  const cha = parseInt(document.getElementById('chaPoints').value) || 0;

  allocatedSkillPoints = str + dex + con + int + wis + cha;

  const remainingPoints = availableSkillPoints - allocatedSkillPoints;
  document.getElementById('remainingPoints').textContent = Math.max(0, remainingPoints);

  updateNewStats();
}

function updateNewStats() {
  const str = parseInt(document.getElementById('strPoints').value) || 0;
  const dex = parseInt(document.getElementById('dexPoints').value) || 0;
  const con = parseInt(document.getElementById('conPoints').value) || 0;
  const int = parseInt(document.getElementById('intPoints').value) || 0;
  const wis = parseInt(document.getElementById('wisPoints').value) || 0;
  const cha = parseInt(document.getElementById('chaPoints').value) || 0;

  document.getElementById('newStr').textContent = currentPokemon[15] + str;
  document.getElementById('newDex').textContent = currentPokemon[16] + dex;
  document.getElementById('newCon').textContent = currentPokemon[17] + con;
  document.getElementById('newInt').textContent = currentPokemon[18] + int;
  document.getElementById('newWis').textContent = currentPokemon[19] + wis;
  document.getElementById('newCha').textContent = currentPokemon[20] + cha;
}

async function confirmEvolution() {
  const remainingPoints = availableSkillPoints - allocatedSkillPoints;
  if (remainingPoints !== 0) {
    showError('Please allocate all available skill points');
    return;
  }

  // Hide modal and show loading
  document.getElementById('evolutionModal').classList.remove('visible');
  document.getElementById('content').innerHTML = '<div class="loading">Evolving Pokemon...</div>';

  try {
    const str = parseInt(document.getElementById('strPoints').value) || 0;
    const dex = parseInt(document.getElementById('dexPoints').value) || 0;
    const con = parseInt(document.getElementById('conPoints').value) || 0;
    const int = parseInt(document.getElementById('intPoints').value) || 0;
    const wis = parseInt(document.getElementById('wisPoints').value) || 0;
    const cha = parseInt(document.getElementById('chaPoints').value) || 0;

    // Calculate new stats
    const newSTR = currentPokemon[15] + str;
    const newDEX = currentPokemon[16] + dex;
    const newCON = currentPokemon[17] + con;
    const newINT = currentPokemon[18] + int;
    const newWIS = currentPokemon[19] + wis;
    const newCHA = currentPokemon[20] + cha;

    // Combine skills
    let preEvoSkills = currentPokemon[22] ? currentPokemon[22].split(',').map(s => s.trim()) : [];
    let evoSkills = selectedPokemon[23] ? selectedPokemon[23].split(',').map(s => s.trim()) : [];
    let combinedSkills = [...new Set([...preEvoSkills, ...evoSkills])].join(', ');

    // Format movement and senses
    const movementData = selectedPokemon[31] || {};
    const sensesData = selectedPokemon[32] || {};

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
      selectedPokemon[4],
      selectedPokemon[5]
    );
    const typematchupsString = typeResponse.effectiveness ?
      typeResponse.effectiveness.join(', ') : '';

    // Map abilities from current to evolved Pokemon
    const currentAbilitiesRaw = currentPokemon[7] || '';
    const evolvedAbilities = [];

    if (currentAbilitiesRaw) {
      const currentAbilities = currentAbilitiesRaw.split('|').map(a => a.trim()).filter(a => a);

      // Get evolved Pokemon's abilities (pokedex format: "Name, Description")
      const evolvedPokemonAbilities = [
        selectedPokemon[6],  // Primary
        selectedPokemon[7],  // Secondary
        selectedPokemon[8]   // Hidden
      ];

      currentAbilities.forEach(abilityData => {
        const colonIndex = abilityData.indexOf(':');
        let slotIndex = 0;

        if (colonIndex !== -1 && colonIndex < 3) {
          slotIndex = parseInt(abilityData.substring(0, colonIndex));
        }

        const evolvedAbilityData = evolvedPokemonAbilities[slotIndex];
        if (evolvedAbilityData) {
          const parts = evolvedAbilityData.split(',');
          const abilityName = parts[0].trim();
          const abilityDescription = parts.slice(1).join(',').trim();
          evolvedAbilities.push(slotIndex + ':' + abilityName + ';' + abilityDescription);
        }
      });
    }

    // Default to primary ability if no mapping
    const evolvedAbilitiesString = evolvedAbilities.length > 0
      ? evolvedAbilities.join('|')
      : (() => {
          const primaryAbility = selectedPokemon[6];
          if (primaryAbility) {
            const parts = primaryAbility.split(',');
            return '0:' + parts[0].trim() + ';' + parts.slice(1).join(',').trim();
          }
          return '';
        })();

    // Build evolved Pokemon data array
    const evolvedPokemonData = [
      currentPokemon[0],           // Trainer Name
      selectedPokemon[0],          // Image
      selectedPokemon[1],          // Name
      selectedPokemon[2],          // Dex Entry
      currentPokemon[4],           // Level
      selectedPokemon[4],          // Primary Type
      selectedPokemon[5],          // Secondary Type
      evolvedAbilitiesString,      // Abilities
      selectedPokemon[9],          // AC
      selectedPokemon[10],         // Hit Dice
      '',                          // HP (calculated)
      selectedPokemon[12],         // Vitality Dice
      '',                          // VP (calculated)
      movementDataString,          // Speed
      selectedPokemon[15],         // Total Stats
      newSTR,                      // Strength
      newDEX,                      // Dexterity
      newCON,                      // Constitution
      newINT,                      // Intelligence
      newWIS,                      // Wisdom
      newCHA,                      // Charisma
      selectedPokemon[22],         // Saving Throws
      combinedSkills,              // Skills
      selectedPokemon[24],         // Starting Moves
      selectedPokemon[25],         // Level 2 Moves
      selectedPokemon[26],         // Level 6 Moves
      selectedPokemon[27],         // Level 10 Moves
      selectedPokemon[28],         // Level 14 Moves
      selectedPokemon[29],         // Level 18 Moves
      selectedPokemon[30],         // Evolution Requirement
      '',                          // Initiative (calculated)
      '',                          // Proficiency Bonus (calculated)
      currentPokemon[32],          // Nature
      currentPokemon[33],          // Loyalty
      currentPokemon[34],          // STAB
      currentPokemon[35] || '',    // Held Item
      currentPokemon[36] || '',    // Nickname
      currentPokemon[37] || '',    // Custom Moves
      currentPokemon[38] || '',    // In Active Party
      '',                          // STR modifier (calculated)
      '',                          // DEX modifier (calculated)
      '',                          // CON modifier (calculated)
      '',                          // INT modifier (calculated)
      '',                          // WIS modifier (calculated)
      '',                          // CHA modifier (calculated)
      currentPokemon[45] || '',    // CurrentHP
      currentPokemon[46] || '',    // CurrentVP
      currentPokemon[47] || '',    // CurrentAC
      currentPokemon[48] || '',    // Comment
      sensesDataString,            // Senses
      currentPokemon[50] || '',    // Feats
      currentPokemon[51] || '',    // Gear
      selectedPokemon[33] || '',   // Flavor text
      typematchupsString,          // Type matchups
      currentPokemon[54] || '',    // Current HD
      currentPokemon[55] || '',    // Current VD
      currentPokemon[56] || ''     // Utility Slot
    ];

    // Call API to evolve Pokemon
    const response = await PokemonAPI.evolve(
      currentPokemon[2],
      currentPokemon[0],
      evolvedPokemonData
    );

    if (response.status === 'success') {
      const finalEvolvedPokemon = response.newPokemonData || evolvedPokemonData;

      // Clean up pre-evolved Pokemon from cache
      const preEvolvedKey = `pokemon_${currentPokemon[2].toLowerCase()}`;
      sessionStorage.removeItem(preEvolvedKey);

      // Clear pokemon list cache
      const trainerData = JSON.parse(sessionStorage.getItem('trainerData'));
      if (trainerData) {
        sessionStorage.removeItem(`pokemonList_${trainerData[1]}`);
      }

      // Store evolved Pokemon in session
      sessionStorage.setItem(`pokemon_${finalEvolvedPokemon[2].toLowerCase()}`, JSON.stringify(finalEvolvedPokemon));
      sessionStorage.setItem('selectedPokemonName', finalEvolvedPokemon[2]);

      showSuccess(`Your Pokemon has evolved into ${finalEvolvedPokemon[2]}!`);

      // Navigate to pokemon card
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('navigate', {
          detail: { route: 'pokemon-card', pokemonName: finalEvolvedPokemon[2] }
        }));
      }, 2000);
    } else {
      showError(response.message || 'Evolution failed');
      // Reload evolution page
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('navigate', {
          detail: { route: 'evolution' }
        }));
      }, 2000);
    }
  } catch (error) {
    console.error('Error during evolution:', error);
    showError('Evolution failed. Please try again.');
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('navigate', {
        detail: { route: 'evolution' }
      }));
    }, 2000);
  }
}

function cancelEvolution() {
  document.getElementById('evolutionModal').classList.remove('visible');

  // Reset inputs
  ['str', 'dex', 'con', 'int', 'wis', 'cha'].forEach(stat => {
    document.getElementById(`${stat}Points`).value = 0;
  });
  allocatedSkillPoints = 0;
}
