// Code.gs
// Constants
const IMG_BASE_URL = 'https://raw.githubusercontent.com/Benjakronk/shima-pokedex/main/images/';
const IMG_FORMATS = ['png', 'jpg', 'jpeg', 'jfif'];
const IMG_BACKGROUND = 'https://raw.githubusercontent.com/Benjakronk/shima-pokedex/main/images/background/background.png';
const POKEMON_DATA_URL = 'https://script.google.com/macros/s/AKfycbwIT3OS2bdCv2kkDPh6IjRRirv17iPnuttlPcY47LCHBbpNPuHF_IjVq0mCt7TkkWoW/exec?action=pokemon';
const MOVE_DATA_URL = 'https://script.google.com/macros/s/AKfycbz5jkSQ1HuCpCrbg_mePsfLDaoesjCvrX_fCAhJvTC5V3IddYmtjVJnh4_2YaX37Dkj/exec?action=moves';
const ITEMS_DATA = 'https://script.google.com/macros/s/AKfycbwIT3OS2bdCv2kkDPh6IjRRirv17iPnuttlPcY47LCHBbpNPuHF_IjVq0mCt7TkkWoW/exec?action=items';
const REGISTERED_POKEMON_URL = 'https://raw.githubusercontent.com/Benjakronk/shima-pokedex/main/pokedex_config.json';
const SPREADSHEET = SpreadsheetApp.openById('1lt2EE5lSeEhYyVDjC1KcpuVU8_VitHpNqeRh6lknSJM');
const TRAINER_DATA_SHEET = SPREADSHEET.getSheetByName('Trainer Data');
const POKEMON_DATA_SHEET = SPREADSHEET.getSheetByName('Pokemon Data');
const NATURE_DATA_SHEET = SPREADSHEET.getSheetByName('Natures');
const FEATS_DATA_SHEET = SPREADSHEET.getSheetByName('Trainer Feat');
const ITEMS_DATA_SHEET = SpreadsheetApp.openById('1wtx2ylMhbk-aQz8ZyZQjbK_D8w3oA8vlydyCmIPvgUc').getSheetByName('Item list');
const FEATSLIST_DATA_SHEET = SPREADSHEET.getSheetByName('Feat list');
const TYPE_DATA_SHEET = SPREADSHEET.getSheetByName('Type Chart');
const CONDUIT_AWAKENING_SHEET = SPREADSHEET.getSheetByName('Conduit Awakening');
const CONDUIT_BATTLE_STYLE_SHEET = SPREADSHEET.getSheetByName('Conduit Battle Style');
const CONDUIT_FEATURES_SHEET = SPREADSHEET.getSheetByName('Conduit Features');
const TRAINER_COLUMN_INDICES = {
  image: 0,
  name: 1,
  level: 2,
  hitDice: 3,
  vitalityDice: 4,
  strength: 5,
  dexterity: 6,
  constitution: 7,
  intelligence: 8,
  wisdom: 9,
  charisma: 10,
  hp: 11,
  vp: 12,
  ac: 13,
  walkingSpeed: 14,
  savingThrows: 15,
  initiative: 16,
  proficiency: 17,
  skills: 18,
  money: 19,
  inventory: 20,
  leaguePoints: 21,
  pinCode: 22,
  affinity: 23,
  specialization: 24,
  trainerpath: 25,
  pokeslots: 26,
  strmodifier: 27,
  dexmodifier: 28,
  conmodifier: 29,
  intmodifier: 30,
  wismodifier: 31,
  chamodifier: 32,
  feats: 33,
  currentHP: 34,
  currentVP: 35,
  currentAC: 36,
  gear: 37,
  region: 38,
  trainerClass: 39,
  secondWindCharges: 40,
  rapidOrdersCharges: 41,
  unbreakableBondCharges: 42,
  elementalSynergyCharges: 43,
  masterTrainerCharges: 44,
  battleDice: 45,
  maxPotential: 46,
  currentHD: 47,
  currentVD: 48
};
const POKEMON_COLUMN_INDICES = {
  trainername: 0,
  image: 1,
  name: 2,
  dexentry: 3,
  level: 4,
  primarytype: 5,
  secondarytype: 6,
  ability: 7,
  ac: 8,
  hitdice: 9,
  hp: 10,
  vitalitydice: 11,
  vp: 12,
  speed: 13,
  totalstats: 14,
  strenght: 15,
  dexterity: 16,
  constitution: 17,
  intelligence: 18,
  wisdom: 19,
  charisma: 20,
  savingthrows: 21,
  skills: 22,
  startingmoves: 23,
  level2moves: 24,
  level6moves: 25,
  level10moves: 26,
  level14moves: 27,
  level18moves: 28,
  evolutionrequirement: 29,
  initiative: 30,
  proficiencybonus: 31,
  nature: 32,
  loyalty: 33,
  stab: 34,
  helditem: 35,
  nickname: 36,
  custommoves: 37,
  inactiveparty: 38,
  strmodifier: 39,
  dexmodifier: 40,
  conmodifier: 41,
  intmodifier: 42,
  wismodifier: 43,
  chamodifier: 44,
  currentHP: 45,
  currentVP: 46,
  currentAC: 47,
  comment: 48,
  senses: 49,
  feats: 50,
  gear: 51,
  flavortext: 52,
  typematchups: 53,
  currentHD: 54,
  currentVD: 55,
  utilityslot: 56,
  size: 57
};
const REGISTERED_POKEMON_COLUMN_INDICES = {
  trainername: 0,
  image: 1,
  name: 2,
  dexentry: 3,
  level: 4,
  primarytype: 5,
  secondarytype: 6,
  ability: 7,
  ac: 8,
  hitdice: 9,
  hp: 10,
  vitalitydice: 11,
  vp: 12,
  speed: 13,
  totalstats: 14,
  strenght: 15,
  dexterity: 16,
  constitution: 17,
  intelligence: 18,
  wisdom: 19,
  charisma: 20,
  savingthrows: 21,
  skills: 22,
  startingmoves: 23,
  level2moves: 24,
  level6moves: 25,
  level10moves: 26,
  level14moves: 27,
  level18moves: 28,
  evolutionrequirement: 29,
  initiative: 30,
  proficiencybonus: 31,
  nature: 32,
  loyalty: 33,
  stab: 34,
  helditem: 35,
  nickname: 36,
  custommoves: 37,
  inactiveparty: 38,
  strmodifier: 39,
  dexmodifier: 40,
  conmodifier: 41,
  intmodifier: 42,
  wismodifier: 43,
  chamodifier: 44,
  currentHP: 45,
  currentVP: 46,
  currentAC: 47,
  comment: 48,
  senses: 49,
  feats: 50,
  gear: 51,
  flavortext: 52,
  typematchups: 53,
  currentHD: 54,
  currentVD: 55,
  utilityslot: 56,
  size: 57
};

// ------------------------------------------------------------------Import Pokémon information Start--------------------------------------------------
// Import Move Data from external source
function fetchMoveData() {
    const response = UrlFetchApp.fetch(MOVE_DATA_URL);
    const jsonData = JSON.parse(response.getContentText());
    return jsonData;
}

// Importing registered pokemon data from external source
function fetchRegisteredPokemon() {
  const now = Date.now();
  
  // Return cached data if available and not expired
  if (cachedRegisteredNames && cacheTimestamp && (now - cacheTimestamp < CACHE_DURATION)) {
    Logger.log('Using cached registered Pokemon names');
    return cachedRegisteredNames;
  }
  
  const startTime = Date.now();
  try {
    const response = UrlFetchApp.fetch(REGISTERED_POKEMON_URL);
    const data = JSON.parse(response.getContentText());
    const endTime = Date.now();

    // Update cache with both registered names and full config
    cachedRegisteredNames = data.registered;
    cachedPokedexConfig = data; // Store full config (visibility, defaults, extraSearchableMoves, splashCount)
    cacheTimestamp = now;

    Logger.log('fetchRegisteredPokemon: ' + (endTime - startTime) + ' ms');
    return data.registered;
  } catch (error) {
    Logger.log("Error fetching registered Pokémon: " + error.toString());

    // Return cached data if available, even if expired
    if (cachedRegisteredNames) {
      Logger.log('Using expired cache due to fetch error');
      return cachedRegisteredNames;
    }

    return [];
  }
}

// Function to get the full Pokedex config (visibility, defaults, etc.)
// This is for future use when implementing visibility controls
function getPokedexConfig() {
  const now = Date.now();

  // Return cached config if available and not expired
  if (cachedPokedexConfig && cacheTimestamp && (now - cacheTimestamp < CACHE_DURATION)) {
    Logger.log('Using cached Pokedex config');
    return cachedPokedexConfig;
  }

  // If cache is expired or not available, fetch new data
  const startTime = Date.now();
  try {
    const response = UrlFetchApp.fetch(REGISTERED_POKEMON_URL);
    const data = JSON.parse(response.getContentText());
    const endTime = Date.now();

    // Update cache
    cachedPokedexConfig = data;
    cachedRegisteredNames = data.registered;
    cacheTimestamp = now;

    Logger.log('getPokedexConfig: ' + (endTime - startTime) + ' ms');
    return data;
  } catch (error) {
    Logger.log("Error fetching Pokedex config: " + error.toString());

    // Return cached data if available, even if expired
    if (cachedPokedexConfig) {
      Logger.log('Using expired Pokedex config cache due to fetch error');
      return cachedPokedexConfig;
    }

    // Return minimal structure if no cache available
    return {
      registered: [],
      visibility: {},
      defaults: {},
      extraSearchableMoves: [],
      splashCount: 0
    };
  }
}

// This can be called from the client when needed
function batchResolveImageUrls(pokemonList) {
  const results = [];
  
  for (const pokemon of pokemonList) {
    const name = pokemon.name;
    const id = pokemon.id;
    
    const paddedId = id.toString().padStart(3, '0');
    const sanitizedName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const baseFileName = `${paddedId}-${sanitizedName}`;
    
    // Just return the most likely URL without checking
    // Client will handle fallbacks
    results.push({
      name: name,
      id: id,
      url: `${IMG_BASE_URL}${baseFileName}.png`
    });
  }
  
  return results;
}

// Caching mechanism for registered pokemon names and config
let cachedRegisteredNames = null;
let cachedPokedexConfig = null; // Full config including visibility, defaults, etc.
let cacheTimestamp = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------Search in registered Pokémon for all seen Pokémon---------------------------------------------------
function getCompletePokemonData() {
  const startTime = Date.now();
  const registeredNames = fetchRegisteredPokemon(); // Fetch registered Pokémon names
  Logger.log('Registered Names: ' + registeredNames);

  try {
    const response = UrlFetchApp.fetch(POKEMON_DATA_URL);
    const allPokemonData = JSON.parse(response.getContentText());

    // Filter the complete data to include only registered Pokémon
    const filteredData = allPokemonData.filter((pokemon) => 
      registeredNames.includes(pokemon[2]) // Check if the Pokémon name (third element) is in the registered list
    ); 

    // Extract and format the required data for each Pokémon
    const formattedData = filteredData.map((row) => {
    //const formattedData = allPokemonData.map((row) => {
      const imageUrl = getImageUrl(row[2], row[1]); 
      const primaryAbility = row[15] ? { name: row[15], description: row[62] ?? "No description available" } : null;
      const secondaryAbility = row[16] ? { name: row[16], description: row[63] ?? "No description available" } : null;
      const hiddenAbility = row[17] ? { name: row[17], description: row[64] ?? "No description available" } : null;

      // Extract Movement Data (Indexes 65 to 70)
      const movementData = {
        walking: row[65],
        climbing: row[66],
        flying: row[67],
        hovering: row[68],
        swimming: row[69],
        burrowing: row[70]
      };

      // Extract Senses Data (Indexes 71 to 76)
      const sensesData = {
        sight: row[71],
        hearing: row[72],
        smell: row[73],
        tremorsense: row[74],
        echolocation: row[75],
        telepathy: row[76],
        blindsight: row[77],
        darkvision: row[78],
        truesight: row[79]
      };

      const endTime = Date.now();
      Logger.log('getCompletePokemonData: ' + (endTime - startTime) + ' ms');

      return [
        imageUrl,       // 0: image
        row[2],         // 1: name
        row[1],         // 2: id
        row[19],        // 3: level
        row[7],         // 4: primaryType
        row[8],         // 5: secondaryType
        formatAbility(primaryAbility),  // 6: Formatted primaryAbility
        formatAbility(secondaryAbility),  // 7: Formatted secondaryAbility
        formatAbility(hiddenAbility),  // 8: Formatted hiddenAbility
        row[20],        // 9: ac
        row[21],        // 10: hitDice
        row[22],        // 11: hp
        row[23],        // 12: vitalityDice
        row[24],        // 13: vp
        row[25],        // 14: speed
        row[26],        // 15: totalstats
        row[27],        // 16: strength
        row[28],        // 17: dexterity
        row[29],        // 18: constitution
        row[30],        // 19: intelligence
        row[31],        // 20: wisdom
        row[32],        // 21: charisma
        row[33],        // 22: savingThrows
        row[34],        // 23: skills
        sanitizeMoves(row[35], 4),  // 24: moves.starting
        sanitizeMoves(row[36], 4),  // 25: moves.level2
        sanitizeMoves(row[37], 4),  // 26: moves.level6
        sanitizeMoves(row[38], 4),  // 27: moves.level10
        sanitizeMoves(row[39], 3),  // 28: moves.level14
        sanitizeMoves(row[40], 3),  // 29: moves.level18
        row[14],        // 30: evolutionReq
        movementData,   // 31: Movement data
        sensesData,     // 32: Sense data
        row[6],         // 33: Flavor text
        row[9]          // 34: Size
      ];
    });
    Logger.log("FORMATTEDDATA: " + JSON.stringify(formattedData, null, 2));
    // Return the formatted data to the client
    return formattedData;

  } catch (error) {
    Logger.log("Error fetching complete Pokémon data: " + error.toString());
    return [];
  }
}

