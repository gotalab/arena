// Lumen Yard - Multi-modal Input Controller
// Touch (swipes & adjacent taps), Mouse, Keyboard, and Gamepad

export class InputController {
  constructor(game, renderer, audio, ui) {
    this.game = game;
    this.renderer = renderer;
    this.audio = audio;
    this.ui = ui;

    this.firstInputHappened = false;

    // Swipe tracking
    this.touchStartX = 0;
    this.touchStartY = 0;
    this.touchStartTime = 0;
    this.minSwipeDist = 25;
    this.maxSwipeTime = 500;

    // Gamepad state
    this.gamepadIndex = null;
    this.lastGamepadAxes = { x: 0, y: 0 };
    this.lastGamepadButtons = {};
    this.gamepadPollInterval = null;

    this.initKeyboard();
    this.initTouchAndMouse();
    this.initGamepad();
  }

  notifyFirstInput() {
    if (!this.firstInputHappened) {
      this.firstInputHappened = true;
      this.audio.unlock();
      this.ui.dismissInvitation();
    }
  }

  tryMove(direction) {
    this.notifyFirstInput();
    try {
      this.game.act({ type: 'move', direction });
    } catch (err) {
      // Ignored or handled via visual refusal
    }
  }

  tryUndo() {
    this.notifyFirstInput();
    try {
      this.game.act({ type: 'undo' });
      this.renderer.triggerUndo();
    } catch (err) {}
  }

  tryRestart() {
    this.notifyFirstInput();
    this.game.restart();
  }

  initKeyboard() {
    window.addEventListener('keydown', (e) => {
      // If modal or board map is open, handle modal keys
      if (this.ui.isModalOpen()) {
        if (e.key === 'Escape') {
          this.ui.closeModals();
          e.preventDefault();
        }
        return;
      }

      let handled = true;
      switch (e.key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
          this.tryMove('up');
          break;
        case 'ArrowDown':
        case 's':
        case 'S':
          this.tryMove('down');
          break;
        case 'ArrowLeft':
        case 'a':
        case 'A':
          this.tryMove('left');
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          this.tryMove('right');
          break;
        case 'u':
        case 'U':
        case 'Backspace':
          this.tryUndo();
          break;
        case 'r':
        case 'R':
          this.tryRestart();
          break;
        case 'm':
        case 'M':
          this.notifyFirstInput();
          this.ui.toggleBoardMap();
          break;
        case 'Escape':
          this.ui.toggleBoardMap();
          break;
        default:
          handled = false;
      }

      if (handled) {
        e.preventDefault();
      }
    });
  }

  initTouchAndMouse() {
    const canvas = this.renderer.canvas;

    // Prevent scrolling / gesture zooming on game canvas
    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        const t = e.touches[0];
        this.touchStartX = t.clientX;
        this.touchStartY = t.clientY;
        this.touchStartTime = performance.now();
      }
    }, { passive: true });

    canvas.addEventListener('touchend', (e) => {
      if (this.ui.isModalOpen()) return;
      if (e.changedTouches.length === 1) {
        const t = e.changedTouches[0];
        const dx = t.clientX - this.touchStartX;
        const dy = t.clientY - this.touchStartY;
        const dt = performance.now() - this.touchStartTime;

        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist >= this.minSwipeDist && dt <= this.maxSwipeTime) {
          // Swipe detected
          if (Math.abs(dx) > Math.abs(dy)) {
            this.tryMove(dx > 0 ? 'right' : 'left');
          } else {
            this.tryMove(dy > 0 ? 'down' : 'up');
          }
        } else if (dist < 15) {
          // Tap detected: check adjacent tile
          const rect = canvas.getBoundingClientRect();
          const screenX = t.clientX - rect.left;
          const screenY = t.clientY - rect.top;
          this.handleTapOnGrid(screenX, screenY);
        }
      }
    });

    // Mouse click on canvas for adjacent tile move
    canvas.addEventListener('click', (e) => {
      if (this.ui.isModalOpen()) return;
      const rect = canvas.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      this.handleTapOnGrid(screenX, screenY);
    });
  }

  handleTapOnGrid(screenX, screenY) {
    const cell = this.renderer.screenToGrid(screenX, screenY);
    if (!cell) return;

    const p = this.game.player;
    const dr = cell.row - p.row;
    const dc = cell.col - p.col;

    // Must be orthogonally adjacent
    if (Math.abs(dr) + Math.abs(dc) === 1) {
      if (dr === -1) this.tryMove('up');
      else if (dr === 1) this.tryMove('down');
      else if (dc === -1) this.tryMove('left');
      else if (dc === 1) this.tryMove('right');
    }
  }

  initGamepad() {
    window.addEventListener('gamepadconnected', (e) => {
      this.gamepadIndex = e.gamepad.index;
      if (!this.gamepadPollInterval) {
        this.startGamepadPolling();
      }
    });

    window.addEventListener('gamepaddisconnected', (e) => {
      if (this.gamepadIndex === e.gamepad.index) {
        this.gamepadIndex = null;
      }
    });
  }

  startGamepadPolling() {
    const poll = () => {
      if (this.gamepadIndex !== null) {
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        const gp = gamepads[this.gamepadIndex];
        if (gp) {
          this.processGamepadInput(gp);
        }
      }
      requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  }

  processGamepadInput(gp) {
    if (this.ui.isModalOpen()) return;

    // D-Pad buttons: 12: Up, 13: Down, 14: Left, 15: Right
    const btnUp = gp.buttons[12] && gp.buttons[12].pressed;
    const btnDown = gp.buttons[13] && gp.buttons[13].pressed;
    const btnLeft = gp.buttons[14] && gp.buttons[14].pressed;
    const btnRight = gp.buttons[15] && gp.buttons[15].pressed;

    // Sticks
    const axisX = gp.axes[0] || 0;
    const axisY = gp.axes[1] || 0;
    const deadzone = 0.45;

    let moveDir = null;
    if (btnUp || (axisY < -deadzone && this.lastGamepadAxes.y >= -deadzone)) moveDir = 'up';
    else if (btnDown || (axisY > deadzone && this.lastGamepadAxes.y <= deadzone)) moveDir = 'down';
    else if (btnLeft || (axisX < -deadzone && this.lastGamepadAxes.x >= -deadzone)) moveDir = 'left';
    else if (btnRight || (axisX > deadzone && this.lastGamepadAxes.x <= deadzone)) moveDir = 'right';

    if (moveDir) {
      this.tryMove(moveDir);
    }

    this.lastGamepadAxes = { x: axisX, y: axisY };

    // Action buttons
    // Button 0 (A / Cross): Primary action
    const btnA = gp.buttons[0] && gp.buttons[0].pressed;
    // Button 1 (B / Circle): Undo
    const btnB = gp.buttons[1] && gp.buttons[1].pressed;
    // Button 9 (Start): Restart / Menu
    const btnStart = gp.buttons[9] && gp.buttons[9].pressed;

    if (btnB && !this.lastGamepadButtons[1]) {
      this.tryUndo();
    }
    if (btnStart && !this.lastGamepadButtons[9]) {
      this.tryRestart();
    }

    this.lastGamepadButtons = {
      0: btnA,
      1: btnB,
      9: btnStart
    };
  }
}
