// New Journey Page - Create new trainer form

import { TrainerAPI } from '../api.js';
import { showSuccess, showError } from '../utils/notifications.js';

export function renderNewJourney() {
  const html = `
    <div class="new-journey-page">
      <style>
        body, .content {
          background: linear-gradient(135deg, #EE1515 0%, #C91010 50%, #A00808 100%);
          min-height: 100vh;
        }

        .new-journey-page {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 2vh 1vw;
          min-height: 85vh;
        }

        .new-journey-page h1 {
          color: white;
          margin-bottom: 2vh;
          font-size: clamp(2rem, 4vw, 3rem);
          font-weight: 900;
          letter-spacing: clamp(0.5px, 0.1vw, 1px);
          text-shadow: 0 clamp(2px, 0.4vh, 4px) clamp(5px, 1vh, 10px) rgba(0,0,0,0.5),
                       0 0 clamp(10px, 2vw, 20px) rgba(255,222,0,0.3);
        }

        .form-container {
          width: 90%;
          max-width: clamp(400px, 65vw, 650px);
          background: linear-gradient(135deg, #FFFFFF 0%, #F8F8F8 100%);
          border: clamp(2px, 0.4vw, 4px) solid #FFDE00;
          padding: clamp(1.5rem, 2.5vh, 2.5rem);
          border-radius: clamp(15px, 2.5vw, 25px);
          box-shadow: 0 clamp(8px, 1.5vh, 15px) clamp(20px, 4vh, 40px) rgba(0,0,0,0.4),
                      inset 0 clamp(-2px, -0.4vh, -4px) 0 rgba(0,0,0,0.05);
          max-height: 70vh;
          overflow-y: auto;
        }

        .form-group {
          margin-bottom: clamp(1rem, 1.5vh, 1.5rem);
        }

        .form-group label {
          display: block;
          font-weight: bold;
          font-size: clamp(0.95rem, 1.5vw, 1.1rem);
          margin-bottom: clamp(0.3rem, 0.5vh, 0.5rem);
          color: #333;
        }

        .form-group input,
        .form-group select {
          width: 100%;
          padding: clamp(0.5rem, 0.75vh, 0.75rem);
          font-size: clamp(0.9rem, 1.4vw, 1rem);
          border: clamp(1px, 0.2vw, 2px) solid #ccc;
          border-radius: clamp(3px, 0.5vw, 5px);
          box-sizing: border-box;
        }

        .form-group input:focus,
        .form-group select:focus {
          border-color: #f44336;
          outline: none;
        }

        .skills-section {
          max-height: clamp(150px, 20vh, 200px);
          overflow-y: auto;
          border: clamp(1px, 0.1vw, 1px) solid #ccc;
          border-radius: clamp(3px, 0.5vw, 5px);
          padding: clamp(0.75rem, 1vh, 1rem);
        }

        .skill-item {
          display: flex;
          align-items: center;
          margin-bottom: clamp(0.3rem, 0.5vh, 0.5rem);
        }

        .skill-item input[type="checkbox"] {
          margin-right: clamp(0.3rem, 0.5vw, 0.5rem);
          transform: scale(clamp(1.0, 1.5vw, 1.2));
        }

        .skill-item label {
          font-size: clamp(0.85rem, 1.3vw, 0.95rem);
          margin: 0;
        }

        .button-group {
          display: flex;
          gap: clamp(0.75rem, 1vw, 1rem);
          justify-content: center;
          margin-top: 2vh;
        }

        .button {
          padding: clamp(0.75rem, 1vh, 1rem) clamp(1.5rem, 2vw, 2rem);
          border: clamp(2px, 0.3vw, 3px) solid #FFDE00;
          border-radius: clamp(10px, 1.5vw, 15px);
          font-size: clamp(1rem, 1.6vw, 1.2rem);
          font-weight: 900;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 clamp(3px, 0.5vh, 5px) clamp(10px, 1.5vh, 15px) rgba(0,0,0,0.2);
        }

        .button-primary {
          background: linear-gradient(135deg, #4CAF50 0%, #45A049 100%);
          color: white;
        }

        .button-primary:hover {
          transform: translateY(clamp(-2px, -0.3vh, -3px));
          box-shadow: 0 clamp(5px, 0.8vh, 8px) clamp(15px, 2vh, 20px) rgba(76,175,80,0.5),
                      0 0 clamp(15px, 2vw, 20px) rgba(255,222,0,0.5);
          border-color: #FFC700;
        }

        .button-secondary {
          background: linear-gradient(135deg, #EE1515 0%, #C91010 100%);
          color: white;
        }

        .button-secondary:hover {
          transform: translateY(clamp(-2px, -0.3vh, -3px));
          box-shadow: 0 clamp(5px, 0.8vh, 8px) clamp(15px, 2vh, 20px) rgba(238,21,21,0.5),
                      0 0 clamp(15px, 2vw, 20px) rgba(255,222,0,0.5);
          border-color: #FFC700;
        }

        .stats-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: clamp(0.75rem, 1vw, 1rem);
        }

        @media (max-width: 1024px) {
          .stats-grid {
            gap: clamp(0.6rem, 0.9vw, 0.9rem);
          }
        }

        @media (max-width: 768px) {
          .stats-grid {
            gap: clamp(0.5rem, 0.8vw, 0.8rem);
          }
        }

        @media (max-width: 600px) {
          .stats-grid {
            grid-template-columns: 1fr;
            gap: clamp(0.75rem, 1vw, 1rem);
          }
        }

        @media (max-width: 480px) {
          .button-group {
            flex-direction: column;
          }

          .button {
            width: 100%;
          }
        }

        @media (max-width: 360px) {
          .form-container {
            padding: clamp(1rem, 2vh, 1.5rem);
          }
        }
      </style>

      <h1>New Journey</h1>

      <div class="form-container">
        <form id="newTrainerForm">
          <div class="form-group">
            <label for="name">Name</label>
            <input type="text" id="name" name="name" required />
          </div>

          <div class="form-group">
            <label for="nationality">Nationality</label>
            <select id="nationality" name="nationality" required>
              <option value="Shima">Shima</option>
              <option value="Kanto">Kanto</option>
              <option value="Johto">Johto</option>
              <option value="Hoenn">Hoenn</option>
              <option value="Orre">Orre</option>
              <option value="Sinnoh">Sinnoh</option>
              <option value="Unova">Unova</option>
              <option value="Kalos">Kalos</option>
              <option value="Alola">Alola</option>
              <option value="Galar">Galar</option>
            </select>
          </div>

          <div class="stats-grid">
            <div class="form-group">
              <label for="level">Level</label>
              <input type="number" id="level" name="level" value="1" min="1" required />
            </div>

            <div class="form-group">
              <label for="ac">AC</label>
              <input type="number" id="ac" name="ac" value="10" required />
            </div>

            <div class="form-group">
              <label for="hitDice">Hit Dice</label>
              <input type="number" id="hitDice" name="hitDice" value="1" min="1" required />
            </div>

            <div class="form-group">
              <label for="vitalityDice">Vitality Dice</label>
              <input type="number" id="vitalityDice" name="vitalityDice" value="1" min="1" required />
            </div>
          </div>

          <div class="stats-grid">
            <div class="form-group">
              <label for="strength">STR</label>
              <input type="number" id="strength" name="strength" value="10" required />
            </div>

            <div class="form-group">
              <label for="dexterity">DEX</label>
              <input type="number" id="dexterity" name="dexterity" value="10" required />
            </div>

            <div class="form-group">
              <label for="constitution">CON</label>
              <input type="number" id="constitution" name="constitution" value="10" required />
            </div>

            <div class="form-group">
              <label for="intelligence">INT</label>
              <input type="number" id="intelligence" name="intelligence" value="10" required />
            </div>

            <div class="form-group">
              <label for="wisdom">WIS</label>
              <input type="number" id="wisdom" name="wisdom" value="10" required />
            </div>

            <div class="form-group">
              <label for="charisma">CHA</label>
              <input type="number" id="charisma" name="charisma" value="10" required />
            </div>
          </div>

          <div class="form-group">
            <label for="walkingSpeed">Walking Speed</label>
            <input type="number" id="walkingSpeed" name="walkingSpeed" value="30" required />
          </div>

          <div class="form-group">
            <label for="savingThrows">Saving Throws</label>
            <select id="savingThrows" name="savingThrows" required>
              <option value="Strength">Strength</option>
              <option value="Dexterity">Dexterity</option>
              <option value="Constitution">Constitution</option>
              <option value="Intelligence">Intelligence</option>
              <option value="Wisdom">Wisdom</option>
              <option value="Charisma">Charisma</option>
            </select>
          </div>

          <div class="form-group">
            <label>Skills</label>
            <div class="skills-section">
              <div class="skill-item">
                <input type="checkbox" id="athletics" name="skills" value="Athletics" />
                <label for="athletics">Athletics (STR)</label>
              </div>
              <div class="skill-item">
                <input type="checkbox" id="acrobatics" name="skills" value="Acrobatics" />
                <label for="acrobatics">Acrobatics (DEX)</label>
              </div>
              <div class="skill-item">
                <input type="checkbox" id="sleightOfHand" name="skills" value="Sleight of Hand" />
                <label for="sleightOfHand">Sleight of Hand (DEX)</label>
              </div>
              <div class="skill-item">
                <input type="checkbox" id="stealth" name="skills" value="Stealth" />
                <label for="stealth">Stealth (DEX)</label>
              </div>
              <div class="skill-item">
                <input type="checkbox" id="arcana" name="skills" value="Arcana" />
                <label for="arcana">Arcana (INT)</label>
              </div>
              <div class="skill-item">
                <input type="checkbox" id="history" name="skills" value="History" />
                <label for="history">History (INT)</label>
              </div>
              <div class="skill-item">
                <input type="checkbox" id="investigation" name="skills" value="Investigation" />
                <label for="investigation">Investigation (INT)</label>
              </div>
              <div class="skill-item">
                <input type="checkbox" id="nature" name="skills" value="Nature" />
                <label for="nature">Nature (INT)</label>
              </div>
              <div class="skill-item">
                <input type="checkbox" id="religion" name="skills" value="Religion" />
                <label for="religion">Religion (INT)</label>
              </div>
              <div class="skill-item">
                <input type="checkbox" id="animalHandling" name="skills" value="Animal Handling" />
                <label for="animalHandling">Animal Handling (WIS)</label>
              </div>
              <div class="skill-item">
                <input type="checkbox" id="insight" name="skills" value="Insight" />
                <label for="insight">Insight (WIS)</label>
              </div>
              <div class="skill-item">
                <input type="checkbox" id="medicine" name="skills" value="Medicine" />
                <label for="medicine">Medicine (WIS)</label>
              </div>
              <div class="skill-item">
                <input type="checkbox" id="perception" name="skills" value="Perception" />
                <label for="perception">Perception (WIS)</label>
              </div>
              <div class="skill-item">
                <input type="checkbox" id="survival" name="skills" value="Survival" />
                <label for="survival">Survival (WIS)</label>
              </div>
              <div class="skill-item">
                <input type="checkbox" id="deception" name="skills" value="Deception" />
                <label for="deception">Deception (CHA)</label>
              </div>
              <div class="skill-item">
                <input type="checkbox" id="intimidation" name="skills" value="Intimidation" />
                <label for="intimidation">Intimidation (CHA)</label>
              </div>
              <div class="skill-item">
                <input type="checkbox" id="performance" name="skills" value="Performance" />
                <label for="performance">Performance (CHA)</label>
              </div>
              <div class="skill-item">
                <input type="checkbox" id="persuasion" name="skills" value="Persuasion" />
                <label for="persuasion">Persuasion (CHA)</label>
              </div>
            </div>
          </div>

          <div class="stats-grid">
            <div class="form-group">
              <label for="money">Money</label>
              <input type="number" id="money" name="money" value="0" min="0" required />
            </div>

            <div class="form-group">
              <label for="leaguePoints">League Points</label>
              <input type="number" id="leaguePoints" name="leaguePoints" value="0" min="0" required />
            </div>
          </div>

          <div class="form-group">
            <label for="pinCode">PIN Code (4 digits)</label>
            <input type="text" id="pinCode" name="pinCode" maxlength="4" pattern="[0-9]{4}" required />
          </div>

          <div class="form-group">
            <label for="trainerClass">Trainer Class</label>
            <select id="trainerClass" name="trainerClass" required>
              <option value="Pokemon Trainer">Pokemon Trainer</option>
              <option value="Conduit">Conduit</option>
            </select>
          </div>

          <div class="button-group">
            <button type="submit" class="button button-primary">Create Trainer</button>
            <button type="button" class="button button-secondary" id="cancelBtn">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `;

  return html;
}

