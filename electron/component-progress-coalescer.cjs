'use strict';

// Only noisy byte-transfer updates are delayed. State transitions remain
// immediate so a retry, error, cancellation, or completed transfer is never
// visually hidden behind a timer.
class ComponentProgressCoalescer {
  constructor(emit, { now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout, intervalMs = 100 } = {}) {
    this.emit = emit; this.now = now; this.setTimer = setTimer; this.clearTimer = clearTimer; this.intervalMs = intervalMs;
    this.last = null; this.lastAt = -Infinity; this.pending = null; this.timer = null;
  }
  clear() { if (this.timer !== null) this.clearTimer(this.timer); this.timer = null; this.pending = null; this.last = null; this.lastAt = -Infinity; }
  emitNow(event) { this.pending = null; if (this.timer !== null) { this.clearTimer(this.timer); this.timer = null; } this.last = event; this.lastAt = this.now(); this.emit(event); }
  push(event) {
    const sameTransfer = this.last && this.last.id === event.id && this.last.attempt === event.attempt && this.last.phase === 'Downloading' && event.phase === 'Downloading';
    if (!sameTransfer || event.percent >= 100) { this.emitNow(event); return; }
    const remaining = this.intervalMs - (this.now() - this.lastAt);
    if (remaining <= 0) { this.emitNow(event); return; }
    this.pending = event;
    if (this.timer !== null) return;
    this.timer = this.setTimer(() => {
      this.timer = null;
      const latest = this.pending; this.pending = null;
      if (latest) this.emitNow(latest);
    }, remaining);
  }
}

module.exports = { ComponentProgressCoalescer };
