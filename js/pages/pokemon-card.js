// Pokemon Card Page - Detailed Pokemon Information Display with Info/Battle Pages

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
  const abilitiesRaw = pokemonData[7] || '';
  const hd = pokemonData[9] || 0;
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
  const proficiency = pokemonData[23] || 2;
  const speed = pokemonData[24] || 30;
  const initiative = pokemonData[25] || 0;
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

  // Calculate STAB (Same Type Attack Bonus) - proficiency bonus
  const stab = `+${proficiency}`;

  // Parse senses data (comma-separated string)
  const sensesData = senses || '';
  const sensesValues = sensesData.split(',').map(value => value.trim());
  const sensesTypes = ['Sight', 'Hearing', 'Smell', 'Tremorsense', 'Echolocation', 'Telepathy', 'Blindsight', 'Darkvision', 'Truesight'];
  const sensesArray = sensesValues
    .map((value, index) => {
      if (value && value !== '-') {
        return `${sensesTypes[index]}: ${value}`;
      }
      return null;
    })
    .filter(s => s !== null);
  const sensesDisplay = sensesArray.join(', ');

  // Parse abilities - format: "slotIndex:name;description|slotIndex:name;description"
  const parsedAbilities = [];
  if (abilitiesRaw) {
    const abilitiesList = abilitiesRaw.split('|').map(a => a.trim()).filter(a => a);
    abilitiesList.forEach((abilityData) => {
      let abilityName, abilityDescription;
      const colonIndex = abilityData.indexOf(':');
      if (colonIndex !== -1 && colonIndex < 3) {
        // New format with slot index
        const withoutSlot = abilityData.substring(colonIndex + 1);
        const parts = withoutSlot.split(';');
        abilityName = parts[0].trim();
        abilityDescription = parts.slice(1).join(';').trim() || 'No description available';
      } else {
        // Legacy format
        const parts = abilityData.split(';');
        abilityName = parts[0].trim();
        abilityDescription = parts.slice(1).join(';').trim() || 'No description available';
      }
      parsedAbilities.push({ name: abilityName, description: abilityDescription });
    });
  }

  // Generate ability buttons HTML
  const abilityButtonsHTML = parsedAbilities.length > 0
    ? parsedAbilities.map((ability, index) =>
        `<button class="ability-button" data-ability-index="${index}" style="background-color: white; color: black; border: 2px solid #333; border-radius: min(0.5vw, 5px); padding: min(0.6vw, 6px) min(1.2vw, 12px); font-size: clamp(1rem, 1.5vw, 1.2rem); cursor: pointer; margin: min(0.2vw, 2px); font-weight: bold;">${ability.name}</button>`
      ).join(' ')
    : 'None';

  const html = `
    <div class="pokemon-card-page">
      <style>
        body, .content {
          background:
            radial-gradient(circle at 20% 80%, rgba(255, 222, 0, 0.15) 0%, transparent 50%),
            radial-gradient(circle at 80% 20%, rgba(59, 76, 202, 0.15) 0%, transparent 50%),
            radial-gradient(circle at 40% 40%, rgba(238, 21, 21, 0.3) 0%, transparent 40%),
            linear-gradient(135deg, #EE1515 0%, #C91010 50%, #A00808 100%);
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
          background-size: min(5vw, 5vh) min(5vw, 5vh), min(8vw, 8vh) min(8vw, 8vh);
          background-position: 0 0, min(4vw, 4vh) min(4vw, 4vh);
          pointer-events: none;
          opacity: 0.5;
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
          margin-bottom: clamp(1.5rem, 2vw, 2rem);
          font-size: clamp(2rem, 5vw, 2.5rem);
        }

        /* Page visibility classes */
        .hidden-page {
          display: none !important;
        }

        .active-page {
          display: grid !important;
        }

        /* Info Page Styles */
        .card-container {
          grid-template-columns: min(30vw, 350px) 1fr;
          grid-template-rows: auto auto;
          gap: min(2vw, 20px);
          width: 80%;
          max-width: 1200px;
          margin-top: min(2vw, 20px);
          position: relative;
        }

        .image-container {
          grid-column: 1 / 2;
          grid-row: 1 / 2;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          justify-content: flex-start;
          width: min(30vw, 350px);
          height: min(30vw, 350px);
          border-radius: min(2vw, 20px);
          overflow: visible;
          background-color: transparent;
          z-index: 3;
          margin-bottom: min(1vw, 10px);
        }

        .image-container img {
          width: min(30vw, 350px);
          height: min(30vw, 350px);
          border-radius: min(2vw, 20px);
          object-fit: contain;
          cursor: pointer;
        }

        .new-details-container {
          grid-column: 1 / 2;
          grid-row: 2 / 3;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          justify-content: flex-start;
          gap: min(1vw, 10px);
          margin-top: min(-8vw, -80px);
          width: min(30vw, 350px);
          padding-left: 0;
          margin-left: 0;
        }

        .stat-item {
          display: flex;
          flex-direction: row;
          align-items: center;
          gap: min(0.5vw, 5px);
          margin-bottom: min(1.5vw, 15px);
          text-align: left;
          font-size: clamp(1.2rem, 2vw, 1.5rem);
          width: 100%;
          max-width: min(30vw, 350px);
        }

        .stat-label {
          font-weight: bold;
          color: black;
          min-width: min(8vw, 80px);
        }

        .dex-entry::before {
          content: " #";
          margin-left: min(0.5vw, 5px);
        }

        .stat-value {
          color: black;
          word-wrap: break-word;
          flex-grow: 1;
        }

        .flavor-text-container {
          position: absolute;
          top: 10%;
          left: 60%;
          transform: translateX(-25%);
          width: 40%;
          text-align: left;
          color: black;
          z-index: 1;
        }

        .flavor-text {
          font-size: clamp(1rem, 1.5vw, 1.2rem);
          line-height: 1.3;
          color: black;
        }

        .skills-container {
          grid-column: 2 / 3;
          grid-row: 2 / 3;
          display: flex;
          flex-direction: column;
          justify-content: flex-start;
          gap: min(1vw, 10px);
          margin-top: min(8vw, 80px);
          font-size: clamp(0.8rem, 1.2vw, 1rem);
          transform: scale(0.9);
          transform-origin: top left;
          margin-left: 0px;
          z-index: 2;
          color: black;
        }

        .skills-container h2 {
          font-size: clamp(2rem, 4vw, 2.5rem);
          margin-left: min(20vw, 200px);
          margin-bottom: clamp(0.4rem, 0.5vw, 0.5rem);
        }

        .skills-grid {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: min(1vw, 10px);
          border: 2px solid black;
          padding: min(2vw, 20px);
          border-radius: min(0.5vw, 5px);
          width: 100%;
          box-sizing: border-box;
        }

        .skill-item {
          padding: min(1vw, 10px);
          border: 1px solid black;
          border-radius: min(0.5vw, 5px);
          margin-bottom: min(1vw, 10px);
          text-align: center;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          height: min(7.5vw, 75px);
          font-size: clamp(1.2rem, 1.8vw, 1.5rem);
        }

        .skill-item .modifier {
          margin-top: min(0.1vw, 1px);
          font-size: clamp(1rem, 1.5vw, 1.2rem);
        }

        .skill-item.highlight {
          background-color: white;
          color: black;
          font-weight: bold;
        }

        .skill-item.extra-strong {
          background-color: #fff200;
          color: black;
          font-weight: bold;
        }

        .checkbox-container {
          display: flex;
          flex-direction: row;
          align-items: center;
          gap: min(1vw, 10px);
          margin-top: min(2vw, 20px);
          margin-left: min(1vw, 10px);
          font-size: clamp(1.2rem, 1.8vw, 1.5rem);
        }

        .checkbox-container label {
          font-weight: bold;
          color: black;
          margin-bottom: min(0.5vw, 5px);
        }

        .checkbox-container input[type="checkbox"] {
          width: min(4vw, 40px);
          height: min(4vw, 40px);
          border: 2px solid black;
          background-color: white;
          color: black;
          cursor: pointer;
        }

        /* Battle Page Styles */
        .battle-page-container {
          grid-template-columns: 1fr 1fr;
          grid-template-rows: auto auto 1fr;
          gap: min(2vw, 20px);
          width: 80%;
          max-width: 1200px;
          margin-top: min(2vw, 20px);
        }

        .battle-page-container .image-container {
          grid-column: 1 / 2;
          grid-row: 1 / 3;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-start;
          width: min(30vw, 350px);
          height: min(30vw, 350px);
          border-radius: min(2vw, 20px);
          overflow: visible;
          background-color: transparent;
          z-index: 3;
          margin-bottom: min(1vw, 10px);
        }

        .ac-hp-vp-container {
          grid-column: 2 / 3;
          grid-row: 1 / 2;
          display: flex;
          justify-content: space-between;
          gap: min(1vw, 10px);
          width: 100%;
          margin-bottom: 0;
        }

        .ac-hp-vp-container .stat-block,
        .stats-container .stat-block {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
        }

        .ac-hp-vp-container .stat-label,
        .stats-container .stat-label {
          margin-bottom: min(0.5vw, 5px);
          text-align: center;
          font-size: clamp(1rem, 1.5vw, 1.3rem);
          font-weight: bold;
        }

        .ac-hp-vp-container .stat-value-box {
          width: min(7vw, 70px);
          height: min(7vw, 70px);
          background-color: #f44336;
          color: black;
          border-radius: min(1vw, 10px);
          border: 3px solid black;
          text-align: center;
          font-size: clamp(1.5rem, 2.5vw, 1.9rem);
          font-weight: 650;
          box-shadow: min(0.3vw, 3px) min(0.3vw, 3px) 0 #000;
          display: flex;
          justify-content: center;
          align-items: center;
        }

        .stats-container {
          grid-column: 2 / 3;
          grid-row: 2 / 3;
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: min(1vw, 10px);
          margin-top: 0;
          width: 100%;
          margin-bottom: min(1vw, 10px);
        }

        .stats-container .stat-block {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: min(0.5vw, 5px);
        }

        .stats-container .stat-value-box {
          width: min(6vw, 60px);
          height: min(6vw, 60px);
          background-color: #f44336;
          color: black;
          border-radius: min(1vw, 10px);
          border: 3px solid black;
          text-align: center;
          font-size: clamp(1.5rem, 2.2vw, 1.8rem);
          box-shadow: min(0.3vw, 3px) min(0.3vw, 3px) 0 #000;
          display: flex;
          justify-content: center;
          align-items: center;
        }

        .stats-container .stat-modifier-box {
          width: min(5vw, 50px);
          height: min(5vw, 50px);
          background-color: #f44336;
          color: white;
          border-radius: min(1vw, 10px);
          border: 3px solid black;
          text-align: center;
          font-size: clamp(1.4rem, 2vw, 1.6rem);
          font-weight: 900;
          box-shadow: min(0.3vw, 3px) min(0.3vw, 3px) 0 #000;
          display: flex;
          justify-content: center;
          align-items: center;
          margin-top: min(-1vw, -10px);
          position: relative;
          z-index: 1;
        }

        .moves-container {
          grid-column: 2 / 3;
          grid-row: 3 / 4;
          display: flex;
          flex-direction: column;
          width: 100%;
          margin-top: min(5vw, 50px);
          margin-left: min(-1vw, -10px);
        }

        .moves-grid {
          display: flex;
          flex-wrap: wrap;
          gap: min(0.5vw, 5px);
          width: 100%;
          justify-content: flex-start;
        }

        .move-item {
          padding: min(0.8vw, 8px);
          border: 2px solid black;
          border-radius: min(0.5vw, 5px);
          background-color: #ffffff;
          color: black;
          text-align: center;
          font-size: clamp(0.9rem, 1.3vw, 1.1rem);
          display: flex;
          flex-direction: column;
          justify-content: center;
          white-space: nowrap;
          width: auto;
          flex: 1 1 calc(25% - min(0.5vw, 10px));
          max-width: 100%;
          box-sizing: border-box;
          height: min(7.5vw, 75px);
        }

        .battle-page-container .new-details-container {
          grid-column: 1 / 2;
          grid-row: 3 / 4;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          justify-content: flex-start;
          gap: min(0.5vw, 5px);
          margin-top: min(-9.5vw, -95px);
          width: min(25vw, 250px);
          padding-left: 0;
          margin-left: min(-4vw, -40px);
        }

        .stat-pair-container {
          display: flex;
          justify-content: space-between;
          width: 100%;
          gap: min(1vw, 10px);
        }

        .stat-item.multi-line {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          width: 200%;
        }

        .stat-item.multi-line .stat-label {
          display: inline;
          margin-right: min(0.5vw, 5px);
        }

        .stat-item.multi-line .stat-value {
          display: inline;
          margin-top: 0;
          word-wrap: break-word;
          max-width: 100%;
        }

        /* Navigation Arrows */
        .arrow-button {
          font-size: clamp(2rem, 3vw, 2.5rem);
          padding: min(0.5vw, 5px) min(1.5vw, 15px);
          background-color: white;
          color: black;
          border: 2px solid black;
          border-radius: min(0.5vw, 5px);
          cursor: pointer;
          transition: background-color 0.3s;
          position: absolute;
          bottom: 5%;
          z-index: 1;
        }

        .arrow-button:hover {
          background-color: #f0f0f0;
        }

        #nextPage {
          right: calc(20%);
        }

        #prevPage {
          left: calc(20%);
          display: none;
        }

        .edit-button {
          background-color: #bfbfbf;
          color: black;
          border: none;
          border-radius: min(0.5vw, 5px);
          padding: min(1vw, 10px) min(2vw, 20px);
          font-size: clamp(1.2rem, 1.8vw, 1.5rem);
          cursor: pointer;
          transition: background-color 0.3s;
          margin-top: min(1vw, 10px);
          display: block;
        }

        .edit-button:hover {
          background-color: #d32f2f;
        }

        @media (max-width: 1024px) {
          .card-container,
          .battle-page-container {
            grid-template-columns: 1fr;
            grid-template-rows: auto;
          }

          .image-container,
          .new-details-container,
          .ac-hp-vp-container,
          .stats-container,
          .skills-container,
          .moves-container {
            grid-column: 1 / 2;
          }

          .skills-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }
      </style>

      <h1>Pokemon Card</h1>

      <!-- Info Page -->
      <div id="infoPage" class="card-container active-page">
        <div class="image-container">
          <img id="pokemonImage" src="${image}" alt="${name}" onerror="this.src='assets/Pokeball.png'">
        </div>

        <div class="new-details-container">
          <div class="stat-item">
            <div class="stat-label">Name:</div>
            <div class="stat-value">
              <span id="pokemonName">${displayName}</span>
              <span id="pokemonDexEntry" class="dex-entry">${dexEntry}</span>
            </div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Level:</div>
            <div id="pokemonLevel" class="stat-value">${level}</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Typing:</div>
            <div id="pokemonTyping" class="stat-value">${typingText}</div>
          </div>
          <div class="stat-item multi-line">
            <div class="stat-label">Saving Throw(s):</div>
            <div id="pokemonSavingThrow" class="stat-value">${savingThrow}</div>
          </div>
          ${sensesArray.length > 0 ? `
            <div class="stat-item multi-line">
              <div class="stat-label">Senses:</div>
              <div id="sensesValue" class="stat-value">${sensesDisplay}</div>
            </div>
          ` : ''}
          <div class="checkbox-container">
            <label for="inActiveParty">Active Party</label>
            <input type="checkbox" id="inActiveParty" ${inActiveParty ? 'checked' : ''}>
            <label for="inUtilitySlot">Utility Slot</label>
            <input type="checkbox" id="inUtilitySlot" ${inUtilitySlot ? 'checked' : ''}>
          </div>

          <div style="margin-top: min(1vw, 10px);">
            <button class="edit-button" id="editPokemonButton">Edit Pokémon</button>
          </div>
        </div>

        ${flavorText ? `
          <div class="flavor-text-container">
            <p id="flavorText" class="flavor-text">${flavorText}</p>
          </div>
        ` : ''}

        <div class="skills-container">
          <h2>Skills</h2>
          <div id="skills" class="skills-grid">
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

      <!-- Battle Page -->
      <div id="battlePage" class="battle-page-container hidden-page">
        <div class="image-container">
          <img id="pokemonImageBattle" src="${image}" alt="${name}" onerror="this.src='assets/Pokeball.png'">
        </div>

        <div class="ac-hp-vp-container">
          <div class="stat-block">
            <div class="stat-label">AC</div>
            <div class="stat-value-box" id="acValue">${ac}</div>
          </div>
          <div class="stat-block">
            <div class="stat-label">HP</div>
            <div class="stat-value-box" id="hpValue">${hp}</div>
          </div>
          <div class="stat-block">
            <div class="stat-label">VP</div>
            <div class="stat-value-box" id="vpValue">${vp}</div>
          </div>
        </div>

        <div class="stats-container">
          <div class="stat-block">
            <div class="stat-label">STR</div>
            <div class="stat-value-box" id="strValue">${str}</div>
            <div class="stat-modifier-box" id="strModifierValue">${strMod >= 0 ? '+' : ''}${strMod}</div>
          </div>
          <div class="stat-block">
            <div class="stat-label">DEX</div>
            <div class="stat-value-box" id="dexValue">${dex}</div>
            <div class="stat-modifier-box" id="dexModifierValue">${dexMod >= 0 ? '+' : ''}${dexMod}</div>
          </div>
          <div class="stat-block">
            <div class="stat-label">CON</div>
            <div class="stat-value-box" id="conValue">${con}</div>
            <div class="stat-modifier-box" id="conModifierValue">${conMod >= 0 ? '+' : ''}${conMod}</div>
          </div>
          <div class="stat-block">
            <div class="stat-label">INT</div>
            <div class="stat-value-box" id="intValue">${int}</div>
            <div class="stat-modifier-box" id="intModifierValue">${intMod >= 0 ? '+' : ''}${intMod}</div>
          </div>
          <div class="stat-block">
            <div class="stat-label">WIS</div>
            <div class="stat-value-box" id="wisValue">${wis}</div>
            <div class="stat-modifier-box" id="wisModifierValue">${wisMod >= 0 ? '+' : ''}${wisMod}</div>
          </div>
          <div class="stat-block">
            <div class="stat-label">CHA</div>
            <div class="stat-value-box" id="chaValue">${cha}</div>
            <div class="stat-modifier-box" id="chaModifierValue">${chaMod >= 0 ? '+' : ''}${chaMod}</div>
          </div>
        </div>

        <div class="moves-container">
          <div class="moves-grid" id="movesGrid">
            <!-- Moves will be populated here - for now showing placeholder -->
            <div class="move-item">Move 1</div>
            <div class="move-item">Move 2</div>
            <div class="move-item">Move 3</div>
            <div class="move-item">Move 4</div>
          </div>
        </div>

        <div class="new-details-container">
          <div class="stat-pair-container">
            <div class="stat-item">
              <div class="stat-label">HD:</div>
              <div id="hdValue" class="stat-value">${hd}</div>
            </div>
            <div class="stat-item">
              <div class="stat-label">VD:</div>
              <div id="vdValue" class="stat-value">${vd}</div>
            </div>
          </div>
          <div class="stat-pair-container">
            <div class="stat-item">
              <div class="stat-label">STAB:</div>
              <div id="stabValue" class="stat-value">${stab}</div>
            </div>
            <div class="stat-item">
              <div class="stat-label">Proficiency:</div>
              <div id="proficiencyValue" class="stat-value">+${proficiency}</div>
            </div>
          </div>
          <div class="stat-pair-container">
            <div class="stat-item">
              <div class="stat-label">Initiative:</div>
              <div id="initiativeValue" class="stat-value">${initiative >= 0 ? '+' : ''}${initiative}</div>
            </div>
            <div class="stat-item">
              <div class="stat-label">Loyalty:</div>
              <div id="loyaltyValue" class="stat-value">${loyalty}</div>
            </div>
          </div>
          <div class="stat-item multi-line">
            <span class="stat-label">Ability: </span>
            <div id="abilityEffect" class="stat-value">${abilityButtonsHTML}</div>
          </div>
          <div class="stat-item multi-line">
            <span class="stat-label">Held Item: <span id="heldItemName">${heldItem}</span></span>
            <div id="heldItemEffect" class="stat-value">No item effect available</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Movement:</div>
            <div id="movementValue" class="stat-value">${speed} ft</div>
          </div>
        </div>
      </div>

      <!-- Navigation Arrows -->
      <button id="nextPage" class="arrow-button">&#x2192;</button>
      <button id="prevPage" class="arrow-button">&#x2190;</button>

      <!-- Ability Popup -->
      <div id="abilityPopup" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; justify-content: center; align-items: center;">
        <div style="background: white; border-radius: min(1vw, 10px); padding: min(2vw, 20px); max-width: 500px; width: 90%; max-height: 80vh; overflow-y: auto;">
          <h2 id="abilityPopupTitle" style="margin-top: 0; color: #333;">Ability</h2>
          <div id="abilityPopupContent" style="font-size: clamp(1rem, 1.5vw, 1.2rem); line-height: 1.6; color: black;"></div>
          <button id="closeAbilityPopup" style="margin-top: min(1.5vw, 15px); padding: min(1vw, 10px) min(2vw, 20px); background: #f44336; color: white; border: none; border-radius: min(0.5vw, 5px); cursor: pointer; font-size: clamp(0.9rem, 1.2vw, 1rem);">Close</button>
        </div>
      </div>
    </div>
  `;

  // Store parsed abilities for event listener use
  window.pokemonAbilities = parsedAbilities;

  return html;
}

