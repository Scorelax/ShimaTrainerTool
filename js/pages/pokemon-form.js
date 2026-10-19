// Pokemon Form Page - Register new Pokemon for trainer

import { PokemonAPI } from '../api.js';
import { showSuccess, showError } from '../utils/notifications.js';
import { audioManager } from '../utils/audio.js';
import { isFieldVisible, initializeVisibility } from '../utils/visibility.js';
import { hideLoading, showLoadingWithSprite } from '../utils/splash.js';
import { prefetchSprite } from '../utils/sprite-media.js';
import { abilityInSlot } from '../utils/species.js';
import { storePokemon } from '../utils/owned-pokemon.js';
import { loadTrainer } from '../utils/trainer-data.js';

export function renderPokemonForm() {
  // Load selected Pokemon data from session storage
  const selectedSpecies = JSON.parse(sessionStorage.getItem('selectedSpecies'));
  const natures = JSON.parse(sessionStorage.getItem('natures') || '[]');
  const items = JSON.parse(sessionStorage.getItem('items') || '[]');

  if (!selectedSpecies) {
    return '<div class="error">No Pokemon selected. Please go back and select a Pokemon.</div>';
  }

  const pokemonName = selectedSpecies.name || 'Unknown';

  const html = `
    <div class="pokemon-form-page">
      <style>
        body, .content {
          background:
            radial-gradient(circle at 20% 80%, rgba(255, 222, 0, 0.15) 0%, transparent 50%),
            radial-gradient(circle at 80% 20%, rgba(59, 76, 202, 0.15) 0%, transparent 50%),
            radial-gradient(circle at 40% 40%, rgba(238, 21, 21, 0.3) 0%, transparent 40%),
            linear-gradient(to bottom, #c41111 0%, #970909 50%, #6e0404 100%);
          min-height: 100vh;
          position: relative;
          overflow-x: hidden;
        }

        .pokemon-form-page::before {
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

        .pokemon-form-page {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 2vh 1vw;
          min-height: 80vh;
          position: relative;
        }

        .pokemon-form-page > * {
          position: relative;
          z-index: 1;
        }

        .pokemon-form-page h1 {
          color: white;
          margin-bottom: 2vh;
          font-size: clamp(1.3rem, 3.5vw, 2.5rem);
          text-transform: uppercase;
          letter-spacing: clamp(0.3px, 0.3vw, 1.5px);
          text-shadow: 0 clamp(2px, 0.5vh, 4px) clamp(5px, 1.5vh, 10px) rgba(0,0,0,0.8);
          font-weight: 900;
          padding: 0 clamp(0.5rem, 1vw, 1rem);
          white-space: nowrap;
        }

        .form-container {
          width: 100%;
          max-width: clamp(400px, 60vw, 600px);
          background: linear-gradient(135deg, #FFFFFF 0%, #F8F8F8 100%);
          padding: clamp(1.5rem, 3vw, 2.5rem);
          border-radius: clamp(15px, 3vw, 25px);
          border: 2px solid var(--border-accent);
          box-shadow: 0 clamp(10px, 2vh, 15px) clamp(25px, 5vh, 40px) rgba(0,0,0,0.4),
                      inset 0 clamp(-2px, -0.5vh, -4px) 0 rgba(0,0,0,0.05);
          margin-bottom: 2vh;
          max-height: 70vh;
          overflow-y: auto;
        }

        .form-group {
          margin-bottom: clamp(1rem, 2vh, 1.5rem);
        }

        .form-group label {
          display: block;
          font-weight: bold;
          font-size: clamp(1rem, 2vw, 1.2rem);
          margin-bottom: clamp(0.3rem, 1vh, 0.5rem);
          color: #333;
        }

        .form-group input[type="number"],
        .form-group input[type="text"],
        .form-group select {
          width: 100%;
          padding: clamp(0.5rem, 1.5vh, 0.75rem);
          font-size: clamp(0.9rem, 1.8vw, 1.1rem);
          border: clamp(1px, 0.3vw, 2px) solid #ccc;
          border-radius: clamp(3px, 0.8vw, 5px);
          box-sizing: border-box;
        }

        .form-group input:focus,
        .form-group select:focus {
          border-color: #f44336;
          outline: none;
        }

        .abilities-container {
          padding: clamp(0.75rem, 1.5vh, 1rem);
          border: 2px solid var(--border-accent);
          border-radius: clamp(10px, 2vw, 15px);
          max-height: clamp(250px, 40vh, 350px);
          overflow-y: auto;
          background: linear-gradient(135deg, #FFFFFF 0%, #F8F8F8 100%);
        }

        .checkbox-item {
          display: flex;
          align-items: flex-start;
          margin-bottom: clamp(0.75rem, 1.5vh, 1rem);
        }

        .checkbox-item input[type="checkbox"] {
          margin-right: clamp(0.5rem, 1vw, 0.75rem);
          margin-top: clamp(0.15rem, 0.4vh, 0.25rem);
          transform: scale(clamp(1.2, 0.3vw, 1.5));
          cursor: pointer;
        }

        .checkbox-item label {
          font-size: clamp(0.95rem, 1.8vw, 1.1rem);
          cursor: pointer;
          margin: 0;
        }

        .ability-description {
          font-size: clamp(0.8rem, 1.5vw, 0.9rem);
          color: #666;
          font-weight: normal;
          margin-top: clamp(0.2rem, 0.5vh, 0.3rem);
          line-height: 1.3;
          display: block;
        }

        .button-group {
          display: flex;
          gap: clamp(0.75rem, 2vw, 1rem);
          justify-content: center;
          margin-top: clamp(1.5rem, 3vh, 2rem);
        }

        .button {
          padding: clamp(0.75rem, 1.5vh, 1rem) clamp(1.5rem, 3vw, 2rem);
          border: none;
          border-radius: clamp(3px, 0.8vw, 5px);
          font-size: clamp(1rem, 2vw, 1.2rem);
          font-weight: bold;
          cursor: pointer;
          transition: all 0.3s;
        }

        .button-primary {
          background: linear-gradient(135deg, #4CAF50 0%, #45A049 100%);
          color: white;
          border: 2px solid var(--border-accent);
          border-radius: clamp(10px, 2vw, 15px);
          font-size: clamp(1rem, 2vw, 1.2rem);
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: clamp(0.5px, 0.2vw, 1px);
          box-shadow: 0 clamp(5px, 1vh, 8px) clamp(12px, 2.5vh, 20px) rgba(0,0,0,0.3);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .button-primary:hover {
          transform: translateY(clamp(-1px, -0.3vh, -2px));
          box-shadow: 0 clamp(8px, 1.5vh, 12px) clamp(20px, 3.5vh, 30px) rgba(0,0,0,0.4),
                      0 0 clamp(15px, 2.5vh, 20px) rgba(76,175,80,0.5);
        }

        .button-secondary {
          background: linear-gradient(135deg, #EE1515 0%, #C91010 100%);
          color: white;
          border: clamp(2px, 0.4vw, 3px) solid #333;
          border-radius: clamp(10px, 2vw, 15px);
          font-size: clamp(1rem, 2vw, 1.2rem);
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: clamp(0.5px, 0.2vw, 1px);
          box-shadow: 0 clamp(5px, 1vh, 8px) clamp(12px, 2.5vh, 20px) rgba(0,0,0,0.3);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .button-secondary:hover {
          transform: translateY(clamp(-1px, -0.3vh, -2px));
          box-shadow: 0 clamp(8px, 1.5vh, 12px) clamp(20px, 3.5vh, 30px) rgba(0,0,0,0.4),
                      0 0 clamp(15px, 2.5vh, 20px) rgba(238,21,21,0.5);
        }

        @media (max-width: 1024px) {
          .form-container {
            max-width: clamp(400px, 65vw, 600px);
          }
        }

        @media (max-width: 768px) {
          .form-container {
            max-width: clamp(400px, 70vw, 600px);
          }

          .button-group {
            gap: clamp(0.65rem, 1.8vw, 0.9rem);
          }
        }

        @media (max-width: 600px) {
          .form-container {
            max-width: clamp(350px, 75vw, 550px);
          }

          .button-group {
            gap: clamp(0.6rem, 1.5vw, 0.8rem);
          }
        }

        @media (max-width: 480px) {
          .form-container {
            max-width: 85vw;
            padding: clamp(1.2rem, 2.5vw, 2rem);
          }

          .button-group {
            flex-direction: column;
            gap: clamp(0.75rem, 1.5vh, 1rem);
          }

          .button {
            width: 100%;
          }
        }

        @media (max-width: 360px) {
          .form-container {
            max-width: 90vw;
            padding: clamp(1rem, 2vw, 1.5rem);
          }
        }

        .back-button {
          position: fixed;
          top: clamp(15px, 3vh, 20px);
          left: clamp(15px, 3vw, 20px);
          background: var(--surface-glass);
          color: var(--text);
          border: 1px solid var(--border-subtle);
          border-radius: 50%;
          width: clamp(45px, 10vw, 60px);
          height: clamp(45px, 10vw, 60px);
          font-size: clamp(1.2rem, 3vw, 1.8rem);
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 6px 20px rgba(0,0,0,0.3);
          z-index: 1000;
          display: flex;
          align-items: center;
          justify-content: center;
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
      </style>

      <!-- Back Button -->
      <button class="back-button" id="backButton">←</button>

      <h1>Register ${pokemonName}</h1>

      <div class="form-container">
        <form id="pokemonForm">
          <div class="form-group">
            <label for="level">Level</label>
            <input type="number" id="level" name="level" value="1" min="1" max="100" required />
          </div>

          <div class="form-group">
            <label for="nature">Nature</label>
            <select id="nature" name="nature" required>
              ${natures.map(n => `
                <option value="${n.name}">${n.name}</option>
              `).join('')}
            </select>
          </div>

          <div class="form-group">
            <label for="loyalty">Loyalty</label>
            <input type="number" id="loyalty" name="loyalty" value="0" min="-10" max="10" required />
          </div>

          <!-- Abilities Section -->
          <div class="form-group">
            <label>Abilities</label>
            <div class="abilities-container" id="abilitiesContent">
              <!-- Abilities will be populated dynamically -->
            </div>
          </div>

          <div class="form-group">
            <label for="heldItem">Held Item</label>
            <input type="text" id="heldItem" name="heldItem" list="heldItemList" autocomplete="off" />
            <datalist id="heldItemList">
              ${items.map(item => `
                <option value="${item.name}">
              `).join('')}
            </datalist>
          </div>

          <div class="form-group">
            <label for="nickname">Nickname</label>
            <input type="text" id="nickname" name="nickname" />
          </div>

          <div class="checkbox-item">
            <input type="checkbox" id="shiny" name="shiny" />
            <label for="shiny">Shiny</label>
          </div>

          <!-- Buttons -->
          <div class="button-group">
            <button type="submit" class="button button-primary">Register Pokémon</button>
            <button type="button" class="button button-secondary" id="cancelButton">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `;

  return html;
}

