/**
 * Input Controller for DELVE
 * Unified touch joystick, mouse drag, and keyboard inputs.
 */
class InputManager {
  constructor(game, soundEngine, canvas) {
    this.game = game;
    this.sound = soundEngine;
    this.canvas = canvas;

    // Virtual Stick State
    this.pointerActive = false;
    this.pointerId = null;
    this.anchorX = 0;
    this.anchorY = 0;
    this.currentX = 0;
    this.currentY = 0;

    // Keys currently held
    this.keys = {
      down: false,
      space: false,
      left: false,
      right: false
    };

    this.setupKeyboard();
    this.setupPointer();
  }

  setupKeyboard() {
    window.addEventListener(
      "keydown",
      (e) => {
        this.sound.ensureContext();

        if (e.code === "ArrowDown") {
          this.keys.down = true;
          e.preventDefault();
        } else if (e.code === "Space") {
          this.keys.space = true;
          e.preventDefault();
        } else if (e.code === "ArrowLeft" || e.code === "KeyA") {
          this.keys.left = true;
          e.preventDefault();
        } else if (e.code === "ArrowRight" || e.code === "KeyD") {
          this.keys.right = true;
          e.preventDefault();
        } else if (e.code === "KeyR") {
          this.game.reset(this.game.seed);
          e.preventDefault();
        }
        this.syncInputs();
      },
      { passive: false }
    );

    window.addEventListener(
      "keyup",
      (e) => {
        if (e.code === "ArrowDown") {
          this.keys.down = false;
        } else if (e.code === "Space") {
          this.keys.space = false;
        } else if (e.code === "ArrowLeft" || e.code === "KeyA") {
          this.keys.left = false;
        } else if (e.code === "ArrowRight" || e.code === "KeyD") {
          this.keys.right = false;
        }
        this.syncInputs();
      },
      { passive: true }
    );
  }

  setupPointer() {
    const handleStart = (clientX, clientY, id = null) => {
      this.sound.ensureContext();

      if (this.game.phase === "gameover") {
        this.game.reset(this.game.seed);
        return;
      }

      this.pointerActive = true;
      this.pointerId = id;
      this.anchorX = clientX;
      this.anchorY = clientY;
      this.currentX = clientX;
      this.currentY = clientY;
      this.syncInputs();
    };

    const handleMove = (clientX, clientY, id = null) => {
      if (!this.pointerActive) return;
      if (id !== null && this.pointerId !== id) return;

      this.currentX = clientX;
      this.currentY = clientY;
      this.syncInputs();
    };

    const handleEnd = (id = null) => {
      if (!this.pointerActive) return;
      if (id !== null && this.pointerId !== id) return;

      this.pointerActive = false;
      this.pointerId = null;
      this.syncInputs();
    };

    // Touch events
    this.canvas.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
        if (e.changedTouches.length > 0) {
          const t = e.changedTouches[0];
          handleStart(t.clientX, t.clientY, t.identifier);
        }
      },
      { passive: false }
    );

    window.addEventListener(
      "touchmove",
      (e) => {
        if (!this.pointerActive) return;
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          if (t.identifier === this.pointerId) {
            handleMove(t.clientX, t.clientY, t.identifier);
            break;
          }
        }
      },
      { passive: true }
    );

    window.addEventListener(
      "touchend",
      (e) => {
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          if (t.identifier === this.pointerId) {
            handleEnd(t.identifier);
            break;
          }
        }
      },
      { passive: true }
    );

    window.addEventListener(
      "touchcancel",
      () => {
        handleEnd(null);
      },
      { passive: true }
    );

    // Mouse events
    this.canvas.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      handleStart(e.clientX, e.clientY, "mouse");
    });

    window.addEventListener("mousemove", (e) => {
      if (this.pointerActive && this.pointerId === "mouse") {
        handleMove(e.clientX, e.clientY, "mouse");
      }
    });

    window.addEventListener("mouseup", (e) => {
      if (this.pointerActive && this.pointerId === "mouse") {
        handleEnd("mouse");
      }
    });
  }

  syncInputs() {
    let down = this.keys.down || this.keys.space;
    let left = this.keys.left;
    let right = this.keys.right;

    if (this.pointerActive) {
      const dy = this.currentY - this.anchorY;
      const dx = this.currentX - this.anchorX;

      // Dragging down activates accelerator
      if (dy > 18) {
        down = true;
      }

      // Dragging horizontally steers
      if (dx < -16) {
        left = true;
      } else if (dx > 16) {
        right = true;
      }
    }

    this.game.setInput(down, left, right);
  }

  getPointerVisual() {
    if (!this.pointerActive) return null;
    return {
      anchorX: this.anchorX,
      anchorY: this.anchorY,
      currentX: this.currentX,
      currentY: this.currentY
    };
  }
}

window.InputManager = InputManager;
