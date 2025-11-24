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
          padding: 2rem;
        }

        /* Decorative Pokeball Background */
        .landing-page::before {
          content: '';
          position: absolute;
          width: 400px;
          height: 400px;
          background: radial-gradient(circle, rgba(255,255,255,0.05) 0%, transparent 70%);
          border-radius: 50%;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          z-index: 0;
          pointer-events: none;
        }

        .landing-title {
          font-size: 3.5rem;
          color: white;
          margin-bottom: 1rem;
          text-shadow: 0 4px 10px rgba(0,0,0,0.5),
                       0 0 20px rgba(255,222,0,0.3);
          font-weight: 900;
          letter-spacing: 2px;
          position: relative;
          z-index: 1;
          animation: titleGlow 2s ease-in-out infinite alternate;
        }

        @keyframes titleGlow {
          from {
            text-shadow: 0 4px 10px rgba(0,0,0,0.5),
                         0 0 20px rgba(255,222,0,0.3);
          }
          to {
            text-shadow: 0 4px 15px rgba(0,0,0,0.7),
                         0 0 30px rgba(255,222,0,0.5);
          }
        }

        .landing-subtitle {
          font-size: 1.5rem;
          color: #FFDE00;
          margin-bottom: 3rem;
          text-shadow: 0 2px 5px rgba(0,0,0,0.5);
          font-weight: 600;
          position: relative;
          z-index: 1;
        }

        .landing-buttons {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
          width: 100%;
          max-width: 450px;
          position: relative;
          z-index: 1;
        }

        .landing-button {
          padding: 2rem 3rem;
          font-size: 1.8rem;
          font-weight: bold;
          color: #333;
          background: linear-gradient(135deg, #FFFFFF 0%, #F5F5F5 100%);
          border: 4px solid #FFDE00;
          border-radius: 20px;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 8px 20px rgba(0,0,0,0.3),
                      inset 0 -3px 0 rgba(0,0,0,0.1);
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
          transform: translateY(-8px) scale(1.02);
          box-shadow: 0 12px 30px rgba(0,0,0,0.4),
                      inset 0 -3px 0 rgba(0,0,0,0.1),
                      0 0 20px rgba(255,222,0,0.6);
          border-color: #FFC700;
        }

        .landing-button:hover::before {
          width: 300px;
          height: 300px;
        }

        .landing-button:active {
          transform: translateY(-4px) scale(1.0);
          box-shadow: 0 6px 15px rgba(0,0,0,0.3);
        }

        @media (max-width: 768px) {
          .landing-title {
            font-size: 2.5rem;
          }

          .landing-subtitle {
            font-size: 1.2rem;
            margin-bottom: 2rem;
          }

          .landing-button {
            font-size: 1.5rem;
            padding: 1.5rem 2rem;
          }

          .landing-page::before {
            width: 250px;
            height: 250px;
          }
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
