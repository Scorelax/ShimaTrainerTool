// Main Application Entry Point
import { PokemonAPI, TrainerAPI, GameDataAPI, OfflineManager } from './api.js';
import { TrainerCard } from './components/trainer-card.js';
import { showToast, showError } from './utils/notifications.js';

// ============================================================================
// APPLICATION STATE
// ============================================================================

const AppState = {
  currentRoute: 'home',
  currentTrainer: null,
  gameData: null,
  isLoading: false
};

// ============================================================================
// ROUTER
// ============================================================================

class Router {
  constructor() {
    this.routes = {
      home: this.renderHome.bind(this),
      trainers: this.renderTrainers.bind(this),
      'trainer-card': this.renderTrainerCard.bind(this),
      pokemon: this.renderPokemonList.bind(this),
      pokedex: this.renderPokedex.bind(this)
    };

    this.init();
  }

  init() {
    // Handle navigation clicks
    document.addEventListener('click', (e) => {
      const link = e.target.closest('[data-route]');
      if (link) {
        e.preventDefault();
        const route = link.dataset.route;
        const params = link.dataset.params ? JSON.parse(link.dataset.params) : {};
        this.navigate(route, params);
      }
    });

    // Handle browser back/forward
    window.addEventListener('popstate', (e) => {
      if (e.state && e.state.route) {
        this.render(e.state.route, e.state.params);
      }
    });

    // Load initial route
    const hash = window.location.hash.slice(1) || 'home';
    this.navigate(hash, {}, false);
  }

  navigate(route, params = {}, pushState = true) {
    if (this.routes[route]) {
      AppState.currentRoute = route;

      // Update URL
      if (pushState) {
        const url = `#${route}`;
        window.history.pushState({ route, params }, '', url);
      }

      // Update active nav link
      document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.toggle('active', link.dataset.route === route);
      });

