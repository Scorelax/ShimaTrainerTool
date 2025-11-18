// Pokemon Card Page - Detailed Pokemon Information Display

import { PokemonAPI } from '../api.js';
import { showSuccess, showError } from '../utils/notifications.js';

export function renderPokemonCard(pokemonName) {
  // Load Pokemon data from session storage
  const pokemonDataStr = sessionStorage.getItem(`pokemon_${pokemonName.toLowerCase()}`);
  const trainerDataStr = sessionStorage.getItem('trainerData');

  if (!pokemonDataStr || !trainerDataStr) {
    return `<div class="error">Pokemon or trainer data not found. Please return to the trainer card.</div>`;
  }

  const pokemonData = JSON.parse(pokemonDataStr);
  const trainerData = JSON.parse(trainerDataStr);

  // Store selected Pokemon name for later use
  sessionStorage.setItem('selectedPokemonName', pokemonName);

  // Extract Pokemon info
  const image = pokemonData[1] || 'assets/Pokeball.png';
  const name = pokemonData[2] || 'Unknown';
  const dexEntry = pokemonData[3] || '';
  const level = pokemonData[4] || 1;
  const type1 = pokemonData[5] || '';
  const type2 = pokemonData[6] || '';
  const ac = pokemonData[10] || 10;
  const vd = pokemonData[11] || 0;
  const hp = pokemonData[12] || 0;
  const vp = pokemonData[13] || 0;
  const str = pokemonData[15] || 10;
  const dex = pokemonData[16] || 10;
  const con = pokemonData[17] || 10;
  const int = pokemonData[18] || 10;
  const wis = pokemonData[19] || 10;
  const cha = pokemonData[20] || 10;
  const savingThrow = pokemonData[21] || 'None';
  const skills = pokemonData[22] || '';
  const loyalty = pokemonData[33] || 0;
  const heldItem = pokemonData[35] || 'None';
  const nickname = pokemonData[36] || '';
  const inActiveParty = !!pokemonData[38];
  const senses = pokemonData[49] || '';
  const feats = pokemonData[50] || '';
  const flavorText = pokemonData[52] || '';
  const inUtilitySlot = pokemonData[56] === 1 || pokemonData[56] === '1';

  // Calculate modifiers
  const strMod = Math.floor((str - 10) / 2);
  const dexMod = Math.floor((dex - 10) / 2);
  const conMod = Math.floor((con - 10) / 2);
  const intMod = Math.floor((int - 10) / 2);
  const wisMod = Math.floor((wis - 10) / 2);
  const chaMod = Math.floor((cha - 10) / 2);

  // Parse skills
  const skillsArray = skills ? skills.split(',').map(s => s.trim()).filter(s => s) : [];
  const allSkills = [
    { name: "Athletics", stat: "STR", mod: strMod },
    { name: "Acrobatics", stat: "DEX", mod: dexMod },
    { name: "Sleight of Hand", stat: "DEX", mod: dexMod },
    { name: "Stealth", stat: "DEX", mod: dexMod },
    { name: "Arcana", stat: "INT", mod: intMod },
    { name: "History", stat: "INT", mod: intMod },
    { name: "Investigation", stat: "INT", mod: intMod },
    { name: "Nature", stat: "INT", mod: intMod },
    { name: "Religion", stat: "INT", mod: intMod },
    { name: "Animal Handling", stat: "WIS", mod: wisMod },
    { name: "Insight", stat: "WIS", mod: wisMod },
    { name: "Medicine", stat: "WIS", mod: wisMod },
    { name: "Perception", stat: "WIS", mod: wisMod },
    { name: "Survival", stat: "WIS", mod: wisMod },
    { name: "Deception", stat: "CHA", mod: chaMod },
    { name: "Intimidation", stat: "CHA", mod: chaMod },
    { name: "Performance", stat: "CHA", mod: chaMod },
    { name: "Persuasion", stat: "CHA", mod: chaMod }
  ];

  // Count skill proficiencies
  const skillCounts = {};
  skillsArray.forEach(skill => {
    const skillName = skill.toLowerCase().replace(/\s*\(.*?\)\s*/g, '').trim();
    skillCounts[skillName] = (skillCounts[skillName] || 0) + 1;
  });

  const displayName = nickname ? `${name} / ${nickname}` : name;
  const typingText = type2 ? `${type1} / ${type2}` : type1;

  const html = `
    <div class="pokemon-card-page">
      <style>
        body, .content {
          background: linear-gradient(to bottom, #f44336 80%, #ffffff 20%);
        }

        .pokemon-card-page {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 2rem 1rem;
          min-height: 80vh;
          position: relative;
        }

        .pokemon-card-page h1 {
          color: white;
          margin-bottom: 2rem;
          font-size: 2.5rem;
        }

        .card-container {
          display: grid;
          grid-template-columns: 350px 1fr;
          grid-template-rows: auto auto 1fr;
          gap: 2rem;
          width: 100%;
          max-width: 1200px;
          position: relative;
        }

        .image-container {
          grid-column: 1 / 2;
          grid-row: 1 / 2;
          width: 350px;
          height: 350px;
        }

        .image-container img {
          width: 100%;
          height: 100%;
          border-radius: 20px;
          object-fit: contain;
          border: 4px solid #333;
          box-shadow: 0 4px 10px rgba(0,0,0,0.3);
          background: white;
        }

        .new-details-container {
          grid-column: 1 / 2;
          grid-row: 2 / 3;
          background: white;
          padding: 1.5rem;
          border-radius: 15px;
          box-shadow: 0 4px 10px rgba(0,0,0,0.2);
        }

        .stat-item {
          display: flex;
          justify-content: space-between;
          padding: 0.5rem 0;
          border-bottom: 1px solid #ddd;
          font-size: 1.3rem;
        }

        .stat-label {
          font-weight: bold;
          color: #333;
        }

        .stat-value {
          color: #666;
        }

        .dex-entry::before {
          content: " #";
        }

        .ac-hp-vp-container {
          grid-column: 2 / 3;
          grid-row: 1 / 2;
          display: flex;
          justify-content: space-around;
          gap: 1rem;
        }

        .stat-block {
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .stat-label-box {
          font-weight: bold;
          font-size: 1.3rem;
          margin-bottom: 0.5rem;
          color: black;
        }

        .stat-value-box {
          width: 80px;
          height: 80px;
          background-color: #f44336;
          color: black;
          border-radius: 10px;
          border: 3px solid black;
          font-size: 2rem;
          font-weight: 700;
          box-shadow: 3px 3px 0 #000;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .stats-container {
          grid-column: 2 / 3;
          grid-row: 2 / 3;
          display: grid;
          grid-template-columns: repeat(6, 1fr);
          gap: 1rem;
          background: white;
          padding: 1.5rem;
          border-radius: 15px;
          box-shadow: 0 4px 10px rgba(0,0,0,0.2);
        }

        .ability-group {
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .ability-label {
          font-weight: bold;
          font-size: 1rem;
          margin-bottom: 0.5rem;
        }

        .ability-box {
          width: 60px;
          height: 60px;
          background-color: #f44336;
          color: black;
          border-radius: 10px;
          border: 3px solid black;
          font-size: 1.8rem;
          box-shadow: 3px 3px 0 #000;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .modifier-box {
          width: 50px;
          height: 50px;
          background-color: #f44336;
          color: white;
          border-radius: 10px;
          border: 3px solid black;
          font-size: 1.6rem;
          font-weight: 900;
          box-shadow: 3px 3px 0 #000;
          margin-top: -10px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .skills-container {
          grid-column: 1 / 3;
          grid-row: 3 / 4;
          background: white;
          padding: 2rem;
          border-radius: 15px;
          box-shadow: 0 4px 10px rgba(0,0,0,0.2);
        }

        .skills-container h2 {
          margin-bottom: 1.5rem;
          color: #333;
        }

        .skills-grid {
          display: grid;
          grid-template-columns: repeat(6, 1fr);
          gap: 1rem;
          border: 2px solid #333;
          padding: 1.5rem;
          border-radius: 5px;
        }

        .skill-item {
          padding: 1rem;
          border: 1px solid #333;
          border-radius: 5px;
          text-align: center;
          display: flex;
          flex-direction: column;
          justify-content: center;
          height: 75px;
          font-size: 1.2rem;
        }

        .skill-item.highlight {
          background-color: #fff200;
          font-weight: bold;
        }

        .skill-item.extra-strong {
          background-color: #4CAF50;
          color: white;
          font-weight: bold;
        }

        .skill-item .modifier {
          font-size: 1rem;
          margin-top: 0.25rem;
        }

        .checkbox-container {
          display: flex;
          gap: 2rem;
          margin-top: 1.5rem;
          padding-top: 1.5rem;
          border-top: 2px solid #ddd;
        }

        .checkbox-item {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .checkbox-item input[type="checkbox"] {
          width: 30px;
          height: 30px;
          cursor: pointer;
        }

        .checkbox-item label {
          font-size: 1.2rem;
          font-weight: bold;
          cursor: pointer;
        }

        .button-group {
          display: flex;
          gap: 1rem;
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
          background-color: gray;
          color: white;
        }

        .button-secondary:hover {
          background-color: darkgray;
        }

        .button-danger {
          background-color: #f44336;
          color: white;
        }

        .button-danger:hover {
          background-color: #d32f2f;
        }

        @media (max-width: 1024px) {
          .card-container {
            grid-template-columns: 1fr;
            grid-template-rows: auto;
          }

          .image-container,
          .new-details-container,
          .ac-hp-vp-container,
          .stats-container,
          .skills-container {
            grid-column: 1 / 2;
          }

          .skills-grid {
            grid-template-columns: repeat(3, 1fr);
          }
        }
      </style>

      <h1>Pokemon Card</h1>

      <div class="card-container">
        <!-- Pokemon Image -->
        <div class="image-container">
          <img id="pokemonImage" src="${image}" alt="${name}" onerror="this.src='assets/Pokeball.png'">
        </div>

        <!-- Pokemon Details -->
        <div class="new-details-container">
          <div class="stat-item">
            <span class="stat-label">Name:</span>
            <span class="stat-value">
              ${displayName}
              <span class="dex-entry">${dexEntry}</span>
            </span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Level:</span>
            <span class="stat-value">${level}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Type:</span>
            <span class="stat-value">${typingText}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Loyalty:</span>
            <span class="stat-value">${loyalty}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Saving Throw:</span>
            <span class="stat-value">${savingThrow}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Held Item:</span>
            <span class="stat-value">${heldItem}</span>
          </div>
          ${flavorText ? `
            <div class="stat-item">
              <span class="stat-label">Flavor:</span>
              <span class="stat-value">${flavorText}</span>
            </div>
          ` : ''}

          <!-- Checkboxes -->
          <div class="checkbox-container">
            <div class="checkbox-item">
              <input type="checkbox" id="inActiveParty" ${inActiveParty ? 'checked' : ''} />
              <label for="inActiveParty">Active Party</label>
            </div>
            <div class="checkbox-item">
              <input type="checkbox" id="inUtilitySlot" ${inUtilitySlot ? 'checked' : ''} />
              <label for="inUtilitySlot">Utility Slot</label>
            </div>
          </div>

          <!-- Buttons -->
          <div class="button-group">
            <button class="button button-primary" id="editPokemonButton">Edit Pokemon</button>
            <button class="button button-danger" id="backButton">Back</button>
          </div>
        </div>

        <!-- AC, HP, VP -->
        <div class="ac-hp-vp-container">
          <div class="stat-block">
            <div class="stat-label-box">AC</div>
            <div class="stat-value-box">${ac}</div>
          </div>
          <div class="stat-block">
            <div class="stat-label-box">HP</div>
            <div class="stat-value-box">${hp}</div>
          </div>
          <div class="stat-block">
            <div class="stat-label-box">VP</div>
            <div class="stat-value-box">${vp}</div>
          </div>
        </div>

        <!-- Ability Scores -->
        <div class="stats-container">
          <div class="ability-group">
            <div class="ability-label">STR</div>
            <div class="ability-box">${str}</div>
            <div class="modifier-box">${strMod >= 0 ? '+' : ''}${strMod}</div>
          </div>
          <div class="ability-group">
            <div class="ability-label">DEX</div>
            <div class="ability-box">${dex}</div>
            <div class="modifier-box">${dexMod >= 0 ? '+' : ''}${dexMod}</div>
          </div>
          <div class="ability-group">
            <div class="ability-label">CON</div>
            <div class="ability-box">${con}</div>
            <div class="modifier-box">${conMod >= 0 ? '+' : ''}${conMod}</div>
          </div>
          <div class="ability-group">
            <div class="ability-label">INT</div>
            <div class="ability-box">${int}</div>
            <div class="modifier-box">${intMod >= 0 ? '+' : ''}${intMod}</div>
          </div>
          <div class="ability-group">
            <div class="ability-label">WIS</div>
            <div class="ability-box">${wis}</div>
            <div class="modifier-box">${wisMod >= 0 ? '+' : ''}${wisMod}</div>
          </div>
          <div class="ability-group">
            <div class="ability-label">CHA</div>
            <div class="ability-box">${cha}</div>
            <div class="modifier-box">${chaMod >= 0 ? '+' : ''}${chaMod}</div>
          </div>
        </div>

        <!-- Skills -->
        <div class="skills-container">
          <h2>Skills</h2>
          <div class="skills-grid">
            ${allSkills.map(skill => {
              const skillKey = skill.name.toLowerCase();
              const proficiencyLevel = skillCounts[skillKey] || 0;
              const skillClass = proficiencyLevel >= 2 ? 'extra-strong' : (proficiencyLevel === 1 ? 'highlight' : '');
              const modifier = skill.mod + (proficiencyLevel * 2);

              return `
                <div class="skill-item ${skillClass}">
                  <div>${skill.name}</div>
                  <div class="modifier">${modifier >= 0 ? '+' : ''}${modifier}</div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    </div>
  `;

  return html;
}

export function attachPokemonCardListeners() {
  const pokemonName = sessionStorage.getItem('selectedPokemonName');
  const pokemonData = JSON.parse(sessionStorage.getItem(`pokemon_${pokemonName.toLowerCase()}`));
  const trainerData = JSON.parse(sessionStorage.getItem('trainerData'));

  // Edit Pokemon button
  document.getElementById('editPokemonButton')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('navigate', {
      detail: { route: 'edit-pokemon', pokemonName: pokemonName }
    }));
  });

  // Back button
  document.getElementById('backButton')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('navigate', {
      detail: { route: 'trainer-card' }
    }));
  });

  // Active Party checkbox
  document.getElementById('inActiveParty')?.addEventListener('change', async (e) => {
    const isChecked = e.target.checked;
    const utilityCheckbox = document.getElementById('inUtilitySlot');

    // Check for utility slot conflict
    if (isChecked && utilityCheckbox.checked) {
      e.target.checked = false;
      showError('Cannot be in both active party and utility slot!');
      return;
    }

    try {
      const action = isChecked ? 'add' : 'remove';
      const response = await PokemonAPI.updateActiveParty(
        trainerData[1],
        pokemonData[2],
        trainerData[26],
        action
      );

      if (response.status === 'success') {
        pokemonData[38] = isChecked ? response.slot : '';
        sessionStorage.setItem(`pokemon_${pokemonName.toLowerCase()}`, JSON.stringify(pokemonData));
        showSuccess(isChecked ? 'Added to active party!' : 'Removed from active party!');
      } else {
        e.target.checked = !isChecked;
        showError(response.message || 'Failed to update active party status');
      }
    } catch (error) {
      console.error('Error updating active party:', error);
      e.target.checked = !isChecked;
      showError('Failed to update active party status');
    }
  });

  // Utility Slot checkbox
  document.getElementById('inUtilitySlot')?.addEventListener('change', async (e) => {
    const isChecked = e.target.checked;
    const activePartyCheckbox = document.getElementById('inActiveParty');

    // Check for active party conflict
    if (isChecked && activePartyCheckbox.checked) {
      e.target.checked = false;
      showError('Cannot be in both active party and utility slot!');
      return;
    }

    try {
      const action = isChecked ? 'add' : 'remove';
      const response = await PokemonAPI.updateUtilitySlot(
        trainerData[1],
        pokemonData[2],
        action
      );

      if (response.status === 'success') {
        pokemonData[56] = isChecked ? 1 : '';
        sessionStorage.setItem(`pokemon_${pokemonName.toLowerCase()}`, JSON.stringify(pokemonData));

        // Clear utility slot from other Pokemon if adding
        if (isChecked) {
          for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            if (key.startsWith('pokemon_') && key !== `pokemon_${pokemonName.toLowerCase()}`) {
              const otherPokemon = JSON.parse(sessionStorage.getItem(key));
              if (otherPokemon[56] === 1 || otherPokemon[56] === '1') {
                otherPokemon[56] = '';
                sessionStorage.setItem(key, JSON.stringify(otherPokemon));
              }
            }
          }
        }

        showSuccess(isChecked ? 'Added to utility slot!' : 'Removed from utility slot!');
      } else {
        e.target.checked = !isChecked;
        showError(response.message || 'Failed to update utility slot status');
      }
    } catch (error) {
      console.error('Error updating utility slot:', error);
      e.target.checked = !isChecked;
      showError('Failed to update utility slot status');
    }
  });
}
