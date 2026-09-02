/**
 * LUMEN YARD - Local Storage Persistence Helper
 * Gracefully persists progression, best move counts, and settings with safe fallback.
 */

const STORAGE_KEY = 'lumen_yard_save_v1';

export class StorageManager {
  constructor() {
    this.memoryState = {
      completedLevels: {}, // levelId -> boolean
      bestMoves: {}, // levelId -> number
      lastPlayedLevel: 'first-light',
      soundEnabled: true,
      reducedMotion: false
    };

    this._load();
  }

  _isAvailable() {
    try {
      const test = '__test_storage__';
      window.localStorage.setItem(test, test);
      window.localStorage.removeItem(test);
      return true;
    } catch (_) {
      return false;
    }
  }

  _load() {
    // Check system prefers-reduced-motion initially
    try {
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        this.memoryState.reducedMotion = true;
      }
    } catch (_) {}

    if (!this._isAvailable()) return;

    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          this.memoryState = {
            ...this.memoryState,
            ...parsed
          };
        }
      }
    } catch (e) {
      console.warn('Could not load from localStorage:', e);
    }
  }

  _save() {
    if (!this._isAvailable()) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.memoryState));
    } catch (e) {
      console.warn('Could not save to localStorage:', e);
    }
  }

  recordLevelComplete(levelId, moves) {
    this.memoryState.completedLevels[levelId] = true;
    const currentBest = this.memoryState.bestMoves[levelId];
    let isNewRecord = false;

    if (currentBest === undefined || moves < currentBest) {
      this.memoryState.bestMoves[levelId] = moves;
      isNewRecord = true;
    }

    this._save();
    return { isNewRecord, best: this.memoryState.bestMoves[levelId] };
  }

  setLastPlayed(levelId) {
    this.memoryState.lastPlayedLevel = levelId;
    this._save();
  }

  getLastPlayed() {
    return this.memoryState.lastPlayedLevel || 'first-light';
  }

  isLevelCompleted(levelId) {
    return !!this.memoryState.completedLevels[levelId];
  }

  getBestMoves(levelId) {
    return this.memoryState.bestMoves[levelId] || null;
  }

  getTotalCompletedCount() {
    return Object.keys(this.memoryState.completedLevels).filter(k => this.memoryState.completedLevels[k]).length;
  }

  getTotalBestMoves() {
    let total = 0;
    for (const k in this.memoryState.bestMoves) {
      if (this.memoryState.completedLevels[k]) {
        total += this.memoryState.bestMoves[k];
      }
    }
    return total;
  }

  getSoundEnabled() {
    return this.memoryState.soundEnabled !== false;
  }

  setSoundEnabled(val) {
    this.memoryState.soundEnabled = !!val;
    this._save();
  }

  getReducedMotion() {
    return !!this.memoryState.reducedMotion;
  }

  setReducedMotion(val) {
    this.memoryState.reducedMotion = !!val;
    this._save();
  }
}
