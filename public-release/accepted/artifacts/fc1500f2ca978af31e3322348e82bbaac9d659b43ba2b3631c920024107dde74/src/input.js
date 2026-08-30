/**
 * Unified Input Controller for Keyboard, Touch, and Mouse.
 */
export class InputController {
  constructor(canvas, game, soundSystem) {
    this.canvas = canvas;
    this.game = game;
    this.sound = soundSystem;

    // Keyboard state
    this.keys = {
      down: false,
      space: false,
      left: false,
      right: false
    };

    // Virtual stick state (for touch & mouse drag)
    this.touchStick = {
      active: false,
      startX: 0,
      startY: 0,
      currentX: 0,
      currentY: 0,
      dragDown: false,
      dragLeft: false,
      dragRight: false
    };

    this.isPointerDown = false;
    this._attachListeners();
  }

  _attachListeners() {
    // 1. Keyboard listeners on document level
    window.addEventListener('keydown', (e) => {
      if (['Space', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }

      this.sound.unlock();

      if (e.code === 'KeyR') {
        this.game.reset(this.game.seed);
        return;
      }

      if (e.code === 'ArrowDown') this.keys.down = true;
      if (e.code === 'Space') this.keys.space = true;
      if (e.code === 'ArrowLeft') this.keys.left = true;
      if (e.code === 'ArrowRight') this.keys.right = true;

      this._syncGameInput();
    });

    window.addEventListener('keyup', (e) => {
      if (['Space', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }

      if (e.code === 'ArrowDown') this.keys.down = false;
      if (e.code === 'Space') this.keys.space = false;
      if (e.code === 'ArrowLeft') this.keys.left = false;
      if (e.code === 'ArrowRight') this.keys.right = false;

      this._syncGameInput();
    });

    // 2. Pointer / Touch events on canvas
    const onPointerDown = (clientX, clientY) => {
      this.sound.unlock();

      if (this.game.phase === 'gameover') {
        this.game.reset(this.game.seed);
        return;
      }

      const rect = this.canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;

      this.isPointerDown = true;
      this.touchStick.active = true;
      this.touchStick.startX = x;
      this.touchStick.startY = y;
      this.touchStick.currentX = x;
      this.touchStick.currentY = y;
      this.touchStick.dragDown = false;
      this.touchStick.dragLeft = false;
      this.touchStick.dragRight = false;
    };

    const onPointerMove = (clientX, clientY) => {
      if (!this.isPointerDown || !this.touchStick.active) return;

      const rect = this.canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;

      this.touchStick.currentX = x;
      this.touchStick.currentY = y;

      const dx = x - this.touchStick.startX;
      const dy = y - this.touchStick.startY;

      // Thresholds for drag stick
      const THROTTLE_THRESHOLD = 15;
      const STEER_THRESHOLD = 14;

      this.touchStick.dragDown = dy > THROTTLE_THRESHOLD;
      this.touchStick.dragLeft = dx < -STEER_THRESHOLD;
      this.touchStick.dragRight = dx > STEER_THRESHOLD;

      this._syncGameInput();
    };

    const onPointerUp = () => {
      this.isPointerDown = false;
      this.touchStick.active = false;
      this.touchStick.dragDown = false;
      this.touchStick.dragLeft = false;
      this.touchStick.dragRight = false;
      this._syncGameInput();
    };

    // Touch events
    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (e.touches.length > 0) {
        onPointerDown(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: false });

    window.addEventListener('touchmove', (e) => {
      if (e.touches.length > 0) {
        onPointerMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: false });

    window.addEventListener('touchend', (e) => {
      onPointerUp();
    });

    window.addEventListener('touchcancel', (e) => {
      onPointerUp();
    });

    // Mouse events
    this.canvas.addEventListener('mousedown', (e) => {
      e.preventDefault();
      onPointerDown(e.clientX, e.clientY);
    });

    window.addEventListener('mousemove', (e) => {
      onPointerMove(e.clientX, e.clientY);
    });

    window.addEventListener('mouseup', (e) => {
      onPointerUp();
    });
  }

  _syncGameInput() {
    const down = this.keys.down || this.keys.space || this.touchStick.dragDown;
    const left = this.keys.left || this.touchStick.dragLeft;
    const right = this.keys.right || this.touchStick.dragRight;

    this.game.setInput(down, left, right);
  }
}