// Helper function to store data in session storage
function storeDataInSessionStorage(key, data) {
  const script = `
    sessionStorage.setItem('${key}', JSON.stringify(${data}));
  `;
  HtmlService.createHtmlOutput(`<script>${script}</script>`);
}

function formatAbility(ability) {
  if (ability && ability.name && ability.description) {
    return `${ability.name}, ${ability.description}`;
  } else if (ability && ability.name) {
    return ability.name;
  } else if (ability && ability.description) {
    return ability.description;
  }
  return '';
}

function sanitizeMoves(moveString, maxMoves) {
    return moveString
        .split(',')
        .map(move => move.trim())
        .filter(move => move !== '')
        .slice(0, maxMoves)
        .join(', ');
}

function getImageUrl(pokemonName, pokemonId) {
    const startTime = Date.now();
    const paddedId = pokemonId.toString().padStart(3, '0');
    const sanitizedName = pokemonName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const baseFileName = `${paddedId}-${sanitizedName}`;
    for (const format of IMG_FORMATS) {
        const url = `${IMG_BASE_URL}${baseFileName}.${format}`;
        if (imageExists(url)) {
            const endTime = Date.now();
            Logger.log('getImageUrl: ' + (endTime - startTime) + ' ms');
            return url;
        }
    }
    return null;
}

function imageExists(url) {
  try {
    const response = UrlFetchApp.fetch(url);
    return response.getResponseCode() === 200;
  } catch (e) {
    return false;
  }
}

function getPokemonListByTrainer(trainerName) {
  const data = POKEMON_DATA_SHEET.getDataRange().getValues();
  const header = data[0];
  const trainerIndex = header.indexOf('Trainer Name');
  const nameIndex = header.indexOf('Name');
  
  if (trainerIndex === -1 || nameIndex === -1) {
    throw new Error('Required columns are missing in the sheet');
  }

  const pokemonList = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][trainerIndex] === trainerName) {
      pokemonList.push(data[i][nameIndex]);
    }
  }
  
  return pokemonList;
}

// ------------------------------------------------------------------Import Pokémon information End----------------------------------------------------


// ------------------------------------------------------------------Write Pokémon to Google Sheet Start-----------------------------------------------
// Function to register the Pokémon for the trainer with additional data
function registerPokemonForTrainer(trainerName, newPokemonData) {
    // Calculate HP and VP before saving
    // Use exact indices matching database schema (single ability at index 7)
    const level = parseInt(newPokemonData[4], 10);   // Level
    const hd = parseInt(newPokemonData[9], 10);      // Hit Dice
    const vd = parseInt(newPokemonData[11], 10);     // Vitality Dice
    const str = parseInt(newPokemonData[15], 10);    // Strength
    const dex = parseInt(newPokemonData[16], 10);    // Dexterity
    const con = parseInt(newPokemonData[17], 10);    // Constitution
    const int = parseInt(newPokemonData[18], 10);    // Intelligence
    const wis = parseInt(newPokemonData[19], 10);    // Wisdom
    const cha = parseInt(newPokemonData[20], 10);    // Charisma
    const loyalty = parseInt(newPokemonData[33], 10) || 0;  // Loyalty

    // Calculate HP/VP
    const { hp, vp } = calculateHpVp(str, dex, con, int, wis, cha, level, hd, vd, loyalty);

    // Calculate modifiers
    const strMod = Math.floor((str - 10) / 2);
    const dexMod = Math.floor((dex - 10) / 2);
    const conMod = Math.floor((con - 10) / 2);
    const intMod = Math.floor((int - 10) / 2);
    const wisMod = Math.floor((wis - 10) / 2);
    const chaMod = Math.floor((cha - 10) / 2);

    // Calculate other values
    const proficiencyBonus = level <= 4 ? 2 : level <= 8 ? 3 : level <= 12 ? 4 : level <= 16 ? 5 : 6;
    const initiative = dexMod;
    const stabBonus = level <= 2 ? 0 : level <= 6 ? 2 : level <= 10 ? 4 : level <= 14 ? 6 : level <= 18 ? 8 : 10;

    // Update pokemonData with calculated values using exact indices
    newPokemonData[10] = hp;              // HP
    newPokemonData[12] = vp;              // VP
    newPokemonData[30] = initiative;      // Initiative
    newPokemonData[31] = proficiencyBonus;  // Proficiency Bonus
    newPokemonData[34] = stabBonus;       // STAB
    newPokemonData[39] = strMod;          // STR modifier
    newPokemonData[40] = dexMod;          // DEX modifier
    newPokemonData[41] = conMod;          // CON modifier
    newPokemonData[42] = intMod;          // INT modifier
    newPokemonData[43] = wisMod;          // WIS modifier
    newPokemonData[44] = chaMod;          // CHA modifier
    newPokemonData[45] = hp;              // CurrentHP
    newPokemonData[46] = vp;              // CurrentVP

    POKEMON_DATA_SHEET.appendRow(newPokemonData);

    return {
      status: 'success',
      message: `${trainerName} caught a ${newPokemonData[2]}!`,  // Name at index 2
      newPokemonData: newPokemonData
    };
}

function updatePokemonDataInSheet(newPokemonData) {
    const data = POKEMON_DATA_SHEET.getDataRange().getValues();
    const trainerName = newPokemonData[POKEMON_COLUMN_INDICES.trainername];
    const pokemonName = newPokemonData[POKEMON_COLUMN_INDICES.name];

    for (let i = 1; i < data.length; i++) {
        if (data[i][POKEMON_COLUMN_INDICES.trainername].toLowerCase() === trainerName.toLowerCase() &&
            data[i][POKEMON_COLUMN_INDICES.name].toLowerCase() === pokemonName.toLowerCase()) {
            const row = i + 1; // Row number in Google Sheets (1-based index)
            POKEMON_DATA_SHEET.getRange(row, 1, 1, newPokemonData.length).setValues([newPokemonData]);
            return { status: 'success' };
        }
    }
    return { status: 'error', message: 'Pokémon not found.' };
}

function replacePokemonInSheet(preEvolvedPokemonName, trainerName, newPokemonData) { 
    const data = POKEMON_DATA_SHEET.getDataRange().getValues();

    // Loop through the rows to find the correct Pokémon based on trainer's name and pre-evolved Pokémon's name
    for (let i = 1; i < data.length; i++) {
        if (data[i][POKEMON_COLUMN_INDICES.trainername].toLowerCase() === trainerName.toLowerCase() &&
            data[i][POKEMON_COLUMN_INDICES.name].toLowerCase() === preEvolvedPokemonName.toLowerCase()) {
            
            const row = i + 1; // Row number in Google Sheets (1-based index)
            
            // Overwrite the pre-evolved Pokémon data with the new evolved data
            POKEMON_DATA_SHEET.getRange(row, 1, 1, newPokemonData.length).setValues([newPokemonData]);
            return { status: 'success', message: 'Pokémon replaced successfully.' };
        }
    }

    return { status: 'error', message: 'Pre-evolved Pokémon not found.' };
}

function updateTrainerDataInSheet(newTrainerData) {
    const data = TRAINER_DATA_SHEET.getDataRange().getValues();
    const trainerName = newTrainerData[1];

    for (let i = 1; i < data.length; i++) {
        if (data[i][1].toLowerCase() === trainerName.toLowerCase()) {
            const row = i + 1; // Row number in Google Sheets (1-based index)
            TRAINER_DATA_SHEET.getRange(row, 1, 1, newTrainerData.length).setValues([newTrainerData]);
            return { status: 'success' };
        }
    }
    return { status: 'error', message: 'Trainer not found.' };
}
// ------------------------------------------------------------------Write Pokémon to Google Sheet End-------------------------------------------------


// ----------------------------------------------------------------Create a new Trainer Start----------------------------------------------------------
function createTrainer(trainer) {
    Logger.log("TRAINER", trainer);
    try {
        // Calculate modifiers
        const strmodifier = Math.floor((trainer.strength - 10) / 2);
        const dexmodifier = Math.floor((trainer.dexterity - 10) / 2);
        const conmodifier = Math.floor((trainer.constitution - 10) / 2);
        const intmodifier = Math.floor((trainer.intelligence - 10) / 2);
        const wismodifier = Math.floor((trainer.wisdom - 10) / 2);
        const chamodifier = Math.floor((trainer.charisma - 10) / 2);

        // Calculate HP and VP
        const hitDice = parseInt(trainer.hitDice, 10);
        const vitalityDice = parseInt(trainer.vitalityDice, 10);
        
        const { hp, vp } = calculateHpVp(trainer.strength, trainer.dexterity, trainer.constitution, trainer.intelligence, trainer.wisdom, trainer.charisma, trainer.level, hitDice, vitalityDice, 0);

        // Calculate Initiative (same as dex modifier)
        const initiative = dexmodifier;
        const ac = 10 + dexmodifier;

        // Calculate Proficiency Bonus
        let proficiency;
        if (trainer.level <= 4) {
            proficiency = 2;
        } else if (trainer.level <= 8) {
            proficiency = 3;
        } else if (trainer.level <= 12) {
            proficiency = 4;
        } else if (trainer.level <= 16) {
            proficiency = 5;
        } else {
            proficiency = 6;
        }

        // Determine the number of pokeslots based on the trainer level
        let pokeslots;
        if(trainer.trainerClass === "Pokemon Trainer"){
          if (trainer.level >= 1 && trainer.level <= 4) {
              pokeslots = 3;
          } else if (trainer.level >= 5 && trainer.level <= 9) {
              pokeslots = 4;
          } else if (trainer.level >= 10 && trainer.level <= 15) {
              pokeslots = 5;
          } else if (trainer.level >= 16 && trainer.level <= 20) {
              pokeslots = 6;
          } else {
              pokeslots = 3; // Default to 3 if level is out of expected range
          }
        } else {
          if (trainer.level >= 1 && trainer.level <= 4) {
              pokeslots = 0;
          } else if (trainer.level >= 5 && trainer.level <= 15) {
              pokeslots = 1;
          } else if (trainer.level >= 16 && trainer.level <= 20) {
              pokeslots = 2;
          } else {
              pokeslots = 0; // Default to 0 if level is out of expected range
          }
        }

        // Use the provided image URL directly
        const imageUrl = trainer.image || 'https://via.placeholder.com/150';

        // Parse inventory and format it as a string
        const inventory = JSON.parse(trainer.inventory || '[]');
        const inventoryStr = inventory.map(item => `${item.name} (x${item.quantity})`).join(', ');
        const skills = Array.isArray(trainer.skills) ? trainer.skills.join(', ') : '';

        // Prepare the row data
        const rowData = [
            imageUrl, // Image URL in column A (index 0)
            trainer.name, // Name in column B (index 1)
            trainer.level,
            trainer.hitDice,
            trainer.vitalityDice,
            trainer.strength,
            trainer.dexterity,
            trainer.constitution,
            trainer.intelligence,
            trainer.wisdom,
            trainer.charisma,
            hp, // Calculated HP
            vp, // Calculated VP
            ac,
            trainer.walkingSpeed,
            trainer.savingThrows,
            initiative, // Calculated Initiative
            proficiency, // Calculated Proficiency
            skills,
            trainer.money,
            inventoryStr,
            trainer.leaguePoints,
            trainer.pinCode,
            '', // Placeholder for affinity
            '', // Placeholder for specialization
            '', // Placeholder for trainerpath
            pokeslots, // Number of pokeslots based on trainer level
            strmodifier, // Calculated STR modifier
            dexmodifier, // Calculated DEX modifier
            conmodifier, // Calculated CON modifier
            intmodifier, // Calculated INT modifier
            wismodifier, // Calculated WIS modifier
            chamodifier, // Calculated CHA modifier
            '', // Placeholder for feats (33)
            '', // Placeholder for currentHP (34)
            '', // Placeholder for currentVP (35)
            '', // Placeholder for currentAC (36)
            '', // Placeholder for gear (37)
            trainer.nationality, // Nationality (38)
            trainer.trainerClass, // Trainer Class (39)
            '', // Placeholder for Second Wind Charges (40)
            '', // Placeholder for Rapid Orders Charges (41)
            '', // Placeholder for Unbreakable Bond Charges (42)
            '', // Placeholder for Elemental Synergy Charges (43)
            '', // Placeholder for Master Trainer Charges (44)
            '', // Placeholder for Battle Dice (45)
            ''  // Placeholder for Max Potential (46)
        ];

        TRAINER_DATA_SHEET.appendRow(rowData);

        // Return the rowData so it can be stored in session storage
        return { status: 'success', message: 'Trainer created successfully!', rowData };
    } catch (error) {
        Logger.log(error);
        return { status: 'error', message: 'Failed to create trainer. Please try again.' };
    }
}

