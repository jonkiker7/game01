/**
 * Everything an upgrade can change during a run. Values start at the ship's defaults and
 * upgrades modify them; the game reads them every frame.
 */
export type PrimaryWeapon = 'machinegun' | 'scatter' | 'rail';
export type SecondaryWeapon = 'missile' | 'cluster' | 'swarm';
/** What every boost and barrel roll sends out (Armory). */
export type BoostCharge = 'none' | 'frost' | 'flame' | 'arc';

export interface Stats {
  primary: PrimaryWeapon;
  secondary: SecondaryWeapon;
  // Special weapons (enhanced by the Armory once fitted)
  scatterPellets: number; // pellets per Scatter Cannon blast
  railDamageMul: number; // Rail Lance bolt damage (× gun damage)
  clusterBomblets: number; // bomblets per Cluster Bomb
  swarmBonus: number; // extra rockets per Swarm volley
  boostCharge: BoostCharge; // a burst around the ship on every boost and roll
  boostChargeLevel: number; // its strength (1 when fitted, + each enhancement)
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
  // Special ability (Nova)
  specialChargeMul: number; // how fast it charges from damage dealt
  novaRadiusMul: number;
  // Arc family (lightning)
  arcRounds: number; // gun hits can chain lightning (level)
  arcWarheads: number; // missile blasts arc to nearby enemies
  staticField: number; // periodic zap on the nearest enemy
  // Cryo family (ice)
  cryoRounds: number; // gun hits chill; stacks freeze
  cryoWarheads: number; // missile blasts freeze
  frostbite: number; // chilled/frozen enemies take extra damage
  // Plasma family (fire)
  plasmaRounds: number; // gun hits ignite
  plasmaWarheads: number; // missile blasts ignite
  meltdown: number; // burning enemies explode when destroyed
  // Duos (need two families)
  superconductor: number; // Arc + Cryo: lightning chills
  thermalShock: number; // Cryo + Plasma: igniting a chilled enemy deals a burst of damage
}

export function defaultStats(): Stats {
  return {
    primary: 'machinegun',
    secondary: 'missile',
    scatterPellets: 6,
    railDamageMul: 4.5,
    clusterBomblets: 5,
    swarmBonus: 0,
    boostCharge: 'none',
    boostChargeLevel: 0,
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
    specialChargeMul: 1,
    novaRadiusMul: 1,
    arcRounds: 0,
    arcWarheads: 0,
    staticField: 0,
    cryoRounds: 0,
    cryoWarheads: 0,
    frostbite: 0,
    plasmaRounds: 0,
    plasmaWarheads: 0,
    meltdown: 0,
    superconductor: 0,
    thermalShock: 0,
  };
}

export type UpgradeCategory = 'gun' | 'missile' | 'boost' | 'hull' | 'special' | 'arc' | 'cryo' | 'plasma' | 'duo' | 'weapon';

