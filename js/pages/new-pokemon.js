// New Pokemon Page - Register new Pokemon from encountered list

import { PokemonAPI } from '../api.js';
import { showError } from '../utils/notifications.js';

// Module state
let selectedPokemon = null;
let allEncounteredPokemon = [];
const imageCache = new Map();
const IMAGE_BASE_URL = 'https://raw.githubusercontent.com/Benjakronk/shima-pokedex/main/images/';
const IMAGE_FORMATS = ['png', 'jpg', 'jpeg', 'jfif'];

export function renderNewPokemon() {
  const html = `
    <div class="new-pokemon-page">
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

        .new-pokemon-page::before {
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

        .new-pokemon-page {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: clamp(1.5rem, 3vh, 2rem) clamp(0.75rem, 2vw, 1rem);
          min-height: 85vh;
          position: relative;
        }

        .new-pokemon-page > * {
          position: relative;
          z-index: 1;
        }

        .new-pokemon-page h1 {
          color: white;
          margin-bottom: clamp(1.5rem, 3vh, 2rem);
          font-size: clamp(2rem, 5vw, 3rem);
          font-weight: 900;
          letter-spacing: clamp(0.5px, 0.3vw, 1px);
          text-shadow: 0 clamp(3px, 0.8vh, 4px) clamp(8px, 2vh, 10px) rgba(0,0,0,0.5),
                       0 0 clamp(15px, 4vw, 20px) rgba(255,222,0,0.3);
        }

        .register-container {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          width: 90%;
          max-width: clamp(900px, 95vw, 1400px);
          gap: clamp(1.5rem, 3vw, 2rem);
        }

        .pokemon-list {
          width: 58%;
          max-height: 70vh;
          overflow-y: auto;
          border: clamp(3px, 0.6vw, 4px) solid #FFDE00;
          border-radius: clamp(15px, 3vw, 20px);
          padding: clamp(15px, 3vw, 20px);
          background: linear-gradient(135deg, #FFFFFF 0%, #F8F8F8 100%);
          box-shadow: 0 clamp(8px, 2vh, 10px) clamp(25px, 5vw, 30px) rgba(0,0,0,0.3);
        }

        .pokemon-list h2 {
          text-align: center;
          margin-top: 0;
          margin-bottom: clamp(12px, 2vh, 15px);
          font-size: clamp(1.2rem, 2.5vw, 1.5rem);
        }

        .search-container {
          position: sticky;
          top: 0;
          background-color: white;
          padding-bottom: clamp(8px, 1.5vh, 10px);
          margin-bottom: clamp(8px, 1.5vh, 10px);
          border-bottom: clamp(1px, 0.2vw, 2px) solid #e0e0e0;
        }

        .search-input {
          width: 100%;
          padding: clamp(8px, 1.5vh, 10px);
          font-size: clamp(0.9rem, 1.8vw, 1rem);
          border: clamp(2px, 0.3vw, 3px) solid #ddd;
          border-radius: clamp(4px, 1vw, 5px);
          box-sizing: border-box;
        }

        .search-input:focus {
          border-color: #f44336;
          outline: none;
        }

        .pokemon-list ul {
          list-style: none;
          padding: 0;
          margin: 0;
        }

        .pokemon-list li {
          font-size: clamp(1rem, 2vw, 1.1rem);
          margin-bottom: clamp(8px, 1.5vh, 10px);
          cursor: pointer;
          padding: clamp(6px, 1.5vh, 8px);
          border-radius: clamp(4px, 1vw, 5px);
          transition: background-color 0.2s;
        }

        .pokemon-list li:hover {
          background-color: #f0f0f0;
        }

        .pokemon-list li.selected {
          background-color: #f44336;
          color: white;
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
          /* Always visible now, this class can remain for compatibility */
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

        .register-btn {
          background: linear-gradient(135deg, #4CAF50 0%, #45A049 100%);
          color: white;
          border: clamp(2px, 0.5vw, 5px) solid #FFDE00;
          border-radius: clamp(30px, 8vw, 60px);
          padding: clamp(0.75rem, 1.5vh, 1.5rem) clamp(1.5rem, 5vw, 3.5rem);
          font-size: clamp(1rem, 2.5vw, 1.5rem);
          font-weight: 900;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          margin-top: clamp(1rem, 3vh, 2rem);
          box-shadow: 0 clamp(5px, 1.5vh, 12px) clamp(15px, 3.5vw, 25px) rgba(76,175,80,0.4);
          text-transform: uppercase;
          letter-spacing: clamp(0.5px, 0.15vw, 1.5px);
        }

        .register-btn:hover {
          transform: translateY(clamp(-3px, -1vh, -7px)) scale(1.02);
          box-shadow: 0 clamp(8px, 2vh, 16px) clamp(22px, 5vw, 40px) rgba(76,175,80,0.5),
                      0 0 clamp(20px, 4vw, 35px) rgba(255,222,0,0.5);
          border-color: #FFC700;
        }

        .no-results {
          text-align: center;
          color: #666;
          font-size: clamp(0.9rem, 2vw, 1.2rem);
          padding: clamp(1rem, 3vh, 2rem);
        }

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

        @media (max-width: 1024px) {
          .register-container {
            gap: clamp(1.5rem, 3vw, 2.5rem);
          }
        }

        @media (max-width: 768px) {
          .register-container {
            gap: clamp(1rem, 2.5vw, 2rem);
          }
        }

        @media (max-width: 600px) {
          .register-container {
            gap: clamp(0.75rem, 2vw, 1.5rem);
          }
        }

        @media (max-width: 480px) {
          .register-container {
            flex-direction: column;
            gap: clamp(0.5rem, 1.5vw, 1rem);
          }

          .pokemon-list,
          .pokemon-details {
            width: 100%;
          }
        }
      </style>

      <h1>Register New Pokemon</h1>

      <div class="register-container">
        <div class="pokemon-list">
          <h2>Encountered Pokemon</h2>
          <div class="search-container">
            <input type="text" id="pokemonSearch" class="search-input"
                   placeholder="Search by name or dex number..." autocomplete="off">
          </div>
          <ul id="pokemonList">
            <li>Loading Pokemon...</li>
          </ul>
        </div>

        <div class="pokemon-details empty" id="pokemonDetails">
          <div id="pokemonDetailsContent" style="display: none; width: 100%; flex-direction: column; align-items: center;">
            <img src="" alt="Pokemon" id="pokemonImage" onerror="this.src='assets/Pokeball.png'">
            <div class="detail-item">Name: <strong id="pokemonName"></strong></div>
            <div class="detail-item">Dex Entry: <strong id="pokemonDexEntry"></strong></div>
            <div class="detail-item">Type: <strong id="pokemonType"></strong></div>
            <button class="register-btn" id="registerBtn">Register Pokemon</button>
          </div>
          <div id="pokemonPlaceholder">Select a Pokemon to view details</div>
        </div>
      </div>

      <button class="back-button" id="backButton">←</button>
    </div>
  `;

  return html;
}

