export const TICK_MS = 1000 / 60;
export const TICK_HZ = 60;
export const PRECISION = 3;

export const CRAWL_SPEED = 42;
export const CRUISE_SPEED = 210;
export const MAX_SPEED = 420;

export const INITIAL_TIME_MS = 48000;
export const FRAGMENT_TIME_MS = 2800;
export const POWER_TIME_MS = 1200;
export const POWER_DURATION_MS = 5500;

export const STALL_MS = 250;
export const PLAYER_RADIUS = 11;
export const NEAR_MISS_DIST = PLAYER_RADIUS * 2;

export const PREVIEW_DEPTH = 900;
export const SPAWN_AHEAD = 1200;
export const DESPAWN_BEHIND = 200;

export const BASE_HALF_WIDTH = 95;
export const MIN_HALF_WIDTH = 62;

export const RANKS = [
  { grade: 'D', min: 0 },
  { grade: 'C', min: 800 },
  { grade: 'B', min: 1800 },
  { grade: 'A', min: 3200 },
  { grade: 'S', min: 5000 },
  { grade: 'S+', min: 7500 },
];

export const FORMATION_KINDS = ['line', 'chevron', 'triangle', 'arc', 'vee'];
