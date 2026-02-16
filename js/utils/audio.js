// Audio Manager - Singleton for background music and sound effects

const AUDIO_PATH = 'assets/';

const ALL_TRACKS = [
  'Index', 'ContinueJourney', 'NewJourney', 'FindPokemon',
  'NewPokemon', 'EvolutionStart', 'Evolution', 'EvolutionFinish',
  'LevelUp', 'NewItem', 'Berry', 'GymBadge', 'PokeCenter'
];

class AudioManager {
  constructor() {
    this.bgAudio = null;
    this.currentTrack = null;
    this.pendingTransition = null;
    this.cache = {};
  }

  preloadAll() {
    return Promise.all(ALL_TRACKS.map(track => {
      return new Promise((resolve) => {
        const audio = new Audio(`${AUDIO_PATH}${track}.mp3`);
        audio.preload = 'auto';
        audio.addEventListener('canplaythrough', () => resolve(), { once: true });
        audio.addEventListener('error', () => resolve(), { once: true });
        this.cache[track] = audio;
      });
    }));
  }

  _getAudio(trackName) {
    if (this.cache[trackName]) {
      const audio = this.cache[trackName].cloneNode();
      return audio;
    }
    return new Audio(`${AUDIO_PATH}${trackName}.mp3`);
  }

  playBg(trackName, { loop = true, onEnded } = {}) {
    if (this.currentTrack === trackName) return;
    this.stopBg();

    const audio = this._getAudio(trackName);
    audio.loop = loop;
    if (onEnded) {
      audio.addEventListener('ended', onEnded, { once: true });
    }
    this.bgAudio = audio;
    this.currentTrack = trackName;
    audio.play().catch(() => {});
  }

  stopBg() {
    if (this.pendingTransition) {
      clearTimeout(this.pendingTransition);
      this.pendingTransition = null;
    }
    if (this.bgAudio) {
      this.bgAudio.pause();
      this.bgAudio.currentTime = 0;
      this.bgAudio = null;
      this.currentTrack = null;
    }
  }

  playSfx(trackName) {
    const audio = this._getAudio(trackName);
    audio.play().catch(() => {});
  }

  playSfxAndWait(trackName) {
    return new Promise((resolve) => {
      const audio = this._getAudio(trackName);
      audio.addEventListener('ended', resolve, { once: true });
      audio.addEventListener('error', resolve, { once: true });
      audio.play().catch(() => resolve());
    });
  }

  playEvolutionSequence() {
    this.stopBg();
    this.playBg('EvolutionStart', {
      loop: false,
      onEnded: () => {
        if (this.currentTrack === 'EvolutionStart') {
          this.currentTrack = null;
          this.playBg('Evolution');
        }
      }
    });
  }
}

export const audioManager = new AudioManager();