function formatInventory(inventoryJson) {
    const inventory = JSON.parse(inventoryJson || '[]');
    return inventory.map(item => `${item.name} (x${item.quantity})`).join(', ');
}
// ----------------------------------------------------------------Create a new Trainer End------------------------------------------------------------

function getTrainerNameFromSession() {
    return HtmlService.createHtmlOutput(`
        <script>
            var trainerData = JSON.parse(sessionStorage.getItem('trainerData'));
            if (trainerData && trainerData.name) {
                google.script.run.handleTrainerName(trainerData.name);
            }
        </script>
    `).getContent();
}

function handleTrainerName(trainerName) {
    return storeTrainerAndPokemonData(trainerName);
}


 /** ######################################## NEW NAVIGATION SYSTEM ################################################################### */
 
function getPageContent(pageName) {
  try {
    // Map page names to their corresponding functions
    const pageMap = {
      'index': () => HtmlService.createHtmlOutputFromFile('index').getContent(),
      'continue_journey': getContinueJourney,
      'new_journey': getNewJourney,
      'trainer_card': getTrainerCard,
      'trainer_info': () => embedSessionScript('trainer_info'),
      'my_pokemon': () => embedSessionScript('my_pokemon'),
      'new_pokemon': () => embedSessionScript('new_pokemon'),
      'pokemon_form': () => embedSessionScript('pokemon_form'),
      'pokemon_card': () => embedSessionScript('pokemon_card'),
      'edit_pokemon': () => embedSessionScript('edit_pokemon'),
      'edit_trainer': () => embedSessionScript('edit_trainer'),
      'evolution': () => embedSessionScript('evolution'),
      'conduit_card': () => embedSessionScript('conduit_card'),
      'conduit_info': () => embedSessionScript('conduit_info'),
      'conduit_edit': () => embedSessionScript('conduit_edit')
    };
    
    if (pageMap[pageName]) {
      const html = pageMap[pageName]();
      return { status: 'success', html: html };
    } else {
      return { status: 'error', message: 'Page not found: ' + pageName };
    }
  } catch (error) {
    Logger.log('Error in getPageContent: ' + error.toString());
    return { status: 'error', message: error.toString() };
  }
}

function getAllPageTemplates(pageNames) {
  const templates = {};
  const startTime = new Date().getTime();
  
  pageNames.forEach(pageName => {
      try {
          // Use the existing page loading logic
          const result = getPageContent(pageName);
          if (result.status === 'success') {
              templates[pageName] = result.html;
          }
      } catch (error) {
          Logger.log(`Error loading template ${pageName}: ${error}`);
          // Don't fail the entire batch if one template fails
      }
  });
  
  const endTime = new Date().getTime();
  Logger.log(`Loaded ${Object.keys(templates).length} templates in ${endTime - startTime}ms`);
  
  return templates;
}

// -------------------------------------------------------------Navigate to different pages Start-------------------------------------
// ============================================================================
// MAIN API ROUTER
// ============================================================================

function doGet(e) {
  // Enable CORS for GitHub Pages to access this API
  const params = e.parameter;

  try {
    const route = params.route || 'error';
    const action = params.action || 'list';

    let result;

    // Route to appropriate handler
    switch(route) {
      case 'pokemon':
        result = handlePokemonRoute(action, params);
        break;

      case 'trainer':
        result = handleTrainerRoute(action, params);
        break;

      case 'game-data':
        result = handleGameDataRoute(action, params);
        break;

      case 'battle':
          result = handleBattleRoute(action, params);
          break;

        case 'test':
          result = handleTestRoute();
          break;

        default:
          result = { error: 'Unknown route: ' + route, status: 'error' };
    }

    // Return JSON response with CORS headers
    return createJsonResponse(result);

  } catch (error) {
    Logger.log('API Error: ' + error.toString());
    return createJsonResponse({
      error: error.toString(),
      status: 'error'
    });
  }
}

// Helper to create JSON response with CORS
function createJsonResponse(data) {
    const output = ContentService.createTextOutput(JSON.stringify(data));
    output.setMimeType(ContentService.MimeType.JSON);

    // CORS headers - allows GitHub Pages to call this API
    // Note: Google Apps Script doesn't support setting headers via setHeader()
    // CORS is automatically handled when deployed as "Anyone" access

    return output;
  }


// ============================================================================
// POKEMON ROUTES
// ============================================================================

function handlePokemonRoute(action, params) {
  switch(action) {
    case 'list':
      // GET: ?route=pokemon&action=list
      return {
        status: 'success',
        data: getCompletePokemonData()
      };

    case 'registered-list':
      // GET: ?route=pokemon&action=registered-list
      return {
        status: 'success',
        data: getRegisteredPokemonList().data
      };

    case 'get':
      // GET: ?route=pokemon&action=get&trainer=Ash&name=Pikachu
      if (!params.trainer || !params.name) {
        throw new Error('Missing trainer or pokemon name');
      }
      return {
        status: 'success',
        data: getPokemonInfo(params.trainer, params.name)
      };

    case 'register':
      // GET: ?route=pokemon&action=register&trainer=Ash&data={...}
      if (!params.trainer || !params.data) {
        throw new Error('Missing trainer or pokemon data');
      }
      const pokemonData = JSON.parse(params.data);
      return registerPokemonForTrainer(params.trainer, pokemonData);

    case 'update':
      // GET: ?route=pokemon&action=update&data={...}
      if (!params.data) {
        throw new Error('Missing pokemon data');
      }
      const updateData = JSON.parse(params.data);
      return updatePokemonDataInSheet(updateData);

    case 'recalculate-stats':
      // GET: ?route=pokemon&action=recalculate-stats&data={...}&oldFeats=...
      if (!params.data) {
        throw new Error('Missing pokemon data');
      }
      const recalcData = JSON.parse(params.data);
      const oldFeatsStr = params.oldFeats || '';
      const newFeatsStr = recalcData[50] || '';
      const recalcResult = applyFeatChanges(recalcData, oldFeatsStr, newFeatsStr);
      return recalcResult;

    case 'evolution-options':
      // GET: ?route=pokemon&action=evolution-options&dexEntry=25&limit=20
      const dexEntry = parseInt(params.dexEntry);
      const limit = parseInt(params.limit || 20);
      return getEvolutionOptions(dexEntry, limit);

    case 'party-status':
      // GET: ?route=pokemon&action=party-status&trainer=Ash&pokemon=Pikachu&pokeslots=6&operation=add
      return updateActivePartyStatus(
        params.trainer,
        params.pokemon,
        parseInt(params.pokeslots),
        params.operation
      );

    case 'utility-slot':
      // GET: ?route=pokemon&action=utility-slot&trainer=Ash&pokemon=Pidgey&operation=add
      return updateUtilitySlotStatus(params.trainer, params.pokemon, params.operation);

    case 'live-stats':
      // GET: ?route=pokemon&action=live-stats&trainer=Ash&pokemon=Pikachu&stat=HP&value=35
      return writePokemonLiveStats(
        params.trainer,
        params.pokemon,
        params.stat,
        parseInt(params.value)
      );

    case 'abilities':
      // GET: ?route=pokemon&action=abilities&name=Pikachu
      if (!params.name) {
        throw new Error('Missing pokemon name');
      }
      return getPokemonAbilities(params.name);

    case 'evolve':
      // GET: ?route=pokemon&action=evolve&currentName=Pikachu&trainer=Ash&data={...}
      if (!params.currentName || !params.trainer || !params.data) {
        throw new Error('Missing evolution parameters');
      }
      const evolveData = JSON.parse(params.data);
      // First calculate modifiers for the evolved Pokemon
      const calculatedData = calculateModifiers(evolveData, "None", "None");
      if (calculatedData.status === 'success') {
        // Then replace in sheet
        const replaceResult = replacePokemonInSheet(params.currentName, params.trainer, calculatedData.newPokemonData);
        if (replaceResult.status === 'success') {
          // Return both the success message AND the calculated Pokemon data
          return {
            status: 'success',
            message: replaceResult.message,
            newPokemonData: calculatedData.newPokemonData
          };
        }
        return replaceResult;
      }
      return calculatedData;

    default:
      throw new Error('Unknown pokemon action: ' + action);
  }
}

// ============================================================================
// TRAINER ROUTES
// ============================================================================

function handleTrainerRoute(action, params) {
  switch(action) {
    case 'list':
      // GET: ?route=trainer&action=list
      return {
        status: 'success',
        data: getTrainers()
      };

    case 'get':
      // GET: ?route=trainer&action=get&name=Ash
      if (!params.name) {
        throw new Error('Missing trainer name');
      }
      return {
        status: 'success',
        data: storeTrainerAndPokemonData(params.name)
      };

    case 'create':
      // GET: ?route=trainer&action=create&data={...}
      if (!params.data) {
        throw new Error('Missing trainer data');
      }
      const trainerData = JSON.parse(params.data);
      return createTrainer(trainerData);

    case 'update':
      // GET: ?route=trainer&action=update&data={...}
      if (!params.data) {
        throw new Error('Missing trainer data');
      }
      const updateData = JSON.parse(params.data);
      return updateTrainerDataInSheet(updateData);

    case 'live-stats':
      // GET: ?route=trainer&action=live-stats&trainer=Ash&stat=HP&value=42
      return writeTrainerLiveStats(
        params.trainer,
        params.stat,
        parseInt(params.value)
      );

    case 'inventory':
      // GET: ?route=trainer&action=inventory&trainer=Ash&data={...}
      return writeItems(params.trainer, params.data);

    case 'gear':
      // GET: ?route=trainer&action=gear&trainer=Ash&data={...}
      return writeTrainerGear(params.trainer, params.data);

    case 'money':
      // GET: ?route=trainer&action=money&trainer=Ash&amount=5000
      return writeMoney(params.trainer, parseInt(params.amount));

    case 'affinity':
      // GET: ?route=trainer&action=affinity&trainer=Ash&affinity=Bug
      if (!params.trainer || !params.affinity) {
        throw new Error('Missing trainer name or affinity');
      }
      return writeAffinity(params.trainer, params.affinity);

    case 'specialization':
      // GET: ?route=trainer&action=specialization&trainer=Ash&specialization=Researcher
      if (!params.trainer || !params.specialization) {
        throw new Error('Missing trainer name or specialization');
      }
      return writeSpecialization(params.trainer, params.specialization);

    case 'trainer-path':
      // GET: ?route=trainer&action=trainer-path&trainer=Ash&path=Ace Trainer
      if (!params.trainer || !params.path) {
        throw new Error('Missing trainer name or path');
      }
      return writeTrainerPath(params.trainer, params.path);

    default:
      throw new Error('Unknown trainer action: ' + action);
  }
}

// ============================================================================
// GAME DATA ROUTES
// ============================================================================

function handleGameDataRoute(action, params) {
  switch(action) {
    case 'all':
      // GET: ?route=game-data&action=all
      return {
        status: 'success',
        data: loadAllGameData()
      };

    case 'conduit':
      // GET: ?route=game-data&action=conduit
      return {
        status: 'success',
        data: loadAllConduitGameData()
      };

    case 'moves':
      // GET: ?route=game-data&action=moves
      return {
        status: 'success',
        data: fetchMoveData()
      };

    case 'natures':
      // GET: ?route=game-data&action=natures
      return {
        status: 'success',
        data: getNatureData()
      };

    case 'type-effectiveness':
      // GET: ?route=game-data&action=type-effectiveness&type1=Fire&type2=Flying
      return {
        status: 'success',
        data: calculateTypeEffectiveness(params.type1, params.type2)
      };

    case 'pokedex-config':
      // GET: ?route=game-data&action=pokedex-config
      return {
        status: 'success',
        data: getPokedexConfig()
      };

    default:
      throw new Error('Unknown game-data action: ' + action);
  }
}

// ============================================================================
// BATTLE ROUTES (Future functionality)
// ============================================================================

function handleBattleRoute(action, params) {
  switch(action) {
    case 'calculate-damage':
      // Future: damage calculation
      return { status: 'not_implemented' };

    case 'roll-initiative':
      // Future: initiative rolling
      return { status: 'not_implemented' };

    default:
      throw new Error('Unknown battle action: ' + action);
  }
}

// ============================================================================
// TESTING ENDPOINT
// ============================================================================

// Test with: ?route=test
function handleTestRoute() {
  return {
    status: 'success',
    message: 'API is working!',
    timestamp: new Date().toISOString(),
    endpoints: {
      pokemon: ['list', 'registered-list', 'get', 'register', 'update', 'evolution-options', 'party-status', 'utility-slot', 'live-stats'],
      trainer: ['list', 'get', 'create', 'update', 'inventory', 'gear', 'money', 'live-stats'],
      gameData: ['all', 'conduit', 'moves', 'natures', 'type-effectiveness', 'pokedex-config'],
      battle: ['calculate-damage', 'roll-initiative']
    }
  };
}


