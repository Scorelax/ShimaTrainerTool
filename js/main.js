// Main Application Entry Point
import { PokemonAPI, TrainerAPI } from './api.js';
import { renderIndex, attachIndexListeners } from './pages/index.js';
import { renderContinueJourney, attachContinueJourneyListeners } from './pages/continue-journey.js';
import { renderTrainerCard, attachTrainerCardListeners } from './pages/trainer-card.js';
import { renderTrainerInfo, attachTrainerInfoListeners } from './pages/trainer-info.js';
import { renderEditTrainer, attachEditTrainerListeners } from './pages/edit-trainer.js';
import { renderPokemonCard, attachPokemonCardListeners } from './pages/pokemon-card.js';
import { renderEditPokemon, attachEditPokemonListeners } from './pages/edit-pokemon.js';
import { renderMyPokemon, attachMyPokemonListeners } from './pages/my-pokemon.js';
import { renderNewJourney, attachNewJourneyListeners } from './pages/new-journey.js';
import { renderNewPokemon, attachNewPokemonListeners } from './pages/new-pokemon.js';
import { renderPokemonForm, attachPokemonFormListeners } from './pages/pokemon-form.js';
import { renderEvolution, attachEvolutionListeners } from './pages/evolution.js';
import { showToast, showError } from './utils/notifications.js';
import { audioManager } from './utils/audio.js';

// ============================================================================
// APPLICATION STATE
// ============================================================================

const AppState = {
  currentRoute: 'index'
};

// ============================================================================
// ROUTER
// ============================================================================

class Router {
  constructor() {
    this.routes = {
      index: this.renderIndex.bind(this),
      'continue-journey': this.renderContinueJourney.bind(this),
      'trainer-card': this.renderTrainerCard.bind(this),
      'conduit-card': this.renderConduitCard.bind(this),
      'trainer-info': this.renderTrainerInfo.bind(this),
      'edit-trainer': this.renderEditTrainer.bind(this),
      'my-pokemon': this.renderMyPokemon.bind(this),
      'pokemon-card': this.renderPokemonCard.bind(this),
      'edit-pokemon': this.renderEditPokemon.bind(this),
      'new-journey': this.renderNewJourney.bind(this),
      'new-pokemon': this.renderNewPokemon.bind(this),
      'pokemon-form': this.renderPokemonForm.bind(this),
      'evolution': this.renderEvolution.bind(this)
    };

    this.init();
  }

  init() {
    // Handle navigation clicks (data-route attributes)
    document.addEventListener('click', (e) => {
      const link = e.target.closest('[data-route]');
      if (link) {
        e.preventDefault();
        const route = link.dataset.route;
        const params = link.dataset.params ? JSON.parse(link.dataset.params) : {};
        this.navigate(route, params);
      }
    });

    // Handle custom navigate events (from page components)
    window.addEventListener('navigate', (e) => {
      const { route, ...params } = e.detail;
      this.navigate(route, params);
    });

    // Handle browser back/forward
    window.addEventListener('popstate', (e) => {
      if (e.state && e.state.route) {
        this.render(e.state.route, e.state.params);
      }
    });

    // Load initial route
    const hash = window.location.hash.slice(1) || 'index';
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

      // Render the route
      this.render(route, params);
    } else {
      showError(`Route "${route}" not found`);
    }
  }

  async render(route, params) {
    audioManager.stopBg();
    const content = document.getElementById('content');

    // Scroll to top on navigation
    window.scrollTo(0, 0);

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

  async renderIndex() {
    const content = document.getElementById('content');
    content.innerHTML = renderIndex();
    attachIndexListeners();
    audioManager.playBg('Index');
  }

  async renderContinueJourney() {
    const content = document.getElementById('content');
    const html = await renderContinueJourney();
    content.innerHTML = html;
    attachContinueJourneyListeners();
    audioManager.playBg('ContinueJourney');
    // Hide the TitleScreen loading screen now that the page is ready
    const loadingScreen = document.getElementById('loading-screen');
    loadingScreen.classList.remove('active');
    const progressContainer = loadingScreen.querySelector('.loading-progress-container');
    if (progressContainer) progressContainer.style.display = '';
  }

  async renderTrainerCard(params) {
    const content = document.getElementById('content');
    const html = renderTrainerCard();
    content.innerHTML = html;
    attachTrainerCardListeners();

    // Hide loading screen if it's active
    document.getElementById('loading-screen')?.classList.remove('active');
  }

  async renderConduitCard(params) {
    const content = document.getElementById('content');
    // TODO: Create conduit-card page
    content.innerHTML = `
      <div class="error">
        <h2>Conduit Card</h2>
        <p>Coming soon!</p>
        <button data-route="index">Back to Home</button>
      </div>
    `;

    // Hide loading screen if it's active
    document.getElementById('loading-screen')?.classList.remove('active');
  }

  async renderTrainerInfo(params) {
    const content = document.getElementById('content');
    const html = renderTrainerInfo();
    content.innerHTML = html;
    attachTrainerInfoListeners();
  }

  async renderEditTrainer(params) {
    const content = document.getElementById('content');
    const html = renderEditTrainer();
    content.innerHTML = html;
    attachEditTrainerListeners();
  }

  async renderMyPokemon(params) {
    const content = document.getElementById('content');
    const html = renderMyPokemon();
    content.innerHTML = html;
    attachMyPokemonListeners();
  }

  async renderPokemonCard(params) {
    const content = document.getElementById('content');
    const pokemonName = params.pokemonName || '';
    const html = renderPokemonCard(pokemonName);
    content.innerHTML = html;
    attachPokemonCardListeners();

    // Hide loading screen if it's active
    document.getElementById('loading-screen')?.classList.remove('active');
  }

  async renderEditPokemon(params) {
    const content = document.getElementById('content');
    const pokemonName = params.pokemonName || '';
    const html = renderEditPokemon(pokemonName);
    content.innerHTML = html;
    attachEditPokemonListeners();
  }

  async renderNewJourney() {
    const content = document.getElementById('content');
    const html = renderNewJourney();
    content.innerHTML = html;
    attachNewJourneyListeners();
    audioManager.playBg('NewJourney');
  }

  async renderNewPokemon(params) {
    const content = document.getElementById('content');
    const html = renderNewPokemon();
    content.innerHTML = html;
    attachNewPokemonListeners();
    audioManager.playBg('FindPokemon');
  }

  async renderPokemonForm(params) {
    const content = document.getElementById('content');
    const html = renderPokemonForm();
    content.innerHTML = html;
    attachPokemonFormListeners();
    audioManager.playBg('FindPokemon');
  }

  async renderEvolution(params) {
    const content = document.getElementById('content');
    const html = renderEvolution();
    content.innerHTML = html;
    attachEvolutionListeners();
    audioManager.playEvolutionSequence();
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

    // Preload Index and ContinueJourney audio before showing the app,
    // then load the remaining tracks in the background
    await audioManager.preloadPriority();

    // Hide navigation bar (not needed - each page has its own back button)
    const nav = document.querySelector('.main-nav');
    if (nav) nav.style.display = 'none';

    // Initialize router (game data will be loaded on-demand by continue-journey page)
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