export async function attachPokemonFormListeners() {
  const selectedSpecies = JSON.parse(sessionStorage.getItem('selectedSpecies'));

  // Initialize visibility system
  await initializeVisibility();

  // Populate abilities from cache or API (like edit-pokemon does)
  await populateAbilityOptions(selectedSpecies);

  // Warm the cache for this Pokemon's sprite (and shiny variant, since the
  // player can toggle the checkbox any time before submitting) while they
  // fill out the rest of the form, so it's ready to display instantly the
  // moment they click Register instead of a generic splash screen.
  const preloadBaseUrl = selectedSpecies.image || '';
  if (preloadBaseUrl && preloadBaseUrl !== 'assets/Pokeball.png') {
    prefetchSprite(preloadBaseUrl);
    prefetchSprite(preloadBaseUrl.replace(/(\.[a-zA-Z]+)$/, '-shiny$1'));
  }

  // Back button
  document.getElementById('backButton')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('navigate', {
      detail: { route: 'my-pokemon' }
    }));
  });

  // Cancel button
  document.getElementById('cancelButton')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('navigate', {
      detail: { route: 'my-pokemon' }
    }));
  });

  // Form submission
  document.getElementById('pokemonForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Show this Pokemon's own sprite (video/image, shiny-aware) in place of
    // generic splash art -- already warmed above, so this is instant.
    const baseImageUrl = selectedSpecies.image || '';
    const shinyChecked = document.getElementById('shiny')?.checked;
    const revealUrl = shinyChecked && baseImageUrl && baseImageUrl !== 'assets/Pokeball.png'
      ? baseImageUrl.replace(/(\.[a-zA-Z]+)$/, '-shiny$1')
      : baseImageUrl;
    const trainerData = loadTrainer();
    const captionText = trainerData.name ? `${trainerData.name} caught a ${selectedSpecies.name}!` : '';
    showLoadingWithSprite(revealUrl, selectedSpecies.name, captionText);

    await handleFormSubmit();
  });
}

