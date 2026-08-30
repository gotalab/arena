'use strict';

const Particles = (() => {
  const list = [];

  function spawnBurst(x, y, count, color, speed, life) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.6);
      list.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: life * (0.6 + Math.random() * 0.4),
        maxLife: life,
        color,
        size: 2 + Math.random() * 4,
      });
    }
  }

  function spawnSparkTrail(x, y, color) {
    list.push({
      x: x + (Math.random() - 0.5) * 6,
      y: y + (Math.random() - 0.5) * 6,
      vx: (Math.random() - 0.5) * 20,
      vy: (Math.random() - 0.5) * 20,
      life: 0.25 + Math.random() * 0.2,
      maxLife: 0.45,
      color,
      size: 1.5 + Math.random() * 2,
    });
  }

  function update(dt) {
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.life -= dt;
      if (p.life <= 0) {
        list.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy -= 40 * dt;
    }
  }

  function draw(ctx, camY, toScreen) {
    for (const p of list) {
      const s = toScreen(p.x, p.y);
      const alpha = p.life / p.maxLife;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, p.size * alpha, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function clear() {
    list.length = 0;
  }

  return { spawnBurst, spawnSparkTrail, update, draw, clear, list };
})();

window.Particles = Particles;