// Add this helper function if you don't have it
function include(filename) {
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getContinueJourney() {
    return HtmlService.createHtmlOutputFromFile('continue_journey').getContent();
}

function getNewJourney() {
    return HtmlService.createHtmlOutputFromFile('new_journey').getContent();
}

function getStart() {
    return HtmlService.createHtmlOutputFromFile('index').getContent();
}

function getTrainerCard() {
    return embedSessionScript('trainer_card');
}

function getTrainerInfo() {
    return embedSessionScript('trainer_info');
}

function getMyPokemon() {
    return embedSessionScript('my_pokemon');
}

function getNewPokemon() {
    return embedSessionScript('new_pokemon');
}

function getPokemonForm() {
    return embedSessionScript('pokemon_form');
}

function getPokemonCard() {
    return embedSessionScript('pokemon_card');
}

function getEditPokemon() {
    return embedSessionScript('edit_pokemon');
}

function getEditTrainer() {
    return embedSessionScript('edit_trainer');
}

function getEvolution() {
    return embedSessionScript('evolution');
}

function getConduitCard() {
    return embedSessionScript('conduit_card');
}

function getConduitInfo() {
    return embedSessionScript('conduit_info');
}

function getConduitEdit() {
    return embedSessionScript('conduit_edit');
}

// Function to embed the trainer name session logic into HTML pages
function embedSessionScript(templateFile) {
    const template = HtmlService.createTemplateFromFile(templateFile);
    template.scriptTags = getTrainerNameFromSession(); // Embed session script
    return template.evaluate().getContent();
}
// -------------------------------------------------------------Navigate to different pages End---------------------------------------
//-----------------Trainer Card Start--------------------------

// Function to retrieve all trainer data and associated Pokémon data, then store them in session storage
function storeTrainerAndPokemonData(trainerName) {
    Logger.log('Function storeTrainerAndPokemonData called with trainerName: ' + trainerName);
    
    const trainerData = TRAINER_DATA_SHEET.getDataRange().getValues();
    const pokemonData = POKEMON_DATA_SHEET.getDataRange().getValues();
    
    Logger.log('Trainer Data from Sheet: ' + JSON.stringify(trainerData));
    Logger.log('Pokemon Data from Sheet: ' + JSON.stringify(pokemonData));

    const trainerEntry = trainerData.find(row => row[TRAINER_COLUMN_INDICES.name].toLowerCase() === trainerName.toLowerCase());
    if (!trainerEntry) {
        Logger.log(`Trainer not found: ${trainerName}`);
        return null;
    }

    // For trainer data, preserve null/undefined but keep 0 values
    const trainerResult = Object.keys(TRAINER_COLUMN_INDICES).map(field => {
        const value = trainerEntry[TRAINER_COLUMN_INDICES[field]];
        // Only convert to empty string if value is null or undefined, NOT if it's 0
        return (value === null || value === undefined) ? "" : value;
    });
    Logger.log('Trainer Result: ' + JSON.stringify(trainerResult));

    const pokemonEntries = pokemonData.filter(row => row[REGISTERED_POKEMON_COLUMN_INDICES.trainername].toLowerCase() === trainerName.toLowerCase());
    Logger.log('Pokemon Entries: ' + JSON.stringify(pokemonEntries));

    // For pokemon data, preserve null/undefined but keep 0 values
    const pokemonResults = pokemonEntries.map(pokemon =>
        Object.keys(REGISTERED_POKEMON_COLUMN_INDICES).map(field => {
            const value = pokemon[REGISTERED_POKEMON_COLUMN_INDICES[field]];
            // Only convert to empty string if value is null or undefined, NOT if it's 0
            return (value === null || value === undefined) ? "" : value;
        })
    );

    Logger.log('Pokemon Results: ' + JSON.stringify(pokemonResults));

    return {
        trainerData: trainerResult,
        pokemonData: pokemonResults
    };
}

/**
 * BATCHED FUNCTION - Loads everything at once to avoid rate limiting
 * Returns trainer data, pokemon data, AND all game data in a single call
 */
function loadTrainerWithAllData(trainerName) {
  Logger.log('loadTrainerWithAllData called for: ' + trainerName);
  const startTime = Date.now();

  try {
    // Get trainer and pokemon data
    const trainerPokemonData = storeTrainerAndPokemonData(trainerName);

    if (!trainerPokemonData || !trainerPokemonData.trainerData) {
      throw new Error('Trainer not found: ' + trainerName);
    }

    // Check trainer class to determine which game data to load
    const trainerClass = trainerPokemonData.trainerData[39]; // Index 39 is trainer class

    let gameData;
    if (trainerClass === "Pokemon Trainer") {
      // Load Pokemon Trainer game data
      gameData = loadAllGameData();
    } else {
      // Load Conduit game data
      gameData = loadAllConduitGameData();
    }

    const endTime = Date.now();
    Logger.log('loadTrainerWithAllData completed in ' + (endTime - startTime) + 'ms');

    // Return everything in one object
    return {
      status: 'success',
      trainerData: trainerPokemonData.trainerData,
      pokemonData: trainerPokemonData.pokemonData,
      gameData: gameData,
      trainerClass: trainerClass,
      executionTime: endTime - startTime
    };

  } catch (error) {
    Logger.log('Error in loadTrainerWithAllData: ' + error.toString());
    return {
      status: 'error',
      message: error.toString()
    };
  }
}

// Function to get trainer's Pokémon from the sheet
function getTrainerPokemon(trainerName) {
    const data = POKEMON_DATA_SHEET.getDataRange().getValues();
    const pokemonList = [];
    for (let i = 1; i < data.length; i++) {
        if (data[i][0] === trainerName) { // Assuming column A contains the trainer's name
            pokemonList.push({
                name: data[i][2],  // Assuming column C contains Pokémon name
                level: data[i][4], // Assuming column E contains Pokémon level
                image: data[i][1]  // Assuming column B contains Pokémon image
            });
        }
    }
    return pokemonList;
}

function getPokemonInfo(trainerName, pokemonName) {
    const data = POKEMON_DATA_SHEET.getDataRange().getValues();
    const COLUMN_INDICES = {
        trainerName: 0,   // Column A
        image: 1,         // Column B
        name: 2,          // Column C
        dexEntry: 3,      // Column D
        level: 4,         // Column E
        primaryType: 5,   // Column F
        secondaryType: 6, // Column G
        ability: 7,       // Column H
        ac: 8,            // Column I
        hitDice: 9,       // Column J
        hp: 10,           // Column K
        vitalityDice: 11, // Column L
        vp: 12,           // Column M
        speed: 13,        // Column N
        totalStats: 14,   // Column O
        strength: 15,     // Column P
        dexterity: 16,    // Column Q
        constitution: 17, // Column R
        intelligence: 18, // Column S
        wisdom: 19,       // Column T
        charisma: 20,     // Column U
        savingThrows: 21, // Column V
        skills: 22,       // Column W
        startingMoves: 23,// Column X
        level2Moves: 24,  // Column Y
        level6Moves: 25,  // Column Z
        level10Moves: 26, // Column AA
        level14Moves: 27, // Column AB
        level18Moves: 28, // Column AC
        evolutionRequirement: 29, // Column AD
        initiative: 30,   // Column AE
        proficiencyBonus: 31, // Column AF
        nature: 32,       // Column AG
        loyalty: 33,      // Column AH
        stab: 34,         // Column AI
        heldItem: 35,     // Column AJ
        nickname: 36,     // Column AK
        customMoves: 37,  // Column AL
        inActiveParty: 38, // Column AM
        strmodifier: 39,  // Column AN
        dexmodifier: 40,  // Column AO
        conmodifier: 41,  // Column AP
        intmodifier: 42,  // Column AQ
        wismodifier: 43,  // Column AR
        chamodifier: 44  // Column AS

    };

    // Find the row that matches both the trainerName and pokemonName
    const matchingPokemon = data.find(row => 
        row[COLUMN_INDICES.trainerName].toLowerCase() === trainerName.toLowerCase() &&
        row[COLUMN_INDICES.name].toLowerCase() === pokemonName.toLowerCase()
    );

    if (!matchingPokemon) {
        Logger.log(`No Pokémon found for trainer: ${trainerName} with Pokémon name: ${pokemonName}`);
        return null;
    }

    // Prepare an object to return the relevant attributes
    const pokemonInfo = {
        trainerName: matchingPokemon[COLUMN_INDICES.trainerName],
        image: matchingPokemon[COLUMN_INDICES.image],
        name: matchingPokemon[COLUMN_INDICES.name],
        dexEntry: matchingPokemon[COLUMN_INDICES.dexEntry],
        level: matchingPokemon[COLUMN_INDICES.level],
        primaryType: matchingPokemon[COLUMN_INDICES.primaryType],
        secondaryType: matchingPokemon[COLUMN_INDICES.secondaryType],
        ability: matchingPokemon[COLUMN_INDICES.ability],
        ac: matchingPokemon[COLUMN_INDICES.ac],
        hitDice: matchingPokemon[COLUMN_INDICES.hitDice],
        hp: matchingPokemon[COLUMN_INDICES.hp],
        vitalityDice: matchingPokemon[COLUMN_INDICES.vitalityDice],
        vp: matchingPokemon[COLUMN_INDICES.vp],
        speed: matchingPokemon[COLUMN_INDICES.speed],
        totalStats: matchingPokemon[COLUMN_INDICES.totalStats],
        strength: matchingPokemon[COLUMN_INDICES.strength],
        dexterity: matchingPokemon[COLUMN_INDICES.dexterity],
        constitution: matchingPokemon[COLUMN_INDICES.constitution],
        intelligence: matchingPokemon[COLUMN_INDICES.intelligence],
        wisdom: matchingPokemon[COLUMN_INDICES.wisdom],
        charisma: matchingPokemon[COLUMN_INDICES.charisma],
        savingThrows: matchingPokemon[COLUMN_INDICES.savingThrows],
        skills: matchingPokemon[COLUMN_INDICES.skills],
        startingMoves: matchingPokemon[COLUMN_INDICES.startingMoves],
        level2Moves: matchingPokemon[COLUMN_INDICES.level2Moves],
        level6Moves: matchingPokemon[COLUMN_INDICES.level6Moves],
        level10Moves: matchingPokemon[COLUMN_INDICES.level10Moves],
        level14Moves: matchingPokemon[COLUMN_INDICES.level14Moves],
        level18Moves: matchingPokemon[COLUMN_INDICES.level18Moves],
        evolutionRequirement: matchingPokemon[COLUMN_INDICES.evolutionRequirement],
        initiative: matchingPokemon[COLUMN_INDICES.initiative],
        proficiencyBonus: matchingPokemon[COLUMN_INDICES.proficiencyBonus],
        nature: matchingPokemon[COLUMN_INDICES.nature],
        loyalty: matchingPokemon[COLUMN_INDICES.loyalty],
        stab: matchingPokemon[COLUMN_INDICES.stab],
        heldItem: matchingPokemon[COLUMN_INDICES.heldItem],
        nickname: matchingPokemon[COLUMN_INDICES.nickname],
        customMoves: matchingPokemon[COLUMN_INDICES.customMoves],
        inActiveParty: matchingPokemon[COLUMN_INDICES.inActiveParty],
        strmodifier: matchingPokemon[COLUMN_INDICES.strmodifier],
        dexmodifier: matchingPokemon[COLUMN_INDICES.dexmodifier],
        conmodifier: matchingPokemon[COLUMN_INDICES.conmodifier],
        intmodifier: matchingPokemon[COLUMN_INDICES.intmodifier],
        wismodifier: matchingPokemon[COLUMN_INDICES.wismodifier],
        chamodifier: matchingPokemon[COLUMN_INDICES.chamodifier]
    };

    return pokemonInfo;
}

// Function to get all trainers with pinCode included for the "Save select" screen
function getTrainers() {
    const data = TRAINER_DATA_SHEET.getDataRange().getValues();
    const trainers = [];

    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        trainers.push({
            id: i,
            image: row[0],      // Image URL in column A (index 0)
            name: row[1],       // Name in column B (index 1)
            pinCode: row[22]    // Pin Code in column W (index 22)
        });
    }
    return trainers;
}

function updateActivePartyStatus(trainerName, pokemonName, pokeslots, action) {
    const data = POKEMON_DATA_SHEET.getDataRange().getValues();
    
    // Get the current active party for the trainer
    let activeParty = [];
    for (let i = 1; i < data.length; i++) {
        if (data[i][0] === trainerName && data[i][38]) {  // Column 39 is index 38 for "In Active Party"
            activeParty.push(parseInt(data[i][38], 10));  // Convert to integer for comparison
        }
    }

    activeParty.sort((a, b) => a - b); // Sort by slot number

    if (action === 'add') {
        if (activeParty.length >= pokeslots) {
            return { status: 'error', message: 'Party is full' };
        } else {
            let nextSlot = 1;
            // Find the first available slot
            for (let i = 1; i <= pokeslots; i++) {
                if (!activeParty.includes(i)) {
                    nextSlot = i;
                    break;
                }
            }

            // Assign the Pokémon to the first available slot
            for (let i = 1; i < data.length; i++) {
                if (data[i][0] === trainerName && data[i][2] === pokemonName) {
                    POKEMON_DATA_SHEET.getRange(i + 1, 39).setValue(nextSlot); // Update "In Active Party" slot (column 39 in Sheets)
                    break;
                }
            }
            return { status: 'success', slot: nextSlot };
        }
    } else if (action === 'remove') {
        for (let i = 1; i < data.length; i++) {
            if (data[i][0] === trainerName && data[i][2] === pokemonName) {
                POKEMON_DATA_SHEET.getRange(i + 1, 39).setValue(''); // Clear "In Active Party" slot (column 39 in Sheets)
                break;
            }
        }
        return { status: 'success', message: 'Removed from party' };
    }
}

