// Landing Page (Index) - Continue Journey or Start New Adventure
export function renderIndex() {
  return `
    <div class="landing-page">
      <style>
        .landing-page {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 70vh;
          text-align: center;
        }

        .landing-title {
          font-size: 3rem;
          color: white;
          margin-bottom: 3rem;
          text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
        }

        .landing-buttons {
          display: flex;
          flex-direction: column;
          gap: 2rem;
          width: 100%;
          max-width: 400px;
        }

        .landing-button {
          padding: 2rem 3rem;
          font-size: 1.8rem;
          font-weight: bold;
          color: white;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          border: 3px solid white;
          border-radius: 15px;
          cursor: pointer;
          transition: all 0.3s;
          box-shadow: 0 4px 15px rgba(0,0,0,0.3);
        }

        .landing-button:hover {
          transform: translateY(-5px);
          box-shadow: 0 8px 20px rgba(0,0,0,0.4);
        }

        .landing-button:active {
          transform: translateY(-2px);
        }

        @media (max-width: 768px) {
          .landing-title {
            font-size: 2rem;
          }

          .landing-button {
            font-size: 1.4rem;
            padding: 1.5rem 2rem;
          }
        }
      </style>

      <h1 class="landing-title">Shima Pokemon D&D</h1>

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