async function populateAbilityOptions(selectedSpecies) {
  const abilitiesContent = document.getElementById('abilitiesContent');
  if (!abilitiesContent) return;

  const pokemonName = selectedSpecies.name || 'Unknown';
  abilitiesContent.innerHTML = '';

  // The species' abilities, slot 0 / 1 / 2 (primary, secondary, hidden)
  const abilities = [0, 1, 2].map(slot => abilityInSlot(selectedSpecies, slot));

  console.log('[Pokemon Form] Abilities:', abilities);

  // Create checkbox for each ability
  abilities.forEach((ability, slotIndex) => {
    if (!ability) return; // Skip empty abilities

    // Check if hidden ability should be visible
    if (slotIndex === 2 && !isFieldVisible(pokemonName, 'hiddenAbility')) {
      return;
    }

    const abilityName = ability.name;

    console.log(`[Pokemon Form] Creating checkbox for ability ${slotIndex}: "${abilityName}"`);

    // Create checkbox - value is just the name
    const div = document.createElement('div');
    div.className = 'checkbox-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `ability${slotIndex}`;
    checkbox.name = 'abilities';
    checkbox.value = abilityName; // Just the name
    checkbox.dataset.slotIndex = slotIndex; // Store slot index for later
    if (slotIndex === 0) checkbox.checked = true; // Default: primary ability pre-selected

    const label = document.createElement('label');
    label.htmlFor = `ability${slotIndex}`;
    label.textContent = abilityName;

    div.appendChild(checkbox);
    div.appendChild(label);
    abilitiesContent.appendChild(div);
  });

  // Debug: Check if checkboxes exist in DOM
  setTimeout(() => {
    const allCheckboxes = document.querySelectorAll('input[name="abilities"]');
    console.log('[Pokemon Form] Total ability checkboxes in DOM:', allCheckboxes.length);
    allCheckboxes.forEach(cb => {
      console.log(`  - Checkbox id="${cb.id}" value="${cb.value}" checked=${cb.checked}`);
    });
  }, 100);
}