// Check if a trainer has a pokemon in the utility slot
function checkUtilitySlotStatus(trainerName) {
    const data = POKEMON_DATA_SHEET.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
        if (data[i][0] === trainerName && data[i][56] === 1) {
            return {
                hasUtilityPokemon: true,
                utilityPokemonName: data[i][2]
            };
        }
    }
    
    return {
        hasUtilityPokemon: false,
        utilityPokemonName: null
    };
}

// Update utility slot status for a pokemon
function updateUtilitySlotStatus(trainerName, pokemonName, action) {
    const data = POKEMON_DATA_SHEET.getDataRange().getValues();
    
    try {
        if (action === 'add') {
            // First, remove any existing pokemon from utility slot for this trainer
            for (let i = 1; i < data.length; i++) {
                if (data[i][0] === trainerName && data[i][56] === 1 && data[i][2] !== pokemonName) {
                    POKEMON_DATA_SHEET.getRange(i + 1, 57).setValue(''); // Column 57 is index 56
                }
            }
            
            // Then add the current pokemon to utility slot
            for (let i = 1; i < data.length; i++) {
                if (data[i][0] === trainerName && data[i][2] === pokemonName) {
                    // Check if pokemon is in active party
                    if (data[i][38]) {
                        return { 
                            status: 'error', 
                            message: 'A Pokémon cannot be in the active party and the utility slot at the same time' 
                        };
                    }
                    
                    POKEMON_DATA_SHEET.getRange(i + 1, 57).setValue(1); // Column 57 is index 56 - use number not string
                    return { status: 'success' };
                }
            }
        } else if (action === 'remove') {
            // Remove pokemon from utility slot
            for (let i = 1; i < data.length; i++) {
                if (data[i][0] === trainerName && data[i][2] === pokemonName) {
                    POKEMON_DATA_SHEET.getRange(i + 1, 57).setValue(''); // Column 57 is index 56
                    return { status: 'success' };
                }
            }
        }
        
        return { status: 'error', message: 'Pokemon not found' };
    } catch (error) {
        Logger.log('Error updating utility slot status: ' + error);
        return { status: 'error', message: 'Failed to update utility slot status' };
    }
}

//-----------------Trainer Card End--------------------------

//----------------------------------------------------------------Calculate Modifiers Start------------------------------------------------------------------
function calculateHpVp(str, dex, con, int, wis, cha, level, hd, vd, loyalty) {
    // Convert string inputs to integers
    str = parseInt(str, 10);
    dex = parseInt(dex, 10);
    con = parseInt(con, 10);
    int = parseInt(int, 10);
    wis = parseInt(wis, 10);
    cha = parseInt(cha, 10);
    level = parseInt(level, 10);
    hd = parseInt(hd, 10);
    vd = parseInt(vd, 10);

    // Calculate the conmodifier
    const conmodifier = (con - 10) < 0 ? Math.ceil((con - 10) / 2) : Math.floor((con - 10) / 2);

    // Calculate HP
    let hp = hd + (level * ((hd / 2) + 1 + conmodifier));

    // Add loyalty bonus to HP if loyalty is 2 or above
    if (loyalty >= 2) {
        hp += Math.ceil(level / 2);
    }

    // Calculate total stats
    const totalStats = str + dex + con + int + wis + cha;

    // Calculate VP
    const vp = vd + level * ((vd / 2) + 2) + Math.floor((totalStats - 30) / 2);

    return { hp, vp };
}

function calculateModifiers(newPokemonData, statIncreases, newFeats) {
    try {
        const feats = Array.isArray(newPokemonData[50]) 
            ? newPokemonData[50] 
            : (newPokemonData[50] ? newPokemonData[50].split(',').map(feat => feat.trim()) : []);

        let skills = Array.isArray(newPokemonData[22]) 
            ? newPokemonData[22] 
            : (newPokemonData[22] ? newPokemonData[22].split(',').map(skill => skill.trim()) : []);

        let newSkills = Array.isArray(newFeats) 
            ? newFeats 
            : (newFeats ? newFeats.split(',').map(skill => skill.trim()) : []);

        let strength = newPokemonData[15];
        let dexterity = newPokemonData[16];
        let constitution = newPokemonData[17];
        let intelligence = newPokemonData[18];
        let wisdom = newPokemonData[19];
        let charisma = newPokemonData[20];

        // Apply feats
        if(newSkills.includes("Acrobat")){
          if (feats.includes("Acrobat") && dexterity < 20) {
              Logger.log("Applying Acrobat Feat buffs");
              dexterity += 1;  
          }
          skills.push("Acrobatics");
        }

        if(newSkills.includes("Actor")){
          if (feats.includes("Actor") && charisma < 20) {
              Logger.log("Applying Actor Feat buffs");
              charisma += 1;
          }
        }

        if(newSkills.includes("Athlete")){
          if (feats.includes("Athlete")) {
              Logger.log("Applying Athlete Feat buffs");
              if (statIncreases[0] === "STR" && strength < 20) {
                  strength += 1;
              } else if (statIncreases[0] === "DEX" && dexterity < 20) {
                  dexterity += 1;
              }
          }
        }

        if(newSkills.includes("Brawny")){
          if (feats.includes("Brawny") && strength < 20) {
              Logger.log("Applying Brawny Feat buffs");
              strength += 1;
          }
          skills.push("Athletics");
        }

        if(newSkills.includes("Durable")){
          if (feats.includes("Durable") && constitution < 20) {
              Logger.log("Applying Durable Feat buffs");
              constitution += 1;
          }
        }

        if(newSkills.includes("Observant")){
          if (feats.includes("Observant")) {
              Logger.log("Applying Observant Feat buffs");
              if (statIncreases[1] === "INT" && intelligence < 20) {
                  intelligence += 1;
              } else if (statIncreases[1] === "WIS" && wisdom < 20) {
                  wisdom += 1;
              }
          }
        }

        if(newSkills.includes("Perceptive")){
          if (feats.includes("Perceptive") && wisdom < 20) {
              Logger.log("Applying Perceptive Feat buffs");
              wisdom += 1;   
          }
          skills.push("Perception");
        }

        if(newSkills.includes("Quick-Fingered")){
          if (feats.includes("Quick-Fingered") && dexterity < 20) {
              Logger.log("Applying Quick-Fingered Feat buffs");
              dexterity += 1;
          }
        }

        if(newSkills.includes("Resilient")){
          if (feats.includes("Resilient")) {
              Logger.log("Applying Resilient Feat buffs");
              if (statIncreases[2] === "STR" && strength < 20) {
                  strength += 1;
              } else if (statIncreases[2] === "DEX" && dexterity < 20) {
                  dexterity += 1;
              } else if (statIncreases[2] === "CON" && constitution < 20) {
                  constitution += 1;
              } else if (statIncreases[2] === "INT" && intelligence < 20) {
                  intelligence += 1;
              } else if (statIncreases[2] === "WIS" && wisdom < 20) {
                  wisdom += 1;
              } else if (statIncreases[2] === "CHA" && charisma < 20) {
                  charisma += 1;
              }
          }
        }

        if(newSkills.includes("Stealthy")){
          if (feats.includes("Stealthy") && dexterity < 20) {
              Logger.log("Applying Stealthy Feat buffs");
              dexterity += 1;
          }
          skills.push("Stealth");
        }

        if(newSkills.includes("AC Up")){
          if (feats.includes("AC Up")) {
            Logger.log("Applying AC Up Feat buffs");
            newPokemonData[8] = parseInt(newPokemonData[8], 10) + 1;
          }
        }

        // Calculate modifiers
        const strmodifier = Math.floor((strength - 10) / 2);
        const dexmodifier = Math.floor((dexterity - 10) / 2);
        const conmodifier = Math.floor((constitution - 10) / 2);
        const intmodifier = Math.floor((intelligence - 10) / 2);
        const wismodifier = Math.floor((wisdom - 10) / 2);
        const chamodifier = Math.floor((charisma - 10) / 2);

        const level = newPokemonData[4];
        Logger.log("Modifiers calculated: STR=" + strmodifier + ", DEX=" + dexmodifier);

        // Calculate HP and VP
        const hitDice = parseInt(newPokemonData[9], 10);
        const vitalityDice = parseInt(newPokemonData[11], 10);
        const { hp: baseHp, vp: baseVp } = calculateHpVp(
            strength, dexterity, constitution, intelligence, wisdom, charisma, level, hitDice, vitalityDice, newPokemonData[33]
        );

        let hp = baseHp;
        let vp = baseVp;

        if(newSkills.includes("Tough")){
          if (feats.includes("Tough")) {
              Logger.log("Applying Tough Feat buffs");
              hp += level * 2;
          }
        }

        if(newSkills.includes("Tireless")){
          if (feats.includes("Tireless")) {
              Logger.log("Applying Tireless Feat buffs");
              vp += Math.ceil(level / 2) * vitalityDice;
          }
        }

        // Assign updated values back to newPokemonData
        newPokemonData[10] = hp;
        newPokemonData[12] = vp;
        newPokemonData[15] = strength;
        newPokemonData[16] = dexterity;
        newPokemonData[17] = constitution;
        newPokemonData[18] = intelligence;
        newPokemonData[19] = wisdom;
        newPokemonData[20] = charisma;
        newPokemonData[22] = skills.join(', '); // Convert skills array back to comma-separated string
        newPokemonData[50] = feats.join(', '); // Ensure feats is also in string format
        newPokemonData[39] = strmodifier;
        newPokemonData[40] = dexmodifier;
        newPokemonData[41] = conmodifier;
        newPokemonData[42] = intmodifier;
        newPokemonData[43] = wismodifier;
        newPokemonData[44] = chamodifier;

        // Calculate STAB
        newPokemonData[34] = level <= 2 ? 0 : level <= 6 ? 2 : level <= 10 ? 4 : level <= 14 ? 6 : level <= 18 ? 8 : 10;

        // Calculate Initiative
        newPokemonData[30] = feats.includes("Alert") ? dexmodifier + 5 : dexmodifier;

        // Handle Mobile feat (+10 speed)
        if(newSkills.includes("Mobile")){
          if (feats.includes("Mobile")) {
            Logger.log("Applying Mobile Feat buffs");
            newPokemonData[24] = parseInt(newPokemonData[24], 10) + 10;
          }
        }

        // Calculate Proficiency Bonus
        newPokemonData[31] = level <= 4 ? 2 : level <= 8 ? 3 : level <= 12 ? 4 : level <= 16 ? 5 : 6;

        return {
            status: 'success',
            newPokemonData: newPokemonData
        };
    } catch (error) {
        Logger.log("Error in calculateModifiers: " + error.toString());
        return {
            status: 'error',
            message: 'Failed to calculate modifiers due to error: ' + error.toString(),
        };
    }
}

