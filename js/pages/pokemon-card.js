// Pokemon Card Page - Detailed Pokemon Information Display with Info/Battle Pages

import { PokemonAPI, TrainerAPI } from '../api.js';
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
  // Note: proficiency is not stored at index 23 (that's Starting Moves), using proficiencyBonus instead
  const initiative = pokemonData[30] || 0;
  const proficiencyBonus = pokemonData[31] || 2;
  const nature = pokemonData[32] || '';
  const loyalty = pokemonData[33] || 0;

  // Parse nature to identify boosted/nerfed stats using natures from sessionStorage
  let boostedStat = '';
  let nerfedStat = '';
  if (nature) {
    const natures = JSON.parse(sessionStorage.getItem('natures')) || [];
    const natureData = natures.find(n => n.name === nature);

    if (natureData) {
      // Map from full stat names to abbreviated D&D stats
      const statNameMapping = {
        'strength': 'str',
        'dexterity': 'dex',
        'constitution': 'con',
        'intelligence': 'int',
        'wisdom': 'wis',
        'charisma': 'cha',
        'ac': 'ac'
      };

      const boostStatFull = natureData.boostStat ? natureData.boostStat.toLowerCase() : '';
      const nerfStatFull = natureData.nerfStat ? natureData.nerfStat.toLowerCase() : '';

      boostedStat = statNameMapping[boostStatFull] || '';
      nerfedStat = statNameMapping[nerfStatFull] || '';
    }
  }
  const stabBonus = pokemonData[34] || 2;
  const heldItemsStr = pokemonData[35] || '';

  // Parse held items (comma-separated)
  const heldItems = heldItemsStr ? heldItemsStr.split(',').map(item => item.trim()).filter(item => item) : [];

  // Size field (index 57)
  const size = pokemonData[57] || 'Unknown';

  // Type chart data for weaknesses, resistances, immunities (index 53)
  const typeChartValues = pokemonData[53] ? pokemonData[53].split(',').map(Number) : [];
  const typeNames = [
    "Normal", "Fighting", "Flying", "Poison", "Ground", "Rock", "Bug", "Ghost",
    "Steel", "Fire", "Water", "Grass", "Electric", "Psychic", "Ice", "Dragon", "Dark", "Fairy"
  ];

  // Mapping from specialization names to Pokemon types
  const specializationToType = {
    'Bird Keeper': 'Flying',
    'Bug Maniac': 'Bug',
    'Camper': 'Ground',
    'Dragon Tamer': 'Dragon',
    'Engineer': 'Electric',
    'Pyromaniac': 'Fire',
    'Gardener': 'Grass',
    'Martial Artist': 'Fighting',
    'Mountaineer': 'Rock',
    'Mystic': 'Ghost',
    'Steel Worker': 'Steel',
    'Psychic': 'Psychic',
    'Swimmer': 'Water',
    'Charmer': 'Fairy',
    'Shadow': 'Dark',
    'Alchemist': 'Poison',
    'Team Player': 'Normal',
    'Ice Skater': 'Ice'
  };

  // Type Master Level 9: Resistance shift for first specialization type
  const trainerPath = trainerData[25] || '';
  const trainerLevel = parseInt(trainerData[2]) || 1;
  const specializationsStr = trainerData[24] || '';

  if (trainerPath === 'Type Master' && trainerLevel >= 9 && specializationsStr) {
    const specializations = specializationsStr.split(',').map(s => s.trim()).filter(s => s);
    if (specializations.length > 0) {
      const firstSpecialization = specializations[0];
      const firstSpecType = specializationToType[firstSpecialization];

      if (firstSpecType) {
        const typeIndex = typeNames.indexOf(firstSpecType);
        if (typeIndex !== -1 && typeChartValues[typeIndex] !== undefined) {
          const currentValue = typeChartValues[typeIndex];
          // Shift resistance down: 2→1, 1→0.5, 0.5→0
          if (currentValue === 2) {
            typeChartValues[typeIndex] = 1;
          } else if (currentValue === 1) {
            typeChartValues[typeIndex] = 0.5;
          } else if (currentValue === 0.5) {
            typeChartValues[typeIndex] = 0;
          }
        }
      }
    }
  }

  const weaknesses = [];
  const resistances = [];
  const immunities = [];

  typeChartValues.forEach((value, index) => {
    if (value === 0) {
      immunities.push(typeNames[index]);
    } else if (value > 0 && value < 1) {
      resistances.push(typeNames[index]);
    } else if (value > 1) {
      weaknesses.push(typeNames[index]);
    }
  });

  // Current HP/VP values (indices 45 and 46)
  const currentHp = pokemonData[45] !== null && pokemonData[45] !== undefined && pokemonData[45] !== ''
    ? parseInt(pokemonData[45])
    : hp;
  const currentVp = pokemonData[46] !== null && pokemonData[46] !== undefined && pokemonData[46] !== ''
    ? parseInt(pokemonData[46])
    : vp;

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
  const commentsRaw = pokemonData[48] || '';
  const comments = commentsRaw ? commentsRaw.split(';').map(c => c.trim()).filter(c => c) : [];

  // Movement data (index 13 is comma-separated: walking,climbing,flying,hovering,swimming,burrowing)
  const movementData = pokemonData[13] || '';
  const movementValues = movementData.split(',').map(v => v.trim());
  const movementTypes = ['Walking', 'Climbing', 'Flying', 'Hovering', 'Swimming', 'Burrowing'];
  const movementDisplay = movementValues
    .map((value, index) => value && value !== '-' && value !== '0' ? `${movementTypes[index]}: ${value}` : null)
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

  // Format saving throws - keep as newline-separated for column layout
  const savingThrowFormatted = savingThrow;

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

  // Parse feats and get details from pokemonFeats database
  const parsedFeats = [];
  if (feats) {
    const pokemonFeatsData = JSON.parse(sessionStorage.getItem('pokemonFeats') || '[]');
    const featsList = feats.split(',').map(f => f.trim()).filter(f => f);

    featsList.forEach((featName) => {
      const featData = pokemonFeatsData.find(f => f.name === featName);
      parsedFeats.push({
        name: featName,
        description: featData ? (featData.effect || featData.description || 'No description available') : 'No description available'
      });
    });
  }

  // Generate feat buttons HTML
  const featButtonsHTML = parsedFeats.length > 0
    ? parsedFeats.map((feat, index) =>
        `<button class="feat-button" data-feat-index="${index}" style="background-color: white; color: black; border: 2px solid #333; border-radius: 0.6vh; padding: 0.8vh 1.5vh; font-size: clamp(0.75rem, 1.5vw, 0.9rem); cursor: pointer; margin: 0 0.3vh; font-weight: bold; vertical-align: middle;">${feat.name}</button>`
      ).join(' ')
    : 'None';

  // Generate held items buttons HTML
  const heldItemsHTML = heldItems.length > 0
    ? heldItems.map((item, index) =>
        `<button class="held-item-button" data-item-index="${index}" style="background-color: white; color: black; border: 2px solid #333; border-radius: 0.6vh; padding: 0.8vh 1.5vh; font-size: clamp(0.75rem, 1.5vw, 0.9rem); cursor: pointer; margin: 0 0.3vh; font-weight: bold; vertical-align: middle;">${item}</button>`
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
          grid-template-columns: 1fr;
          gap: clamp(2rem, 4vw, 4rem);
          padding: clamp(1rem, 2vh, 2rem) clamp(0.5rem, 1vw, 1rem) clamp(1rem, 2vh, 1.5rem);
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
          padding: 0 clamp(50px, 12vw, 110px);
          font-size: clamp(2rem, 5vw, 3rem);
          text-transform: uppercase;
          letter-spacing: clamp(0.5px, 0.3vw, 3px);
          text-shadow: 0 clamp(2px, 0.6vh, 4px) clamp(6px, 1.5vh, 10px) rgba(0,0,0,0.8);
          font-weight: 900;
          z-index: 1000;
          white-space: nowrap;
          width: auto;
          max-width: calc(100vw - 20px);
          overflow: hidden;
          text-overflow: ellipsis;
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

        .info-item-row {
          display: flex;
          gap: clamp(0.5rem, 1vh, 0.75rem);
        }

        .info-item-half {
          flex: 1;
          min-width: 0;
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
          font-size: clamp(0.65rem, 1.4vw, 0.8rem);
          font-weight: 700;
          color: white;
          text-shadow: 0 2px 4px rgba(0,0,0,0.6);
        }

        .info-item-half .info-item-label {
          font-size: clamp(0.65rem, 1.4vw, 0.8rem);
        }

        .info-item-half span:not(.info-item-label) {
          font-size: clamp(0.65rem, 1.4vw, 0.8rem);
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
          max-width: 100%;
          overflow: hidden;
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
          word-wrap: break-word;
          overflow-wrap: break-word;
          max-width: 100%;
        }

        .skills-container {
          width: 100%;
          max-width: 100%;
          margin-top: clamp(1rem, 2vh, 1.5rem);
          overflow: hidden;
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
          max-width: 100%;
          box-sizing: border-box;
        }

        .skill-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: clamp(0.35rem, 0.8vh, 0.5rem) clamp(0.5rem, 1.2vw, 0.75rem);
          border: clamp(2px, 0.3vw, 2.5px) solid #333;
          border-radius: clamp(7px, 1.3vw, 10px);
          text-align: center;
          background: linear-gradient(135deg, rgba(100,100,100,0.4) 0%, rgba(80,80,80,0.4) 100%);
          font-size: clamp(0.65rem, 1.3vw, 0.75rem);
          font-weight: 700;
          color: rgba(255,255,255,0.5);
          box-shadow: 0 3px 8px rgba(0,0,0,0.3);
          transition: all 0.3s ease;
          min-width: 0;
          word-wrap: break-word;
          overflow-wrap: break-word;
        }

        .skill-item.unlocked {
          background: linear-gradient(135deg, #FFDE00 0%, #FFC700 100%);
          color: black;
          border-color: #333;
          box-shadow: 0 6px 15px rgba(0,0,0,0.4),
                      0 0 10px rgba(255,222,0,0.5);
        }

        .skill-item.double-proficiency {
          background: linear-gradient(135deg, #9C27B0 0%, #7B1FA2 100%);
          color: white;
          border-color: #4A148C;
          box-shadow: 0 6px 15px rgba(0,0,0,0.4),
                      0 0 15px rgba(156,39,176,0.6);
          animation: doubleProfGlow 2s ease-in-out infinite alternate;
        }

        @keyframes doubleProfGlow {
          from {
            box-shadow: 0 6px 15px rgba(0,0,0,0.4),
                        0 0 15px rgba(156,39,176,0.6);
          }
          to {
            box-shadow: 0 8px 20px rgba(0,0,0,0.5),
                        0 0 20px rgba(156,39,176,0.8);
          }
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
          font-size: clamp(1rem, 2.2vw, 1.4rem);
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
          padding: clamp(0.4rem, 0.8vh, 0.6rem) clamp(0.6rem, 1.2vw, 0.85rem);
          border-radius: clamp(8px, 1.5vw, 12px);
          text-align: center;
          font-weight: 700;
          white-space: nowrap;
          width: auto;
          font-size: clamp(0.65rem, 1.3vw, 0.8rem);
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

        /* Comment Popup Styles */
        .comments-list {
          display: flex;
          flex-direction: column;
          gap: clamp(0.5rem, 1vh, 0.75rem);
        }

        .comment-box {
          position: relative;
          background: linear-gradient(135deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.06) 100%);
          border: 2px solid rgba(255,222,0,0.3);
          border-radius: clamp(8px, 1.5vw, 12px);
          padding: clamp(0.5rem, 1vh, 0.75rem);
          padding-right: clamp(2rem, 5vw, 2.5rem);
        }

        .comment-textarea {
          width: 100%;
          min-height: 60px;
          background: rgba(0,0,0,0.3);
          border: 1px solid rgba(255,255,255,0.2);
          border-radius: 6px;
          color: #e0e0e0;
          font-size: clamp(0.85rem, 1.8vw, 1rem);
          font-family: inherit;
          padding: clamp(0.4rem, 0.8vh, 0.6rem);
          resize: vertical;
          line-height: 1.5;
        }

        .comment-textarea:focus {
          outline: none;
          border-color: #FFDE00;
        }

        .comment-delete-btn {
          position: absolute;
          top: clamp(0.3rem, 0.6vh, 0.5rem);
          right: clamp(0.3rem, 0.6vw, 0.5rem);
          background: linear-gradient(135deg, #EE1515 0%, #C91010 100%);
          color: white;
          border: none;
          border-radius: 50%;
          width: clamp(22px, 4.5vw, 28px);
          height: clamp(22px, 4.5vw, 28px);
          font-size: clamp(0.8rem, 1.6vw, 1rem);
          font-weight: bold;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          line-height: 1;
        }

        .comment-add-btn {
          width: 100%;
          padding: clamp(0.6rem, 1.2vh, 0.8rem);
          background: linear-gradient(135deg, rgba(255,222,0,0.2) 0%, rgba(255,222,0,0.1) 100%);
          border: 2px dashed rgba(255,222,0,0.4);
          border-radius: clamp(8px, 1.5vw, 12px);
          color: #FFDE00;
          font-size: clamp(0.85rem, 1.8vw, 1rem);
          font-weight: 700;
          cursor: pointer;
          transition: all 0.3s;
        }

        .comment-add-btn:hover {
          background: linear-gradient(135deg, rgba(255,222,0,0.3) 0%, rgba(255,222,0,0.2) 100%);
        }

        .comment-save-btn {
          width: 100%;
          padding: clamp(0.6rem, 1.2vh, 0.8rem);
          margin-top: clamp(0.5rem, 1vh, 0.75rem);
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          border: none;
          border-radius: clamp(8px, 1.5vw, 12px);
          color: white;
          font-size: clamp(0.9rem, 1.8vw, 1.05rem);
          font-weight: 700;
          cursor: pointer;
          transition: all 0.3s;
        }

        .comment-save-btn:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(102,126,234,0.4);
        }

        /* Popup Modal Styles */
        .popup-overlay {
          display: none;
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0,0,0,0.7);
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
          max-height: 85vh;
          overflow-y: auto;
          position: relative;
          box-shadow: 0 15px 40px rgba(0,0,0,0.8);
        }

        .popup-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: clamp(0.5rem, 1vh, 0.75rem);
          padding-bottom: clamp(0.5rem, 1vh, 0.75rem);
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
          font-size: clamp(1.5rem, 3.5vw, 2rem);
          font-weight: bold;
          cursor: pointer;
          box-shadow: 0 4px 10px rgba(0,0,0,0.3);
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

        /* Combat Tracker Specific Styles */
        .combat-tracker-container {
          display: flex;
          flex-direction: column;
          gap: clamp(1rem, 2vh, 1.5rem);
        }

        .combat-stats-row {
          display: flex;
          gap: clamp(1rem, 2vw, 2rem);
        }

        .combat-stat-column {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: clamp(0.5rem, 1vh, 0.75rem);
          align-items: center;
          text-align: center;
        }

        .combat-stat-label {
          font-weight: 900;
          font-size: clamp(0.9rem, 2vw, 1.1rem);
          color: #FFDE00;
          text-transform: uppercase;
          text-shadow: 0 1px 3px rgba(0,0,0,0.6);
        }

        .combat-stat-value {
          font-size: clamp(1.2rem, 2.8vw, 1.6rem);
          font-weight: 900;
          color: white;
          text-shadow: 0 2px 4px rgba(0,0,0,0.8);
        }

        .combat-input {
          width: 100%;
          padding: clamp(0.5rem, 1vh, 0.75rem);
          background: linear-gradient(135deg, #3a3a3a 0%, #2d2d2d 100%);
          border: clamp(2px, 0.4vw, 3px) solid rgba(255,222,0,0.3);
          border-radius: clamp(8px, 1.5vw, 10px);
          color: white;
          font-size: clamp(0.9rem, 2vw, 1rem);
          font-weight: 700;
        }

        .combat-input:focus {
          outline: none;
          border-color: #FFDE00;
        }

        .combat-buttons {
          display: flex;
          gap: clamp(0.5rem, 1vw, 0.75rem);
        }

        .combat-btn {
          flex: 1;
          padding: clamp(0.75rem, 1.5vh, 1rem);
          border: clamp(2px, 0.4vw, 3px) solid #333;
          border-radius: clamp(8px, 1.5vw, 10px);
          font-size: clamp(0.7rem, 1.5vw, 0.85rem);
          font-weight: 900;
          cursor: pointer;
          transition: all 0.3s ease;
          text-transform: uppercase;
        }

        .combat-btn-add {
          background: linear-gradient(135deg, #4CAF50 0%, #45A049 100%);
          color: white;
        }

        .combat-btn-add:hover {
          transform: translateY(-2px);
          box-shadow: 0 5px 15px rgba(76,175,80,0.5);
        }

        .combat-btn-remove {
          background: linear-gradient(135deg, #EE1515 0%, #C91010 100%);
          color: white;
        }

        .combat-btn-remove:hover {
          transform: translateY(-2px);
          box-shadow: 0 5px 15px rgba(238,21,21,0.5);
        }

        .combat-btn-restore {
          background: linear-gradient(135deg, #3B4CCA 0%, #2E3FA0 100%);
          color: white;
        }

        .combat-btn-restore:hover {
          transform: translateY(-2px);
          box-shadow: 0 5px 15px rgba(59,76,202,0.5);
        }

        .type-effectiveness-section {
          margin-bottom: clamp(1rem, 2vh, 1.5rem);
          text-align: center;
        }

        .type-effectiveness-header {
          font-weight: 900;
          font-size: clamp(0.75rem, 1.6vw, 0.9rem);
          color: #FFDE00;
          text-transform: uppercase;
          text-shadow: 0 1px 3px rgba(0,0,0,0.6);
          margin-bottom: clamp(0.5rem, 1vh, 0.75rem);
        }

        .type-buttons-container {
          display: flex;
          flex-wrap: wrap;
          gap: clamp(0.4rem, 1vw, 0.6rem);
          justify-content: center;
        }

        .type-button {
          padding: clamp(0.4rem, 0.8vh, 0.6rem) clamp(0.6rem, 1.2vw, 0.8rem);
          border: clamp(2px, 0.4vw, 3px) solid #333;
          border-radius: clamp(6px, 1.2vw, 8px);
          font-size: clamp(0.75rem, 1.6vw, 0.9rem);
          font-weight: 700;
          cursor: pointer;
          transition: all 0.3s ease;
          text-transform: capitalize;
        }

        .type-button.active {
          border-color: #FFDE00;
          border-width: clamp(3px, 0.6vw, 4px);
          box-shadow: 0 0 clamp(10px, 2vw, 15px) rgba(255,222,0,0.6);
          transform: scale(1.05);
        }

        .type-button:hover {
          transform: translateY(-1px);
          box-shadow: 0 3px 8px rgba(0,0,0,0.4);
        }

        .combat-section-separator {
          height: clamp(2px, 0.4vw, 3px);
          background: linear-gradient(90deg, transparent 0%, #FFDE00 50%, transparent 100%);
          margin: clamp(0.5rem, 1vh, 0.75rem) 0;
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
          .info-page-grid,
          .battle-page-grid {
            grid-template-columns: 32% 1fr;
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
          .info-page-grid,
          .battle-page-grid {
            grid-template-columns: 37% 1fr;
            gap: clamp(1rem, 2.5vw, 2rem);
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
          .info-page-grid,
          .battle-page-grid {
            grid-template-columns: 42% 1fr;
            gap: clamp(0.75rem, 2vw, 1.5rem);
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
          .info-page-grid,
          .battle-page-grid {
            grid-template-columns: 45% 1fr;
            gap: clamp(0.5rem, 1.5vw, 1rem);
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

        /* Battle Dice Tracker Styles */
        .battle-dice-container {
          margin-bottom: 1rem;
          padding: 0.8rem;
          background: rgba(255, 222, 0, 0.15);
          border-radius: 8px;
          border-left: 4px solid rgba(255, 222, 0, 0.6);
        }

        .battle-dice-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.5rem;
        }

        .charge-dots {
          display: flex;
          gap: clamp(0.3rem, 0.6vw, 0.5rem);
          flex-wrap: wrap;
        }

        .charge-dot {
          width: clamp(14px, 2vw, 18px);
          height: clamp(14px, 2vw, 18px);
          border-radius: 50%;
          border: clamp(2px, 0.3vw, 3px) solid rgba(255, 222, 0, 0.8);
          transition: all 0.3s ease;
        }

        .charge-dot.filled {
          background: linear-gradient(135deg, #FFDE00 0%, #FFC700 100%);
          box-shadow: 0 0 clamp(5px, 1vw, 8px) rgba(255, 222, 0, 0.5);
        }

        .charge-dot.empty {
          background: rgba(0, 0, 0, 0.2);
          border-color: rgba(255, 222, 0, 0.3);
        }

        .use-battle-dice-button {
          padding: 0.5rem 1rem;
          background: linear-gradient(135deg, #FFDE00 0%, #FFC700 100%);
          color: #333;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: clamp(0.85rem, 1.5vh, 0.95rem);
          font-weight: bold;
          transition: all 0.3s;
          box-shadow: 0 3px 10px rgba(255, 222, 0, 0.3);
        }

        .use-battle-dice-button:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 5px 15px rgba(255, 222, 0, 0.4);
        }

        .use-battle-dice-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
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
            <div class="info-item-row">
              <div class="info-item info-item-half">
                <span class="info-item-label">Level:</span>
                <span class="info-item-value" id="pokemonLevel">${level}</span>
              </div>
              <div class="info-item info-item-half">
                <span class="info-item-label">Size:</span>
                <span class="info-item-value" id="pokemonSize">${size}</span>
              </div>
            </div>
            <div class="info-item">
              <span class="info-item-label">Typing:</span>
              <span class="info-item-value" id="pokemonTyping">${typingButtons}</span>
            </div>
            <div class="info-item-column">
              <span class="info-item-label">Saving Throws:</span>
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
            <button class="info-button" id="commentsButton">Comments (${comments.length})</button>
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

                // Check if this skill has double proficiency (+ suffix in original data)
                const hasDoubleProficiency = skillsArray.some(s =>
                  s.toLowerCase() === skillKey + '+' || s === skill.name + '+'
                );

                const skillClass = proficiencyLevel >= 1 ? 'unlocked' : '';
                const doubleProfClass = hasDoubleProficiency ? 'double-proficiency' : '';

                return `
                  <div class="skill-item ${skillClass} ${doubleProfClass}">
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
              <span class="info-item-value">${heldItemsHTML}</span>
            </div>
            <div class="info-item">
              <span class="info-item-label">Feats:</span>
              <span class="info-item-value">${featButtonsHTML}</span>
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
              <div class="stat-box" id="acValue" style="color: ${getStatColor('ac')}">${ac}</div>
            </div>
            <div class="stat-box-wrapper">
              <div class="stat-label-box">HP</div>
              <div class="stat-box" id="hpValue">${hp}</div>
              <div class="current-stat-box" id="currentHpValue">${currentHp}</div>
            </div>
            <div class="stat-box-wrapper">
              <div class="stat-label-box">VP</div>
              <div class="stat-box" id="vpValue">${vp}</div>
              <div class="current-stat-box" id="currentVpValue">${currentVp}</div>
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
      <div id="abilityPopup" class="popup-overlay">
        <div class="popup-content">
          <div class="popup-header">
            <div class="popup-title" id="abilityPopupTitle">Ability</div>
            <button class="popup-close" id="closeAbilityPopup">×</button>
          </div>
          <div class="popup-body" id="abilityPopupContent"></div>
        </div>
      </div>

      <!-- Feat Popup -->
      <div id="featPopup" class="popup-overlay">
        <div class="popup-content">
          <div class="popup-header">
            <div class="popup-title" id="featPopupTitle">Feat</div>
            <button class="popup-close" id="closeFeatPopup">×</button>
          </div>
          <div class="popup-body" id="featPopupContent"></div>
        </div>
      </div>

      <!-- Held Item Popup -->
      <div id="heldItemPopup" class="popup-overlay">
        <div class="popup-content">
          <div class="popup-header">
            <div class="popup-title">Held Item</div>
            <button class="popup-close" id="closeHeldItemPopup">×</button>
          </div>
          <div class="popup-body" id="heldItemContent"></div>
        </div>
      </div>

      <!-- Combat Tracker Popup -->
      <div id="combatTrackerPopup" class="popup-overlay">
        <div class="popup-content" style="max-width: min(90vw, 550px); padding-top: clamp(0.5rem, 1vh, 0.75rem);">
          <div class="popup-header">
            <div class="popup-title">Combat Tracker</div>
            <button class="popup-close" id="closeCombatTracker">×</button>
          </div>
          <div class="popup-body">
            <div class="combat-tracker-container">
              <!-- Trainer Section -->
              <div style="margin-bottom: clamp(0.5rem, 1vh, 0.75rem);">
                <div style="font-weight: 900; font-size: clamp(1rem, 2.2vw, 1.2rem); color: #FFDE00; text-transform: uppercase; margin-bottom: clamp(0.5rem, 1vh, 0.75rem); text-align: center; text-shadow: 0 2px 4px rgba(0,0,0,0.8);">${trainerData[1]}</div>
                <div class="combat-stats-row">
                  <div class="combat-stat-column">
                    <div class="combat-stat-label">HP</div>
                    <div class="combat-stat-value" id="trainerCombatCurrentHP">${trainerData[34] || trainerData[11]} / ${trainerData[11]}</div>
                    <input type="number" id="trainerHpChangeInput" class="combat-input" placeholder="HP Amount">
                  </div>
                  <div class="combat-stat-column">
                    <div class="combat-stat-label">VP</div>
                    <div class="combat-stat-value" id="trainerCombatCurrentVP">${trainerData[35] || trainerData[12]} / ${trainerData[12]}</div>
                    <input type="number" id="trainerVpChangeInput" class="combat-input" placeholder="VP Amount">
                  </div>
                </div>
                <div class="combat-buttons">
                  <button id="addTrainerStats" class="combat-btn combat-btn-add">➕ Add</button>
                  <button id="removeTrainerStats" class="combat-btn combat-btn-remove">➖ Remove</button>
                  <button id="fullRestoreTrainer" class="combat-btn combat-btn-restore">✨ Full Restore</button>
                </div>
              </div>

              <div class="combat-section-separator"></div>

              <!-- Pokemon Section -->
              <div>
                <div style="font-weight: 900; font-size: clamp(1rem, 2.2vw, 1.2rem); color: #FFDE00; text-transform: uppercase; margin-bottom: clamp(0.5rem, 1vh, 0.75rem); text-align: center; text-shadow: 0 2px 4px rgba(0,0,0,0.8);">${pokemonData[2]}</div>

                <!-- Type Effectiveness Buttons -->
                ${weaknesses.length > 0 ? `
                  <div class="type-effectiveness-section">
                    <div class="type-effectiveness-header">Weaknesses (2× Damage)</div>
                    <div class="type-buttons-container" id="weaknessesContainer"></div>
                  </div>
                ` : ''}
                ${resistances.length > 0 ? `
                  <div class="type-effectiveness-section">
                    <div class="type-effectiveness-header">Resistances (0.5× Damage)</div>
                    <div class="type-buttons-container" id="resistancesContainer"></div>
                  </div>
                ` : ''}
                ${immunities.length > 0 ? `
                  <div class="type-effectiveness-section">
                    <div class="type-effectiveness-header">Immunities (0× Damage)</div>
                    <div class="type-buttons-container" id="immunitiesContainer"></div>
                  </div>
                ` : ''}

                <div class="combat-stats-row">
                  <div class="combat-stat-column">
                    <div class="combat-stat-label">HP</div>
                    <div class="combat-stat-value" id="combatCurrentHP">${currentHp} / ${hp}</div>
                    <input type="number" id="hpChangeInput" class="combat-input" placeholder="HP Amount">
                  </div>
                  <div class="combat-stat-column">
                    <div class="combat-stat-label">VP</div>
                    <div class="combat-stat-value" id="combatCurrentVP">${currentVp} / ${vp}</div>
                    <input type="number" id="vpChangeInput" class="combat-input" placeholder="VP Amount">
                  </div>
                </div>
                <div class="combat-buttons">
                  <button id="addStats" class="combat-btn combat-btn-add">➕ Add</button>
                  <button id="removeStats" class="combat-btn combat-btn-remove">➖ Remove</button>
                  <button id="fullRestore" class="combat-btn combat-btn-restore">✨ Full Restore</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Evolution Confirmation Popup -->
      <div id="evolutionConfirmPopup" class="popup-overlay">
        <div class="popup-content" style="max-width: min(90vw, 450px);">
          <div class="popup-header">
            <div class="popup-title">Evolve Pokemon</div>
            <button class="popup-close" id="closeEvolutionConfirm">×</button>
          </div>
          <div class="popup-body" style="text-align: center;">
            <p style="font-size: 1.1rem; margin-bottom: 1.5rem;">Would you like to evolve <strong>${name}</strong>?</p>
            <div style="display: flex; gap: 1rem; justify-content: center;">
              <button id="confirmEvolutionBtn" class="popup-button" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 0.75rem 2rem; border: none; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer;">Evolve</button>
              <button id="cancelEvolutionBtn" class="popup-button" style="background: #999; color: white; padding: 0.75rem 2rem; border: none; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer;">Cancel</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Comments Popup -->
      <div id="commentsPopup" class="popup-overlay">
        <div class="popup-content" style="max-width: min(90vw, 550px);">
          <div class="popup-header">
            <div class="popup-title">Comments</div>
            <button class="popup-close" id="closeCommentsPopup">×</button>
          </div>
          <div class="popup-body">
            <div class="comments-list" id="commentsList">
              ${comments.length > 0 ? comments.map((comment, i) => `
                <div class="comment-box" data-comment-index="${i}">
                  <textarea class="comment-textarea">${comment}</textarea>
                  <button class="comment-delete-btn" data-comment-index="${i}">&times;</button>
                </div>
              `).join('') : ''}
            </div>
            <button class="comment-add-btn" id="addCommentBtn">+ Add Comment</button>
            <button class="comment-save-btn" id="saveCommentsBtn">Save Comments</button>
          </div>
        </div>
      </div>
    </div>
  `;

  // Store parsed abilities, feats, held items, and type effectiveness data for event listener use
  window.pokemonAbilities = parsedAbilities;
  window.pokemonFeats = parsedFeats;
  window.heldItems = heldItems;
  window.typeEffectiveness = { weaknesses, resistances, immunities };

  return html;
}

export function attachPokemonCardListeners() {
  const pokemonName = sessionStorage.getItem('selectedPokemonName');
  const pokemonData = JSON.parse(sessionStorage.getItem(`pokemon_${pokemonName.toLowerCase()}`));
  const trainerData = JSON.parse(sessionStorage.getItem('trainerData'));

  // Global damage multiplier for type effectiveness
  let damageMultiplier = 1;

  // Back button - navigate to previous page (my-pokemon or trainer-card)
  document.getElementById('backToTrainerCard')?.addEventListener('click', () => {
    const previousRoute = sessionStorage.getItem('previousRoute') || 'trainer-card';
    window.dispatchEvent(new CustomEvent('navigate', {
      detail: { route: previousRoute }
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

  // Pokemon image click - show evolution confirmation popup
  document.getElementById('pokemonImage')?.addEventListener('click', () => {
    document.getElementById('evolutionConfirmPopup')?.classList.add('active');
  });

  // Evolution confirmation popup - close button
  document.getElementById('closeEvolutionConfirm')?.addEventListener('click', () => {
    document.getElementById('evolutionConfirmPopup')?.classList.remove('active');
  });

  // Evolution confirmation popup - confirm button
  document.getElementById('confirmEvolutionBtn')?.addEventListener('click', () => {
    document.getElementById('evolutionConfirmPopup')?.classList.remove('active');
    window.dispatchEvent(new CustomEvent('navigate', {
      detail: { route: 'evolution' }
    }));
  });

  // Evolution confirmation popup - cancel button
  document.getElementById('cancelEvolutionBtn')?.addEventListener('click', () => {
    document.getElementById('evolutionConfirmPopup')?.classList.remove('active');
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

    // Store original state for rollback
    const originalPokemonSlot = pokemonData[38];
    const originalTrainerSlots = [trainerData[26], trainerData[27], trainerData[28], trainerData[29], trainerData[30], trainerData[31]];

    // Optimistic update - update sessionStorage immediately
    if (isChecked) {
      // Find first empty slot for optimistic update
      let slotIndex = -1;
      for (let i = 26; i <= 31; i++) {
        if (!trainerData[i] || trainerData[i] === '') {
          slotIndex = i;
          trainerData[i] = pokemonData[2];
          pokemonData[38] = (i - 25).toString();
          break;
        }
      }
    } else {
      // Remove from party slot
      pokemonData[38] = '';
      for (let i = 26; i <= 31; i++) {
        if (trainerData[i] === pokemonData[2]) {
          trainerData[i] = '';
          break;
        }
      }
    }

    // Update sessionStorage immediately for instant UI feedback
    sessionStorage.setItem(`pokemon_${pokemonName.toLowerCase()}`, JSON.stringify(pokemonData));
    sessionStorage.setItem(`trainer_${trainerData[1].toLowerCase()}`, JSON.stringify(trainerData));

    // Now make the API call
    try {
      const action = isChecked ? 'add' : 'remove';
      const response = await PokemonAPI.updatePartyStatus(
        trainerData[1],
        pokemonData[2],
        trainerData[26],
        action
      );

      if (response.status === 'success') {
        // Update with actual slot from server if adding
        if (isChecked && response.slot) {
          const slotIndex = 26 + parseInt(response.slot) - 1;
          // Clear any incorrect optimistic placement
          for (let i = 26; i <= 31; i++) {
            if (trainerData[i] === pokemonData[2]) {
              trainerData[i] = '';
            }
          }
          // Set correct slot
          trainerData[slotIndex] = pokemonData[2];
          pokemonData[38] = response.slot;
          sessionStorage.setItem(`pokemon_${pokemonName.toLowerCase()}`, JSON.stringify(pokemonData));
          sessionStorage.setItem(`trainer_${trainerData[1].toLowerCase()}`, JSON.stringify(trainerData));
        }
      } else {
        // Rollback on failure
        pokemonData[38] = originalPokemonSlot;
        for (let i = 0; i < 6; i++) {
          trainerData[26 + i] = originalTrainerSlots[i];
        }
        sessionStorage.setItem(`pokemon_${pokemonName.toLowerCase()}`, JSON.stringify(pokemonData));
        sessionStorage.setItem(`trainer_${trainerData[1].toLowerCase()}`, JSON.stringify(trainerData));
        e.target.checked = !isChecked;
        showError(response.message || 'Failed to update active party status');
      }
    } catch (error) {
      console.error('Error updating active party:', error);
      // Rollback on error
      pokemonData[38] = originalPokemonSlot;
      for (let i = 0; i < 6; i++) {
        trainerData[26 + i] = originalTrainerSlots[i];
      }
      sessionStorage.setItem(`pokemon_${pokemonName.toLowerCase()}`, JSON.stringify(pokemonData));
      sessionStorage.setItem(`trainer_${trainerData[1].toLowerCase()}`, JSON.stringify(trainerData));
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

    // Store original state for rollback
    const originalUtilityStatus = pokemonData[56];
    const clearedPokemon = [];

    // Optimistic update - update sessionStorage immediately
    pokemonData[56] = isChecked ? 1 : '';
    sessionStorage.setItem(`pokemon_${pokemonName.toLowerCase()}`, JSON.stringify(pokemonData));

    // Clear utility slot from other Pokemon if adding
    if (isChecked) {
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key.startsWith('pokemon_') && key !== `pokemon_${pokemonName.toLowerCase()}`) {
          const otherPokemon = JSON.parse(sessionStorage.getItem(key));
          if (otherPokemon[56] === 1 || otherPokemon[56] === '1') {
            clearedPokemon.push({ key, originalValue: otherPokemon[56] });
            otherPokemon[56] = '';
            sessionStorage.setItem(key, JSON.stringify(otherPokemon));
          }
        }
      }
    }

    // Update trainer data timestamp to trigger refresh
    sessionStorage.setItem(`trainer_${trainerData[1].toLowerCase()}`, JSON.stringify(trainerData));

    // Now make the API call
    try {
      const action = isChecked ? 'add' : 'remove';
      const response = await PokemonAPI.updateUtilitySlot(
        trainerData[1],
        pokemonData[2],
        action
      );

      if (response.status === 'success') {
        // Success - no message needed, update was already instant
      } else {
        // Rollback on failure
        pokemonData[56] = originalUtilityStatus;
        sessionStorage.setItem(`pokemon_${pokemonName.toLowerCase()}`, JSON.stringify(pokemonData));

        // Restore cleared Pokemon
        clearedPokemon.forEach(({ key, originalValue }) => {
          const otherPokemon = JSON.parse(sessionStorage.getItem(key));
          otherPokemon[56] = originalValue;
          sessionStorage.setItem(key, JSON.stringify(otherPokemon));
        });

        sessionStorage.setItem(`trainer_${trainerData[1].toLowerCase()}`, JSON.stringify(trainerData));
        e.target.checked = !isChecked;
        showError(response.message || 'Failed to update utility slot status');
      }
    } catch (error) {
      console.error('Error updating utility slot:', error);
      // Rollback on error
      pokemonData[56] = originalUtilityStatus;
      sessionStorage.setItem(`pokemon_${pokemonName.toLowerCase()}`, JSON.stringify(pokemonData));

      // Restore cleared Pokemon
      clearedPokemon.forEach(({ key, originalValue }) => {
        const otherPokemon = JSON.parse(sessionStorage.getItem(key));
        otherPokemon[56] = originalValue;
        sessionStorage.setItem(key, JSON.stringify(otherPokemon));
      });

      sessionStorage.setItem(`trainer_${trainerData[1].toLowerCase()}`, JSON.stringify(trainerData));
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
        abilityPopup.classList.add('active');
      }
    });
  });

  // Close ability popup button
  document.getElementById('closeAbilityPopup')?.addEventListener('click', () => {
    document.getElementById('abilityPopup').classList.remove('active');
  });

  // Close ability popup when clicking outside
  document.getElementById('abilityPopup')?.addEventListener('click', (e) => {
    if (e.target.id === 'abilityPopup') {
      document.getElementById('abilityPopup').classList.remove('active');
    }
  });

  // Feat button click listeners
  document.querySelectorAll('.feat-button').forEach(button => {
    button.addEventListener('click', (e) => {
      const index = parseInt(e.target.dataset.featIndex);
      if (window.pokemonFeats && window.pokemonFeats[index]) {
        const feat = window.pokemonFeats[index];
        document.getElementById('featPopupTitle').textContent = feat.name;
        document.getElementById('featPopupContent').textContent = feat.description;
        const featPopup = document.getElementById('featPopup');
        featPopup.classList.add('active');
      }
    });
  });

  // Close feat popup button
  document.getElementById('closeFeatPopup')?.addEventListener('click', () => {
    document.getElementById('featPopup').classList.remove('active');
  });

  // Close feat popup when clicking outside
  document.getElementById('featPopup')?.addEventListener('click', (e) => {
    if (e.target.id === 'featPopup') {
      document.getElementById('featPopup').classList.remove('active');
    }
  });

  // Held item button click listeners
  document.querySelectorAll('.held-item-button').forEach(button => {
    button.addEventListener('click', (e) => {
      const itemIndex = parseInt(e.target.dataset.itemIndex);
      const heldItemPopup = document.getElementById('heldItemPopup');
      const heldItemContent = document.getElementById('heldItemContent');

      // Get the specific item from the window.heldItems array
      const itemName = window.heldItems && window.heldItems[itemIndex];

      if (itemName) {
        // Look up item details from sessionStorage
        const itemsData = JSON.parse(sessionStorage.getItem('items')) || [];
        const item = itemsData.find(i => i.name === itemName);

        if (item) {
          heldItemContent.innerHTML = `
            <div style="margin-bottom: 1rem;">
              <div style="font-weight: 900; font-size: clamp(1.05rem, 2.2vw, 1.2rem); margin-bottom: 0.5rem; color: #FFDE00; text-transform: uppercase;">
                ${item.name}
              </div>
              <div style="color: #c0c0c0; font-size: clamp(0.9rem, 1.9vw, 1rem);">
                ${item.effect || item.description || 'No description available'}
              </div>
            </div>
          `;
        } else {
          heldItemContent.innerHTML = `
            <div style="color: #c0c0c0;">
              ${itemName}
              <br><br>
              <em>Item description not found in database.</em>
            </div>
          `;
        }
      } else {
        heldItemContent.innerHTML = '<div style="color: #c0c0c0;">No held item</div>';
      }

      heldItemPopup.classList.add('active');
    });
  });

  // Close held item popup
  document.getElementById('closeHeldItemPopup')?.addEventListener('click', () => {
    document.getElementById('heldItemPopup').classList.remove('active');
  });

  document.getElementById('heldItemPopup')?.addEventListener('click', (e) => {
    if (e.target.id === 'heldItemPopup') {
      document.getElementById('heldItemPopup').classList.remove('active');
    }
  });

  // Comments popup
  document.getElementById('commentsButton')?.addEventListener('click', () => {
    document.getElementById('commentsPopup').classList.add('active');
  });

  document.getElementById('closeCommentsPopup')?.addEventListener('click', () => {
    document.getElementById('commentsPopup').classList.remove('active');
  });

  document.getElementById('commentsPopup')?.addEventListener('click', (e) => {
    if (e.target.id === 'commentsPopup') {
      document.getElementById('commentsPopup').classList.remove('active');
    }
  });

  // Add comment button
  document.getElementById('addCommentBtn')?.addEventListener('click', () => {
    const commentsList = document.getElementById('commentsList');
    const newIndex = commentsList.querySelectorAll('.comment-box').length;
    const newBox = document.createElement('div');
    newBox.className = 'comment-box';
    newBox.dataset.commentIndex = newIndex;
    newBox.innerHTML = `
      <textarea class="comment-textarea" placeholder="Write a comment..."></textarea>
      <button class="comment-delete-btn" data-comment-index="${newIndex}">&times;</button>
    `;
    commentsList.appendChild(newBox);

    // Attach delete listener to the new box
    newBox.querySelector('.comment-delete-btn').addEventListener('click', () => {
      newBox.remove();
    });

    // Focus the new textarea
    newBox.querySelector('.comment-textarea').focus();
  });

  // Delete comment buttons (for pre-existing comments)
  document.querySelectorAll('.comment-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.closest('.comment-box').remove();
    });
  });

  // Save comments button
  document.getElementById('saveCommentsBtn')?.addEventListener('click', () => {
    const textareas = document.querySelectorAll('#commentsList .comment-textarea');
    const newComments = [];
    textareas.forEach(ta => {
      const val = ta.value.trim();
      if (val) newComments.push(val);
    });

    const commentsString = newComments.join(';');
    pokemonData[48] = commentsString;

    // Update button count
    const commentsBtn = document.getElementById('commentsButton');
    if (commentsBtn) commentsBtn.textContent = `Comments (${newComments.length})`;

    // Save to sessionStorage immediately
    sessionStorage.setItem(`pokemon_${pokemonName.toLowerCase()}`, JSON.stringify(pokemonData));

    // Persist to database in background
    PokemonAPI.update(pokemonData).then(() => {
      console.log('Comments saved to backend');
    }).catch(error => {
      console.error('Error saving comments to backend:', error);
    });

    // Close popup
    document.getElementById('commentsPopup').classList.remove('active');
  });

  // Current HP/VP boxes click listeners - open combat tracker
  document.getElementById('currentHpValue')?.addEventListener('click', () => {
    document.getElementById('combatTrackerPopup').classList.add('active');
  });

  document.getElementById('currentVpValue')?.addEventListener('click', () => {
    document.getElementById('combatTrackerPopup').classList.add('active');
  });

  // Close combat tracker
  document.getElementById('closeCombatTracker')?.addEventListener('click', () => {
    document.getElementById('combatTrackerPopup').classList.remove('active');
  });

  document.getElementById('combatTrackerPopup')?.addEventListener('click', (e) => {
    if (e.target.id === 'combatTrackerPopup') {
      document.getElementById('combatTrackerPopup').classList.remove('active');
    }
  });

  // Initialize type effectiveness buttons
  if (window.typeEffectiveness) {
    const { weaknesses, resistances, immunities } = window.typeEffectiveness;

    // Create weakness buttons
    if (weaknesses.length > 0) {
      const weaknessContainer = document.getElementById('weaknessesContainer');
      if (weaknessContainer) {
        weaknesses.forEach(type => {
          const button = createTypeButton(type, 2);
          weaknessContainer.appendChild(button);
        });
      }
    }

    // Create resistance buttons
    if (resistances.length > 0) {
      const resistanceContainer = document.getElementById('resistancesContainer');
      if (resistanceContainer) {
        resistances.forEach(type => {
          const button = createTypeButton(type, 0.5);
          resistanceContainer.appendChild(button);
        });
      }
    }

    // Create immunity buttons
    if (immunities.length > 0) {
      const immunityContainer = document.getElementById('immunitiesContainer');
      if (immunityContainer) {
        immunities.forEach(type => {
          const button = createTypeButton(type, 0);
          immunityContainer.appendChild(button);
        });
      }
    }
  }

  // Helper function to create type buttons
  function createTypeButton(type, multiplier) {
    const button = document.createElement('button');
    button.className = 'type-button';
    button.textContent = type;

    const bgColor = getMoveTypeColor(type);
    const textColor = getTextColorForBackground(bgColor);
    button.style.backgroundColor = bgColor;
    button.style.color = textColor;

    button.addEventListener('click', () => {
      // Toggle active state
      if (button.classList.contains('active')) {
        button.classList.remove('active');
        damageMultiplier = 1; // Reset multiplier
      } else {
        // Deactivate all other type buttons
        document.querySelectorAll('.type-button').forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');
        damageMultiplier = multiplier;
      }
    });

    return button;
  }

  // Pokemon Combat tracker buttons
  document.getElementById('addStats')?.addEventListener('click', async () => {
    const hpChange = parseInt(document.getElementById('hpChangeInput').value) || 0;
    const vpChange = parseInt(document.getElementById('vpChangeInput').value) || 0;

    const currentHpText = document.getElementById('combatCurrentHP').textContent;
    const currentVpText = document.getElementById('combatCurrentVP').textContent;
    const [currentHp, maxHp] = currentHpText.split(' / ').map(v => parseInt(v));
    const [currentVp, maxVp] = currentVpText.split(' / ').map(v => parseInt(v));

    const newHp = Math.min(currentHp + hpChange, maxHp);
    const newVp = Math.min(currentVp + vpChange, maxVp);

    // Update UI (combat popup)
    document.getElementById('combatCurrentHP').textContent = `${newHp} / ${maxHp}`;
    document.getElementById('combatCurrentVP').textContent = `${newVp} / ${maxVp}`;
    // Update Battle Page stats (may not exist if on Info Page)
    const currentHpEl = document.getElementById('currentHpValue');
    const currentVpEl = document.getElementById('currentVpValue');
    if (currentHpEl) currentHpEl.textContent = newHp;
    if (currentVpEl) currentVpEl.textContent = newVp;

    // Save to sessionStorage
    pokemonData[45] = newHp;
    pokemonData[46] = newVp;
    sessionStorage.setItem(`pokemon_${pokemonName.toLowerCase()}`, JSON.stringify(pokemonData));

    // Persist to database
    try {
      if (hpChange !== 0) {
        await PokemonAPI.updateLiveStats(trainerData[1], pokemonData[2], 'HP', newHp);
      }
      if (vpChange !== 0) {
        await PokemonAPI.updateLiveStats(trainerData[1], pokemonData[2], 'VP', newVp);
      }
    } catch (error) {
      console.error('Error updating Pokemon live stats:', error);
      showError('Failed to save HP/VP changes to database');
    }

    document.getElementById('hpChangeInput').value = '';
    document.getElementById('vpChangeInput').value = '';
  });

  document.getElementById('removeStats')?.addEventListener('click', async () => {
    let hpChange = parseInt(document.getElementById('hpChangeInput').value) || 0;
    const vpChange = parseInt(document.getElementById('vpChangeInput').value) || 0;

    // Apply damage multiplier to HP damage
    hpChange = Math.ceil(hpChange * damageMultiplier);

    const currentHpText = document.getElementById('combatCurrentHP').textContent;
    const currentVpText = document.getElementById('combatCurrentVP').textContent;
    const [currentHp, maxHp] = currentHpText.split(' / ').map(v => parseInt(v));
    const [currentVp, maxVp] = currentVpText.split(' / ').map(v => parseInt(v));

    let newHp = currentHp;
    let newVp = currentVp - vpChange;
    let vpOverflow = false;

    // Handle VP overflow to HP
    if (newVp < 0) {
      const remainingDamage = Math.abs(newVp);
      newVp = 0;
      newHp = currentHp - remainingDamage;
      vpOverflow = true;
    }

    newHp = Math.max(newHp - (hpChange > 0 && vpChange === 0 ? hpChange : 0), 0);

    // Update UI (combat popup)
    document.getElementById('combatCurrentHP').textContent = `${newHp} / ${maxHp}`;
    document.getElementById('combatCurrentVP').textContent = `${newVp} / ${maxVp}`;
    // Update Battle Page stats (may not exist if on Info Page)
    const currentHpEl = document.getElementById('currentHpValue');
    const currentVpEl = document.getElementById('currentVpValue');
    if (currentHpEl) currentHpEl.textContent = newHp;
    if (currentVpEl) currentVpEl.textContent = newVp;

    // Save to sessionStorage
    pokemonData[45] = newHp;
    pokemonData[46] = newVp;
    sessionStorage.setItem(`pokemon_${pokemonName.toLowerCase()}`, JSON.stringify(pokemonData));

    // Persist to database
    try {
      if (vpOverflow) {
        // VP overflow occurred, update both VP and HP
        await PokemonAPI.updateLiveStats(trainerData[1], pokemonData[2], 'VP', newVp);
        await PokemonAPI.updateLiveStats(trainerData[1], pokemonData[2], 'HP', newHp);
      } else {
        // Normal case - update only what changed
        if (hpChange > 0) {
          await PokemonAPI.updateLiveStats(trainerData[1], pokemonData[2], 'HP', newHp);
        }
        if (vpChange > 0) {
          await PokemonAPI.updateLiveStats(trainerData[1], pokemonData[2], 'VP', newVp);
        }
      }
    } catch (error) {
      console.error('Error updating Pokemon live stats:', error);
      showError('Failed to save HP/VP changes to database');
    }

    document.getElementById('hpChangeInput').value = '';
    document.getElementById('vpChangeInput').value = '';

    // Reset damage multiplier and deactivate type buttons
    damageMultiplier = 1;
    document.querySelectorAll('.type-button').forEach(btn => btn.classList.remove('active'));
  });

  document.getElementById('fullRestore')?.addEventListener('click', async () => {
    const currentHpText = document.getElementById('combatCurrentHP').textContent;
    const currentVpText = document.getElementById('combatCurrentVP').textContent;
    const [, maxHp] = currentHpText.split(' / ').map(v => parseInt(v));
    const [, maxVp] = currentVpText.split(' / ').map(v => parseInt(v));

    // Update UI (combat popup)
    document.getElementById('combatCurrentHP').textContent = `${maxHp} / ${maxHp}`;
    document.getElementById('combatCurrentVP').textContent = `${maxVp} / ${maxVp}`;
    // Update Battle Page stats (may not exist if on Info Page)
    const currentHpEl = document.getElementById('currentHpValue');
    const currentVpEl = document.getElementById('currentVpValue');
    if (currentHpEl) currentHpEl.textContent = maxHp;
    if (currentVpEl) currentVpEl.textContent = maxVp;

    // Save to sessionStorage
    pokemonData[45] = maxHp;
    pokemonData[46] = maxVp;
    sessionStorage.setItem(`pokemon_${pokemonName.toLowerCase()}`, JSON.stringify(pokemonData));

    // Persist to database
    try {
      await PokemonAPI.updateLiveStats(trainerData[1], pokemonData[2], 'HP', maxHp);
      await PokemonAPI.updateLiveStats(trainerData[1], pokemonData[2], 'VP', maxVp);
    } catch (error) {
      console.error('Error updating Pokemon live stats:', error);
      showError('Failed to save HP/VP restore to database');
    }

    document.getElementById('hpChangeInput').value = '';
    document.getElementById('vpChangeInput').value = '';
  });

  // Trainer Combat tracker buttons
  document.getElementById('addTrainerStats')?.addEventListener('click', async () => {
    const hpChange = parseInt(document.getElementById('trainerHpChangeInput').value) || 0;
    const vpChange = parseInt(document.getElementById('trainerVpChangeInput').value) || 0;

    const currentHpText = document.getElementById('trainerCombatCurrentHP').textContent;
    const currentVpText = document.getElementById('trainerCombatCurrentVP').textContent;
    const [currentHp, maxHp] = currentHpText.split(' / ').map(v => parseInt(v));
    const [currentVp, maxVp] = currentVpText.split(' / ').map(v => parseInt(v));

    const newHp = Math.min(currentHp + hpChange, maxHp);
    const newVp = Math.min(currentVp + vpChange, maxVp);

    // Update UI
    document.getElementById('trainerCombatCurrentHP').textContent = `${newHp} / ${maxHp}`;
    document.getElementById('trainerCombatCurrentVP').textContent = `${newVp} / ${maxVp}`;

    // Save to sessionStorage
    trainerData[34] = newHp;
    trainerData[35] = newVp;
    sessionStorage.setItem('trainerData', JSON.stringify(trainerData));

    // Persist to database
    try {
      if (hpChange !== 0) {
        await TrainerAPI.updateLiveStats(trainerData[1], 'HP', newHp);
      }
      if (vpChange !== 0) {
        await TrainerAPI.updateLiveStats(trainerData[1], 'VP', newVp);
      }
    } catch (error) {
      console.error('Error updating Trainer live stats:', error);
      showError('Failed to save Trainer HP/VP changes to database');
    }

    document.getElementById('trainerHpChangeInput').value = '';
    document.getElementById('trainerVpChangeInput').value = '';
  });

  document.getElementById('removeTrainerStats')?.addEventListener('click', async () => {
    const hpChange = parseInt(document.getElementById('trainerHpChangeInput').value) || 0;
    const vpChange = parseInt(document.getElementById('trainerVpChangeInput').value) || 0;

    const currentHpText = document.getElementById('trainerCombatCurrentHP').textContent;
    const currentVpText = document.getElementById('trainerCombatCurrentVP').textContent;
    const [currentHp, maxHp] = currentHpText.split(' / ').map(v => parseInt(v));
    const [currentVp, maxVp] = currentVpText.split(' / ').map(v => parseInt(v));

    let newHp = currentHp;
    let newVp = currentVp - vpChange;
    let vpOverflow = false;

    // Handle VP overflow to HP
    if (newVp < 0) {
      const remainingDamage = Math.abs(newVp);
      newVp = 0;
      newHp = currentHp - remainingDamage;
      vpOverflow = true;
    }

    newHp = Math.max(newHp - (hpChange > 0 && vpChange === 0 ? hpChange : 0), 0);

    // Update UI
    document.getElementById('trainerCombatCurrentHP').textContent = `${newHp} / ${maxHp}`;
    document.getElementById('trainerCombatCurrentVP').textContent = `${newVp} / ${maxVp}`;

    // Save to sessionStorage
    trainerData[34] = newHp;
    trainerData[35] = newVp;
    sessionStorage.setItem('trainerData', JSON.stringify(trainerData));

    // Persist to database
    try {
      if (vpOverflow) {
        // VP overflow occurred, update both VP and HP
        await TrainerAPI.updateLiveStats(trainerData[1], 'VP', newVp);
        await TrainerAPI.updateLiveStats(trainerData[1], 'HP', newHp);
      } else {
        // Normal case - update only what changed
        if (hpChange > 0) {
          await TrainerAPI.updateLiveStats(trainerData[1], 'HP', newHp);
        }
        if (vpChange > 0) {
          await TrainerAPI.updateLiveStats(trainerData[1], 'VP', newVp);
        }
      }
    } catch (error) {
      console.error('Error updating Trainer live stats:', error);
      showError('Failed to save Trainer HP/VP changes to database');
    }

    document.getElementById('trainerHpChangeInput').value = '';
    document.getElementById('trainerVpChangeInput').value = '';
  });

  document.getElementById('fullRestoreTrainer')?.addEventListener('click', async () => {
    const currentHpText = document.getElementById('trainerCombatCurrentHP').textContent;
    const currentVpText = document.getElementById('trainerCombatCurrentVP').textContent;
    const [, maxHp] = currentHpText.split(' / ').map(v => parseInt(v));
    const [, maxVp] = currentVpText.split(' / ').map(v => parseInt(v));

    // Update UI
    document.getElementById('trainerCombatCurrentHP').textContent = `${maxHp} / ${maxHp}`;
    document.getElementById('trainerCombatCurrentVP').textContent = `${maxVp} / ${maxVp}`;

    // Save to sessionStorage
    trainerData[34] = maxHp;
    trainerData[35] = maxVp;
    sessionStorage.setItem('trainerData', JSON.stringify(trainerData));

    // Persist to database
    try {
      await TrainerAPI.updateLiveStats(trainerData[1], 'HP', maxHp);
      await TrainerAPI.updateLiveStats(trainerData[1], 'VP', maxVp);
    } catch (error) {
      console.error('Error updating Trainer live stats:', error);
      showError('Failed to save Trainer HP/VP restore to database');
    }

    document.getElementById('trainerHpChangeInput').value = '';
    document.getElementById('trainerVpChangeInput').value = '';
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
    "Ground": "#A67C52",
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
    // Get Pokemon and trainer data from sessionStorage
    const pokemonName = sessionStorage.getItem('selectedPokemonName');
    const pokemonData = JSON.parse(sessionStorage.getItem(`pokemon_${pokemonName.toLowerCase()}`));
    const trainerData = JSON.parse(sessionStorage.getItem('trainerData'));

    // Extract needed data (convert to numbers to avoid string concatenation)
    const type1 = pokemonData[5] || '';
    const type2 = pokemonData[6] || '';
    const str = parseInt(pokemonData[15]) || 10;
    const dex = parseInt(pokemonData[16]) || 10;
    const con = parseInt(pokemonData[17]) || 10;
    const int = parseInt(pokemonData[18]) || 10;
    const wis = parseInt(pokemonData[19]) || 10;
    const cha = parseInt(pokemonData[20]) || 10;
    const proficiency = parseInt(pokemonData[31]) || 2;
    const stabBonusValue = parseInt(pokemonData[34]) || 2;
    const heldItemsStr = pokemonData[35] || '';
    const heldItems = heldItemsStr ? heldItemsStr.split(',').map(item => item.trim()).filter(item => item) : [];

    // Get Pokemon types for STAB calculation
    const pokemonTypes = [type1, type2].filter(t => t);
    const moveType = move[1];
    let hasSTAB = pokemonTypes.includes(moveType);

    // Type Master setup
    const trainerPath = trainerData[25] || '';
    const trainerLevel = parseInt(trainerData[2]) || 1;
    const specializationsStr = trainerData[24] || '';

    // Mapping from specialization names to Pokemon types
    const specializationToType = {
      'Bird Keeper': 'Flying',
      'Bug Maniac': 'Bug',
      'Camper': 'Ground',
      'Dragon Tamer': 'Dragon',
      'Engineer': 'Electric',
      'Pyromaniac': 'Fire',
      'Gardener': 'Grass',
      'Martial Artist': 'Fighting',
      'Mountaineer': 'Rock',
      'Mystic': 'Ghost',
      'Steel Worker': 'Steel',
      'Psychic': 'Psychic',
      'Swimmer': 'Water',
      'Charmer': 'Fairy',
      'Shadow': 'Dark',
      'Alchemist': 'Poison',
      'Team Player': 'Normal',
      'Ice Skater': 'Ice'
    };

    // Type Master Level 15: Universal STAB for Pokemon matching specialization types
    if (!hasSTAB && trainerPath === 'Type Master' && trainerLevel >= 15 && specializationsStr) {
      const specializations = specializationsStr.split(',').map(s => s.trim()).filter(s => s);
      const specializationTypes = specializations.map(spec => specializationToType[spec]).filter(t => t);

      // Check if Pokemon has any type matching a specialization
      const pokemonMatchesSpecialization = pokemonTypes.some(pokemonType =>
        specializationTypes.includes(pokemonType)
      );

      // Grant STAB on all moves if Pokemon type matches specialization
      if (pokemonMatchesSpecialization) {
        hasSTAB = true;
      }
    }

    // Type Master Level 3: +1 damage per Pokemon type matching specialization (only if move type also matches)
    let typeMasterDamageBonus = 0;
    if (trainerPath === 'Type Master' && trainerLevel >= 3 && specializationsStr) {
      const specializations = specializationsStr.split(',').map(s => s.trim()).filter(s => s);

      // Convert specialization names to Pokemon types
      const specializationTypes = specializations.map(spec => specializationToType[spec]).filter(t => t);

      // Check if move type matches a specialization
      const moveMatchesSpecialization = specializationTypes.includes(moveType);

      // Only apply bonus if the move type matches specialization
      if (moveMatchesSpecialization) {
        // Count how many Pokemon types match specializations
        pokemonTypes.forEach(pokemonType => {
          if (specializationTypes.includes(pokemonType)) {
            typeMasterDamageBonus++;
          }
        });
      }
    }

    // Get stat modifiers
    const strMod = Math.floor((str - 10) / 2);
    const dexMod = Math.floor((dex - 10) / 2);
    const conMod = Math.floor((con - 10) / 2);
    const intMod = Math.floor((int - 10) / 2);
    const wisMod = Math.floor((wis - 10) / 2);
    const chaMod = Math.floor((cha - 10) / 2);

    // Parse move modifiers (e.g., "STR/DEX")
    const moveModifiers = move[2].split('/').map(m => m.trim().toUpperCase());
    const modifierValues = {
      'STR': strMod,
      'DEX': dexMod,
      'CON': conMod,
      'INT': intMod,
      'WIS': wisMod,
      'CHA': chaMod
    };

    // Get highest stat modifier from move's allowed modifiers
    const allowedModifiers = moveModifiers
      .map(mod => modifierValues[mod])
      .filter(val => val !== undefined);
    const highestMod = allowedModifiers.length > 0 ? Math.max(...allowedModifiers) : 0;

    // Find which stat is being used (for display purposes)
    const usedStat = moveModifiers.find(mod => modifierValues[mod] === highestMod) || '';

    // Check for Ace Trainer bonus (Level 3+: +1 to attack and damage)
    const aceTrainerBonus = (trainerPath === 'Ace Trainer' && trainerLevel >= 3) ? 1 : 0;

    // Type Master Level 5: +2 to attack if Pokemon type matches AND move type matches specialization
    let typeMasterAttackBonus = 0;
    if (trainerPath === 'Type Master' && trainerLevel >= 5 && specializationsStr) {
      const specializations = specializationsStr.split(',').map(s => s.trim()).filter(s => s);

      // Convert specialization names to Pokemon types
      const specializationTypes = specializations.map(spec => specializationToType[spec]).filter(t => t);

      // Check if Pokemon has a type matching a specialization
      const pokemonHasSpecializationType = pokemonTypes.some(pokemonType =>
        specializationTypes.includes(pokemonType)
      );

      // Check if the move type matches a specialization
      const moveMatchesSpecialization = specializationTypes.includes(moveType);

      // Apply bonus if Pokemon type matches AND move type matches
      if (pokemonHasSpecializationType && moveMatchesSpecialization) {
        typeMasterAttackBonus = 2;
      }
    }

    // Calculate Attack Roll bonus
    const proficiencyBonus = hasSTAB ? proficiency : 0;
    const attackRollBonus = proficiencyBonus + highestMod + aceTrainerBonus + typeMasterAttackBonus;

    // Calculate Damage Roll bonus
    const stabBonus = hasSTAB ? stabBonusValue : 0;
    const damageRollBonus = stabBonus + highestMod + aceTrainerBonus + typeMasterDamageBonus;

    // Create breakdown text
    const attackBreakdownParts = [];
    if (proficiencyBonus > 0) {
      attackBreakdownParts.push(`Proficiency +${proficiencyBonus}`);
    }
    if (highestMod !== 0) {
      attackBreakdownParts.push(`${usedStat} ${highestMod >= 0 ? '+' : ''}${highestMod}`);
    }
    if (aceTrainerBonus > 0) {
      attackBreakdownParts.push(`Ace Trainer +${aceTrainerBonus}`);
    }
    if (typeMasterAttackBonus > 0) {
      attackBreakdownParts.push(`Type Master +${typeMasterAttackBonus}`);
    }
    const attackBreakdown = attackBreakdownParts.length > 0 ? `(${attackBreakdownParts.join(', ')})` : '';

    const damageBreakdownParts = [];
    if (stabBonus > 0) {
      damageBreakdownParts.push(`STAB +${stabBonus}`);
    }
    if (highestMod !== 0) {
      damageBreakdownParts.push(`${usedStat} ${highestMod >= 0 ? '+' : ''}${highestMod}`);
    }
    if (aceTrainerBonus > 0) {
      damageBreakdownParts.push(`Ace Trainer +${aceTrainerBonus}`);
    }
    if (typeMasterDamageBonus > 0) {
      damageBreakdownParts.push(`Type Master +${typeMasterDamageBonus}`);
    }
    const damageBreakdown = damageBreakdownParts.length > 0 ? `(${damageBreakdownParts.join(', ')})` : '';

    // Get held items info
    const heldItemsInfo = heldItems.length > 0
      ? heldItems.map(itemName => {
          const itemsData = JSON.parse(sessionStorage.getItem('items')) || [];
          const item = itemsData.find(i => i.name === itemName);
          return item ? `<div style="margin-bottom: 0.8rem;"><strong>${item.name}:</strong> ${item.effect || item.description || 'No description'}</div>` : `<div style="margin-bottom: 0.8rem;"><strong>${itemName}:</strong> No description available</div>`;
        }).join('')
      : '<div style="color: #999;">No held items</div>';

    // Create popup if it doesn't exist
    let popup = document.getElementById('moveDetailsPopup');
    if (!popup) {
      popup = document.createElement('div');
      popup.id = 'moveDetailsPopup';
      popup.style.cssText = 'display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); z-index: 1000; justify-content: center; align-items: center; backdrop-filter: blur(3px);';

      const popupContent = document.createElement('div');
      popupContent.id = 'movePopupContent';
      popupContent.style.cssText = 'background: white; border-radius: clamp(15px, 2vh, 20px); padding: 0; max-width: 600px; width: 90%; max-height: 85vh; overflow-y: auto; position: relative; box-shadow: 0 10px 40px rgba(0,0,0,0.3);';

      popupContent.innerHTML = `
        <div id="movePopupHeader" style="padding: clamp(1.2rem, 2vh, 1.5rem); border-radius: clamp(15px, 2vh, 20px) clamp(15px, 2vh, 20px) 0 0; border-bottom: 2px solid rgba(0,0,0,0.2); position: relative; display: flex; align-items: center; gap: 0.8rem; flex-wrap: wrap;">
          <button id="closeMovePopupX" style="position: absolute; top: clamp(0.8rem, 1.5vh, 1.2rem); right: clamp(0.8rem, 1.5vh, 1.2rem); background: rgba(0,0,0,0.2); color: white; border: 2px solid rgba(255,255,255,0.3); border-radius: 50%; width: clamp(32px, 5vh, 40px); height: clamp(32px, 5vh, 40px); font-size: clamp(1.2rem, 2.2vh, 1.5rem); font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s;">×</button>
          <h2 id="moveNamePopup" style="margin: 0; font-size: clamp(1.5rem, 2.8vh, 2rem); font-weight: 900; text-transform: uppercase; letter-spacing: 1px;"></h2>
          <div id="moveTypePopup" style="display: inline-block; padding: 0.3rem 0.8rem; border-radius: 20px; font-size: clamp(0.85rem, 1.5vh, 1rem); font-weight: 700; background: rgba(255,255,255,0.3);"></div>
        </div>
        <div id="movePopupBody" style="padding: clamp(1.2rem, 2vh, 1.5rem); border-radius: 0 0 clamp(15px, 2vh, 20px) clamp(15px, 2vh, 20px);">
          <div style="font-size: clamp(0.9rem, 1.6vh, 1.05rem); line-height: 1.5;">
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.4rem; margin-bottom: 0.8rem;">
              <div><strong>Modifier:</strong> <span id="moveModifierPopup"></span></div>
              <div><strong>Action Type:</strong> <span id="moveActionTypePopup"></span></div>
              <div><strong>VP Cost:</strong> <span id="moveVPCostPopup"></span></div>
              <div><strong>Duration:</strong> <span id="moveDurationPopup"></span></div>
              <div style="grid-column: 1 / -1;"><strong>Range:</strong> <span id="moveRangePopup"></span></div>
            </div>
            <div style="margin-bottom: 0.8rem; padding: 0.8rem; background: rgba(0,0,0,0.1); border-radius: 8px;">
              <strong>Description:</strong> <div id="moveDescriptionPopup" style="margin-top: 0.4rem;"></div>
            </div>
            <div style="margin-bottom: 0.8rem;">
              <strong>Higher Levels:</strong> <span id="moveHigherLevelsPopup"></span>
            </div>
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; margin-bottom: 0.8rem; padding: 0.8rem; background: rgba(0,0,0,0.15); border-radius: 8px;">
              <div>
                <strong>Attack Roll:</strong> <span id="attackRollBonus" style="font-size: 1.2em; font-weight: bold;">+</span>
                <div id="attackRollBreakdown" style="font-size: 0.75em; opacity: 0.8; margin-top: 0.3rem;"></div>
              </div>
              <div>
                <strong>Damage Roll:</strong> <span id="damageRollBonus" style="font-size: 1.2em; font-weight: bold;">+</span>
                <div id="damageRollBreakdown" style="font-size: 0.75em; opacity: 0.8; margin-top: 0.3rem;"></div>
              </div>
            </div>
            <div style="margin-bottom: 1rem; padding: 0.8rem; background: rgba(0,0,0,0.1); border-radius: 8px; border-left: 4px solid rgba(0,0,0,0.3);">
              <strong style="display: block; margin-bottom: 0.5rem;">Held Items:</strong>
              <div id="heldItemsInfo"></div>
            </div>
            <div id="battleDiceContainer"></div>
          </div>
          <button id="useMoveButton" style="width: 100%; padding: clamp(0.8rem, 1.5vh, 1rem); background: linear-gradient(135deg, #4CAF50 0%, #45A049 100%); color: white; border: none; border-radius: 8px; cursor: pointer; font-size: clamp(1rem, 1.8vh, 1.1rem); font-weight: bold; transition: all 0.3s; box-shadow: 0 4px 12px rgba(76,175,80,0.3);">Use Move</button>
        </div>
      `;

      popup.appendChild(popupContent);
      document.body.appendChild(popup);

      // Create confirmation popup if it doesn't exist
      let confirmPopup = document.getElementById('useMoveConfirmPopup');
      if (!confirmPopup) {
        confirmPopup = document.createElement('div');
        confirmPopup.id = 'useMoveConfirmPopup';
        confirmPopup.style.cssText = 'display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); z-index: 2000; justify-content: center; align-items: center; backdrop-filter: blur(3px);';

        const confirmContent = document.createElement('div');
        confirmContent.style.cssText = 'background: white; border-radius: 15px; padding: 2rem; max-width: 400px; width: 90%; box-shadow: 0 10px 40px rgba(0,0,0,0.3); text-align: center;';

        confirmContent.innerHTML = `
          <h2 style="margin: 0 0 1rem 0; font-size: 1.5rem; color: #333;">Use Move?</h2>
          <p id="confirmMoveText" style="margin: 0 0 1.5rem 0; font-size: 1.1rem; color: #666;"></p>
          <div style="display: flex; gap: 1rem; justify-content: center;">
            <button id="confirmUseMoveYes" style="flex: 1; padding: 0.75rem 1.5rem; background: linear-gradient(135deg, #4CAF50 0%, #45A049 100%); color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 1rem; font-weight: bold; transition: all 0.3s;">Yes</button>
            <button id="confirmUseMoveNo" style="flex: 1; padding: 0.75rem 1.5rem; background: linear-gradient(135deg, #EE1515 0%, #C91010 100%); color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 1rem; font-weight: bold; transition: all 0.3s;">No</button>
          </div>
        `;

        confirmPopup.appendChild(confirmContent);
        document.body.appendChild(confirmPopup);

        // Close when clicking outside
        confirmPopup.addEventListener('click', (e) => {
          if (e.target.id === 'useMoveConfirmPopup') {
            confirmPopup.style.display = 'none';
          }
        });
      }

      // Close X button listener
      document.getElementById('closeMovePopupX').addEventListener('click', () => {
        popup.style.display = 'none';
      });

      // Close when clicking outside
      popup.addEventListener('click', (e) => {
        if (e.target.id === 'moveDetailsPopup') {
          popup.style.display = 'none';
        }
      });

      // Use Move button listener - show confirmation
      // Note: This listener is only set up once, so it gets the move data from the button's dataset
      document.getElementById('useMoveButton').addEventListener('click', () => {
        const btn = document.getElementById('useMoveButton');
        const moveName = btn.dataset.moveName;
        const vpCost = parseInt(btn.dataset.vpCost) || 0;

        // Update confirmation text
        document.getElementById('confirmMoveText').textContent = `Use ${moveName} (${vpCost} VP)?`;

        // Show confirmation popup
        document.getElementById('useMoveConfirmPopup').style.display = 'flex';
      });

      // Confirmation Yes button
      document.getElementById('confirmUseMoveYes').addEventListener('click', async () => {
        // Get VP cost from the button's dataset (updated each time a move is shown)
        // NOT from the closure variable which only captures the first move
        const useMoveBtn = document.getElementById('useMoveButton');
        const vpCost = parseInt(useMoveBtn.dataset.vpCost) || 0;
        const currentVpText = document.getElementById('combatCurrentVP')?.textContent || '0 / 0';
        const currentHpText = document.getElementById('combatCurrentHP')?.textContent || '0 / 0';
        const [currentVp, maxVp] = currentVpText.split(' / ').map(v => parseInt(v));
        const [currentHp, maxHp] = currentHpText.split(' / ').map(v => parseInt(v));

        let newVp = currentVp - vpCost;
        let newHp = currentHp;
        let vpOverflow = false;

        // Handle VP overflow to HP
        if (newVp < 0) {
          const excessVpCost = Math.abs(newVp);
          newVp = 0;
          newHp = Math.max(currentHp - excessVpCost, 0);
          vpOverflow = true;
        }

        // Update UI (combat popup)
        document.getElementById('combatCurrentVP').textContent = `${newVp} / ${maxVp}`;
        document.getElementById('combatCurrentHP').textContent = `${newHp} / ${maxHp}`;
        // Update Battle Page stats (may not exist if on Info Page)
        const currentVpEl = document.getElementById('currentVpValue');
        const currentHpEl = document.getElementById('currentHpValue');
        if (currentVpEl) currentVpEl.textContent = newVp;
        if (currentHpEl) currentHpEl.textContent = newHp;

        // Save to sessionStorage
        pokemonData[46] = newVp;
        pokemonData[45] = newHp;
        sessionStorage.setItem(`pokemon_${pokemonName.toLowerCase()}`, JSON.stringify(pokemonData));

        // Close both popups immediately
        document.getElementById('useMoveConfirmPopup').style.display = 'none';
        popup.style.display = 'none';

        // Persist to database in background (don't wait)
        PokemonAPI.updateLiveStats(trainerData[1], pokemonData[2], 'VP', newVp)
          .catch(error => console.error('Error updating VP:', error));

        if (vpOverflow) {
          PokemonAPI.updateLiveStats(trainerData[1], pokemonData[2], 'HP', newHp)
            .catch(error => console.error('Error updating HP:', error));
        }
      });

      // Confirmation No button
      document.getElementById('confirmUseMoveNo').addEventListener('click', () => {
        document.getElementById('useMoveConfirmPopup').style.display = 'none';
      });

      // Hover effect for X button
      const closeBtn = document.getElementById('closeMovePopupX');
      closeBtn.addEventListener('mouseenter', () => {
        closeBtn.style.background = 'rgba(255,255,255,0.3)';
        closeBtn.style.transform = 'scale(1.1)';
      });
      closeBtn.addEventListener('mouseleave', () => {
        closeBtn.style.background = 'rgba(0,0,0,0.2)';
        closeBtn.style.transform = 'scale(1)';
      });

      // Hover effect for Use Move button
      const useMoveBtn = document.getElementById('useMoveButton');
      useMoveBtn.addEventListener('mouseenter', () => {
        useMoveBtn.style.transform = 'translateY(-2px)';
        useMoveBtn.style.boxShadow = '0 6px 16px rgba(76,175,80,0.4)';
      });
      useMoveBtn.addEventListener('mouseleave', () => {
        useMoveBtn.style.transform = 'translateY(0)';
        useMoveBtn.style.boxShadow = '0 4px 12px rgba(76,175,80,0.3)';
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
    document.getElementById('attackRollBonus').textContent = `+${attackRollBonus}`;
    document.getElementById('damageRollBonus').textContent = `+${damageRollBonus}`;
    document.getElementById('attackRollBreakdown').textContent = attackBreakdown;
    document.getElementById('damageRollBreakdown').textContent = damageBreakdown;
    document.getElementById('heldItemsInfo').innerHTML = heldItemsInfo;

    // Populate battle dice tracker for Ace Trainer
    // Note: trainerPath already declared above for Ace Trainer bonus calculation
    const battleDiceContainer = document.getElementById('battleDiceContainer');

    if (trainerPath === 'Ace Trainer') {
      const battleDiceData = trainerData[45] || '';
      let currentCharges = 0;
      let maxCharges = 0;

      if (battleDiceData) {
        // Parse format "5 - 4" (max - current)
        const parts = battleDiceData.split('-').map(p => p.trim());
        if (parts.length === 2) {
          maxCharges = parseInt(parts[0], 10) || 0;
          currentCharges = parseInt(parts[1], 10) || 0;
        }
      }

      // Create charge dots HTML
      let chargeDotsHTML = '<div class="charge-dots">';
      for (let i = 0; i < maxCharges; i++) {
        const filled = i < currentCharges;
        chargeDotsHTML += `<span class="charge-dot ${filled ? 'filled' : 'empty'}"></span>`;
      }
      chargeDotsHTML += '</div>';

      // Build battle dice UI
      const useButtonDisabled = currentCharges <= 0 ? 'disabled' : '';
      battleDiceContainer.innerHTML = `
        <div class="battle-dice-container">
          <div style="display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.5rem;">
            <strong>Battle Dice (d6):</strong>
            ${chargeDotsHTML}
          </div>
          <div style="display: flex; align-items: center; gap: 0.8rem; justify-content: space-between;">
            <div style="font-size: 0.85rem; opacity: 0.9;">
              Add 1d6 to your next attack or damage roll
            </div>
            <button class="use-battle-dice-button" id="useBattleDiceButton" ${useButtonDisabled} style="flex-shrink: 0;">Use Battle Dice</button>
          </div>
        </div>
      `;

      // Add event listener for Use Battle Dice button
      const useBattleDiceBtn = document.getElementById('useBattleDiceButton');
      if (useBattleDiceBtn) {
        useBattleDiceBtn.addEventListener('click', () => {
          if (currentCharges > 0) {
            // Decrement charge
            currentCharges--;

            // Update trainer data
            trainerData[45] = `${maxCharges} - ${currentCharges}`;
            sessionStorage.setItem('trainerData', JSON.stringify(trainerData));

            // Update UI
            const chargeDots = battleDiceContainer.querySelectorAll('.charge-dot');
            chargeDots.forEach((dot, index) => {
              if (index < currentCharges) {
                dot.classList.add('filled');
                dot.classList.remove('empty');
              } else {
                dot.classList.remove('filled');
                dot.classList.add('empty');
              }
            });

            // Disable button if no charges left
            if (currentCharges <= 0) {
              useBattleDiceBtn.disabled = true;
            }

            // Persist to database in background
            TrainerAPI.update(trainerData)
              .catch(error => console.error('Error updating battle dice:', error));

            // Show success message
            showSuccess('Battle Dice used! Roll 1d6 and add to attack or damage.');
          }
        });
      }
    } else {
      battleDiceContainer.innerHTML = '';
    }

    // Set dataset attributes for Use Move button
    const useMoveBtn = document.getElementById('useMoveButton');
    useMoveBtn.dataset.moveName = move[0];
    useMoveBtn.dataset.vpCost = move[4];

    // Apply type color to popup header and body
    const bgColor = getMoveTypeColor(move[1]);
    const textColor = getTextColorForBackground(bgColor);
    const header = document.getElementById('movePopupHeader');
    const body = document.getElementById('movePopupBody');
    header.style.backgroundColor = bgColor;
    header.style.color = textColor;
    body.style.backgroundColor = bgColor;
    body.style.color = textColor;
    document.getElementById('moveTypePopup').style.color = textColor;

    popup.style.display = 'flex';
  }
}
