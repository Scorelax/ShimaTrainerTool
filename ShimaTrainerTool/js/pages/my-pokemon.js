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
          background: linear-gradient(135deg, #EE1515 0%, #C91010 50%, #A00808 100%);
          min-height: 100vh;
        }

        .my-pokemon-page {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 2rem 1rem;
          min-height: 85vh;
        }

        .my-pokemon-page h1 {
          color: white;
          margin-bottom: 2rem;
          font-size: 3rem;
          font-weight: 900;
          letter-spacing: 1px;
          text-shadow: 0 4px 10px rgba(0,0,0,0.5),
                       0 0 20px rgba(255,222,0,0.3);
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
          border-radius: 15px;
          object-fit: contain;
          background: linear-gradient(135deg, #FFFFFF 0%, #F5F5F5 100%);
          border: 3px solid #333;
          box-shadow: 0 5px 15px rgba(0,0,0,0.3);
          margin-bottom: 10px;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .pokemon-image:hover {
          transform: translateY(-8px) scale(1.05);
          box-shadow: 0 10px 30px rgba(0,0,0,0.4),
                      0 0 20px rgba(51,51,51,0.3);
          border-color: #000;
        }

        .pokemon-image:active {
          transform: translateY(-4px) scale(1.02);
        }

        .pokemon-name {
          font-size: 1.3rem;
          margin-bottom: 5px;
          color: white;
          font-weight: 800;
          text-align: center;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          text-shadow: 0 2px 5px rgba(0,0,0,0.5);
        }

        .pokemon-level {
          font-size: 1.1rem;
          color: #FFDE00;
          font-weight: 700;
          text-shadow: 0 2px 5px rgba(0,0,0,0.5);
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
          background: linear-gradient(135deg, #FFFFFF 0%, #F5F5F5 100%);
          color: #333;
          border: 3px solid #FFDE00;
          border-radius: 15px;
          padding: 12px 25px;
          font-size: 1.1rem;
          font-weight: bold;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 5px 15px rgba(0,0,0,0.2);
        }

        .nav-button:hover {
          transform: translateY(-3px);
          box-shadow: 0 8px 20px rgba(0,0,0,0.3),
                      0 0 20px rgba(255,222,0,0.5);
          border-color: #FFC700;
        }

        .nav-button:disabled {
          opacity: 0.4;
          cursor: not-allowed;
          transform: none;
        }

        .nav-button:disabled:hover {
          box-shadow: 0 5px 15px rgba(0,0,0,0.2);
          border-color: #FFDE00;
        }

        #pageIndicator {
          font-size: 1.3rem;
          font-weight: 900;
          color: white;
          text-shadow: 0 2px 5px rgba(0,0,0,0.5);
          min-width: 80px;
          text-align: center;
        }

        .register-button {
          background: linear-gradient(135deg, #4CAF50 0%, #45A049 100%);
          color: white;
          border: 4px solid #FFDE00;
          border-radius: 50px;
          padding: 1rem 2.5rem;
          font-size: 1.3rem;
          font-weight: 900;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 8px 20px rgba(76,175,80,0.4),
                      inset 0 -3px 0 rgba(0,0,0,0.2);
          text-transform: uppercase;
          letter-spacing: 1px;
        }

        .register-button:hover {
          transform: translateY(-5px) scale(1.02);
          box-shadow: 0 12px 30px rgba(76,175,80,0.5),
                      inset 0 -3px 0 rgba(0,0,0,0.2),
                      0 0 30px rgba(255,222,0,0.5);
          border-color: #FFC700;
        }

        .register-button:active {
          transform: translateY(-3px) scale(1.0);
        }

        .back-button {
          position: fixed;
          bottom: 40px;
          left: 50%;
          transform: translateX(-50%);
          background: linear-gradient(135deg, #FFFFFF 0%, #F5F5F5 100%);
          color: #333;
          padding: 1rem 2.5rem;
          border: 3px solid #FFDE00;
          border-radius: 50px;
          font-size: 1.3rem;
          font-weight: bold;
          cursor: pointer;
          box-shadow: 0 8px 20px rgba(0,0,0,0.3);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .back-button:hover {
          transform: translateX(-50%) translateY(-5px);
          box-shadow: 0 12px 30px rgba(0,0,0,0.4),
                      0 0 20px rgba(255,222,0,0.5);
          border-color: #FFC700;
        }

        .back-button:active {
          transform: translateX(-50%) translateY(-3px);
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

      <button class="back-button" id="backButton">Back to Trainer Card</button>
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

  // Back button
  document.getElementById('backButton')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('navigate', {
      detail: { route: 'trainer-card' }
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