// Apply feat changes incrementally (add new feats, remove old feats)
function applyFeatChanges(pokemonData, oldFeatsStr, newFeatsStr) {
    try {
        Logger.log("Starting applyFeatChanges");
        Logger.log("Old feats: " + oldFeatsStr);
        Logger.log("New feats: " + newFeatsStr);

        const oldFeats = oldFeatsStr ? oldFeatsStr.split(',').map(f => f.trim()).filter(f => f) : [];
        const newFeats = newFeatsStr ? newFeatsStr.split(',').map(f => f.trim()).filter(f => f) : [];

        // Find added and removed feats
        const addedFeats = newFeats.filter(f => !oldFeats.includes(f));
        const removedFeats = oldFeats.filter(f => !newFeats.includes(f));

        Logger.log("Added feats: " + addedFeats.join(', '));
        Logger.log("Removed feats: " + removedFeats.join(', '));

        // Get current stats
        let strength = parseInt(pokemonData[15], 10);
        let dexterity = parseInt(pokemonData[16], 10);
        let constitution = parseInt(pokemonData[17], 10);
        let intelligence = parseInt(pokemonData[18], 10);
        let wisdom = parseInt(pokemonData[19], 10);
        let charisma = parseInt(pokemonData[20], 10);
        let ac = parseInt(pokemonData[8], 10);

        // Parse movement data (comma-separated: walking,climbing,flying,hovering,swimming,burrowing)
        // Format: "45ft, -, -, -, -, -" or just "45" (legacy)
        const movementData = pokemonData[13] || '30ft, -, -, -, -, -';
        let movementValues = [];
        if (typeof movementData === 'string' && movementData.includes(',')) {
            // New format: comma-separated
            movementValues = movementData.split(',').map(v => v.trim());
        } else {
            // Legacy format or single value: just the walking speed
            const walkingSpeed = typeof movementData === 'number' ? movementData : parseInt(movementData, 10);
            movementValues = [walkingSpeed + 'ft', '-', '-', '-', '-', '-'];
        }

        // Extract walking speed as integer for Mobile feat calculation
        let walkingSpeed = parseInt(movementValues[0], 10) || 30;

        let hp = parseInt(pokemonData[10], 10);
        let vp = parseInt(pokemonData[12], 10);

        const level = parseInt(pokemonData[4], 10);
        const hitDice = parseInt(pokemonData[9], 10);
        const vitalityDice = parseInt(pokemonData[11], 10);

        // Parse current skills
        let skills = pokemonData[22] ? pokemonData[22].split(',').map(s => s.trim()).filter(s => s) : [];

        // Helper to parse feat name and choice
        function parseFeat(feat) {
            const match = feat.match(/^(.+?)\s*\((.+?)\)$/);
            return {
                name: match ? match[1].trim() : feat,
                choice: match ? match[2].trim() : null
            };
        }

        // Helper to add skill
        function addSkill(skillName) {
            const existing = skills.findIndex(s => s.toLowerCase() === skillName.toLowerCase());
            if (existing >= 0) {
                // Upgrade to double proficiency
                skills[existing] = skillName + '+';
            } else if (!skills.some(s => s === skillName + '+')) {
                skills.push(skillName);
            }
        }

        // Helper to remove skill
        function removeSkill(skillName) {
            const plusIndex = skills.indexOf(skillName + '+');
            if (plusIndex >= 0) {
                // Downgrade from double to single proficiency
                skills[plusIndex] = skillName;
            } else {
                // Remove skill entirely
                skills = skills.filter(s => s.toLowerCase() !== skillName.toLowerCase());
            }
        }

        // Remove old feats
        for (const feat of removedFeats) {
            const { name, choice } = parseFeat(feat);
            Logger.log("Removing feat: " + name + (choice ? " (" + choice + ")" : ""));

            if (name === 'Acrobat') {
                if (dexterity > 1) dexterity -= 1;
                removeSkill('Acrobatics');
            } else if (name === 'Actor') {
                if (charisma > 1) charisma -= 1;
            } else if (name === 'Athlete') {
                if (choice === 'STR' && strength > 1) strength -= 1;
                else if (choice === 'DEX' && dexterity > 1) dexterity -= 1;
            } else if (name === 'Brawny') {
                if (strength > 1) strength -= 1;
                removeSkill('Athletics');
            } else if (name === 'Durable') {
                if (constitution > 1) constitution -= 1;
            } else if (name === 'Observant') {
                if (choice === 'INT' && intelligence > 1) intelligence -= 1;
                else if (choice === 'WIS' && wisdom > 1) wisdom -= 1;
            } else if (name === 'Perceptive') {
                if (wisdom > 1) wisdom -= 1;
                removeSkill('Perception');
            } else if (name === 'Quick-Fingered') {
                if (dexterity > 1) dexterity -= 1;
            } else if (name === 'Resilient') {
                if (choice === 'STR' && strength > 1) strength -= 1;
                else if (choice === 'DEX' && dexterity > 1) dexterity -= 1;
                else if (choice === 'CON' && constitution > 1) constitution -= 1;
                else if (choice === 'INT' && intelligence > 1) intelligence -= 1;
                else if (choice === 'WIS' && wisdom > 1) wisdom -= 1;
                else if (choice === 'CHA' && charisma > 1) charisma -= 1;
            } else if (name === 'Stealthy') {
                if (dexterity > 1) dexterity -= 1;
                removeSkill('Stealth');
            } else if (name === 'AC Up') {
                ac -= 1;
            } else if (name === 'Mobile') {
                walkingSpeed -= 10;
            } else if (name === 'Tough') {
                hp -= level * 2;
            } else if (name === 'Tireless') {
                vp -= Math.ceil(level / 2) * vitalityDice;
            }
        }

        // Add new feats
        for (const feat of addedFeats) {
            const { name, choice } = parseFeat(feat);
            Logger.log("Adding feat: " + name + (choice ? " (" + choice + ")" : ""));

            if (name === 'Acrobat') {
                if (dexterity < 20) dexterity += 1;
                addSkill('Acrobatics');
            } else if (name === 'Actor') {
                if (charisma < 20) charisma += 1;
            } else if (name === 'Athlete') {
                if (choice === 'STR' && strength < 20) strength += 1;
                else if (choice === 'DEX' && dexterity < 20) dexterity += 1;
            } else if (name === 'Brawny') {
                if (strength < 20) strength += 1;
                addSkill('Athletics');
            } else if (name === 'Durable') {
                if (constitution < 20) constitution += 1;
            } else if (name === 'Observant') {
                if (choice === 'INT' && intelligence < 20) intelligence += 1;
                else if (choice === 'WIS' && wisdom < 20) wisdom += 1;
            } else if (name === 'Perceptive') {
                if (wisdom < 20) wisdom += 1;
                addSkill('Perception');
            } else if (name === 'Quick-Fingered') {
                if (dexterity < 20) dexterity += 1;
            } else if (name === 'Resilient') {
                if (choice === 'STR' && strength < 20) strength += 1;
                else if (choice === 'DEX' && dexterity < 20) dexterity += 1;
                else if (choice === 'CON' && constitution < 20) constitution += 1;
                else if (choice === 'INT' && intelligence < 20) intelligence += 1;
                else if (choice === 'WIS' && wisdom < 20) wisdom += 1;
                else if (choice === 'CHA' && charisma < 20) charisma += 1;
            } else if (name === 'Stealthy') {
                if (dexterity < 20) dexterity += 1;
                addSkill('Stealth');
            } else if (name === 'AC Up') {
                ac += 1;
            } else if (name === 'Mobile') {
                walkingSpeed += 10;
            } else if (name === 'Tough') {
                hp += level * 2;
            } else if (name === 'Tireless') {
                vp += Math.ceil(level / 2) * vitalityDice;
            }
        }

        // Recalculate HP and VP based on new CON
        const { hp: recalcHp, vp: recalcVp } = calculateHpVp(
            strength, dexterity, constitution, intelligence, wisdom, charisma,
            level, hitDice, vitalityDice, pokemonData[33]
        );

        // Apply Tough and Tireless if they're still active
        hp = recalcHp;
        vp = recalcVp;
        if (newFeats.some(f => parseFeat(f).name === 'Tough')) {
            hp += level * 2;
        }
        if (newFeats.some(f => parseFeat(f).name === 'Tireless')) {
            vp += Math.ceil(level / 2) * vitalityDice;
        }

        // Calculate modifiers
        const strModifier = Math.floor((strength - 10) / 2);
        const dexModifier = Math.floor((dexterity - 10) / 2);
        const conModifier = Math.floor((constitution - 10) / 2);
        const intModifier = Math.floor((intelligence - 10) / 2);
        const wisModifier = Math.floor((wisdom - 10) / 2);
        const chaModifier = Math.floor((charisma - 10) / 2);

        const proficiencyBonus = level <= 4 ? 2 : level <= 8 ? 3 : level <= 12 ? 4 : level <= 16 ? 5 : 6;
        const initiative = newFeats.some(f => parseFeat(f).name === 'Alert') ? dexModifier + 5 : dexModifier;
        const stabBonus = level <= 2 ? 0 : level <= 6 ? 2 : level <= 10 ? 4 : level <= 14 ? 6 : level <= 18 ? 8 : 10;

        // Update pokemonData
        pokemonData[8] = ac;
        pokemonData[10] = hp;
        pokemonData[12] = vp;

        // Reconstruct movement data with updated walking speed
        movementValues[0] = walkingSpeed + 'ft';
        pokemonData[13] = movementValues.join(', ');

        pokemonData[15] = strength;
        pokemonData[16] = dexterity;
        pokemonData[17] = constitution;
        pokemonData[18] = intelligence;
        pokemonData[19] = wisdom;
        pokemonData[20] = charisma;
        pokemonData[22] = skills.join(', ');
        pokemonData[30] = initiative;
        pokemonData[31] = proficiencyBonus;
        pokemonData[34] = stabBonus;
        pokemonData[39] = strModifier;
        pokemonData[40] = dexModifier;
        pokemonData[41] = conModifier;
        pokemonData[42] = intModifier;
        pokemonData[43] = wisModifier;
        pokemonData[44] = chaModifier;

        Logger.log("Feat changes applied successfully");

        return {
            status: 'success',
            newPokemonData: pokemonData
        };

    } catch (error) {
        Logger.log("Error in applyFeatChanges: " + error.toString());
        return {
            status: 'error',
            message: 'Failed to apply feat changes: ' + error.toString()
        };
    }
}

function calculateTrainerModifiers(newTrainerData) {
    try {
        // Perform calculations for modifiers
        const strength = newTrainerData[5];
        const dexterity = newTrainerData[6];
        const constitution = newTrainerData[7];
        const intelligence = newTrainerData[8];
        const wisdom = newTrainerData[9];
        const charisma = newTrainerData[10];
        Logger.log("STR: " + strength);
        Logger.log("DEX: " + dexterity);
        Logger.log("CON: " + constitution);
        Logger.log("INT: " + intelligence);
        Logger.log("WIS: " + wisdom);
        Logger.log("CHA: " + charisma);

        const strModifier = Math.floor((strength - 10) / 2);
        const dexModifier = Math.floor((dexterity - 10) / 2);
        const conModifier = Math.floor((constitution - 10) / 2);
        const intModifier = Math.floor((intelligence - 10) / 2);
        const wisModifier = Math.floor((wisdom - 10) / 2);
        const chaModifier = Math.floor((charisma - 10) / 2);
        Logger.log("STRMOD: " + strModifier);
        Logger.log("DEXMOD: " + dexModifier);
        Logger.log("CONMOD: " + conModifier);
        Logger.log("INTMOD: " + intModifier);
        Logger.log("WISMOD: " + wisModifier);
        Logger.log("CHAMOD: " + chaModifier);

        const level = newTrainerData[2];
        Logger.log("Level: " + level);



        // Calculate Initiative
        newTrainerData[16] = dexModifier; // Assuming Initiative is at index 16
        const previousDexModifier = newTrainerData[28];

        if (previousDexModifier !== dexModifier) {
            const modifierDifference = dexModifier - previousDexModifier;

            newTrainerData[13] += modifierDifference;

        }

        const hitDice = parseInt(newTrainerData[3], 10);
        Logger.log("HD: " + hitDice);
        const vitalityDice = parseInt(newTrainerData[4], 10);
        Logger.log("VD: " + vitalityDice);
        const {hp, vp } = calculateHpVp(strength, dexterity, constitution, intelligence, wisdom, charisma,level, hitDice, vitalityDice, 0);
        Logger.log("HP: " + hp);
        Logger.log("VP: " + vp);
        newTrainerData[11] = hp;
        newTrainerData[12] = vp;

        // Calculate Proficiency Bonus
        let proficiencyBonus;
        if (level <= 4) {
            proficiencyBonus = 2;
        } else if (level <= 8) {
            proficiencyBonus = 3;
        } else if (level <= 12) {
            proficiencyBonus = 4;
        } else if (level <= 16) {
            proficiencyBonus = 5;
        } else {
            proficiencyBonus = 6;
        }
        newTrainerData[17] = proficiencyBonus; // Assuming Proficiency Bonus is at index 17

        // Assign the calculated modifiers
        newTrainerData[27] = strModifier; // Assuming STR modifier is at index 27
        newTrainerData[28] = dexModifier; // Assuming DEX modifier is at index 28
        newTrainerData[29] = conModifier; // Assuming CON modifier is at index 29
        newTrainerData[30] = intModifier; // Assuming INT modifier is at index 30
        newTrainerData[31] = wisModifier; // Assuming WIS modifier is at index 31
        newTrainerData[32] = chaModifier; // Assuming CHA modifier is at index 32

        return {
            status: 'success',
            newTrainerData: newTrainerData
        };
    } catch (error) {
        Logger.log("Error in calculateTrainerModifiers: " + error.toString());
        return {
            status: 'error',
            message: 'Failed to calculate modifiers due to error: ' + error.toString(),
        };
    }
}

//----------------------------------------------------------------Calculate Modifiers End--------------------------------------------------------------------

//----------------------------------------------------------------Import Data to Session Storage Start-------------------------------------------------------

function loadAllGameData() {
    const startTime = Date.now();
    try {
        const specializations = loadSpecializations();
        const trainerPaths = loadTrainerPaths();
        const affinities = loadAffinities();
        const itemsData = loadItemsData();
        const moves = fetchMoveData();
        const natures = getNatureData();
        const trainerFeatsData = loadTrainerFeats();
        const skillsData = loadTrainerSkills();
        const pokemonFeatsData = loadPokemonFeats();
        const nationalitiesData = loadNationalities();

        const endTime = Date.now();
        Logger.log('loadAllGameData: ' + (endTime - startTime) + ' ms');

        return {
            specializations,
            trainerPaths,
            affinities,
            itemsData,
            moves,
            natures,
            trainerFeatsData,
            skillsData,
            pokemonFeatsData,
            nationalitiesData
        };
    } catch (error) {
        Logger.log('Error loading game data: ' + error);
        return null; // Handle errors gracefully
    }
}
//#######################################################################################################
function loadAllConduitGameData() {
    try {
        const conduitFeatures = loadConduitFeatures();
        const battleStyles = loadConduitBattleStyle();
        const typeAwakening = loadConduitTypeAwakenings();
        const itemsData = loadItemsData();
        const moves = fetchMoveData();
        const natures = getNatureData();
        const trainerFeatsData = loadTrainerFeats();
        const pokemonFeatsData = loadPokemonFeats();
        const nationalitiesData = loadNationalities();

        return {
            conduitFeatures,
            battleStyles,
            typeAwakening,
            itemsData,
            moves,
            natures,
            trainerFeatsData,
            pokemonFeatsData,
            nationalitiesData
        };
    } catch (error) {
        Logger.log('Error loading game data: ' + error);
        return null; // Handle errors gracefully
    }
}
//#######################################################################################################

