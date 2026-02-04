// Edit Trainer Page - Form for editing trainer stats

import { TrainerAPI } from '../api.js';
import { audioManager } from '../utils/audio.js';
import { showToast, showSuccess, showError } from '../utils/notifications.js';
import { showLoadingWithSplash, hideLoading } from '../utils/splash.js';

export function renderEditTrainer() {
  // Load trainer data from session storage
  const trainerDataStr = sessionStorage.getItem('trainerData');
  if (!trainerDataStr) {
    return '<div class="error">No trainer data found. Please return to the home page.</div>';
  }

  const trainerData = JSON.parse(trainerDataStr);
  const trainerFeatsData = JSON.parse(sessionStorage.getItem('trainerFeats') || '[]');

  // Extract trainer info
  const trainerName = trainerData[1] || 'Trainer';
  const trainerLevel = trainerData[2] || 1;
  const trainerSTR = trainerData[5] || 10;
  const trainerDEX = trainerData[6] || 10;
  const trainerCON = trainerData[7] || 10;
  const trainerINT = trainerData[8] || 10;
  const trainerWIS = trainerData[9] || 10;
  const trainerCHA = trainerData[10] || 10;
  const trainerAC = trainerData[13] || 10;
  const trainerMoney = trainerData[19] || 0;
  const trainerLeaguePoints = trainerData[21] || 0;
  const trainerSkills = trainerData[18] || '';
  const trainerFeats = trainerData[33] || '';
  const gear = trainerData[37] || '';

  // Hardcoded D&D skills list (matching reference file)
  const allSkills = [
    "Athletics (STR)", "Acrobatics (DEX)", "Sleight of Hand (DEX)", "Stealth (DEX)",
    "Arcana (INT)", "History (INT)", "Investigation (INT)", "Nature (INT)", "Religion (INT)",
    "Animal Handling (WIS)", "Insight (WIS)", "Medicine (WIS)", "Perception (WIS)",
    "Survival (WIS)", "Deception (CHA)", "Intimidation (CHA)", "Performance (CHA)", "Persuasion (CHA)"
  ];

  const selectedSkills = trainerSkills ? trainerSkills.split(',').map(s => s.trim()) : [];
  const selectedFeats = trainerFeats ? trainerFeats.split(',').map(s => s.trim()) : [];
  const gearArray = gear ? gear.split(',').map(g => g.trim()).filter(g => g && g !== 'None') : [];

  const html = `
    <div class="edit-trainer-page">
      <style>
        body, .content {
          background:
            radial-gradient(circle at 20% 80%, rgba(255, 222, 0, 0.15) 0%, transparent 50%),
            radial-gradient(circle at 80% 20%, rgba(59, 76, 202, 0.15) 0%, transparent 50%),
            radial-gradient(circle at 40% 40%, rgba(238, 21, 21, 0.3) 0%, transparent 40%),
            linear-gradient(to bottom, #EE1515 0%, #C91010 50%, #A00808 100%);
          min-height: 100vh;
          position: relative;
          overflow-x: hidden;
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

        .edit-trainer-page {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: clamp(6rem, 12vh, 8rem) clamp(1rem, 3vw, 2rem) clamp(1rem, 2vh, 1.5rem);
          min-height: auto;
          position: relative;
          box-sizing: border-box;
        }

        .edit-trainer-page h1 {
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
          width: 90%;
          max-width: clamp(500px, 70vw, 700px);
          background: linear-gradient(135deg, #FFFFFF 0%, #F8F8F8 100%);
          padding: clamp(2rem, 4vw, 3rem);
          border-radius: clamp(20px, 3vw, 30px);
          border: clamp(4px, 0.7vw, 6px) solid #FFDE00;
          box-shadow: 0 clamp(15px, 3vh, 25px) clamp(40px, 6vh, 60px) rgba(0,0,0,0.5),
                      inset 0 clamp(-4px, -0.8vh, -6px) 0 rgba(0,0,0,0.1);
          max-height: 70vh;
          overflow-y: auto;
        }

        .form-group {
          margin-bottom: clamp(1.2rem, 2.5vh, 1.8rem);
        }

        .form-group label {
          display: block;
          font-weight: 700;
          font-size: clamp(1rem, 2vw, 1.2rem);
          margin-bottom: clamp(0.4rem, 1vh, 0.6rem);
          color: #333;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .form-group input[type="number"],
        .form-group input[type="text"] {
          width: 100%;
          padding: clamp(0.6rem, 1.5vh, 0.9rem);
          font-size: clamp(1rem, 2vw, 1.2rem);
          border: clamp(3px, 0.5vw, 4px) solid #DDD;
          border-radius: clamp(8px, 2vw, 12px);
          box-sizing: border-box;
          transition: all 0.3s ease;
          background: white;
        }

        .form-group input[type="number"]:focus,
        .form-group input[type="text"]:focus {
          border-color: #FFDE00;
          outline: none;
          box-shadow: 0 0 12px rgba(255, 222, 0, 0.4);
        }

        /* Collapsible Sections */
        .collapsible-section {
          margin-bottom: clamp(1.2rem, 2.5vh, 1.8rem);
        }

        .collapsible-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: clamp(1rem, 2vh, 1.5rem);
          background: linear-gradient(135deg, #F44336 0%, #D32F2F 100%);
          color: white;
          border-radius: clamp(12px, 2.5vw, 18px);
          border: clamp(3px, 0.6vw, 4px) solid #FFDE00;
          cursor: pointer;
          font-size: clamp(1.1rem, 2.3vw, 1.5rem);
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: clamp(0.5px, 0.3vw, 1px);
          box-shadow: 0 clamp(6px, 1.5vh, 10px) clamp(15px, 3vh, 25px) rgba(0,0,0,0.4);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .collapsible-header:hover {
          transform: translateY(clamp(-2px, -0.5vh, -3px));
          box-shadow: 0 clamp(10px, 2vh, 15px) clamp(25px, 5vh, 35px) rgba(0,0,0,0.5),
                      0 0 clamp(15px, 3vw, 25px) rgba(255,222,0,0.5);
        }

        .arrow {
          font-size: clamp(1.2rem, 2.5vw, 1.6rem);
          transition: transform 0.3s ease;
        }

        .arrow.open {
          transform: rotate(90deg);
        }

        .collapsible-content {
          display: none;
          padding: clamp(1rem, 2vh, 1.5rem);
          border: clamp(3px, 0.6vw, 4px) solid #FFDE00;
          border-top: none;
          border-radius: 0 0 clamp(12px, 2.5vw, 18px) clamp(12px, 2.5vw, 18px);
          max-height: clamp(200px, 35vh, 300px);
          overflow-y: auto;
          background: linear-gradient(135deg, #FAFAFA 0%, #F0F0F0 100%);
        }

        .collapsible-content.open {
          display: block;
        }

        .checkbox-item {
          display: flex;
          align-items: center;
          margin-bottom: clamp(0.6rem, 1.5vh, 0.9rem);
          padding: clamp(0.5rem, 1vh, 0.75rem);
          background: white;
          border: 2px solid #DDD;
          border-radius: clamp(6px, 1.5vw, 10px);
          transition: all 0.2s ease;
        }

        .checkbox-item:hover {
          border-color: #F44336;
          background: #FFF8F8;
        }

        .checkbox-item input[type="checkbox"] {
          margin-right: clamp(0.6rem, 1.5vw, 0.9rem);
          transform: scale(clamp(1.3, 0.3vw, 1.6));
          cursor: pointer;
          accent-color: #F44336;
        }

        .checkbox-item label {
          font-size: clamp(0.95rem, 2vw, 1.15rem);
          cursor: pointer;
          margin: 0;
          font-weight: 500;
          color: #333;
        }

        /* Gear Section */
        .gear-container {
          display: flex;
          flex-wrap: wrap;
          gap: clamp(0.5rem, 1vw, 0.75rem);
          margin-bottom: clamp(1rem, 2vh, 1.5rem);
          padding: clamp(0.75rem, 1.5vh, 1rem);
          background: linear-gradient(135deg, #FAFAFA 0%, #F0F0F0 100%);
          border: 2px solid #DDD;
          border-radius: clamp(8px, 2vw, 12px);
          min-height: clamp(50px, 10vh, 70px);
        }

        .gear-chip {
          display: inline-flex;
          align-items: center;
          padding: clamp(0.5rem, 1vh, 0.75rem) clamp(0.75rem, 1.5vw, 1rem);
          background: linear-gradient(135deg, #F44336 0%, #D32F2F 100%);
          color: white;
          border: 2px solid #000;
          border-radius: clamp(15px, 3vw, 20px);
          font-size: clamp(0.95rem, 2vw, 1.15rem);
          font-weight: 600;
          box-shadow: 2px 2px 0 #000;
          transition: all 0.2s ease;
        }

        .gear-chip:hover {
          transform: translateY(-2px);
          box-shadow: 3px 3px 0 #000;
        }

        .gear-chip span {
          margin-left: clamp(0.5rem, 1vw, 0.75rem);
          font-weight: 900;
          cursor: pointer;
          font-size: clamp(1.2rem, 2.5vw, 1.5rem);
          transition: transform 0.2s ease;
        }

        .gear-chip span:hover {
          transform: scale(1.3);
        }

        .autocomplete-container {
          position: relative;
        }

        .autocomplete-dropdown {
          position: absolute;
          top: 100%;
          left: 0;
          right: 0;
          max-height: clamp(150px, 30vh, 250px);
          overflow-y: auto;
          background: white;
          border: clamp(3px, 0.5vw, 4px) solid #F44336;
          border-top: none;
          border-radius: 0 0 clamp(8px, 2vw, 12px) clamp(8px, 2vw, 12px);
          z-index: 100;
          display: none;
          box-shadow: 0 8px 20px rgba(0,0,0,0.2);
        }

        .autocomplete-dropdown.open {
          display: block;
        }

        .autocomplete-item {
          padding: clamp(0.75rem, 1.5vh, 1rem);
          cursor: pointer;
          font-size: clamp(0.95rem, 2vw, 1.1rem);
          border-bottom: 1px solid #EEE;
          transition: all 0.2s ease;
        }

        .autocomplete-item:hover {
          background: linear-gradient(135deg, #F44336 0%, #D32F2F 100%);
          color: white;
        }

        .autocomplete-item:last-child {
          border-bottom: none;
        }

        /* Button Group */
        .button-group {
          display: flex;
          gap: clamp(1rem, 2vw, 1.5rem);
          justify-content: center;
          margin-top: clamp(2rem, 4vh, 3rem);
        }

        .button {
          flex: 1;
          padding: clamp(1rem, 2vh, 1.5rem) clamp(1.5rem, 3vw, 2rem);
          border: clamp(3px, 0.5vw, 4px) solid #000;
          border-radius: clamp(12px, 2.5vw, 18px);
          font-size: clamp(1.1rem, 2.3vw, 1.4rem);
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: clamp(0.5px, 0.3vw, 1px);
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 clamp(6px, 1.5vh, 10px) clamp(15px, 3vh, 20px) rgba(0,0,0,0.3);
        }

        .button-primary {
          background: linear-gradient(135deg, #4CAF50 0%, #45A049 100%);
          color: white;
        }

        .button-primary:hover {
          transform: translateY(clamp(-3px, -0.8vh, -5px));
          box-shadow: 0 clamp(10px, 2vh, 15px) clamp(25px, 5vh, 35px) rgba(0,0,0,0.4),
                      0 0 clamp(15px, 3vw, 25px) rgba(76, 175, 80, 0.5);
        }

        .button-secondary {
          background: linear-gradient(135deg, #9E9E9E 0%, #757575 100%);
          color: white;
        }

        .button-secondary:hover {
          transform: translateY(clamp(-3px, -0.8vh, -5px));
          box-shadow: 0 clamp(10px, 2vh, 15px) clamp(25px, 5vh, 35px) rgba(0,0,0,0.4),
                      0 0 clamp(15px, 3vw, 25px) rgba(158, 158, 158, 0.5);
        }

        .button:active {
          transform: translateY(0);
          box-shadow: 0 clamp(3px, 0.8vh, 5px) clamp(8px, 1.5vh, 12px) rgba(0,0,0,0.3);
        }

        /* Back Button */
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

        @media (max-width: 1024px) {
          .form-container {
            max-width: clamp(500px, 75vw, 700px);
          }
        }

        @media (max-width: 768px) {
          .form-container {
            max-width: clamp(450px, 80vw, 650px);
          }

          .button-group {
            gap: clamp(0.9rem, 1.8vw, 1.3rem);
          }
        }

        @media (max-width: 600px) {
          .form-container {
            max-width: clamp(400px, 85vw, 600px);
          }

          .button-group {
            gap: clamp(0.8rem, 1.6vw, 1.2rem);
          }
        }

        @media (max-width: 480px) {
          .form-container {
            max-width: 90vw;
            padding: clamp(1.5rem, 3vw, 2.5rem);
          }

          .button-group {
            flex-direction: column;
          }

          .button {
            width: 100%;
          }
        }

        @media (max-width: 360px) {
          .form-container {
            max-width: 95vw;
            padding: clamp(1.2rem, 2.5vw, 2rem);
          }
        }
      </style>

      <!-- Back Button -->
      <button class="back-button" id="backButton">←</button>

      <h1>Edit Trainer</h1>

      <div class="form-container">
        <form id="editTrainerForm">
          <div class="form-group">
            <label for="level">Level</label>
            <input type="number" id="level" name="level" value="${trainerLevel}" min="1" max="20" required />
          </div>

          <div class="form-group">
            <label for="str">STR</label>
            <input type="number" id="str" name="str" value="${trainerSTR}" min="1" max="30" required />
          </div>

          <div class="form-group">
            <label for="dex">DEX</label>
            <input type="number" id="dex" name="dex" value="${trainerDEX}" min="1" max="30" required />
          </div>

          <div class="form-group">
            <label for="con">CON</label>
            <input type="number" id="con" name="con" value="${trainerCON}" min="1" max="30" required />
          </div>

          <div class="form-group">
            <label for="int">INT</label>
            <input type="number" id="int" name="int" value="${trainerINT}" min="1" max="30" required />
          </div>

          <div class="form-group">
            <label for="wis">WIS</label>
            <input type="number" id="wis" name="wis" value="${trainerWIS}" min="1" max="30" required />
          </div>

          <div class="form-group">
            <label for="cha">CHA</label>
            <input type="number" id="cha" name="cha" value="${trainerCHA}" min="1" max="30" required />
          </div>

          <div class="form-group">
            <label for="ac">AC</label>
            <input type="number" id="ac" name="ac" value="${trainerAC}" min="1" max="30" required />
          </div>

          <div class="form-group">
            <label for="leaguePoints">League Points</label>
            <input type="number" id="leaguePoints" name="leaguePoints" value="${trainerLeaguePoints}" min="0" required />
          </div>

          <!-- Skills Section -->
          <div class="collapsible-section">
            <div class="collapsible-header" id="skillsHeader">
              <span>Skills</span>
              <span class="arrow" id="skillsArrow">▶</span>
            </div>
            <div class="collapsible-content" id="skillsContent">
              ${allSkills.map(skill => {
                const skillName = skill.split(' (')[0].trim();
                const isChecked = selectedSkills.includes(skillName);
                return `
                  <div class="checkbox-item">
                    <input type="checkbox" id="skill_${skill.replace(/\s+/g, '_').replace(/\(|\)/g, '')}" name="skills" value="${skillName}" ${isChecked ? 'checked' : ''} />
                    <label for="skill_${skill.replace(/\s+/g, '_').replace(/\(|\)/g, '')}">${skill}</label>
                  </div>
                `;
              }).join('')}
            </div>
          </div>

          <!-- Feats Section -->
          <div class="collapsible-section">
            <div class="collapsible-header" id="featsHeader">
              <span>Feats</span>
              <span class="arrow" id="featsArrow">▶</span>
            </div>
            <div class="collapsible-content" id="featsContent">
              ${(trainerFeatsData || []).map(feat => `
                <div class="checkbox-item">
                  <input type="checkbox" id="feat_${feat.name.replace(/\s+/g, '_')}" name="feats" value="${feat.name}" ${selectedFeats.includes(feat.name) ? 'checked' : ''} />
                  <label for="feat_${feat.name.replace(/\s+/g, '_')}">${feat.name}</label>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Gear Section -->
          <div class="form-group">
            <label for="gearInput">Gear</label>
            <div class="gear-container" id="gearContainer">
              ${gearArray.length > 0 ? gearArray.map(g => `
                <div class="gear-chip">
                  ${g}
                  <span class="remove-gear" data-gear="${g}">×</span>
                </div>
              `).join('') : '<span style="color: #999; font-style: italic;">No gear items</span>'}
            </div>
            <div class="autocomplete-container">
              <input type="text" id="gearInput" placeholder="Type to search items..." autocomplete="off" />
              <div class="autocomplete-dropdown" id="gearDropdown"></div>
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

export function attachEditTrainerListeners() {
  // Set splash image on loading screen immediately (before it's shown)
  const loadingScreen = document.getElementById('loading-screen');
  const splashUrl = sessionStorage.getItem('preloadedSplashImage');
  if (loadingScreen && splashUrl) {
    loadingScreen.style.backgroundImage = `url('${splashUrl}')`;
    console.log('[Edit Trainer] Set splash image on loading screen:', splashUrl);
  }

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

  // Gear autocomplete
  const gearInput = document.getElementById('gearInput');
  const gearDropdown = document.getElementById('gearDropdown');
  const items = JSON.parse(sessionStorage.getItem('items') || '[]');
  const itemNames = items.map(item => item.name || item);

  gearInput?.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();

    if (query.length === 0) {
      gearDropdown.classList.remove('open');
      gearDropdown.innerHTML = '';
      return;
    }

    const filtered = itemNames.filter(name =>
      name.toLowerCase().includes(query)
    ).slice(0, 10); // Limit to 10 results

    if (filtered.length > 0) {
      gearDropdown.innerHTML = filtered.map(name =>
        `<div class="autocomplete-item">${name}</div>`
      ).join('');
      gearDropdown.classList.add('open');

      // Add click handlers to dropdown items
      gearDropdown.querySelectorAll('.autocomplete-item').forEach(item => {
        item.addEventListener('click', () => {
          addGearChip(item.textContent);
          gearInput.value = '';
          gearDropdown.classList.remove('open');
          gearDropdown.innerHTML = '';
        });
      });
    } else {
      gearDropdown.classList.remove('open');
      gearDropdown.innerHTML = '';
    }
  });

  // Allow Enter to add custom gear or select first match
  gearInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const firstItem = gearDropdown.querySelector('.autocomplete-item');
      if (firstItem) {
        addGearChip(firstItem.textContent);
      } else if (gearInput.value.trim()) {
        addGearChip(gearInput.value.trim());
      }
      gearInput.value = '';
      gearDropdown.classList.remove('open');
      gearDropdown.innerHTML = '';
    }
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.autocomplete-container')) {
      gearDropdown?.classList.remove('open');
    }
  });

  // Remove gear chip
  document.querySelectorAll('.remove-gear').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.target.closest('.gear-chip').remove();

      // Add placeholder if no gear left
      const container = document.getElementById('gearContainer');
      if (container.querySelectorAll('.gear-chip').length === 0) {
        container.innerHTML = '<span style="color: #999; font-style: italic;">No gear items</span>';
      }
    });
  });

  // Cancel button
  document.getElementById('cancelButton')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('navigate', {
      detail: { route: 'trainer-info' }
    }));
  });

  // Back button
  document.getElementById('backButton')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('navigate', {
      detail: { route: 'trainer-info' }
    }));
  });

  // Form submission
  document.getElementById('editTrainerForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Show loading screen IMMEDIATELY before any processing
    const splashUrl = sessionStorage.getItem('preloadedSplashImage');
    showLoadingWithSplash(splashUrl);

    await handleFormSubmit();
  });
}