export function attachPokemonCardListeners() {
  const pokemonName = sessionStorage.getItem('selectedPokemonName');
  const pokemonData = JSON.parse(sessionStorage.getItem(`pokemon_${pokemonName.toLowerCase()}`));
  const trainerData = JSON.parse(sessionStorage.getItem('trainerData'));

  // Page toggle function
  function togglePage() {
    const infoPage = document.getElementById('infoPage');
    const battlePage = document.getElementById('battlePage');
    const nextButton = document.getElementById('nextPage');
    const prevButton = document.getElementById('prevPage');

    if (infoPage.classList.contains('active-page')) {
      // Switch to battle page
      infoPage.classList.remove('active-page');
      infoPage.classList.add('hidden-page');
      battlePage.classList.remove('hidden-page');
      battlePage.classList.add('active-page');
      nextButton.style.display = 'none';
      prevButton.style.display = 'block';
    } else {
      // Switch to info page
      battlePage.classList.remove('active-page');
      battlePage.classList.add('hidden-page');
      infoPage.classList.remove('hidden-page');
      infoPage.classList.add('active-page');
      nextButton.style.display = 'block';
      prevButton.style.display = 'none';
    }
  }

  // Navigation arrow buttons
  document.getElementById('nextPage')?.addEventListener('click', togglePage);
  document.getElementById('prevPage')?.addEventListener('click', togglePage);

  // Edit Pokemon button
  document.getElementById('editPokemonButton')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('navigate', {
      detail: { route: 'edit-pokemon', pokemonName: pokemonName }
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

  // Ability button click listeners
  document.querySelectorAll('.ability-button').forEach(button => {
    button.addEventListener('click', (e) => {
      const index = parseInt(e.target.dataset.abilityIndex);
      if (window.pokemonAbilities && window.pokemonAbilities[index]) {
        const ability = window.pokemonAbilities[index];
        document.getElementById('abilityPopupTitle').textContent = ability.name;
        document.getElementById('abilityPopupContent').textContent = ability.description;
        const abilityPopup = document.getElementById('abilityPopup');
        abilityPopup.style.display = 'flex';
      }
    });
  });

  // Close ability popup button
  document.getElementById('closeAbilityPopup')?.addEventListener('click', () => {
    document.getElementById('abilityPopup').style.display = 'none';
  });

  // Close ability popup when clicking outside
  document.getElementById('abilityPopup')?.addEventListener('click', (e) => {
    if (e.target.id === 'abilityPopup') {
      document.getElementById('abilityPopup').style.display = 'none';
    }
  });
}