function loadTrainerPaths() {
    try {
        const data = FEATS_DATA_SHEET.getRange(2, 1, 4, 13).getValues();
        return data.map(row => ({
            name: row[0],
            level3: {
                name: row[1],
                shortEffect: row[2],
                effect: row[3]
            },
            level5: {
                name: row[4],
                shortEffect: row[5],
                effect: row[6]
            },
            level9: {
                name: row[7],
                shortEffect: row[8],
                effect: row[9]
            },
            level15: {
                name: row[10],
                shortEffect: row[11],
                effect: row[12]
            }
        }));
    } catch (error) {
        Logger.log('Error loading trainer paths: ' + error);
        return [];
    }
}

function loadSpecializations() {
    try {
        const data = FEATS_DATA_SHEET.getRange(11, 1, 18, 3).getValues();
        return data.map(row => ({
            name: sanitizeString(row[0]),
            shortEffect: sanitizeString(row[1]),
            effect: sanitizeString(row[2])
        }));
    } catch (error) {
        Logger.log('Error loading specializations: ' + error);
        return [];
    }
}


function loadAffinities() {
    try {
        const data = FEATS_DATA_SHEET.getRange(58, 1, 18, 5).getValues();
        return data.map(row => ({
            name: sanitizeString(row[0]),
            shortEffect: sanitizeString(row[1]),
            effect: sanitizeString(row[2]),
            improvedShortEffect: sanitizeString(row[3]),
            improvedEffect: sanitizeString(row[4])
        }));
    } catch (error) {
        Logger.log('Error loading affinities: ' + error);
        return [];
    }
}

function sanitizeString(str) {
  if (!str) return '';  // Return an empty string if the input is undefined or null
  return str
    .replace(/\n/g, ' ')        // Replace newline characters with a space
    .replace(/\r/g, ' ')        // Replace carriage return characters with a space
    .replace(/\\/g, '')         // Remove all backslashes
    .replace(/\s+/g, ' ')       // Replace multiple spaces with a single space
    .trim();                    // Trim leading and trailing spaces
}

function loadItemsData() {
    try {
        // Fetch data from the URL stored in the ITEMS_DATA constant
        const response = UrlFetchApp.fetch(ITEMS_DATA);
        const data = JSON.parse(response.getContentText());

        // Assuming the structure of each row is like ["Poké Ball", "Poké Balls", 250, "A device for catching wild Pokémon.", "Add +1 to capture score."]
        const items = data.map(row => ({
            name: sanitizeString(row[0]),           // Item name (sanitize)
            type: sanitizeString(row[1]),           // Item type (sanitize)
            description: sanitizeString(row[3]),    // Description (skip price)
            effect: sanitizeString(row[4])          // Effect (sanitize)
        }));

        return { status: 'success', items };  // Return the array of items
    } catch (error) {
        Logger.log('Error loading items: ' + error);
        return { status: 'error', message: 'Failed to load items' };
    }
}

function loadTrainerFeats() {
    try {
        const data = FEATSLIST_DATA_SHEET.getRange(2, 1, 35, 2).getValues(); // Fetch feats data from A2:B36

        const trainerFeats = data.map(row => ({
            name: row[0],   // Feat name
            effect: row[1]  // Feat effect
        }));

        return { status: 'success', trainerFeats };
    } catch (error) {
        Logger.log('Error loading feats for trainer: ' + error);
        return { status: 'error', message: 'Failed to load feats' };
    }
}

function loadPokemonFeats() {
    try {
        const data = FEATSLIST_DATA_SHEET.getRange(42, 1, 29, 2).getValues(); // Fetch feats data from A42:B70

        const pokemonFeats = data.map(row => ({
            name: row[0],   // Feat name
            effect: row[1]  // Feat effect
        }));

        return { status: 'success', pokemonFeats };
    } catch (error) {
        Logger.log('Error loading pokemonFeats for pokemon: ' + error);
        return { status: 'error', message: 'Failed to load pokemonFeats' };
    }
}

function loadTrainerSkills() {
    try {
        const data = FEATS_DATA_SHEET.getRange(31, 1, 8, 4).getValues(); // Fetch skills data from A31:D38

        const skills = data.map(row => ({
            level: row[0],         // Skill level
            name: sanitizeString(row[1]),          // Skill name (sanitize)
            shortEffect: sanitizeString(row[2]),    // Short description of effect (sanitize)
            fullEffect: sanitizeString(row[3])      // Full effect description (sanitize)
        }));

        return { status: 'success', skills };
    } catch (error) {
        Logger.log('Error loading skills for trainer: ' + error);
        return { status: 'error', message: 'Failed to load skills' };
    }
}

function loadNationalities() {
    try {
        const data = FEATS_DATA_SHEET.getRange(79, 1, 10, 3).getValues();

        const nationalities = data.map(row => ({
          nationality: sanitizeString(row[0]),
          regionBuff: sanitizeString(row[1]),
          effect: sanitizeString(row[2]),
          }));

          return { status: 'success', nationalities };
    } catch (error) {
        Logger.log('Error loading affinities: ' + error);
        return [];
    }
}

function loadConduitFeatures() {
    try {
        const data = CONDUIT_FEATURES_SHEET.getRange(2, 1, 10, 4).getValues();
        return data.map(row => ({
            name: sanitizeString(row[0]),
            stage1Effect: sanitizeString(row[1] || ''), // Handles potential empty values
            stage2Effect: sanitizeString(row[2] || ''), // Handles potential empty values
            stage3Effect: sanitizeString(row[3] || '')  // Handles potential empty values
        }));
    } catch (error) {
        Logger.log('Error loading conduit features: ' + error); // Updated error message for clarity
        return [];
    }
}

function loadConduitBattleStyle() {
    try {
        const data = CONDUIT_BATTLE_STYLE_SHEET.getRange(2, 1, 6, 2).getValues();
        return data.map(row => ({
            name: sanitizeString(row[0]),
            effect: sanitizeString(row[1])
        }));
    } catch (error) {
        Logger.log('Error loading specializations: ' + error);
        return [];
    }
}

function loadConduitTypeAwakenings() {
    try {
        const data = CONDUIT_AWAKENING_SHEET.getRange(2, 1, 72, 4).getValues(); // Covers A2:D73
        const awakenings = {};
        let currentType = null;

        for (let i = 0; i < data.length; i++) {
            const [type, level1, level2, level3] = data[i].map(sanitizeString);

            // If we hit a top-level type row (every 4th row), initialize it
            if (i % 4 === 0) {
                currentType = type;
                awakenings[currentType] = {
                    effect: level1, // Store the top-level type effect in Level 1 column
                    awakenings: []
                };
            } else if (currentType) {
                // Each of the next three rows are the awakenings for the current type
                awakenings[currentType].awakenings.push({
                    name: type, // Awakening name
                    levels: [level1 || "", level2 || "", level3 || ""] // Level 1, 2, and 3 effects
                });
            }
        }

        console.log("Type Awakenings data:", awakenings);
        return awakenings;

    } catch (error) {
        Logger.log('Error loading conduit awakenings: ' + error);
        return {};
    }
}

function writeItems(trainerName, newInventory) {
    try {
        const data = TRAINER_DATA_SHEET.getDataRange().getValues();
        const trainerRow = data.findIndex(row => row[1] === trainerName); // Locate the row by trainer name

        if (trainerRow === -1) {
            return { status: 'error', message: 'Trainer not found' };
        }

        TRAINER_DATA_SHEET.getRange(trainerRow + 1, 21).setValue(newInventory); // Batch write operation
        return { status: 'success' };
    } catch (error) {
        Logger.log('Error writing items: ' + error);
        return { status: 'error', message: 'Failed to write items' };
    }
}

function writeTrainerGear(trainerName, newGear) {
    try {
        const data = TRAINER_DATA_SHEET.getDataRange().getValues();
        const trainerRow = data.findIndex(row => row[1] === trainerName); // Locate the row by trainer name

        if (trainerRow === -1) {
            return { status: 'error', message: 'Trainer not found' };
        }

        TRAINER_DATA_SHEET.getRange(trainerRow + 1, 38).setValue(newGear); // Batch write operation
        return { status: 'success' };
    } catch (error) {
        Logger.log('Error writing gear: ' + error);
        return { status: 'error', message: 'Failed to write gear' };
    }
}

function writePokemonGear(trainerName, pokemonName, newGear) {
    try {
        const data = POKEMON_DATA_SHEET.getDataRange().getValues();
        const pokemonRow = data.findIndex(row => row[0] === trainerName && row[2] === pokemonName); // Locate the row by trainer name and pokemon name

        if (pokemonRow === -1) {
            return { status: 'error', message: 'Trainer not found' };
        }

        POKEMON_DATA_SHEET.getRange(pokemonRow + 1, 52).setValue(newGear); // Batch write operation
        return { status: 'success' };
    } catch (error) {
        Logger.log('Error writing gear: ' + error);
        return { status: 'error', message: 'Failed to write gear' };
    }
}

function writePokemonLiveStats(trainerName, pokemonName, stat, newValue) {
    try {
        const data = POKEMON_DATA_SHEET.getDataRange().getValues();
        const pokemonRow = data.findIndex(row => row[0] === trainerName && row[2] === pokemonName); // Locate the row by trainer name and pokemon name

        if (pokemonRow === -1) {
            return { status: 'error', message: 'Trainer not found' };
        }

        if(stat === 'HP') { //HP
          POKEMON_DATA_SHEET.getRange(pokemonRow + 1, 46).setValue(newValue);
          return { status: 'success' };

        } else if(stat === 'VP'){ //VP
          POKEMON_DATA_SHEET.getRange(pokemonRow + 1, 47).setValue(newValue); 
          return { status: 'success' };

        } else { //AC 
          POKEMON_DATA_SHEET.getRange(pokemonRow + 1, 48).setValue(newValue); 
          return { status: 'success' };

        }
    } catch (error) {
        Logger.log('Error writing Pokemon Live Stats: ' + error);
        return { status: 'error', message: 'Failed to write Pokemon Live Stats' };
    }
}

function writeTrainerLiveStats(trainerName, stat, newValue) {
    try {
        const data = TRAINER_DATA_SHEET.getDataRange().getValues();
        const trainerRow = data.findIndex(row => row[1] === trainerName); // Locate the row by trainer name

        if (trainerRow === -1) {
            return { status: 'error', message: 'Trainer not found' };
        }

        if(stat === 'HP') { //HP
          TRAINER_DATA_SHEET.getRange(trainerRow + 1, 35).setValue(newValue);
          return { status: 'success' };

        } else if(stat === 'VP'){ //VP
          TRAINER_DATA_SHEET.getRange(trainerRow + 1, 36).setValue(newValue); 
          return { status: 'success' };

        } else { //AC 
          TRAINER_DATA_SHEET.getRange(trainerRow + 1, 37).setValue(newValue); 
          return { status: 'success' };
        }
    } catch (error) {
        Logger.log('Error writing Trainer Live Stats: ' + error);
        return { status: 'error', message: 'Failed to write Trainer Live Stats' };
    }
}

function writeMoney(trainerName, moneyAmount) {
    const sheet = TRAINER_DATA_SHEET;
    const row = findTrainerRow(trainerName, sheet); // Implement this to find the correct row for the trainer

    if (row) {
        try {
            sheet.getRange(row, 20).setValue(JSON.stringify(moneyAmount)); // Column 20 for money
        } catch (error) {
            Logger.log("Error writing money: " + error.message);
            throw new Error("Failed to write money: " + error.message);
        }
    } else {
        Logger.log("Trainer row not found for " + trainerName);
        throw new Error("Trainer row not found for " + trainerName);
    }
}

function writeComment(trainerName, pokemonName, comment) {
    try {
        const data = POKEMON_DATA_SHEET.getDataRange().getValues();
        const pokemonRow = data.findIndex(row => row[0] === trainerName && row[2] === pokemonName); // Locate the row by trainer name and pokemon name

        if (pokemonRow === -1) {
            return { status: 'error', message: 'Trainer not found' };
        }

        POKEMON_DATA_SHEET.getRange(pokemonRow + 1, 49).setValue(comment); // Batch write operation
        return { status: 'success' };
    } catch (error) {
        Logger.log(`Error writing comment for Trainer: ${trainerName}, Pokemon: ${pokemonName}: ${error}`);
        return { status: 'error', message: 'Failed to write comment' };
    }
}

function writeAffinity(trainerName, affinity) {
    try {
        const sheet = TRAINER_DATA_SHEET;
        const row = findTrainerRow(trainerName, sheet);

        if (row) {
            sheet.getRange(row, 24).setValue(affinity);
            return { status: 'success', message: 'Affinity saved successfully' };
        } else {
            return { status: 'error', message: 'Trainer not found' };
        }
    } catch (error) {
        Logger.log(`Error writing affinity for ${trainerName}: ${error}`);
        return { status: 'error', message: 'Failed to write affinity' };
    }
}

function writeSpecialization(trainerName, specialization) {
    try {
        const sheet = TRAINER_DATA_SHEET;
        const row = findTrainerRow(trainerName, sheet);

        if (row) {
            sheet.getRange(row, 25).setValue(specialization);
            return { status: 'success', message: 'Specialization saved successfully' };
        } else {
            return { status: 'error', message: 'Trainer not found' };
        }
    } catch (error) {
        Logger.log(`Error writing specialization for ${trainerName}: ${error}`);
        return { status: 'error', message: 'Failed to write specialization' };
    }
}

