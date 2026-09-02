// Game Entities: Machine, Ball, Enemies, and Visual Effects

import {
  STAGE_WIDTH,
  GROUND_Y,
  LOW_LANE_Y,
  HIGH_LANE_Y,
  MACHINE_RADIUS,
  MACHINE_GROUND_Y,
  MACHINE_SPEED,
  MACHINE_JUMP_VY,
  MACHINE_GRAVITY,
  BALL_RADIUS,
  BALL_GRAVITY,
  FLYER_SLOW_VISUAL_RADIUS,
  FLYER_SLOW_COLLISION_RADIUS,
  FLYER_FAST_VISUAL_RADIUS,
  FLYER_FAST_COLLISION_RADIUS,
  WALKER_VISUAL_RADIUS,
  WALKER_COLLISION_RADIUS
} from './constants.js';

export class Machine {
  constructor(x = STAGE_WIDTH / 2) {
    this.x = x;
    this.radius = MACHINE_RADIUS;
    this.y = MACHINE_GROUND_Y;
    this.vx = 0;
    this.vy = 0;
    this.grounded = true;
    this.jumpCount = 0;

    // Visual expression & animation timers
    this.expression = 'ready'; // 'ready', 'normal', 'windup', 'bounce', 'sparkle', 'dismay', 'deflated', 'spent'
    this.expressionTimer = 0;
    this.treadPhase = 0;
    this.suspensionY = 0; // spring compression
  }

  reset(x = STAGE_WIDTH / 2) {
    this.x = x;
    this.y = MACHINE_GROUND_Y;
    this.vx = 0;
    this.vy = 0;
    this.grounded = true;
    this.jumpCount = 0;
    this.expression = 'ready';
    this.expressionTimer = 0;
    this.treadPhase = 0;
    this.suspensionY = 0;
  }

  setExpression(expr, duration = 30) {
    this.expression = expr;
    this.expressionTimer = duration;
  }

  updatePhysics(input) {
    // Horizontal movement
    let targetVx = 0;
    if (input.left && !input.right) {
      targetVx = -MACHINE_SPEED;
    } else if (input.right && !input.left) {
      targetVx = MACHINE_SPEED;
    }

    // Smooth response with crisp stopping
    this.vx = targetVx;
    this.x += this.vx;

    // Bounds check
    if (this.x < this.radius) {
      this.x = this.radius;
      this.vx = 0;
    } else if (this.x > STAGE_WIDTH - this.radius) {
      this.x = STAGE_WIDTH - this.radius;
      this.vx = 0;
    }

    // Tread animation
    this.treadPhase += this.vx * 0.15;

    // Jump execution
    let jumped = false;
    if (input.jump && this.grounded) {
      this.vy = MACHINE_JUMP_VY;
      this.grounded = false;
      this.jumpCount += 1;
      jumped = true;
      this.suspensionY = -4; // spring pop
    }

    // Apply gravity if airborne
    let landed = false;
    if (!this.grounded) {
      this.vy += MACHINE_GRAVITY;
      this.y += this.vy;

      if (this.y >= MACHINE_GROUND_Y) {
        this.y = MACHINE_GROUND_Y;
        this.vy = 0;
        this.grounded = true;
        landed = true;
        this.suspensionY = 5; // landing squash
      }
    }

    // Suspension recovery
    this.suspensionY *= 0.82;

    // Expression timer countdown
    if (this.expressionTimer > 0) {
      this.expressionTimer -= 1;
      if (this.expressionTimer <= 0) {
        this.expression = 'normal';
      }
    }

    return { jumped, landed };
  }
}

export class Ball {
  constructor(x = STAGE_WIDTH / 2, y = MACHINE_GROUND_Y - MACHINE_RADIUS - BALL_RADIUS) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.radius = BALL_RADIUS;
    this.active = true;
    this.lastBounceKind = null; // null | 'weak' | 'normal' | 'power'