export interface Upgrade {
  id: string;
  name: string;
  category: UpgradeCategory;
  /** Short line for the card. */
  text: string;
  /** How many times it can be taken in one run. */
  max: number;
  apply(s: Stats): void;
  /** Only offered when this returns true (e.g. duos need both families). */
  requires?: (s: Stats) => boolean;
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

// ---- Special ability ----
UPGRADES.push(
  { id: 'capacitor', name: 'Capacitor', category: 'special', text: 'Nova charges 35% faster.', max: 2, apply: (s) => (s.specialChargeMul *= 1.35) },
  { id: 'overload', name: 'Overload', category: 'special', text: 'Nova blast is 40% wider.', max: 2, apply: (s) => (s.novaRadiusMul *= 1.4) },
);

// ---- Families: Arc (lightning), Cryo (ice), Plasma (fire) ----
UPGRADES.push(
  { id: 'arc-rounds', name: 'Arc Rounds', category: 'arc', text: 'Bullet hits may chain lightning to 2 nearby enemies.', max: 2, apply: (s) => s.arcRounds++ },
  { id: 'arc-warheads', name: 'Arc Warheads', category: 'arc', text: 'Missile blasts arc lightning to 3 more enemies.', max: 2, apply: (s) => s.arcWarheads++ },
  { id: 'static-field', name: 'Static Field', category: 'arc', text: 'Every 2.5 s, zap the nearest enemy.', max: 2, apply: (s) => s.staticField++ },
  { id: 'cryo-rounds', name: 'Cryo Rounds', category: 'cryo', text: 'Bullet hits chill enemies. 5 chills freeze them solid.', max: 2, apply: (s) => s.cryoRounds++ },
  { id: 'cryo-warheads', name: 'Cryo Warheads', category: 'cryo', text: 'Missile blasts freeze everything they hit.', max: 2, apply: (s) => s.cryoWarheads++ },
  { id: 'frostbite', name: 'Frostbite', category: 'cryo', text: 'Chilled enemies take 20% more damage; frozen ones 50%.', max: 1, apply: (s) => s.frostbite++, requires: (s) => s.cryoRounds + s.cryoWarheads > 0 },
  { id: 'plasma-rounds', name: 'Plasma Rounds', category: 'plasma', text: 'Bullet hits set enemies burning.', max: 2, apply: (s) => s.plasmaRounds++ },
  { id: 'plasma-warheads', name: 'Plasma Warheads', category: 'plasma', text: 'Missile blasts ignite everything they hit.', max: 2, apply: (s) => s.plasmaWarheads++ },
  { id: 'meltdown', name: 'Meltdown', category: 'plasma', text: 'Burning enemies explode when destroyed.', max: 1, apply: (s) => s.meltdown++, requires: (s) => s.plasmaRounds + s.plasmaWarheads > 0 },
  {
    id: 'superconductor',
    name: 'Superconductor',
    category: 'duo',
    text: 'ARC + CRYO: lightning chills everything it strikes.',
    max: 1,
    apply: (s) => s.superconductor++,
    requires: (s) => s.arcRounds + s.arcWarheads + s.staticField > 0 && s.cryoRounds + s.cryoWarheads > 0,
  },
  {
    id: 'thermal-shock',
    name: 'Thermal Shock',
    category: 'duo',
    text: 'CRYO + PLASMA: igniting a chilled enemy deals a 30 damage burst.',
    max: 1,
    apply: (s) => s.thermalShock++,
    requires: (s) => s.cryoRounds + s.cryoWarheads > 0 && s.plasmaRounds + s.plasmaWarheads > 0,
  },
);

// ---- Weapons (offered by the Armory reward) ----
// A slot still holding its default weapon is offered the special ones (they replace it for the
// rest of the sortie: no going back). Once a special weapon is fitted, the Armory offers
// enhancements for it instead, so the ship keeps getting stronger.
export const PRIMARY_NAMES: Record<PrimaryWeapon, string> = { machinegun: 'Machine Gun', scatter: 'Scatter Cannon', rail: 'Rail Lance' };
export const SECONDARY_NAMES: Record<SecondaryWeapon, string> = { missile: 'Missiles', cluster: 'Cluster Bomb', swarm: 'Swarm Rockets' };

const WEAPONS: Upgrade[] = [
  // New weapons: only while the slot still has its default.
  { id: 'w-scatter', name: 'Scatter Cannon', category: 'weapon', text: 'Short-range blasts of 6 pellets. Devastating up close.', max: 1, apply: (s) => (s.primary = 'scatter'), requires: (s) => s.primary === 'machinegun' },
  { id: 'w-rail', name: 'Rail Lance', category: 'weapon', text: 'Slow, heavy bolts that pierce every enemy in a line.', max: 1, apply: (s) => (s.primary = 'rail'), requires: (s) => s.primary === 'machinegun' },
  { id: 'w-cluster', name: 'Cluster Bomb', category: 'weapon', text: 'The blast splits into 5 bomblets that scatter and explode.', max: 1, apply: (s) => (s.secondary = 'cluster'), requires: (s) => s.secondary === 'missile' },
  { id: 'w-swarm', name: 'Swarm Rockets', category: 'weapon', text: 'Release a volley of homing rockets; charge longer for more.', max: 1, apply: (s) => (s.secondary = 'swarm'), requires: (s) => s.secondary === 'missile' },
  // Enhancements for the special weapon you've fitted.
  {
    id: 'w-scatter-plus',
    name: 'Scatter Cannon+',
    category: 'weapon',
    text: 'Two more pellets per blast, and 20% more damage.',
    max: 3,
    apply: (s) => {
      s.scatterPellets += 2;
      s.gunDamage *= 1.2;
    },
    requires: (s) => s.primary === 'scatter',
  },
  {
    id: 'w-rail-plus',
    name: 'Rail Lance+',
    category: 'weapon',
    text: 'Bolts deal 35% more damage and fire 20% faster.',
    max: 3,
    apply: (s) => {
      s.railDamageMul *= 1.35;
      s.gunRate *= 1.2;
    },
    requires: (s) => s.primary === 'rail',
  },
  {
    id: 'w-cluster-plus',
    name: 'Cluster Bomb+',
    category: 'weapon',
    text: 'Two more bomblets, and 20% bigger blasts.',
    max: 3,
    apply: (s) => {
      s.clusterBomblets += 2;
      s.missileRadiusMul *= 1.2;
    },
    requires: (s) => s.secondary === 'cluster',
  },
  // Boost charges: fitted once (for good), then enhanced.
  {
    id: 'b-frost',
    name: 'Frost Burst',
    category: 'weapon',
    text: 'Every boost and barrel roll sends out a ring of frost that freezes the enemies around you.',
    max: 1,
    apply: (s) => ((s.boostCharge = 'frost'), (s.boostChargeLevel = 1)),
    requires: (s) => s.boostCharge === 'none',
  },
  {
    id: 'b-flame',
    name: 'Flame Burst',
    category: 'weapon',
    text: 'Every boost and barrel roll sends out a ring of fire that sets the enemies around you burning.',
    max: 1,
    apply: (s) => ((s.boostCharge = 'flame'), (s.boostChargeLevel = 1)),
    requires: (s) => s.boostCharge === 'none',
  },
  {
    id: 'b-arc',
    name: 'Arc Burst',
    category: 'weapon',
    text: 'Every boost and barrel roll throws lightning at up to 4 enemies around you.',
    max: 1,
    apply: (s) => ((s.boostCharge = 'arc'), (s.boostChargeLevel = 1)),
    requires: (s) => s.boostCharge === 'none',
  },
  {
    id: 'b-frost-plus',
    name: 'Frost Burst+',
    category: 'weapon',
    text: 'The frost ring is 30% wider and freezes for longer.',
    max: 3,
    apply: (s) => s.boostChargeLevel++,
    requires: (s) => s.boostCharge === 'frost',
  },
  {
    id: 'b-flame-plus',
    name: 'Flame Burst+',
    category: 'weapon',
    text: 'The fire ring is 30% wider and burns hotter.',
    max: 3,
    apply: (s) => s.boostChargeLevel++,
    requires: (s) => s.boostCharge === 'flame',
  },
  {
    id: 'b-arc-plus',
    name: 'Arc Burst+',
    category: 'weapon',
    text: 'Lightning reaches 30% farther, hits one more enemy, and strikes harder.',
    max: 3,
    apply: (s) => s.boostChargeLevel++,
    requires: (s) => s.boostCharge === 'arc',
  },
  {
    id: 'w-swarm-plus',
    name: 'Swarm Rockets+',
    category: 'weapon',
    text: 'Two more rockets per volley, and 20% more damage.',
    max: 3,
    apply: (s) => {
      s.swarmBonus += 2;
      s.missileDamageMul *= 1.2;
    },
    requires: (s) => s.secondary === 'swarm',
  },
];

/** Up to three Armory choices: new weapons for default slots, enhancements for special ones. */
export function rollWeapons(s: Stats, taken: Map<string, number>, count = 3): Upgrade[] {
  return shuffle(WEAPONS.filter((w) => (taken.get(w.id) ?? 0) < w.max && (!w.requires || w.requires(s)))).slice(0, count);
}

function shuffle<T>(list: T[]): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/** Three different upgrades the player hasn't maxed out yet (and meets the requirements for). */
export function rollUpgrades(taken: Map<string, number>, stats: Stats, count = 3): Upgrade[] {
  const pool = UPGRADES.filter((u) => (taken.get(u.id) ?? 0) < u.max && (!u.requires || u.requires(stats)));
  return shuffle(pool).slice(0, count);
}
