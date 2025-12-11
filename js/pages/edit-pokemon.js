// Edit Pokemon Page - Modern form for editing Pokemon stats with pre-filled data

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
  const items = JSON.parse(sessionStorage.getItem('items') || '[]');
  const moves = JSON.parse(sessionStorage.getItem('moves') || '[]');

  // Extract Pokemon info
  const name = pokemonData[2] || '';
  const nickname = pokemonData[36] || '';
  const level = pokemonData[4] || 1;
  const str = pokemonData[15] || 10;
  const dex = pokemonData[16] || 10;
  const con = pokemonData[17] || 10;
  const int = pokemonData[18] || 10;
  const wis = pokemonData[19] || 10;
  const cha = pokemonData[20] || 10;
  const loyalty = pokemonData[33] || 0;
  const heldItem = pokemonData[35] || '';
  const currentNature = pokemonData[32] || '';
  const skills = pokemonData[22] || '';
  const feats = pokemonData[50] || '';
  const customMoves = pokemonData[37] || '';

  const selectedSkills = skills ? skills.split(',').map(s => s.trim()) : [];
  const selectedFeats = feats ? feats.split(',').map(s => s.trim()) : [];
  const existingCustomMoves = customMoves ? customMoves.split(',').map(m => m.trim()).filter(m => m) : [];

  const html = `
    <div class="edit-pokemon-page">
      <style>
        body, .content {
          background:
            radial-gradient(circle at 20% 80%, rgba(255, 222, 0, 0.15) 0%, transparent 50%),
            radial-gradient(circle at 80% 20%, rgba(59, 76, 202, 0.15) 0%, transparent 50%),
            radial-gradient(circle at 40% 40%, rgba(238, 21, 21, 0.3) 0%, transparent 40%),
            linear-gradient(135deg, #EE1515 0%, #C91010 50%, #A00808 100%);
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

        .edit-pokemon-page {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: clamp(5rem, 10vh, 7rem) clamp(1rem, 3vw, 2rem) clamp(2rem, 4vh, 3rem);
          min-height: 100vh;
          position: relative;
          box-sizing: border-box;
        }

        .edit-pokemon-page h1 {
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

        .form-container {
          width: 100%;
          max-width: clamp(600px, 90vw, 800px);
          background: linear-gradient(135deg, rgba(255,255,255,0.98) 0%, rgba(245,245,245,0.98) 100%);
          padding: clamp(2rem, 4vw, 3rem);
          border-radius: clamp(15px, 3vw, 20px);
          box-shadow: 0 clamp(8px, 2vh, 15px) clamp(25px, 5vh, 40px) rgba(0,0,0,0.5);
          border: clamp(3px, 0.6vw, 5px) solid #FFDE00;
          max-height: 75vh;
          overflow-y: auto;
        }

        .form-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: clamp(1rem, 2.5vw, 1.5rem);
          margin-bottom: clamp(1.5rem, 3vh, 2rem);
        }

        .form-group {
          display: flex;
          flex-direction: column;
        }

        .form-group.full-width {
          grid-column: 1 / 3;
        }

        .form-group label {
          font-weight: 900;
          font-size: clamp(0.95rem, 2vw, 1.1rem);
          margin-bottom: clamp(0.3rem, 0.8vh, 0.5rem);
          color: #333;
          text-transform: uppercase;
          letter-spacing: clamp(0.3px, 0.2vw, 0.5px);
        }

        .form-group input[type="number"],
        .form-group input[type="text"],
        .form-group select {
          width: 100%;
          padding: clamp(0.6rem, 1.5vw, 0.8rem);
          font-size: clamp(0.95rem, 2vw, 1.1rem);
          border: clamp(2px, 0.4vw, 3px) solid rgba(255,222,0,0.5);
          border-radius: clamp(8px, 1.5vw, 12px);
          box-sizing: border-box;
          background: white;
          font-weight: 600;
          transition: all 0.3s;
        }

        .form-group input:focus,
        .form-group select:focus {
          border-color: #FFDE00;
          outline: none;
          box-shadow: 0 0 clamp(8px, 1.5vw, 12px) rgba(255,222,0,0.4);
        }

        .form-group select {
          cursor: pointer;
        }

        .chip-container {
          display: flex;
          flex-wrap: wrap;
          gap: clamp(0.4rem, 1vw, 0.6rem);
          margin-top: clamp(0.5rem, 1vh, 0.75rem);
          padding-bottom: clamp(1rem, 2vh, 1.5rem);
          min-height: clamp(2rem, 4vh, 2.5rem);
        }

        .chip {
          display: inline-flex;
          align-items: center;
          gap: clamp(0.3rem, 0.8vw, 0.5rem);
          padding: clamp(0.3rem, 0.8vh, 0.5rem) clamp(0.6rem, 1.5vw, 0.8rem);
          background: linear-gradient(135deg, #3B4CCA 0%, #2E3FA0 100%);
          color: white;
          border-radius: clamp(15px, 3vw, 20px);
          font-size: clamp(0.85rem, 1.8vw, 1rem);
          font-weight: 700;
          border: clamp(2px, 0.3vw, 3px) solid #FFDE00;
        }

        .chip-remove {
          cursor: pointer;
          font-weight: bold;
          font-size: clamp(1rem, 2.2vw, 1.3rem);
          line-height: 1;
          transition: transform 0.2s;
        }

        .chip-remove:hover {
          transform: scale(1.3);
          color: #EE1515;
        }

        .add-button {
          padding: clamp(0.4rem, 1vh, 0.6rem) clamp(0.8rem, 2vw, 1.2rem);
          background: linear-gradient(135deg, #4CAF50 0%, #45A049 100%);
          color: white;
          border: clamp(2px, 0.4vw, 3px) solid #FFDE00;
          border-radius: clamp(8px, 1.5vw, 10px);
          font-size: clamp(0.85rem, 1.8vw, 1rem);
          font-weight: 900;
          cursor: pointer;
          transition: all 0.3s;
          text-transform: uppercase;
        }

        .add-button:hover {
          transform: translateY(-2px);
          box-shadow: 0 clamp(4px, 1vh, 6px) clamp(10px, 2vh, 15px) rgba(76,175,80,0.5);
        }

        .autocomplete-container {
          position: relative;
        }

        .autocomplete-dropdown {
          position: absolute;
          top: 100%;
          left: 0;
          right: 0;
          max-height: clamp(150px, 25vh, 200px);
          overflow-y: auto;
          background: white;
          border: clamp(2px, 0.4vw, 3px) solid #FFDE00;
          border-top: none;
          border-radius: 0 0 clamp(8px, 1.5vw, 12px) clamp(8px, 1.5vw, 12px);
          z-index: 100;
          display: none;
          box-shadow: 0 clamp(4px, 1vh, 6px) clamp(10px, 2vh, 15px) rgba(0,0,0,0.3);
        }

        .autocomplete-dropdown.open {
          display: block;
        }

        .autocomplete-item {
          padding: clamp(0.5rem, 1.2vh, 0.75rem) clamp(0.6rem, 1.5vw, 0.8rem);
          cursor: pointer;
          font-size: clamp(0.9rem, 1.8vw, 1rem);
          border-bottom: clamp(1px, 0.2vw, 2px) solid #f0f0f0;
          transition: background 0.2s;
          font-weight: 600;
        }

        .autocomplete-item:hover {
          background: linear-gradient(135deg, #EE1515 0%, #C91010 100%);
          color: white;
        }

        .autocomplete-item:last-child {
          border-bottom: none;
        }

        .collapsible-section {
          margin-bottom: clamp(1rem, 2vh, 1.5rem);
        }

        .collapsible-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: clamp(0.8rem, 2vh, 1rem) clamp(1rem, 2.5vw, 1.5rem);
          background: linear-gradient(135deg, #EE1515 0%, #C91010 100%);
          color: white;
          border-radius: clamp(10px, 2vw, 15px);
          cursor: pointer;
          font-size: clamp(1rem, 2.2vw, 1.3rem);
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: clamp(0.5px, 0.3vw, 1px);
          transition: all 0.3s;
          border: clamp(2px, 0.4vw, 3px) solid #FFDE00;
          box-shadow: 0 clamp(3px, 0.8vh, 5px) clamp(8px, 1.5vh, 12px) rgba(0,0,0,0.3);
        }

        .collapsible-header:hover {
          background: linear-gradient(135deg, #C91010 0%, #A00808 100%);
          transform: translateY(-2px);
          box-shadow: 0 clamp(5px, 1.2vh, 8px) clamp(12px, 2vh, 18px) rgba(0,0,0,0.4);
        }

        .arrow {
          transition: transform 0.3s;
          font-size: clamp(1rem, 2.2vw, 1.3rem);
        }

        .arrow.open {
          transform: rotate(90deg);
        }

        .collapsible-content {
          display: none;
          padding: clamp(1rem, 2.5vh, 1.5rem);
          border: clamp(2px, 0.4vw, 3px) solid rgba(255,222,0,0.5);
          border-top: none;
          border-radius: 0 0 clamp(10px, 2vw, 15px) clamp(10px, 2vw, 15px);
          max-height: clamp(200px, 35vh, 300px);
          overflow-y: auto;
          background: rgba(255,255,255,0.5);
        }

        .collapsible-content.open {
          display: block;
        }

        .checkbox-item {
          display: flex;
          align-items: flex-start;
          margin-bottom: clamp(0.6rem, 1.5vh, 0.8rem);
          gap: clamp(0.5rem, 1.2vw, 0.75rem);
        }

        .checkbox-item input[type="checkbox"],
        .checkbox-item input[type="radio"] {
          margin-top: clamp(0.1rem, 0.3vh, 0.2rem);
          width: clamp(18px, 4vw, 22px);
          height: clamp(18px, 4vw, 22px);
          cursor: pointer;
          flex-shrink: 0;
        }

        .checkbox-item label {
          font-size: clamp(0.9rem, 1.9vw, 1.05rem);
          cursor: pointer;
          margin: 0;
          font-weight: 600;
          color: #333;
          line-height: 1.4;
        }

        .dropdown-wrapper {
          padding: clamp(0.8rem, 2vw, 1rem);
        }

        .dropdown-wrapper select {
          width: 100%;
          padding: clamp(0.6rem, 1.5vw, 0.8rem);
          font-size: clamp(0.95rem, 2vw, 1.1rem);
          border: clamp(2px, 0.4vw, 3px) solid rgba(255,222,0,0.5);
          border-radius: clamp(8px, 1.5vw, 12px);
          background: white;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s;
        }

        .dropdown-wrapper select:focus {
          border-color: #FFDE00;
          outline: none;
          box-shadow: 0 0 clamp(8px, 1.5vw, 12px) rgba(255,222,0,0.4);
        }

        .styled-dropdown-header {
          padding: clamp(0.8rem, 2vh, 1rem) clamp(1rem, 2.5vw, 1.5rem);
          background: linear-gradient(135deg, #EE1515 0%, #C91010 100%);
          color: white;
          border-radius: clamp(10px, 2vw, 15px) clamp(10px, 2vw, 15px) 0 0;
          font-size: clamp(1rem, 2.2vw, 1.3rem);
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: clamp(0.5px, 0.3vw, 1px);
          border: clamp(2px, 0.4vw, 3px) solid #FFDE00;
          border-bottom: none;
          box-shadow: 0 clamp(3px, 0.8vh, 5px) clamp(8px, 1.5vh, 12px) rgba(0,0,0,0.3);
        }

        .styled-dropdown-header label {
          margin: 0;
          color: white;
          text-shadow: 0 2px 4px rgba(0,0,0,0.4);
        }

        .styled-select {
          width: 100%;
          padding: clamp(0.8rem, 2vw, 1rem);
          font-size: clamp(0.95rem, 2vw, 1.1rem);
          border: clamp(2px, 0.4vw, 3px) solid #FFDE00;
          border-top: none;
          border-radius: 0 0 clamp(10px, 2vw, 15px) clamp(10px, 2vw, 15px);
          background: rgba(255,255,255,0.95);
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s;
          box-shadow: 0 clamp(3px, 0.8vh, 5px) clamp(8px, 1.5vh, 12px) rgba(0,0,0,0.3);
        }

        .styled-select:focus {
          outline: none;
          background: white;
          box-shadow: 0 clamp(4px, 1vh, 6px) clamp(10px, 2vh, 15px) rgba(0,0,0,0.4);
        }

        .button-group {
          display: flex;
          gap: clamp(1rem, 2.5vw, 1.5rem);
          justify-content: center;
          margin-top: clamp(2rem, 4vh, 3rem);
          flex-wrap: wrap;
        }

        .button {
          padding: clamp(0.8rem, 2vh, 1.2rem) clamp(2rem, 5vw, 3rem);
          border: clamp(3px, 0.6vw, 4px) solid #333;
          border-radius: clamp(10px, 2vw, 15px);
          font-size: clamp(1rem, 2.2vw, 1.3rem);
          font-weight: 900;
          cursor: pointer;
          transition: all 0.3s;
          text-transform: uppercase;
          letter-spacing: clamp(0.5px, 0.3vw, 1px);
          box-shadow: 0 clamp(4px, 1vh, 6px) clamp(10px, 2vh, 15px) rgba(0,0,0,0.3);
        }

        .button-primary {
          background: linear-gradient(135deg, #4CAF50 0%, #45A049 100%);
          color: white;
          border-color: #FFDE00;
        }

        .button-primary:hover {
          transform: translateY(-3px);
          box-shadow: 0 clamp(6px, 1.5vh, 10px) clamp(15px, 3vh, 25px) rgba(76,175,80,0.5),
                      0 0 clamp(15px, 3vw, 25px) rgba(255,222,0,0.5);
        }

        .button-secondary {
          background: linear-gradient(135deg, #666 0%, #555 100%);
          color: white;
          border-color: #999;
        }

        .button-secondary:hover {
          background: linear-gradient(135deg, #555 0%, #444 100%);
          transform: translateY(-2px);
          box-shadow: 0 clamp(5px, 1.2vh, 8px) clamp(12px, 2.5vh, 20px) rgba(0,0,0,0.4);
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

        @media (max-width: 600px) {
          .form-grid {
            grid-template-columns: 1fr;
          }

          .form-group.full-width {
            grid-column: 1;
          }
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
          </div>

          <!-- Held Items Section -->
          <div class="form-group full-width">
            <label for="heldItems">Held Items</label>
            <div style="display: flex; gap: clamp(0.5rem, 1.2vw, 0.75rem); margin-bottom: clamp(0.5rem, 1vh, 0.75rem);">
              <div class="autocomplete-container" style="flex: 1;">
                <input type="text" id="heldItemInput" placeholder="Type to search items..." autocomplete="off" />
                <div class="autocomplete-dropdown" id="heldItemDropdown"></div>
              </div>
              <button type="button" class="add-button" id="addItemButton">Add</button>
            </div>
            <div class="chip-container" id="heldItemsContainer">
              ${heldItem ? heldItem.split(',').map(item => item.trim()).filter(i => i).map(item => `
                <div class="chip">
                  ${item}
                  <span class="chip-remove" data-item="${item}">×</span>
                </div>
              `).join('') : ''}
            </div>
          </div>

          <!-- Custom Moves Section -->
          <div class="form-group full-width">
            <label for="customMoves">Custom Moves</label>
            <div style="display: flex; gap: clamp(0.5rem, 1.2vw, 0.75rem); margin-bottom: clamp(0.5rem, 1vh, 0.75rem);">
              <div class="autocomplete-container" style="flex: 1;">
                <input type="text" id="customMovesInput" placeholder="Type to search moves..." autocomplete="off" />
                <div class="autocomplete-dropdown" id="customMovesDropdown"></div>
              </div>
              <button type="button" class="add-button" id="addMoveButton">Add</button>
            </div>
            <div class="chip-container" id="customMovesContainer">
              ${existingCustomMoves.map(move => `
                <div class="chip">
                  ${move}
                  <span class="chip-remove" data-move="${move}">×</span>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Nature Section -->
          <div class="collapsible-section">
            <div class="collapsible-header" id="natureHeader">
              <span>Nature</span>
              <span class="arrow" id="natureArrow">▶</span>
            </div>
            <div class="collapsible-content" id="natureContent">
              ${natures.map(n => `
                <div class="checkbox-item">
                  <input type="radio" id="nature_${n.name.replace(/\s+/g, '_')}" name="nature" value="${n.name}" ${n.name === currentNature ? 'checked' : ''} />
                  <label for="nature_${n.name.replace(/\s+/g, '_')}">${n.name}</label>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Abilities Section -->
          <div class="collapsible-section">
            <div class="collapsible-header" id="abilitiesHeader">
              <span>Abilities</span>
              <span class="arrow" id="abilitiesArrow">▶</span>
            </div>
            <div class="collapsible-content" id="abilitiesContent">
              <div style="padding: clamp(0.8rem, 2vw, 1rem); font-size: clamp(0.95rem, 2vw, 1.1rem); color: #666;">Loading abilities...</div>
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

      <!-- Back Button -->
      <button class="back-button" id="backButton">←</button>
    </div>
  `;

  return html;
}

export function attachEditPokemonListeners() {
  const pokemonName = sessionStorage.getItem('selectedPokemonName');
  const pokemonData = JSON.parse(sessionStorage.getItem(`pokemon_${pokemonName.toLowerCase()}`));
  const items = JSON.parse(sessionStorage.getItem('items') || '[]');
  const moves = JSON.parse(sessionStorage.getItem('moves') || '[]');

  // Collapsible sections
  ['skills', 'feats', 'abilities', 'nature'].forEach(section => {
    const header = document.getElementById(`${section}Header`);
    const content = document.getElementById(`${section}Content`);
    const arrow = document.getElementById(`${section}Arrow`);

    header?.addEventListener('click', () => {
      content.classList.toggle('open');
      arrow.classList.toggle('open');
    });
  });

  // Held items autocomplete and chip management
  const heldItemInput = document.getElementById('heldItemInput');
  const heldItemsContainer = document.getElementById('heldItemsContainer');

  setupAutocomplete(
    'heldItemInput',
    'heldItemDropdown',
    items.map(item => item.name)
  );

  // Add item button
  document.getElementById('addItemButton')?.addEventListener('click', () => {
    const itemName = heldItemInput.value.trim();
    if (itemName) {
      // Check if already added
      const existing = Array.from(heldItemsContainer.querySelectorAll('.chip'))
        .some(chip => chip.textContent.trim().replace('×', '').trim() === itemName);

      if (!existing) {
        addItemChip(itemName);
        heldItemInput.value = '';
      }
    }
  });

  // Remove existing item chips
  heldItemsContainer.querySelectorAll('.chip-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.target.closest('.chip').remove();
    });
  });

  // Custom moves autocomplete and chip management
  const customMovesInput = document.getElementById('customMovesInput');
  const customMovesDropdown = document.getElementById('customMovesDropdown');
  const customMovesContainer = document.getElementById('customMovesContainer');

  setupAutocomplete(
    'customMovesInput',
    'customMovesDropdown',
    moves.map(move => move[0])
  );

  // Add move button
  document.getElementById('addMoveButton')?.addEventListener('click', () => {
    const moveName = customMovesInput.value.trim();
    if (moveName) {
      // Check if already added
      const existing = Array.from(customMovesContainer.querySelectorAll('.chip'))
        .some(chip => chip.textContent.trim().replace('×', '').trim() === moveName);

      if (!existing) {
        addMoveChip(moveName);
        customMovesInput.value = '';
      }
    }
  });

  // Remove existing move chips
  customMovesContainer.querySelectorAll('.chip-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.target.closest('.chip').remove();
    });
  });

  // Load abilities from server
  loadAbilities(pokemonData);

  // Cancel button
  document.getElementById('cancelButton')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('navigate', {
      detail: { route: 'pokemon-card', pokemonName: pokemonName }
    }));
  });

  // Back button
  document.getElementById('backButton')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('navigate', {
      detail: { route: 'pokemon-card', pokemonName: pokemonName }
    }));
  });

  // Nature change listener for stat recalculation
  const natureRadios = document.querySelectorAll('input[name="nature"]');
  const originalNature = pokemonData[32] || '';

  natureRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      if (e.target.checked) {
        recalculateStatsForNatureChange(originalNature, e.target.value, pokemonData);
      }
    });
  });

  // Form submission
  document.getElementById('editPokemonForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await handleFormSubmit(pokemonName, originalNature);
  });
}

