/**
 * Everything an upgrade can change during a run. Values start at the ship's defaults and
 * upgrades modify them; the game reads them every frame.
 */
export interface Stats {
  gunRate: number; // bullets per second
  gunDamage: number; // per bullet
  gunSideShots: number; // extra bullets fanned out either side
  missileMax: number;
  missileRecharge: number; // seconds per missile
  missileDamageMul: number;
  missileRadiusMul: number;
  maxArmor: number;
  boostCooldown: number; // seconds
  ramDamage: number; // damage dealt to enemies you boost through (0 = off)
  speedMul: number;
  healMul: number; // healing orb strength
  dropBonus: number; // added to healing orb drop chance
  salvageMul: number;
}

export function defaultStats(): Stats {
  return {
    gunRate: 11,
    gunDamage: 7,
    gunSideShots: 0,
    missileMax: 3,
    missileRecharge: 5,
    missileDamageMul: 1,
    missileRadiusMul: 1,
    maxArmor: 100,
    boostCooldown: 1.3,
    ramDamage: 0,
    speedMul: 1,
    healMul: 1,
    dropBonus: 0,
    salvageMul: 1,
  };
}

export type UpgradeCategory = 'gun' | 'missile' | 'boost' | 'hull';

export interface Upgrade {
  id: string;
  name: string;
  category: UpgradeCategory;
  /** Short line for the card. */
  text: string;
  /** How many times it can be taken in one run. */
  max: number;
  apply(s: Stats): void;
  /** Optional one-off effect when taken (e.g. heal). */
  onTake?: (ctx: { heal(amount: number): void }) => void;
}

/** The starter pool. Milestone 5 adds whole new weapons and upgrade families. */
export const UPGRADES: Upgrade[] = [
  { id: 'hot-barrels', name: 'Hot Barrels', category: 'gun', text: 'Machine gun fires 25% faster.', max: 3, apply: (s) => (s.gunRate *= 1.25) },
  { id: 'heavy-rounds', name: 'Heavy Rounds', category: 'gun', text: 'Bullets deal 30% more damage.', max: 3, apply: (s) => (s.gunDamage *= 1.3) },
  { id: 'split-shot', name: 'Split Shot', category: 'gun', text: 'Fire an extra bullet to each side.', max: 2, apply: (s) => (s.gunSideShots += 1) },
  { id: 'extra-rack', name: 'Extra Rack', category: 'missile', text: 'Carry one more missile.', max: 2, apply: (s) => (s.missileMax += 1) },
  { id: 'quick-loader', name: 'Quick Loader', category: 'missile', text: 'Missiles recharge 25% faster.', max: 3, apply: (s) => (s.missileRecharge *= 0.75) },
  {
    id: 'big-bang',
    name: 'Big Bang',
    category: 'missile',
    text: 'Missile blasts are 35% wider and 25% stronger.',
    max: 3,
    apply: (s) => {
      s.missileRadiusMul *= 1.35;
      s.missileDamageMul *= 1.25;
    },
  },
  {
    id: 'reinforced-hull',
    name: 'Reinforced Hull',
    category: 'hull',
    text: '+25 max armor, and repair 25 now.',
    max: 4,
    apply: (s) => (s.maxArmor += 25),
    onTake: (ctx) => ctx.heal(25),
  },
  { id: 'afterburner', name: 'Afterburner', category: 'boost', text: 'Boost recharges 30% faster.', max: 2, apply: (s) => (s.boostCooldown *= 0.7) },
  { id: 'ramjet', name: 'Ramjet', category: 'boost', text: 'Boosting through enemies deals 40 damage.', max: 2, apply: (s) => (s.ramDamage += 40) },
  { id: 'overdrive', name: 'Overdrive Engines', category: 'boost', text: 'Fly 15% faster.', max: 2, apply: (s) => (s.speedMul *= 1.15) },
  {
    id: 'nano-repair',
    name: 'Nano Repair',
    category: 'hull',
    text: 'Healing orbs heal 60% more and drop more often.',
    max: 2,
    apply: (s) => {
      s.healMul *= 1.6;
      s.dropBonus += 0.12;
    },
  },
  { id: 'salvager', name: 'Salvager', category: 'hull', text: 'Earn 50% more salvage.', max: 2, apply: (s) => (s.salvageMul *= 1.5) },
];

/** Three different upgrades the player hasn't maxed out yet. */
export function rollUpgrades(taken: Map<string, number>, count = 3): Upgrade[] {
  const pool = UPGRADES.filter((u) => (taken.get(u.id) ?? 0) < u.max);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}
