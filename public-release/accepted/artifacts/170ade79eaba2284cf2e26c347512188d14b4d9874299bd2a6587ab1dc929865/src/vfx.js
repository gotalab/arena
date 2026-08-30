export class VFXManager {
  constructor() {
    this.particles = [];
    this.floatingTexts = [];
    this.ambientSparks = [];
    this.screenShake = 0;
    this.shakeOffsetX = 0;
    this.shakeOffsetY = 0;
    this.initAmbientSparks();
  }

  reset() {
    this.particles = [];
    this.floatingTexts = [];
    this.screenShake = 0;
    this.shakeOffsetX = 0;
    this.shakeOffsetY = 0;
  }

  initAmbientSparks() {
    this.ambientSparks = [];
    for (let i = 0; i < 40; i++) {
      this.ambientSparks.push({
        x: (Math.random() - 0.5) * 340,
        y: Math.random() * 800 - 100,
        vy: 20 + Math.random() * 45,
        vx: (Math.random() - 0.5) * 15,
        size: 1 + Math.random() * 2.2,
        alpha: 0.2 + Math.random() * 0.5,
        flickerSpeed: 2 + Math.random() * 4,
        phase: Math.random() * Math.PI * 2
      });
    }
  }

  addShake(amount) {
    this.screenShake = Math.min(this.screenShake + amount, 16);
  }

  spawnTrail(x, y, vx, vy, isPanic = false) {
    const count = isPanic ? 1 : 2;
    for (let i = 0; i < count; i++) {
      const speed = Math.hypot(vx, vy);
      const angle = Math.atan2(vy, vx) + Math.PI + (Math.random() - 0.5) * 0.6;
      const pSpeed = speed * 0.15 + Math.random() * 30;

      this.particles.push({
        x: x + (Math.random() - 0.5) * 6,
        y: y + (Math.random() - 0.5) * 6,
        vx: Math.cos(angle) * pSpeed,
        vy: Math.sin(angle) * pSpeed,
        size: isPanic ? (2 + Math.random() * 2) : (3.5 + Math.random() * 3.5),
        maxLife: isPanic ? 0.25 : (0.35 + Math.random() * 0.25),
        life: 0,
        color: isPanic ? 'smoke' : 'fire'
      });
    }
  }

  spawnLaunchBlast(x, y, angle, strength) {
    this.addShake(2 + strength * 2.5);
    const count = 16 + Math.floor(strength * 12);
    for (let i = 0; i < count; i++) {
      const pAngle = angle + Math.PI + (Math.random() - 0.5) * 1.6;
      const speed = (80 + Math.random() * 220) * strength;
      this.particles.push({
        x, y,
        vx: Math.cos(pAngle) * speed,
        vy: Math.sin(pAngle) * speed,
        size: 3 + Math.random() * 4,
        maxLife: 0.4 + Math.random() * 0.3,
        life: 0,
        color: 'fire'
      });
    }
  }

  spawnLandPuff(x, y, isWall = false) {
    this.addShake(isWall ? 1.5 : 2.5);
    const count = isWall ? 10 : 16;
    for (let i = 0; i < count; i++) {
      const pAngle = isWall ? (x < 0 ? 0 : Math.PI) + (Math.random() - 0.5) * 1.5 : (Math.random() * Math.PI);
      const speed = 40 + Math.random() * 120;
      this.particles.push({
        x, y,
        vx: Math.cos(pAngle) * speed,
        vy: Math.sin(pAngle) * speed,
        size: 2.5 + Math.random() * 3.5,
        maxLife: 0.35 + Math.random() * 0.25,
        life: 0,
        color: isWall ? 'soot' : 'ember'
      });
    }
  }

  spawnMothBurst(x, y, chainCount = 0) {
    this.addShake(4 + Math.min(chainCount, 6) * 1.2);
    const count = 28 + Math.min(chainCount * 4, 30);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 240;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 3 + Math.random() * 4.5,
        maxLife: 0.5 + Math.random() * 0.4,
        life: 0,
        color: 'gold'
      });
    }
    // Starbursts
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * 160,
        vy: Math.sin(angle) * 160,
        size: 5,
        maxLife: 0.35,
        life: 0,
        color: 'star'
      });
    }
  }

  spawnGlimmerPickup(x, y, chainCount = 0) {
    this.addShake(2.5);
    const count = 22 + Math.min(chainCount * 3, 20);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 70 + Math.random() * 180;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed + 30, // slight upward float
        size: 3 + Math.random() * 3.5,
        maxLife: 0.55 + Math.random() * 0.3,
        life: 0,
        color: 'crystal'
      });
    }
  }

  spawnDampDeath(x, y) {
    this.addShake(10);
    for (let i = 0; i < 45; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 30 + Math.random() * 180;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed + 40,
        size: 4 + Math.random() * 6,
        maxLife: 0.8 + Math.random() * 0.6,
        life: 0,
        color: 'steam'
      });
    }
  }

  addFloatingText(text, x, y, color = '#ffdd44', scale = 1.0) {
    this.floatingTexts.push({
      text,
      x,
      y,
      vy: 45,
      life: 0,
      maxLife: 0.9,
      color,
      scale
    });
  }

  update(dt, cameraY) {
    // Screen shake decay
    if (this.screenShake > 0.05) {
      this.shakeOffsetX = (Math.random() - 0.5) * this.screenShake * 2;
      this.shakeOffsetY = (Math.random() - 0.5) * this.screenShake * 2;
      this.screenShake *= Math.pow(0.1, dt * 6);
    } else {
      this.screenShake = 0;
      this.shakeOffsetX = 0;
      this.shakeOffsetY = 0;
    }

    // Update Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.pow(0.2, dt);
      p.vy *= Math.pow(0.2, dt);
    }

    // Update Floating Texts
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.life += dt;
      if (ft.life >= ft.maxLife) {
        this.floatingTexts.splice(i, 1);
        continue;
      }
      ft.y += ft.vy * dt;
      ft.vy *= Math.pow(0.3, dt);
    }

    // Update Ambient Sparks relative to camera view
    const viewBottom = cameraY - 400;
    const viewTop = cameraY + 400;
    for (let i = 0; i < this.ambientSparks.length; i++) {
      const asp = this.ambientSparks[i];
      asp.y += asp.vy * dt;
      asp.x += asp.vx * dt;
      asp.phase += dt * asp.flickerSpeed;

      if (asp.y > viewTop + 50) {
        asp.y = viewBottom - 30;
        asp.x = (Math.random() - 0.5) * 320;
      }
    }
  }
}