function setupAutocomplete(inputId, dropdownId, dataSource) {
  const input = document.getElementById(inputId);
  const dropdown = document.getElementById(dropdownId);

  if (!input || !dropdown) return;

  input.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();

    if (query.length === 0) {
      dropdown.classList.remove('open');
      dropdown.innerHTML = '';
      return;
    }

    const filtered = dataSource
      .filter(item => item && item.toLowerCase().includes(query))
      .slice(0, 10);

    if (filtered.length > 0) {
      dropdown.innerHTML = filtered.map(item =>
        `<div class="autocomplete-item">${item}</div>`
      ).join('');
      dropdown.classList.add('open');

      dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
        item.addEventListener('click', () => {
          input.value = item.textContent;
          dropdown.classList.remove('open');
          dropdown.innerHTML = '';
        });
      });
    } else {
      dropdown.classList.remove('open');
      dropdown.innerHTML = '';
    }
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest(`#${inputId}`) && !e.target.closest(`#${dropdownId}`)) {
      dropdown.classList.remove('open');
    }
  });
}

function addItemChip(itemName) {
  const container = document.getElementById('heldItemsContainer');
  const chip = document.createElement('div');
  chip.className = 'chip';
  chip.innerHTML = `
    ${itemName}
    <span class="chip-remove" data-item="${itemName}">×</span>
  `;

  const removeBtn = chip.querySelector('.chip-remove');
  removeBtn.addEventListener('click', () => {
    chip.remove();
  });

  container.appendChild(chip);
}

