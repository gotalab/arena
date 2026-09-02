/** Touch + mouse input handling */

const HOLD_MS = 480;

export class Input {
  constructor(canvas, renderer, onAction) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.onAction = onAction;
    this.holdTimer = null;
    this.holdCell = null;
    this.pointerDown = null;
    this.dragged = false;

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('pointerdown', (e) => this._down(e));
    canvas.addEventListener('pointermove', (e) => this._move(e));
    canvas.addEventListener('pointerup', (e) => this._up(e));
    canvas.addEventListener('pointercancel', (e) => this._cancel(e));

    window.addEventListener('keydown', (e) => {
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        this.onAction({ type: 'restart' });
      }
    });
  }

  _down(e) {
    if (e.button > 2) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.pointerDown = { x: e.clientX, y: e.clientY, button: e.button, time: Date.now() };
    this.dragged = false;

    const state = this.onAction({ type: 'snapshot' });
    if (!state) return;

    if (state.phase === 'ended') return;

    const rect = this.canvas.getBoundingClientRect();
    const layout = this.renderer._layout(state);
    const cell = this.renderer.cellAt(state, layout, e.clientX, e.clientY, rect);
    if (!cell) return;

    this.holdCell = cell;
    clearTimeout(this.holdTimer);
    this.holdTimer = setTimeout(() => {
      if (!this.holdCell || this.dragged) return;
      const c = this.holdCell;
      if (c.cell === 'F') {
        this.onAction({ type: 'unflag', x: c.x, y: c.y });
      } else if (c.cell === '#') {
        this.onAction({ type: 'flag', x: c.x, y: c.y });
      }
      this.holdCell = null;
      this.pointerDown = null;
    }, HOLD_MS);
  }

  _move(e) {
    if (!this.pointerDown) return;
    const dx = e.clientX - this.pointerDown.x;
    const dy = e.clientY - this.pointerDown.y;
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
      this.dragged = true;
      clearTimeout(this.holdTimer);
    }
  }

  _up(e) {
    clearTimeout(this.holdTimer);
    if (!this.pointerDown) return;

    const state = this.onAction({ type: 'snapshot' });
    const rect = this.canvas.getBoundingClientRect();

    if (state.phase === 'ended') {
      if (this.renderer.isCeremonyTap(state, e.clientY, rect)) {
        this.onAction({ type: 'restart' });
      }
      this._reset();
      return;
    }

    if (this.dragged) {
      this._reset();
      return;
    }

    const layout = this.renderer._layout(state);
    const cell = this.renderer.cellAt(state, layout, e.clientX, e.clientY, rect);

    if (!cell) {
      this._reset();
      return;
    }

    const held = Date.now() - this.pointerDown.time >= HOLD_MS;

    if (e.button === 2 || held) {
      if (cell.cell === 'F') {
        this.onAction({ type: 'unflag', x: cell.x, y: cell.y });
      } else if (cell.cell === '#') {
        this.onAction({ type: 'flag', x: cell.x, y: cell.y });
      }
    } else if (e.button === 0) {
      if (cell.cell === '#') {
        this.onAction({ type: 'open', x: cell.x, y: cell.y });
      } else if (cell.cell >= '0' && cell.cell <= '8') {
        this.onAction({ type: 'sweep', x: cell.x, y: cell.y });
      }
    }

    this._reset();
  }

  _cancel() {
    clearTimeout(this.holdTimer);
    this._reset();
  }

  _reset() {
    this.pointerDown = null;
    this.holdCell = null;
    this.dragged = false;
  }
}
