// Edit Pokemon Page - Form for editing Pokemon stats

import { PokemonAPI } from '../api.js';
import { showSuccess, showError } from '../utils/notifications.js';

export function renderEditPokemon(pokemonName) {
  // Load Pokemon data from session storage
  const pokemonDataStr = sessionStorage.getItem(`pokemon_${pokemonName.toLowerCase()}`);
  if (!pokemonDataStr) {
    return '<div class="error">Pokemon data not found. Please return to the trainer card.</div>';
  }

  const pokemonData = JSON.parse(pokemonDataStr);
  const natures = JSON.parse(sessionStorage.getItem('natures') || '[]');
  const pokemonFeatsData = JSON.parse(sessionStorage.getItem('pokemonFeats') || '{"pokemonFeats": []}');

  // Extract Pokemon info
  const name = pokemonData[2] || '';
  const nickname = pokemonData[36] || '';
  const level = pokemonData[4] || 1;
  const hd = pokemonData[9] || 0;
  const vd = pokemonData[11] || 0;
  const str = pokemonData[15] || 10;
  const dex = pokemonData[16] || 10;
  const con = pokemonData[17] || 10;
  const int = pokemonData[18] || 10;
  const wis = pokemonData[19] || 10;
  const cha = pokemonData[20] || 10;
  const loyalty = pokemonData[33] || 0;
  const heldItem = pokemonData[35] || '';
  const nature = pokemonData[34] || '';
  const skills = pokemonData[22] || '';
  const feats = pokemonData[50] || '';

  const selectedSkills = skills ? skills.split(',').map(s => s.trim()) : [];
  const selectedFeats = feats ? feats.split(',').map(s => s.trim()) : [];

  const html = `
    <div class="edit-pokemon-page">
      <style>
        body, .content {
          background: linear-gradient(to bottom, #f44336 80%, #ffffff 20%);
        }

        .edit-pokemon-page {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 2rem 1rem;
          min-height: 80vh;
        }

        .edit-pokemon-page h1 {
          color: white;
          margin-bottom: 2rem;
          font-size: 2.5rem;
        }

        .form-container {
          width: 100%;
          max-width: 700px;
          background-color: white;
          padding: 2.5rem;
          border-radius: 10px;
          box-shadow: 0 4px 10px rgba(0,0,0,0.2);
          margin-bottom: 2rem;
          max-height: 70vh;
          overflow-y: auto;
        }

        .form-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1.5rem;
        }

        .form-group {
          margin-bottom: 1.5rem;
        }

        .form-group.full-width {
          grid-column: 1 / 3;
        }

        .form-group label {
          display: block;
          font-weight: bold;
          font-size: 1.2rem;
          margin-bottom: 0.5rem;
          color: #333;
        }

        .form-group input[type="number"],
        .form-group input[type="text"],
        .form-group select {
          width: 100%;
          padding: 0.75rem;
          font-size: 1.1rem;
          border: 2px solid #ccc;
          border-radius: 5px;
          box-sizing: border-box;
        }

        .form-group input:focus,
        .form-group select:focus {
          border-color: #f44336;
          outline: none;
        }

        .collapsible-section {
          margin-bottom: 1.5rem;
        }

        .collapsible-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1rem;
          background: #f44336;
          color: white;
          border-radius: 5px;
          cursor: pointer;
          font-size: 1.3rem;
          font-weight: bold;
        }

        .collapsible-header:hover {
          background: #d32f2f;
        }

        .arrow {
          transition: transform 0.3s;
        }

        .arrow.open {
          transform: rotate(90deg);
        }

        .collapsible-content {
          display: none;
          padding: 1rem;
          border: 2px solid #f44336;
          border-top: none;
          border-radius: 0 0 5px 5px;
          max-height: 300px;
          overflow-y: auto;
        }

        .collapsible-content.open {
          display: block;
        }

        .checkbox-item {
          display: flex;
          align-items: center;
          margin-bottom: 0.75rem;
        }

        .checkbox-item input[type="checkbox"] {
          margin-right: 0.75rem;
          transform: scale(1.5);
          cursor: pointer;
        }

        .checkbox-item label {
          font-size: 1.1rem;
          cursor: pointer;
          margin: 0;
        }

        .button-group {
          display: flex;
          gap: 1rem;
          justify-content: center;
          margin-top: 2rem;
        }

        .button {
          padding: 1rem 2rem;
          border: none;
          border-radius: 5px;
          font-size: 1.2rem;
          font-weight: bold;
          cursor: pointer;
          transition: all 0.3s;
        }

        .button-primary {
          background-color: #4CAF50;
          color: white;
        }

        .button-primary:hover {
          background-color: #45a049;
        }

        .button-secondary {
          background-color: #f44336;
          color: white;
        }

        .button-secondary:hover {
          background-color: #d32f2f;
        }
      </style>

      <h1>Edit ${nickname || name}</h1>

      <div class="form-container">
        <form id="editPokemonForm">
          <div class="form-grid">
            <div class="form-group">
              <label for="level">Level</label>
              <input type="number" id="level" name="level" value="${level}" min="1" max="100" required />
            </div>

            <div class="form-group">
              <label for="loyalty">Loyalty</label>
              <input type="number" id="loyalty" name="loyalty" value="${loyalty}" min="-10" max="10" required />
            </div>

            <div class="form-group">
              <label for="hd">Hit Dice (HD)</label>
              <input type="number" id="hd" name="hd" value="${hd}" min="0" required />
            </div>

            <div class="form-group">
              <label for="vd">Vitality Dice (VD)</label>
              <input type="number" id="vd" name="vd" value="${vd}" min="0" required />
            </div>

            <div class="form-group">
              <label for="str">STR</label>
              <input type="number" id="str" name="str" value="${str}" min="1" max="30" required />
            </div>

            <div class="form-group">
              <label for="dex">DEX</label>
              <input type="number" id="dex" name="dex" value="${dex}" min="1" max="30" required />
            </div>

            <div class="form-group">
              <label for="con">CON</label>
              <input type="number" id="con" name="con" value="${con}" min="1" max="30" required />
            </div>

            <div class="form-group">
              <label for="int">INT</label>
              <input type="number" id="int" name="int" value="${int}" min="1" max="30" required />
            </div>

            <div class="form-group">
              <label for="wis">WIS</label>
              <input type="number" id="wis" name="wis" value="${wis}" min="1" max="30" required />
            </div>

            <div class="form-group">
              <label for="cha">CHA</label>
              <input type="number" id="cha" name="cha" value="${cha}" min="1" max="30" required />
            </div>

            <div class="form-group full-width">
              <label for="heldItem">Held Item</label>
              <input type="text" id="heldItem" name="heldItem" value="${heldItem}" />
            </div>

            <div class="form-group full-width">
              <label for="nature">Nature</label>
              <select id="nature" name="nature">
                <option value="">Select a nature...</option>
                ${natures.map(n => `
                  <option value="${n.name}" ${n.name === nature ? 'selected' : ''}>${n.name}</option>
                `).join('')}
              </select>
            </div>
          </div>

          <!-- Skills Section -->
          <div class="collapsible-section">
            <div class="collapsible-header" id="skillsHeader">
              <span>Skills</span>
              <span class="arrow" id="skillsArrow">▶</span>
            </div>
            <div class="collapsible-content" id="skillsContent">
              ${['Athletics', 'Acrobatics', 'Sleight of Hand', 'Stealth', 'Arcana', 'History', 'Investigation', 'Nature', 'Religion', 'Animal Handling', 'Insight', 'Medicine', 'Perception', 'Survival', 'Deception', 'Intimidation', 'Performance', 'Persuasion'].map(skill => `
                <div class="checkbox-item">
                  <input type="checkbox" id="skill_${skill.replace(/\s+/g, '_')}" name="skills" value="${skill}" ${selectedSkills.includes(skill) ? 'checked' : ''} />
                  <label for="skill_${skill.replace(/\s+/g, '_')}">${skill}</label>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Feats Section -->
          <div class="collapsible-section">
            <div class="collapsible-header" id="featsHeader">
              <span>Feats</span>
              <span class="arrow" id="featsArrow">▶</span>
            </div>
            <div class="collapsible-content" id="featsContent">
              ${(pokemonFeatsData.pokemonFeats || []).map(feat => `
                <div class="checkbox-item">
                  <input type="checkbox" id="feat_${feat.name.replace(/\s+/g, '_')}" name="feats" value="${feat.name}" ${selectedFeats.includes(feat.name) ? 'checked' : ''} />
                  <label for="feat_${feat.name.replace(/\s+/g, '_')}">${feat.name}</label>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Buttons -->
          <div class="button-group">
            <button type="submit" class="button button-primary">Save Changes</button>
            <button type="button" class="button button-secondary" id="cancelButton">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `;

  return html;
}

export function attachEditPokemonListeners() {
  const pokemonName = sessionStorage.getItem('selectedPokemonName');

  // Collapsible sections
  ['skills', 'feats'].forEach(section => {
    const header = document.getElementById(`${section}Header`);
    const content = document.getElementById(`${section}Content`);
    const arrow = document.getElementById(`${section}Arrow`);

    header?.addEventListener('click', () => {
      content.classList.toggle('open');
      arrow.classList.toggle('open');
    });
  });

  // Cancel button
  document.getElementById('cancelButton')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('navigate', {
      detail: { route: 'pokemon-card', pokemonName: pokemonName }
    }));
  });

  // Form submission
  document.getElementById('editPokemonForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await handleFormSubmit(pokemonName);
  });
}