function addMoveChip(moveName) {
  const container = document.getElementById('customMovesContainer');
  const chip = document.createElement('div');
  chip.className = 'chip';
  chip.innerHTML = `
    ${moveName}
    <span class="chip-remove" data-move="${moveName}">×</span>
  `;

  const removeBtn = chip.querySelector('.chip-remove');
  removeBtn.addEventListener('click', () => {
    chip.remove();
  });

  container.appendChild(chip);
}

function recalculateStatsForNatureChange(oldNatureName, newNatureName, pokemonData) {
  if (oldNatureName === newNatureName) return;

  const natures = JSON.parse(sessionStorage.getItem('natures')) || [];
  const statMapping = {
    'strength': 'str',
    'dexterity': 'dex',
    'constitution': 'con',
    'intelligence': 'int',
    'wisdom': 'wis',
    'charisma': 'cha',
    'ac': 'ac'
  };

  // Reverse old nature
  if (oldNatureName) {
    const oldNature = natures.find(n => n.name === oldNatureName);
    if (oldNature) {
      const oldBoostStat = statMapping[oldNature.boostStat.toLowerCase()];
      const oldNerfStat = statMapping[oldNature.nerfStat.toLowerCase()];

      if (oldBoostStat && oldBoostStat !== 'ac') {
        const input = document.getElementById(oldBoostStat);
        if (input) {
          input.value = parseInt(input.value) - parseInt(oldNature.boostAmount);
        }
      }

      if (oldNerfStat && oldNerfStat !== 'ac') {
        const input = document.getElementById(oldNerfStat);
        if (input) {
          input.value = parseInt(input.value) + parseInt(oldNature.nerfAmount);
        }
      }
    }
  }

  // Apply new nature
  if (newNatureName) {
    const newNature = natures.find(n => n.name === newNatureName);
    if (newNature) {
      const newBoostStat = statMapping[newNature.boostStat.toLowerCase()];
      const newNerfStat = statMapping[newNature.nerfStat.toLowerCase()];

      if (newBoostStat && newBoostStat !== 'ac') {
        const input = document.getElementById(newBoostStat);
        if (input) {
          input.value = parseInt(input.value) + parseInt(newNature.boostAmount);
        }
      }

      if (newNerfStat && newNerfStat !== 'ac') {
        const input = document.getElementById(newNerfStat);
        if (input) {
          input.value = parseInt(input.value) - parseInt(newNature.nerfAmount);
        }
      }
    }
  }
}