      // Render the route
      this.render(route, params);
    } else {
      showError(`Route "${route}" not found`);
    }
  }

  async render(route, params) {
    const content = document.getElementById('content');

    // Show loading state
    content.innerHTML = '<div class="loading">Loading...</div>';

    try {
      await this.routes[route](params);
    } catch (error) {
      console.error('Route error:', error);
      content.innerHTML = `
        <div class="error">
          <h2>Error loading content</h2>
          <p>${error.message}</p>
          <button onclick="location.reload()">Retry</button>
        </div>
      `;
    }
  }

  // ============================================================================
  // ROUTE RENDERERS
  // ============================================================================

  async renderHome() {
    const content = document.getElementById('content');
    content.innerHTML = `
      <div class="home-page">
        <header class="hero">
          <h1>🎮 Pokemon D&D Trainer Tool</h1>
          <p>Manage your trainers, catch Pokemon, and track your adventure!</p>
        </header>

        <div class="quick-actions">
          <div class="action-card" data-route="trainers">
            <div class="icon">👤</div>
            <h3>View Trainers</h3>
            <p>Browse all registered trainers</p>
          </div>

          <div class="action-card" data-route="pokemon">
            <div class="icon">🎒</div>
            <h3>Pokemon List</h3>
            <p>See all caught Pokemon</p>
          </div>

          <div class="action-card" data-route="pokedex">
            <div class="icon">📖</div>
            <h3>Pokedex</h3>
            <p>Browse available Pokemon</p>
          </div>
        </div>
      </div>
    `;
  }

  async renderTrainers() {
    const content = document.getElementById('content');

    try {
      // Fetch trainer data
      const response = await TrainerAPI.getAll();
      const trainers = response.data;

      if (!trainers || trainers.length === 0) {
        content.innerHTML = `
          <div class="empty-state">
            <h2>No Trainers Found</h2>
            <p>Start by creating a new trainer!</p>
            <button class="btn btn-primary">Create Trainer</button>
          </div>
        `;
        return;
      }

      // Render trainer grid
      content.innerHTML = `
        <div class="trainers-page">
          <header class="page-header">
            <h1>Trainers</h1>
            <button class="btn btn-primary">+ New Trainer</button>
          </header>

          <div class="trainer-grid">
            ${trainers.map(trainer => `
              <div class="trainer-card-preview"
                   data-route="trainer-card"
                   data-params='{"name": "${trainer.name}"}'>
                <img src="${trainer.image}" alt="${trainer.name}"
                     onerror="this.src='assets/default-trainer.png'">
                <h3>${trainer.name}</h3>
                <div class="trainer-meta">
                  <span class="badge">ID: ${trainer.id}</span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;

    } catch (error) {
      showError('Failed to load trainers: ' + error.message);
    }
  }

  async renderTrainerCard(params) {
    const content = document.getElementById('content');

    if (!params.name) {
      content.innerHTML = '<div class="error">Trainer name required</div>';
      return;
    }

    try {
      // Fetch trainer data with Pokemon
      const response = await TrainerAPI.get(params.name);

      if (!response.data) {
        throw new Error('Trainer not found');
      }

      // Use TrainerCard component
      const card = new TrainerCard(response.data);
      content.innerHTML = card.render();

      // Attach event listeners
      card.attachEventListeners();

    } catch (error) {
      showError('Failed to load trainer: ' + error.message);
    }
  }

  async renderPokemonList() {
    const content = document.getElementById('content');

    try {
      const response = await PokemonAPI.getRegisteredList();
      const pokemon = response.data;

      content.innerHTML = `
        <div class="pokemon-page">
          <header class="page-header">
            <h1>Registered Pokemon</h1>
            <div class="filters">
              <input type="search" placeholder="Search Pokemon..." class="search-input">
              <select class="filter-select">
                <option value="">All Types</option>
                <option value="fire">Fire</option>
                <option value="water">Water</option>
                <option value="grass">Grass</option>
                <!-- Add more types -->
              </select>
            </div>
          </header>

          <div class="pokemon-grid">
            ${pokemon.map(p => `
              <div class="pokemon-card">
                <img src="${p[0] || 'assets/default-pokemon.png'}"
                     alt="${p[1]}"
                     onerror="this.src='assets/default-pokemon.png'">
                <div class="pokemon-info">
                  <h3>${p[1]}</h3>
                  <span class="pokemon-id">#${String(p[2]).padStart(3, '0')}</span>
                  <div class="pokemon-types">
                    <span class="type type-${p[4]?.toLowerCase()}">${p[4]}</span>
                    ${p[5] ? `<span class="type type-${p[5].toLowerCase()}">${p[5]}</span>` : ''}
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;

    } catch (error) {
      showError('Failed to load Pokemon: ' + error.message);
    }
  }

  async renderPokedex() {
    const content = document.getElementById('content');
    content.innerHTML = `
      <div class="pokedex-page">
        <h1>Pokedex</h1>
        <p>Coming soon!</p>
      </div>
    `;
  }
}

// ============================================================================
// APP INITIALIZATION
// ============================================================================

async function initApp() {
  console.log('🚀 Initializing Pokemon D&D Tool...');

  try {
    // Show loading screen
    document.getElementById('loading-screen').classList.add('active');

    // Load essential game data
    console.log('📦 Loading game data...');
    AppState.gameData = await GameDataAPI.getAll();
    console.log('✅ Game data loaded');

    // Initialize router
    new Router();

    // Hide loading screen, show app
    document.getElementById('loading-screen').classList.remove('active');
    document.getElementById('app').classList.remove('hidden');

    console.log('✨ App ready!');

  } catch (error) {
    console.error('❌ App initialization failed:', error);

    // Show error screen
    document.getElementById('loading-screen').classList.remove('active');
    document.getElementById('error-screen').classList.remove('hidden');
    document.getElementById('error-message').textContent = error.message;
  }
}

// ============================================================================
// OFFLINE/ONLINE HANDLERS
// ============================================================================

document.addEventListener('app:offline', () => {
  document.getElementById('offline-indicator').classList.remove('hidden');
  showToast('You are offline. Some features may be unavailable.', 'warning');
});

document.addEventListener('app:online', () => {
  document.getElementById('offline-indicator').classList.add('hidden');
  showToast('Back online!', 'success');
});

// ============================================================================
// START APP
// ============================================================================

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

// Export for debugging
window.AppState = AppState;
window.PokemonAPI = PokemonAPI;
window.TrainerAPI = TrainerAPI;
