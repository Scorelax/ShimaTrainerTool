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
  const inventory = trainerData[20] || 'None';
  const affinity = trainerData[23] || 'None';
  const specialization = trainerData[24] || 'None';
  const trainerPath = trainerData[25] || 'None';

  // Parse skills (comma-separated string)
  const skillsArray = trainerSkills ? trainerSkills.split(',').map(s => s.trim()).filter(s => s) : [];

  // All skills list
  const allSkills = [
    "Athletics (STR)", "Acrobatics (DEX)", "Sleight of Hand (DEX)", "Stealth (DEX)",
    "Arcana (INT)", "History (INT)", "Investigation (INT)", "Nature (INT)", "Religion (INT)",
    "Animal Handling (WIS)", "Insight (WIS)", "Medicine (WIS)", "Perception (WIS)",
    "Survival (WIS)", "Deception (CHA)", "Intimidation (CHA)", "Performance (CHA)", "Persuasion (CHA)"
  ];

  const html = `
    <div class="trainer-info-page">
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
          width: 100%;
          height: 100%;
          background-image:
            radial-gradient(circle, rgba(255, 255, 255, 0.03) 1px, transparent 1px),
            radial-gradient(circle, rgba(255, 255, 255, 0.03) 1px, transparent 1px);
          background-size: 50px 50px, 80px 80px;
          background-position: 0 0, 40px 40px;
          pointer-events: none;
          z-index: 0;
        }

        .trainer-info-page {
          display: grid;
          grid-template-columns: minmax(25%, 30%) 1fr;
          gap: clamp(2rem, 4vw, 4rem);
          padding: clamp(1rem, 2vh, 2rem) clamp(1rem, 2vw, 3rem);
          min-height: 85vh;
          position: relative;
          z-index: 1;
        }

        .trainer-info-page h1 {
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

        .left-column {
          display: flex;
          flex-direction: column;
          gap: clamp(1rem, 2vh, 1.5rem);
          padding-top: clamp(4rem, 8vh, 5rem);
        }

        .trainer-image-container {
          width: 100%;
          aspect-ratio: 1;
        }

        .trainer-image-container img {
          width: 100%;
          height: 100%;
          border-radius: clamp(15px, 3vw, 20px);
          object-fit: cover;
          border: clamp(3px, 0.6vw, 5px) solid #FFDE00;
          box-shadow: 0 clamp(8px, 2vh, 10px) clamp(25px, 5vw, 30px) rgba(0,0,0,0.5),
                      0 0 clamp(20px, 4vw, 30px) rgba(255,222,0,0.3);
        }

        .trainer-info-list {
          display: flex;
          flex-direction: column;
          gap: clamp(0.5rem, 1vh, 0.75rem);
        }

        .info-item {
          display: flex;
          justify-content: space-between;
          padding: clamp(0.4rem, 1vh, 0.6rem) clamp(0.6rem, 1.5vw, 1rem);
          background: linear-gradient(135deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.08) 100%);
          border: clamp(2px, 0.4vw, 3px) solid rgba(255,222,0,0.4);
          border-radius: clamp(8px, 1.5vw, 12px);
          font-size: clamp(0.9rem, 2vw, 1.1rem);
          font-weight: 700;
          color: white;
          text-shadow: 0 2px 4px rgba(0,0,0,0.6);
        }

        .info-item-label {
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: clamp(0.3px, 0.2vw, 0.5px);
        }

        .info-buttons-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: clamp(0.5rem, 1vh, 0.75rem);
        }

        .info-button {
          padding: clamp(0.6rem, 1.5vh, 0.9rem);
          background: linear-gradient(135deg, #3B4CCA 0%, #2E3FA0 100%);
          border: clamp(2px, 0.4vw, 3px) solid #FFDE00;
          border-radius: clamp(8px, 1.5vw, 12px);
          color: white;
          font-size: clamp(0.85rem, 1.8vw, 1rem);
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: clamp(0.3px, 0.2vw, 0.5px);
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 4px 10px rgba(0,0,0,0.3);
          text-shadow: 0 2px 4px rgba(0,0,0,0.4);
        }

        .info-button:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 15px rgba(0,0,0,0.4),
                      0 0 15px rgba(255,222,0,0.4);
          border-color: #FFC700;
        }

        .info-button:active {
          transform: translateY(0);
        }

        .right-column {
          display: flex;
          flex-direction: column;
          gap: clamp(1.5rem, 3vh, 2rem);
          padding-top: clamp(4rem, 8vh, 5rem);
        }

        /* Stats Row 1: AC, HP, VP - Larger boxes */
        .stat-main-container {
          display: flex;
          justify-content: center;
          gap: clamp(1rem, 3vw, 2rem);
          margin-bottom: clamp(1.5rem, 3vh, 2rem);
        }

        .stat-box-wrapper {
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .stat-label-box {
          font-weight: 900;
          color: white;
          font-size: clamp(1rem, 2.2vw, 1.4rem);
          margin-bottom: clamp(0.4rem, 1vh, 0.6rem);
          text-shadow: 0 2px 5px rgba(0,0,0,0.8);
          text-transform: uppercase;
          letter-spacing: clamp(0.5px, 0.4vw, 1.5px);
        }

        .stat-box {
          display: flex;
          align-items: center;
          justify-content: center;
          width: clamp(80px, 12vw, 110px);
          height: clamp(80px, 12vw, 110px);
          background: linear-gradient(135deg, #FFDE00 0%, #FFC700 100%);
          color: black;
          border-radius: clamp(12px, 2.5vw, 18px);
          border: clamp(3px, 0.6vw, 5px) solid #333;
          font-size: clamp(2rem, 4vw, 2.8rem);
          font-weight: 900;
          box-shadow: 0 8px 20px rgba(0,0,0,0.5),
                      inset 0 -4px 0 rgba(0,0,0,0.2);
        }

        /* Stats Row 2: STR, DEX, CON, INT, WIS, CHA - Smaller boxes with modifiers */
        .ability-container {
          display: grid;
          grid-template-columns: repeat(6, 1fr);
          gap: clamp(0.6rem, 2vw, 1rem);
          margin-bottom: clamp(1.5rem, 3vh, 2rem);
        }

        .ability-group {
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .ability-label {
          font-weight: 900;
          font-size: clamp(0.85rem, 1.8vw, 1.1rem);
          margin-bottom: clamp(0.3rem, 1vh, 0.5rem);
          color: white;
          text-shadow: 0 2px 5px rgba(0,0,0,0.8);
          text-transform: uppercase;
          letter-spacing: clamp(0.3px, 0.3vw, 0.8px);
        }

        .ability-box {
          display: flex;
          align-items: center;
          justify-content: center;
          width: clamp(50px, 9vw, 70px);
          height: clamp(50px, 9vw, 70px);
          background: linear-gradient(135deg, #FFDE00 0%, #FFC700 100%);
          color: black;
          border-radius: clamp(10px, 2vw, 15px);
          border: clamp(2px, 0.5vw, 4px) solid #333;
          font-size: clamp(1.4rem, 2.8vw, 2rem);
          font-weight: 900;
          box-shadow: 0 8px 20px rgba(0,0,0,0.5),
                      inset 0 -3px 0 rgba(0,0,0,0.2);
        }

        .modifier-box {
          display: flex;
          align-items: center;
          justify-content: center;
          width: clamp(42px, 7vw, 58px);
          height: clamp(42px, 7vw, 58px);
          background: linear-gradient(135deg, #EE1515 0%, #C91010 100%);
          color: white;
          border-radius: clamp(8px, 1.5vw, 12px);
          border: clamp(2px, 0.4vw, 3px) solid #333;
          font-size: clamp(1.2rem, 2.2vw, 1.7rem);
          font-weight: 900;
          box-shadow: 0 6px 15px rgba(0,0,0,0.5),
                      inset 0 -2px 0 rgba(0,0,0,0.3);
          margin-top: clamp(-10px, -1.2vh, -12px);
        }

        /* Skills Table */
        .skills-container {
          width: 100%;
        }

        .skills-container h3 {
          margin-bottom: clamp(0.75rem, 2vh, 1rem);
          color: white;
          text-shadow: 0 2px 5px rgba(0,0,0,0.8);
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: clamp(0.5px, 0.4vw, 1px);
          font-size: clamp(1.2rem, 2.5vw, 1.6rem);
        }

        .skills-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(clamp(140px, 20vw, 200px), 1fr));
          gap: clamp(0.5rem, 1.5vw, 0.8rem);
          border: clamp(3px, 0.6vw, 4px) solid #FFDE00;
          padding: clamp(0.75rem, 2vw, 1.2rem);
          border-radius: clamp(12px, 2.5vw, 18px);
          background: linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.05) 100%);
        }

        .skill-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: clamp(0.6rem, 1.5vw, 0.9rem);
          border: clamp(2px, 0.4vw, 3px) solid #333;
          border-radius: clamp(8px, 1.5vw, 12px);
          text-align: center;
          background: linear-gradient(135deg, rgba(100,100,100,0.4) 0%, rgba(80,80,80,0.4) 100%);
          font-size: clamp(0.85rem, 1.8vw, 1rem);
          font-weight: 700;
          color: rgba(255,255,255,0.5);
          box-shadow: 0 4px 10px rgba(0,0,0,0.3);
          transition: all 0.3s ease;
        }

        .skill-item.unlocked {
          background: linear-gradient(135deg, #FFDE00 0%, #FFC700 100%);
          color: black;
          border-color: #333;
          box-shadow: 0 6px 15px rgba(0,0,0,0.4),
                      0 0 10px rgba(255,222,0,0.5);
        }

        .skill-name {
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: clamp(0.3px, 0.2vw, 0.5px);
        }

        .skill-modifier {
          font-size: clamp(0.75rem, 1.5vw, 0.9rem);
          opacity: 0.8;
          margin-top: clamp(2px, 0.5vh, 4px);
        }

        #editTrainerButton {
          grid-column: 1 / -1;
          padding: clamp(0.75rem, 2vh, 1rem);
          background: linear-gradient(135deg, #757575 0%, #616161 100%);
          color: white;
          border: clamp(2px, 0.5vw, 3px) solid #FFDE00;
          border-radius: clamp(10px, 2vw, 15px);
          font-size: clamp(0.95rem, 2vw, 1.2rem);
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: clamp(0.5px, 0.3vw, 1px);
          cursor: pointer;
          box-shadow: 0 6px 15px rgba(0,0,0,0.3);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          text-shadow: 0 2px 4px rgba(0,0,0,0.4);
        }

        #editTrainerButton:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 20px rgba(0,0,0,0.4),
                      0 0 15px rgba(255,222,0,0.4);
          border-color: #FFC700;
        }

        #editTrainerButton:active {
          transform: translateY(0);
        }

        #backButton {
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
          z-index: 1001;
          padding: 0;
        }

        #backButton:hover {
          transform: scale(1.15);
          box-shadow: 0 12px 30px rgba(0,0,0,0.4),
                      0 0 25px rgba(255,222,0,0.6);
          border-color: #FFC700;
        }

        #backButton:active {
          transform: scale(1.08);
        }

        @media (max-width: 1024px) {
          .trainer-info-page {
            grid-template-columns: 1fr;
          }

          .left-column {
            padding-top: clamp(5rem, 10vh, 6rem);
          }

          .right-column {
            padding-top: clamp(1rem, 2vh, 1.5rem);
          }

          .ability-container {
            grid-template-columns: repeat(3, 1fr);
          }

          .skills-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }

        @media (max-width: 640px) {
          .ability-container {
            grid-template-columns: repeat(2, 1fr);
          }

          .skills-grid {
            grid-template-columns: 1fr;
          }
        }
      </style>

      <!-- Back Button -->
      <button id="backButton">←</button>

      <!-- Trainer Name as Title -->
      <h1>${trainerName}</h1>

      <!-- Left Column: Image, Info List, and Buttons -->
      <div class="left-column">
        <div class="trainer-image-container">
          <img id="trainerImage" src="${trainerImage}" alt="${trainerName}" onerror="this.src='assets/Pokeball.png'">
        </div>

        <div class="trainer-info-list">
          <div class="info-item">
            <span class="info-item-label">Level:</span>
            <span>${trainerLevel}</span>
          </div>
          <div class="info-item">
            <span class="info-item-label">Hit Dice:</span>
            <span>${trainerHD}</span>
          </div>
          <div class="info-item">
            <span class="info-item-label">Vitality Dice:</span>
            <span>${trainerVD}</span>
          </div>
          <div class="info-item">
            <span class="info-item-label">Speed:</span>
            <span>${trainerSpeed} ft</span>
          </div>
          <div class="info-item">
            <span class="info-item-label">Initiative:</span>
            <span>${trainerInitiative >= 0 ? '+' : ''}${trainerInitiative}</span>
          </div>
          <div class="info-item">
            <span class="info-item-label">Proficiency:</span>
            <span>+${trainerProficiency}</span>
          </div>
          <div class="info-item">
            <span class="info-item-label">Saving Throws:</span>
            <span>${trainerSavingThrows}</span>
          </div>
          <div class="info-item">
            <span class="info-item-label">League Points:</span>
            <span>${trainerLeaguePoints}</span>
          </div>
        </div>

        <div class="info-buttons-grid">
          <button class="info-button" id="inventoryButton">Inventory</button>
          <button class="info-button" id="specializationButton">Specialization</button>
          <button class="info-button" id="trainerPathButton">Trainer Path</button>
          <button class="info-button" id="affinityButton">Affinity</button>
          <button class="info-button" id="gearButton">Gear</button>
          <button class="info-button" id="featsButton">Feats</button>
          <button id="editTrainerButton">Edit Trainer</button>
        </div>
      </div>

      <!-- Right Column: Stats and Skills -->
      <div class="right-column">
        <!-- Row 1: AC, HP, VP -->
        <div class="stat-main-container">
          <div class="stat-box-wrapper">
            <div class="stat-label-box">AC</div>
            <div class="stat-box">${currentAC}</div>
          </div>
          <div class="stat-box-wrapper">
            <div class="stat-label-box">HP</div>
            <div class="stat-box">${currentHP}</div>
          </div>
          <div class="stat-box-wrapper">
            <div class="stat-label-box">VP</div>
            <div class="stat-box">${currentVP}</div>
          </div>
        </div>

        <!-- Row 2: STR, DEX, CON, INT, WIS, CHA -->
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

        <!-- Skills Table -->
        <div class="skills-container">
          <h3>Skills</h3>
          <div class="skills-grid">
            ${allSkills.map(skill => {
              const skillName = skill.split(' (')[0].trim();
              const skillModifier = skill.split(' (')[1].replace(')', '');
              const isUnlocked = skillsArray.some(s => s.toLowerCase().includes(skillName.toLowerCase()));

              return `
                <div class="skill-item ${isUnlocked ? 'unlocked' : ''}">
                  <div class="skill-name">${skillName}</div>
                  <div class="skill-modifier">(${skillModifier})</div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    </div>
  `;

  return html;
}

export function attachTrainerInfoListeners() {
  const trainerDataStr = sessionStorage.getItem('trainerData');
  const trainerData = trainerDataStr ? JSON.parse(trainerDataStr) : null;

  // Back button
  document.getElementById('backButton')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('navigate', {
      detail: { route: 'trainer-card' }
    }));
  });

  // Edit Trainer button
  document.getElementById('editTrainerButton')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('navigate', {
      detail: { route: 'edit-trainer' }
    }));
  });

  // Inventory button
  document.getElementById('inventoryButton')?.addEventListener('click', () => {
    if (!trainerData) return;

    const inventory = trainerData[20] || 'None';
    const itemsStr = sessionStorage.getItem('items');

    if (inventory === 'None' || !inventory) {
      alert('No items in inventory.');
      return;
    }

    const itemsList = inventory.split(',').map(item => item.trim()).filter(item => item);

    if (itemsStr) {
      const itemsData = JSON.parse(itemsStr);
      let message = 'Inventory:\n\n';

      itemsList.forEach(itemName => {
        const itemData = itemsData.find(i => i.name === itemName);
        if (itemData) {
          message += `${itemData.name}\n${itemData.effect}\n\n`;
        } else {
          message += `${itemName}\n\n`;
        }
      });

      alert(message);
    } else {
      alert('Inventory:\n\n' + itemsList.join('\n'));
    }
  });

  // Specialization button
  document.getElementById('specializationButton')?.addEventListener('click', () => {
    if (!trainerData) return;

    const specialization = trainerData[24] || 'None';

    if (specialization === 'None' || !specialization) {
      alert('No specialization selected.');
      return;
    }

    alert(`Specialization:\n\n${specialization}`);
  });

  // Trainer Path button
  document.getElementById('trainerPathButton')?.addEventListener('click', () => {
    if (!trainerData) return;

    const trainerPath = trainerData[25] || 'None';

    if (trainerPath === 'None' || !trainerPath) {
      alert('No trainer path selected.');
      return;
    }

    alert(`Trainer Path:\n\n${trainerPath}`);
  });

  // Affinity button
  document.getElementById('affinityButton')?.addEventListener('click', () => {
    if (!trainerData) return;

    const affinity = trainerData[23] || 'None';

    if (affinity === 'None' || !affinity) {
      alert('No affinity selected.');
      return;
    }

    const affinities = affinity.split(',').map(a => a.trim()).filter(a => a);
    alert(`Affinity:\n\n${affinities.join('\n')}`);
  });

  // Gear button
  document.getElementById('gearButton')?.addEventListener('click', () => {
    if (!trainerData) return;

    const gear = trainerData[37] || 'None';

    if (gear === 'None' || !gear) {
      alert('No gear equipped.');
      return;
    }

    const gearList = gear.split(',').map(g => g.trim()).filter(g => g);
    const itemsStr = sessionStorage.getItem('items');

    if (itemsStr) {
      const itemsData = JSON.parse(itemsStr);
      let message = 'Gear:\n\n';

      gearList.forEach(gearName => {
        const itemData = itemsData.find(i => i.name === gearName);
        if (itemData) {
          message += `${itemData.name}\n${itemData.effect}\n\n`;
        } else {
          message += `${gearName}\n\n`;
        }
      });

      alert(message);
    } else {
      alert('Gear:\n\n' + gearList.join('\n'));
    }
  });

  // Feats button
  document.getElementById('featsButton')?.addEventListener('click', () => {
    if (!trainerData) return;

    const feats = trainerData[33] || 'None';

    if (feats === 'None' || !feats) {
      alert('No feats acquired.');
      return;
    }

    const featsList = feats.split(',').map(f => f.trim()).filter(f => f);
    const featsDataStr = sessionStorage.getItem('trainerFeats');

    if (featsDataStr) {
      const featsData = JSON.parse(featsDataStr);
      let message = 'Feats:\n\n';

      featsList.forEach(featName => {
        const featData = featsData.find(f => f.name === featName);
        if (featData) {
          message += `${featData.name}\n${featData.effect}\n\n`;
        } else {
          message += `${featName}\n\n`;
        }
      });

      alert(message);
    } else {
      alert('Feats:\n\n' + featsList.join('\n'));
    }
  });
}
