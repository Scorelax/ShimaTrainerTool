// My Pokemon Page - Display trainer's Pokemon grid with pagination
import { PokemonAPI } from '../api.js';
import { showError, showSuccess } from '../utils/notifications.js';
import { getMoveTypeColor, getTextColorForBackground } from '../utils/pokemon-types.js';

// Module state
let currentPage = 1;
const pokemonsPerPage = 9;
let allPokemons = [];
let searchQuery = '';

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
          margin-bottom: clamp(0.25rem, 1vh, 0.5rem);
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
          margin-top: 0;
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

        .pokemon-search-wrapper {
          width: 90%;
          max-width: min(100vw, 1200px);
          margin-bottom: clamp(1rem, 2.5vh, 1.5rem);
        }

        .pokemon-search-input {
          width: 100%;
          box-sizing: border-box;
          padding: clamp(0.6rem, 1.3vh, 0.85rem) clamp(1rem, 2.5vw, 1.4rem);
          background: rgba(255,255,255,0.92);
          border: clamp(2px, 0.4vw, 3px) solid #FFDE00;
          border-radius: clamp(20px, 5vw, 40px);
          color: #333;
          font-size: clamp(0.9rem, 2vw, 1.1rem);
          font-weight: 600;
          outline: none;
          transition: border-color 0.2s, box-shadow 0.2s;
          box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        }

        .pokemon-search-input::placeholder {
          color: #888;
          font-weight: 400;
        }

        .pokemon-search-input:focus {
          border-color: #FFC700;
          box-shadow: 0 4px 16px rgba(0,0,0,0.3), 0 0 12px rgba(255,222,0,0.4);
        }

        .action-buttons-row {
          display: flex;
          gap: clamp(0.75rem, 2vw, 1.5rem);
          justify-content: center;
          flex-wrap: wrap;
        }

        .party-button {
          background: linear-gradient(135deg, #3B4CCA 0%, #2A3BAA 100%);
          color: white;
          border: clamp(2px, 0.4vw, 5px) solid #FFDE00;
          border-radius: clamp(30px, 8vw, 60px);
          padding: clamp(0.75rem, 1.5vh, 1.5rem) clamp(1.5rem, 5vw, 3.5rem);
          font-size: clamp(1rem, 2.5vw, 1.5rem);
          font-weight: 900;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 clamp(5px, 1.5vh, 12px) clamp(15px, 3.5vw, 25px) rgba(59,76,202,0.4),
                      inset 0 clamp(-2px, -0.5vh, -4px) 0 rgba(0,0,0,0.2);
          text-transform: uppercase;
          letter-spacing: clamp(0.5px, 0.15vw, 1.5px);
        }

        .party-button:hover {
          transform: translateY(clamp(-3px, -1vh, -7px)) scale(1.02);
          box-shadow: 0 clamp(8px, 2vh, 16px) clamp(22px, 5vw, 40px) rgba(59,76,202,0.5),
                      inset 0 clamp(-2px, -0.5vh, -4px) 0 rgba(0,0,0,0.2),
                      0 0 clamp(20px, 4vw, 35px) rgba(255,222,0,0.5);
          border-color: #FFC700;
        }

        .typings-button {
          background: linear-gradient(135deg, #7B2FBE 0%, #5E1FA0 100%);
          color: white;
          border: clamp(2px, 0.4vw, 5px) solid #FFDE00;
          border-radius: clamp(30px, 8vw, 60px);
          padding: clamp(0.75rem, 1.5vh, 1.5rem) clamp(1.5rem, 5vw, 3.5rem);
          font-size: clamp(1rem, 2.5vw, 1.5rem);
          font-weight: 900;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 clamp(5px, 1.5vh, 12px) clamp(15px, 3.5vw, 25px) rgba(123,47,190,0.4),
                      inset 0 clamp(-2px, -0.5vh, -4px) 0 rgba(0,0,0,0.2);
          text-transform: uppercase;
          letter-spacing: clamp(0.5px, 0.15vw, 1.5px);
        }

        .typings-button:hover {
          transform: translateY(clamp(-3px, -1vh, -7px)) scale(1.02);
          box-shadow: 0 clamp(8px, 2vh, 16px) clamp(22px, 5vw, 40px) rgba(123,47,190,0.5),
                      inset 0 clamp(-2px, -0.5vh, -4px) 0 rgba(0,0,0,0.2),
                      0 0 clamp(20px, 4vw, 35px) rgba(255,222,0,0.5);
          border-color: #FFC700;
        }

        /* Typings Modal */
        .typings-modal-overlay {
          display: none;
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.7);
          z-index: 2000;
          align-items: center;
          justify-content: center;
        }

        .typings-modal-overlay.open {
          display: flex;
        }

        .typings-modal-content {
          background: linear-gradient(135deg, #2c2c2c 0%, #252525 100%);
          border-radius: clamp(12px, 2vw, 18px);
          border: clamp(2px, 0.4vw, 3px) solid #444;
          width: min(92vw, 500px);
          max-height: 85vh;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          box-shadow: 0 20px 60px rgba(0,0,0,0.6);
        }

        .typings-modal-header {
          background: linear-gradient(135deg, #7B2FBE 0%, #5E1FA0 100%);
          padding: clamp(0.9rem, 2vh, 1.3rem) clamp(1.2rem, 3vw, 1.8rem);
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: clamp(2px, 0.4vw, 3px) solid #333;
        }

        .typings-modal-header h2 {
          margin: 0;
          color: white;
          font-size: clamp(1.2rem, 3vw, 1.6rem);
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 1px;
        }

        .typings-modal-body {
          overflow-y: auto;
          flex: 1;
          padding: clamp(0.75rem, 2vh, 1rem);
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: clamp(0.4rem, 1.2vw, 0.65rem);
          align-content: start;
        }

        .type-coverage-card {
          border-radius: 8px;
          padding: clamp(0.4rem, 1.2vh, 0.6rem) clamp(0.5rem, 1.5vw, 0.8rem);
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-weight: 700;
          box-shadow: 0 2px 6px rgba(0,0,0,0.35);
          transition: opacity 0.2s;
        }

        .type-coverage-card.type-zero {
          opacity: 0.35;
        }

        .type-coverage-name {
          font-size: clamp(0.8rem, 1.8vw, 0.95rem);
          text-shadow: 0 1px 3px rgba(0,0,0,0.4);
        }

        .type-coverage-count {
          font-size: clamp(0.85rem, 2vw, 1rem);
          font-weight: 900;
          background: rgba(0,0,0,0.25);
          border-radius: 12px;
          min-width: clamp(22px, 4.5vw, 28px);
          text-align: center;
          padding: 1px clamp(4px, 1vw, 7px);
          text-shadow: 0 1px 3px rgba(0,0,0,0.4);
        }

        /* Party Modal */
        .party-modal-overlay {
          display: none;
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.7);
          z-index: 2000;
          align-items: center;
          justify-content: center;
        }

        .party-modal-overlay.open {
          display: flex;
        }

        .party-modal-content {
          background: linear-gradient(135deg, #2c2c2c 0%, #252525 100%);
          border-radius: clamp(12px, 2vw, 18px);
          border: clamp(2px, 0.4vw, 3px) solid #444;
          width: min(92vw, 480px);
          max-height: 85vh;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          box-shadow: 0 20px 60px rgba(0,0,0,0.6);
        }

        .party-modal-header {
          background: linear-gradient(135deg, #EE1515 0%, #C91010 100%);
          padding: clamp(0.9rem, 2vh, 1.3rem) clamp(1.2rem, 3vw, 1.8rem);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
          border-bottom: clamp(2px, 0.4vw, 3px) solid #333;
        }

        .party-modal-header h2 {
          margin: 0;
          color: white;
          font-size: clamp(1.2rem, 3vw, 1.6rem);
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 1px;
        }

        .party-count-badge {
          background: rgba(0,0,0,0.3);
          color: white;
          font-size: clamp(0.85rem, 2vw, 1rem);
          font-weight: 700;
          padding: 0.3rem 0.8rem;
          border-radius: 20px;
          border: 1px solid rgba(255,255,255,0.3);
          white-space: nowrap;
        }

        .party-modal-close {
          background: none;
          border: none;
          color: white;
          font-size: clamp(1.6rem, 3.5vw, 2rem);
          cursor: pointer;
          line-height: 1;
          padding: 0;
          opacity: 0.8;
          transition: opacity 0.2s;
        }

        .party-modal-close:hover {
          opacity: 1;
        }

        .party-modal-list {
          overflow-y: auto;
          flex: 1;
          padding: 0 0 clamp(0.5rem, 1.5vh, 1rem) 0;
        }

        .party-pokemon-row {
          display: flex;
          align-items: center;
          gap: clamp(0.8rem, 2vw, 1.2rem);
          padding: clamp(0.6rem, 1.5vh, 0.9rem) clamp(1.2rem, 3vw, 1.8rem);
          border-bottom: 1px solid #383838;
          transition: background 0.15s;
        }

        .party-pokemon-row:last-child {
          border-bottom: none;
        }

        .party-pokemon-row:hover {
          background: rgba(255,255,255,0.04);
        }

        .party-pokemon-avatar {
          width: clamp(42px, 9vw, 56px);
          height: clamp(42px, 9vw, 56px);
          border-radius: 8px;
          object-fit: cover;
          border: 2px solid #FFDE00;
          background: #fff;
          flex-shrink: 0;
        }

        .party-pokemon-info {
          flex: 1;
          min-width: 0;
        }

        .party-pokemon-label {
          font-weight: 700;
          color: #FFDE00;
          font-size: clamp(0.9rem, 2vw, 1.05rem);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .party-pokemon-sublabel {
          color: #aaa;
          font-size: clamp(0.75rem, 1.6vw, 0.88rem);
          margin-top: 2px;
        }

        .party-col-header {
          display: flex;
          align-items: center;
          padding: 0.35rem clamp(1.2rem, 3vw, 1.8rem);
          background: #1e1e1e;
          border-bottom: 1px solid #555;
          font-size: 0.75rem;
          font-weight: 700;
          color: #999;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          position: sticky;
          top: 0;
          z-index: 1;
        }

        .party-col-header-spacer { flex: 1; }

        .party-col-header-label {
          width: clamp(50px, 10vw, 62px);
          text-align: center;
        }

        .party-slot-checks {
          display: flex;
          gap: clamp(0.3rem, 1vw, 0.6rem);
          align-items: center;
          flex-shrink: 0;
        }

        .slot-check-label {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 3px;
          width: clamp(50px, 10vw, 62px);
          cursor: pointer;
        }

        .slot-check-label span {
          font-size: clamp(0.62rem, 1.3vw, 0.72rem);
          color: #aaa;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.3px;
          user-select: none;
        }

        .slot-check-label input[type="checkbox"] {
          width: clamp(18px, 3.5vw, 22px);
          height: clamp(18px, 3.5vw, 22px);
          accent-color: #EE1515;
          cursor: pointer;
          margin: 0;
        }

        .slot-check-label input:disabled {
          opacity: 0.35;
          cursor: not-allowed;
        }

        @media (max-width: 480px) {
          .pokemon-grid {
            grid-template-columns: 1fr;
          }
        }
      </style>

      <h1>My Pokemon</h1>
      <div class="pokemon-search-wrapper">
        <input type="text" id="pokemonSearch" class="pokemon-search-input" placeholder="Search by name or nickname..." autocomplete="off">
      </div>
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
        <div class="action-buttons-row">
          <button class="typings-button" id="typingsBtn">Typings</button>
          <button class="register-button" id="registerNewBtn">New Pokemon</button>
          <button class="party-button" id="partyBtn">Party</button>
        </div>
      </div>

      <!-- Party Modal -->
      <div class="party-modal-overlay" id="partyModal">
        <div class="party-modal-content">
          <div class="party-modal-header">
            <h2>Manage Party</h2>
            <span class="party-count-badge" id="partyCountBadge">Party: 0/6</span>
            <button class="party-modal-close" id="closePartyModal">×</button>
          </div>
          <div class="party-modal-list" id="partyModalList"></div>
        </div>
      </div>

      <!-- Typings Modal -->
      <div class="typings-modal-overlay" id="typingsModal">
        <div class="typings-modal-content">
          <div class="typings-modal-header">
            <h2>Type Coverage</h2>
            <button class="party-modal-close" id="closeTypingsModal">×</button>
          </div>
          <div class="typings-modal-body" id="typingsModalList"></div>
        </div>
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
  searchQuery = '';

  // Load Pokemon from session storage
  loadPokemonList();

  // Search input
  document.getElementById('pokemonSearch')?.addEventListener('input', e => {
    searchQuery = e.target.value;
    currentPage = 1;
    renderPokemonList();
  });

  // Navigation buttons
  document.getElementById('prevBtn')?.addEventListener('click', prevPage);
  document.getElementById('nextBtn')?.addEventListener('click', nextPage);

  // Register new Pokemon button
  document.getElementById('registerNewBtn')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('navigate', {
      detail: { route: 'new-pokemon' }
    }));
  });

  // Typings button
  document.getElementById('typingsBtn')?.addEventListener('click', openTypingsModal);
  document.getElementById('closeTypingsModal')?.addEventListener('click', () => {
    document.getElementById('typingsModal').classList.remove('open');
  });

  // Party button
  document.getElementById('partyBtn')?.addEventListener('click', openPartyModal);
  document.getElementById('closePartyModal')?.addEventListener('click', () => {
    document.getElementById('partyModal').classList.remove('open');
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

function getFilteredPokemons() {
  if (!searchQuery) return allPokemons;
  const q = searchQuery.toLowerCase();
  return allPokemons.filter(p =>
    p.name.toLowerCase().includes(q) || (p.nickname && p.nickname.toLowerCase().includes(q))
  );
}

function renderPokemonList() {
  const pokemonGrid = document.getElementById('pokemonGrid');
  if (!pokemonGrid) return;

  pokemonGrid.innerHTML = '';

  const displayPokemons = getFilteredPokemons();

  if (allPokemons.length === 0) {
    pokemonGrid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        No Pokemon found. Register your first Pokemon!
      </div>
    `;
    updatePageIndicator();
    return;
  }

  if (displayPokemons.length === 0) {
    pokemonGrid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        No Pokemon match your search.
      </div>
    `;
    updatePageIndicator();
    return;
  }

  const startIndex = (currentPage - 1) * pokemonsPerPage;
  const endIndex = startIndex + pokemonsPerPage;
  const currentPokemons = displayPokemons.slice(startIndex, endIndex);

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
  const totalPages = Math.max(1, Math.ceil(getFilteredPokemons().length / pokemonsPerPage));
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
  const totalPages = Math.ceil(getFilteredPokemons().length / pokemonsPerPage);
  if (currentPage < totalPages) {
    currentPage++;
    renderPokemonList();
  }
}

// ── Typings Modal ────────────────────────────────────────────────────────────

const ALL_TYPES = ['Normal','Fighting','Flying','Poison','Ground','Rock','Bug','Ghost','Steel','Fire','Water','Grass','Electric','Psychic','Ice','Dragon','Dark','Fairy','Cosmic'];

function openTypingsModal() {
  const modal = document.getElementById('typingsModal');
  const list = document.getElementById('typingsModalList');
  if (!modal || !list) return;

  // Count each type from all Pokemon in sessionStorage
  const typeCounts = {};
  ALL_TYPES.forEach(t => { typeCounts[t] = 0; });

  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    if (!key.startsWith('pokemon_')) continue;
    try {
      const data = JSON.parse(sessionStorage.getItem(key));
      const t1 = data[5] || '';
      const t2 = data[6] || '';
      if (t1 && typeCounts.hasOwnProperty(t1)) typeCounts[t1]++;
      if (t2 && typeCounts.hasOwnProperty(t2)) typeCounts[t2]++;
    } catch (e) {}
  }

  // Sort: highest count first, then alphabetical; zeros at the bottom
  const sorted = ALL_TYPES.slice().sort((a, b) => {
    if (typeCounts[b] !== typeCounts[a]) return typeCounts[b] - typeCounts[a];
    return a.localeCompare(b);
  });

  list.innerHTML = sorted.map(type => {
    const count = typeCounts[type];
    const bg = getMoveTypeColor(type);
    const textColor = getTextColorForBackground(bg);
    return `
      <div class="type-coverage-card ${count === 0 ? 'type-zero' : ''}" style="background:${bg}; color:${textColor};">
        <span class="type-coverage-name">${type}</span>
        <span class="type-coverage-count">${count}</span>
      </div>`;
  }).join('');

  modal.classList.add('open');
}

// ── Party Modal ──────────────────────────────────────────────────────────────

function getNumPokeSlots(trainerLevel) {
  if (trainerLevel >= 16) return 6;
  if (trainerLevel >= 10) return 5;
  if (trainerLevel >= 5)  return 4;
  return 3;
}

function openPartyModal() {
  const modal = document.getElementById('partyModal');
  if (!modal) return;

  const pokemonFullData = [];
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    if (key.startsWith('pokemon_')) {
      try { pokemonFullData.push(JSON.parse(sessionStorage.getItem(key))); } catch (e) {}
    }
  }
  pokemonFullData.sort((a, b) => (a[3] || 0) - (b[3] || 0));

  renderPartyModalList(pokemonFullData);
  modal.classList.add('open');
}

function renderPartyModalList(pokemonFullData) {
  const list = document.getElementById('partyModalList');
  if (!list) return;

  const trainerData = JSON.parse(sessionStorage.getItem('trainerData') || '[]');
  const trainerLevel = parseInt(trainerData[2]) || 1;
  const numPokeSlots = getNumPokeSlots(trainerLevel);
  // trainerData[26] is the pokeslots count field; party membership is per-pokemon in pokemonData[38]
  const partyCount = pokemonFullData.filter(d => d[38]).length;
  const partyFull = partyCount >= numPokeSlots;

  const badge = document.getElementById('partyCountBadge');
  if (badge) badge.textContent = `Party: ${partyCount}/${numPokeSlots}`;

  if (pokemonFullData.length === 0) {
    list.innerHTML = '<div style="padding:2rem;text-align:center;color:#888;">No Pokemon registered.</div>';
    return;
  }

  const colHeader = `
    <div class="party-col-header">
      <span class="party-col-header-spacer"></span>
      <span class="party-col-header-label">Party</span>
      <span class="party-col-header-label">Utility</span>
    </div>`;

  const rows = pokemonFullData.map(data => {
    const name = data[2] || '';
    const nickname = data[36] || '';
    const image = data[1] || 'assets/Pokeball.png';
    const inParty = !!(data[38]);
    const inUtility = data[56] === 1 || data[56] === '1';
    const displayName = nickname || name;
    const subLabel = nickname ? name : `Lv. ${data[4] || '?'}`;
    const partyDisabled = partyFull && !inParty;
    const utilityOccupied = pokemonFullData.some(d => d[56] === 1 || d[56] === '1');
    const utilityDisabled = inParty || (utilityOccupied && !inUtility);

    return `
      <div class="party-pokemon-row">
        <img class="party-pokemon-avatar" src="${image}" alt="${name}" onerror="this.src='assets/Pokeball.png'">
        <div class="party-pokemon-info">
          <div class="party-pokemon-label">${displayName}</div>
          <div class="party-pokemon-sublabel">${subLabel}</div>
        </div>
        <div class="party-slot-checks">
          <label class="slot-check-label">
            <span>Party</span>
            <input type="checkbox" data-pokemon-name="${name}" data-slot-type="party"
              ${inParty ? 'checked' : ''} ${partyDisabled ? 'disabled' : ''}>
          </label>
          <label class="slot-check-label">
            <span>Utility</span>
            <input type="checkbox" data-pokemon-name="${name}" data-slot-type="utility"
              ${inUtility ? 'checked' : ''} ${utilityDisabled ? 'disabled' : ''}>
          </label>
        </div>
      </div>`;
  }).join('');

  list.innerHTML = colHeader + rows;

  list.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', e => handleSlotToggle(e, pokemonFullData, numPokeSlots));
  });
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function _updatePartyBadge(pokemonFullData, numPokeSlots) {
  const badge = document.getElementById('partyCountBadge');
  if (!badge) return;
  badge.textContent = `Party: ${pokemonFullData.filter(d => d[38]).length}/${numPokeSlots}`;
}

function _refreshPartyDisabled(pokemonFullData, numPokeSlots) {
  const partyFull = pokemonFullData.filter(d => d[38]).length >= numPokeSlots;
  document.querySelectorAll('input[data-slot-type="party"]').forEach(cb => {
    const entry = pokemonFullData.find(d => d[2] === cb.dataset.pokemonName);
    cb.disabled = partyFull && !(entry && entry[38]);
  });
}

function _refreshUtilityDisabled(pokemonFullData) {
  const utilityOccupied = pokemonFullData.some(d => d[56] === 1 || d[56] === '1');
  document.querySelectorAll('input[data-slot-type="utility"]').forEach(cb => {
    const entry = pokemonFullData.find(d => d[2] === cb.dataset.pokemonName);
    const hasUtility = entry && (entry[56] === 1 || entry[56] === '1');
    const inParty = entry && !!entry[38];
    cb.disabled = inParty || (utilityOccupied && !hasUtility);
  });
}

// ── Toggle dispatcher ────────────────────────────────────────────────────────

async function handleSlotToggle(e, pokemonFullData, numPokeSlots) {
  const checkbox = e.target;
  const isChecked = checkbox.checked;
  const pokemonName = checkbox.dataset.pokemonName;
  const slotType = checkbox.dataset.slotType;

  const trainerData = JSON.parse(sessionStorage.getItem('trainerData') || '[]');
  const pokemonKey = `pokemon_${pokemonName.toLowerCase()}`;
  const pokemonData = JSON.parse(sessionStorage.getItem(pokemonKey) || '[]');

  if (!trainerData.length || !pokemonData.length) {
    checkbox.checked = !isChecked;
    showError('Could not load trainer or Pokemon data.');
    return;
  }

  if (slotType === 'party') {
    await _togglePartySlot(checkbox, isChecked, pokemonName, pokemonKey, pokemonData, trainerData, pokemonFullData, numPokeSlots);
  } else {
    await _toggleUtilitySlot(checkbox, isChecked, pokemonName, pokemonKey, pokemonData, trainerData, pokemonFullData, numPokeSlots);
  }
}

// ── Party slot toggle ────────────────────────────────────────────────────────

async function _togglePartySlot(checkbox, isChecked, pokemonName, pokemonKey, pokemonData, trainerData, pokemonFullData, numPokeSlots) {
  if (isChecked) {
    // Block if already in utility slot
    if (pokemonData[56] === 1 || pokemonData[56] === '1') {
      checkbox.checked = false;
      showError('Remove from utility slot first.');
      return;
    }
    // Block if party is at cap — count from pokemon data, not trainerData
    if (pokemonFullData.filter(d => d[38]).length >= numPokeSlots) {
      checkbox.checked = false;
      showError(`Party is full! (${numPokeSlots}/${numPokeSlots})`);
      return;
    }
  }

  const originalSlot = pokemonData[38];
  // Only update pokemonData[38] — party slot names live in pokemon data, not trainerData
  pokemonData[38] = isChecked ? '1' : ''; // server will correct the slot number on success
  sessionStorage.setItem(pokemonKey, JSON.stringify(pokemonData));

  const entry = pokemonFullData.find(d => d[2] === pokemonName);
  if (entry) entry[38] = pokemonData[38];

  _updatePartyBadge(pokemonFullData, numPokeSlots);
  _refreshPartyDisabled(pokemonFullData, numPokeSlots);
  _refreshUtilityDisabled(pokemonFullData);

  try {
    // trainerData[26] is the pokeslots count — passed to API as capacity info
    const response = await PokemonAPI.updatePartyStatus(
      trainerData[1], pokemonData[2], trainerData[26], isChecked ? 'add' : 'remove'
    );

    if (response.status === 'success') {
      if (isChecked && response.slot) {
        pokemonData[38] = response.slot;
        if (entry) entry[38] = response.slot;
        sessionStorage.setItem(pokemonKey, JSON.stringify(pokemonData));
        _updatePartyBadge(pokemonFullData, numPokeSlots);
        _refreshPartyDisabled(pokemonFullData, numPokeSlots);
        _refreshUtilityDisabled(pokemonFullData);
      }
    } else {
      pokemonData[38] = originalSlot;
      if (entry) entry[38] = originalSlot;
      sessionStorage.setItem(pokemonKey, JSON.stringify(pokemonData));
      checkbox.checked = !isChecked;
      _updatePartyBadge(pokemonFullData, numPokeSlots);
      _refreshPartyDisabled(pokemonFullData, numPokeSlots);
      _refreshUtilityDisabled(pokemonFullData);
      showError(response.message || 'Failed to update party status.');
    }
  } catch (err) {
    pokemonData[38] = originalSlot;
    if (entry) entry[38] = originalSlot;
    sessionStorage.setItem(pokemonKey, JSON.stringify(pokemonData));
    checkbox.checked = !isChecked;
    _updatePartyBadge(pokemonFullData, numPokeSlots);
    _refreshPartyDisabled(pokemonFullData, numPokeSlots);
    _refreshUtilityDisabled(pokemonFullData);
    showError('Failed to update party status.');
  }
}

// ── Utility slot toggle ──────────────────────────────────────────────────────

async function _toggleUtilitySlot(checkbox, isChecked, pokemonName, pokemonKey, pokemonData, trainerData, pokemonFullData, numPokeSlots) {
  if (isChecked) {
    // Block if already in active party
    if (pokemonData[38]) {
      checkbox.checked = false;
      showError('Remove from active party first.');
      return;
    }
  }

  const originalUtility = pokemonData[56];
  const clearedEntries = []; // for rollback

  pokemonData[56] = isChecked ? 1 : '';
  sessionStorage.setItem(pokemonKey, JSON.stringify(pokemonData));

  // Auto-clear any other Pokemon currently in utility slot
  if (isChecked) {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key.startsWith('pokemon_') && key !== pokemonKey) {
        const other = JSON.parse(sessionStorage.getItem(key));
        if (other[56] === 1 || other[56] === '1') {
          clearedEntries.push({ key, originalValue: other[56], name: other[2] });
          other[56] = '';
          sessionStorage.setItem(key, JSON.stringify(other));
          const otherEntry = pokemonFullData.find(d => d[2] === other[2]);
          if (otherEntry) otherEntry[56] = '';
          const otherCb = document.querySelector(`input[data-slot-type="utility"][data-pokemon-name="${other[2]}"]`);
          if (otherCb) otherCb.checked = false;
        }
      }
    }
  }

  sessionStorage.setItem('trainerData', JSON.stringify(trainerData));
  const entry = pokemonFullData.find(d => d[2] === pokemonName);
  if (entry) entry[56] = pokemonData[56];
  _refreshUtilityDisabled(pokemonFullData);

  const rollback = () => {
    pokemonData[56] = originalUtility;
    sessionStorage.setItem(pokemonKey, JSON.stringify(pokemonData));
    clearedEntries.forEach(({ key, originalValue, name }) => {
      const other = JSON.parse(sessionStorage.getItem(key));
      other[56] = originalValue;
      sessionStorage.setItem(key, JSON.stringify(other));
      const otherEntry = pokemonFullData.find(d => d[2] === name);
      if (otherEntry) otherEntry[56] = originalValue;
      const otherCb = document.querySelector(`input[data-slot-type="utility"][data-pokemon-name="${name}"]`);
      if (otherCb) otherCb.checked = !!originalValue;
    });
    if (entry) entry[56] = originalUtility;
    sessionStorage.setItem('trainerData', JSON.stringify(trainerData));
    checkbox.checked = !isChecked;
    _refreshUtilityDisabled(pokemonFullData);
  };

  try {
    const response = await PokemonAPI.updateUtilitySlot(trainerData[1], pokemonData[2], isChecked ? 'add' : 'remove');
    if (response.status !== 'success') {
      rollback();
      showError(response.message || 'Failed to update utility slot.');
    }
  } catch (err) {
    rollback();
    showError('Failed to update utility slot.');
  }
}