async function handleFormSubmit(pokemonName, originalNature) {
  const form = document.getElementById('editPokemonForm');
  const pokemonDataStr = sessionStorage.getItem(`pokemon_${pokemonName.toLowerCase()}`);
  const pokemonData = JSON.parse(pokemonDataStr);

  try {
    // Gather form data
    const level = parseInt(form.level.value);
    const loyalty = parseInt(form.loyalty.value);
    const str = parseInt(form.str.value);
    const dex = parseInt(form.dex.value);
    const con = parseInt(form.con.value);
    const int = parseInt(form.int.value);
    const wis = parseInt(form.wis.value);
    const cha = parseInt(form.cha.value);
    const nature = form.nature.value;

    // Get selected skills
    const selectedSkills = Array.from(form.querySelectorAll('input[name="skills"]:checked'))
      .map(cb => cb.value);

    // Get selected feats
    const selectedFeats = Array.from(form.querySelectorAll('input[name="feats"]:checked'))
      .map(cb => cb.value);

    // Get selected abilities
    const selectedAbilities = Array.from(document.querySelectorAll('input[name="abilities"]:checked'))
      .map(cb => cb.value);
    const abilitiesString = selectedAbilities.join('|');

    // Get held items from chips
    const heldItemChips = Array.from(document.querySelectorAll('#heldItemsContainer .chip'));
    const heldItems = heldItemChips.map(chip =>
      chip.textContent.trim().replace('×', '').trim()
    );
    const heldItemsString = heldItems.join(', ');

    // Get custom moves from chips
    const customMoveChips = Array.from(document.querySelectorAll('#customMovesContainer .chip'));
    const customMoves = customMoveChips.map(chip =>
      chip.textContent.trim().replace('×', '').trim()
    );

    // Update Pokemon data array
    pokemonData[4] = level;
    pokemonData[7] = abilitiesString;
    pokemonData[15] = str;
    pokemonData[16] = dex;
    pokemonData[17] = con;
    pokemonData[18] = int;
    pokemonData[19] = wis;
    pokemonData[20] = cha;
    pokemonData[22] = selectedSkills.join(', ');
    pokemonData[32] = nature;
    pokemonData[33] = loyalty;
    pokemonData[35] = heldItemsString;
    pokemonData[37] = customMoves.join(', ');
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

async function loadAbilities(pokemonData) {
  const currentPokemonName = pokemonData[2];
  const abilitiesContent = document.getElementById('abilitiesContent');

  if (abilitiesContent) {
    abilitiesContent.innerHTML = '<div style="padding: clamp(0.8rem, 2vw, 1rem); font-size: clamp(0.95rem, 2vw, 1.1rem); color: #666;">Loading abilities...</div>';
  }

  try {
    const response = await PokemonAPI.getAbilities(currentPokemonName);
    if (response.status === 'success') {
      populateAbilities(response.abilities, pokemonData);
    } else {
      console.error('Error fetching Pokemon abilities:', response.message);
      if (abilitiesContent) {
        abilitiesContent.innerHTML = '<div style="padding: clamp(0.8rem, 2vw, 1rem); font-size: clamp(0.95rem, 2vw, 1.1rem); color: #f44336;">Failed to load abilities</div>';
      }
      showError('Failed to load Pokemon abilities');
    }
  } catch (error) {
    console.error('Error calling getPokemonAbilities:', error);
    if (abilitiesContent) {
      abilitiesContent.innerHTML = '<div style="padding: clamp(0.8rem, 2vw, 1rem); font-size: clamp(0.95rem, 2vw, 1.1rem); color: #f44336;">Failed to load abilities</div>';
    }
    showError('Failed to load Pokemon abilities');
  }
}

function populateAbilities(abilities, pokemonData) {
  const abilitiesContent = document.getElementById('abilitiesContent');
  if (!abilitiesContent) return;

  abilitiesContent.innerHTML = '';

  abilities.forEach((abilityData, index) => {
    const colonIndex = abilityData.indexOf(':');
    let slotIndex = index;
    let abilityString = abilityData;

    if (colonIndex !== -1 && colonIndex < 3) {
      slotIndex = parseInt(abilityData.substring(0, colonIndex));
      abilityString = abilityData.substring(colonIndex + 1);
    }

    const parts = abilityString.split(',');
    const abilityName = parts[0].trim();
    const abilityDescription = parts.slice(1).join(',').trim();

    const div = document.createElement('div');
    div.className = 'checkbox-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `ability${slotIndex}`;
    checkbox.name = 'abilities';
    checkbox.value = slotIndex + ':' + abilityName + ';' + abilityDescription;

    const label = document.createElement('label');
    label.htmlFor = `ability${slotIndex}`;
    label.textContent = abilityName;

    div.appendChild(checkbox);
    div.appendChild(label);
    abilitiesContent.appendChild(div);
  });

  // Check currently selected abilities
  const currentAbilitiesRaw = pokemonData[7] || '';
  const currentAbilities = currentAbilitiesRaw
    .split('|')
    .map(ability => ability.trim())
    .filter(ability => ability);

  currentAbilities.forEach(abilityData => {
    const colonIndex = abilityData.indexOf(':');

    if (colonIndex !== -1 && colonIndex < 3) {
      const slotIndex = abilityData.substring(0, colonIndex);
      const checkbox = document.getElementById(`ability${slotIndex}`);
      if (checkbox) {
        checkbox.checked = true;
      }
    } else {
      // Legacy format - match by name
      const abilityName = abilityData.split(';')[0].trim();
      const checkboxes = document.querySelectorAll('input[name="abilities"]');
      checkboxes.forEach(checkbox => {
        const checkboxValue = checkbox.value;
        const checkboxColonIndex = checkboxValue.indexOf(':');
        let checkboxAbilityName;

        if (checkboxColonIndex !== -1) {
          checkboxAbilityName = checkboxValue.substring(checkboxColonIndex + 1).split(';')[0].trim();
        } else {
          checkboxAbilityName = checkboxValue.split(';')[0].trim();
        }

        if (checkboxAbilityName.toLowerCase() === abilityName.toLowerCase()) {
          checkbox.checked = true;
        }
      });
    }
  });
}