    // Visual expression & squash/stretch
    this.scaleX = 1.0;
    this.scaleY = 1.0;
    this.trail = [];
    this.expression = 'ready'; // 'ready', 'normal', 'power', 'excited', 'dizzy'
    this.expressionTimer = 0;
  }

  reset(x = STAGE_WIDTH / 2, y = MACHINE_GROUND_Y - MACHINE_RADIUS - BALL_RADIUS) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.radius = BALL_RADIUS;
    this.active = true;
    this.lastBounceKind = null;
    this.scaleX = 1.0;
    this.scaleY = 1.0;
    this.trail = [];
    this.expression = 'ready';
    this.expressionTimer = 0;
  }

  setExpression(expr, duration = 30) {
    this.expression = expr;
    this.expressionTimer = duration;
  }

  updatePhysics() {
    if (!this.active) return;

    // Apply gravity
    this.vy += BALL_GRAVITY;

    // Move
    this.x += this.vx;
    this.y += this.vy;

    // Left and Right Wall Bounces
    if (this.x - this.radius < 0) {
      this.x = this.radius;
      this.vx = Math.abs(this.vx) * 0.95;
    } else if (this.x + this.radius > STAGE_WIDTH) {
      this.x = STAGE_WIDTH - this.radius;
      this.vx = -Math.abs(this.vx) * 0.95;
    }

    // Top ceiling bounce
    if (this.y - this.radius < 0) {
      this.y = this.radius;
      this.vy = Math.abs(this.vy) * 0.75;
    }

    // Squash & Stretch calculation (visual only)
    const speed = Math.hypot(this.vx, this.vy);
    const stretch = Math.min(0.35, speed * 0.025);
    this.scaleY = 1.0 + stretch;
    this.scaleX = 1.0 / this.scaleY;

    // Expression timer
    if (this.expressionTimer > 0) {
      this.expressionTimer -= 1;
      if (this.expressionTimer <= 0) {
        this.expression = 'normal';
      }
    }
  }
}

export class Enemy {
  constructor({ id, type, lane, x, y, vx, hitsRequired = 3, visualRadius, collisionRadius }) {
    this.id = id;
    this.type = type; // 'slowFlyer' | 'fastFlyer' | 'walker'
    this.lane = lane; // 'low' | 'high' | 'ground'
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.active = true;
    this.hitsTaken = 0;
    this.hitsRequired = hitsRequired;
    this.visualRadius = visualRadius;
    this.collisionRadius = collisionRadius;

    // Transient state
    this.defeatTimer = 0; // observable briefly after defeat (35 ticks)
    this.overlappingWrongSide = false;
    this.overlappingHurt = false;
    this.flashTimer = 0;
    this.animPhase = 0;
  }

  updatePhysics() {
    this.animPhase += 0.08;

    // If active or during brief defeat linger
    if (this.active) {
      this.x += this.vx;
    }

    if (this.flashTimer > 0) {
      this.flashTimer -= 1;
    }

    if (!this.active && this.defeatTimer > 0) {
      this.defeatTimer -= 1;
    }
  }
}

// Visual Particle for juicy effects (view-only dressing)
export class Particle {
  constructor({ x, y, vx, vy, life = 30, color = '#ffeb3b', size = 4, shape = 'circle' }) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.maxLife = life;
    this.life = life;
    this.color = color;
    this.size = size;
    this.shape = shape; // 'circle', 'spark', 'star', 'gear'
    this.rotation = Math.random() * Math.PI * 2;
    this.vRot = (Math.random() - 0.5) * 0.2;
  }

  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.vx *= 0.95;
    this.vy = this.vy * 0.95 + 0.15; // gentle gravity
    this.rotation += this.vRot;
    this.life -= 1;
    return this.life > 0;
  }
}

// Floating Score / Time Popup (view-only dressing)
export class FloatingText {
  constructor({ x, y, text, color = '#00ffcc', size = 16, life = 45 }) {
    this.x = x;
    this.y = y;
    this.text = text;
    this.color = color;
    this.size = size;
    this.maxLife = life;
    this.life = life;
  }

  update() {
    this.y -= 0.8;
    this.life -= 1;
    return this.life > 0;
  }
}
