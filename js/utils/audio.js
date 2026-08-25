// Audio Manager - Singleton for background music and sound effects
import { MusicAPI } from '../api.js';
import { getSettings } from './settings.js';

const AUDIO_PATH = 'assets/';

// Tracks eligible for cross-device sync (looping page-background music only —
// not sfx, not the one-shot Evolution intro).
const SYNCABLE_TRACKS = ['Index', 'ContinueJourney', 'NewJourney'];

const REMAINING_TRACKS = [
  'NewJourney', 'FindPokemon',
  'NewPokemon', 'EvolutionStart', 'Evolution', 'EvolutionFinish',
  'LevelUp', 'NewItem', 'Berry', 'GymBadge', 'PokeCenter'
];

class AudioManager {
  constructor() {
    this.bgAudio = null;
    this.currentTrack = null;
    this.pendingTransition = null;
    this.cache = {};
    this.volume = 0.8; // 0-1, set from saved settings at app start via setVolume()
  }

  setVolume(percent) {
    this.volume = Math.max(0, Math.min(100, percent)) / 100;
    if (this.bgAudio) this.bgAudio.volume = this.volume;
  }

  _preloadTrack(track) {
    return new Promise((resolve) => {
      const audio = new Audio(`${AUDIO_PATH}${track}.mp3`);
      audio.preload = 'auto';
      const done = () => { clearTimeout(timer); resolve(); };
      audio.addEventListener('canplaythrough', done, { once: true });
      audio.addEventListener('error', done, { once: true });
      // Timeout fallback — don't block the app if audio stalls
      const timer = setTimeout(done, 3000);
      this.cache[track] = audio;
    });
  }

  async preloadPriority() {
    // Load Index first so landing page music is ready before display
    await this._preloadTrack('Index');
    // Then load ContinueJourney next, followed by the rest in parallel (non-blocking)
    this._preloadTrack('ContinueJourney').then(() => {
      Promise.all(REMAINING_TRACKS.map(track => this._preloadTrack(track)));
    });
  }

  _getAudio(trackName) {
    const audio = this.cache[trackName]
      ? this.cache[trackName].cloneNode()
      : new Audio(`${AUDIO_PATH}${trackName}.mp3`);
    audio.volume = this.volume;
    return audio;
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

  /**
   * Like playBg(), but for the 3 shared page-background tracks: joins the
   * server's shared "when did this track start looping" anchor so every
   * device hears roughly the same point in the loop, instead of everyone
   * starting from 0. Falls back to plain playBg() if sync is disabled, the
   * track isn't eligible, or the server request fails (e.g. Apps Script
   * backend, which has no /music route at all).
   */
  async playBgSynced(trackName) {
    if (this.currentTrack === trackName) return;
    if (!SYNCABLE_TRACKS.includes(trackName) || !getSettings().syncMusic) {
      return this.playBg(trackName);
    }

    try {
      const result = await MusicAPI.sync(trackName);
      const startedAt = new Date(result.startedAt).getTime();
      if (isNaN(startedAt)) throw new Error('Invalid startedAt');
      const elapsedSeconds = (Date.now() - startedAt) / 1000;

      this.stopBg();
      const audio = this._getAudio(trackName);
      audio.loop = true;

      const seekAndPlay = () => {
        const offset = audio.duration > 0 ? elapsedSeconds % audio.duration : 0;
        audio.currentTime = offset;
        audio.play().catch(() => {});
      };
      if (audio.readyState >= 1 /* HAVE_METADATA */) {
        seekAndPlay();
      } else {
        audio.addEventListener('loadedmetadata', seekAndPlay, { once: true });
      }

      this.bgAudio = audio;
      this.currentTrack = trackName;
    } catch (e) {
      console.warn(`[Audio] Sync failed for ${trackName}, playing locally:`, e.message);
      this.playBg(trackName);
    }
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
