// Evolution Page - Evolve Pokemon with stat allocation

import { PokemonAPI, GameDataAPI } from '../api.js';
import { showSuccess, showError } from '../utils/notifications.js';
import { isFieldVisible, initializeVisibility, getPokemonVisibility } from '../utils/visibility.js';
import { selectSplashImage, showLoadingWithSplash, hideLoading } from '../utils/splash.js';

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
          background:
            radial-gradient(circle at 20% 80%, rgba(255, 222, 0, 0.15) 0%, transparent 50%),
            radial-gradient(circle at 80% 20%, rgba(59, 76, 202, 0.15) 0%, transparent 50%),
            radial-gradient(circle at 40% 40%, rgba(238, 21, 21, 0.3) 0%, transparent 40%),
            linear-gradient(to bottom, #EE1515 0%, #C91010 50%, #A00808 100%);
          min-height: 100vh;
          position: relative;
          overflow-x: hidden;
        }

        .evolution-page::before {
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

        .evolution-page {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: clamp(1.5rem, 3vh, 2rem) clamp(0.75rem, 2vw, 1rem);
          min-height: 100vh;
          position: relative;
          box-sizing: border-box;
        }

        .evolution-page > * {
          position: relative;
          z-index: 1;
        }

        .evolution-page h1 {
          color: white;
          margin-bottom: clamp(1.5rem, 3vh, 2rem);
          font-size: clamp(1.8rem, 4.5vw, 2.5rem);
          text-transform: uppercase;
          letter-spacing: clamp(0.5px, 0.5vw, 2px);
          text-shadow: 0 clamp(3px, 0.8vh, 4px) clamp(8px, 2vh, 10px) rgba(0,0,0,0.8);
          font-weight: 900;
        }

        .evolution-container {
          display: flex;
          justify-content: space-between;
          width: 90%;
          max-width: clamp(900px, 95vw, 1400px);
          flex-grow: 1;
          gap: clamp(1.5rem, 3vw, 2rem);
        }

        .evolution-list {
          width: 58%;
          max-height: 65vh;
          overflow-y: auto;
          border: clamp(3px, 0.5vw, 4px) solid #FFDE00;
          border-radius: clamp(15px, 2.5vw, 20px);
          padding: clamp(1.25rem, 2.5vw, 1.5rem);
          background: linear-gradient(135deg, #FFFFFF 0%, #F8F8F8 100%);
          box-shadow: 0 clamp(8px, 1.5vh, 12px) clamp(20px, 3.5vh, 30px) rgba(0,0,0,0.4);
        }

        .evolution-list h2 {
          text-align: center;
          margin-top: 0;
          margin-bottom: clamp(1rem, 2vh, 1.5rem);
          font-size: clamp(1.3rem, 2.8vw, 1.5rem);
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: clamp(0.5px, 0.3vw, 1px);
          color: #333;
        }

        .evolution-list ul {
          list-style: none;
          padding: 0;
          margin: 0;
        }

        .evolution-list li {
          font-size: clamp(1rem, 2.2vw, 1.2rem);
          margin-bottom: clamp(0.8rem, 1.8vh, 1rem);
          cursor: pointer;
          padding: clamp(0.65rem, 1.5vw, 0.85rem);
          border-radius: clamp(8px, 1.5vw, 10px);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          background: transparent;
          border: clamp(2px, 0.3vw, 2px) solid transparent;
        }

        .evolution-list li:hover {
          background: rgba(255, 222, 0, 0.1);
          border-color: #FFDE00;
          transform: translateX(clamp(3px, 0.8vw, 5px));
        }

        .evolution-list li.selected {
          background: linear-gradient(135deg, #EE1515 0%, #C91010 100%);
          color: white;
          border-color: #FFDE00;
          box-shadow: 0 clamp(4px, 0.8vh, 6px) clamp(12px, 2.5vh, 15px) rgba(238,21,21,0.4);
        }

        .pokemon-details {
          width: 38%;
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-start;
          background: transparent;
          padding: clamp(1.5rem, 3vw, 2rem);
          min-height: 60vh;
        }

        .pokemon-details.visible {
          /* Always visible structure, class remains for compatibility */
        }

        .pokemon-details.empty {
          display: flex;
          align-items: center;
          justify-content: center;
          color: #FFDE00;
          font-size: clamp(1.1rem, 2.2vw, 1.4rem);
          font-style: italic;
          font-weight: 600;
          text-shadow: 0 2px 6px rgba(0,0,0,0.8);
        }

        .pokemon-details img {
          width: 85%;
          max-width: 300px;
          aspect-ratio: 1;
          border-radius: clamp(12px, 2.5vw, 18px);
          object-fit: cover;
          margin-bottom: clamp(1rem, 2vh, 1.5rem);
          border: clamp(3px, 0.6vw, 4px) solid #FFDE00;
          box-shadow: 0 clamp(8px, 1.5vh, 12px) clamp(20px, 4vh, 30px) rgba(0,0,0,0.5);
          background-color: #fff;
          transition: transform 0.3s, filter 0.3s;
        }

        .pokemon-details img:hover {
          transform: translateY(clamp(-3px, -0.8vh, -5px));
          filter: brightness(1.1) drop-shadow(0 0 clamp(10px, 2vw, 15px) rgba(255,222,0,0.6));
        }

        .pokemon-details .detail-item {
          font-size: clamp(1.1rem, 2.2vw, 1.4rem);
          margin-bottom: clamp(0.5rem, 1vh, 0.75rem);
          color: #FFDE00;
          font-weight: 700;
          text-shadow: 0 2px 4px rgba(0,0,0,0.8);
        }

        .pokemon-details .detail-item strong {
          color: white;
          font-weight: 900;
        }

        .evolve-button {
          background: linear-gradient(135deg, #4CAF50 0%, #45A049 100%);
          color: white;
          border: clamp(2px, 0.4vw, 3px) solid #FFDE00;
          border-radius: clamp(10px, 2vw, 15px);
          padding: clamp(1rem, 2vh, 1.2rem) clamp(2rem, 4vw, 2.5rem);
          font-size: clamp(1.1rem, 2.4vw, 1.3rem);
          font-weight: 900;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          margin-top: clamp(1.25rem, 2.5vh, 1.5rem);
          box-shadow: 0 clamp(5px, 1vh, 8px) clamp(15px, 3vh, 20px) rgba(0,0,0,0.3);
          text-transform: uppercase;
          letter-spacing: clamp(0.5px, 0.3vw, 1px);
        }

        .evolve-button:hover {
          transform: translateY(clamp(-2px, -0.5vh, -3px));
          box-shadow: 0 clamp(8px, 1.5vh, 12px) clamp(20px, 4vh, 30px) rgba(76,175,80,0.5),
                      0 0 clamp(15px, 3vw, 20px) rgba(255,222,0,0.5);
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

        .stat-controls {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .stat-button {
          width: 30px;
          height: 30px;
          font-size: 1.3rem;
          font-weight: bold;
          border: 2px solid #FFDE00;
          border-radius: 5px;
          background: linear-gradient(135deg, #4CAF50 0%, #45A049 100%);
          color: white;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
        }

        .stat-button:hover {
          transform: scale(1.1);
          box-shadow: 0 2px 8px rgba(76,175,80,0.4);
        }

        .stat-button:active {
          transform: scale(0.95);
        }

        .stat-button:disabled {
          opacity: 0.4;
          cursor: not-allowed;
          transform: none;
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

        .back-button {
          position: fixed;
          top: clamp(15px, 3vh, 20px);
          left: clamp(15px, 3vw, 20px);
          background: linear-gradient(135deg, #FFFFFF 0%, #F5F5F5 100%);
          color: #333;
          width: clamp(40px, 8vw, 50px);
          height: clamp(40px, 8vw, 50px);
          border: clamp(2px, 0.5vw, 3px) solid #FFDE00;
          border-radius: 50%;
          font-size: clamp(1.4rem, 3vw, 1.8rem);
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

        @media (max-width: 1024px) {
          .evolution-container {
            gap: clamp(1.5rem, 3vw, 2.5rem);
          }
        }

        @media (max-width: 768px) {
          .evolution-container {
            gap: clamp(1rem, 2.5vw, 2rem);
          }
        }

        @media (max-width: 600px) {
          .evolution-container {
            gap: clamp(0.75rem, 2vw, 1.5rem);
          }
        }

        @media (max-width: 480px) {
          .evolution-container {
            flex-direction: column;
            gap: clamp(0.5rem, 1.5vw, 1rem);
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

        <div class="pokemon-details empty" id="pokemonDetails">
          <div id="pokemonDetailsContent" style="display: none; width: 100%; flex-direction: column; align-items: center;">
            <img src="" alt="Pokemon" id="pokemonImage" onerror="this.src='assets/Pokeball.png'">
            <div class="detail-item">Name: <strong id="pokemonName"></strong></div>
            <div class="detail-item">Dex Entry: <strong id="pokemonDexEntry"></strong></div>
            <div class="detail-item">Type: <strong id="pokemonType"></strong></div>
            <button class="evolve-button" id="evolveButton">Evolve Pokemon</button>
          </div>
          <div id="pokemonPlaceholder"></div>
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
            <div class="stat-controls">
              <button type="button" class="stat-button" data-stat="str" data-action="decrease">−</button>
              <input type="number" id="strPoints" value="0" min="0" readonly>
              <button type="button" class="stat-button" data-stat="str" data-action="increase">+</button>
            </div>
          </div>
          <div class="stat-input">
            <span>DEX (<span id="currentDex">0</span> → <span class="new-stat" id="newDex">0</span>)</span>
            <div class="stat-controls">
              <button type="button" class="stat-button" data-stat="dex" data-action="decrease">−</button>
              <input type="number" id="dexPoints" value="0" min="0" readonly>
              <button type="button" class="stat-button" data-stat="dex" data-action="increase">+</button>
            </div>
          </div>
          <div class="stat-input">
            <span>CON (<span id="currentCon">0</span> → <span class="new-stat" id="newCon">0</span>)</span>
            <div class="stat-controls">
              <button type="button" class="stat-button" data-stat="con" data-action="decrease">−</button>
              <input type="number" id="conPoints" value="0" min="0" readonly>
              <button type="button" class="stat-button" data-stat="con" data-action="increase">+</button>
            </div>
          </div>
          <div class="stat-input">
            <span>INT (<span id="currentInt">0</span> → <span class="new-stat" id="newInt">0</span>)</span>
            <div class="stat-controls">
              <button type="button" class="stat-button" data-stat="int" data-action="decrease">−</button>
              <input type="number" id="intPoints" value="0" min="0" readonly>
              <button type="button" class="stat-button" data-stat="int" data-action="increase">+</button>
            </div>
          </div>
          <div class="stat-input">
            <span>WIS (<span id="currentWis">0</span> → <span class="new-stat" id="newWis">0</span>)</span>
            <div class="stat-controls">
              <button type="button" class="stat-button" data-stat="wis" data-action="decrease">−</button>
              <input type="number" id="wisPoints" value="0" min="0" readonly>
              <button type="button" class="stat-button" data-stat="wis" data-action="increase">+</button>
            </div>
          </div>
          <div class="stat-input">
            <span>CHA (<span id="currentCha">0</span> → <span class="new-stat" id="newCha">0</span>)</span>
            <div class="stat-controls">
              <button type="button" class="stat-button" data-stat="cha" data-action="decrease">−</button>
              <input type="number" id="chaPoints" value="0" min="0" readonly>
              <button type="button" class="stat-button" data-stat="cha" data-action="increase">+</button>
            </div>
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

      <!-- Back Button -->
      <button class="back-button" id="backButton">←</button>
    </div>
  `;

  return html;
}

export async function attachEvolutionListeners() {
  // Reset state
  selectedPokemon = null;
  allocatedSkillPoints = 0;
  evolutionOptions = [];

  // Preload splash image in background while user fills out form
  let preloadedSplashImage = null;
  console.log('[Evolution] Preloading splash image...');
  selectSplashImage().then(url => {
    preloadedSplashImage = url;
    console.log('[Evolution] Preloaded splash:', url);
  }).catch(err => {
    console.log('[Evolution] Preload error:', err);
    preloadedSplashImage = 'https://raw.githubusercontent.com/Benjakronk/shima-pokedex/main/images/background/background.png';
  });

  // Initialize visibility system
  await initializeVisibility();

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

  // Stat +/- buttons
  document.querySelectorAll('.stat-button').forEach(button => {
    button.addEventListener('click', handleStatButton);
  });

  // Back button
  document.getElementById('backButton')?.addEventListener('click', () => {
    const pokemonName = sessionStorage.getItem('selectedPokemonName');
    window.dispatchEvent(new CustomEvent('navigate', {
      detail: { route: 'pokemon-card', pokemonName: pokemonName }
    }));
  });
}

async function loadEvolutionOptions() {
  const currentPokemonName = currentPokemon[2]; // Pokemon name at index 2

  try {
    // Get visibility settings for current Pokemon
    const visibility = getPokemonVisibility(currentPokemonName);
    const evoToTargets = visibility.evoToTargets || {};

    console.log('[Evolution] Checking evoToTargets for', currentPokemonName, ':', evoToTargets);

    // Get target Pokemon names where value is true
    const targetNames = Object.keys(evoToTargets).filter(name => evoToTargets[name] === true);

    if (targetNames.length === 0) {
      console.log('[Evolution] No evolution targets defined in config');
      document.getElementById('pokemonList').innerHTML = '<li style="text-align: center; color: #666;">This Pokemon\'s evolution is currently not available in the registered Pokedex.</li>';
      evolutionOptions = [];
      return;
    }

    console.log('[Evolution] Target evolution names:', targetNames);

    // Get complete Pokemon data from cache
    const completePokemonDataStr = sessionStorage.getItem('completePokemonData');
    if (!completePokemonDataStr) {
      console.error('[Evolution] No complete Pokemon data in cache');
      document.getElementById('pokemonList').innerHTML = '<li style="text-align: center; color: #666;">This Pokemon\'s evolution is currently not available in the registered Pokedex.</li>';
      evolutionOptions = [];
      return;
    }

    const completePokemonData = JSON.parse(completePokemonDataStr);

    // Find evolution targets in complete Pokemon data
    evolutionOptions = [];
    for (const targetName of targetNames) {
      const targetPokemon = completePokemonData.find(p =>
        p[1].toLowerCase() === targetName.toLowerCase()
      );

      if (targetPokemon) {
        evolutionOptions.push(targetPokemon);
        console.log('[Evolution] Found evolution target:', targetPokemon[1]);
      } else {
        console.log('[Evolution] Evolution target not found in registered Pokedex:', targetName);
      }
    }

    if (evolutionOptions.length === 0) {
      console.log('[Evolution] No evolution targets found in registered Pokedex');
      document.getElementById('pokemonList').innerHTML = '<li style="text-align: center; color: #666;">This Pokemon\'s evolution is currently not available in the registered Pokedex.</li>';
    } else {
      displayEvolutionOptions(evolutionOptions);
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

  console.log('[Evolution] Selected Pokemon from API:', {
    name: pokemon[1],
    dexEntry: pokemon[2],
    image: pokemon[0],
    primaryType: pokemon[4],
    secondaryType: pokemon[5],
    hitDice: pokemon[10],
    vitalityDice: pokemon[12],
    fullData: pokemon
  });

  // Update selected styling
  document.querySelectorAll('.evolution-list li').forEach(li => li.classList.remove('selected'));
  listItem.classList.add('selected');

  // Display details and resolve image URL
  const imageUrl = pokemon[0] || await resolveImageUrl(pokemon[1], pokemon[2]);

  // Store resolved image URL back into selectedPokemon for later use
  if (!pokemon[0]) {
    selectedPokemon[0] = imageUrl;
    console.log('[Evolution] Resolved and stored image URL:', imageUrl);
  }

  document.getElementById('pokemonImage').src = imageUrl;
  document.getElementById('pokemonName').textContent = pokemon[1];
  document.getElementById('pokemonDexEntry').textContent = pokemon[2];

  const typeText = pokemon[5] ? `${pokemon[4]} / ${pokemon[5]}` : pokemon[4];
  document.getElementById('pokemonType').textContent = typeText;

  // Hide placeholder and show content
  document.getElementById('pokemonPlaceholder').style.display = 'none';
  document.getElementById('pokemonDetailsContent').style.display = 'flex';
  document.getElementById('pokemonDetails').classList.remove('empty');
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

function handleStatButton(e) {
  const stat = e.currentTarget.dataset.stat;
  const action = e.currentTarget.dataset.action;
  const input = document.getElementById(`${stat}Points`);
  let currentValue = parseInt(input.value) || 0;

  if (action === 'increase') {
    // Only increase if we have remaining points
    const remainingPoints = availableSkillPoints - allocatedSkillPoints;
    if (remainingPoints > 0) {
      currentValue++;
      input.value = currentValue;
      updateAllocatedPoints();
    }
  } else if (action === 'decrease') {
    // Only decrease if value is greater than 0
    if (currentValue > 0) {
      currentValue--;
      input.value = currentValue;
      updateAllocatedPoints();
    }
  }
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

  // Enable/disable buttons based on remaining points and current values
  const stats = { str, dex, con, int, wis, cha };
  Object.keys(stats).forEach(stat => {
    const increaseBtn = document.querySelector(`.stat-button[data-stat="${stat}"][data-action="increase"]`);
    const decreaseBtn = document.querySelector(`.stat-button[data-stat="${stat}"][data-action="decrease"]`);

    // Disable increase button if no points remaining
    if (increaseBtn) {
      increaseBtn.disabled = remainingPoints <= 0;
    }

    // Disable decrease button if current value is 0
    if (decreaseBtn) {
      decreaseBtn.disabled = stats[stat] <= 0;
    }
  });

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

  // Read input values BEFORE clearing the DOM
  const str = parseInt(document.getElementById('strPoints').value) || 0;
  const dex = parseInt(document.getElementById('dexPoints').value) || 0;
  const con = parseInt(document.getElementById('conPoints').value) || 0;
  const int = parseInt(document.getElementById('intPoints').value) || 0;
  const wis = parseInt(document.getElementById('wisPoints').value) || 0;
  const cha = parseInt(document.getElementById('chaPoints').value) || 0;

  // Hide modal and show loading
  document.getElementById('evolutionModal').classList.remove('visible');
  document.getElementById('content').innerHTML = '<div class="loading">Evolving Pokemon...</div>';

  try {

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
    console.log('[Evolution] Fetching type effectiveness for:', {
      primaryType: selectedPokemon[4],
      secondaryType: selectedPokemon[5]
    });

    const typeResponse = await GameDataAPI.getTypeEffectiveness(
      selectedPokemon[4],
      selectedPokemon[5]
    );

    console.log('[Evolution] Type effectiveness response:', typeResponse);

    const typematchupsString = (typeResponse.data || typeResponse.effectiveness) ?
      (typeResponse.data || typeResponse.effectiveness).join(', ') : '';

    console.log('[Evolution] Type matchups string:', typematchupsString);

    // Map abilities from current to evolved Pokemon
    const evolvedAbilities = [];
    const evolvedPokemonName = selectedPokemon[1]; // Name at index 1

    // Support both old format (single field at index 7) and new format (3 fields at indices 7, 8, 9)
    let currentAbilities = [];
    const ability7 = currentPokemon[7] || '';
    const ability8 = currentPokemon[8] || '';
    const ability9 = currentPokemon[9] || '';

    console.log('[Evolution] Current Pokemon abilities:', { ability7, ability8, ability9 });

    // Check if old format (contains pipe separator) or new format (separate fields)
    if (typeof ability7 === 'string' && ability7.includes('|')) {
      // Old format: single field with pipe-separated values
      currentAbilities = ability7.split('|').map(a => a.trim()).filter(a => a);
    } else {
      // New format: three separate fields - only add if they are non-empty strings
      if (ability7 && typeof ability7 === 'string') currentAbilities.push(ability7);
      if (ability8 && typeof ability8 === 'string') currentAbilities.push(ability8);
      if (ability9 && typeof ability9 === 'string') currentAbilities.push(ability9);
    }

    console.log('[Evolution] Parsed current abilities:', currentAbilities);

    if (currentAbilities.length > 0) {

      // Get evolved Pokemon's abilities (pokedex format: "Name, Description")
      const evolvedPokemonAbilities = [
        selectedPokemon[6],  // Primary
        selectedPokemon[7],  // Secondary
        selectedPokemon[8]   // Hidden
      ];

      console.log('[Evolution] Evolved Pokemon abilities from Pokedex:', evolvedPokemonAbilities);

      currentAbilities.forEach(abilityData => {
        // Ensure abilityData is a string before calling indexOf
        if (typeof abilityData !== 'string') {
          console.warn('[Evolution] Skipping non-string ability data:', abilityData);
          return;
        }

        const colonIndex = abilityData.indexOf(':');
        let slotIndex = 0;

        if (colonIndex !== -1 && colonIndex < 3) {
          slotIndex = parseInt(abilityData.substring(0, colonIndex));
        }

        // Check if hidden ability (slotIndex 2) should be visible
        if (slotIndex === 2 && !isFieldVisible(evolvedPokemonName, 'hiddenAbility')) {
          return; // Skip hidden ability if not visible for evolved Pokemon
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
    if (evolvedAbilities.length === 0) {
      const primaryAbility = selectedPokemon[6];
      if (primaryAbility) {
        const parts = primaryAbility.split(',');
        evolvedAbilities.push('0:' + parts[0].trim() + ';' + parts.slice(1).join(',').trim());
      }
    }

    // Combine evolved abilities into single pipe-separated string
    const evolvedAbilitiesString = evolvedAbilities.join('|');

    // Build evolved Pokemon data array with placeholders for calculated values
    const evolvedPokemonData = [
      currentPokemon[0],           // 0: Trainer Name
      selectedPokemon[0],          // 1: Image
      selectedPokemon[1],          // 2: Name
      selectedPokemon[2],          // 3: Dex Entry
      currentPokemon[4],           // 4: Level
      selectedPokemon[4],          // 5: Primary Type
      selectedPokemon[5],          // 6: Secondary Type
      evolvedAbilitiesString,      // 7: Ability (combined with pipes)
      selectedPokemon[9],          // 8: AC
      selectedPokemon[10],         // 9: Hit Dice
      '',                          // 10: HP (will be calculated by server)
      selectedPokemon[12],         // 11: Vitality Dice
      '',                          // 12: VP (will be calculated by server)
      movementDataString,          // 13: Speed
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

    // Log what we're sending to the server
    console.log('[Evolution] Sending evolvedPokemonData to server:', {
      name: evolvedPokemonData[2],
      image: evolvedPokemonData[1],
      hitDice: evolvedPokemonData[9],
      hp: evolvedPokemonData[10],
      vitalityDice: evolvedPokemonData[11],
      vp: evolvedPokemonData[12],
      typeMatchups: evolvedPokemonData[53],
      fullData: evolvedPokemonData
    });

    // Show loading screen with preloaded splash image
    showLoadingWithSplash(preloadedSplashImage);

    // Call API to evolve Pokemon and wait for full calculated data
    const response = await PokemonAPI.evolve(
      currentPokemon[2],
      currentPokemon[0],
      evolvedPokemonData
    );

    console.log('[Evolution] Received response from server:', response);

    if (response.status === 'success') {
      let finalEvolvedPokemon;

      if (response.newPokemonData) {
        // Server returned the calculated data (preferred)
        finalEvolvedPokemon = response.newPokemonData;
        console.log('[Evolution] Using newPokemonData from server response');
      } else {
        // Fallback: Server updated database but didn't return data, so fetch it
        console.log('[Evolution] Server didnt return newPokemonData, fetching from database...');
        const fetchResponse = await PokemonAPI.get(currentPokemon[0], evolvedPokemonData[2]);
        if (fetchResponse.status === 'success' && fetchResponse.data) {
          finalEvolvedPokemon = fetchResponse.data;
          console.log('[Evolution] Fetched evolved Pokemon from database');
        } else {
          throw new Error('Failed to fetch evolved Pokemon data from database');
        }
      }

      console.log('[Evolution] Final evolved Pokemon:', {
        name: finalEvolvedPokemon[2],
        image: finalEvolvedPokemon[1],
        hitDice: finalEvolvedPokemon[9],
        hp: finalEvolvedPokemon[10],
        vitalityDice: finalEvolvedPokemon[11],
        vp: finalEvolvedPokemon[12],
        typeMatchups: finalEvolvedPokemon[53],
        fullData: finalEvolvedPokemon
      });

      // Clean up pre-evolved Pokemon from cache
      const preEvolvedKey = `pokemon_${currentPokemon[2].toLowerCase()}`;
      sessionStorage.removeItem(preEvolvedKey);

      // Clear pokemon list cache
      const trainerData = JSON.parse(sessionStorage.getItem('trainerData'));
      if (trainerData) {
        sessionStorage.removeItem(`pokemonList_${trainerData[1]}`);
      }

      // Store evolved Pokemon with all calculated values
      sessionStorage.setItem(`pokemon_${finalEvolvedPokemon[2].toLowerCase()}`, JSON.stringify(finalEvolvedPokemon));
      sessionStorage.setItem('selectedPokemonName', finalEvolvedPokemon[2]);

      console.log('[Evolution] Stored in sessionStorage, about to navigate');

      // Hide loading screen
      hideLoading();

      // Navigate to pokemon card
      window.dispatchEvent(new CustomEvent('navigate', {
        detail: { route: 'pokemon-card', pokemonName: finalEvolvedPokemon[2] }
      }));
    } else {
      console.error('[Evolution] API returned error:', response);
      throw new Error('Evolution failed: ' + (response.message || 'Unknown error'));
    }
  } catch (error) {
    console.error('Error during evolution:', error);
    hideLoading();
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
