// Trainer Info Page - Detailed Trainer Information Display

import { showError, showSuccess } from '../utils/notifications.js';

// Module-level variable to track selected inventory item
let selectedItemData = null;

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
          padding: clamp(1rem, 2vh, 2rem) clamp(1rem, 2vw, 3rem) clamp(1rem, 2vh, 1.5rem);
          min-height: auto;
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
          cursor: pointer;
          position: relative;
          border-radius: clamp(15px, 3vw, 20px);
          overflow: hidden;
          border: clamp(3px, 0.6vw, 5px) solid #FFDE00;
          box-shadow: 0 clamp(8px, 2vh, 10px) clamp(25px, 5vw, 30px) rgba(0,0,0,0.5),
                      0 0 clamp(20px, 4vw, 30px) rgba(255,222,0,0.3);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .trainer-image-container:hover {
          transform: translateY(-3px);
          box-shadow: 0 clamp(12px, 3vh, 15px) clamp(30px, 6vw, 35px) rgba(0,0,0,0.6),
                      0 0 clamp(25px, 5vw, 35px) rgba(255,222,0,0.5);
          border-color: #FFC700;
        }

        .trainer-image-container::after {
          content: 'EDIT TRAINER';
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          background: linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.7) 70%, transparent 100%);
          color: #FFDE00;
          font-size: clamp(0.8rem, 1.8vw, 1rem);
          font-weight: 900;
          text-align: center;
          padding: clamp(0.5rem, 1.5vh, 0.8rem);
          letter-spacing: clamp(0.5px, 0.3vw, 1px);
          opacity: 0;
          transition: opacity 0.3s ease;
        }

        .trainer-image-container:hover::after {
          opacity: 1;
        }

        .trainer-image-container img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .trainer-info-list {
          display: flex;
          flex-direction: column;
          gap: clamp(0.5rem, 1vh, 0.75rem);
        }

        .info-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
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
          flex-shrink: 0;
        }

        .info-item-value {
          text-align: right;
          word-wrap: break-word;
          overflow-wrap: break-word;
          max-width: 60%;
        }

        .info-item-double {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: clamp(0.5rem, 1vh, 0.75rem);
        }

        .info-item-half {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: clamp(0.3rem, 0.8vw, 0.5rem);
          padding: clamp(0.4rem, 1vh, 0.6rem) clamp(0.6rem, 1.5vw, 1rem);
          background: linear-gradient(135deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.08) 100%);
          border: clamp(2px, 0.4vw, 3px) solid rgba(255,222,0,0.4);
          border-radius: clamp(8px, 1.5vw, 12px);
          font-size: clamp(0.9rem, 2vw, 1.1rem);
          font-weight: 700;
          color: white;
          text-shadow: 0 2px 4px rgba(0,0,0,0.6);
        }

        .info-item-half .info-item-label {
          font-size: clamp(0.9rem, 2vw, 1.1rem);
        }

        .info-item-half span:not(.info-item-label) {
          font-size: clamp(0.9rem, 2vw, 1.1rem);
        }

        .info-buttons-grid {
          display: flex;
          flex-wrap: wrap;
          gap: clamp(0.5rem, 1vh, 0.75rem);
        }

        .info-button.full-width {
          width: 100%;
        }

        .info-button {
          flex: 1 1 0;
          padding: clamp(0.6rem, 1.5vh, 0.9rem) clamp(0.7rem, 1.5vw, 1rem);
          background: linear-gradient(135deg, #3B4CCA 0%, #2E3FA0 100%);
          border: clamp(2px, 0.4vw, 3px) solid #FFDE00;
          border-radius: clamp(8px, 1.5vw, 12px);
          color: white;
          font-size: clamp(0.75rem, 1.5vw, 0.9rem);
          white-space: nowrap;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: clamp(0.2px, 0.15vw, 0.4px);
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
          gap: clamp(0.75rem, 1.5vh, 1rem);
          padding-top: clamp(3rem, 6vh, 4rem);
        }

        /* Stats Row 1: AC, HP, VP - Medium boxes with HP/VP current values */
        .stat-main-container {
          display: grid;
          grid-template-columns: repeat(6, 1fr);
          gap: clamp(0.6rem, 2vw, 1rem);
          margin-bottom: clamp(0.5rem, 1vh, 0.75rem);
        }

        .stat-box-wrapper {
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .stat-box-wrapper:nth-child(1) {
          grid-column: 1 / 3;
        }

        .stat-box-wrapper:nth-child(2) {
          grid-column: 3 / 5;
        }

        .stat-box-wrapper:nth-child(3) {
          grid-column: 5 / 7;
        }

        .stat-label-box {
          font-weight: 900;
          color: white;
          font-size: clamp(0.8rem, 1.8vw, 1rem);
          margin-bottom: clamp(0.3rem, 0.8vh, 0.4rem);
          text-shadow: 0 2px 5px rgba(0,0,0,0.8);
          text-transform: uppercase;
          letter-spacing: clamp(0.3px, 0.3vw, 1px);
        }

        .stat-box {
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

        .current-stat-box {
          display: flex;
          align-items: center;
          justify-content: center;
          width: clamp(45px, 7vw, 60px);
          height: clamp(45px, 7vw, 60px);
          background: linear-gradient(135deg, #3B4CCA 0%, #2E3FA0 100%);
          color: white;
          border-radius: clamp(8px, 1.8vw, 12px);
          border: clamp(2px, 0.4vw, 3px) solid #333;
          font-size: clamp(1.2rem, 2.5vw, 1.6rem);
          font-weight: 900;
          box-shadow: 0 6px 15px rgba(0,0,0,0.5),
                      inset 0 -2px 0 rgba(0,0,0,0.3);
          margin-top: clamp(-8px, -1vh, -10px);
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .current-stat-box:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 20px rgba(0,0,0,0.6),
                      0 0 15px rgba(59,76,202,0.5);
        }

        .current-stat-box:active {
          transform: translateY(0);
        }

        /* Stats Row 2: STR, DEX, CON, INT, WIS, CHA - Smaller boxes with modifiers */
        .ability-container {
          display: grid;
          grid-template-columns: repeat(6, 1fr);
          gap: clamp(0.6rem, 2vw, 1rem);
          margin-bottom: clamp(0.5rem, 1.2vh, 0.75rem);
        }

        .ability-group {
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .ability-label {
          font-weight: 900;
          font-size: clamp(0.75rem, 1.6vw, 0.95rem);
          margin-bottom: clamp(0.25rem, 0.8vh, 0.4rem);
          color: white;
          text-shadow: 0 2px 5px rgba(0,0,0,0.8);
          text-transform: uppercase;
          letter-spacing: clamp(0.2px, 0.25vw, 0.6px);
        }

        .ability-box {
          display: flex;
          align-items: center;
          justify-content: center;
          width: clamp(45px, 8vw, 60px);
          height: clamp(45px, 8vw, 60px);
          background: linear-gradient(135deg, #FFDE00 0%, #FFC700 100%);
          color: black;
          border-radius: clamp(8px, 1.8vw, 12px);
          border: clamp(2px, 0.4vw, 3px) solid #333;
          font-size: clamp(1.2rem, 2.5vw, 1.7rem);
          font-weight: 900;
          box-shadow: 0 8px 20px rgba(0,0,0,0.5),
                      inset 0 -3px 0 rgba(0,0,0,0.2);
        }

        .modifier-box {
          display: flex;
          align-items: center;
          justify-content: center;
          width: clamp(38px, 6.5vw, 50px);
          height: clamp(38px, 6.5vw, 50px);
          background: linear-gradient(135deg, #EE1515 0%, #C91010 100%);
          color: white;
          border-radius: clamp(7px, 1.4vw, 10px);
          border: clamp(2px, 0.4vw, 3px) solid #333;
          font-size: clamp(1rem, 2vw, 1.4rem);
          font-weight: 900;
          box-shadow: 0 6px 15px rgba(0,0,0,0.5),
                      inset 0 -2px 0 rgba(0,0,0,0.3);
          margin-top: clamp(-8px, -1vh, -10px);
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
          text-align: center;
        }

        .skills-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: clamp(0.4rem, 1.2vw, 0.6rem);
          padding: clamp(0.5rem, 1.5vw, 0.8rem);
          border-radius: clamp(10px, 2vw, 15px);
          background: linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 100%);
        }

        .skill-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: clamp(0.35rem, 0.8vh, 0.5rem);
          border: clamp(2px, 0.3vw, 2.5px) solid #333;
          border-radius: clamp(7px, 1.3vw, 10px);
          text-align: center;
          background: linear-gradient(135deg, rgba(100,100,100,0.4) 0%, rgba(80,80,80,0.4) 100%);
          font-size: clamp(0.65rem, 1.3vw, 0.75rem);
          font-weight: 700;
          color: rgba(255,255,255,0.5);
          box-shadow: 0 3px 8px rgba(0,0,0,0.3);
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
          letter-spacing: clamp(0.15px, 0.12vw, 0.3px);
          font-size: clamp(0.65rem, 1.3vw, 0.75rem);
        }

        .skill-modifier {
          font-size: clamp(0.6rem, 1.2vw, 0.7rem);
          opacity: 0.8;
          margin-top: clamp(1.5px, 0.25vh, 2.5px);
        }

        /* Popup Modal Styles */
        .popup-overlay {
          display: none;
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.7);
          z-index: 2000;
          justify-content: center;
          align-items: center;
          backdrop-filter: blur(3px);
        }

        .popup-overlay.active {
          display: flex;
        }

        .popup-content {
          background: linear-gradient(135deg, #2a2a2a 0%, #1f1f1f 100%);
          border: clamp(3px, 0.6vw, 5px) solid #FFDE00;
          border-radius: clamp(15px, 3vw, 20px);
          padding: clamp(1.5rem, 3vw, 2.5rem);
          max-width: min(90vw, 600px);
          max-height: 80vh;
          overflow-y: auto;
          position: relative;
          box-shadow: 0 15px 40px rgba(0,0,0,0.8);
        }

        .popup-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: clamp(1rem, 2vh, 1.5rem);
          padding-bottom: clamp(0.75rem, 1.5vh, 1rem);
          border-bottom: clamp(2px, 0.4vw, 3px) solid #FFDE00;
        }

        .popup-title {
          font-size: clamp(1.3rem, 3vw, 1.8rem);
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: clamp(0.5px, 0.3vw, 1px);
          color: #FFDE00;
          text-shadow: 0 2px 4px rgba(0,0,0,0.8);
        }

        .popup-close {
          background: linear-gradient(135deg, #EE1515 0%, #C91010 100%);
          color: white;
          border: clamp(2px, 0.4vw, 3px) solid #333;
          border-radius: 50%;
          width: clamp(35px, 7vw, 45px);
          height: clamp(35px, 7vw, 45px);
          font-size: clamp(1.2rem, 2.5vw, 1.6rem);
          font-weight: bold;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          flex-shrink: 0;
        }

        .popup-close:hover {
          transform: scale(1.1) rotate(90deg);
          box-shadow: 0 5px 15px rgba(0,0,0,0.4);
        }

        .popup-body {
          color: #e0e0e0;
          font-size: clamp(0.95rem, 2vw, 1.1rem);
          line-height: 1.6;
        }

        .popup-item {
          margin-bottom: clamp(1rem, 2vh, 1.5rem);
          padding: clamp(0.75rem, 1.5vw, 1rem);
          background: linear-gradient(135deg, rgba(255,222,0,0.12) 0%, rgba(255,222,0,0.06) 100%);
          border: clamp(2px, 0.4vw, 2px) solid rgba(255,222,0,0.4);
          border-radius: clamp(8px, 1.5vw, 12px);
        }

        .popup-item-title {
          font-weight: 900;
          font-size: clamp(1.05rem, 2.2vw, 1.2rem);
          margin-bottom: clamp(0.3rem, 0.8vh, 0.5rem);
          color: #FFDE00;
          text-transform: uppercase;
          text-shadow: 0 1px 3px rgba(0,0,0,0.6);
        }

        .popup-item-effect {
          font-size: clamp(0.9rem, 1.9vw, 1rem);
          color: #c0c0c0;
        }

        .popup-item-locked {
          opacity: 0.6;
          background: linear-gradient(135deg, rgba(150,150,150,0.15) 0%, rgba(150,150,150,0.08) 100%);
          border-color: rgba(150,150,150,0.3);
        }

        .popup-item-locked .popup-item-title {
          color: #888;
        }

        .popup-item-locked .popup-item-effect {
          color: #777;
          font-style: italic;
        }

        .popup-category-title {
          font-size: clamp(1.1rem, 2.3vw, 1.3rem);
          font-weight: 900;
          text-transform: uppercase;
          color: #FFDE00;
          margin: clamp(1rem, 2vh, 1.5rem) 0 clamp(0.5rem, 1vh, 0.75rem) 0;
          padding-bottom: clamp(0.3rem, 0.8vh, 0.5rem);
          border-bottom: clamp(2px, 0.4vw, 3px) solid rgba(255,222,0,0.3);
          letter-spacing: clamp(0.5px, 0.2vw, 1px);
          text-shadow: 0 1px 3px rgba(0,0,0,0.6);
        }

        .popup-category-title:first-child {
          margin-top: 0;
        }

        /* Trainer Buffs specific styles */
        .skill-item-container {
          border: clamp(2px, 0.4vw, 2px) solid rgba(255,222,0,0.4);
          border-radius: clamp(8px, 1.5vw, 12px);
          margin: clamp(0.75rem, 1.5vh, 1rem);
          padding: clamp(0.75rem, 1.5vw, 1rem);
          width: 95%;
          box-sizing: border-box;
          background: linear-gradient(135deg, rgba(255,222,0,0.12) 0%, rgba(255,222,0,0.06) 100%);
        }

        .skill-name-header {
          text-align: center;
          font-weight: 900;
          font-size: clamp(1.05rem, 2.2vw, 1.2rem);
          margin-bottom: clamp(0.5rem, 1vh, 0.75rem);
          color: #FFDE00;
          text-transform: uppercase;
          text-shadow: 0 1px 3px rgba(0,0,0,0.6);
        }

        .skill-effect-box {
          border: 1px solid rgba(255,222,0,0.3);
          border-radius: clamp(5px, 1vw, 8px);
          padding: clamp(0.6rem, 1.2vw, 0.8rem);
          text-align: left;
          height: auto;
          background: rgba(0,0,0,0.2);
          color: #e0e0e0;
          font-size: clamp(0.9rem, 1.9vw, 1rem);
          line-height: 1.5;
          box-shadow: 0 2px 5px rgba(0,0,0,0.2);
        }

        .skill-header-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: clamp(0.5rem, 1vh, 0.75rem);
        }

        .charge-dots {
          display: flex;
          gap: clamp(4px, 0.8vw, 6px);
          align-items: center;
        }

        .charge-dot {
          width: clamp(10px, 2vw, 14px);
          height: clamp(10px, 2vw, 14px);
          border-radius: 50%;
          display: inline-block;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }

        .charge-dot.filled {
          background: linear-gradient(135deg, #4CAF50 0%, #45A049 100%);
          border: 2px solid #FFDE00;
          box-shadow: 0 0 8px rgba(76,175,80,0.6);
        }

        .charge-dot.empty {
          background: rgba(100,100,100,0.4);
          border: 2px solid rgba(150,150,150,0.5);
        }

        .use-buff-button {
          margin-top: clamp(0.5rem, 1vh, 0.75rem);
          padding: clamp(0.5rem, 1vh, 0.75rem) clamp(1rem, 2vw, 1.5rem);
          background: linear-gradient(135deg, #4CAF50 0%, #45A049 100%);
          color: white;
          border: clamp(2px, 0.4vw, 3px) solid #FFDE00;
          border-radius: clamp(8px, 1.5vw, 12px);
          font-size: clamp(0.95rem, 2vw, 1.1rem);
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: clamp(0.5px, 0.2vw, 1px);
          cursor: pointer;
          box-shadow: 0 clamp(3px, 0.8vh, 5px) clamp(8px, 1.5vh, 12px) rgba(0,0,0,0.3);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          width: 100%;
        }

        .use-buff-button:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 clamp(5px, 1vh, 8px) clamp(12px, 2vh, 18px) rgba(0,0,0,0.4),
                      0 0 clamp(15px, 2.5vh, 20px) rgba(76,175,80,0.5);
        }

        .use-buff-button:active:not(:disabled) {
          transform: translateY(0);
        }

        .use-buff-button:disabled {
          background: linear-gradient(135deg, #666 0%, #555 100%);
          border-color: #888;
          cursor: not-allowed;
          opacity: 0.6;
        }

        .rest-buttons-container {
          display: flex;
          gap: clamp(0.75rem, 1.5vw, 1rem);
          justify-content: center;
          margin-bottom: clamp(1rem, 2vh, 1.5rem);
          padding: clamp(0.75rem, 1.5vw, 1rem);
          border-bottom: clamp(2px, 0.4vw, 3px) solid rgba(255,222,0,0.3);
        }

        .rest-button {
          flex: 1;
          padding: clamp(0.75rem, 1.5vh, 1rem) clamp(1rem, 2vw, 1.5rem);
          border: clamp(2px, 0.4vw, 3px) solid #FFDE00;
          border-radius: clamp(10px, 2vw, 15px);
          font-size: clamp(0.95rem, 2vw, 1.1rem);
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: clamp(0.5px, 0.2vw, 1px);
          cursor: pointer;
          box-shadow: 0 clamp(3px, 0.8vh, 5px) clamp(8px, 1.5vh, 12px) rgba(0,0,0,0.3);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          display: flex;
          align-items: center;
          justify-content: center;
          gap: clamp(0.3rem, 0.8vw, 0.5rem);
        }

        .short-rest-button {
          background: linear-gradient(135deg, #4A90E2 0%, #357ABD 100%);
          color: white;
        }

        .short-rest-button:hover {
          transform: translateY(-2px);
          box-shadow: 0 clamp(5px, 1vh, 8px) clamp(12px, 2vh, 18px) rgba(0,0,0,0.4),
                      0 0 clamp(15px, 2.5vh, 20px) rgba(74,144,226,0.5);
        }

        .long-rest-button {
          background: linear-gradient(135deg, #7B68EE 0%, #6A5ACD 100%);
          color: white;
        }

        .long-rest-button:hover {
          transform: translateY(-2px);
          box-shadow: 0 clamp(5px, 1vh, 8px) clamp(12px, 2vh, 18px) rgba(0,0,0,0.4),
                      0 0 clamp(15px, 2.5vh, 20px) rgba(123,104,238,0.5);
        }

        .rest-button:active {
          transform: translateY(0);
        }

        .rest-icon {
          font-size: clamp(1.1rem, 2.2vw, 1.3rem);
        }

        /* Special Inventory Popup Styles */
        #inventoryPopup .popup-content {
          max-width: min(90vw, 900px);
          max-height: 85vh;
          padding: 0;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }

        .inventory-popup-content {
          display: flex;
          height: 100%;
          flex: 1;
          overflow: hidden;
        }

        .inventory-sidebar {
          width: clamp(280px, 35%, 400px);
          background: linear-gradient(135deg, #2c2c2c 0%, #252525 100%);
          color: white;
          display: flex;
          flex-direction: column;
          border-right: clamp(2px, 0.4vw, 3px) solid #333;
          overflow: hidden;
        }

        .inventory-title {
          padding: clamp(1rem, 2vh, 1.5rem);
          margin: 0;
          background: linear-gradient(135deg, #EE1515 0%, #C91010 100%);
          color: white;
          font-size: clamp(1.4rem, 3vw, 1.8rem);
          font-weight: 900;
          text-align: center;
          border-bottom: clamp(2px, 0.4vw, 3px) solid #333;
          text-transform: uppercase;
          letter-spacing: clamp(0.5px, 0.3vw, 1px);
          text-shadow: 0 2px 4px rgba(0,0,0,0.5);
        }

        .inventory-categories {
          list-style: none;
          padding: 0;
          margin: 0;
          overflow-y: auto;
          flex: 1;
        }

        .category-header {
          padding: clamp(0.9rem, 2vh, 1.2rem) clamp(1.2rem, 2.5vw, 1.6rem);
          background-color: #3a3a3a;
          cursor: pointer;
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid #444;
          transition: all 0.2s ease;
          font-size: clamp(0.85rem, 1.9vw, 1.1rem);
          font-weight: 700;
        }

        .category-header:hover {
          background-color: #4a4a4a;
          padding-left: clamp(1.4rem, 3vw, 1.8rem);
        }

        .category-header.active {
          background: linear-gradient(135deg, #EE1515 0%, #C91010 100%);
          color: white;
        }

        .arrow {
          transition: transform 0.2s ease;
          font-size: clamp(0.8rem, 1.8vw, 1rem);
        }

        .category-header.active .arrow {
          transform: rotate(90deg);
        }

        .item-list {
          background-color: #2c2c2c;
          padding: 0;
          max-height: 0;
          overflow: hidden;
          transition: max-height 0.3s ease;
        }

        .item-list.expanded {
          max-height: 500px;
          overflow-y: auto;
        }

        .inventory-list-item {
          padding: clamp(0.7rem, 1.5vh, 0.9rem) clamp(1.7rem, 3.5vw, 2.2rem);
          cursor: pointer;
          transition: all 0.2s ease;
          border-left: clamp(3px, 0.6vw, 4px) solid transparent;
          color: #ddd;
          font-size: clamp(0.8rem, 1.8vw, 0.95rem);
        }

        .inventory-list-item:hover {
          background-color: #3a3a3a;
          border-left-color: #EE1515;
          color: white;
        }

        .inventory-list-item.selected {
          background-color: #EE1515;
          color: white;
          border-left-color: white;
          font-weight: 700;
        }

        .inventory-main {
          flex: 1;
          display: flex;
          flex-direction: column;
          padding: clamp(1.5rem, 3vw, 2rem);
          background: linear-gradient(135deg, #2a2a2a 0%, #1f1f1f 100%);
          overflow: hidden;
        }

        .item-info-card {
          flex: 1;
          background: linear-gradient(135deg, #353535 0%, #2d2d2d 100%);
          border-radius: clamp(10px, 2vw, 15px);
          padding: clamp(1.2rem, 2.5vw, 2rem);
          box-shadow: 0 clamp(4px, 1vh, 8px) clamp(15px, 3vw, 25px) rgba(0,0,0,0.5);
          margin-bottom: clamp(1rem, 2vh, 1.5rem);
          overflow-y: auto;
          border: clamp(2px, 0.4vw, 3px) solid rgba(255,222,0,0.3);
        }

        .item-name {
          font-size: clamp(1.5rem, 3.5vw, 2rem);
          color: #FFDE00;
          margin: 0 0 clamp(1rem, 2vh, 1.5rem) 0;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: clamp(0.5px, 0.3vw, 1px);
          text-shadow: 0 2px 4px rgba(0,0,0,0.6);
        }

        .item-details {
          display: flex;
          flex-direction: column;
          gap: clamp(1rem, 2vh, 1.5rem);
        }

        .detail-section h4 {
          font-size: clamp(1rem, 2.2vw, 1.2rem);
          color: #FFDE00;
          margin: 0 0 clamp(0.5rem, 1vh, 0.75rem) 0;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: clamp(0.3px, 0.2vw, 0.5px);
        }

        .detail-section p {
          font-size: clamp(0.95rem, 2.1vw, 1.1rem);
          color: #c0c0c0;
          line-height: 1.6;
          margin: 0;
        }

        .detail-divider {
          height: clamp(2px, 0.4vw, 3px);
          background: linear-gradient(90deg, transparent 0%, rgba(255,222,0,0.3) 50%, transparent 100%);
        }

        .inventory-close {
          position: absolute;
          top: clamp(15px, 3vh, 20px);
          right: clamp(15px, 3vw, 20px);
          width: clamp(35px, 7vw, 45px);
          height: clamp(35px, 7vw, 45px);
          background: linear-gradient(135deg, #757575 0%, #616161 100%);
          color: white;
          border: clamp(2px, 0.4vw, 3px) solid #FFDE00;
          border-radius: 50%;
          font-size: clamp(1.5rem, 3.5vw, 2rem);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.3s ease;
          z-index: 10;
        }

        .inventory-close:hover {
          transform: scale(1.1) rotate(90deg);
          background: linear-gradient(135deg, #616161 0%, #505050 100%);
          box-shadow: 0 0 clamp(15px, 3vw, 25px) rgba(255,222,0,0.6);
        }

        .inventory-actions {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: clamp(0.75rem, 1.5vw, 1rem);
        }

        .inventory-actions .action-btn {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: clamp(0.3rem, 0.8vh, 0.5rem);
          padding: clamp(0.8rem, 1.8vh, 1.2rem);
          border: clamp(2px, 0.4vw, 3px) solid #333;
          border-radius: clamp(10px, 2vw, 15px);
          cursor: pointer;
          transition: all 0.3s ease;
          font-size: clamp(0.9rem, 2vw, 1.1rem);
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: clamp(0.3px, 0.2vw, 0.5px);
        }

        .inventory-actions .action-btn {
          background: linear-gradient(135deg, #3B4CCA 0%, #2E3FA0 100%);
          color: white;
        }

        .inventory-actions .action-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 clamp(6px, 1.5vh, 10px) clamp(20px, 4vw, 30px) rgba(0,0,0,0.5),
                      0 0 clamp(15px, 3vw, 25px) rgba(59,76,202,0.6);
        }

        .inventory-actions .action-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .btn-icon {
          font-size: clamp(1.2rem, 2.5vw, 1.5rem);
        }

        .btn-text {
          font-size: clamp(0.85rem, 1.9vw, 1rem);
        }

        /* Inventory Action Modals */
        .inventory-modal {
          display: none;
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background-color: rgba(0, 0, 0, 0.6);
          z-index: 2100;
          backdrop-filter: blur(5px);
          animation: fadeIn 0.2s ease;
        }

        .inventory-modal-content {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 90%;
          max-width: clamp(400px, 80vw, 700px);
          background: linear-gradient(135deg, #2a2a2a 0%, #1f1f1f 100%);
          border: clamp(3px, 0.6vw, 5px) solid #FFDE00;
          border-radius: clamp(15px, 3vw, 25px);
          box-shadow: 0 15px 40px rgba(0,0,0,0.8);
          overflow: hidden;
          animation: slideIn 0.3s ease;
        }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translate(-50%, -45%);
          }
          to {
            opacity: 1;
            transform: translate(-50%, -50%);
          }
        }

        .modal-header {
          background: linear-gradient(135deg, #EE1515 0%, #C91010 100%);
          padding: clamp(1rem, 2.5vh, 1.5rem) clamp(1.5rem, 3vw, 2rem);
          border-bottom: clamp(3px, 0.6vw, 5px) solid #FFDE00;
        }

        .modal-header h2 {
          color: white;
          margin: 0;
          font-size: clamp(1.3rem, 2.8vw, 1.8rem);
          font-weight: 900;
          text-transform: uppercase;
          text-align: center;
          text-shadow: 0 2px 8px rgba(0,0,0,0.6);
        }

        .modal-body {
          padding: clamp(1.5rem, 3vh, 2.5rem) clamp(1.5rem, 3vw, 2rem);
          max-height: 60vh;
          overflow-y: auto;
        }

        .form-group {
          margin-bottom: clamp(1.2rem, 2.5vh, 1.8rem);
          position: relative;
        }

        .form-group label {
          display: block;
          color: #FFDE00;
          font-size: clamp(1rem, 2.2vw, 1.2rem);
          font-weight: 900;
          margin-bottom: clamp(0.5rem, 1vh, 0.75rem);
          text-transform: uppercase;
          text-shadow: 0 2px 4px rgba(0,0,0,0.6);
        }

        .form-group input[type="text"],
        .form-group input[type="number"] {
          width: 100%;
          padding: clamp(0.8rem, 1.8vh, 1.2rem) clamp(1rem, 2vw, 1.5rem);
          background: linear-gradient(135deg, #3a3a3a 0%, #2d2d2d 100%);
          border: clamp(2px, 0.4vw, 3px) solid #555;
          border-radius: clamp(8px, 1.5vw, 12px);
          color: white;
          font-size: clamp(1rem, 2.2vw, 1.3rem);
          font-weight: 700;
          box-sizing: border-box;
          transition: all 0.3s ease;
        }

        .form-group input:focus {
          outline: none;
          border-color: #FFDE00;
          box-shadow: 0 0 0 clamp(2px, 0.4vw, 3px) rgba(255,222,0,0.3);
        }

        /* Autocomplete Dropdown */
        .autocomplete-dropdown {
          position: absolute;
          top: 100%;
          left: 0;
          right: 0;
          background: linear-gradient(135deg, #3a3a3a 0%, #2d2d2d 100%);
          border: clamp(2px, 0.4vw, 3px) solid #555;
          border-top: none;
          border-radius: 0 0 clamp(8px, 1.5vw, 12px) clamp(8px, 1.5vw, 12px);
          max-height: clamp(200px, 40vh, 300px);
          overflow-y: auto;
          display: none;
          z-index: 9999;
          box-shadow: 0 8px 20px rgba(0,0,0,0.6);
        }

        .autocomplete-item {
          padding: clamp(0.8rem, 1.8vh, 1.2rem) clamp(1rem, 2vw, 1.5rem);
          cursor: pointer;
          transition: all 0.2s ease;
          border-bottom: 1px solid #444;
          font-size: clamp(1rem, 2.2vw, 1.2rem);
          color: #e0e0e0;
          font-weight: 700;
        }

        .autocomplete-item:last-child {
          border-bottom: none;
        }

        .autocomplete-item:hover {
          background: linear-gradient(135deg, #EE1515 0%, #C91010 100%);
          color: white;
        }

        /* Item Preview (for edit/remove modals) */
        .item-preview {
          padding: clamp(0.8rem, 1.8vh, 1.2rem) clamp(1rem, 2vw, 1.5rem);
          background: linear-gradient(135deg, #3a3a3a 0%, #2d2d2d 100%);
          border: clamp(2px, 0.4vw, 3px) solid #FFDE00;
          border-radius: clamp(8px, 1.5vw, 12px);
          color: #FFDE00;
          font-size: clamp(1.1rem, 2.4vw, 1.4rem);
          font-weight: 900;
          text-align: center;
          text-shadow: 0 2px 4px rgba(0,0,0,0.6);
        }

        /* Quantity Control */
        .quantity-control {
          display: flex;
          align-items: center;
          gap: clamp(0.5rem, 1vw, 1rem);
          justify-content: center;
        }

        .quantity-btn {
          width: clamp(40px, 8vw, 55px);
          height: clamp(40px, 8vw, 55px);
          background: linear-gradient(135deg, #3B4CCA 0%, #2E3FA0 100%);
          border: clamp(2px, 0.4vw, 3px) solid #FFDE00;
          border-radius: clamp(8px, 1.5vw, 12px);
          color: white;
          font-size: clamp(1.5rem, 3vw, 2rem);
          font-weight: 900;
          cursor: pointer;
          transition: all 0.3s ease;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .quantity-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 15px rgba(0,0,0,0.4),
                      0 0 15px rgba(59,76,202,0.6);
        }

        .quantity-btn:active {
          transform: translateY(0);
        }

        .quantity-input {
          width: clamp(80px, 15vw, 120px);
          text-align: center;
        }

        /* Modal Actions */
        .modal-actions {
          display: flex;
          gap: clamp(0.75rem, 1.5vw, 1rem);
          padding: clamp(1rem, 2vh, 1.5rem) clamp(1.5rem, 3vw, 2rem);
          background: linear-gradient(135deg, #252525 0%, #1a1a1a 100%);
          border-top: clamp(2px, 0.4vw, 3px) solid #333;
        }

        .modal-actions .action-btn {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: clamp(0.3rem, 0.8vh, 0.5rem);
          padding: clamp(0.8rem, 1.8vh, 1.2rem);
          border: clamp(2px, 0.4vw, 3px) solid #333;
          border-radius: clamp(10px, 2vw, 15px);
          cursor: pointer;
          transition: all 0.3s ease;
          font-weight: 900;
          text-transform: uppercase;
        }

        .modal-actions .action-btn.primary {
          background: linear-gradient(135deg, #3B4CCA 0%, #2E3FA0 100%);
          color: white;
        }

        .modal-actions .action-btn.primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 15px rgba(0,0,0,0.4),
                      0 0 15px rgba(59,76,202,0.6);
        }

        .modal-actions .action-btn.secondary {
          background: linear-gradient(135deg, #666 0%, #555 100%);
          color: white;
        }

        .modal-actions .action-btn.secondary:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 15px rgba(0,0,0,0.4);
        }

        .modal-actions .action-btn.danger {
          background: linear-gradient(135deg, #EE1515 0%, #C91010 100%);
          color: white;
        }

        .modal-actions .action-btn.danger:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 15px rgba(0,0,0,0.4),
                      0 0 15px rgba(238,21,21,0.6);
        }

        /* Confirmation Text */
        .confirmation-text {
          font-size: clamp(1.1rem, 2.4vw, 1.4rem);
          color: #e0e0e0;
          margin-bottom: clamp(1.5rem, 3vh, 2rem);
          text-align: center;
          line-height: 1.6;
        }

        .confirmation-text strong {
          color: #FFDE00;
          font-weight: 900;
        }

        @media (max-width: 768px) {
          .inventory-sidebar {
            width: clamp(200px, 40%, 280px);
          }

          .inventory-actions {
            grid-template-columns: 1fr;
          }
        }

        .combat-tracker-container {
          display: flex;
          flex-direction: column;
          gap: clamp(1.5rem, 3vh, 2rem);
          padding: clamp(1rem, 2vh, 1.5rem);
        }

        .combat-stats-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: clamp(1rem, 2vw, 1.5rem);
        }

        .combat-stat-column {
          display: flex;
          flex-direction: column;
          gap: clamp(0.5rem, 1vh, 0.75rem);
          align-items: center;
        }

        .combat-stat-label {
          font-weight: 900;
          font-size: clamp(1.1rem, 2.4vw, 1.4rem);
          color: #FFDE00;
          text-transform: uppercase;
          text-shadow: 0 2px 4px rgba(0,0,0,0.6);
        }

        .combat-stat-value {
          font-size: clamp(1.6rem, 3.5vw, 2.2rem);
          font-weight: 900;
          color: white;
          text-shadow: 2px 2px 4px rgba(0,0,0,0.6);
        }

        .combat-input {
          width: 100%;
          padding: clamp(0.6rem, 1.4vh, 0.9rem);
          border: clamp(2px, 0.4vw, 3px) solid #555;
          border-radius: clamp(8px, 1.5vw, 12px);
          font-size: clamp(1rem, 2.2vw, 1.2rem);
          font-weight: 700;
          text-align: center;
          background: linear-gradient(135deg, #3a3a3a 0%, #2d2d2d 100%);
          color: white;
          box-sizing: border-box;
        }

        .combat-input:focus {
          outline: none;
          border-color: #FFDE00;
          box-shadow: 0 0 0 clamp(2px, 0.4vw, 3px) rgba(255,222,0,0.3);
        }

        .combat-controls {
          display: flex;
          gap: clamp(0.75rem, 1.5vw, 1rem);
          margin-top: clamp(0.5rem, 1vh, 0.75rem);
        }

        .combat-button {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: clamp(0.3rem, 0.8vh, 0.5rem);
          padding: clamp(0.8rem, 1.8vh, 1.2rem);
          border: clamp(2px, 0.4vw, 3px) solid #333;
          border-radius: clamp(10px, 2vw, 15px);
          font-weight: 900;
          cursor: pointer;
          transition: all 0.3s ease;
          text-transform: uppercase;
        }

        .combat-button .btn-icon {
          font-size: clamp(1.2rem, 2.5vw, 1.5rem);
        }

        .combat-button .btn-text {
          font-size: clamp(0.85rem, 1.9vw, 1rem);
        }

        .combat-button.add {
          background: linear-gradient(135deg, #4CAF50 0%, #45A049 100%);
          color: white;
        }

        .combat-button.remove {
          background: linear-gradient(135deg, #EE1515 0%, #C91010 100%);
          color: white;
        }

        .combat-button.restore {
          background: linear-gradient(135deg, #3B4CCA 0%, #2E3FA0 100%);
          color: white;
        }

        .combat-button:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 15px rgba(0,0,0,0.4);
        }

        .combat-button:active {
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

        /* Tablet Landscape and below - maintain 2 columns but adjust sizing */
        @media (max-width: 1024px) {
          .trainer-info-page {
            grid-template-columns: minmax(30%, 35%) 1fr;
            gap: clamp(1.5rem, 3vw, 2.5rem);
          }

          .ability-container {
            grid-template-columns: repeat(3, 1fr);
          }

          .skills-grid {
            grid-template-columns: repeat(auto-fit, minmax(clamp(120px, 18vw, 180px), 1fr));
          }
        }

        /* Tablet Portrait - still 2 columns but more compact */
        @media (max-width: 768px) {
          .trainer-info-page {
            grid-template-columns: minmax(35%, 40%) 1fr;
            gap: clamp(1rem, 2.5vw, 2rem);
            padding: clamp(1rem, 2vh, 1.5rem) clamp(0.75rem, 1.5vw, 1.5rem);
          }

          .ability-container {
            grid-template-columns: repeat(3, 1fr);
          }

          .skills-grid {
            grid-template-columns: repeat(3, 1fr);
          }
        }

        /* Mobile phones - still maintain 2 columns with larger left side */
        @media (max-width: 600px) {
          .trainer-info-page {
            grid-template-columns: minmax(40%, 45%) 1fr;
            gap: clamp(0.75rem, 2vw, 1.5rem);
            padding: clamp(1rem, 2vh, 1.5rem) clamp(0.5rem, 1vw, 1rem);
          }

          .ability-container {
            grid-template-columns: repeat(3, 1fr);
            gap: clamp(0.4rem, 1.5vw, 0.75rem);
          }

          .skills-grid {
            grid-template-columns: repeat(3, 1fr);
            gap: clamp(0.4rem, 1.2vw, 0.6rem);
          }

          .info-item {
            font-size: clamp(0.8rem, 1.8vw, 1rem);
            padding: clamp(0.3rem, 0.8vh, 0.5rem) clamp(0.5rem, 1.2vw, 0.8rem);
          }

          .info-button {
            font-size: clamp(0.75rem, 1.6vw, 0.9rem);
            padding: clamp(0.5rem, 1.2vh, 0.7rem) clamp(0.6rem, 1.5vw, 0.9rem);
          }
        }

        /* Small mobile phones - even more compact 2 columns */
        @media (max-width: 480px) {
          .trainer-info-page {
            grid-template-columns: minmax(42%, 48%) 1fr;
            gap: clamp(0.5rem, 1.5vw, 1rem);
            padding: clamp(0.75rem, 1.5vh, 1.25rem) clamp(0.4rem, 0.8vw, 0.75rem);
          }

          .ability-container {
            grid-template-columns: repeat(2, 1fr);
            gap: clamp(0.3rem, 1vw, 0.5rem);
          }

          .skills-grid {
            grid-template-columns: repeat(2, 1fr);
            gap: clamp(0.3rem, 1vw, 0.5rem);
          }

          .info-buttons-grid {
            grid-template-columns: 1fr;
            gap: clamp(0.4rem, 1vh, 0.6rem);
          }

          .stat-main-container {
            gap: clamp(0.5rem, 2vw, 1rem);
          }
        }

        /* Very small screens - final fallback single column if needed */
        @media (max-width: 360px) {
          .trainer-info-page {
            grid-template-columns: 1fr;
            gap: clamp(0.75rem, 2vh, 1rem);
          }

          .left-column {
            padding-top: clamp(5rem, 10vh, 6rem);
          }

          .right-column {
            padding-top: clamp(0.5rem, 1vh, 1rem);
          }

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
        <div class="trainer-image-container" id="trainerImageButton">
          <img id="trainerImage" src="${trainerImage}" alt="${trainerName}" onerror="this.src='assets/Pokeball.png'">
        </div>

        <div class="trainer-info-list">
          <div class="info-item">
            <span class="info-item-label">Level:</span>
            <span class="info-item-value">${trainerLevel}</span>
          </div>
          <div class="info-item-double">
            <div class="info-item-half">
              <span class="info-item-label">HD:</span>
              <span>${trainerHD}</span>
            </div>
            <div class="info-item-half">
              <span class="info-item-label">VD:</span>
              <span>${trainerVD}</span>
            </div>
          </div>
          <div class="info-item">
            <span class="info-item-label">Speed:</span>
            <span class="info-item-value">${trainerSpeed} ft</span>
          </div>
          <div class="info-item">
            <span class="info-item-label">Initiative:</span>
            <span class="info-item-value">${trainerInitiative >= 0 ? '+' : ''}${trainerInitiative}</span>
          </div>
          <div class="info-item">
            <span class="info-item-label">Proficiency:</span>
            <span class="info-item-value">+${trainerProficiency}</span>
          </div>
          <div class="info-item">
            <span class="info-item-label">Saving Throws:</span>
            <span class="info-item-value">${trainerSavingThrows}</span>
          </div>
          <div class="info-item">
            <span class="info-item-label">Money:</span>
            <span class="info-item-value">${trainerMoney}</span>
          </div>
          <div class="info-item">
            <span class="info-item-label">League Points:</span>
            <span class="info-item-value">${trainerLeaguePoints}</span>
          </div>
        </div>

        <div class="info-buttons-grid">
          <button class="info-button full-width" id="inventoryButton">Inventory</button>
          <button class="info-button" id="trainerBuffsButton">Trainer Buffs</button>
          <button class="info-button" id="gearButton">Gear</button>
          <button class="info-button" id="specializationButton">Specialization</button>
          <button class="info-button" id="featsButton">Feats</button>
          <button class="info-button" id="trainerPathButton">Trainer Path</button>
          <button class="info-button" id="affinityButton">Affinity</button>
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
            <div class="stat-box">${trainerHP}</div>
            <div class="current-stat-box" id="currentHPButton" title="Click to open Combat Tracker">${currentHP}</div>
          </div>
          <div class="stat-box-wrapper">
            <div class="stat-label-box">VP</div>
            <div class="stat-box">${trainerVP}</div>
            <div class="current-stat-box" id="currentVPButton" title="Click to open Combat Tracker">${currentVP}</div>
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

      <!-- Popup Modals -->
      <div class="popup-overlay" id="inventoryPopup">
        <div class="popup-content">
          <button class="popup-close inventory-close" id="closeInventory">×</button>
          <div class="inventory-popup-content">
            <div class="inventory-sidebar">
              <h2 class="inventory-title">Inventory</h2>
              <ul id="inventoryCategories" class="inventory-categories">
                <!-- Categories will be dynamically populated -->
              </ul>
            </div>
            <div class="inventory-main">
              <div class="item-info-card">
                <h3 class="item-name" id="selectedItemName">Select an item</h3>
                <div class="item-details">
                  <div class="detail-section">
                    <h4>Description</h4>
                    <p id="descriptionText">Choose an item from your inventory to view its details.</p>
                  </div>
                  <div class="detail-divider"></div>
                  <div class="detail-section">
                    <h4>Effect</h4>
                    <p id="effectText">Item effects will appear here.</p>
                  </div>
                </div>
              </div>
              <div class="inventory-actions">
                <button class="action-btn" id="addItemButton">
                  <span class="btn-icon">➕</span>
                  <span class="btn-text">Add</span>
                </button>
                <button class="action-btn" id="editItemButton" disabled>
                  <span class="btn-icon">✏️</span>
                  <span class="btn-text">Edit</span>
                </button>
                <button class="action-btn" id="removeItemButton" disabled>
                  <span class="btn-icon">🗑️</span>
                  <span class="btn-text">Remove</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Add Item Modal -->
      <div id="addItemModal" class="inventory-modal">
        <div class="inventory-modal-content">
          <div class="modal-header">
            <h2>Add Item to Inventory</h2>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label for="itemSearch">Search for Item</label>
              <input type="text" id="itemSearch" placeholder="Start typing to search..." autocomplete="off">
              <div id="autocompleteResults" class="autocomplete-dropdown"></div>
            </div>
            <div class="form-group">
              <label for="itemQuantity">Quantity</label>
              <input type="number" id="itemQuantity" value="1" min="1">
            </div>
          </div>
          <div class="modal-actions">
            <button class="action-btn primary" id="confirmAddItem">
              <span class="btn-icon">➕</span>
              <span class="btn-text">Add</span>
            </button>
            <button class="action-btn secondary" id="cancelAddItem">
              <span class="btn-icon">↩️</span>
              <span class="btn-text">Back</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Edit Item Modal -->
      <div id="editItemModal" class="inventory-modal">
        <div class="inventory-modal-content">
          <div class="modal-header">
            <h2>Edit Item Quantity</h2>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label>Item</label>
              <div class="item-preview" id="editingItemName">Item Name</div>
            </div>
            <div class="form-group">
              <label>Quantity</label>
              <div class="quantity-control">
                <button type="button" class="quantity-btn" id="decrementQty">−</button>
                <input type="number" id="editItemQuantity" class="quantity-input" value="1" min="0">
                <button type="button" class="quantity-btn" id="incrementQty">+</button>
              </div>
            </div>
          </div>
          <div class="modal-actions">
            <button class="action-btn primary" id="confirmEditItem">
              <span class="btn-icon">💾</span>
              <span class="btn-text">Save</span>
            </button>
            <button class="action-btn secondary" id="cancelEditItem">
              <span class="btn-icon">↩️</span>
              <span class="btn-text">Back</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Remove Item Modal -->
      <div id="removeItemModal" class="inventory-modal">
        <div class="inventory-modal-content">
          <div class="modal-header">
            <h2>Remove Item</h2>
          </div>
          <div class="modal-body">
            <div class="confirmation-text">
              Are you sure you want to remove <strong id="itemToRemove">this item</strong> from your inventory?
            </div>
          </div>
          <div class="modal-actions">
            <button class="action-btn danger" id="confirmRemoveItem">
              <span class="btn-icon">✔️</span>
              <span class="btn-text">Yes</span>
            </button>
            <button class="action-btn secondary" id="cancelRemoveItem">
              <span class="btn-icon">✖️</span>
              <span class="btn-text">No</span>
            </button>
          </div>
        </div>
      </div>

      <div class="popup-overlay" id="trainerBuffsPopup">
        <div class="popup-content">
          <div class="popup-header">
            <div class="popup-title">Trainer Buffs</div>
            <button class="popup-close" id="closeTrainerBuffs">×</button>
          </div>
          <div class="popup-body" id="trainerBuffsContent"></div>
        </div>
      </div>

      <div class="popup-overlay" id="specializationPopup">
        <div class="popup-content">
          <div class="popup-header">
            <div class="popup-title">Specialization</div>
            <button class="popup-close" id="closeSpecialization">×</button>
          </div>
          <div class="popup-body" id="specializationContent"></div>
        </div>
      </div>

      <div class="popup-overlay" id="trainerPathPopup">
        <div class="popup-content">
          <div class="popup-header">
            <div class="popup-title">Trainer Path</div>
            <button class="popup-close" id="closeTrainerPath">×</button>
          </div>
          <div class="popup-body" id="trainerPathContent"></div>
        </div>
      </div>

      <div class="popup-overlay" id="affinityPopup">
        <div class="popup-content">
          <div class="popup-header">
            <div class="popup-title">Affinity</div>
            <button class="popup-close" id="closeAffinity">×</button>
          </div>
          <div class="popup-body" id="affinityContent"></div>
        </div>
      </div>

      <div class="popup-overlay" id="affinitySelectionPopup">
        <div class="popup-content">
          <div class="popup-header">
            <div class="popup-title">Select Affinity</div>
            <button class="popup-close" id="closeAffinitySelection">×</button>
          </div>
          <div class="popup-body">
            <div class="affinity-grid"></div>
            <div class="affinity-selection-effect-box">Select an affinity to see its effect.</div>
            <div class="popup-footer">
              <button id="chooseAffinityButton" class="popup-button" disabled>Choose Affinity</button>
            </div>
          </div>
        </div>
      </div>

      <div class="popup-overlay" id="specializationSelectionPopup">
        <div class="popup-content">
          <div class="popup-header">
            <div class="popup-title">Select Specialization</div>
            <button class="popup-close" id="closeSpecializationSelection">×</button>
          </div>
          <div class="popup-body">
            <div class="specialization-grid"></div>
            <div class="specialization-selection-effect-box">Select a specialization to see its effect.</div>
            <div class="popup-footer">
              <button id="chooseSpecializationButton" class="popup-button" disabled>Choose Specialization</button>
            </div>
          </div>
        </div>
      </div>

      <div class="popup-overlay" id="trainerPathSelectionPopup">
        <div class="popup-content">
          <div class="popup-header">
            <div class="popup-title">Select Trainer Path</div>
            <button class="popup-close" id="closeTrainerPathSelection">×</button>
          </div>
          <div class="popup-body">
            <div class="trainer-path-grid"></div>
            <div class="trainer-path-selection-effect-box">Select a trainer path to see its effect.</div>
            <div class="popup-footer">
              <button id="chooseTrainerPathButton" class="popup-button" disabled>Choose Trainer Path</button>
            </div>
          </div>
        </div>
      </div>

      <div class="popup-overlay" id="shortRestPokemonSelectionPopup">
        <div class="popup-content">
          <div class="popup-header">
            <div class="popup-title">Select Pokemon to Restore</div>
            <button class="popup-close" id="closeShortRestPokemonSelection">×</button>
          </div>
          <div class="popup-body">
            <div class="pokemon-selection-grid"></div>
            <div class="popup-footer">
              <button id="completeShortRestButton" class="popup-button" disabled>Complete Short Rest</button>
            </div>
          </div>
        </div>
      </div>

      <div class="popup-overlay" id="gearPopup">
        <div class="popup-content">
          <div class="popup-header">
            <div class="popup-title">Gear</div>
            <button class="popup-close" id="closeGear">×</button>
          </div>
          <div class="popup-body" id="gearContent"></div>
        </div>
      </div>

      <div class="popup-overlay" id="featsPopup">
        <div class="popup-content">
          <div class="popup-header">
            <div class="popup-title">Feats</div>
            <button class="popup-close" id="closeFeats">×</button>
          </div>
          <div class="popup-body" id="featsContent"></div>
        </div>
      </div>

      <div class="popup-overlay" id="combatTrackerPopup">
        <div class="popup-content">
          <div class="popup-header">
            <div class="popup-title">Combat Tracker</div>
            <button class="popup-close" id="closeCombatTracker">×</button>
          </div>
          <div class="popup-body">
            <div class="combat-tracker-container">
              <div class="combat-stats-row">
                <div class="combat-stat-column">
                  <div class="combat-stat-label">HP</div>
                  <div class="combat-stat-value" id="combatCurrentHP">${currentHP} / ${trainerHP}</div>
                  <input type="number" class="combat-input" id="hpChangeInput" placeholder="HP Amount">
                </div>
                <div class="combat-stat-column">
                  <div class="combat-stat-label">VP</div>
                  <div class="combat-stat-value" id="combatCurrentVP">${currentVP} / ${trainerVP}</div>
                  <input type="number" class="combat-input" id="vpChangeInput" placeholder="VP Amount">
                </div>
              </div>
              <div class="combat-controls">
                <button class="combat-button add" id="addStats">
                  <span class="btn-icon">➕</span>
                  <span class="btn-text">Add</span>
                </button>
                <button class="combat-button remove" id="removeStats">
                  <span class="btn-icon">➖</span>
                  <span class="btn-text">Remove</span>
                </button>
                <button class="combat-button restore" id="fullRestore">
                  <span class="btn-icon">✨</span>
                  <span class="btn-text">Full Restore</span>
                </button>
              </div>
            </div>
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

  // Helper function to open popup
  const openPopup = (popupId) => {
    document.getElementById(popupId)?.classList.add('active');
  };

  // Helper function to close popup
  const closePopup = (popupId) => {
    document.getElementById(popupId)?.classList.remove('active');
  };

  // Close popups when clicking overlay
  document.querySelectorAll('.popup-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.remove('active');
      }
    });
  });

  // Back button
  document.getElementById('backButton')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('navigate', {
      detail: { route: 'trainer-card' }
    }));
  });

  // Trainer Image button (Edit Trainer)
  document.getElementById('trainerImageButton')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('navigate', {
      detail: { route: 'edit-trainer' }
    }));
  });

  // Helper function to refresh inventory display
  function refreshInventoryDisplay() {
    // Reload fresh trainer data from sessionStorage
    const freshTrainerDataStr = sessionStorage.getItem('trainerData');
    if (!freshTrainerDataStr) return;

    const freshTrainerData = JSON.parse(freshTrainerDataStr);
    const inventory = freshTrainerData[20] || 'None';
    const itemsStr = sessionStorage.getItem('items');
    const categoriesContainer = document.getElementById('inventoryCategories');

    if (inventory === 'None' || !inventory || !itemsStr) {
      categoriesContainer.innerHTML = '<li style="padding: 2rem; text-align: center; color: #999;">No items in inventory</li>';
      openPopup('inventoryPopup');
      return;
    }

    // Parse items data and group by type
    const itemsData = JSON.parse(itemsStr);
    const inventoryItems = inventory.split(',').map(item => item.trim()).filter(item => item);

    // Extract item name and quantity
    const groupedItems = {};
    inventoryItems.forEach(itemStr => {
      const match = itemStr.match(/^(.+?)\s*\(x(\d+)\)$/);
      const itemName = match ? match[1].trim() : itemStr;
      const quantity = match ? parseInt(match[2], 10) : 1;

      const itemData = itemsData.find(i => i.name === itemName);
      if (itemData) {
        const type = itemData.type || 'Misc';
        if (!groupedItems[type]) {
          groupedItems[type] = [];
        }
        groupedItems[type].push({
          name: itemData.name,
          description: itemData.description || 'No description available',
          effect: itemData.effect || 'No effect description',
          quantity: quantity,
          fullData: itemData
        });
      }
    });

    // Generate category list HTML
    let html = '';
    Object.keys(groupedItems).sort().forEach(type => {
      html += `
        <li>
          <div class="category-header" data-category="${type}">
            <span>${type}</span>
            <span class="arrow">▶</span>
          </div>
          <div class="item-list">
            ${groupedItems[type].map(item => `
              <div class="inventory-list-item" data-item='${JSON.stringify(item)}'>
                ${item.name} (x${item.quantity})
              </div>
            `).join('')}
          </div>
        </li>
      `;
    });

    categoriesContainer.innerHTML = html;

    // Add category toggle listeners
    document.querySelectorAll('.category-header').forEach(header => {
      header.addEventListener('click', function() {
        const itemList = this.nextElementSibling;
        const isExpanded = itemList.classList.contains('expanded');

        // Close all categories
        document.querySelectorAll('.item-list').forEach(list => list.classList.remove('expanded'));
        document.querySelectorAll('.category-header').forEach(h => h.classList.remove('active'));

        // Open clicked category
        if (!isExpanded) {
          itemList.classList.add('expanded');
          this.classList.add('active');
        }
      });
    });

    // Add item selection listeners
    document.querySelectorAll('.inventory-list-item').forEach(itemElement => {
      itemElement.addEventListener('click', function() {
        // Remove previous selection
        document.querySelectorAll('.inventory-list-item').forEach(el => el.classList.remove('selected'));

        // Select current item
        this.classList.add('selected');
        selectedItemData = JSON.parse(this.dataset.item);

        // Update info panel
        document.getElementById('selectedItemName').textContent = `${selectedItemData.name} (x${selectedItemData.quantity})`;
        document.getElementById('descriptionText').textContent = selectedItemData.description;
        document.getElementById('effectText').textContent = selectedItemData.effect;

        // Enable edit/remove buttons
        document.getElementById('editItemButton').disabled = false;
        document.getElementById('removeItemButton').disabled = false;
      });
    });

    // Add Item button - Opens add modal
    document.getElementById('addItemButton')?.addEventListener('click', function() {
      document.getElementById('addItemModal').style.display = 'block';
      document.getElementById('itemSearch').value = '';
      document.getElementById('itemQuantity').value = '1';
      document.getElementById('autocompleteResults').style.display = 'none';
      setupItemAutocomplete();
    });

    // Edit Item button - Opens edit modal
    document.getElementById('editItemButton')?.addEventListener('click', function() {
      if (!selectedItemData) return;

      document.getElementById('editingItemName').textContent = `${selectedItemData.name} (x${selectedItemData.quantity})`;
      document.getElementById('editItemQuantity').value = selectedItemData.quantity;
      document.getElementById('editItemModal').style.display = 'block';
    });

    // Remove Item button - Opens remove confirmation modal
    document.getElementById('removeItemButton')?.addEventListener('click', function() {
      if (!selectedItemData) return;

      document.getElementById('itemToRemove').textContent = `${selectedItemData.name} (x${selectedItemData.quantity})`;
      document.getElementById('removeItemModal').style.display = 'block';
    });

    openPopup('inventoryPopup');
  }

  // Helper function to get max charges for a buff based on trainer level
  function getMaxCharges(buffName, trainerLevel) {
    switch (buffName) {
      case 'Second Wind':
        if (trainerLevel >= 7) return 5;
        if (trainerLevel >= 3) return 2;
        return 0;
      case 'Rapid Orders':
        return trainerLevel >= 6 ? 1 : 0;
      case 'Unbreakable Bond':
        return trainerLevel >= 13 ? 1 : 0;
      case 'Elemental Synergy':
        return trainerLevel >= 18 ? 1 : 0;
      case 'Master Trainer':
        return trainerLevel >= 20 ? 2 : 0;
      default:
        return 0;
    }
  }

  // Helper function to create charge indicator dots
  function createChargeDots(currentCharges, maxCharges) {
    if (maxCharges === 0) return '';

    let dotsHTML = '<div class="charge-dots">';
    for (let i = 0; i < maxCharges; i++) {
      const filled = i < currentCharges;
      dotsHTML += `<span class="charge-dot ${filled ? 'filled' : 'empty'}"></span>`;
    }
    dotsHTML += '</div>';
    return dotsHTML;
  }

  // Helper function to use a buff (decrement charge)
  function useBuff(buffName, chargeIndex) {
    const trainerDataRaw = sessionStorage.getItem('trainerData');
    if (!trainerDataRaw) {
      showError('Trainer data not found.');
      return;
    }

    const trainerData = JSON.parse(trainerDataRaw);
    const currentCharges = parseInt(trainerData[chargeIndex], 10) || 0;

    if (currentCharges <= 0) {
      showError(`No charges remaining for ${buffName}`);
      return;
    }

    // Decrement charge
    trainerData[chargeIndex] = currentCharges - 1;

    // Update session storage IMMEDIATELY
    sessionStorage.setItem('trainerData', JSON.stringify(trainerData));

    // Refresh the popup to show updated charges IMMEDIATELY
    showTrainerSkillsPopup();

    // Update database in background (non-blocking)
    TrainerAPI.update(trainerData).catch(error => {
      console.error('Error updating trainer data:', error);
      showError('Failed to save buff usage to database');
    });
  }

  // Helper function to handle short rest (shows Pokemon selection popup)
  async function handleShortRest() {
    const trainerDataRaw = sessionStorage.getItem('trainerData');
    if (!trainerDataRaw) {
      showError('Trainer data not found.');
      return;
    }

    const trainerData = JSON.parse(trainerDataRaw);
    const trainerName = trainerData[1];

    // Get all Pokemon for this trainer
    const registeredPokemonStr = sessionStorage.getItem('registeredPokemon');
    if (!registeredPokemonStr) {
      showError('No Pokemon data found.');
      return;
    }

    const registeredPokemon = JSON.parse(registeredPokemonStr);

    // Filter for active party Pokemon
    const activePokemon = registeredPokemon.filter(pokemon => {
      return pokemon[0] === trainerName && pokemon[38] === true; // index 38 is isInActiveParty
    });

    if (activePokemon.length === 0) {
      showError('No Pokemon in active party.');
      return;
    }

    // Show Pokemon selection popup
    showShortRestPokemonSelection(activePokemon);
  }

  // Helper function to handle long rest (restores trainer HP/VP, buff charges, and active Pokemon HP/VP)
  async function handleLongRest() {
    const trainerDataRaw = sessionStorage.getItem('trainerData');
    if (!trainerDataRaw) {
      showError('Trainer data not found.');
      return;
    }

    const trainerData = JSON.parse(trainerDataRaw);
    const trainerLevel = parseInt(trainerData[2], 10);
    const trainerName = trainerData[1];

    // Restore trainer HP and VP to max
    const maxHP = parseInt(trainerData[11], 10);
    const maxVP = parseInt(trainerData[12], 10);
    trainerData[34] = maxHP; // currentHP
    trainerData[35] = maxVP; // currentVP

    // Refill all buff charges to max (excluding Rapid Orders - index 41)
    trainerData[40] = getMaxCharges('Second Wind', trainerLevel);
    trainerData[42] = getMaxCharges('Unbreakable Bond', trainerLevel);
    trainerData[43] = getMaxCharges('Elemental Synergy', trainerLevel);
    trainerData[44] = getMaxCharges('Master Trainer', trainerLevel);

    // Update session storage IMMEDIATELY
    sessionStorage.setItem('trainerData', JSON.stringify(trainerData));

    // Refresh the popup to show updated charges IMMEDIATELY
    showTrainerSkillsPopup();

    // Show success message
    showSuccess('Long rest completed! Trainer and active Pokemon fully restored, buff charges refilled.');

    // Update trainer in database (non-blocking)
    TrainerAPI.update(trainerData).catch(error => {
      console.error('Error updating trainer data:', error);
      showError('Failed to save long rest to database');
    });

    // Restore active Pokemon HP/VP in background
    restoreActivePokemonHP(trainerName);
  }

  // Helper function to restore all active Pokemon HP/VP to full
  async function restoreActivePokemonHP(trainerName) {
    try {
      // Get all Pokemon for this trainer from session storage
      const allPokemonKeys = Object.keys(sessionStorage).filter(key => key.startsWith('pokemon_'));

      for (const key of allPokemonKeys) {
        const pokemonDataStr = sessionStorage.getItem(key);
        if (!pokemonDataStr) continue;

        const pokemonData = JSON.parse(pokemonDataStr);

        // Check if this Pokemon belongs to current trainer and is in active party
        if (pokemonData[0] === trainerName && pokemonData[38]) { // trainername at 0, isInActiveParty at 38
          // Restore HP and VP to max
          const maxHP = parseInt(pokemonData[10], 10); // HP at index 10
          const maxVP = parseInt(pokemonData[12], 10); // VP at index 12
          pokemonData[45] = maxHP; // currentHP at index 45
          pokemonData[46] = maxVP; // currentVP at index 46

          // Update session storage
          sessionStorage.setItem(key, JSON.stringify(pokemonData));

          // Update database in background
          PokemonAPI.update(pokemonData).catch(error => {
            console.error(`Error updating Pokemon ${pokemonData[2]}:`, error);
          });
        }
      }
    } catch (error) {
      console.error('Error restoring active Pokemon HP:', error);
    }
  }

  // Helper function to show Trainer Buffs popup
  function showTrainerSkillsPopup() {
    const trainerDataRaw = sessionStorage.getItem('trainerData');
    if (!trainerDataRaw) {
      showError('Trainer data not found.');
      return;
    }

    const trainerData = JSON.parse(trainerDataRaw);
    const trainerLevel = parseInt(trainerData[2], 10); // Trainer level

    // Get buff charges from trainer data (indices 40-44)
    // Note: index 41 (Rapid Orders) is not tracked as it's once per turn
    const secondWindCharges = parseInt(trainerData[40], 10) || 0;
    const unbreakableBondCharges = parseInt(trainerData[42], 10) || 0;
    const elementalSynergyCharges = parseInt(trainerData[43], 10) || 0;
    const masterTrainerCharges = parseInt(trainerData[44], 10) || 0;

    // Fetch skills and nationalities data from sessionStorage
    const skillsDataRaw = sessionStorage.getItem('skills');
    const nationalitiesDataRaw = sessionStorage.getItem('nationalities');

    if (!skillsDataRaw || !nationalitiesDataRaw) {
      showError('Skills or nationalities data not found.');
      return;
    }

    const skillsData = JSON.parse(skillsDataRaw);
    const nationalitiesData = JSON.parse(nationalitiesDataRaw);
    const nationality = nationalitiesData.find(n => n.nationality === trainerData[38]);

    // Build the popup content
    let content = '';

    // Add rest buttons at the top
    content += `
      <div class="rest-buttons-container">
        <button class="rest-button short-rest-button" id="shortRestButton">
          <span class="rest-icon">☀️</span>
          Short Rest
        </button>
        <button class="rest-button long-rest-button" id="longRestButton">
          <span class="rest-icon">🌙</span>
          Long Rest
        </button>
      </div>
    `;

    // Add nationality region buff first if it exists
    if (nationality) {
      content += `
        <div class="skill-item-container">
          <h3 class="skill-name-header">${nationality.regionBuff}</h3>
          <div class="skill-effect-box">${nationality.effect}</div>
        </div>
      `;
    }

    // Track skills by name to handle duplicates (higher level versions)
    const skillsByName = new Map();

    // Define the trainer buff skills with their charge data
    // Note: Rapid Orders is excluded as it's once per turn (no charge tracking needed)
    const trainerBuffs = [
      { name: 'Second Wind', charges: secondWindCharges, index: 40 },
      { name: 'Unbreakable Bond', charges: unbreakableBondCharges, index: 42 },
      { name: 'Elemental Synergy', charges: elementalSynergyCharges, index: 43 },
      { name: 'Master Trainer', charges: masterTrainerCharges, index: 44 }
    ];

    // Loop through each skill and display them
    skillsData.forEach(skill => {
      const skillLevel = skill.level;
      const skillName = skill.name;
      let skillEffect;

      // Show the effect if the trainer's level is high enough, otherwise show lock message
      if (trainerLevel >= skillLevel) {
        skillEffect = skill.fullEffect; // Use full effect for unlocked skills
      } else {
        skillEffect = `Unlocks at level ${skillLevel}`;
      }

      // Check if we already have this skill name
      const existingSkill = skillsByName.get(skillName);

      if (existingSkill) {
        // If the current skill's level is higher and unlocked, update the existing skill's effect
        if (trainerLevel >= skillLevel && skillLevel > existingSkill.level) {
          skillsByName.set(skillName, { level: skillLevel, effect: skillEffect, isUnlocked: trainerLevel >= skillLevel });
        }
      } else {
        // Add new skill
        skillsByName.set(skillName, { level: skillLevel, effect: skillEffect, isUnlocked: trainerLevel >= skillLevel });
      }
    });

    // Build HTML for all skills (with charge tracking for trainer buffs)
    skillsByName.forEach((skillData, skillName) => {
      // Check if this skill is a trainer buff
      const buffData = trainerBuffs.find(b => b.name === skillName);

      if (buffData && skillData.isUnlocked) {
        const maxCharges = getMaxCharges(buffData.name, trainerLevel);
        const chargeDots = createChargeDots(buffData.charges, maxCharges);
        const useButtonDisabled = buffData.charges <= 0 ? 'disabled' : '';

        content += `
          <div class="skill-item-container">
            <div class="skill-header-row">
              <h3 class="skill-name-header">${skillName}</h3>
              ${chargeDots}
            </div>
            <div class="skill-effect-box">${skillData.effect}</div>
            <button class="use-buff-button" data-buff-name="${buffData.name}" data-buff-index="${buffData.index}" ${useButtonDisabled}>Use</button>
          </div>
        `;
      } else {
        content += `
          <div class="skill-item-container">
            <h3 class="skill-name-header">${skillName}</h3>
            <div class="skill-effect-box">${skillData.effect}</div>
          </div>
        `;
      }
    });

    // Set the content
    document.getElementById('trainerBuffsContent').innerHTML = content;

    // Add event listeners to Use buttons
    document.querySelectorAll('.use-buff-button').forEach(button => {
      button.addEventListener('click', () => {
        const buffName = button.dataset.buffName;
        const buffIndex = parseInt(button.dataset.buffIndex, 10);
        useBuff(buffName, buffIndex);
      });
    });

    // Add event listeners to Rest buttons
    document.getElementById('shortRestButton')?.addEventListener('click', () => {
      handleShortRest();
    });

    document.getElementById('longRestButton')?.addEventListener('click', () => {
      handleLongRest();
    });

    // Open the popup
    openPopup('trainerBuffsPopup');
  }

  // Inventory button - calls the refresh function
  document.getElementById('inventoryButton')?.addEventListener('click', () => {
    refreshInventoryDisplay();
  });

  document.getElementById('closeInventory')?.addEventListener('click', () => closePopup('inventoryPopup'));

  // Trainer Buffs button
  document.getElementById('trainerBuffsButton')?.addEventListener('click', () => {
    showTrainerSkillsPopup();
  });

  document.getElementById('closeTrainerBuffs')?.addEventListener('click', () => closePopup('trainerBuffsPopup'));

  // ============================================================================
  // INVENTORY MODAL HANDLERS
  // ============================================================================

  // Add Item Modal - Confirm button
  document.getElementById('confirmAddItem')?.addEventListener('click', function() {
    const selectedItemName = document.getElementById('itemSearch').value.trim();
    const quantity = parseInt(document.getElementById('itemQuantity').value, 10);

    if (!selectedItemName || quantity < 1) {
      alert('Please select a valid item and quantity.');
      return;
    }

    const trainerDataRaw = sessionStorage.getItem('trainerData');
    if (!trainerDataRaw) {
      alert('Trainer data not found.');
      return;
    }

    const trainerData = JSON.parse(trainerDataRaw);
    const inventoryStr = trainerData[20] || '';
    let inventoryItems = inventoryStr && inventoryStr !== 'None'
      ? inventoryStr.split(',').map(item => item.trim()).filter(item => item)
      : [];

    // Check if item already exists
    let found = false;
    inventoryItems = inventoryItems.map(itemStr => {
      const match = itemStr.match(/^(.+?)\s*\(x(\d+)\)$/);
      const itemName = match ? match[1].trim() : itemStr;
      const currentQty = match ? parseInt(match[2], 10) : 1;

      if (itemName.toLowerCase() === selectedItemName.toLowerCase()) {
        found = true;
        const newQty = currentQty + quantity;
        return `${itemName} (x${newQty})`;
      }
      return itemStr;
    });

    // If not found, add as new item
    if (!found) {
      inventoryItems.push(`${selectedItemName} (x${quantity})`);
    }

    // Update sessionStorage
    trainerData[20] = inventoryItems.join(', ');
    sessionStorage.setItem('trainerData', JSON.stringify(trainerData));

    // Show loading overlay
    const modal = document.getElementById('addItemModal');
    modal.style.opacity = '0.5';
    modal.style.pointerEvents = 'none';

    // Update database
    import('../api.js').then(({ TrainerAPI }) => {
      TrainerAPI.update(trainerData).then(() => {
        // Close modal
        modal.style.display = 'none';
        modal.style.opacity = '1';
        modal.style.pointerEvents = 'auto';

        // Refresh inventory display with updated data
        refreshInventoryDisplay();
      }).catch(error => {
        console.error('Failed to update inventory in database:', error);
        modal.style.opacity = '1';
        modal.style.pointerEvents = 'auto';
        alert('Failed to save to database. Please try again.');
      });
    });
  });

  // Add Item Modal - Cancel button
  document.getElementById('cancelAddItem')?.addEventListener('click', function() {
    document.getElementById('addItemModal').style.display = 'none';
  });

  // Edit Item Modal - Increment button
  document.getElementById('incrementQty')?.addEventListener('click', function() {
    const input = document.getElementById('editItemQuantity');
    const currentValue = parseInt(input.value) || 0;
    input.value = currentValue + 1;
  });

  // Edit Item Modal - Decrement button
  document.getElementById('decrementQty')?.addEventListener('click', function() {
    const input = document.getElementById('editItemQuantity');
    const currentValue = parseInt(input.value) || 0;
    if (currentValue > 0) {
      input.value = currentValue - 1;
    }
  });

  // Edit Item Modal - Confirm button
  document.getElementById('confirmEditItem')?.addEventListener('click', function() {
    const newQuantity = parseInt(document.getElementById('editItemQuantity').value, 10);

    if (isNaN(newQuantity) || newQuantity < 0) {
      alert('Please enter a valid quantity (0 or greater).');
      return;
    }

    const trainerDataRaw = sessionStorage.getItem('trainerData');
    if (!trainerDataRaw) {
      alert('Trainer data not found.');
      return;
    }

    const trainerData = JSON.parse(trainerDataRaw);
    const inventoryStr = trainerData[20] || '';
    let inventoryItems = inventoryStr && inventoryStr !== 'None'
      ? inventoryStr.split(',').map(item => item.trim()).filter(item => item)
      : [];

    // Find the item by parsing each string
    let found = false;
    inventoryItems = inventoryItems.filter(itemStr => {
      const match = itemStr.match(/^(.+?)\s*\(x(\d+)\)$/);
      const itemName = match ? match[1].trim() : itemStr;

      if (itemName.toLowerCase() === selectedItemData.name.toLowerCase()) {
        found = true;
        if (newQuantity === 0) {
          // Remove item if quantity is 0
          return false; // Filter out this item
        } else {
          // Update quantity - will be handled in map below
          return true;
        }
      }
      return true;
    }).map(itemStr => {
      const match = itemStr.match(/^(.+?)\s*\(x(\d+)\)$/);
      const itemName = match ? match[1].trim() : itemStr;

      if (itemName.toLowerCase() === selectedItemData.name.toLowerCase()) {
        return `${itemName} (x${newQuantity})`;
      }
      return itemStr;
    });

    if (found) {
      // Update sessionStorage
      trainerData[20] = inventoryItems.length > 0 ? inventoryItems.join(', ') : 'None';
      sessionStorage.setItem('trainerData', JSON.stringify(trainerData));

      // Show loading overlay
      const modal = document.getElementById('editItemModal');
      modal.style.opacity = '0.5';
      modal.style.pointerEvents = 'none';

      // Update database
      import('../api.js').then(({ TrainerAPI }) => {
        TrainerAPI.update(trainerData).then(() => {
          // Close modal
          modal.style.display = 'none';
          modal.style.opacity = '1';
          modal.style.pointerEvents = 'auto';

          // Refresh inventory display with updated data
          refreshInventoryDisplay();
        }).catch(error => {
          console.error('Failed to update inventory in database:', error);
          modal.style.opacity = '1';
          modal.style.pointerEvents = 'auto';
          alert('Failed to save to database. Please try again.');
        });
      });
    }
  });

  // Edit Item Modal - Cancel button
  document.getElementById('cancelEditItem')?.addEventListener('click', function() {
    document.getElementById('editItemModal').style.display = 'none';
  });

  // Remove Item Modal - Confirm button
  document.getElementById('confirmRemoveItem')?.addEventListener('click', function() {
    const trainerDataRaw = sessionStorage.getItem('trainerData');
    if (!trainerDataRaw) {
      alert('Trainer data not found.');
      return;
    }

    const trainerData = JSON.parse(trainerDataRaw);
    const inventoryStr = trainerData[20] || '';
    let inventoryItems = inventoryStr && inventoryStr !== 'None'
      ? inventoryStr.split(',').map(item => item.trim()).filter(item => item)
      : [];

    // Find and remove item by parsing each string
    let found = false;
    inventoryItems = inventoryItems.filter(itemStr => {
      const match = itemStr.match(/^(.+?)\s*\(x(\d+)\)$/);
      const itemName = match ? match[1].trim() : itemStr;

      if (itemName.toLowerCase() === selectedItemData.name.toLowerCase()) {
        found = true;
        return false; // Filter out this item
      }
      return true;
    });

    if (found) {
      // Update sessionStorage
      trainerData[20] = inventoryItems.length > 0 ? inventoryItems.join(', ') : 'None';
      sessionStorage.setItem('trainerData', JSON.stringify(trainerData));

      // Show loading overlay
      const modal = document.getElementById('removeItemModal');
      modal.style.opacity = '0.5';
      modal.style.pointerEvents = 'none';

      // Update database
      import('../api.js').then(({ TrainerAPI }) => {
        TrainerAPI.update(trainerData).then(() => {
          // Close modal
          modal.style.display = 'none';
          modal.style.opacity = '1';
          modal.style.pointerEvents = 'auto';

          // Refresh inventory display with updated data
          refreshInventoryDisplay();
        }).catch(error => {
          console.error('Failed to update inventory in database:', error);
          modal.style.opacity = '1';
          modal.style.pointerEvents = 'auto';
          alert('Failed to save to database. Please try again.');
        });
      });
    }
  });

  // Remove Item Modal - Cancel button
  document.getElementById('cancelRemoveItem')?.addEventListener('click', function() {
    document.getElementById('removeItemModal').style.display = 'none';
  });

  // Autocomplete Setup Function
  function setupItemAutocomplete() {
    const searchInput = document.getElementById('itemSearch');
    const resultsDiv = document.getElementById('autocompleteResults');

    if (!searchInput || !resultsDiv) return;

    // Remove existing listeners by cloning
    const newSearchInput = searchInput.cloneNode(true);
    searchInput.parentNode.replaceChild(newSearchInput, searchInput);

    // Get new reference
    const itemSearch = document.getElementById('itemSearch');
    const autocompleteResults = document.getElementById('autocompleteResults');

    // Add input listener
    itemSearch.addEventListener('input', function() {
      const searchValue = this.value.toLowerCase().trim();

      if (searchValue.length < 2) {
        autocompleteResults.style.display = 'none';
        autocompleteResults.innerHTML = '';
        return;
      }

      // Get items from sessionStorage
      const itemsDataRaw = sessionStorage.getItem('items');

      try {
        const itemsData = JSON.parse(itemsDataRaw);

        // Handle different data structures
        let itemsArray;
        if (Array.isArray(itemsData)) {
          itemsArray = itemsData;
        } else if (itemsData && itemsData.items && Array.isArray(itemsData.items)) {
          itemsArray = itemsData.items;
        } else if (itemsData && itemsData.status === 'success' && itemsData.items) {
          itemsArray = itemsData.items;
        } else {
          console.error('Items data is not in expected format:', itemsData);
          return;
        }

        // Filter matches with normalization
        const matches = itemsArray.filter(item => {
          if (item && item.name) {
            const normalizedItemName = item.name.toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "");
            const normalizedSearchValue = searchValue
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "");

            return normalizedItemName.includes(normalizedSearchValue);
          }
          return false;
        }).slice(0, 10); // Limit to 10 results

        // Clear previous results
        autocompleteResults.innerHTML = '';

        if (matches.length > 0) {
          matches.forEach(item => {
            const div = document.createElement('div');
            div.className = 'autocomplete-item';
            div.textContent = item.name;
            div.addEventListener('click', function() {
              itemSearch.value = item.name;
              autocompleteResults.style.display = 'none';
              autocompleteResults.innerHTML = '';
            });
            autocompleteResults.appendChild(div);
          });
          autocompleteResults.style.display = 'block';
        } else {
          autocompleteResults.style.display = 'none';
        }
      } catch (error) {
        console.error('Error parsing items data:', error);
      }
    });

    // Hide autocomplete when clicking outside
    document.addEventListener('click', function(e) {
      if (!itemSearch.contains(e.target) && !autocompleteResults.contains(e.target)) {
        autocompleteResults.style.display = 'none';
      }
    });
  }

  // Specialization button - fixed to show 3 stages with effects
  document.getElementById('specializationButton')?.addEventListener('click', () => {
    // Read fresh data from sessionStorage each time
    const freshTrainerData = JSON.parse(sessionStorage.getItem('trainerData'));
    if (!freshTrainerData) return;

    const trainerLevel = parseInt(freshTrainerData[2], 10) || 1;
    const specializationsStr = freshTrainerData[24] || '';
    const specializationsStored = specializationsStr ? specializationsStr.split(',').map(s => s.trim()) : [];
    const specializationsDataStr = sessionStorage.getItem('specializations');
    const content = document.getElementById('specializationContent');

    const specializationStages = [
      { level: 2, index: 0, label: 'First Specialization' },
      { level: 10, index: 1, label: 'Second Specialization' },
      { level: 17, index: 2, label: 'Third Specialization' }
    ];

    let html = '';

    specializationStages.forEach(stage => {
      if (trainerLevel >= stage.level && specializationsStored.length > stage.index) {
        // Specialization is unlocked and chosen
        const specName = specializationsStored[stage.index];
        let effect = 'No effect found.';

        if (specializationsDataStr) {
          const specializationsData = JSON.parse(specializationsDataStr);
          const specData = specializationsData.find(s => s.name === specName);
          if (specData) {
            effect = specData.effect || 'No effect found.';
          }
        }

        html += `
          <div class="popup-item">
            <div class="popup-item-title">${specName}</div>
            <div class="popup-item-effect">${effect}</div>
          </div>
        `;
      } else if (trainerLevel >= stage.level) {
        // Unlocked but not chosen
        html += `
          <div class="popup-item">
            <div class="popup-item-title">${stage.label}</div>
            <div class="popup-item-effect">
              <button class="popup-button" onclick="showSpecializationSelection()">Select Specialization</button>
            </div>
          </div>
        `;
      } else {
        // Locked
        html += `
          <div class="popup-item popup-item-locked">
            <div class="popup-item-title">${stage.label}</div>
            <div class="popup-item-effect">Unlocks at level ${stage.level}</div>
          </div>
        `;
      }
    });

    content.innerHTML = html || '<p style="text-align: center; color: #999;">No specializations available.</p>';
    openPopup('specializationPopup');
  });

  document.getElementById('closeSpecialization')?.addEventListener('click', () => closePopup('specializationPopup'));

  // Trainer Path button - fixed to show 4 stages with effects
  document.getElementById('trainerPathButton')?.addEventListener('click', () => {
    // Read fresh data from sessionStorage each time
    const freshTrainerData = JSON.parse(sessionStorage.getItem('trainerData'));
    if (!freshTrainerData) return;

    const trainerLevel = parseInt(freshTrainerData[2], 10) || 1;
    const trainerPathName = freshTrainerData[25] || '';
    const trainerPathsDataStr = sessionStorage.getItem('trainerPaths');
    const content = document.getElementById('trainerPathContent');

    if (!trainerPathName || trainerPathName === 'None') {
      // Show selection UI
      if (trainerLevel >= 3) {
        showTrainerPathSelection();
      } else {
        content.innerHTML = '<p style="text-align: center; color: #999;">Trainer Path unlocks at level 3.</p>';
        openPopup('trainerPathPopup');
      }
      return;
    }

    let html = '';

    if (trainerPathsDataStr) {
      const trainerPathsData = JSON.parse(trainerPathsDataStr);
      const selectedPath = trainerPathsData.find(p => p.name === trainerPathName);

      if (selectedPath) {
        const pathStages = [
          { level: 3, data: selectedPath.level3 },
          { level: 5, data: selectedPath.level5 },
          { level: 9, data: selectedPath.level9 },
          { level: 15, data: selectedPath.level15 }
        ];

        pathStages.forEach(stage => {
          if (stage.data) {
            if (trainerLevel >= stage.level) {
              // Unlocked
              html += `
                <div class="popup-item">
                  <div class="popup-item-title">${stage.data.name}</div>
                  <div class="popup-item-effect">${stage.data.effect || 'No effect found.'}</div>
                </div>
              `;
            } else {
              // Locked
              html += `
                <div class="popup-item popup-item-locked">
                  <div class="popup-item-title">${stage.data.name}</div>
                  <div class="popup-item-effect">Unlocks at level ${stage.level}</div>
                </div>
              `;
            }
          }
        });
      } else {
        html = `<p style="text-align: center; color: #999;">Trainer path "${trainerPathName}" not found.</p>`;
      }
    } else {
      html = `
        <div class="popup-item">
          <div class="popup-item-title">${trainerPathName}</div>
          <div class="popup-item-effect">Path details not available</div>
        </div>
      `;
    }

    content.innerHTML = html || '<p style="text-align: center; color: #999;">No path stages available.</p>';
    openPopup('trainerPathPopup');
  });

  document.getElementById('closeTrainerPath')?.addEventListener('click', () => closePopup('trainerPathPopup'));

  // Affinity button - shows base effect at level 2, improved effect at level 7
  document.getElementById('affinityButton')?.addEventListener('click', () => {
    // Read fresh data from sessionStorage each time
    const freshTrainerData = JSON.parse(sessionStorage.getItem('trainerData'));
    if (!freshTrainerData) return;

    const trainerLevel = parseInt(freshTrainerData[2], 10) || 1;
    const affinitiesStr = freshTrainerData[23] || '';
    const affinitiesStored = affinitiesStr ? affinitiesStr.split(',').map(a => a.trim()).filter(a => a) : [];
    const affinitiesDataStr = sessionStorage.getItem('affinities');
    const content = document.getElementById('affinityContent');

    let html = '';

    // Check if affinity is selected
    if (affinitiesStored.length >= 1) {
      const affName = affinitiesStored[0];

      if (affinitiesDataStr) {
        const affinitiesData = JSON.parse(affinitiesDataStr);
        const affData = affinitiesData.find(a => a.name === affName);

        if (affData) {
          // Level 2-6: Show base effect
          if (trainerLevel >= 2 && trainerLevel < 7) {
            html += `
              <div class="popup-item">
                <div class="popup-item-title">${affName}</div>
                <div class="popup-item-effect">${affData.effect || 'No effect found.'}</div>
              </div>
              <div class="popup-item popup-item-locked">
                <div class="popup-item-title">${affName} (Improved)</div>
                <div class="popup-item-effect">Unlocks at level 7</div>
              </div>
            `;
          }
          // Level 7+: Show both base and improved effects
          else if (trainerLevel >= 7) {
            html += `
              <div class="popup-item">
                <div class="popup-item-title">${affName}</div>
                <div class="popup-item-effect">${affData.effect || 'No effect found.'}</div>
              </div>
              <div class="popup-item">
                <div class="popup-item-title">${affName} (Improved)</div>
                <div class="popup-item-effect">${affData.improvedEffect || 'No improved effect found.'}</div>
              </div>
            `;
          }
          // Below level 2: Not yet unlocked
          else {
            html += `
              <div class="popup-item popup-item-locked">
                <div class="popup-item-title">Affinity</div>
                <div class="popup-item-effect">Unlocks at level 2</div>
              </div>
            `;
          }
        } else {
          html = `<p style="text-align: center; color: #999;">Affinity "${affName}" not found in data.</p>`;
        }
      } else {
        html = `<p style="text-align: center; color: #999;">Affinity data not loaded.</p>`;
      }
    }
    // No affinity selected yet
    else {
      if (trainerLevel >= 2) {
        html += `
          <div class="popup-item">
            <div class="popup-item-title">Affinity</div>
            <div class="popup-item-effect">
              <button class="popup-button" onclick="showAffinitySelection()">Select Affinity</button>
            </div>
          </div>
        `;
      } else {
        html += `
          <div class="popup-item popup-item-locked">
            <div class="popup-item-title">Affinity</div>
            <div class="popup-item-effect">Unlocks at level 2</div>
          </div>
        `;
      }
    }

    content.innerHTML = html || '<p style="text-align: center; color: #999;">No affinities available.</p>';
    openPopup('affinityPopup');
  });

  document.getElementById('closeAffinity')?.addEventListener('click', () => closePopup('affinityPopup'));
  document.getElementById('closeAffinitySelection')?.addEventListener('click', () => closePopup('affinitySelectionPopup'));
  document.getElementById('closeSpecializationSelection')?.addEventListener('click', () => closePopup('specializationSelectionPopup'));
  document.getElementById('closeTrainerPathSelection')?.addEventListener('click', () => closePopup('trainerPathSelectionPopup'));
  document.getElementById('closeShortRestPokemonSelection')?.addEventListener('click', () => closePopup('shortRestPokemonSelectionPopup'));

  // Gear button
  document.getElementById('gearButton')?.addEventListener('click', () => {
    if (!trainerData) return;

    const gear = trainerData[37] || 'None';
    const content = document.getElementById('gearContent');

    if (gear === 'None' || !gear) {
      content.innerHTML = '<p style="text-align: center; color: #999;">No gear equipped.</p>';
      openPopup('gearPopup');
      return;
    }

    const gearList = gear.split(',').map(g => g.trim()).filter(g => g);
    const itemsStr = sessionStorage.getItem('items');
    let html = '';

    if (itemsStr) {
      const itemsData = JSON.parse(itemsStr);
      gearList.forEach(gearName => {
        const itemData = itemsData.find(i => i.name === gearName);
        if (itemData) {
          html += `
            <div class="popup-item">
              <div class="popup-item-title">${itemData.name}</div>
              <div class="popup-item-effect">${itemData.effect || 'No effect description'}</div>
            </div>
          `;
        } else {
          html += `
            <div class="popup-item">
              <div class="popup-item-title">${gearName}</div>
            </div>
          `;
        }
      });
    } else {
      gearList.forEach(gearName => {
        html += `
          <div class="popup-item">
            <div class="popup-item-title">${gearName}</div>
          </div>
        `;
      });
    }

    content.innerHTML = html;
    openPopup('gearPopup');
  });

  document.getElementById('closeGear')?.addEventListener('click', () => closePopup('gearPopup'));

  // Feats button
  document.getElementById('featsButton')?.addEventListener('click', () => {
    if (!trainerData) return;

    const feats = trainerData[33] || 'None';
    const content = document.getElementById('featsContent');

    if (feats === 'None' || !feats) {
      content.innerHTML = '<p style="text-align: center; color: #999;">No feats acquired.</p>';
      openPopup('featsPopup');
      return;
    }

    const featsList = feats.split(',').map(f => f.trim()).filter(f => f);
    const featsDataStr = sessionStorage.getItem('trainerFeats');
    let html = '';

    if (featsDataStr) {
      const featsData = JSON.parse(featsDataStr);
      featsList.forEach(featName => {
        const featData = featsData.find(f => f.name === featName);
        if (featData) {
          html += `
            <div class="popup-item">
              <div class="popup-item-title">${featData.name}</div>
              <div class="popup-item-effect">${featData.effect || 'No effect description'}</div>
            </div>
          `;
        } else {
          html += `
            <div class="popup-item">
              <div class="popup-item-title">${featName}</div>
            </div>
          `;
        }
      });
    } else {
      featsList.forEach(featName => {
        html += `
          <div class="popup-item">
            <div class="popup-item-title">${featName}</div>
          </div>
        `;
      });
    }

    content.innerHTML = html;
    openPopup('featsPopup');
  });

  document.getElementById('closeFeats')?.addEventListener('click', () => closePopup('featsPopup'));

  // HP/VP Combat Tracker buttons
  const openCombatTracker = () => {
    if (!trainerData) return;

    const currentHP = trainerData[34] !== null && trainerData[34] !== undefined && trainerData[34] !== ''
      ? parseInt(trainerData[34], 10)
      : parseInt(trainerData[11], 10);

    const currentVP = trainerData[35] !== null && trainerData[35] !== undefined && trainerData[35] !== ''
      ? parseInt(trainerData[35], 10)
      : parseInt(trainerData[12], 10);

    document.getElementById('combatCurrentHP').textContent = `${currentHP} / ${trainerData[11]}`;
    document.getElementById('combatCurrentVP').textContent = `${currentVP} / ${trainerData[12]}`;
    document.getElementById('hpChangeInput').value = '';
    document.getElementById('vpChangeInput').value = '';

    openPopup('combatTrackerPopup');
  };

  document.getElementById('currentHPButton')?.addEventListener('click', openCombatTracker);
  document.getElementById('currentVPButton')?.addEventListener('click', openCombatTracker);
  document.getElementById('closeCombatTracker')?.addEventListener('click', () => closePopup('combatTrackerPopup'));

  // Combined Add button - adds HP and/or VP
  document.getElementById('addStats')?.addEventListener('click', () => {
    const hpAmount = parseInt(document.getElementById('hpChangeInput').value, 10);
    const vpAmount = parseInt(document.getElementById('vpChangeInput').value, 10);

    let updated = false;

    // Add HP if amount provided
    if (!isNaN(hpAmount) && hpAmount > 0) {
      let currentHP = trainerData[34] !== null && trainerData[34] !== undefined && trainerData[34] !== ''
        ? parseInt(trainerData[34], 10)
        : parseInt(trainerData[11], 10);

      const baseHP = parseInt(trainerData[11], 10);
      currentHP = Math.min(currentHP + hpAmount, baseHP);

      trainerData[34] = currentHP;
      updated = true;
    }

    // Add VP if amount provided
    if (!isNaN(vpAmount) && vpAmount > 0) {
      let currentVP = trainerData[35] !== null && trainerData[35] !== undefined && trainerData[35] !== ''
        ? parseInt(trainerData[35], 10)
        : parseInt(trainerData[12], 10);

      const baseVP = parseInt(trainerData[12], 10);
      currentVP = Math.min(currentVP + vpAmount, baseVP);

      trainerData[35] = currentVP;
      updated = true;
    }

    if (updated) {
      sessionStorage.setItem('trainerData', JSON.stringify(trainerData));
      window.location.reload();
    }
  });

  // Combined Remove button - removes HP and/or VP
  document.getElementById('removeStats')?.addEventListener('click', () => {
    const hpAmount = parseInt(document.getElementById('hpChangeInput').value, 10);
    const vpAmount = parseInt(document.getElementById('vpChangeInput').value, 10);

    let updated = false;
    let currentHP = trainerData[34] !== null && trainerData[34] !== undefined && trainerData[34] !== ''
      ? parseInt(trainerData[34], 10)
      : parseInt(trainerData[11], 10);

    let currentVP = trainerData[35] !== null && trainerData[35] !== undefined && trainerData[35] !== ''
      ? parseInt(trainerData[35], 10)
      : parseInt(trainerData[12], 10);

    // Remove HP if amount provided
    if (!isNaN(hpAmount) && hpAmount > 0) {
      currentHP -= hpAmount;
      updated = true;
    }

    // Remove VP if amount provided
    if (!isNaN(vpAmount) && vpAmount > 0) {
      currentVP -= vpAmount;

      // If VP goes negative, transfer to HP
      if (currentVP < 0) {
        currentHP += currentVP; // currentVP is negative, so this subtracts from HP
        currentVP = 0;
      }

      updated = true;
    }

    if (updated) {
      trainerData[34] = currentHP;
      trainerData[35] = currentVP;
      sessionStorage.setItem('trainerData', JSON.stringify(trainerData));
      window.location.reload();
    }
  });

  // Full Restore button - fully heals HP and VP
  document.getElementById('fullRestore')?.addEventListener('click', () => {
    if (confirm('Are you sure you want to fully restore HP and VP?')) {
      // Reset current HP to max HP
      trainerData[34] = trainerData[11];
      // Reset current VP to max VP
      trainerData[35] = trainerData[12];

      sessionStorage.setItem('trainerData', JSON.stringify(trainerData));
      window.location.reload();
    }
  });
}

// ============================================================================
// AFFINITY SELECTION
// ============================================================================

// Make functions globally accessible for onclick handlers
window.showAffinitySelection = showAffinitySelection;
window.showSpecializationSelection = showSpecializationSelection;
window.showTrainerPathSelection = showTrainerPathSelection;

function showAffinitySelection() {
  const trainerData = JSON.parse(sessionStorage.getItem('trainerData'));
  const affinitiesData = JSON.parse(sessionStorage.getItem('affinities') || '[]');
  const affinitiesStored = trainerData[23] ? trainerData[23].split(',').map(a => a.trim()).filter(a => a) : [];

  const affinityGrid = document.querySelector('.affinity-grid');
  const affinityEffectBox = document.querySelector('.affinity-selection-effect-box');
  const chooseButton = document.getElementById('chooseAffinityButton');

  affinityGrid.innerHTML = '';
  affinityEffectBox.innerHTML = 'Select an affinity to see its effect.';
  chooseButton.disabled = true;

  // Create button for each affinity
  affinitiesData.forEach(affinity => {
    const button = document.createElement('div');
    button.className = 'affinity-item';
    button.textContent = affinity.name;
    button.onclick = () => selectAffinity(affinity);
    affinityGrid.appendChild(button);
  });

  // Show the popup using class-based approach
  document.getElementById('affinitySelectionPopup')?.classList.add('active');
  // Close the main affinity popup
  document.getElementById('affinityPopup')?.classList.remove('active');
}

function selectAffinity(affinity) {
  const trainerData = JSON.parse(sessionStorage.getItem('trainerData'));
  const affinityEffectBox = document.querySelector('.affinity-selection-effect-box');
  const chooseButton = document.getElementById('chooseAffinityButton');
  const trainerLevel = parseInt(trainerData[2], 10) || 1;
  const affinitiesStored = trainerData[23] ? trainerData[23].split(',').map(a => a.trim()).filter(a => a) : [];
  const firstAffinity = affinitiesStored[0] || null;

  let effectToShow = affinity.effect;

  // If level 7+ and selecting same affinity as first, show improved effect
  if (trainerLevel >= 7 && affinity.name === firstAffinity) {
    effectToShow = affinity.improvedEffect || affinity.effect;
  }

  // Remove selected class from all items
  document.querySelectorAll('.affinity-item').forEach(item => {
    item.classList.remove('selected');
  });

  // Add selected class to clicked item (find by text content)
  document.querySelectorAll('.affinity-item').forEach(item => {
    if (item.textContent === affinity.name) {
      item.classList.add('selected');
    }
  });

  // Update effect box
  affinityEffectBox.innerHTML = `<strong>${affinity.name}</strong><p>${effectToShow}</p>`;

  // Enable choose button
  chooseButton.disabled = false;
  chooseButton.onclick = () => saveAffinity(affinity);
}

async function saveAffinity(affinity) {
  if (!affinity) return;

  const trainerData = JSON.parse(sessionStorage.getItem('trainerData'));
  const trainerName = trainerData[1];
  const trainerLevel = parseInt(trainerData[2], 10) || 1;
  let affinitiesStored = trainerData[23] ? trainerData[23].split(',').map(a => a.trim()).filter(a => a) : [];

  // Update affinity based on level
  if (trainerLevel < 7) {
    affinitiesStored[0] = affinity.name; // First affinity
  } else {
    affinitiesStored[1] = affinity.name; // Second affinity (or improved)
  }

  const affinityString = affinitiesStored.join(', ');
  trainerData[23] = affinityString;

  // Update session storage immediately
  sessionStorage.setItem('trainerData', JSON.stringify(trainerData));

  // Close selection popup immediately
  document.getElementById('affinitySelectionPopup')?.classList.remove('active');

  // Reopen affinity popup immediately to show the updated selection
  setTimeout(() => {
    document.getElementById('affinityButton')?.click();
  }, 100);

  // Save to backend silently in the background
  (async () => {
    try {
      const { TrainerAPI } = await import('../api.js');
      const response = await TrainerAPI.updateAffinity(trainerName, affinityString);
      if (response.status === 'success') {
        console.log('Affinity saved to backend successfully');
      } else {
        console.warn('Failed to save affinity to backend:', response.message);
      }
    } catch (error) {
      console.error('Error saving affinity to backend:', error);
    }
  })();
}

// ============================================================================
// SPECIALIZATION SELECTION
// ============================================================================

function showSpecializationSelection() {
  const trainerData = JSON.parse(sessionStorage.getItem('trainerData'));
  const specializationsData = JSON.parse(sessionStorage.getItem('specializations') || '[]');

  const specializationGrid = document.querySelector('.specialization-grid');
  const specializationEffectBox = document.querySelector('.specialization-selection-effect-box');
  const chooseButton = document.getElementById('chooseSpecializationButton');

  specializationGrid.innerHTML = '';
  specializationEffectBox.innerHTML = 'Select a specialization to see its effect.';
  chooseButton.disabled = true;

  // Create button for each specialization
  specializationsData.forEach(spec => {
    const button = document.createElement('div');
    button.className = 'specialization-item';
    button.textContent = spec.name;
    button.onclick = () => selectSpecialization(spec);
    specializationGrid.appendChild(button);
  });

  // Show the popup using class-based approach
  document.getElementById('specializationSelectionPopup')?.classList.add('active');
  // Close the main specialization popup
  document.getElementById('specializationPopup')?.classList.remove('active');
}

function selectSpecialization(specialization) {
  const specializationEffectBox = document.querySelector('.specialization-selection-effect-box');
  const chooseButton = document.getElementById('chooseSpecializationButton');

  // Remove selected class from all items
  document.querySelectorAll('.specialization-item').forEach(item => {
    item.classList.remove('selected');
  });

  // Add selected class to clicked item (find by text content)
  document.querySelectorAll('.specialization-item').forEach(item => {
    if (item.textContent === specialization.name) {
      item.classList.add('selected');
    }
  });

  // Update effect box
  specializationEffectBox.innerHTML = `<strong>${specialization.name}</strong><p>${specialization.effect || 'No effect description available.'}</p>`;

  // Enable choose button
  chooseButton.disabled = false;
  chooseButton.onclick = () => saveSpecialization(specialization);
}

async function saveSpecialization(specialization) {
  if (!specialization) return;

  const trainerData = JSON.parse(sessionStorage.getItem('trainerData'));
  const trainerName = trainerData[1];

  trainerData[24] = specialization.name;

  // Update session storage immediately
  sessionStorage.setItem('trainerData', JSON.stringify(trainerData));

  // Close selection popup immediately
  document.getElementById('specializationSelectionPopup')?.classList.remove('active');

  // Reopen specialization popup immediately to show the updated selection
  setTimeout(() => {
    document.getElementById('specializationButton')?.click();
  }, 100);

  // Save to backend silently in the background
  (async () => {
    try {
      const { TrainerAPI } = await import('../api.js');
      const response = await TrainerAPI.updateSpecialization(trainerName, specialization.name);
      if (response.status === 'success') {
        console.log('Specialization saved to backend successfully');
      } else {
        console.warn('Failed to save specialization to backend:', response.message);
      }
    } catch (error) {
      console.error('Error saving specialization to backend:', error);
    }
  })();
}

// ============================================================================
// TRAINER PATH SELECTION
// ============================================================================

function showTrainerPathSelection() {
  const trainerPathsData = JSON.parse(sessionStorage.getItem('trainerPaths') || '[]');

  const trainerPathGrid = document.querySelector('.trainer-path-grid');
  const trainerPathEffectBox = document.querySelector('.trainer-path-selection-effect-box');
  const chooseButton = document.getElementById('chooseTrainerPathButton');

  trainerPathGrid.innerHTML = '';
  trainerPathEffectBox.innerHTML = 'Select a trainer path to see its effect.';
  chooseButton.disabled = true;

  // Create button for each trainer path
  trainerPathsData.forEach(path => {
    const button = document.createElement('div');
    button.className = 'trainer-path-item';
    button.textContent = path.name;
    button.onclick = () => selectTrainerPath(path);
    trainerPathGrid.appendChild(button);
  });

  // Show the popup using class-based approach
  document.getElementById('trainerPathSelectionPopup')?.classList.add('active');
  // Close the main trainer path popup
  document.getElementById('trainerPathPopup')?.classList.remove('active');
}

function selectTrainerPath(trainerPath) {
  const trainerPathEffectBox = document.querySelector('.trainer-path-selection-effect-box');
  const chooseButton = document.getElementById('chooseTrainerPathButton');

  // Remove selected class from all items
  document.querySelectorAll('.trainer-path-item').forEach(item => {
    item.classList.remove('selected');
  });

  // Add selected class to clicked item (find by text content)
  document.querySelectorAll('.trainer-path-item').forEach(item => {
    if (item.textContent === trainerPath.name) {
      item.classList.add('selected');
    }
  });

  // Build effect display from path stages
  let effectHtml = `<strong>${trainerPath.name}</strong>`;
  effectHtml += '<p>';
  if (trainerPath.level3?.name) effectHtml += `Level 3: ${trainerPath.level3.name}<br>`;
  if (trainerPath.level5?.name) effectHtml += `Level 5: ${trainerPath.level5.name}<br>`;
  if (trainerPath.level9?.name) effectHtml += `Level 9: ${trainerPath.level9.name}<br>`;
  if (trainerPath.level15?.name) effectHtml += `Level 15: ${trainerPath.level15.name}`;
  effectHtml += '</p>';

  // Update effect box
  trainerPathEffectBox.innerHTML = effectHtml;

  // Enable choose button
  chooseButton.disabled = false;
  chooseButton.onclick = () => saveTrainerPath(trainerPath);
}

async function saveTrainerPath(trainerPath) {
  if (!trainerPath) return;

  const trainerData = JSON.parse(sessionStorage.getItem('trainerData'));
  const trainerName = trainerData[1];

  trainerData[25] = trainerPath.name;

  // Update session storage immediately
  sessionStorage.setItem('trainerData', JSON.stringify(trainerData));

  // Close selection popup immediately
  document.getElementById('trainerPathSelectionPopup')?.classList.remove('active');

  // Reopen trainer path popup immediately to show the updated selection
  setTimeout(() => {
    document.getElementById('trainerPathButton')?.click();
  }, 100);

  // Save to backend silently in the background
  (async () => {
    try {
      const { TrainerAPI } = await import('../api.js');
      const response = await TrainerAPI.updateTrainerPath(trainerName, trainerPath.name);
      if (response.status === 'success') {
        console.log('Trainer path saved to backend successfully');
      } else {
        console.warn('Failed to save trainer path to backend:', response.message);
      }
    } catch (error) {
      console.error('Error saving trainer path to backend:', error);
    }
  })();
}

// ============================================================================
// SHORT REST POKEMON SELECTION FUNCTIONS
// ============================================================================

function showShortRestPokemonSelection(activePokemon) {
  const pokemonGrid = document.querySelector('.pokemon-selection-grid');
  const completeButton = document.getElementById('completeShortRestButton');

  pokemonGrid.innerHTML = '';
  completeButton.disabled = true;

  // Create selection item for each active Pokemon
  activePokemon.forEach(pokemon => {
    const pokemonName = pokemon[1]; // Name at index 1
    const currentHP = parseInt(pokemon[45], 10); // currentHP at index 45
    const maxHP = parseInt(pokemon[10], 10); // HP at index 10
    const currentVP = parseInt(pokemon[46], 10); // currentVP at index 46
    const maxVP = parseInt(pokemon[12], 10); // VP at index 12

    const item = document.createElement('div');
    item.className = 'trainer-path-item'; // Reuse existing styling
    item.innerHTML = `
      <div style="font-weight: 700; margin-bottom: 0.5rem;">${pokemonName}</div>
      <div style="font-size: 0.85rem; color: #666;">HP: ${currentHP}/${maxHP}</div>
      <div style="font-size: 0.85rem; color: #666;">VP: ${currentVP}/${maxVP}</div>
    `;
    item.onclick = () => selectShortRestPokemon(pokemon);
    pokemonGrid.appendChild(item);
  });

  // Show the popup using class-based approach
  document.getElementById('shortRestPokemonSelectionPopup')?.classList.add('active');
  // Close the trainer buffs popup
  document.getElementById('trainerBuffsPopup')?.classList.remove('active');
}

function selectShortRestPokemon(pokemon) {
  const completeButton = document.getElementById('completeShortRestButton');

  // Remove selected class from all items
  document.querySelectorAll('.pokemon-selection-grid .trainer-path-item').forEach(item => {
    item.classList.remove('selected');
  });

  // Add selected class to clicked item (find by Pokemon name)
  const pokemonName = pokemon[1];
  document.querySelectorAll('.pokemon-selection-grid .trainer-path-item').forEach(item => {
    if (item.querySelector('div').textContent === pokemonName) {
      item.classList.add('selected');
    }
  });

  // Enable complete button
  completeButton.disabled = false;
  completeButton.onclick = () => completeShortRest(pokemon);
}

async function completeShortRest(selectedPokemon) {
  if (!selectedPokemon) return;

  const trainerDataRaw = sessionStorage.getItem('trainerData');
  if (!trainerDataRaw) {
    showError('Trainer data not found.');
    return;
  }

  const trainerData = JSON.parse(trainerDataRaw);

  // Restore trainer HP and VP to max
  const maxHP = parseInt(trainerData[11], 10);
  const maxVP = parseInt(trainerData[12], 10);
  trainerData[34] = maxHP; // currentHP
  trainerData[35] = maxVP; // currentVP

  // Update session storage IMMEDIATELY
  sessionStorage.setItem('trainerData', JSON.stringify(trainerData));

  // Restore selected Pokemon HP and VP
  const pokemonName = selectedPokemon[1];
  const pokemonMaxHP = parseInt(selectedPokemon[10], 10);
  const pokemonMaxVP = parseInt(selectedPokemon[12], 10);
  selectedPokemon[45] = pokemonMaxHP; // currentHP
  selectedPokemon[46] = pokemonMaxVP; // currentVP

  // Update Pokemon in sessionStorage
  const registeredPokemonStr = sessionStorage.getItem('registeredPokemon');
  if (registeredPokemonStr) {
    const registeredPokemon = JSON.parse(registeredPokemonStr);
    const pokemonIndex = registeredPokemon.findIndex(p => p[1] === pokemonName && p[0] === trainerData[1]);
    if (pokemonIndex !== -1) {
      registeredPokemon[pokemonIndex] = selectedPokemon;
      sessionStorage.setItem('registeredPokemon', JSON.stringify(registeredPokemon));
    }
  }

  // Close selection popup immediately
  document.getElementById('shortRestPokemonSelectionPopup')?.classList.remove('active');

  // Reopen trainer buffs popup immediately to show updated trainer HP/VP
  setTimeout(() => {
    showTrainerSkillsPopup();
  }, 100);

  // Show success message
  showSuccess(`Short rest completed! Trainer and ${pokemonName} HP/VP fully restored.`);

  // Update database in background (non-blocking)
  try {
    await TrainerAPI.update(trainerData);
    const { PokemonAPI } = await import('../api.js');
    await PokemonAPI.update(selectedPokemon);
    console.log('Short rest saved to backend successfully');
  } catch (error) {
    console.error('Error saving short rest to backend:', error);
  }
}
