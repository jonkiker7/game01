/**
 * Gameplay numbers that the dev panel (`?dev`) can change while you play. Edit the defaults
 * here to make a change permanent.
 */
export const TUNING = {
  ship: {
    maxSpeed: 52, // units per second at full stick
    boostSpeed: 160,
    rollSpeed: 95, // sideways kick of a barrel roll
    rollCooldown: 0.9,
  },
  towerBombs: {
    speed: 34, // units per second across the ground
    radius: 20, // blast radius (matches the red warning ring)
    damage: 14,
  },
  swarmers: {
    chaseSpeed: 26,
    diveRange: 26, // starts a dive when this close
    windup: 0.85, // seconds of glowing tell before diving
    diveSpeed: 44,
    diveTime: 1, // seconds a dive lasts
    hitRadius: 2.4, // contact distance
    damage: 4, // per bug that hits
    restMin: 2.4, // seconds between dives: restMin to restMin + restExtra
    restExtra: 2,
  },
};
