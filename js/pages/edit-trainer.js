// Edit Trainer Page - Form for editing trainer stats

import { TrainerAPI } from '../api.js';
import { showToast, showSuccess, showError } from '../utils/notifications.js';

export function renderEditTrainer() {
  // Load trainer data from session storage
  const trainerDataStr = sessionStorage.getItem('trainerData');
  if (!trainerDataStr) {
    return '<div class="error">No trainer data found. Please return to the home page.</div>';
  }

  const trainerData = JSON.parse(trainerDataStr);
  const skillsData = JSON.parse(sessionStorage.getItem('skills') || '{"skills": []}');
  const trainerFeatsData = JSON.parse(sessionStorage.getItem('trainerFeats') || '{"trainerFeats": []}');

  // Extract trainer info
  const trainerLevel = trainerData[2] || 1;
  const trainerSTR = trainerData[5] || 10;
  const trainerDEX = trainerData[6] || 10;
  const trainerCON = trainerData[7] || 10;
  const trainerINT = trainerData[8] || 10;
  const trainerWIS = trainerData[9] || 10;
  const trainerCHA = trainerData[10] || 10;
  const trainerAC = trainerData[13] || 10;
  const trainerLeaguePoints = trainerData[21] || 0;
  const trainerSkills = trainerData[18] || '';
  const trainerFeats = trainerData[33] || '';
  const gear = trainerData[37] || '';

  const selectedSkills = trainerSkills ? trainerSkills.split(',').map(s => s.trim()) : [];
  const selectedFeats = trainerFeats ? trainerFeats.split(',').map(s => s.trim()) : [];
  const gearArray = gear ? gear.split(',').map(g => g.trim()).filter(g => g && g !== 'None') : [];

  const html = `
    <div class="edit-trainer-page">
      <style>
        body, .content {
          background: linear-gradient(to bottom, #f44336 80%, #ffffff 20%);
        }

        .edit-trainer-page {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 2rem 1rem;
          min-height: 80vh;
        }

        .edit-trainer-page h1 {
          color: white;
          margin-bottom: 2rem;
          font-size: 2.5rem;
        }

        .form-container {
          width: 100%;
          max-width: 600px;
          background-color: white;
          padding: 2.5rem;
          border-radius: 10px;
          box-shadow: 0 4px 10px rgba(0,0,0,0.2);
          margin-bottom: 2rem;
          max-height: 70vh;
          overflow-y: auto;
        }

        .form-group {
          margin-bottom: 1.5rem;
        }

        .form-group label {
          display: block;
          font-weight: bold;
          font-size: 1.3rem;
          margin-bottom: 0.5rem;
          color: #333;
        }

        .form-group input[type="number"],
        .form-group input[type="text"],
        .form-group textarea {
          width: 100%;
          padding: 0.75rem;
          font-size: 1.1rem;
          border: 2px solid #ccc;
          border-radius: 5px;
          box-sizing: border-box;
        }

        .form-group input[type="number"]:focus,
        .form-group input[type="text"]:focus,
        .form-group textarea:focus {
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

        .gear-container {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          margin-bottom: 1rem;
        }

        .gear-chip {
          display: inline-flex;
          align-items: center;
          padding: 0.5rem 1rem;
          background-color: #f44336;
          color: white;
          border-radius: 15px;
          font-size: 1rem;
        }

        .gear-chip span {
          margin-left: 0.75rem;
          font-weight: bold;
          cursor: pointer;
          font-size: 1.2rem;
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
              ${(skillsData.skills || []).map(skill => `
                <div class="checkbox-item">
                  <input type="checkbox" id="skill_${skill.name.replace(/\s+/g, '_')}" name="skills" value="${skill.name}" ${selectedSkills.includes(skill.name) ? 'checked' : ''} />
                  <label for="skill_${skill.name.replace(/\s+/g, '_')}">${skill.name}</label>
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
              ${(trainerFeatsData.trainerFeats || []).map(feat => `
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
              ${gearArray.map(g => `
                <div class="gear-chip">
                  ${g}
                  <span class="remove-gear" data-gear="${g}">×</span>
                </div>
              `).join('')}
            </div>
            <input type="text" id="gearInput" placeholder="Add gear and press Enter" />
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

  // Gear input - add gear on Enter
  const gearInput = document.getElementById('gearInput');
  gearInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const gearValue = gearInput.value.trim();
      if (gearValue) {
        addGearChip(gearValue);
        gearInput.value = '';
      }
    }
  });

  // Remove gear chip
  document.querySelectorAll('.remove-gear').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.target.closest('.gear-chip').remove();
    });
  });

  // Cancel button
  document.getElementById('cancelButton')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('navigate', {
      detail: { route: 'trainer-info' }
    }));
  });

  // Form submission
  document.getElementById('editTrainerForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await handleFormSubmit();
  });
}

function addGearChip(gearName) {
  const container = document.getElementById('gearContainer');
  const chip = document.createElement('div');
  chip.className = 'gear-chip';
  chip.innerHTML = `
    ${gearName}
    <span class="remove-gear" data-gear="${gearName}">×</span>
  `;

  chip.querySelector('.remove-gear').addEventListener('click', () => {
    chip.remove();
  });

  container.appendChild(chip);
}

async function handleFormSubmit() {
  const form = document.getElementById('editTrainerForm');
  const trainerDataStr = sessionStorage.getItem('trainerData');
  const trainerData = JSON.parse(trainerDataStr);

  // Show loading
  document.getElementById('content').innerHTML = '<div class="loading">Saving changes...</div>';

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
    trainerData[18] = selectedSkills.join(', ');
    trainerData[33] = selectedFeats.join(', ');
    trainerData[37] = gearItems.length > 0 ? gearItems.join(', ') : 'None';

    // Calculate modifiers (simple calculation based on D&D rules)
    trainerData[27] = Math.floor((str - 10) / 2);  // STR modifier
    trainerData[28] = Math.floor((dex - 10) / 2);  // DEX modifier
    trainerData[29] = Math.floor((con - 10) / 2);  // CON modifier
    trainerData[30] = Math.floor((int - 10) / 2);  // INT modifier
    trainerData[31] = Math.floor((wis - 10) / 2);  // WIS modifier
    trainerData[32] = Math.floor((cha - 10) / 2);  // CHA modifier

    // Update session storage
    sessionStorage.setItem('trainerData', JSON.stringify(trainerData));

    // Send to API
    await TrainerAPI.update(trainerData);

    // Show success message
    showSuccess(`${trainerData[1]}'s info is updated!`);

    // Navigate back to trainer info
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('navigate', {
        detail: { route: 'trainer-info' }
      }));
    }, 1000);

  } catch (error) {
    console.error('Error updating trainer:', error);
    showError('Failed to update trainer data');

    // Reload the form
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('navigate', {
        detail: { route: 'edit-trainer' }
      }));
    }, 2000);
  }
}
