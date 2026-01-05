// Pokemon Form Page - Register new Pokemon for trainer

import { PokemonAPI, GameDataAPI } from '../api.js';
import { showSuccess, showError } from '../utils/notifications.js';
import { isFieldVisible, initializeVisibility } from '../utils/visibility.js';
import { showLoadingWithSplash, hideLoading } from '../utils/splash.js';

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

        .back-button {
          position: fixed;
          top: clamp(15px, 3vh, 20px);
          left: clamp(15px, 3vw, 20px);
          background: linear-gradient(135deg, #FFFFFF 0%, #F5F5F5 100%);
          color: #333;
          border: 3px solid rgba(255,222,0,0.8);
          border-radius: 50%;
          width: clamp(45px, 10vw, 60px);
          height: clamp(45px, 10vw, 60px);
          font-size: clamp(1.2rem, 3vw, 1.8rem);
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 6px 20px rgba(0,0,0,0.3);
          z-index: 1000;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .back-button:hover {
          transform: scale(1.15);
          box-shadow: 0 12px 30px rgba(0,0,0,0.4),
                      0 0 25px rgba(255,222,0,0.6);
          border-color: #FFC700;
        }

        .back-button:active {
          transform: scale(1.08);
        }
      </style>

      <!-- Back Button -->
      <button class="back-button" id="backButton">←</button>

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

export async function attachPokemonFormListeners() {
  const selectedPokemonData = JSON.parse(sessionStorage.getItem('selectedPokemonData'));

  // Initialize visibility system
  await initializeVisibility();

  // Populate abilities from cache or API (like edit-pokemon does)
  await populateAbilityOptions(selectedPokemonData);

  // Back button
  document.getElementById('backButton')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('navigate', {
      detail: { route: 'my-pokemon' }
    }));
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

async function populateAbilityOptions(selectedPokemonData) {
  const abilitiesContent = document.getElementById('abilitiesContent');
  if (!abilitiesContent) return;

  const pokemonName = selectedPokemonData[1] || 'Unknown';
  abilitiesContent.innerHTML = '';

  // Get abilities from session storage cache
  const cachedDataStr = sessionStorage.getItem('completePokemonData');
  if (!cachedDataStr) {
    abilitiesContent.innerHTML = '<div style="padding: 1rem; color: #f44336;">No Pokemon data in cache</div>';
    return;
  }

  const completePokemonData = JSON.parse(cachedDataStr);
  const pokemonInfo = completePokemonData.find(p => p[1] === pokemonName);

  if (!pokemonInfo) {
    abilitiesContent.innerHTML = '<div style="padding: 1rem; color: #f44336;">Pokemon not found in cache</div>';
    return;
  }

  // Get abilities from indices 6, 7, 8 (format: "Name,Description")
  const abilities = [
    pokemonInfo[6],  // Primary ability (slot 0)
    pokemonInfo[7],  // Secondary ability (slot 1)
    pokemonInfo[8]   // Hidden ability (slot 2)
  ];

  console.log('[Pokemon Form] Abilities from cache:', abilities);

  // Create checkbox for each ability
  abilities.forEach((abilityData, slotIndex) => {
    if (!abilityData) return; // Skip empty abilities

    // Check if hidden ability should be visible
    if (slotIndex === 2 && !isFieldVisible(pokemonName, 'hiddenAbility')) {
      return;
    }

    // Parse "Name,Description"
    const parts = abilityData.split(',');
    const abilityName = parts[0].trim();

    console.log(`[Pokemon Form] Creating checkbox for ability ${slotIndex}: "${abilityName}"`);

    // Create checkbox - value is just the name
    const div = document.createElement('div');
    div.className = 'checkbox-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `ability${slotIndex}`;
    checkbox.name = 'abilities';
    checkbox.value = abilityName; // Just the name
    checkbox.dataset.slotIndex = slotIndex; // Store slot index for later

    const label = document.createElement('label');
    label.htmlFor = `ability${slotIndex}`;
    label.textContent = abilityName;

    div.appendChild(checkbox);
    div.appendChild(label);
    abilitiesContent.appendChild(div);
  });

  // Debug: Check if checkboxes exist in DOM
  setTimeout(() => {
    const allCheckboxes = document.querySelectorAll('input[name="abilities"]');
    console.log('[Pokemon Form] Total ability checkboxes in DOM:', allCheckboxes.length);
    allCheckboxes.forEach(cb => {
      console.log(`  - Checkbox id="${cb.id}" value="${cb.value}" checked=${cb.checked}`);
    });
  }, 100);
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

  try {
    // CRITICAL: Gather ALL form data BEFORE showing loading message
    // (loading message wipes out the entire form!)

    // Gather basic form data
    const level = parseInt(form.level.value);
    const nature = form.nature.value;
    const loyalty = parseInt(form.loyalty.value);
    const heldItem = form.heldItem.value;
    const nickname = form.nickname.value;

    // Get selected abilities and format them
    const selectedAbilityCheckboxes = Array.from(document.querySelectorAll('input[name="abilities"]:checked'));
    console.log('[Pokemon Form] Selected ability checkboxes:', selectedAbilityCheckboxes.length);

    // Get full ability data from cache
    const cachedDataStr = sessionStorage.getItem('completePokemonData');
    const completePokemonData = JSON.parse(cachedDataStr);
    const pokemonInfo = completePokemonData.find(p => p[1] === selectedPokemonData[1]);
    const allAbilities = [pokemonInfo[6], pokemonInfo[7], pokemonInfo[8]]; // Name,Description format

    // Build abilities string: "slotIndex:Name;Description|slotIndex:Name;Description"
    const selectedAbilities = selectedAbilityCheckboxes.map(cb => {
      const abilityName = cb.value; // Just the name
      const slotIndex = cb.dataset.slotIndex; // 0, 1, or 2

      // Find full ability data (Name,Description)
      const fullAbilityData = allAbilities[slotIndex];
      const parts = fullAbilityData.split(',');
      const name = parts[0].trim();
      const description = parts.slice(1).join(',').trim();

      // Return formatted: "slotIndex:Name;Description"
      return `${slotIndex}:${name};${description}`;
    }).join('|');

    console.log('[Pokemon Form] Selected abilities string:', selectedAbilities);

    // NOW show loading (after we've captured all the data)
    document.getElementById('content').innerHTML = '<div class="loading">Registering Pokemon...</div>';

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

    // Apply Ace Trainer Max Potential bonus (Level 9)
    const trainerPath = trainerData[25] || '';
    const maxPotential = trainerData[46] || '';
    if (trainerPath === 'Ace Trainer' && maxPotential && maxPotential !== '') {
      if (maxPotential === 'STR') {
        modifiedPokemonData[16] = (modifiedPokemonData[16] || 10) + 1;
      } else if (maxPotential === 'DEX') {
        modifiedPokemonData[17] = (modifiedPokemonData[17] || 10) + 1;
      } else if (maxPotential === 'CON') {
        modifiedPokemonData[18] = (modifiedPokemonData[18] || 10) + 1;
      }
      // Speed bonus will be applied to movement data below
    }

    // Format movement and senses data
    const movementData = selectedPokemonData[31] || {};
    const sensesData = selectedPokemonData[32] || {};

    // Apply Speed bonus for Max Potential if selected
    let movementArray = [
      movementData.walking || '-',
      movementData.climbing || '-',
      movementData.flying || '-',
      movementData.hovering || '-',
      movementData.swimming || '-',
      movementData.burrowing || '-'
    ];

    if (trainerPath === 'Ace Trainer' && maxPotential === 'Speed') {
      movementArray = movementArray.map(movement => {
        if (movement === '-') return movement;
        // Parse movement like "Walk 30 ft"
        const match = movement.match(/^(.+?)\s+(\d+)\s*(.*)$/);
        if (match) {
          const type = match[1];
          const speed = parseInt(match[2], 10);
          const unit = match[3] || 'ft';
          return `${type} ${speed + 10} ${unit}`.trim();
        }
        return movement;
      });
    }

    const movementDataString = movementArray.join(', ');

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
    const typematchupsString = typeResponse.data ?
      typeResponse.data.join(', ') : '';

    // Build new Pokemon data array matching exact database schema
    const newPokemonData = [
      trainerData[1],              // 0: Trainer Name
      selectedPokemonData[0],      // 1: Image
      selectedPokemonData[1],      // 2: Name
      selectedPokemonData[2],      // 3: Dex Entry
      level,                       // 4: Level
      selectedPokemonData[4],      // 5: Primary Type
      selectedPokemonData[5],      // 6: Secondary Type
      selectedAbilities,           // 7: Ability (combined with pipes)
      selectedPokemonData[9],      // 8: AC
      selectedPokemonData[10],     // 9: Hit Dice
      '',                          // 10: HP (to be calculated)
      selectedPokemonData[12],     // 11: Vitality Dice
      '',                          // 12: VP (to be calculated)
      movementDataString,          // 13: Speed
      selectedPokemonData[15],     // 14: Total Stats
      modifiedPokemonData[16],     // 15: Strength
      modifiedPokemonData[17],     // 16: Dexterity
      modifiedPokemonData[18],     // 17: Constitution
      modifiedPokemonData[19],     // 18: Intelligence
      modifiedPokemonData[20],     // 19: Wisdom
      modifiedPokemonData[21],     // 20: Charisma
      selectedPokemonData[22],     // 21: Saving Throws
      selectedPokemonData[23],     // 22: Skills
      selectedPokemonData[24],     // 23: Starting Moves
      selectedPokemonData[25],     // 24: Level 2 Moves
      selectedPokemonData[26],     // 25: Level 6 Moves
      selectedPokemonData[27],     // 26: Level 10 Moves
      selectedPokemonData[28],     // 27: Level 14 Moves
      selectedPokemonData[29],     // 28: Level 18 Moves
      selectedPokemonData[30],     // 29: Evolution Requirement
      '',                          // 30: Initiative (to be calculated)
      '',                          // 31: Proficiency Bonus (to be calculated)
      nature,                      // 32: Nature
      loyalty,                     // 33: Loyalty
      '',                          // 34: STAB (to be calculated)
      heldItem,                    // 35: Held Item
      nickname,                    // 36: Nickname
      '',                          // 37: Custom Moves
      '',                          // 38: In Active Party
      '',                          // 39: strmodifier (to be calculated by backend)
      '',                          // 40: dexmodifier (to be calculated by backend)
      '',                          // 41: conmodifier (to be calculated by backend)
      '',                          // 42: intmodifier (to be calculated by backend)
      '',                          // 43: wismodifier (to be calculated by backend)
      '',                          // 44: chamodifier (to be calculated by backend)
      '',                          // 45: CurrentHP (to be calculated by backend)
      '',                          // 46: CurrentVP (to be calculated by backend)
      '',                          // 47: CurrentAC
      '',                          // 48: Comment
      sensesDataString,            // 49: Senses
      '',                          // 50: Feats
      '',                          // 51: Gear
      selectedPokemonData[33],     // 52: Flavor text
      typematchupsString,          // 53: Type matchups
      '',                          // 54: Current HD
      '',                          // 55: Current VD
      ''                           // 56: Utility Slot
    ];

    console.log('[Pokemon Form] newPokemonData array:');
    console.log('[Pokemon Form] - Index 1 (Image):', newPokemonData[1]);
    console.log('[Pokemon Form] - Index 7 (Abilities):', newPokemonData[7]);
    console.log('[Pokemon Form] - Full array:', newPokemonData);

    // Show loading screen with preloaded splash image from sessionStorage
    const splashUrl = sessionStorage.getItem('preloadedSplashImage') || 'https://raw.githubusercontent.com/Benjakronk/shima-pokedex/main/images/background/background.png';
    showLoadingWithSplash(splashUrl);

    // Register the Pokemon
    const response = await PokemonAPI.register(trainerData[1], newPokemonData);

    console.log('[Pokemon Form] Backend response:', response);

    if (response.status === 'success') {
      // Update session storage with new Pokemon
      const finalPokemonData = response.newPokemonData || newPokemonData;

      console.log('[Pokemon Form] finalPokemonData:');
      console.log('[Pokemon Form] - Index 1 (Image):', finalPokemonData[1]);
      console.log('[Pokemon Form] - Index 7 (Abilities):', finalPokemonData[7]);

      sessionStorage.setItem(`pokemon_${selectedPokemonData[1].toLowerCase()}`, JSON.stringify(finalPokemonData));

      // Update complete Pokemon data
      const completePokemonData = JSON.parse(sessionStorage.getItem('completePokemonData') || '[]');
      completePokemonData.push(finalPokemonData);
      sessionStorage.setItem('completePokemonData', JSON.stringify(completePokemonData));

      // Hide loading screen
      hideLoading();

      showSuccess(`${trainerData[1]} caught a ${selectedPokemonData[1]}!`);

      // Navigate to my pokemon page
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('navigate', {
          detail: { route: 'my-pokemon' }
        }));
      }, 2000);
    } else {
      hideLoading();
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
    hideLoading();
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