async function handleFormSubmit(pokemonName) {
  const form = document.getElementById('editPokemonForm');
  const pokemonDataStr = sessionStorage.getItem(`pokemon_${pokemonName.toLowerCase()}`);
  const pokemonData = JSON.parse(pokemonDataStr);

  // Show loading
  document.getElementById('content').innerHTML = '<div class="loading">Saving changes...</div>';

  try {
    // Gather form data
    const level = parseInt(form.level.value);
    const loyalty = parseInt(form.loyalty.value);
    const hd = parseInt(form.hd.value);
    const vd = parseInt(form.vd.value);
    const str = parseInt(form.str.value);
    const dex = parseInt(form.dex.value);
    const con = parseInt(form.con.value);
    const int = parseInt(form.int.value);
    const wis = parseInt(form.wis.value);
    const cha = parseInt(form.cha.value);
    const heldItem = form.heldItem.value;
    const nature = form.nature.value;

    // Get selected skills
    const selectedSkills = Array.from(form.querySelectorAll('input[name="skills"]:checked'))
      .map(cb => cb.value);

    // Get selected feats
    const selectedFeats = Array.from(form.querySelectorAll('input[name="feats"]:checked'))
      .map(cb => cb.value);

    // Update Pokemon data array
    pokemonData[4] = level;
    pokemonData[9] = hd;
    pokemonData[11] = vd;
    pokemonData[15] = str;
    pokemonData[16] = dex;
    pokemonData[17] = con;
    pokemonData[18] = int;
    pokemonData[19] = wis;
    pokemonData[20] = cha;
    pokemonData[22] = selectedSkills.join(', ');
    pokemonData[33] = loyalty;
    pokemonData[34] = nature;
    pokemonData[35] = heldItem;
    pokemonData[50] = selectedFeats.join(', ');

    // Update session storage
    sessionStorage.setItem(`pokemon_${pokemonName.toLowerCase()}`, JSON.stringify(pokemonData));

    // Send to API
    await PokemonAPI.update(pokemonData);

    // Show success message
    showSuccess(`${pokemonData[2]}'s info is updated!`);

    // Navigate back to pokemon card
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('navigate', {
        detail: { route: 'pokemon-card', pokemonName: pokemonName }
      }));
    }, 1000);

  } catch (error) {
    console.error('Error updating Pokemon:', error);
    showError('Failed to update Pokemon data');

    // Reload the form
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('navigate', {
        detail: { route: 'edit-pokemon', pokemonName: pokemonName }
      }));
    }, 2000);
  }
}
