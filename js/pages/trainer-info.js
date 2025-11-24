// Trainer Info Page - Detailed Trainer Information Display

export function renderTrainerInfo() {
  // Load trainer data from session storage
  const trainerDataStr = sessionStorage.getItem('trainerData');
  if (!trainerDataStr) {
    return '<div class="error">No trainer data found. Please return to the home page.</div>';
  }

  const trainerData = JSON.parse(trainerDataStr);

  // Extract trainer info
  const trainerImage = trainerData[0] || 'assets/Pokeball.png';
  const trainerName = trainerData[1] || 'Unknown Trainer';
  const trainerLevel = trainerData[2] || 1;
  const trainerHD = trainerData[3] || 0;
  const trainerVD = trainerData[4] || 0;
  const trainerSTR = trainerData[5] || 10;
  const trainerDEX = trainerData[6] || 10;
  const trainerCON = trainerData[7] || 10;
  const trainerINT = trainerData[8] || 10;
  const trainerWIS = trainerData[9] || 10;
  const trainerCHA = trainerData[10] || 10;
  const trainerHP = trainerData[11] || 0;
  const trainerVP = trainerData[12] || 0;
  const trainerAC = trainerData[13] || 10;
  const trainerSpeed = trainerData[14] || 30;
  const trainerSavingThrows = trainerData[15] || 'None';
  const trainerInitiative = trainerData[16] || 0;
  const trainerProficiency = trainerData[17] || 2;
  const trainerSkills = trainerData[18] || '';
  const trainerMoney = trainerData[19] || 0;
  const trainerLeaguePoints = trainerData[21] || 0;
  const strModifier = trainerData[27] || 0;
  const dexModifier = trainerData[28] || 0;
  const conModifier = trainerData[29] || 0;
  const intModifier = trainerData[30] || 0;
  const wisModifier = trainerData[31] || 0;
  const chaModifier = trainerData[32] || 0;
  const trainerFeats = trainerData[33] || 'None';
  const currentHP = trainerData[34] || trainerHP;
  const currentVP = trainerData[35] || trainerVP;
  const currentAC = trainerData[36] || trainerAC;
  const gear = trainerData[37] || 'None';

  // Parse skills (comma-separated string)
  const skillsArray = trainerSkills ? trainerSkills.split(',').map(s => s.trim()).filter(s => s) : [];

  const html = `
    <div class="trainer-info-page">
      <style>
        body, .content {
          background: linear-gradient(to bottom, #f44336 80%, #ffffff 20%);
        }

        .trainer-info-page {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 2rem 1rem;
          min-height: 80vh;
        }

        .trainer-info-page h1 {
          color: white;
          margin-bottom: 2rem;
          font-size: 2.5rem;
        }

        .trainer-info-container {
          display: grid;
          grid-template-columns: 350px 1fr;
          gap: 2rem;
          width: 100%;
          max-width: 1200px;
          margin-bottom: 2rem;
        }

        .trainer-image-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 350px;
        }

        .trainer-image-container img {
          width: 350px;
          height: 350px;
          border-radius: 10px;
          object-fit: cover;
          border: 4px solid #333;
          box-shadow: 0 4px 10px rgba(0,0,0,0.3);
        }

        .trainer-details-container {
          background: white;
          border-radius: 15px;
          padding: 2rem;
          box-shadow: 0 4px 10px rgba(0,0,0,0.2);
        }

        .stat-main-container {
          display: flex;
          justify-content: space-around;
          gap: 1rem;
          margin-bottom: 2rem;
        }

        .stat-box-wrapper {
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .stat-label-box {
          font-weight: bold;
          color: black;
          font-size: 1.2rem;
          margin-bottom: 0.5rem;
        }

        .stat-box {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 80px;
          height: 80px;
          background-color: #f44336;
          color: black;
          border-radius: 10px;
          border: 3px solid black;
          font-size: 2rem;
          font-weight: 700;
          box-shadow: 3px 3px 0 #000;
        }

        .ability-container {
          display: grid;
          grid-template-columns: repeat(6, 1fr);
          gap: 1rem;
          margin-bottom: 2rem;
        }

        .ability-group {
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .ability-label {
          font-weight: bold;
          font-size: 1rem;
          margin-bottom: 0.5rem;
        }

        .ability-box {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 60px;
          height: 60px;
          background-color: #f44336;
          color: black;
          border-radius: 10px;
          border: 3px solid black;
          font-size: 1.8rem;
          box-shadow: 3px 3px 0 #000;
        }

        .modifier-box {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 50px;
          height: 50px;
          background-color: #f44336;
          color: white;
          border-radius: 10px;
          border: 3px solid black;
          font-size: 1.6rem;
          font-weight: 900;
          box-shadow: 3px 3px 0 #000;
          margin-top: -10px;
        }

        .stat-item {
          display: flex;
          justify-content: space-between;
          padding: 0.5rem 0;
          border-bottom: 1px solid #ddd;
          font-size: 1.3rem;
        }

        .stat-label {
          font-weight: bold;
          color: #333;
        }

        .stat-value {
          color: #666;
        }

        .skills-container {
          margin-top: 2rem;
        }

        .skills-container h3 {
          margin-bottom: 1rem;
          color: #333;
        }

        .skills-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 1rem;
          border: 2px solid #333;
          padding: 1rem;
          border-radius: 5px;
        }

        .skill-item {
          padding: 0.75rem;
          border: 1px solid #333;
          border-radius: 5px;
          text-align: center;
          background: #f5f5f5;
          font-size: 1.1rem;
        }

        .button-container {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 1rem;
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

        #editTrainerButton {
          background-color: gray;
          color: white;
        }

        #editTrainerButton:hover {
          background-color: darkgray;
        }

        #backButton {
          background-color: #f44336;
          color: white;
        }

        #backButton:hover {
          background-color: #d32f2f;
        }

        @media (max-width: 768px) {
          .trainer-info-container {
            grid-template-columns: 1fr;
          }

          .trainer-image-container {
            width: 100%;
          }

          .trainer-image-container img {
            width: 100%;
            height: auto;
          }

          .ability-container {
            grid-template-columns: repeat(3, 1fr);
          }

          .skills-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }
      </style>

      <h1>Trainer Information</h1>

      <div class="trainer-info-container">
        <!-- Trainer Image -->
        <div class="trainer-image-container">
          <img id="trainerImage" src="${trainerImage}" alt="${trainerName}" onerror="this.src='assets/Pokeball.png'">
        </div>

        <!-- Trainer Details -->
        <div class="trainer-details-container">
          <h2 style="margin-top: 0; margin-bottom: 1.5rem; color: #333;">${trainerName}</h2>

          <!-- AC, HP, VP Stats -->
          <div class="stat-main-container">
            <div class="stat-box-wrapper">
              <div class="stat-label-box">AC</div>
              <div class="stat-box" id="trainerAC">${trainerAC}</div>
            </div>
            <div class="stat-box-wrapper">
              <div class="stat-label-box">HP</div>
              <div class="stat-box" id="trainerHP">${trainerHP}</div>
            </div>
            <div class="stat-box-wrapper">
              <div class="stat-label-box">VP</div>
              <div class="stat-box" id="trainerVP">${trainerVP}</div>
            </div>
          </div>

          <!-- Ability Scores and Modifiers -->
          <div class="ability-container">
            <div class="ability-group">
              <div class="ability-label">STR</div>
              <div class="ability-box">${trainerSTR}</div>
              <div class="modifier-box">${strModifier >= 0 ? '+' : ''}${strModifier}</div>
            </div>
            <div class="ability-group">
              <div class="ability-label">DEX</div>
              <div class="ability-box">${trainerDEX}</div>
              <div class="modifier-box">${dexModifier >= 0 ? '+' : ''}${dexModifier}</div>
            </div>
            <div class="ability-group">
              <div class="ability-label">CON</div>
              <div class="ability-box">${trainerCON}</div>
              <div class="modifier-box">${conModifier >= 0 ? '+' : ''}${conModifier}</div>
            </div>
            <div class="ability-group">
              <div class="ability-label">INT</div>
              <div class="ability-box">${trainerINT}</div>
              <div class="modifier-box">${intModifier >= 0 ? '+' : ''}${intModifier}</div>
            </div>
            <div class="ability-group">
              <div class="ability-label">WIS</div>
              <div class="ability-box">${trainerWIS}</div>
              <div class="modifier-box">${wisModifier >= 0 ? '+' : ''}${wisModifier}</div>
            </div>
            <div class="ability-group">
              <div class="ability-label">CHA</div>
              <div class="ability-box">${trainerCHA}</div>
              <div class="modifier-box">${chaModifier >= 0 ? '+' : ''}${chaModifier}</div>
            </div>
          </div>

          <!-- Other Stats -->
          <div class="stat-item">
            <span class="stat-label">Level:</span>
            <span class="stat-value">${trainerLevel}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Money:</span>
            <span class="stat-value">₽${trainerMoney}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">League Points:</span>
            <span class="stat-value">${trainerLeaguePoints}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Hit Dice:</span>
            <span class="stat-value">${trainerHD}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Vitality Dice:</span>
            <span class="stat-value">${trainerVD}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Speed:</span>
            <span class="stat-value">${trainerSpeed} ft</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Initiative:</span>
            <span class="stat-value">${trainerInitiative >= 0 ? '+' : ''}${trainerInitiative}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Proficiency:</span>
            <span class="stat-value">+${trainerProficiency}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Saving Throws:</span>
            <span class="stat-value">${trainerSavingThrows}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Current HP:</span>
            <span class="stat-value">${currentHP}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Current VP:</span>
            <span class="stat-value">${currentVP}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Current AC:</span>
            <span class="stat-value">${currentAC}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Feats:</span>
            <span class="stat-value">${trainerFeats}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Gear:</span>
            <span class="stat-value">${gear}</span>
          </div>

          <!-- Skills Section -->
          ${skillsArray.length > 0 ? `
            <div class="skills-container">
              <h3>Skills</h3>
              <div class="skills-grid">
                ${skillsArray.map(skill => `
                  <div class="skill-item">${skill}</div>
                `).join('')}
              </div>
            </div>
          ` : ''}

          <!-- Buttons -->
          <div class="button-container">
            <button class="button" id="editTrainerButton">Edit Trainer</button>
            <button class="button" id="backButton">Back</button>
          </div>
        </div>
      </div>
    </div>
  `;

  return html;
}

export function attachTrainerInfoListeners() {
  // Edit Trainer button
  document.getElementById('editTrainerButton')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('navigate', {
      detail: { route: 'edit-trainer' }
    }));
  });

  // Back button
  document.getElementById('backButton')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('navigate', {
      detail: { route: 'trainer-card' }
    }));
  });
}