export function attachNewPokemonListeners() {
  // Reset state
  selectedPokemon = null;
  allEncounteredPokemon = [];

  // Load encountered Pokemon
  loadEncounteredPokemon();

  // Search functionality
  document.getElementById('pokemonSearch')?.addEventListener('input', handleSearch);

  // Register button
  document.getElementById('registerBtn')?.addEventListener('click', registerPokemon);

  // Back button
  document.getElementById('backButton')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('navigate', {
      detail: { route: 'my-pokemon' }
    }));
  });
}

async function loadEncounteredPokemon() {
  // Check for cached data first
  const cached = sessionStorage.getItem('completePokemonData');
  if (cached) {
    try {
      allEncounteredPokemon = JSON.parse(cached);
      displayPokemonList(allEncounteredPokemon);
      return;
    } catch (e) {
      console.error('Failed to parse cached data:', e);
    }
  }

  // Fetch from API
  try {
    const response = await PokemonAPI.getRegisteredList();

    if (response.status === 'success' && response.data) {
      allEncounteredPokemon = response.data;
      sessionStorage.setItem('completePokemonData', JSON.stringify(response.data));
      displayPokemonList(allEncounteredPokemon);

      // Resolve images in background
      resolveImagesProgressively(allEncounteredPokemon);
    } else {
      showError('Failed to load Pokemon list');
      document.getElementById('pokemonList').innerHTML = '<li>Failed to load Pokemon</li>';
    }
  } catch (error) {
    console.error('Error loading Pokemon:', error);
    showError('Failed to load Pokemon list');
    document.getElementById('pokemonList').innerHTML = '<li>Failed to load Pokemon</li>';
  }
}

