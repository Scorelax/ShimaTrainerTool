// My Pokemon Page - Display trainer's Pokemon grid with pagination

import { showError } from '../utils/notifications.js';

// Module state
let currentPage = 1;
const pokemonsPerPage = 9;
let allPokemons = [];

export function renderMyPokemon() {
  const html = `
    <div class="my-pokemon-page">
      <style>
        body, .content {
          background: linear-gradient(to bottom, #f44336 80%, #ffffff 20%);
        }

        .my-pokemon-page {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 2rem 1rem;
          min-height: 80vh;
        }

        .my-pokemon-page h1 {
          color: white;
          margin-bottom: 2rem;
          font-size: 2.5rem;
        }

        .pokemon-list-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 90%;
          max-width: 1200px;
        }

        .pokemon-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 20px;
          width: 100%;
          margin-bottom: 2rem;
        }

        .pokemon-slot {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 10px;
        }

        .pokemon-image {
          width: 150px;
          height: 150px;
          border-radius: 10px;
          object-fit: contain;
          background-color: #f0f0f0;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
          margin-bottom: 10px;
          cursor: pointer;
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }

        .pokemon-image:hover {
          transform: scale(1.05);
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
        }

        .pokemon-image:active {
          transform: scale(0.95);
        }

        .pokemon-name {
          font-size: 1.3rem;
          margin-bottom: 5px;
          color: white;
          font-weight: bold;
          text-align: center;
        }

        .pokemon-level {
          font-size: 1.1rem;
          color: white;
        }

        .controls-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1rem;
          margin-top: 1rem;
        }

        .navigation-buttons {
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        .nav-button {
          background-color: white;
          color: black;
          border: none;
          border-radius: 5px;
          padding: 10px 20px;
          font-size: 1.1rem;
          cursor: pointer;
          transition: background-color 0.3s;
        }

        .nav-button:hover {
          background-color: #f0f0f0;
        }

        .nav-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        #pageIndicator {
          font-size: 1.2rem;
          font-weight: bold;
          color: white;
        }

        .register-button {
          background-color: #4CAF50;
          color: white;
          border: none;
          border-radius: 5px;
          padding: 15px 30px;
          font-size: 1.2rem;
          cursor: pointer;
          transition: background-color 0.3s;
        }

        .register-button:hover {
          background-color: #45a049;
        }

        .empty-state {
          text-align: center;
          color: white;
          font-size: 1.3rem;
          padding: 3rem;
        }

        @media (max-width: 768px) {
          .pokemon-grid {
            grid-template-columns: repeat(2, 1fr);
          }

          .pokemon-image {
            width: 120px;
            height: 120px;
          }
        }

        @media (max-width: 480px) {
          .pokemon-grid {
            grid-template-columns: 1fr;
          }
        }
      </style>

      <h1>My Pokemon</h1>
      <div class="pokemon-list-container">
        <div class="pokemon-grid" id="pokemonGrid">
          <!-- Pokemon slots will be dynamically generated -->
        </div>
      </div>

      <div class="controls-container">
        <div class="navigation-buttons">
          <button class="nav-button" id="prevBtn">&lt; Prev</button>
          <span id="pageIndicator">1/1</span>
          <button class="nav-button" id="nextBtn">Next &gt;</button>
        </div>
        <button class="register-button" id="registerNewBtn">Register New Pokemon</button>
      </div>
    </div>
  `;

  return html;
}

export function attachMyPokemonListeners() {
  // Reset state
  currentPage = 1;
  allPokemons = [];

  // Load Pokemon from session storage
  loadPokemonList();

  // Navigation buttons
  document.getElementById('prevBtn')?.addEventListener('click', prevPage);
  document.getElementById('nextBtn')?.addEventListener('click', nextPage);

  // Register new Pokemon button
  document.getElementById('registerNewBtn')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('navigate', {
      detail: { route: 'new-pokemon' }
    }));
  });
}

function loadPokemonList() {
  allPokemons = [];

  // Retrieve all Pokemon data from session storage
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    if (key.startsWith('pokemon_')) {
      try {
        const pokemonData = JSON.parse(sessionStorage.getItem(key));
        allPokemons.push({
          image: pokemonData[1],
          name: pokemonData[2],
          dexentry: pokemonData[3],
          level: pokemonData[4],
          nickname: pokemonData[36]
        });
      } catch (e) {
        console.error('Error parsing pokemon data:', key, e);
      }
    }
  }

  // Sort by dex entry
  allPokemons.sort((a, b) => a.dexentry - b.dexentry);

  renderPokemonList();
}

function renderPokemonList() {
  const pokemonGrid = document.getElementById('pokemonGrid');
  if (!pokemonGrid) return;

  pokemonGrid.innerHTML = '';

  if (allPokemons.length === 0) {
    pokemonGrid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        No Pokemon found. Register your first Pokemon!
      </div>
    `;
    updatePageIndicator();
    return;
  }

  const startIndex = (currentPage - 1) * pokemonsPerPage;
  const endIndex = startIndex + pokemonsPerPage;
  const currentPokemons = allPokemons.slice(startIndex, endIndex);

  currentPokemons.forEach(pokemon => {
    const slot = document.createElement('div');
    slot.className = 'pokemon-slot';

    const img = document.createElement('img');
    img.className = 'pokemon-image';
    img.src = pokemon.image || 'assets/Pokeball.png';
    img.alt = pokemon.name;
    img.onerror = () => { img.src = 'assets/Pokeball.png'; };

    // Make image clickable to view details
    img.addEventListener('click', () => {
      sessionStorage.setItem('selectedPokemonName', pokemon.name);
      window.dispatchEvent(new CustomEvent('navigate', {
        detail: { route: 'pokemon-card', pokemonName: pokemon.name }
      }));
    });

    const name = document.createElement('div');
    name.className = 'pokemon-name';
    name.textContent = pokemon.nickname || pokemon.name;

    const level = document.createElement('div');
    level.className = 'pokemon-level';
    level.textContent = `Level: ${pokemon.level || 'N/A'}`;

    slot.appendChild(img);
    slot.appendChild(name);
    slot.appendChild(level);

    pokemonGrid.appendChild(slot);
  });

  updatePageIndicator();
}

function updatePageIndicator() {
  const totalPages = Math.max(1, Math.ceil(allPokemons.length / pokemonsPerPage));
  const indicator = document.getElementById('pageIndicator');
  if (indicator) {
    indicator.textContent = `${currentPage}/${totalPages}`;
  }

  // Update button states
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  if (prevBtn) prevBtn.disabled = currentPage <= 1;
  if (nextBtn) nextBtn.disabled = currentPage >= totalPages;
}

function prevPage() {
  if (currentPage > 1) {
    currentPage--;
    renderPokemonList();
  }
}

function nextPage() {
  const totalPages = Math.ceil(allPokemons.length / pokemonsPerPage);
  if (currentPage < totalPages) {
    currentPage++;
    renderPokemonList();
  }
}
