export class InputManager {
  constructor(canvas, onInput, onRestart) {
    this.canvas = canvas;
    this.onInput = onInput;
    this.onRestart = onRestart;
    this.keys = { left: false, right: false, accelerate: false };
    this.touch = null;
    this.steer = 0;
    this.accelerate = false;

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);

    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);
    canvas.addEventListener('pointerdown', this._onPointerDown);
    canvas.addEventListener('pointermove', this._onPointerMove);
    canvas.addEventListener('pointerup', this._onPointerUp);
    canvas.addEventListener('pointercancel', this._onPointerUp);
    canvas.addEventListener('pointerleave', this._onPointerUp);
  }

  _onKeyDown(e) {
    if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      this.onRestart();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === ' ') {
      e.preventDefault();
      this.keys.accelerate = true;
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      this.keys.left = true;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      this.keys.right = true;
    }
    this._sync();
  }

  _onKeyUp(e) {
    if (e.key === 'ArrowDown' || e.key === ' ') {
      e.preventDefault();
      this.keys.accelerate = false;
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      this.keys.left = false;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      this.keys.right = false;
    }
    this._sync();
  }

  _onPointerDown(e) {
    if (e.button !== 0) return;
    const rect = this.canvas.getBoundingClientRect();
    this.touch = {
      id: e.pointerId,
      originX: e.clientX - rect.left,
      originY: e.clientY - rect.top,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
    this.canvas.setPointerCapture(e.pointerId);
    this._updateTouch();
  }

  _onPointerMove(e) {
    if (!this.touch || this.touch.id !== e.pointerId) return;
    const rect = this.canvas.getBoundingClientRect();
    this.touch.x = e.clientX - rect.left;
    this.touch.y = e.clientY - rect.top;
    this._updateTouch();
  }

  _onPointerUp(e) {
    if (!this.touch || this.touch.id !== e.pointerId) return;
    this.touch = null;
    this.accelerate = false;
    this.steer = 0;
    this._sync();
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch (_) {}
  }

  _updateTouch() {
    if (!this.touch) return;
    const dx = this.touch.x - this.touch.originX;
    const dy = this.touch.y - this.touch.originY;
    const dead = 8;
    this.accelerate = dy > dead;
    const steerZone = 40;
    this.steer = Math.max(-1, Math.min(1, dx / steerZone));
    this._sync();
  }

  _sync() {
    let steer = 0;
    if (this.keys.left) steer -= 1;
    if (this.keys.right) steer += 1;
    if (this.touch) steer = this.steer;

    let accelerate = this.keys.accelerate;
    if (this.touch) accelerate = this.accelerate;

    this.onInput({ steer, accelerate });
  }

  drawStick(ctx, phase) {
    if (!this.touch || phase === 'gameover') return;
    const { originX, originY, x, y } = this.touch;
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(originX, originY, 36, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(x, y, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  destroy() {
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup', this._onKeyUp);
  }
}
