// Device-level app settings, persisted in localStorage (per-device, not per-trainer)

const STORAGE_KEY = 'appSettings';

const DEFAULTS = {
  volume: 80,           // 0-100
  syncMusic: true,
  idleSplashMinutes: 10, // 5-30
  animatedSprites: true
};

export function getSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return { ...DEFAULTS, ...stored };
  } catch (e) {
    return { ...DEFAULTS };
  }
}

export function saveSettings(patch) {
  const merged = { ...getSettings(), ...patch };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  return merged;
}
