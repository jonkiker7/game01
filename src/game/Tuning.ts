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
  /**
   * Score. Balanced so finishing fast beats farming: the time bonus per second left on the clock
   * is worth more than the damage you could deal to the waves in that second (waves give roughly
   * 10–25 damage a second), but damage still adds up to about as much as the bonuses.
   */
  score: {
    perDamage: 1, // points per point of damage dealt
    clear: 1000, // finishing a mission
    bossClear: 2500, // beating the boss
    perSecond: 30, // time bonus per second left on the mission clock
    protect: 1000, // bonus at full health on what you protect (generator, convoy)
  },
  nova: {
    cooldown: 10, // seconds after firing before Nova is ready again
    damagePerSecond: 150, // damage you deal (not counting Nova itself) that takes 1 second off
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
