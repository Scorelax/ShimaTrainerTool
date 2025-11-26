// Landing Page (Index) - Continue Journey or Start New Adventure
export function renderIndex() {
  return `
    <div class="landing-page">
      <style>
        body, .content {
          background: linear-gradient(135deg, #EE1515 0%, #C91010 50%, #A00808 100%);
          min-height: 100vh;
        }

        .landing-page {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 85vh;
          text-align: center;
          position: relative;
          padding: clamp(1rem, 3vh, 3rem);
        }

        /* Decorative Pokeball Background */
        .landing-page::before {
          content: '';
          position: absolute;
          width: min(50vw, 60vh);
          height: min(50vw, 60vh);
          background: radial-gradient(circle, rgba(255,255,255,0.05) 0%, transparent 70%);
          border-radius: 50%;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          z-index: 0;
          pointer-events: none;
        }

        .landing-title {
          font-size: clamp(2rem, 6vw, 4rem);
          color: white;
          margin-bottom: clamp(0.75rem, 2vh, 1.5rem);
          text-shadow: 0 clamp(2px, 0.8vh, 5px) clamp(6px, 2vw, 12px) rgba(0,0,0,0.5),
                       0 0 clamp(10px, 3vw, 25px) rgba(255,222,0,0.3);
          font-weight: 900;
          letter-spacing: clamp(1px, 0.3vw, 3px);
          position: relative;
          z-index: 1;
          animation: titleGlow 2s ease-in-out infinite alternate;
        }

        @keyframes titleGlow {
          from {
            text-shadow: 0 clamp(2px, 0.8vh, 5px) clamp(6px, 2vw, 12px) rgba(0,0,0,0.5),
                         0 0 clamp(10px, 3vw, 25px) rgba(255,222,0,0.3);
          }
          to {
            text-shadow: 0 clamp(2px, 0.8vh, 5px) clamp(8px, 2.5vw, 18px) rgba(0,0,0,0.7),
                         0 0 clamp(15px, 4vw, 35px) rgba(255,222,0,0.5);
          }
        }

        .landing-subtitle {
          font-size: clamp(1rem, 3vw, 1.8rem);
          color: #FFDE00;
          margin-bottom: clamp(2rem, 5vh, 4rem);
          text-shadow: 0 clamp(1px, 0.3vh, 3px) clamp(3px, 1vw, 7px) rgba(0,0,0,0.5);
          font-weight: 600;
          position: relative;
          z-index: 1;
        }

        .landing-buttons {
          display: flex;
          flex-direction: column;
          gap: clamp(1rem, 2.5vh, 2rem);
          width: 90%;
          max-width: min(60vw, 70vh);
          position: relative;
          z-index: 1;
        }

        .landing-button {
          padding: clamp(1.5rem, 3vh, 2.5rem) clamp(2rem, 5vw, 4rem);
          font-size: clamp(1.2rem, 3vw, 2rem);
          font-weight: bold;
          color: #333;
          background: linear-gradient(135deg, #FFFFFF 0%, #F5F5F5 100%);
          border: clamp(3px, 0.5vw, 6px) solid #FFDE00;
          border-radius: clamp(15px, 3vw, 30px);
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 clamp(5px, 1.5vh, 12px) clamp(15px, 3vw, 25px) rgba(0,0,0,0.3),
                      inset 0 clamp(-2px, -0.5vh, -4px) 0 rgba(0,0,0,0.1);
          position: relative;
          overflow: hidden;
        }

        .landing-button::before {
          content: '';
          position: absolute;
          top: 50%;
          left: 50%;
          width: 0;
          height: 0;
          border-radius: 50%;
          background: rgba(255,222,0,0.3);
          transform: translate(-50%, -50%);
          transition: width 0.5s, height 0.5s;
        }

        .landing-button:hover {
          transform: translateY(clamp(-5px, -1.2vh, -10px)) scale(1.02);
          box-shadow: 0 clamp(8px, 2vh, 16px) clamp(20px, 4vw, 35px) rgba(0,0,0,0.4),
                      inset 0 clamp(-2px, -0.5vh, -4px) 0 rgba(0,0,0,0.1),
                      0 0 clamp(15px, 3vw, 25px) rgba(255,222,0,0.6);
          border-color: #FFC700;
        }

        .landing-button:hover::before {
          width: clamp(200px, 40vw, 350px);
          height: clamp(200px, 40vw, 350px);
        }

        .landing-button:active {
          transform: translateY(clamp(-3px, -0.8vh, -6px)) scale(1.0);
          box-shadow: 0 clamp(4px, 1vh, 8px) clamp(10px, 2.5vw, 18px) rgba(0,0,0,0.3);
        }
      </style>

      <h1 class="landing-title">Shima Pokemon D&D</h1>
      <div class="landing-subtitle">Your Adventure Awaits</div>

      <div class="landing-buttons">
        <button class="landing-button" data-route="continue-journey">
          Continue Journey
        </button>
        <button class="landing-button" data-route="new-journey">
          Start New Adventure
        </button>
      </div>
    </div>
  `;
}
