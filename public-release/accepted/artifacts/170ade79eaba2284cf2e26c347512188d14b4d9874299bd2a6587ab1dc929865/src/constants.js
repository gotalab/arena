export const CONSTANTS = {
  // World geometry
  WALL_LEFT_X: -180,
  WALL_RIGHT_X: 180,
  FLUE_WIDTH: 360,
  PLAYER_RADIUS: 12,

  // Glow Economy
  JUMP_CAPACITY: 3,

  // Physics
  GRAVITY: -900,
  MAX_LAUNCH_SPEED: 675,
  MIN_LAUNCH_SPEED: 220,
  WALL_SLIP_SPEED: -45,
  MOTH_BOUNCE_VY: 560,

  // Input & Aim
  DRAG_DEADZONE_PX: 14,
  DRAG_MAX_PX: 105,
  SLOW_MO_SCALE: 0.32,

  // Damp parameters
  DAMP_INITIAL_Y: -120,
  BASE_DAMP_SPEED: 42,
  DAMP_ACCEL_PER_HEIGHT: 0.015, // rises faster with height

  // Entity Radii
  GLIMMER_RADIUS: 13,
  GLIMMER_COLLISION_RADIUS: 14,
  MOTH_VISUAL_RADIUS: 15,
  MOTH_COLLISION_RADIUS: 16,

  // Fixed Tick Rate
  TICK_RATE: 60,
  DT: 1 / 60,
};

// Theoretical straight-up height gain: v0^2 / (2 * |g|)
CONSTANTS.LAUNCH_REACH = (CONSTANTS.MAX_LAUNCH_SPEED * CONSTANTS.MAX_LAUNCH_SPEED) / (2 * Math.abs(CONSTANTS.GRAVITY));

export function getRank(score) {
  if (score < 150) return "Cinder";
  if (score < 400) return "Ember";
  if (score < 800) return "Spark";
  if (score < 1400) return "Flame";
  if (score < 2200) return "Blaze";
  if (score < 3300) return "Inferno";
  if (score < 4700) return "Solar";
  return "Supernova";
}

export function getChainScore(chainCount) {
  if (chainCount <= 0) return 0;
  // Escalating bonus: 1->25, 2->75, 3->160, 4->300, 5->500, 6+ -> 500 + (n-5)*250
  const table = [0, 25, 75, 160, 300, 500];
  if (chainCount < table.length) return table[chainCount];
  return 500 + (chainCount - 5) * 250;
}
