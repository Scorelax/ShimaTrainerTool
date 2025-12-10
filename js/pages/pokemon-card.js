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
  const initiative = pokemonData[30] || 0;
  const proficiencyBonus = pokemonData[31] || 2;
  const nature = pokemonData[32] || '';
  const loyalty = pokemonData[33] || 0;
  const stabBonus = pokemonData[34] || 2;
  const heldItem = pokemonData[35] || 'None';
  const nickname = pokemonData[36] || '';
  const inActiveParty = !!pokemonData[38];
  const senses = pokemonData[49] || '';
  const feats = pokemonData[50] || '';
  const flavorText = pokemonData[52] || '';
  const inUtilitySlot = pokemonData[56] === 1 || pokemonData[56] === '1';

  // Movement data (index 13 is comma-separated: walking,climbing,flying,hovering,swimming,burrowing)
  const movementData = pokemonData[13] || '';
  const movementValues = movementData.split(',').map(v => v.trim());
  const movementTypes = ['Walking', 'Climbing', 'Flying', 'Hovering', 'Swimming', 'Burrowing'];
  const movementDisplay = movementValues
    .map((value, index) => value && value !== '-' && value !== '0' ? `${movementTypes[index]}: ${value} ft` : null)
    .filter(m => m !== null)
    .join(', ') || `${speed} ft`;

  // Parse learned moves from indices 23-28, 37 based on level
  const moveIndices = [23, 24, 25, 26, 27, 28, 37];
  const requiredLevels = [1, 2, 6, 10, 14, 18, 0]; // 0 means always available
  const moves = [];

  moveIndices.forEach((index, idx) => {
    if (level >= requiredLevels[idx] || (index === 37 && pokemonData[index])) {
      const movesAtIndex = pokemonData[index] || '';
      if (movesAtIndex) {
        const moveNames = movesAtIndex.split(',').map(m => m.trim()).filter(m => m);
        moves.push(...moveNames);
      }
    }
  });

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

  // STAB display
  const stab = `+${stabBonus}`;

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
  const sensesDisplay = sensesArray.join('\n');

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
        `<button class="ability-button" data-ability-index="${index}" style="background-color: white; color: black; border: 2px solid #333; border-radius: 0.6vh; padding: 0.8vh 1.5vh; font-size: clamp(0.8rem, 1.5vh, 1.5vh); cursor: pointer; margin: 0.3vh; font-weight: bold;">${ability.name}</button>`
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
          background-size: 6.5vh 6.5vh, 10.4vh 10.4vh;
          background-position: 0 0, 5.2vh 5.2vh;
          pointer-events: none;
          opacity: 0.5;
        }

        .pokemon-card-page {
          display: grid;
          grid-template-columns: minmax(25%, 30%) 1fr;
          gap: clamp(2rem, 4vw, 4rem);
          padding: clamp(1rem, 2vh, 2rem) clamp(1rem, 2vw, 3rem) clamp(1rem, 2vh, 1.5rem);
          min-height: auto;
          position: relative;
          z-index: 1;
        }

        .pokemon-card-page h1 {
          position: absolute;
          top: clamp(15px, 3vh, 20px);
          left: 50%;
          transform: translateX(-50%);
          color: white;
          margin: 0;
          font-size: clamp(2rem, 5vw, 3rem);
          text-transform: uppercase;
          letter-spacing: clamp(1px, 0.5vw, 3px);
          text-shadow: 0 clamp(3px, 0.8vh, 4px) clamp(8px, 2vh, 10px) rgba(0,0,0,0.8);
          font-weight: 900;
          z-index: 1000;
        }

        /* Page visibility classes */
        .hidden-page {
          display: none !important;
        }

        .active-page {
          display: grid !important;
        }

        /* Info Page Grid Layout - matches trainer-info */
        .info-page-grid {
          display: grid;
          grid-template-columns: minmax(25%, 30%) 1fr;
          gap: clamp(2rem, 4vw, 4rem);
          grid-column: 1 / -1;
        }

        .left-column {
          display: flex;
          flex-direction: column;
          align-items: stretch;
          padding-top: clamp(4rem, 8vh, 6rem);
        }

        .pokemon-image-container {
          width: 100%;
          aspect-ratio: 1;
          border-radius: clamp(15px, 3vw, 25px);
          overflow: hidden;
          border: clamp(4px, 0.7vw, 6px) solid #FFDE00;
          box-shadow: 0 clamp(10px, 2vh, 15px) clamp(25px, 5vh, 40px) rgba(0,0,0,0.5);
          background: white;
          margin-bottom: clamp(1.5rem, 3vh, 2rem);
        }

        .pokemon-image-container img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .pokemon-info-list {
          background: linear-gradient(135deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.08) 100%);
          border-radius: clamp(15px, 3vw, 25px);
          padding: clamp(1rem, 2vh, 1.5rem);
          margin-bottom: clamp(1rem, 2vh, 1.5rem);
          border: clamp(2px, 0.4vw, 3px) solid rgba(255,222,0,0.3);
        }

        .info-item {
          display: flex;
          justify-content: space-between;
          padding: clamp(0.5rem, 1vh, 0.75rem) clamp(0.75rem, 1.5vw, 1rem);
          border-bottom: 1px solid rgba(255,255,255,0.1);
          font-size: clamp(0.9rem, 1.8vw, 1.1rem);
        }

        .info-item:last-child {
          border-bottom: none;
        }

        .info-item-label {
          color: #FFDE00;
          font-weight: 700;
        }

        .info-item-value {
          color: white;
          font-weight: 600;
          text-align: right;
          max-width: 60%;
          word-wrap: break-word;
        }

        .checkbox-container {
          display: flex;
          flex-direction: column;
          gap: clamp(0.5rem, 1vh, 0.75rem);
          margin-bottom: clamp(1rem, 2vh, 1.5rem);
          padding: clamp(0.75rem, 1.5vh, 1rem);
          background: linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.05) 100%);
          border-radius: clamp(10px, 2vw, 15px);
        }

        .checkbox-container label {
          display: flex;
          align-items: center;
          gap: clamp(0.5rem, 1vw, 0.75rem);
          color: white;
          font-weight: 600;
          font-size: clamp(0.9rem, 1.8vw, 1.1rem);
          cursor: pointer;
        }

        .checkbox-container input[type="checkbox"] {
          width: clamp(18px, 3.5vw, 22px);
          height: clamp(18px, 3.5vw, 22px);
          cursor: pointer;
        }

        .info-buttons-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: clamp(0.75rem, 1.5vh, 1rem);
        }

        .info-button {
          background: linear-gradient(135deg, #3B4CCA 0%, #2A3BA0 100%);
          color: white;
          padding: clamp(0.75rem, 1.5vh, 1rem);
          border: clamp(2px, 0.4vw, 3px) solid #FFDE00;
          border-radius: clamp(10px, 2vw, 15px);
          font-size: clamp(0.9rem, 1.8vw, 1.1rem);
          font-weight: 700;
          cursor: pointer;
          transition: all 0.3s;
          text-transform: uppercase;
        }

        .info-button:hover {
          transform: translateY(-2px);
          box-shadow: 0 clamp(5px, 1vh, 8px) clamp(15px, 3vw, 20px) rgba(59, 76, 202, 0.4);
        }

        .right-column {
          display: flex;
          flex-direction: column;
          gap: clamp(1.5rem, 3vh, 2rem);
          padding-top: clamp(4rem, 8vh, 6rem);
        }

        .description-container {
          background: linear-gradient(135deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.08) 100%);
          border-radius: clamp(15px, 3vw, 25px);
          padding: clamp(1rem, 2vh, 1.5rem);
          border: clamp(2px, 0.4vw, 3px) solid rgba(255,222,0,0.3);
        }

        .description-container h3 {
          color: #FFDE00;
          font-size: clamp(1.2rem, 2.5vw, 1.6rem);
          margin: 0 0 clamp(0.75rem, 1.5vh, 1rem) 0;
          font-weight: 900;
        }

        .description-text {
          color: white;
          font-size: clamp(0.9rem, 1.8vw, 1.1rem);
          line-height: 1.6;
          margin: 0;
        }

        .skills-container {
          background: linear-gradient(135deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.08) 100%);
          border-radius: clamp(15px, 3vw, 25px);
          padding: clamp(1rem, 2vh, 1.5rem);
          border: clamp(2px, 0.4vw, 3px) solid rgba(255,222,0,0.3);
        }

        .skills-container h3 {
          color: #FFDE00;
          font-size: clamp(1.2rem, 2.5vw, 1.6rem);
          margin: 0 0 clamp(0.75rem, 1.5vh, 1rem) 0;
          font-weight: 900;
          text-align: center;
        }

        .skills-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: clamp(0.4rem, 1.2vw, 0.6rem);
        }

        .skill-item {
          background: rgba(255,255,255,0.08);
          padding: clamp(0.4rem, 0.8vh, 0.6rem);
          border-radius: clamp(8px, 1.5vw, 12px);
          display: flex;
          justify-content: space-between;
          align-items: center;
          border: 1px solid rgba(255,255,255,0.1);
        }

        .skill-item.highlight {
          background: rgba(255,222,0,0.2);
          border-color: rgba(255,222,0,0.5);
        }

        .skill-item.extra-strong {
          background: rgba(255,222,0,0.35);
          border-color: rgba(255,222,0,0.8);
        }

        .skill-name {
          color: white;
          font-size: clamp(0.75rem, 1.5vw, 0.95rem);
          font-weight: 600;
        }

        .skill-modifier {
          color: #FFDE00;
          font-size: clamp(0.75rem, 1.5vw, 0.95rem);
          font-weight: 700;
        }

        /* Battle Page Grid Layout - matches trainer-info */
        .battle-page-grid {
          display: grid;
          grid-template-columns: minmax(25%, 30%) 1fr;
          gap: clamp(2rem, 4vw, 4rem);
          grid-column: 1 / -1;
        }

        .battle-stats-container {
          background: linear-gradient(135deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.08) 100%);
          border-radius: clamp(15px, 3vw, 25px);
          padding: clamp(1rem, 2vh, 1.5rem);
          border: clamp(2px, 0.4vw, 3px) solid rgba(255,222,0,0.3);
          margin-bottom: clamp(1.5rem, 3vh, 2rem);
        }

        .battle-stats-container h3 {
          color: #FFDE00;
          font-size: clamp(1.2rem, 2.5vw, 1.6rem);
          margin: 0 0 clamp(0.75rem, 1.5vh, 1rem) 0;
          font-weight: 900;
          text-align: center;
        }

        .stat-main-container {
          display: flex;
          flex-direction: column;
          gap: clamp(0.75rem, 1.5vh, 1rem);
        }

        .ability-container {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: clamp(0.5rem, 1vw, 0.75rem);
        }

        .ability-box {
          background: rgba(255,255,255,0.08);
          border-radius: clamp(10px, 2vw, 15px);
          padding: clamp(0.5rem, 1vh, 0.75rem);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: clamp(0.25rem, 0.5vh, 0.4rem);
          border: 1px solid rgba(255,255,255,0.1);
        }

        .ability-label {
          color: #FFDE00;
          font-size: clamp(0.75rem, 1.5vw, 0.95rem);
          font-weight: 700;
          text-transform: uppercase;
        }

        .ability-value {
          color: white;
          font-size: clamp(1.1rem, 2.2vw, 1.4rem);
          font-weight: 900;
        }

        .ability-modifier {
          color: #FFDE00;
          font-size: clamp(0.85rem, 1.7vw, 1.1rem);
          font-weight: 700;
        }

        .moves-list-container {
          background: linear-gradient(135deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.08) 100%);
          border-radius: clamp(15px, 3vw, 25px);
          padding: clamp(1rem, 2vh, 1.5rem);
          border: clamp(2px, 0.4vw, 3px) solid rgba(255,222,0,0.3);
        }

        .moves-list-container h3 {
          color: #FFDE00;
          font-size: clamp(1.2rem, 2.5vw, 1.6rem);
          margin: 0 0 clamp(0.75rem, 1.5vh, 1rem) 0;
          font-weight: 900;
          text-align: center;
        }

        .moves-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(clamp(100px, 15vw, 140px), 1fr));
          gap: clamp(0.5rem, 1vw, 0.75rem);
        }

        .move-item {
          background: rgba(255,255,255,0.9);
          color: #333;
          padding: clamp(0.5rem, 1vh, 0.75rem);
          border-radius: clamp(8px, 1.5vw, 12px);
          text-align: center;
          font-weight: 700;
          font-size: clamp(0.8rem, 1.6vw, 1rem);
          cursor: pointer;
          transition: all 0.3s;
          border: 2px solid rgba(0,0,0,0.2);
        }

        .move-item:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 8px rgba(0,0,0,0.3);
        }

        .no-moves {
          grid-column: 1 / -1;
          text-align: center;
          color: rgba(255,255,255,0.6);
          font-style: italic;
          padding: clamp(1rem, 2vh, 1.5rem);
        }

        /* Info Page Styles - New layout */
        .card-container {
          display: flex;
          flex-direction: column;
          width: 95%;
          max-width: 160vh;
          margin-top: 0.5vh;
          position: relative;
          gap: 1vh;
        }

        /* Top section: Image + Info side by side */
        .top-section {
          display: flex;
          flex-wrap: nowrap;
          gap: 2vh;
          align-items: flex-start;
          width: 100%;
        }

        /* Image on both pages - slightly bigger than trainer image */
        .image-container,
        .battle-page-container .image-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-start;
          width: min(30vw, 36vh);
          height: min(30vw, 36vh);
          border-radius: 0.5vh;
          overflow: hidden;
          background-color: transparent;
          flex-shrink: 0;
        }

        .image-container img,
        .battle-page-container .image-container img {
          width: min(30vw, 36vh);
          height: min(30vw, 36vh);
          border-radius: 0.5vh;
          object-fit: contain;
          cursor: pointer;
        }

        .image-container img:hover {
          opacity: 0.8;
          transition: opacity 0.3s;
        }

        /* Info on the right side of image */
        .new-details-container {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          justify-content: flex-start;
          gap: 0.25vh;
          flex: 1;
          min-width: 0;
          padding: 0.5vh;
        }

        .stat-item {
          display: flex;
          flex-direction: row;
          align-items: center;
          gap: 0.5vh;
          margin-bottom: 0.5vh;
          text-align: left;
          font-size: clamp(0.7rem, 1.4vh, 1.4vh);
          width: 100%;
        }

        .stat-label {
          font-weight: bold;
          color: black;
          min-width: 10vh;
        }

        .dex-entry::before {
          content: " #";
          margin-left: 0.25vh;
        }

        .stat-value {
          color: black;
          word-wrap: break-word;
          flex-grow: 1;
        }

        .checkbox-container {
          display: flex;
          flex-direction: row;
          align-items: center;
          gap: 0.8vh;
          margin-top: 0.5vh;
          font-size: clamp(0.7rem, 1.3vh, 1.3vh);
        }

        .checkbox-container label {
          font-weight: bold;
          color: black;
          margin-bottom: 0;
        }

        .checkbox-container input[type="checkbox"] {
          width: 2vh;
          height: 2vh;
          border: 2px solid black;
          background-color: white;
          color: black;
          cursor: pointer;
        }

        /* Edit and Battle buttons below image */
        .button-container {
          display: flex;
          gap: 1vh;
          width: 100%;
        }

        /* Flavor text below buttons - dynamic height */
        .flavor-text-container {
          display: flex;
          flex-direction: column;
          text-align: left;
          color: black;
          padding: 1vh;
          background-color: rgba(255, 255, 255, 0.9);
          border-radius: 0.5vh;
          border: 2px solid black;
          width: 100%;
          max-width: 100%;
        }

        .flavor-text {
          font-size: clamp(0.7rem, 1.2vh, 1.2vh);
          line-height: 1.4;
          color: black;
          margin: 0;
        }

        /* Skills table below description */
        .skills-container {
          display: flex;
          flex-direction: column;
          justify-content: flex-start;
          gap: 1vh;
          width: 100%;
        }

        .skills-container h2 {
          font-size: clamp(1.2rem, 2vh, 2vh);
          margin-bottom: 0.5vh;
          color: black;
          text-align: center;
        }

        .skills-grid {
          display: grid;
          grid-template-columns: repeat(6, 1fr);
          gap: 0.8vh;
          border: 2px solid black;
          padding: 1.5vh;
          border-radius: 0.5vh;
          width: 100%;
          box-sizing: border-box;
          background-color: rgba(255, 255, 255, 0.1);
        }

        .skill-item {
          padding: 0.8vh;
          border: 1px solid black;
          border-radius: 0.3vh;
          text-align: center;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          height: 5vh;
          font-size: clamp(0.7rem, 1.2vh, 1.2vh);
          color: black;
        }

        .skill-item .modifier {
          margin-top: 0.2vh;
          font-size: clamp(0.65rem, 1vh, 1vh);
          color: black;
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

        /* Back button - matches trainer-card style */
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

        /* Battle Page Styles */
        .battle-page-container {
          display: flex;
          flex-direction: column;
          width: 95%;
          max-width: 160vh;
          margin-top: 0.5vh;
          position: relative;
          gap: 1vh;
        }

        /* Top section on battle page: Image + Stats side by side */
        .battle-top-section {
          display: flex;
          flex-wrap: nowrap;
          gap: 2vh;
          align-items: flex-start;
          width: 100%;
        }


        /* Stats on right side of image */
        .battle-stats-column {
          display: flex;
          flex-direction: column;
          gap: 1vh;
          max-width: 50%;
          min-width: 0;
        }

        .ac-hp-vp-container {
          display: flex;
          flex-direction: row;
          justify-content: flex-start;
          gap: 1vh;
          width: 100%;
        }

        .ac-hp-vp-container .stat-block {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
        }

        .ac-hp-vp-container .stat-label {
          margin-bottom: 0.3vh;
          text-align: center;
          font-size: clamp(0.7rem, 1.2vh, 1.2vh);
          font-weight: bold;
          color: black;
        }

        .ac-hp-vp-container .stat-value-box {
          width: 5vh;
          height: 5vh;
          background-color: #f44336;
          color: black;
          border-radius: 0.6vh;
          border: 2px solid black;
          text-align: center;
          font-size: clamp(1rem, 1.6vh, 1.6vh);
          font-weight: 650;
          box-shadow: 0.15vh 0.15vh 0 #000;
          display: flex;
          justify-content: center;
          align-items: center;
        }

        .stats-container {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 1vh 0.8vh;
          width: 100%;
        }

        .stats-container .stat-block {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.2vh;
        }

        .stats-container .stat-label {
          margin-bottom: 0.2vh;
          text-align: center;
          font-size: clamp(0.7rem, 1.1vh, 1.1vh);
          font-weight: bold;
          color: black;
        }

        .stats-container .stat-value-box {
          width: 4vh;
          height: 4vh;
          background-color: #f44336;
          color: black;
          border-radius: 0.6vh;
          border: 2px solid black;
          text-align: center;
          font-size: clamp(0.9rem, 1.4vh, 1.4vh);
          box-shadow: 0.15vh 0.15vh 0 #000;
          display: flex;
          justify-content: center;
          align-items: center;
        }

        .stats-container .stat-modifier-box {
          width: 3.2vh;
          height: 3.2vh;
          background-color: #f44336;
          color: white;
          border-radius: 0.6vh;
          border: 2px solid black;
          text-align: center;
          font-size: clamp(0.75rem, 1.2vh, 1.2vh);
          font-weight: 900;
          box-shadow: 0.15vh 0.15vh 0 #000;
          display: flex;
          justify-content: center;
          align-items: center;
          margin-top: -0.6vh;
          position: relative;
          z-index: 1;
        }

        /* Details below image on battle page */
        .battle-details-container {
          display: flex;
          flex-direction: column;
          gap: 0.5vh;
          width: min(30vw, 36vh);
        }

        /* Moves below stats on battle page */
        .moves-container {
          display: flex;
          flex-direction: column;
          width: 100%;
          gap: 0.5vh;
        }

        .moves-container h2 {
          font-size: clamp(1rem, 1.6vh, 1.6vh);
          color: black;
          margin: 0;
        }

        .moves-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 0.6vh 0.8vh;
          width: 100%;
        }

        .move-item {
          padding: 0.6vh 1vh;
          border: 2px solid black;
          border-radius: 0.4vh;
          background-color: #ffffff;
          color: black;
          text-align: center;
          font-size: clamp(0.7rem, 1.1vh, 1.1vh);
          font-weight: bold;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 3vh;
        }

        .stat-pair-container {
          display: flex;
          justify-content: space-between;
          width: 100%;
          gap: 1vh;
        }

        .stat-item.multi-line {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          width: 100%;
        }

        .stat-item.multi-line .stat-value {
          margin-top: 0.3vh;
          white-space: pre-line;
        }

        .stat-item.multi-line .stat-label {
          display: inline;
          margin-right: 0.5vh;
        }

        .stat-item.multi-line .stat-value {
          display: inline;
          margin-top: 0;
          word-wrap: break-word;
          max-width: 100%;
        }

        /* Navigation Arrows - Hidden (using Battle Page button instead) */
        .arrow-button {
          display: none;
        }

        .edit-button,
        .battle-page-button {
          background-color: #bfbfbf;
          color: black;
          border: 2px solid black;
          border-radius: 0.5vh;
          padding: 1vh 1.5vh;
          font-size: clamp(0.75rem, 1.3vh, 1.3vh);
          font-weight: bold;
          cursor: pointer;
          transition: background-color 0.3s;
          display: block;
          flex: 1;
        }

        .edit-button:hover,
        .battle-page-button:hover {
          background-color: #d32f2f;
          color: white;
        }

        .stat-boosted {
          color: #fff200 !important;
          font-size: 2.2vh !important;
          font-weight: bold !important;
          -webkit-text-stroke: 0.5px black !important;
        }

        .stat-nerfed {
          color: #0d32d6 !important;
          font-size: 1.5vh !important;
          -webkit-text-stroke: 0.5px black !important;
        }

        @media (max-width: 600px) {
          .top-section {
            flex-direction: column;
          }

          .image-container,
          .image-container img {
            width: 100%;
            height: auto;
            max-width: 40vw;
            max-height: 40vh;
          }

          .skills-grid {
            grid-template-columns: repeat(3, 1fr);
          }

          .battle-page-container {
            grid-template-columns: 1fr;
            grid-template-rows: auto;
          }

          .ac-hp-vp-container,
          .stats-container,
          .moves-container {
            grid-column: 1 / 2;
          }
        }
      </style>

      <h1>${displayName} #${dexEntry}</h1>

      <!-- Back Button -->
      <button class="back-button" id="backToTrainerCard">←</button>

      <!-- Info Page -->
      <div id="infoPage" class="info-page-grid active-page">
        <!-- Left Column: Image + Info List + Buttons -->
        <div class="left-column">
          <div class="pokemon-image-container">
            <img id="pokemonImage" src="${image}" alt="${name}" onerror="this.src='assets/Pokeball.png'">
          </div>

          <div class="pokemon-info-list">
            <div class="info-item">
              <span class="info-item-label">Level:</span>
              <span class="info-item-value" id="pokemonLevel">${level}</span>
            </div>
            <div class="info-item">
              <span class="info-item-label">Typing:</span>
              <span class="info-item-value" id="pokemonTyping">${typingText}</span>
            </div>
            <div class="info-item">
              <span class="info-item-label">Saving Throw(s):</span>
              <span class="info-item-value" id="pokemonSavingThrow">${savingThrow}</span>
            </div>
            ${sensesArray.length > 0 ? `
              <div class="info-item">
                <span class="info-item-label">Senses:</span>
                <span class="info-item-value" id="sensesValue">${sensesDisplay}</span>
              </div>
            ` : ''}
          </div>

          <div class="checkbox-container">
            <label for="inActiveParty">
              <input type="checkbox" id="inActiveParty" ${inActiveParty ? 'checked' : ''}>
              Active Party
            </label>
            <label for="inUtilitySlot">
              <input type="checkbox" id="inUtilitySlot" ${inUtilitySlot ? 'checked' : ''}>
              Utility Slot
            </label>
          </div>

          <div class="info-buttons-grid">
            <button class="info-button" id="editPokemonButton">Edit Pokémon</button>
            <button class="info-button" id="battlePageButton">Battle Page</button>
          </div>
        </div>

        <!-- Right Column: Description + Skills -->
        <div class="right-column">
          ${flavorText ? `
            <div class="description-container">
              <h3>Description</h3>
              <p id="flavorText" class="description-text">${flavorText}</p>
            </div>
          ` : ''}

          <div class="skills-container">
            <h3>Skills</h3>
            <div id="skills" class="skills-grid">
              ${allSkills.map(skill => {
                const skillKey = skill.name.toLowerCase();
                const proficiencyLevel = skillCounts[skillKey] || 0;
                const skillClass = proficiencyLevel >= 2 ? 'extra-strong' : (proficiencyLevel === 1 ? 'highlight' : '');
                const modifier = skill.mod + (proficiencyLevel * 2);

                return `
                  <div class="skill-item ${skillClass}">
                    <div class="skill-name">${skill.name}</div>
                    <div class="skill-modifier">${modifier >= 0 ? '+' : ''}${modifier}</div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        </div>
      </div>

      <!-- Battle Page -->
      <div id="battlePage" class="battle-page-grid hidden-page">
        <!-- Left Column: Image + Battle Info -->
        <div class="left-column">
          <div class="pokemon-image-container">
            <img id="pokemonImageBattle" src="${image}" alt="${name}" onerror="this.src='assets/Pokeball.png'">
          </div>

          <div class="pokemon-info-list">
            <div class="info-item">
              <span class="info-item-label">HD:</span>
              <span class="info-item-value" id="hdValue">${hd}</span>
            </div>
            <div class="info-item">
              <span class="info-item-label">VD:</span>
              <span class="info-item-value" id="vdValue">${vd}</span>
            </div>
          </div>

          <div class="pokemon-info-list">
            <div class="info-item">
              <span class="info-item-label">STAB:</span>
              <span class="info-item-value" id="stabValue">${stab}</span>
            </div>
            <div class="info-item">
              <span class="info-item-label">Proficiency:</span>
              <span class="info-item-value" id="proficiencyValue">+${proficiencyBonus}</span>
            </div>
            <div class="info-item">
              <span class="info-item-label">Initiative:</span>
              <span class="info-item-value" id="initiativeValue">${initiative >= 0 ? '+' : ''}${initiative}</span>
            </div>
            <div class="info-item">
              <span class="info-item-label">Loyalty:</span>
              <span class="info-item-value" id="loyaltyValue">${loyalty}</span>
            </div>
            <div class="info-item">
              <span class="info-item-label">Ability:</span>
              <span class="info-item-value" id="abilityEffect">${abilityButtonsHTML}</span>
            </div>
            <div class="info-item">
              <span class="info-item-label">Held Item:</span>
              <span class="info-item-value" id="heldItemName">${heldItem}</span>
            </div>
            <div class="info-item">
              <span class="info-item-label">Movement:</span>
              <span class="info-item-value" id="movementValue">${movementDisplay}</span>
            </div>
          </div>

          <div class="info-buttons-grid">
            <button class="info-button" id="infoPageButton">Info Page</button>
          </div>
        </div>

        <!-- Right Column: Stats + Moves -->
        <div class="right-column">
          <div class="battle-stats-container">
            <h3>Stats</h3>
            <div class="stat-main-container">
              <div class="ability-container">
                <div class="ability-box">
                  <div class="ability-label">AC</div>
                  <div class="ability-value" id="acValue">${ac}</div>
                </div>
                <div class="ability-box">
                  <div class="ability-label">HP</div>
                  <div class="ability-value" id="hpValue">${hp}</div>
                </div>
                <div class="ability-box">
                  <div class="ability-label">VP</div>
                  <div class="ability-value" id="vpValue">${vp}</div>
                </div>
              </div>

              <div class="ability-container">
                <div class="ability-box">
                  <div class="ability-label">STR</div>
                  <div class="ability-value" id="strValue">${str}</div>
                  <div class="ability-modifier" id="strModifierValue">${strMod >= 0 ? '+' : ''}${strMod}</div>
                </div>
                <div class="ability-box">
                  <div class="ability-label">DEX</div>
                  <div class="ability-value" id="dexValue">${dex}</div>
                  <div class="ability-modifier" id="dexModifierValue">${dexMod >= 0 ? '+' : ''}${dexMod}</div>
                </div>
                <div class="ability-box">
                  <div class="ability-label">CON</div>
                  <div class="ability-value" id="conValue">${con}</div>
                  <div class="ability-modifier" id="conModifierValue">${conMod >= 0 ? '+' : ''}${conMod}</div>
                </div>
                <div class="ability-box">
                  <div class="ability-label">INT</div>
                  <div class="ability-value" id="intValue">${int}</div>
                  <div class="ability-modifier" id="intModifierValue">${intMod >= 0 ? '+' : ''}${intMod}</div>
                </div>
                <div class="ability-box">
                  <div class="ability-label">WIS</div>
                  <div class="ability-value" id="wisValue">${wis}</div>
                  <div class="ability-modifier" id="wisModifierValue">${wisMod >= 0 ? '+' : ''}${wisMod}</div>
                </div>
                <div class="ability-box">
                  <div class="ability-label">CHA</div>
                  <div class="ability-value" id="chaValue">${cha}</div>
                  <div class="ability-modifier" id="chaModifierValue">${chaMod >= 0 ? '+' : ''}${chaMod}</div>
                </div>
              </div>
            </div>
          </div>

          <div class="moves-list-container">
            <h3>Moves</h3>
            <div class="moves-grid" id="movesGrid">
              ${moves.length > 0 ? moves.map(move => `<div class="move-item" data-move="${move}">${move}</div>`).join('') : '<div class="no-moves">No moves learned</div>'}
            </div>
          </div>
        </div>
      </div>

      <!-- Navigation Arrows -->
      <button id="nextPage" class="arrow-button">&#x2192;</button>
      <button id="prevPage" class="arrow-button">&#x2190;</button>

      <!-- Ability Popup -->
      <div id="abilityPopup" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; justify-content: center; align-items: center;">
        <div style="background: white; border-radius: 1.3vh; padding: 2.6vh; max-width: 65vh; width: 90%; max-height: 80vh; overflow-y: auto;">
          <h2 id="abilityPopupTitle" style="margin-top: 0; color: #333; font-size: clamp(1.4rem, 2.4vh, 2.4vh);">Ability</h2>
          <div id="abilityPopupContent" style="font-size: clamp(0.9rem, 1.5vh, 1.5vh); line-height: 1.6; color: black;"></div>
          <button id="closeAbilityPopup" style="margin-top: 2vh; padding: 1.3vh 2.6vh; background: #f44336; color: white; border: none; border-radius: 0.6vh; cursor: pointer; font-size: clamp(0.8rem, 1.3vh, 1.3vh);">Close</button>
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

  // Back button
  document.getElementById('backToTrainerCard')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('navigate', {
      detail: { route: 'trainer-card' }
    }));
  });

  // Page toggle function
  function togglePage() {
    const infoPage = document.getElementById('infoPage');
    const battlePage = document.getElementById('battlePage');
    const battlePageButton = document.getElementById('battlePageButton');

    if (infoPage.classList.contains('active-page')) {
      // Switch to battle page
      infoPage.classList.remove('active-page');
      infoPage.classList.add('hidden-page');
      battlePage.classList.remove('hidden-page');
      battlePage.classList.add('active-page');
      if (battlePageButton) {
        battlePageButton.textContent = 'Info Page';
      }
    } else {
      // Switch to info page
      battlePage.classList.remove('active-page');
      battlePage.classList.add('hidden-page');
      infoPage.classList.remove('hidden-page');
      infoPage.classList.add('active-page');
      if (battlePageButton) {
        battlePageButton.textContent = 'Battle Page';
      }
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

  // Pokemon image click - prompt for evolution
  document.getElementById('pokemonImage')?.addEventListener('click', () => {
    const confirmEvolution = confirm(`Would you like to evolve ${pokemonName}?`);
    if (confirmEvolution) {
      window.dispatchEvent(new CustomEvent('navigate', {
        detail: { route: 'evolution' }
      }));
    }
  });

  // Battle Page button
  document.getElementById('battlePageButton')?.addEventListener('click', togglePage);

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

  // Load move colors and click listeners
  loadMoveColorsAndListeners();
}

// Helper function to get Pokemon type color
function getMoveTypeColor(moveType) {
  const colors = {
    "Normal": "#A8A878",
    "Fighting": "#e68c2e",
    "Flying": "#A890F0",
    "Poison": "#A040A0",
    "Ground": "#DEB887",
    "Rock": "#a85d16",
    "Bug": "#A8B820",
    "Ghost": "#705898",
    "Steel": "#bdbdbd",
    "Fire": "#f02e07",
    "Water": "#1E90FF",
    "Grass": "#32CD32",
    "Electric": "#FFD700",
    "Psychic": "#F85888",
    "Ice": "#58c8ed",
    "Dragon": "#280dd4",
    "Dark": "#282729",
    "Fairy": "#ed919f",
    "Cosmic": "#120077"
  };

  return colors[moveType] || "#ffffff";
}

// Helper function to determine text color based on background
function getTextColorForBackground(bgColor) {
  // Convert hex to RGB
  const hex = bgColor.replace('#', '');
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);

  // Calculate luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  // Return black for light backgrounds, white for dark
  return luminance > 0.5 ? '#000000' : '#ffffff';
}

// Load moves data and apply colors and click listeners
function loadMoveColorsAndListeners() {
  const rawMovesData = sessionStorage.getItem('moves');
  if (!rawMovesData) return;

  try {
    const cleanMovesData = JSON.parse(rawMovesData.replace(/\\"/g, '"').replace(/\\r/g, '').replace(/\\n/g, ''));
    window.allMoves = cleanMovesData.map(move => {
      return move.map(item => item.trim());
    });

    // Apply colors to move items
    const moveItems = document.querySelectorAll('.move-item');
    moveItems.forEach(moveItem => {
      const moveName = moveItem.dataset.move;
      const move = window.allMoves.find(m => m[0] === moveName);

      if (move) {
        const bgColor = getMoveTypeColor(move[1]);
        const textColor = getTextColorForBackground(bgColor);
        moveItem.style.backgroundColor = bgColor;
        moveItem.style.color = textColor;

        // Add click listener
        moveItem.addEventListener('click', () => showMoveDetails(moveName));
      }
    });
  } catch (e) {
    console.error('Failed to parse moves data:', e);
  }
}

// Show move details popup
function showMoveDetails(moveName) {
  const move = window.allMoves.find(m => m[0] === moveName);

  if (move) {
    // Create popup if it doesn't exist
    let popup = document.getElementById('moveDetailsPopup');
    if (!popup) {
      popup = document.createElement('div');
      popup.id = 'moveDetailsPopup';
      popup.style.cssText = 'display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; justify-content: center; align-items: center;';

      const popupContent = document.createElement('div');
      popupContent.style.cssText = 'background: white; border-radius: 1.3vh; padding: 2.6vh; max-width: 65vh; width: 90%; max-height: 80vh; overflow-y: auto;';

      popupContent.innerHTML = `
        <h2 id="moveNamePopup" style="margin-top: 0; color: #333; font-size: clamp(1.4rem, 2.4vh, 2.4vh);"></h2>
        <div style="font-size: clamp(0.9rem, 1.5vh, 1.5vh); line-height: 1.6; color: black;">
          <p><strong>Type:</strong> <span id="moveTypePopup"></span></p>
          <p><strong>Modifier:</strong> <span id="moveModifierPopup"></span></p>
          <p><strong>Action Type:</strong> <span id="moveActionTypePopup"></span></p>
          <p><strong>VP Cost:</strong> <span id="moveVPCostPopup"></span></p>
          <p><strong>Duration:</strong> <span id="moveDurationPopup"></span></p>
          <p><strong>Range:</strong> <span id="moveRangePopup"></span></p>
          <p><strong>Description:</strong> <span id="moveDescriptionPopup"></span></p>
          <p><strong>Higher Levels:</strong> <span id="moveHigherLevelsPopup"></span></p>
        </div>
        <button id="closeMovePopup" style="margin-top: 2vh; padding: 1.3vh 2.6vh; background: #f44336; color: white; border: none; border-radius: 0.6vh; cursor: pointer; font-size: clamp(0.8rem, 1.3vh, 1.3vh);">Close</button>
      `;

      popup.appendChild(popupContent);
      document.body.appendChild(popup);

      // Close button listener
      document.getElementById('closeMovePopup').addEventListener('click', () => {
        popup.style.display = 'none';
      });

      // Close when clicking outside
      popup.addEventListener('click', (e) => {
        if (e.target.id === 'moveDetailsPopup') {
          popup.style.display = 'none';
        }
      });
    }

    // Populate move details
    document.getElementById('moveNamePopup').textContent = move[0];
    document.getElementById('moveTypePopup').textContent = move[1];
    document.getElementById('moveModifierPopup').textContent = move[2];
    document.getElementById('moveActionTypePopup').textContent = move[3];
    document.getElementById('moveVPCostPopup').textContent = move[4];
    document.getElementById('moveDurationPopup').textContent = move[5];
    document.getElementById('moveRangePopup').textContent = move[6];
    document.getElementById('moveDescriptionPopup').textContent = move[7];
    document.getElementById('moveHigherLevelsPopup').textContent = move[8];

    // Apply type color to popup
    const bgColor = getMoveTypeColor(move[1]);
    const textColor = getTextColorForBackground(bgColor);
    popup.querySelector('div').style.backgroundColor = bgColor;
    popup.querySelector('div').style.color = textColor;

    popup.style.display = 'flex';
  }
}