function displayPokemonList(pokemonList) {
  const listElement = document.getElementById('pokemonList');
  if (!listElement) return;

  listElement.innerHTML = '';

  if (pokemonList.length === 0) {
    listElement.innerHTML = '<div class="no-results">No Pokemon found</div>';
    return;
  }

  // Sort by dex entry
  const sortedList = [...pokemonList].sort((a, b) => a[2] - b[2]);

  sortedList.forEach((pokemon) => {
    const listItem = document.createElement('li');
    listItem.textContent = `#${pokemon[2]} - ${pokemon[1]}`;
    listItem.addEventListener('click', () => selectPokemon(pokemon, listItem));
    listElement.appendChild(listItem);
  });
}

function handleSearch(e) {
  const query = e.target.value.toLowerCase().trim();

  if (query.length === 0) {
    displayPokemonList(allEncounteredPokemon);
    return;
  }

  const filtered = allEncounteredPokemon.filter(pokemon => {
    const name = pokemon[1].toLowerCase();
    const dexNum = pokemon[2].toString();
    return name.includes(query) || dexNum.includes(query);
  });

  displayPokemonList(filtered);
}

async function selectPokemon(pokemon, listItem) {
  selectedPokemon = pokemon;

  // Update selected styling
  document.querySelectorAll('.pokemon-list li').forEach(li => li.classList.remove('selected'));
  listItem.classList.add('selected');

  // Show details
  const imageUrl = pokemon[0] || await resolveImageUrl(pokemon[1], pokemon[2]);

  // IMPORTANT: Store resolved image URL back into pokemon object
  // so it's available when registering the Pokemon
  if (!pokemon[0]) {
    pokemon[0] = imageUrl;
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
  const cacheKey = `${pokemonId}-${pokemonName}`;

  if (imageCache.has(cacheKey)) {
    return imageCache.get(cacheKey);
  }

  const paddedId = pokemonId.toString().padStart(3, '0');
  const sanitizedName = pokemonName.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const baseFileName = `${paddedId}-${sanitizedName}`;

  for (const format of IMAGE_FORMATS) {
    const url = `${IMAGE_BASE_URL}${baseFileName}.${format}`;
    if (await imageExists(url)) {
      imageCache.set(cacheKey, url);
      return url;
    }
  }

  const placeholder = 'assets/Pokeball.png';
  imageCache.set(cacheKey, placeholder);
  return placeholder;
}

function imageExists(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

async function resolveImagesProgressively(pokemonList) {
  const batchSize = 5;

  for (let i = 0; i < pokemonList.length; i += batchSize) {
    const batch = pokemonList.slice(i, Math.min(i + batchSize, pokemonList.length));

    await Promise.all(batch.map(async (pokemon) => {
      if (!pokemon[0]) {
        const imageUrl = await resolveImageUrl(pokemon[1], pokemon[2]);
        pokemon[0] = imageUrl;
      }
    }));

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // Update session storage
  sessionStorage.setItem('completePokemonData', JSON.stringify(pokemonList));
}

function registerPokemon() {
  if (!selectedPokemon) {
    showError('Please select a Pokemon first');
    return;
  }

  // Store selected Pokemon data for the registration form
  sessionStorage.setItem('selectedPokemonData', JSON.stringify(selectedPokemon));
  sessionStorage.setItem('selectedPokemonName', selectedPokemon[1]);

  // Navigate to Pokemon form
  window.dispatchEvent(new CustomEvent('navigate', {
    detail: { route: 'pokemon-form' }
  }));
}
