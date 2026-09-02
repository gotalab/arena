// Game Constants & Configuration

export const STAGE_WIDTH = 400;
export const STAGE_HEIGHT = 640;

// Fixed Geometry
export const GROUND_Y = 560;
export const LOW_LANE_Y = 280;
export const HIGH_LANE_Y = 140;

// Machine Geometry & Physics
export const MACHINE_RADIUS = 20; // visual and collision radius
export const MACHINE_GROUND_Y = GROUND_Y - MACHINE_RADIUS; // 540
export const MACHINE_SPEED = 5.2; // px per tick (at 60Hz: can traverse 400px in ~77 ticks)
export const MACHINE_JUMP_VY = -9.8; // jump impulse
export const MACHINE_GRAVITY = 0.35; // gravity for machine
// Apex from jump: vy^2 / (2*g) = (9.8^2) / (0.7) = 96.04 / 0.7 = 137.2px.
// 540 - 137.2 = 402.8. Let's round to 402.
export const MACHINE_NORMAL_APEX_Y = 402; // Well below LOW_LANE_Y (280)

// Ball Geometry & Physics
export const BALL_RADIUS = 10;
export const BALL_GRAVITY = 0.28;

// Bounce velocities
export const BOUNCE_WEAK_VY = -8.2;   // Apex ~120px above machine (y ~ 400), below low lane (280)
export const BOUNCE_NORMAL_VY = -13.6;// Apex ~330px above machine (y ~ 190), through low lane, below high lane (140)
export const BOUNCE_POWER_VY = -16.8; // Apex ~504px above machine (y ~ 16), cleanly through high lane (140)
export const BALL_REBOUND_VY = -12.4; // Rebound after valid top hit on flyer

// Timing & Clock
export const START_CLOCK_MS = 75000; // 75 seconds starting clock
export const TICK_MS = 1000 / 60;    // 16.666666666666668 ms

// Time rewards & penalties (amountMs)
export const TIME_REWARD_HIT_1 = 3000;  // 3s
export const TIME_REWARD_HIT_2 = 6000;  // 6s
export const TIME_REWARD_HIT_3 = 12000; // 12s (target defeated)
export const TIME_REWARD_STOMP = 2000;  // 2s

export const TIME_PENALTY_WRONG_SIDE = -4000; // -4s
export const TIME_PENALTY_BALL_DROP = -6000;  // -6s (more than wrong-side)
export const TIME_PENALTY_BODY_HIT = -3000;   // -3s

// Scores
export const SCORE_HIT_1 = 100;
export const SCORE_HIT_2 = 200;
export const SCORE_HIT_3 = 500;
export const SCORE_STOMP = 150;

// Enemy Sizes
export const FLYER_SLOW_VISUAL_RADIUS = 24;
export const FLYER_SLOW_COLLISION_RADIUS = 24; // <= visualRadius * 1.1

export const FLYER_FAST_VISUAL_RADIUS = 22;
export const FLYER_FAST_COLLISION_RADIUS = 22;

export const WALKER_VISUAL_RADIUS = 18;
export const WALKER_COLLISION_RADIUS = 18;

// Ranks
export const RANK_THRESHOLDS = [
  { minScore: 5000, rank: 'S+' },
  { minScore: 3000, rank: 'S' },
  { minScore: 1800, rank: 'A' },
  { minScore: 800,  rank: 'B' },
  { minScore: 0,    rank: 'C' }
];

export function getRankForScore(score) {
  for (const item of RANK_THRESHOLDS) {
    if (score >= item.minScore) return item.rank;
  }
  return 'C';
}
