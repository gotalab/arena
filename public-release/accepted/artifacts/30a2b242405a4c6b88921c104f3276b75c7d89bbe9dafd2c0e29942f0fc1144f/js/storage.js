// Lumen Yard - Local Storage Manager with safe fallback

class StorageManager {
  constructor() {
    this.memoryStore = new Map();
    this.available = this.checkAvailability();
  }

  checkAvailability() {
    try {
      const testKey = '__lumen_test__';
      window.localStorage.setItem(testKey, '1');
      window.localStorage.removeItem(testKey);
      return true;
    } catch (e) {
      return false;
    }
  }

  getItem(key, defaultValue = null) {
    if (this.available) {
      try {
        const val = window.localStorage.getItem(key);
        return val !== null ? JSON.parse(val) : defaultValue;
      } catch (e) {
        // Fallback to memory
      }
    }
    return this.memoryStore.has(key) ? this.memoryStore.get(key) : defaultValue;
  }

  setItem(key, value) {
    if (this.available) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch (e) {
        // Fallback to memory
      }
    }
    this.memoryStore.set(key, value);
  }

  // Lumen specific helpers
  getRestoredLevels() {
    return new Set(this.getItem('lumen_restored', []));
  }

  markLevelRestored(levelId) {
    const restored = this.getRestoredLevels();
    restored.add(levelId);
    this.setItem('lumen_restored', Array.from(restored));
  }

  getBests() {
    return this.getItem('lumen_bests', {});
  }

  recordBest(levelId, moves) {
    const bests = this.getBests();
    if (bests[levelId] === undefined || moves < bests[levelId]) {
      bests[levelId] = moves;
      this.setItem('lumen_bests', bests);
      return true; // New record
    }
    return false;
  }

  getLastLevel(defaultId = 'first-light') {
    return this.getItem('lumen_last_level', defaultId);
  }

  setLastLevel(levelId) {
    this.setItem('lumen_last_level', levelId);
  }

  getSoundEnabled(defaultVal = true) {
    return this.getItem('lumen_sound', defaultVal);
  }

  setSoundEnabled(val) {
    this.setItem('lumen_sound', !!val);
  }

  getMotionEnabled() {
    // Default from prefers-reduced-motion
    const systemPrefersReduced = typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return this.getItem('lumen_motion', !systemPrefersReduced);
  }

  setMotionEnabled(val) {
    this.setItem('lumen_motion', !!val);
  }
}

export const storage = new StorageManager();