function addGearChip(gearName) {
  const container = document.getElementById('gearContainer');

  // Remove placeholder if present
  const placeholder = container.querySelector('span[style]');
  if (placeholder) {
    placeholder.remove();
  }

  // Check if gear already exists
  const existingGear = Array.from(container.querySelectorAll('.gear-chip'))
    .find(chip => chip.textContent.replace('×', '').trim() === gearName);

  if (existingGear) {
    alert('This item is already in your gear list.');
    return;
  }

  const chip = document.createElement('div');
  chip.className = 'gear-chip';
  chip.innerHTML = `
    ${gearName}
    <span class="remove-gear" data-gear="${gearName}">×</span>
  `;

  chip.querySelector('.remove-gear').addEventListener('click', () => {
    chip.remove();

    // Add placeholder back if no gear left
    if (container.querySelectorAll('.gear-chip').length === 0) {
      container.innerHTML = '<span style="color: #999; font-style: italic;">No gear items</span>';
    }
  });

  container.appendChild(chip);
}

async function handleFormSubmit() {
  const form = document.getElementById('editTrainerForm');
  const trainerDataStr = sessionStorage.getItem('trainerData');
  const trainerData = JSON.parse(trainerDataStr);

  const originalLevel = parseInt(trainerData[2], 10);

  try {
    // Gather form data
    const level = parseInt(form.level.value);
    const str = parseInt(form.str.value);
    const dex = parseInt(form.dex.value);
    const con = parseInt(form.con.value);
    const int = parseInt(form.int.value);
    const wis = parseInt(form.wis.value);
    const cha = parseInt(form.cha.value);
    const ac = parseInt(form.ac.value);
    const leaguePoints = parseInt(form.leaguePoints.value);

    // Get selected skills
    const selectedSkills = Array.from(form.querySelectorAll('input[name="skills"]:checked'))
      .map(cb => cb.value);

    // Get selected feats
    const selectedFeats = Array.from(form.querySelectorAll('input[name="feats"]:checked'))
      .map(cb => cb.value);

    // Get gear items
    const gearItems = Array.from(document.querySelectorAll('.gear-chip'))
      .map(chip => chip.textContent.replace('×', '').trim());

    // Update trainer data array
    trainerData[2] = level;
    trainerData[5] = str;
    trainerData[6] = dex;
    trainerData[7] = con;
    trainerData[8] = int;
    trainerData[9] = wis;
    trainerData[10] = cha;
    trainerData[13] = ac;
    trainerData[21] = leaguePoints;
    trainerData[18] = selectedSkills.length > 0 ? selectedSkills.join(', ') : '';
    trainerData[33] = selectedFeats.length > 0 ? selectedFeats.join(', ') : '';
    trainerData[37] = gearItems.length > 0 ? gearItems.join(', ') : 'None';

    // Calculate modifiers (D&D 5e rules)
    const oldWisModifier = trainerData[31] || 0;
    trainerData[27] = Math.floor((str - 10) / 2);  // STR modifier
    trainerData[28] = Math.floor((dex - 10) / 2);  // DEX modifier
    trainerData[29] = Math.floor((con - 10) / 2);  // CON modifier
    trainerData[30] = Math.floor((int - 10) / 2);  // INT modifier
    trainerData[31] = Math.floor((wis - 10) / 2);  // WIS modifier
    trainerData[32] = Math.floor((cha - 10) / 2);  // CHA modifier

    // Recalculate Battle Dice if WIS modifier changed for Ace Trainer
    const trainerPath = trainerData[25] || '';
    const newWisModifier = trainerData[31];
    if (trainerPath === 'Ace Trainer' && level >= 5 && oldWisModifier !== newWisModifier) {
      const battleDiceData = trainerData[45] || '';
      let oldMax = 1 + oldWisModifier;
      let oldCurrent = oldMax;

      // Parse existing battle dice format "max - current"
      if (battleDiceData) {
        const parts = battleDiceData.split('-').map(p => p.trim());
        if (parts.length === 2) {
          oldMax = parseInt(parts[0], 10) || oldMax;
          oldCurrent = parseInt(parts[1], 10) || oldCurrent;
        }
      }

      // Calculate how many were used
      const used = oldMax - oldCurrent;

      // Calculate new max and current
      const newMax = 1 + newWisModifier;
      const newCurrent = Math.max(0, newMax - used); // Ensure not negative

      // Update battle dice
      trainerData[45] = `${newMax} - ${newCurrent}`;

      console.log(`Battle Dice updated: ${oldMax} - ${oldCurrent} -> ${newMax} - ${newCurrent}`);
    }

    // Update session storage IMMEDIATELY
    sessionStorage.setItem('trainerData', JSON.stringify(trainerData));

    // Hide loading screen
    hideLoading();

    // Play level up sound if level changed
    if (level !== originalLevel) {
      await audioManager.playSfxAndWait('LevelUp');
    }

    // Navigate back to trainer info
    window.dispatchEvent(new CustomEvent('navigate', {
      detail: { route: 'trainer-info' }
    }));

    // Update database in background (don't wait)
    TrainerAPI.update(trainerData).catch(error => {
      console.error('Error updating Trainer in database:', error);
      showError('Failed to save Trainer changes to database');
    });

  } catch (error) {
    console.error('Error updating trainer:', error);
    hideLoading();
    showError('Failed to update trainer data');

    // Reload the form
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('navigate', {
        detail: { route: 'edit-trainer' }
      }));
    }, 2000);
  }
}
