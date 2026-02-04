// Audio Manager - Singleton for background music and sound effects

const AUDIO_PATH = 'assets/';

class AudioManager {
  constructor() {
    this.bgAudio = null;
    this.currentTrack = null;
    this.pendingTransition = null;
  }

  playBg(trackName, { loop = true, onEnded } = {}) {
    if (this.currentTrack === trackName) return;
    this.stopBg();

    const audio = new Audio(`${AUDIO_PATH}${trackName}.mp3`);
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
    const audio = new Audio(`${AUDIO_PATH}${trackName}.mp3`);
    audio.play().catch(() => {});
  }

  playSfxAndWait(trackName) {
    return new Promise((resolve) => {
      const audio = new Audio(`${AUDIO_PATH}${trackName}.mp3`);
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