function writeTrainerPath(trainerName, trainerPath) {
    try {
        const sheet = TRAINER_DATA_SHEET;
        const row = findTrainerRow(trainerName, sheet);

        if (row) {
            sheet.getRange(row, 26).setValue(trainerPath);
            return { status: 'success', message: 'Trainer path saved successfully' };
        } else {
            return { status: 'error', message: 'Trainer not found' };
        }
    } catch (error) {
        Logger.log(`Error writing trainer path for ${trainerName}: ${error}`);
        return { status: 'error', message: 'Failed to write trainer path' };
    }
}

function writeTypeAwakening(trainerName, typeAwakeningData) {
    const sheet = TRAINER_DATA_SHEET; 
    const row = findTrainerRow(trainerName, sheet);

    if (row) {
        sheet.getRange(row, 26).setValue(typeAwakeningData);
    }
}

function findTrainerRow(trainerName, sheet) {
    const data = sheet.getDataRange().getValues();
    const trainerRow = data.findIndex(row => row[1] === trainerName); // Locate the row by trainer name
    return trainerRow !== -1 ? trainerRow + 1 : null; // Google Sheets is 1-indexed
}

function getNatureData() {
    try {
        const lastRow = NATURE_DATA_SHEET.getLastRow();
        const data = NATURE_DATA_SHEET.getRange(2, 1, lastRow - 1, 5).getValues(); // Fetch all data at once

        return data.map(row => ({
            name: row[0],        // Nature name
            boostStat: row[1],   // Stat to boost
            boostAmount: row[2], // Amount to boost
            nerfStat: row[3],    // Stat to nerf
            nerfAmount: row[4]   // Amount to nerf
        }));
    } catch (error) {
        Logger.log('Error loading nature data: ' + error);
        return []; // Return an empty array in case of error
    }
}

function calculateTypeEffectiveness(type1, type2 = null) {
    try {
        // Fetch the type effectiveness matrix and headers
        const data = TYPE_DATA_SHEET.getRange(3, 3, 18, 18).getValues(); // Effectiveness matrix
        const attackTypes = TYPE_DATA_SHEET.getRange("B3:B20").getValues().flat(); // Attack types
        const defendTypes = TYPE_DATA_SHEET.getRange("C2:T2").getValues().flat(); // Defend types

        // Get index positions for type1 and type2 in the defend types array
        const type1Index = defendTypes.indexOf(type1.toUpperCase());
        const type2Index = type2 ? defendTypes.indexOf(type2.toUpperCase()) : -1;

        // Return empty array if type1 is not found, or if type2 is specified but not found
        if (type1Index === -1 || (type2 && type2Index === -1)) {
            Logger.log(`Type not found: ${type1} or ${type2}`);
            return [];
        }

        // Initialize an array to store combined effectiveness values for each attack type
        const effectivenessValues = [];

        // Loop over each attacking type (rows in data matrix)
        for (let i = 0; i < attackTypes.length; i++) {
            const effectivenessType1 = data[i][type1Index];
            const effectivenessType2 = type2Index !== -1 ? data[i][type2Index] : 1; // Default to 1 if no type2
            
            // Multiply effectiveness values of type1 and type2 (or just type1 if no type2)
            const combinedEffectiveness = effectivenessType1 * effectivenessType2;
            
            // Add the combined effectiveness to the result array
            effectivenessValues.push(combinedEffectiveness);
        }

        return effectivenessValues;
    } catch (error) {
        Logger.log('Error calculating type effectiveness: ' + error);
        return []; // Return an empty array in case of error
    }
}

//---------------------------------Import Data to Session Storage End------------------------------------------

/**
 * ================================= ABILITIES SECTION =================================
 */

// Get abilities for a specific Pokemon species with slot indices
function getPokemonAbilities(pokemonName) {
  const startTime = Date.now();

  try {
    // Fetch all Pokemon data
    const response = UrlFetchApp.fetch(POKEMON_DATA_URL);
    const allPokemonData = JSON.parse(response.getContentText());

    // Find the specific Pokemon by name (index 2 is the name)
    const pokemon = allPokemonData.find(row => row[2] === pokemonName);

    if (!pokemon) {
      Logger.log('Pokemon not found: ' + pokemonName);
      return {
        status: 'error',
        message: 'Pokemon not found: ' + pokemonName,
        abilities: []
      };
    }

    // Extract and format abilities with slot indices
    // Slot 0 = primary, 1 = secondary, 2 = hidden
    const abilities = [];

    // Primary ability (index 15 = name, 62 = description) - slot 0
    if (pokemon[15]) {
      abilities.push('0:' + formatAbility({
        name: pokemon[15],
        description: pokemon[62] || "No description available"
      }));
    }

    // Secondary ability (index 16 = name, 63 = description) - slot 1
    if (pokemon[16]) {
      abilities.push('1:' + formatAbility({
        name: pokemon[16],
        description: pokemon[63] || "No description available"
      }));
    }

    // Hidden ability (index 17 = name, 64 = description) - slot 2
    if (pokemon[17]) {
      abilities.push('2:' + formatAbility({
        name: pokemon[17],
        description: pokemon[64] || "No description available"
      }));
    }

    const endTime = Date.now();
    Logger.log(`getPokemonAbilities for ${pokemonName} completed in ${endTime - startTime}ms`);
    Logger.log(`Found ${abilities.length} abilities`);

    return {
      status: 'success',
      pokemonName: pokemonName,
      abilities: abilities,
      executionTime: endTime - startTime
    };

  } catch (error) {
    Logger.log('Error in getPokemonAbilities: ' + error.toString());
    return {
      status: 'error',
      message: error.toString(),
      abilities: []
    };
  }
}

/**
 * ================================= EVOLVE SECTION =================================
 */
function getEvolutionOptions(currentDexEntry, limit = 20) {
  const startTime = Date.now();
  
  try {
    // First, get registered Pokemon names
    const registeredNames = fetchRegisteredPokemon();
    
    // Fetch all Pokemon data
    const pokemonResponse = UrlFetchApp.fetch(POKEMON_DATA_URL);
    const allPokemonData = JSON.parse(pokemonResponse.getContentText());
    
    // Filter to only registered Pokemon with higher dex entries
    const eligiblePokemon = allPokemonData
      .filter(pokemon => 
        registeredNames.includes(pokemon[2]) && // Is registered
        pokemon[1] > currentDexEntry // Has higher dex entry
      )
      .sort((a, b) => a[1] - b[1]) // Sort by dex entry
      .slice(0, limit); // Take only what we need
    
    Logger.log(`Found ${eligiblePokemon.length} evolution options`);
    
    // Format only the Pokemon we need
    const formattedData = eligiblePokemon.map(formatPokemonData);
    
    const endTime = Date.now();
    Logger.log(`getEvolutionOptions completed in ${endTime - startTime}ms`);
    
    return {
      status: 'success',
      data: formattedData,
      totalFound: eligiblePokemon.length,
      executionTime: endTime - startTime
    };
    
  } catch (error) {
    Logger.log('Error in getEvolutionOptions: ' + error.toString());
    return {
      status: 'error',
      message: error.toString(),
      data: []
    };
  }
}

// Helper function to format Pokemon data (used by getEvolutionOptions)
function formatPokemonData(row) {
  const primaryAbility = row[15] ? { name: row[15], description: row[62] ?? "No description available" } : null;
  const secondaryAbility = row[16] ? { name: row[16], description: row[63] ?? "No description available" } : null;
  const hiddenAbility = row[17] ? { name: row[17], description: row[64] ?? "No description available" } : null;
  
  const movementData = {
    walking: row[65],
    climbing: row[66],
    flying: row[67],
    hovering: row[68],
    swimming: row[69],
    burrowing: row[70]
  };
  
  const sensesData = {
    sight: row[71],
    hearing: row[72],
    smell: row[73],
    tremorsense: row[74],
    echolocation: row[75],
    telepathy: row[76],
    blindsight: row[77],
    darkvision: row[78],
    truesight: row[79]
  };
  
  return [
    null,           // image (will be resolved client-side)
    row[2],         // name
    row[1],         // dex entry
    row[19],        // level
    row[7],         // primaryType
    row[8],         // secondaryType
    formatAbility(primaryAbility),
    formatAbility(secondaryAbility),
    formatAbility(hiddenAbility),
    row[20],        // ac
    row[21],        // hitDice
    row[22],        // hp
    row[23],        // vitalityDice
    row[24],        // vp
    row[25],        // speed
    row[26],        // totalstats
    row[27],        // strength
    row[28],        // dexterity
    row[29],        // constitution
    row[30],        // intelligence
    row[31],        // wisdom
    row[32],        // charisma
    row[33],        // savingThrows
    row[34],        // skills
    sanitizeMoves(row[35], 4),  // moves.starting
    sanitizeMoves(row[36], 4),  // moves.level2
    sanitizeMoves(row[37], 4),  // moves.level6
    sanitizeMoves(row[38], 4),  // moves.level10
    sanitizeMoves(row[39], 3),  // moves.level14
    sanitizeMoves(row[40], 3),  // moves.level18
    row[14],        // evolutionReq
    movementData,   // Movement data
    sensesData,     // Sense data
    row[6],         // Flavor text
    row[9]          // Size (NEW)
  ];
}

/**
 * ================================= NEW ENCOUNTER SECTION =================================
 */

function getRegisteredPokemonList() {
  const startTime = Date.now();
  
  try {
    // Get registered Pokemon names
    const registeredNames = fetchRegisteredPokemon();
    
    // Fetch all Pokemon data
    const response = UrlFetchApp.fetch(POKEMON_DATA_URL);
    const allPokemonData = JSON.parse(response.getContentText());
    
    // Filter to registered Pokemon and extract ALL needed fields for pokemon_form
    // DO NOT resolve images server-side - this is the key optimization
    const lightweightData = allPokemonData
      .filter(pokemon => registeredNames.includes(pokemon[2]))
      .map(row => {
        // Format abilities with descriptions
        const primaryAbility = row[15] ? { name: row[15], description: row[62] ?? "No description available" } : null;
        const secondaryAbility = row[16] ? { name: row[16], description: row[63] ?? "No description available" } : null;
        const hiddenAbility = row[17] ? { name: row[17], description: row[64] ?? "No description available" } : null;
        
        // Extract Movement Data (Indexes 65 to 70)
        const movementData = {
          walking: row[65],
          climbing: row[66],
          flying: row[67],
          hovering: row[68],
          swimming: row[69],
          burrowing: row[70]
        };
        
        // Extract Senses Data (Indexes 71 to 79)
        const sensesData = {
          sight: row[71],
          hearing: row[72],
          smell: row[73],
          tremorsense: row[74],
          echolocation: row[75],
          telepathy: row[76],
          blindsight: row[77],
          darkvision: row[78],
          truesight: row[79]
        };
        
        return [
          null,         // 0: image URL - will be resolved client-side
          row[2],       // 1: name
          row[1],       // 2: dex entry (id)
          row[19],      // 3: level
          row[7],       // 4: primary type
          row[8],       // 5: secondary type
          formatAbility(primaryAbility),     // 6: primary ability formatted
          formatAbility(secondaryAbility),   // 7: secondary ability formatted
          formatAbility(hiddenAbility),      // 8: hidden ability formatted
          row[20],      // 9: AC
          row[21],      // 10: Hit Dice
          row[22],      // 11: HP
          row[23],      // 12: Vitality Dice
          row[24],      // 13: VP
          row[25],      // 14: Speed
          row[26],      // 15: Total Stats
          row[27],      // 16: Strength
          row[28],      // 17: Dexterity
          row[29],      // 18: Constitution
          row[30],      // 19: Intelligence
          row[31],      // 20: Wisdom
          row[32],      // 21: Charisma
          row[33],      // 22: Saving Throws (placeholder)
          row[34],      // 23: Skills (placeholder)
          sanitizeMoves(row[35], 4),  // 24: Starting Moves
          sanitizeMoves(row[36], 4),  // 25: Level 2 Moves
          sanitizeMoves(row[37], 4),  // 26: Level 6 Moves
          sanitizeMoves(row[38], 4),  // 27: Level 10 Moves
          sanitizeMoves(row[39], 3),  // 28: Level 14 Moves
          sanitizeMoves(row[40], 3),  // 29: Level 18 Moves
          row[14],      // 30: Evolution Requirement
          movementData, // 31: Movement Data
          sensesData,   // 32: Senses Data
          row[6],       // 33: Flavor text
          row[9]        // 34: Size (NEW)
        ];
      })
      .sort((a, b) => a[2] - b[2]); // Sort by dex entry
    
    const endTime = Date.now();
    Logger.log(`getRegisteredPokemonList completed in ${endTime - startTime}ms`);
    Logger.log(`Returning ${lightweightData.length} Pokemon with full data`);
    
    return {
      status: 'success',
      data: lightweightData,
      count: lightweightData.length,
      executionTime: endTime - startTime
    };
    
  } catch (error) {
    Logger.log('Error in getRegisteredPokemonList: ' + error.toString());
    return {
      status: 'error',
      message: error.toString(),
      data: []
    };
  }
}

/** 
############################################################################################################
                                                    Debug
############################################################################################################
*/