async function handleFormSubmit() {
  const form = document.getElementById('pokemonForm');
  const trainerData = loadTrainer();
  const selectedSpecies = JSON.parse(sessionStorage.getItem('selectedSpecies'));

  if (!trainerData.name || !selectedSpecies) {
    showError('Missing trainer or Pokemon data');
    return;
  }

  try {
    // CRITICAL: Gather ALL form data BEFORE showing loading message
    // (loading message wipes out the entire form!)

    // Gather basic form data
    const level = parseInt(form.level.value);
    const nature = form.nature.value;
    const loyalty = parseInt(form.loyalty.value);
    const heldItem = form.heldItem.value;
    const nickname = form.nickname.value;
    const shiny = form.shiny.checked;

    // The ability slots ticked (0, 1 or 2)
    const abilities = Array.from(document.querySelectorAll('input[name="abilities"]:checked'))
      .map(cb => Number(cb.dataset.slotIndex));

    // NOW show loading (after we've captured all the data)
    document.getElementById('content').innerHTML = '<div class="loading">Registering Pokemon...</div>';

    // What the player chose -- the server builds the Pokemon from its species (routes_pokemon.build_registered_pokemon:
    // the nature, an Ace Trainer's Max Potential, a Commander's loyalty and every number that follows).
    const choice = { species: selectedSpecies.name, level, nature, loyalty, abilities, heldItem, nickname, shiny };

    // Register the Pokemon (loading screen already shown)
    const response = await PokemonAPI.register(trainerData.name, choice);

    console.log('[Pokemon Form] Backend response:', response);

    if (response.status === 'success') {
      // Show success message (keep loading screen visible)
      showSuccess(`${trainerData.name} caught a ${selectedSpecies.name}!`);

      // register_pokemon_for_trainer() deliberately always returns the
      // static image (never a self-uploaded sprite URL -- see its guard
      // against persisting one), so this response alone isn't the
      // display-ready copy. Re-fetch via the sprite-aware endpoint to
      // pick up an MP4 if this species has one, concurrently with the
      // "new pokemon" sound so it doesn't add any wait beyond what the
      // player's already sitting through.
      const registeredName = response.newPokemonData.name;
      audioManager.stopBg();
      const [spriteAwareFetch] = await Promise.all([
        PokemonAPI.get(trainerData.name, registeredName, true),
        audioManager.playSfxAndWait('NewPokemon')
      ]);

      let finalPokemonData = response.newPokemonData;
      if (spriteAwareFetch.status === 'success' && spriteAwareFetch.data) {
        finalPokemonData = spriteAwareFetch.data;
      }
      await prefetchSprite(finalPokemonData.image);

      storePokemon(finalPokemonData);

      hideLoading();
      window.dispatchEvent(new CustomEvent('navigate', {
        detail: { route: 'my-pokemon' }
      }));
    } else {
      hideLoading();
      showError(response.message || 'Failed to register Pokemon');
      // Reload form
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('navigate', {
          detail: { route: 'pokemon-form' }
        }));
      }, 2000);
    }
  } catch (error) {
    console.error('Error registering Pokemon:', error);
    hideLoading();
    showError('Failed to register Pokemon');
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('navigate', {
        detail: { route: 'pokemon-form' }
      }));
    }, 2000);
  }
}

function getStatIndex(statName) {
  const statMapping = {
    'strength': 0,
    'dexterity': 1,
    'constitution': 2,
    'intelligence': 3,
    'wisdom': 4,
    'charisma': 5,
    'ac': -7
  };
  return statMapping[statName] || 0;
}
