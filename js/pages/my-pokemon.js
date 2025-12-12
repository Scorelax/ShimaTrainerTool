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
          background:
            radial-gradient(circle at 20% 80%, rgba(255, 222, 0, 0.15) 0%, transparent 50%),
            radial-gradient(circle at 80% 20%, rgba(59, 76, 202, 0.15) 0%, transparent 50%),
            radial-gradient(circle at 40% 40%, rgba(238, 21, 21, 0.3) 0%, transparent 40%),
            linear-gradient(to bottom, #EE1515 0%, #C91010 50%, #A00808 100%);
          min-height: 100vh;
          position: relative;
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
          background-size: 50px 50px, 80px 80px;
          background-position: 0 0, 40px 40px;
          pointer-events: none;
          opacity: 0.5;
        }

        .my-pokemon-page {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: clamp(5rem, 10vh, 7rem) clamp(1rem, 3vw, 2rem) clamp(1rem, 2vh, 1.5rem);
          min-height: auto;
          position: relative;
          box-sizing: border-box;
        }

        .my-pokemon-page h1 {
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
          background: transparent;
          padding: 0;
          cursor: pointer;
          transition: transform 0.3s, filter 0.3s;
        }

        .pokemon-slot:hover {
          transform: translateY(clamp(-3px, -0.8vh, -5px));
          filter: brightness(1.1) drop-shadow(0 0 clamp(10px, 2vw, 15px) rgba(255,222,0,0.6));
        }

        .pokemon-image {
          width: 85%;
          height: auto;
          aspect-ratio: 1;
          border-radius: clamp(12px, 2.5vw, 18px);
          object-fit: cover;
          margin-bottom: clamp(0.5rem, 1vh, 0.75rem);
          border: clamp(3px, 0.6vw, 4px) solid #FFDE00;
          box-shadow: 0 clamp(8px, 1.5vh, 12px) clamp(20px, 4vh, 30px) rgba(0,0,0,0.5);
          background-color: #fff;
          cursor: pointer;
          transition: transform 0.3s;
        }

        .pokemon-name {
          font-size: clamp(1.1rem, 2.4vw, 1.5rem);
          margin-bottom: clamp(0.2rem, 0.5vh, 0.3rem);
          color: #FFDE00;
          text-align: center;
          font-weight: 900;
          text-shadow: 0 2px 6px rgba(0,0,0,0.8);
        }

        .pokemon-level {
          font-size: clamp(0.95rem, 2vw, 1.3rem);
          color: white;
          text-align: center;
          font-weight: 600;
          text-shadow: 0 2px 4px rgba(0,0,0,0.6);
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

        .empty-state {
          text-align: center;
          color: white;
          font-size: clamp(1rem, 2.5vw, 1.5rem);
          padding: clamp(1.5rem, 4vh, 4rem);
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
      sessionStorage.setItem('previousRoute', 'my-pokemon');
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