export function attachNewJourneyListeners() {
  // Cancel button
  document.getElementById('cancelBtn')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('navigate', {
      detail: { route: 'index' }
    }));
  });

  // Form submission
  document.getElementById('newTrainerForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await handleFormSubmit();
  });
}

async function handleFormSubmit() {
  const form = document.getElementById('newTrainerForm');

  // Validate PIN code
  const pinCode = form.pinCode.value;
  if (!/^\d{4}$/.test(pinCode)) {
    showError('PIN Code must be exactly 4 digits');
    return;
  }

  // Show loading
  document.getElementById('content').innerHTML = '<div class="loading">Creating trainer...</div>';

  try {
    // Gather form data
    const formData = new FormData(form);
    const data = {};

    formData.forEach((value, key) => {
      if (key === 'skills') {
        if (!data[key]) {
          data[key] = [];
        }
        data[key].push(value);
      } else {
        data[key] = value;
      }
    });

    // Get trainer image
    const imageUrl = await getTrainerImage(data.name);
    data.image = imageUrl;

    // Create trainer via API
    const response = await TrainerAPI.create(data);

    if (response.status === 'success') {
      // Store trainer data in session
      sessionStorage.setItem('trainerData', JSON.stringify(response.rowData));

      showSuccess('Trainer created successfully!');

      // Navigate to continue journey
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('navigate', {
          detail: { route: 'continue-journey' }
        }));
      }, 2000);
    } else {
      showError(response.message || 'Failed to create trainer');
      // Reload form
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('navigate', {
          detail: { route: 'new-journey' }
        }));
      }, 2000);
    }
  } catch (error) {
    console.error('Error creating trainer:', error);
    showError('Failed to create trainer');
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('navigate', {
        detail: { route: 'new-journey' }
      }));
    }, 2000);
  }
}

async function getTrainerImage(trainerName) {
  const IMAGE_BASE_URL = 'https://raw.githubusercontent.com/Benjakronk/shima-pokedex/main/images/';
  const IMAGE_FORMATS = ['png', 'jpg', 'jpeg', 'jfif'];

  const sanitizedName = trainerName.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  for (const format of IMAGE_FORMATS) {
    const url = `${IMAGE_BASE_URL}${sanitizedName}.${format}`;
    if (await imageExists(url)) {
      return url;
    }
  }

  return 'https://via.placeholder.com/100';
}

function imageExists(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}
