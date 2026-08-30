'use strict';

const WorldGen = (() => {
  const WALL_LEFT = 52;
  const WALL_RIGHT = 308;
  const FLUE_WIDTH = WALL_RIGHT - WALL_LEFT;
  const LAUNCH_REACH = 185;
  const GRAVITY = 820;
  const MAX_LAUNCH_SPEED = Math.sqrt(2 * GRAVITY * LAUNCH_REACH);

  function generate(rng, startY) {
    const ledges = [];
    const items = [];
    let nextId = 1;
    let spawnIndex = 0;
    let y = startY || 80;
    let lastX = (WALL_LEFT + WALL_RIGHT) / 2;
    const maxY = 50000;

    // Starting ledge
    ledges.push({
      id: nextId++,
      position: { x: lastX, y },
      halfWidth: 55,
      active: true,
    });

    let tier = 0;
    while (y < maxY) {
      tier++;
      const spacing = LAUNCH_REACH * (0.5 + rng.range(0, 0.32));
      const maxHoriz = LAUNCH_REACH * 0.52;
      const offset = rng.range(-maxHoriz, maxHoriz);
      let nx = lastX + offset;
      nx = Math.max(WALL_LEFT + 45, Math.min(WALL_RIGHT - 45, nx));
      const ny = y + spacing + rng.range(-15, 25);

      const halfW = Math.max(28, 52 - tier * 0.35 + rng.range(-8, 8));
      const ledge = {
        id: nextId++,
        position: { x: nx, y: ny },
        halfWidth: halfW,
        active: true,
      };
      ledges.push(ledge);
      spawnIndex++;

      // Glimmer temptation — between ledges, off the safe line
      if (tier % 2 === 0 || rng.next() < 0.45) {
        const gx = (WALL_LEFT + WALL_RIGHT) / 2 + rng.range(-0.35, 0.35) * FLUE_WIDTH;
        const gy = y + spacing * rng.range(0.35, 0.75);
        items.push({
          id: nextId++,
          type: 'glimmer',
          position: { x: gx, y: gy },
          active: true,
          visualRadius: 10,
          collisionRadius: 9,
          phase: rng.range(0, Math.PI * 2),
          driftAmp: rng.range(4, 10),
        });
      }

      // Moth lifeline
      if (tier % 3 === 1 || (tier > 4 && rng.next() < 0.35)) {
        const mx = rng.range(WALL_LEFT + 30, WALL_RIGHT - 30);
        const my = y + spacing * rng.range(0.4, 0.9);
        items.push({
          id: nextId++,
          type: 'moth',
          position: { x: mx, y: my },
          active: true,
          visualRadius: 11,
          collisionRadius: 10,
          phase: rng.range(0, Math.PI * 2),
          driftX: rng.range(18, 32),
          driftY: rng.range(6, 14),
          baseX: mx,
          baseY: my,
        });
      }

      lastX = nx;
      y = ny;
    }

    return { ledges, items, spawnIndex, WALL_LEFT, WALL_RIGHT, LAUNCH_REACH, MAX_LAUNCH_SPEED, GRAVITY };
  }

  return {
    generate,
    WALL_LEFT,
    WALL_RIGHT,
    LAUNCH_REACH,
    GRAVITY,
    MAX_LAUNCH_SPEED,
    FLUE_WIDTH,
  };
})();

window.WorldGen = WorldGen;
