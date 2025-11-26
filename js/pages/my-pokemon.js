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
          padding: clamp(1.5rem, 5vh, 3rem) clamp(0.5rem, 3vw, 2rem);
          min-height: 85vh;
        }

        .my-pokemon-page h1 {
          color: white;
          margin-bottom: clamp(1.5rem, 5vh, 3rem);
          font-size: clamp(2rem, 6vw, 3.5rem);
          font-weight: 900;
          letter-spacing: clamp(0.5px, 0.2vw, 1.5px);
          text-shadow: 0 clamp(2px, 0.5vh, 5px) clamp(6px, 1.5vw, 12px) rgba(0,0,0,0.5),
                       0 0 clamp(15px, 3vw, 25px) rgba(255,222,0,0.3);
        }

        .pokemon-list-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 90%;
          max-width: min(100vw, 1200px);
        }

        .pokemon-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: clamp(1rem, 3vw, 2.5rem);
          width: 100%;
          margin-bottom: clamp(1.5rem, 5vh, 3rem);
        }

        .pokemon-slot {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: clamp(0.5rem, 1.5vw, 1.5rem);
        }

        .pokemon-image {
          width: clamp(100px, min(20vw, 25vh), 180px);
          height: clamp(100px, min(20vw, 25vh), 180px);
          border-radius: clamp(15px, 3vw, 35px);
          object-fit: contain;
          background: transparent;
          border: none;
          box-shadow: 0 clamp(5px, 1.5vh, 12px) clamp(18px, 4vw, 30px) rgba(0,0,0,0.5);
          margin-bottom: clamp(0.5rem, 2vh, 1.5rem);
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .pokemon-image:hover {
          transform: translateY(clamp(-5px, -1.5vh, -12px)) scale(1.08);
          box-shadow: 0 clamp(10px, 2.5vh, 18px) clamp(30px, 6vw, 50px) rgba(0,0,0,0.6),
                      0 0 clamp(20px, 4vw, 35px) rgba(255,222,0,0.4);
        }

        .pokemon-image:active {
          transform: translateY(clamp(-2px, -1vh, -6px)) scale(1.05);
        }

        .pokemon-name {
          font-size: clamp(1rem, 2.5vw, 1.5rem);
          margin-bottom: clamp(0.25rem, 1vh, 0.75rem);
          color: white;
          font-weight: 800;
          text-align: center;
          text-transform: uppercase;
          letter-spacing: clamp(0.25px, 0.15vw, 0.75px);
          text-shadow: 0 clamp(1px, 0.3vh, 3px) clamp(3px, 1vw, 7px) rgba(0,0,0,0.5);
        }

        .pokemon-level {
          font-size: clamp(0.9rem, 2vw, 1.3rem);
          color: #FFDE00;
          font-weight: 700;
          text-shadow: 0 clamp(1px, 0.3vh, 3px) clamp(3px, 1vw, 7px) rgba(0,0,0,0.5);
        }

        .controls-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: clamp(0.75rem, 2vh, 1.5rem);
          margin-top: clamp(0.75rem, 2vh, 1.5rem);
        }

        .navigation-buttons {
          display: flex;
          align-items: center;
          gap: clamp(0.75rem, 2vw, 1.5rem);
        }

        .nav-button {
          background: linear-gradient(135deg, #FFFFFF 0%, #F5F5F5 100%);
          color: #333;
          border: clamp(2px, 0.3vw, 4px) solid #FFDE00;
          border-radius: clamp(10px, 2vw, 20px);
          padding: clamp(0.75rem, 1.5vh, 1.5rem) clamp(1.5rem, 4vw, 3rem);
          font-size: clamp(0.9rem, 2vw, 1.3rem);
          font-weight: bold;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 clamp(3px, 1vh, 8px) clamp(10px, 2.5vw, 18px) rgba(0,0,0,0.2);
        }

        .nav-button:hover {
          transform: translateY(clamp(-2px, -0.8vh, -5px));
          box-shadow: 0 clamp(5px, 1.5vh, 12px) clamp(15px, 3vw, 25px) rgba(0,0,0,0.3),
                      0 0 clamp(15px, 3vw, 25px) rgba(255,222,0,0.5);
          border-color: #FFC700;
        }

        .nav-button:disabled {
          opacity: 0.4;
          cursor: not-allowed;
          transform: none;
        }

        .nav-button:disabled:hover {
          box-shadow: 0 clamp(3px, 1vh, 8px) clamp(10px, 2.5vw, 18px) rgba(0,0,0,0.2);
          border-color: #FFDE00;
        }

        #pageIndicator {
          font-size: clamp(1rem, 2.5vw, 1.5rem);
          font-weight: 900;
          color: white;
          text-shadow: 0 clamp(1px, 0.3vh, 3px) clamp(3px, 1vw, 7px) rgba(0,0,0,0.5);
          min-width: clamp(60px, 12vw, 100px);
          text-align: center;
        }

        .register-button {
          background: linear-gradient(135deg, #4CAF50 0%, #45A049 100%);
          color: white;
          border: clamp(2px, 0.4vw, 5px) solid #FFDE00;
          border-radius: clamp(30px, 8vw, 60px);
          padding: clamp(0.75rem, 1.5vh, 1.5rem) clamp(1.5rem, 5vw, 3.5rem);
          font-size: clamp(1rem, 2.5vw, 1.5rem);
          font-weight: 900;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 clamp(5px, 1.5vh, 12px) clamp(15px, 3.5vw, 25px) rgba(76,175,80,0.4),
                      inset 0 clamp(-2px, -0.5vh, -4px) 0 rgba(0,0,0,0.2);
          text-transform: uppercase;
          letter-spacing: clamp(0.5px, 0.15vw, 1.5px);
        }

        .register-button:hover {
          transform: translateY(clamp(-3px, -1vh, -7px)) scale(1.02);
          box-shadow: 0 clamp(8px, 2vh, 16px) clamp(22px, 5vw, 40px) rgba(76,175,80,0.5),
                      inset 0 clamp(-2px, -0.5vh, -4px) 0 rgba(0,0,0,0.2),
                      0 0 clamp(20px, 4vw, 35px) rgba(255,222,0,0.5);
          border-color: #FFC700;
        }

        .register-button:active {
          transform: translateY(clamp(-2px, -0.8vh, -5px)) scale(1.0);
        }

        .back-button {
          position: fixed;
          top: clamp(10px, 2vh, 30px);
          left: clamp(10px, 2vw, 30px);
          background: linear-gradient(135deg, #FFFFFF 0%, #F5F5F5 100%);
          color: #333;
          width: clamp(40px, 8vw, 70px);
          height: clamp(40px, 8vw, 70px);
          border: clamp(2px, 0.3vw, 4px) solid #FFDE00;
          border-radius: 50%;
          font-size: clamp(1.2rem, 3vw, 2.5rem);
          font-weight: bold;
          cursor: pointer;
          box-shadow: 0 clamp(5px, 1.5vh, 12px) clamp(15px, 3vw, 25px) rgba(0,0,0,0.3);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          padding: 0;
        }

        .back-button:hover {
          transform: scale(1.1);
          box-shadow: 0 clamp(8px, 2vh, 16px) clamp(20px, 4vw, 35px) rgba(0,0,0,0.4),
                      0 0 clamp(15px, 3vw, 25px) rgba(255,222,0,0.5);
          border-color: #FFC700;
        }

        .back-button:active {
          transform: scale(1.05);
        }

        .empty-state {
          text-align: center;
          color: white;
          font-size: clamp(1rem, 2.5vw, 1.5rem);
          padding: clamp(1.5rem, 4vh, 4rem);
        }

        @media (max-width: 768px) {
          .pokemon-grid {
            grid-template-columns: repeat(2, 1fr);
          }

          .pokemon-image {
            width: clamp(90px, 20vw, 160px);
            height: clamp(90px, 20vw, 160px);
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

      <button class="back-button" id="backButton">←</button>
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
