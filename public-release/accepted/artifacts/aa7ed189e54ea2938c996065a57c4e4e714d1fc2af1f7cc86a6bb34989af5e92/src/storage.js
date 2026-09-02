/* Lumen Yard - the yard remembers.
   Restored boards, best move counts, last board played, sound and motion.
   If storage is unavailable the game simply plays on without it. */
(function (global) {
  'use strict';

  var KEY = 'lumen-yard.save.v1';

  function Store() {
    this.available = false;
    this.data = {
      restored: {},
      best: {},
      lastLevel: null,
      sound: null,
      motion: null,
      chapterSeen: false,
      campaignSeen: false
    };
    try {
      var probe = '__lumen_probe__';
      global.localStorage.setItem(probe, '1');
      global.localStorage.removeItem(probe);
      this.available = true;
      var raw = global.localStorage.getItem(KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          if (parsed.restored && typeof parsed.restored === 'object') this.data.restored = parsed.restored;
          if (parsed.best && typeof parsed.best === 'object') this.data.best = parsed.best;
          if (typeof parsed.lastLevel === 'string') this.data.lastLevel = parsed.lastLevel;
          if (typeof parsed.sound === 'boolean') this.data.sound = parsed.sound;
          if (typeof parsed.motion === 'boolean') this.data.motion = parsed.motion;
          this.data.chapterSeen = !!parsed.chapterSeen;
          this.data.campaignSeen = !!parsed.campaignSeen;
        }
      }
    } catch (e) {
      this.available = false;
    }
  }

  Store.prototype.save = function () {
    if (!this.available) return;
    try {
      global.localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch (e) {
      this.available = false;
    }
  };

  Store.prototype.isRestored = function (id) { return !!this.data.restored[id]; };
  Store.prototype.best = function (id) {
    var v = this.data.best[id];
    return typeof v === 'number' && isFinite(v) ? v : null;
  };
  Store.prototype.restoredCount = function (ids) {
    var self = this;
    return ids.filter(function (id) { return self.isRestored(id); }).length;
  };
  Store.prototype.totalBest = function (ids) {
    var total = 0;
    for (var i = 0; i < ids.length; i++) {
      var b = this.best(ids[i]);
      if (b !== null) total += b;
    }
    return total;
  };

  /* Returns { firstTime, improved, best } so presentation can react. */
  Store.prototype.recordCompletion = function (id, moves) {
    var firstTime = !this.data.restored[id];
    var prev = this.best(id);
    var improved = prev === null || moves < prev;
    this.data.restored[id] = true;
    if (improved) this.data.best[id] = moves;
    this.save();
    return { firstTime: firstTime, improved: improved && !firstTime, best: this.best(id) };
  };

  Store.prototype.setLastLevel = function (id) {
    if (this.data.lastLevel === id) return;
    this.data.lastLevel = id;
    this.save();
  };

  Store.prototype.setPref = function (name, value) {
    this.data[name] = value;
    this.save();
  };

  global.LumenStore = Store;
})(typeof window !== 'undefined' ? window : globalThis);
