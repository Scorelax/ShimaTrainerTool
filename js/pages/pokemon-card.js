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
  const ac = pokemonData[8] || 10;
  const hd = pokemonData[9] || 0;
  const hp = pokemonData[10] || 0;
  const vd = pokemonData[11] || 0;
  const vp = pokemonData[12] || 0;
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

  // Parse nature to identify boosted/nerfed stats
  let boostedStat = '';
  let nerfedStat = '';
  if (nature) {
    // Extract stat names from nature string - multiple formats:
    // "Adamant (+ATK, -SPATK)" or "Adamant (Atk+, SpA-)" or "(+ATK, -SPATK)"
    const boostMatch = nature.match(/\+\s*(\w+)|(\w+)\s*\+/i);
    const nerfMatch = nature.match(/-\s*(\w+)|(\w+)\s*-/i);

    if (boostMatch) {
      let stat = (boostMatch[1] || boostMatch[2] || '').toLowerCase();
      // Map stat abbreviations to D&D stats
      stat = stat.replace(/^atk$/i, 'str').replace(/^spa$/i, 'int').replace(/^spd$/i, 'wis')
                 .replace(/^spatk$/i, 'int').replace(/^spdef$/i, 'wis').replace(/^def$/i, 'con');
      boostedStat = stat;
    }

    if (nerfMatch) {
      let stat = (nerfMatch[1] || nerfMatch[2] || '').toLowerCase();
      // Map stat abbreviations to D&D stats
      stat = stat.replace(/^atk$/i, 'str').replace(/^spa$/i, 'int').replace(/^spd$/i, 'wis')
                 .replace(/^spatk$/i, 'int').replace(/^spdef$/i, 'wis').replace(/^def$/i, 'con');
      nerfedStat = stat;
    }
  }
  const stabBonus = pokemonData[34] || 2;
  const heldItem = pokemonData[35] || 'None';

  // Helper function to get stat color based on nature
  const getStatColor = (statName) => {
    const normalizedStatName = statName.toLowerCase();
    if (boostedStat && normalizedStatName === boostedStat) return '#EE1515'; // Red for boosted
    if (nerfedStat && normalizedStatName === nerfedStat) return '#3B4CCA'; // Blue for nerfed
    return 'black'; // Default color
  };
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
    .join('\n') || `Walking: ${speed} ft`;

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

  const displayName = name; // Just use the Pokemon name, not nickname
  const typingText = type2 ? `${type1} - ${type2}` : type1;

  // Create typing buttons with colors
  const createTypeButton = (typeValue) => {
    const bgColor = getMoveTypeColor(typeValue);
    const textColor = getTextColorForBackground(bgColor);
    return `<span style="display: inline-block; background-color: ${bgColor}; color: ${textColor}; padding: 0.3vh 1vh; border-radius: 0.5vh; font-size: clamp(0.7rem, 1.5vw, 0.85rem); font-weight: bold; margin: 0 0.2rem;">${typeValue}</span>`;
  };
  const typingButtons = type2 ? `${createTypeButton(type1)}${createTypeButton(type2)}` : createTypeButton(type1);

  // Format saving throws - replace newlines with commas
  const savingThrowFormatted = savingThrow.replace(/\n/g, ', ');

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
        `<button class="ability-button" data-ability-index="${index}" style="background-color: white; color: black; border: 2px solid #333; border-radius: 0.6vh; padding: 0.8vh 1.5vh; font-size: clamp(0.75rem, 1.5vw, 0.9rem); cursor: pointer; margin: 0 0.3vh; font-weight: bold; vertical-align: middle;">${ability.name}</button>`
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

        /* Info Page Grid Layout - matches trainer-info EXACTLY */
        .info-page-grid {
          display: grid;
          grid-template-columns: 27% 1fr;
          gap: clamp(2rem, 4vw, 4rem);
          grid-column: 1 / -1;
        }

        /* Battle Page Grid Layout - matches trainer-info EXACTLY */
        .battle-page-grid {
          display: grid;
          grid-template-columns: 27% 1fr;
          gap: clamp(2rem, 4vw, 4rem);
          grid-column: 1 / -1;
        }

        .left-column {
          display: flex;
          flex-direction: column;
          gap: clamp(1rem, 2vh, 1.5rem);
          padding-top: clamp(4rem, 8vh, 5rem);
        }

        .pokemon-image-container {
          width: 100%;
          aspect-ratio: 1;
          cursor: pointer;
          position: relative;
          border-radius: clamp(15px, 3vw, 20px);
          overflow: hidden;
          border: clamp(3px, 0.6vw, 5px) solid #FFDE00;
          box-shadow: 0 clamp(8px, 2vh, 10px) clamp(25px, 5vw, 30px) rgba(0,0,0,0.5),
                      0 0 clamp(20px, 4vw, 30px) rgba(255,222,0,0.3);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .pokemon-image-container:hover {
          transform: translateY(-3px);
          box-shadow: 0 clamp(12px, 3vh, 15px) clamp(30px, 6vw, 35px) rgba(0,0,0,0.6),
                      0 0 clamp(25px, 5vw, 35px) rgba(255,222,0,0.5);
          border-color: #FFC700;
        }

        .pokemon-image-container img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .pokemon-info-list,
        .trainer-info-list {
          display: flex;
          flex-direction: column;
          gap: clamp(0.5rem, 1vh, 0.75rem);
        }

        .info-item {
          display: flex;
          justify-content: flex-start;
          align-items: center;
          gap: clamp(0.5rem, 1vw, 0.75rem);
          padding: clamp(0.4rem, 1vh, 0.6rem) clamp(0.6rem, 1.5vw, 1rem);
          background: linear-gradient(135deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.08) 100%);
          border: clamp(2px, 0.4vw, 3px) solid rgba(255,222,0,0.4);
          border-radius: clamp(8px, 1.5vw, 12px);
          font-size: clamp(0.75rem, 1.6vw, 0.9rem);
          font-weight: 700;
          color: white;
          text-shadow: 0 2px 4px rgba(0,0,0,0.6);
        }

        .info-item-label {
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: clamp(0.3px, 0.2vw, 0.5px);
          flex-shrink: 0;
          font-size: clamp(0.75rem, 1.6vw, 0.9rem);
        }

        .info-item-value {
          text-align: left;
          word-wrap: break-word;
          overflow-wrap: break-word;
          white-space: pre-line;
          font-size: clamp(0.75rem, 1.6vw, 0.9rem);
        }

        .info-item-double {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: clamp(0.5rem, 1vh, 0.75rem);
        }

        .info-item-half {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: clamp(0.3rem, 0.8vw, 0.5rem);
          padding: clamp(0.4rem, 1vh, 0.6rem) clamp(0.6rem, 1.5vw, 1rem);
          background: linear-gradient(135deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.08) 100%);
          border: clamp(2px, 0.4vw, 3px) solid rgba(255,222,0,0.4);
          border-radius: clamp(8px, 1.5vw, 12px);
          font-size: clamp(0.75rem, 1.6vw, 0.9rem);
          font-weight: 700;
          color: white;
          text-shadow: 0 2px 4px rgba(0,0,0,0.6);
        }

        .info-item-half .info-item-label {
          font-size: clamp(0.75rem, 1.6vw, 0.9rem);
        }

        .info-item-half span:not(.info-item-label) {
          font-size: clamp(0.75rem, 1.6vw, 0.9rem);
        }

        .info-item-column {
          display: flex;
          flex-direction: column;
          gap: clamp(0.25rem, 0.5vh, 0.4rem);
          padding: clamp(0.4rem, 1vh, 0.6rem) clamp(0.4rem, 1vw, 0.6rem);
          background: linear-gradient(135deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.08) 100%);
          border: clamp(2px, 0.4vw, 3px) solid rgba(255,222,0,0.4);
          border-radius: clamp(8px, 1.5vw, 12px);
          font-weight: 700;
          color: white;
          text-shadow: 0 2px 4px rgba(0,0,0,0.6);
        }

        .info-item-column .info-item-label {
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: clamp(0.3px, 0.2vw, 0.5px);
          font-size: clamp(0.75rem, 1.6vw, 0.9rem);
        }

        .info-item-column .info-item-value {
          text-align: left;
          font-size: clamp(0.75rem, 1.6vw, 0.9rem);
          white-space: pre-line;
          word-break: normal;
          overflow-wrap: break-word;
          line-height: 1.6;
          width: 100%;
        }

        .checkbox-container {
          display: flex;
          flex-direction: row;
          gap: clamp(1rem, 2vw, 1.5rem);
        }

        .checkbox-container label {
          display: flex;
          align-items: center;
          gap: clamp(0.4rem, 0.8vw, 0.6rem);
          color: white;
          font-weight: 700;
          font-size: clamp(0.85rem, 1.8vw, 1rem);
          cursor: pointer;
          text-shadow: 0 2px 4px rgba(0,0,0,0.6);
        }

        .checkbox-container input[type="checkbox"] {
          width: clamp(32px, 6vw, 40px);
          height: clamp(32px, 6vw, 40px);
          cursor: pointer;
        }

        .info-buttons-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: clamp(0.5rem, 1vh, 0.75rem);
        }

        .info-button {
          padding: clamp(0.6rem, 1.5vh, 0.9rem) clamp(0.7rem, 1.5vw, 1rem);
          background: linear-gradient(135deg, #3B4CCA 0%, #2E3FA0 100%);
          border: clamp(2px, 0.4vw, 3px) solid #FFDE00;
          border-radius: clamp(8px, 1.5vw, 12px);
          color: white;
          font-size: clamp(0.75rem, 1.5vw, 0.9rem);
          white-space: nowrap;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: clamp(0.2px, 0.15vw, 0.4px);
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 4px 10px rgba(0,0,0,0.3);
          text-shadow: 0 2px 4px rgba(0,0,0,0.4);
        }

        .info-button:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 15px rgba(0,0,0,0.4),
                      0 0 15px rgba(255,222,0,0.4);
          border-color: #FFC700;
        }

        .info-button:active {
          transform: translateY(0);
        }

        .right-column {
          display: flex;
          flex-direction: column;
          gap: clamp(0.75rem, 1.5vh, 1rem);
          padding-top: clamp(4rem, 8vh, 5rem);
        }

        .description-container {
          width: 100%;
        }

        .description-container h3 {
          margin-bottom: clamp(0.75rem, 2vh, 1rem);
          color: white;
          text-shadow: 0 2px 5px rgba(0,0,0,0.8);
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: clamp(0.5px, 0.4vw, 1px);
          font-size: clamp(1.2rem, 2.5vw, 1.6rem);
          text-align: center;
        }

        .description-text {
          padding: clamp(0.75rem, 1.5vh, 1rem);
          background: linear-gradient(135deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.08) 100%);
          border: clamp(2px, 0.4vw, 3px) solid rgba(255,222,0,0.4);
          border-radius: clamp(8px, 1.5vw, 12px);
          color: white;
          font-size: clamp(0.85rem, 1.8vw, 1rem);
          line-height: 1.5;
          font-weight: 600;
          text-shadow: 0 1px 3px rgba(0,0,0,0.6);
        }

        .skills-container {
          width: 100%;
          margin-top: clamp(1rem, 2vh, 1.5rem);
        }

        .skills-container h3 {
          margin-bottom: clamp(0.75rem, 2vh, 1rem);
          margin-top: 0;
          color: white;
          text-shadow: 0 2px 5px rgba(0,0,0,0.8);
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: clamp(0.5px, 0.4vw, 1px);
          font-size: clamp(1.2rem, 2.5vw, 1.6rem);
          text-align: center;
        }

        .skills-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: clamp(0.4rem, 1.2vw, 0.6rem);
          padding: clamp(0.5rem, 1.5vw, 0.8rem);
          border-radius: clamp(10px, 2vw, 15px);
          background: linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 100%);
        }

        .skill-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: clamp(0.35rem, 0.8vh, 0.5rem);
          border: clamp(2px, 0.3vw, 2.5px) solid #333;
          border-radius: clamp(7px, 1.3vw, 10px);
          text-align: center;
          background: linear-gradient(135deg, rgba(100,100,100,0.4) 0%, rgba(80,80,80,0.4) 100%);
          font-size: clamp(0.65rem, 1.3vw, 0.75rem);
          font-weight: 700;
          color: rgba(255,255,255,0.5);
          box-shadow: 0 3px 8px rgba(0,0,0,0.3);
          transition: all 0.3s ease;
        }

        .skill-item.unlocked {
          background: linear-gradient(135deg, #FFDE00 0%, #FFC700 100%);
          color: black;
          border-color: #333;
          box-shadow: 0 6px 15px rgba(0,0,0,0.4),
                      0 0 10px rgba(255,222,0,0.5);
        }

        .skill-name {
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: clamp(0.15px, 0.12vw, 0.3px);
          font-size: clamp(0.65rem, 1.3vw, 0.75rem);
        }

        .skill-modifier {
          font-size: clamp(0.6rem, 1.2vw, 0.7rem);
          opacity: 0.8;
          margin-top: clamp(1.5px, 0.25vh, 2.5px);
        }

        /* Stats Row 1: AC, HP, VP - Medium boxes */
        .stat-main-container {
          display: grid;
          grid-template-columns: repeat(6, 1fr);
          gap: clamp(0.6rem, 2vw, 1rem);
          margin-bottom: clamp(0.5rem, 1vh, 0.75rem);
        }

        .stat-box-wrapper {
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .stat-box-wrapper:nth-child(1) {
          grid-column: 1 / 3;
        }

        .stat-box-wrapper:nth-child(2) {
          grid-column: 3 / 5;
        }

        .stat-box-wrapper:nth-child(3) {
          grid-column: 5 / 7;
        }

        .stat-label-box {
          font-weight: 900;
          color: white;
          font-size: clamp(0.8rem, 1.8vw, 1rem);
          margin-bottom: clamp(0.3rem, 0.8vh, 0.4rem);
          text-shadow: 0 2px 5px rgba(0,0,0,0.8);
          text-transform: uppercase;
          letter-spacing: clamp(0.3px, 0.3vw, 1px);
        }

        .stat-box {
          display: flex;
          align-items: center;
          justify-content: center;
          width: clamp(50px, 9vw, 70px);
          height: clamp(50px, 9vw, 70px);
          background: linear-gradient(135deg, #FFDE00 0%, #FFC700 100%);
          color: black;
          border-radius: clamp(10px, 2vw, 15px);
          border: clamp(2px, 0.5vw, 4px) solid #333;
          font-size: clamp(1.4rem, 2.8vw, 2rem);
          font-weight: 900;
          box-shadow: 0 8px 20px rgba(0,0,0,0.5),
                      inset 0 -3px 0 rgba(0,0,0,0.2);
        }

        .current-stat-box {
          display: flex;
          align-items: center;
          justify-content: center;
          width: clamp(45px, 7vw, 60px);
          height: clamp(45px, 7vw, 60px);
          background: linear-gradient(135deg, #3B4CCA 0%, #2E3FA0 100%);
          color: white;
          border-radius: clamp(8px, 1.8vw, 12px);
          border: clamp(2px, 0.4vw, 3px) solid #333;
          font-size: clamp(1.2rem, 2.5vw, 1.6rem);
          font-weight: 900;
          box-shadow: 0 6px 15px rgba(0,0,0,0.5),
                      inset 0 -2px 0 rgba(0,0,0,0.3);
          margin-top: clamp(-8px, -1vh, -10px);
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .current-stat-box:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 20px rgba(0,0,0,0.6),
                      0 0 15px rgba(59,76,202,0.5);
        }

        .current-stat-box:active {
          transform: translateY(0);
        }

        /* Stats Row 2: STR, DEX, CON, INT, WIS, CHA */
        .ability-container {
          display: grid;
          grid-template-columns: repeat(6, 1fr);
          gap: clamp(0.6rem, 2vw, 1rem);
          margin-bottom: clamp(0.5rem, 1.2vh, 0.75rem);
        }

        .ability-group {
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .ability-label {
          font-weight: 900;
          font-size: clamp(0.75rem, 1.6vw, 0.95rem);
          margin-bottom: clamp(0.25rem, 0.8vh, 0.4rem);
          color: white;
          text-shadow: 0 2px 5px rgba(0,0,0,0.8);
          text-transform: uppercase;
          letter-spacing: clamp(0.2px, 0.25vw, 0.6px);
        }

        .ability-box {
          display: flex;
          align-items: center;
          justify-content: center;
          width: clamp(45px, 8vw, 60px);
          height: clamp(45px, 8vw, 60px);
          background: linear-gradient(135deg, #FFDE00 0%, #FFC700 100%);
          color: black;
          border-radius: clamp(8px, 1.8vw, 12px);
          border: clamp(2px, 0.4vw, 3px) solid #333;
          font-size: clamp(1.2rem, 2.5vw, 1.7rem);
          font-weight: 900;
          box-shadow: 0 8px 20px rgba(0,0,0,0.5),
                      inset 0 -3px 0 rgba(0,0,0,0.2);
        }

        .modifier-box {
          display: flex;
          align-items: center;
          justify-content: center;
          width: clamp(38px, 6.5vw, 50px);
          height: clamp(38px, 6.5vw, 50px);
          background: linear-gradient(135deg, #EE1515 0%, #C91010 100%);
          color: white;
          border-radius: clamp(7px, 1.4vw, 10px);
          border: clamp(2px, 0.4vw, 3px) solid #333;
          font-size: clamp(1rem, 2vw, 1.4rem);
          font-weight: 900;
          box-shadow: 0 6px 15px rgba(0,0,0,0.5),
                      inset 0 -2px 0 rgba(0,0,0,0.3);
          margin-top: clamp(-8px, -1vh, -10px);
        }

        .battle-stats-container h3 {
          margin-bottom: clamp(0.75rem, 2vh, 1rem);
          color: white;
          text-shadow: 0 2px 5px rgba(0,0,0,0.8);
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: clamp(0.5px, 0.4vw, 1px);
          font-size: clamp(1.2rem, 2.5vw, 1.6rem);
          text-align: center;
        }

        .moves-list-container h3 {
          margin-bottom: clamp(0.75rem, 2vh, 1rem);
          color: white;
          text-shadow: 0 2px 5px rgba(0,0,0,0.8);
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: clamp(0.5px, 0.4vw, 1px);
          font-size: clamp(1.2rem, 2.5vw, 1.6rem);
          text-align: center;
        }

        .moves-grid {
          display: flex;
          flex-wrap: wrap;
          gap: clamp(0.4rem, 1vw, 0.6rem);
          margin-top: clamp(1rem, 2vh, 1.5rem);
        }

        .move-item {
          background: rgba(255,255,255,0.9);
          color: #333;
          padding: clamp(0.5rem, 1vh, 0.75rem) clamp(0.75rem, 1.5vw, 1rem);
          border-radius: clamp(8px, 1.5vw, 12px);
          text-align: center;
          font-weight: 700;
          white-space: nowrap;
          width: auto;
          font-size: clamp(0.75rem, 1.5vw, 0.9rem);
          cursor: pointer;
          transition: all 0.3s;
          border: 2px solid rgba(0,0,0,0.2);
          box-shadow: 0 3px 8px rgba(0,0,0,0.3);
        }

        .move-item:hover {
          transform: translateY(-2px);
          box-shadow: 0 5px 12px rgba(0,0,0,0.4);
        }

        .no-moves {
          grid-column: 1 / -1;
          text-align: center;
          color: rgba(255,255,255,0.6);
          font-style: italic;
          padding: clamp(1rem, 2vh, 1.5rem);
        }

        /* Back button - matches trainer-card style */
        .back-button {
          position: fixed;
          top: clamp(15px, 3vh, 20px);
          left: clamp(15px, 3vw, 20px);
          background: linear-gradient(135deg, #FFFFFF 0%, #F5F5F5 100%);
          color: #333;
          width: clamp(45px, 9vw, 55px);
          height: clamp(45px, 9vw, 55px);
          border: clamp(3px, 0.6vw, 4px) solid #FFDE00;
          border-radius: 50%;
          font-size: clamp(1.5rem, 3.5vw, 2rem);
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
          transform: scale(1.15);
          box-shadow: 0 12px 30px rgba(0,0,0,0.4),
                      0 0 25px rgba(255,222,0,0.6);
          border-color: #FFC700;
        }

        .back-button:active {
          transform: scale(1.08);
        }

        /* Navigation Arrows - Hidden */
        .arrow-button {
          display: none;
        }

        /* Mobile Responsive */
        /* Large tablet - wider left column */
        @media (max-width: 1024px) {
          .pokemon-card-page,
          .info-page-grid,
          .battle-page-grid {
            grid-template-columns: minmax(30%, 35%) 1fr;
            gap: clamp(1.5rem, 3vw, 2.5rem);
          }

          .ability-container {
            grid-template-columns: repeat(3, 1fr);
          }

          .skills-grid {
            grid-template-columns: repeat(auto-fit, minmax(clamp(120px, 18vw, 180px), 1fr));
          }
        }

        /* Tablet Portrait - even wider left column */
        @media (max-width: 768px) {
          .pokemon-card-page,
          .info-page-grid,
          .battle-page-grid {
            grid-template-columns: minmax(35%, 40%) 1fr;
            gap: clamp(1rem, 2.5vw, 2rem);
            padding: clamp(1rem, 2vh, 1.5rem) clamp(0.75rem, 1.5vw, 1.5rem);
          }

          .ability-container {
            grid-template-columns: repeat(3, 1fr);
          }

          .skills-grid {
            grid-template-columns: repeat(3, 1fr);
          }
        }

        /* Mobile phones - maintain 2 columns with larger left side */
        @media (max-width: 600px) {
          .pokemon-card-page,
          .info-page-grid,
          .battle-page-grid {
            grid-template-columns: minmax(40%, 45%) 1fr;
            gap: clamp(0.75rem, 2vw, 1.5rem);
            padding: clamp(1rem, 2vh, 1.5rem) clamp(0.5rem, 1vw, 1rem);
          }

          .ability-container {
            grid-template-columns: repeat(3, 1fr);
            gap: clamp(0.4rem, 1.5vw, 0.75rem);
          }

          .skills-grid {
            grid-template-columns: repeat(3, 1fr);
            gap: clamp(0.4rem, 1.2vw, 0.6rem);
          }

          .info-item {
            font-size: clamp(0.8rem, 1.8vw, 1rem);
            padding: clamp(0.3rem, 0.8vh, 0.5rem) clamp(0.5rem, 1.2vw, 0.8rem);
          }

          .info-button {
            font-size: clamp(0.75rem, 1.6vw, 0.9rem);
            padding: clamp(0.5rem, 1.2vh, 0.7rem) clamp(0.6rem, 1.5vw, 0.9rem);
          }
        }

        /* Small mobile phones - compact 2 columns */
        @media (max-width: 480px) {
          .pokemon-card-page,
          .info-page-grid,
          .battle-page-grid {
            grid-template-columns: minmax(42%, 48%) 1fr;
            gap: clamp(0.5rem, 1.5vw, 1rem);
            padding: clamp(0.75rem, 1.5vh, 1.25rem) clamp(0.4rem, 0.8vw, 0.75rem);
          }

          .ability-container {
            grid-template-columns: repeat(2, 1fr);
            gap: clamp(0.3rem, 1vw, 0.5rem);
          }

          .skills-grid {
            grid-template-columns: repeat(2, 1fr);
            gap: clamp(0.3rem, 1vw, 0.5rem);
          }

          .info-buttons-grid {
            grid-template-columns: 1fr;
            gap: clamp(0.4rem, 1vh, 0.6rem);
          }

          .stat-main-container {
            gap: clamp(0.5rem, 2vw, 1rem);
          }
        }

        /* Very small screens - single column fallback */
        @media (max-width: 360px) {
          .pokemon-card-page,
          .info-page-grid,
          .battle-page-grid {
            grid-template-columns: 1fr;
            gap: clamp(0.75rem, 2vh, 1rem);
          }

          .left-column {
            padding-top: clamp(5rem, 10vh, 6rem);
          }

          .right-column {
            padding-top: 0;
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

          <div class="trainer-info-list">
            <div class="info-item">
              <span class="info-item-label">Level:</span>
              <span class="info-item-value" id="pokemonLevel">${level}</span>
            </div>
            <div class="info-item">
              <span class="info-item-label">Typing:</span>
              <span class="info-item-value" id="pokemonTyping">${typingButtons}</span>
            </div>
            <div class="info-item">
              <span class="info-item-label">Saving Throw(s):</span>
              <span class="info-item-value" id="pokemonSavingThrow">${savingThrowFormatted}</span>
            </div>
            ${sensesArray.length > 0 ? `
              <div class="info-item-column">
                <span class="info-item-label">Senses:</span>
                <span class="info-item-value" id="sensesValue">${sensesDisplay}</span>
              </div>
            ` : ''}
          </div>

          <div class="info-buttons-grid">
            <button class="info-button" id="editPokemonButton">Edit Pokémon</button>
            <button class="info-button" id="battlePageButton">Battle Page</button>
          </div>
        </div>

        <!-- Right Column: Description + Checkboxes + Skills -->
        <div class="right-column">
          ${flavorText ? `
            <p id="flavorText" class="description-text">${flavorText}</p>
          ` : ''}

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

          <div class="skills-container">
            <h3>Skills</h3>
            <div id="skills" class="skills-grid">
              ${allSkills.map(skill => {
                const skillKey = skill.name.toLowerCase();
                const proficiencyLevel = skillCounts[skillKey] || 0;
                const skillClass = proficiencyLevel >= 1 ? 'unlocked' : '';

                return `
                  <div class="skill-item ${skillClass}">
                    <div class="skill-name">${skill.name}</div>
                    <div class="skill-modifier">(${skill.stat})</div>
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

          <div class="trainer-info-list">
            <div class="info-item-double">
              <div class="info-item-half">
                <span class="info-item-label">HD:</span>
                <span id="hdValue">${hd}</span>
              </div>
              <div class="info-item-half">
                <span class="info-item-label">VD:</span>
                <span id="vdValue">${vd}</span>
              </div>
            </div>
            <div class="info-item-double">
              <div class="info-item-half">
                <span class="info-item-label">STAB:</span>
                <span id="stabValue">${stabBonus}</span>
              </div>
              <div class="info-item-half">
                <span class="info-item-label">Proficiency:</span>
                <span id="proficiencyValue">${proficiencyBonus}</span>
              </div>
            </div>
            <div class="info-item-double">
              <div class="info-item-half">
                <span class="info-item-label">Initiative:</span>
                <span id="initiativeValue">${initiative}</span>
              </div>
              <div class="info-item-half">
                <span class="info-item-label">Loyalty:</span>
                <span id="loyaltyValue">${loyalty}</span>
              </div>
            </div>
            <div class="info-item">
              <span class="info-item-label">Ability:</span>
              <span class="info-item-value" id="abilityEffect">${abilityButtonsHTML}</span>
            </div>
            <div class="info-item">
              <span class="info-item-label">Held Item:</span>
              <span class="info-item-value">
                ${heldItem !== 'None' ? `<button class="held-item-button" style="background-color: white; color: black; border: 2px solid #333; border-radius: 0.6vh; padding: 0.8vh 1.5vh; font-size: clamp(0.75rem, 1.5vw, 0.9rem); cursor: pointer; margin: 0 0.3vh; font-weight: bold; vertical-align: middle;">${heldItem}</button>` : 'None'}
              </span>
            </div>
            <div class="info-item-column">
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
          <!-- Row 1: AC, HP, VP -->
          <div class="stat-main-container">
            <div class="stat-box-wrapper">
              <div class="stat-label-box">AC</div>
              <div class="stat-box" id="acValue">${ac}</div>
            </div>
            <div class="stat-box-wrapper">
              <div class="stat-label-box">HP</div>
              <div class="stat-box" id="hpValue">${hp}</div>
              <div class="current-stat-box" id="currentHpValue">${hp}</div>
            </div>
            <div class="stat-box-wrapper">
              <div class="stat-label-box">VP</div>
              <div class="stat-box" id="vpValue">${vp}</div>
              <div class="current-stat-box" id="currentVpValue">${vp}</div>
            </div>
          </div>

          <!-- Row 2: STR, DEX, CON, INT, WIS, CHA with modifiers -->
          <div class="ability-container">
            <div class="ability-group">
              <div class="ability-label">STR</div>
              <div class="ability-box" id="strValue" style="color: ${getStatColor('str')}">${str}</div>
              <div class="modifier-box" id="strModifierValue">${strMod >= 0 ? '+' : ''}${strMod}</div>
            </div>
            <div class="ability-group">
              <div class="ability-label">DEX</div>
              <div class="ability-box" id="dexValue" style="color: ${getStatColor('dex')}">${dex}</div>
              <div class="modifier-box" id="dexModifierValue">${dexMod >= 0 ? '+' : ''}${dexMod}</div>
            </div>
            <div class="ability-group">
              <div class="ability-label">CON</div>
              <div class="ability-box" id="conValue" style="color: ${getStatColor('con')}">${con}</div>
              <div class="modifier-box" id="conModifierValue">${conMod >= 0 ? '+' : ''}${conMod}</div>
            </div>
            <div class="ability-group">
              <div class="ability-label">INT</div>
              <div class="ability-box" id="intValue" style="color: ${getStatColor('int')}">${int}</div>
              <div class="modifier-box" id="intModifierValue">${intMod >= 0 ? '+' : ''}${intMod}</div>
            </div>
            <div class="ability-group">
              <div class="ability-label">WIS</div>
              <div class="ability-box" id="wisValue" style="color: ${getStatColor('wis')}">${wis}</div>
              <div class="modifier-box" id="wisModifierValue">${wisMod >= 0 ? '+' : ''}${wisMod}</div>
            </div>
            <div class="ability-group">
              <div class="ability-label">CHA</div>
              <div class="ability-box" id="chaValue" style="color: ${getStatColor('cha')}">${cha}</div>
              <div class="modifier-box" id="chaModifierValue">${chaMod >= 0 ? '+' : ''}${chaMod}</div>
            </div>
          </div>

          <div class="moves-grid" id="movesGrid">
            ${moves.length > 0 ? moves.map(move => `<div class="move-item" data-move="${move}">${move}</div>`).join('') : '<div class="no-moves">No moves learned</div>'}
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

      <!-- Held Item Popup -->
      <div id="heldItemPopup" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; justify-content: center; align-items: center;">
        <div style="background: white; border-radius: 1.3vh; padding: 2.6vh; max-width: 65vh; width: 90%; max-height: 80vh; overflow-y: auto;">
          <h2 style="margin-top: 0; color: #333; font-size: clamp(1.4rem, 2.4vh, 2.4vh);">Held Item</h2>
          <div style="font-size: clamp(0.9rem, 1.5vh, 1.5vh); line-height: 1.6; color: black;">${heldItem}</div>
          <button id="closeHeldItemPopup" style="margin-top: 2vh; padding: 1.3vh 2.6vh; background: #f44336; color: white; border: none; border-radius: 0.6vh; cursor: pointer; font-size: clamp(0.8rem, 1.3vh, 1.3vh);">Close</button>
        </div>
      </div>

      <!-- Combat Tracker Popup -->
      <div id="combatTrackerPopup" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; justify-content: center; align-items: center;">
        <div style="background: white; border-radius: 1.3vh; padding: 2.6vh; max-width: 65vh; width: 90%;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2vh;">
            <h2 style="margin: 0; color: #333; font-size: clamp(1.4rem, 2.4vh, 2.4vh);">Combat Tracker</h2>
            <button id="closeCombatTracker" style="background: none; border: none; font-size: 2rem; cursor: pointer; color: #333;">×</button>
          </div>
          <div style="display: flex; gap: 2vh; margin-bottom: 2vh;">
            <div style="flex: 1;">
              <div style="font-weight: bold; margin-bottom: 1vh; color: #333;">HP</div>
              <div id="combatCurrentHP" style="font-size: 1.5rem; margin-bottom: 1vh; color: #333;">${hp} / ${hp}</div>
              <input type="number" id="hpChangeInput" placeholder="HP Amount" style="width: 100%; padding: 1vh; border: 2px solid #ddd; border-radius: 0.5vh;">
            </div>
            <div style="flex: 1;">
              <div style="font-weight: bold; margin-bottom: 1vh; color: #333;">VP</div>
              <div id="combatCurrentVP" style="font-size: 1.5rem; margin-bottom: 1vh; color: #333;">${vp} / ${vp}</div>
              <input type="number" id="vpChangeInput" placeholder="VP Amount" style="width: 100%; padding: 1vh; border: 2px solid #ddd; border-radius: 0.5vh;">
            </div>
          </div>
          <div style="display: flex; gap: 1vh;">
            <button id="addStats" style="flex: 1; padding: 1.5vh; background: #4CAF50; color: white; border: none; border-radius: 0.6vh; cursor: pointer; font-weight: bold;">➕ Add</button>
            <button id="removeStats" style="flex: 1; padding: 1.5vh; background: #f44336; color: white; border: none; border-radius: 0.6vh; cursor: pointer; font-weight: bold;">➖ Remove</button>
            <button id="fullRestore" style="flex: 1; padding: 1.5vh; background: #2196F3; color: white; border: none; border-radius: 0.6vh; cursor: pointer; font-weight: bold;">✨ Restore</button>
          </div>
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

  // Info Page button
  document.getElementById('infoPageButton')?.addEventListener('click', togglePage);

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

  // Held item button click listener
  document.querySelector('.held-item-button')?.addEventListener('click', () => {
    const heldItemPopup = document.getElementById('heldItemPopup');
    heldItemPopup.style.display = 'flex';
  });

  // Close held item popup
  document.getElementById('closeHeldItemPopup')?.addEventListener('click', () => {
    document.getElementById('heldItemPopup').style.display = 'none';
  });

  document.getElementById('heldItemPopup')?.addEventListener('click', (e) => {
    if (e.target.id === 'heldItemPopup') {
      document.getElementById('heldItemPopup').style.display = 'none';
    }
  });

  // Current HP/VP boxes click listeners - open combat tracker
  document.getElementById('currentHpValue')?.addEventListener('click', () => {
    document.getElementById('combatTrackerPopup').style.display = 'flex';
  });

  document.getElementById('currentVpValue')?.addEventListener('click', () => {
    document.getElementById('combatTrackerPopup').style.display = 'flex';
  });

  // Close combat tracker
  document.getElementById('closeCombatTracker')?.addEventListener('click', () => {
    document.getElementById('combatTrackerPopup').style.display = 'none';
  });

  document.getElementById('combatTrackerPopup')?.addEventListener('click', (e) => {
    if (e.target.id === 'combatTrackerPopup') {
      document.getElementById('combatTrackerPopup').style.display = 'none';
    }
  });

  // Combat tracker buttons
  document.getElementById('addStats')?.addEventListener('click', () => {
    const hpChange = parseInt(document.getElementById('hpChangeInput').value) || 0;
    const vpChange = parseInt(document.getElementById('vpChangeInput').value) || 0;

    const currentHpText = document.getElementById('combatCurrentHP').textContent;
    const currentVpText = document.getElementById('combatCurrentVP').textContent;
    const [currentHp, maxHp] = currentHpText.split(' / ').map(v => parseInt(v));
    const [currentVp, maxVp] = currentVpText.split(' / ').map(v => parseInt(v));

    const newHp = Math.min(currentHp + hpChange, maxHp);
    const newVp = Math.min(currentVp + vpChange, maxVp);

    document.getElementById('combatCurrentHP').textContent = `${newHp} / ${maxHp}`;
    document.getElementById('combatCurrentVP').textContent = `${newVp} / ${maxVp}`;
    document.getElementById('currentHpValue').textContent = newHp;
    document.getElementById('currentVpValue').textContent = newVp;

    document.getElementById('hpChangeInput').value = '';
    document.getElementById('vpChangeInput').value = '';
  });

  document.getElementById('removeStats')?.addEventListener('click', () => {
    const hpChange = parseInt(document.getElementById('hpChangeInput').value) || 0;
    const vpChange = parseInt(document.getElementById('vpChangeInput').value) || 0;

    const currentHpText = document.getElementById('combatCurrentHP').textContent;
    const currentVpText = document.getElementById('combatCurrentVP').textContent;
    const [currentHp, maxHp] = currentHpText.split(' / ').map(v => parseInt(v));
    const [currentVp, maxVp] = currentVpText.split(' / ').map(v => parseInt(v));

    const newHp = Math.max(currentHp - hpChange, 0);
    const newVp = Math.max(currentVp - vpChange, 0);

    document.getElementById('combatCurrentHP').textContent = `${newHp} / ${maxHp}`;
    document.getElementById('combatCurrentVP').textContent = `${newVp} / ${maxVp}`;
    document.getElementById('currentHpValue').textContent = newHp;
    document.getElementById('currentVpValue').textContent = newVp;

    document.getElementById('hpChangeInput').value = '';
    document.getElementById('vpChangeInput').value = '';
  });

  document.getElementById('fullRestore')?.addEventListener('click', () => {
    const currentHpText = document.getElementById('combatCurrentHP').textContent;
    const currentVpText = document.getElementById('combatCurrentVP').textContent;
    const [, maxHp] = currentHpText.split(' / ').map(v => parseInt(v));
    const [, maxVp] = currentVpText.split(' / ').map(v => parseInt(v));

    document.getElementById('combatCurrentHP').textContent = `${maxHp} / ${maxHp}`;
    document.getElementById('combatCurrentVP').textContent = `${maxVp} / ${maxVp}`;
    document.getElementById('currentHpValue').textContent = maxHp;
    document.getElementById('currentVpValue').textContent = maxVp;

    document.getElementById('hpChangeInput').value = '';
    document.getElementById('vpChangeInput').value = '';
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
