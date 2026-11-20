import * as THREE from 'three';
import type { Effects } from './Effects';
import type { Enemy, EnemyManager } from './Enemies';
import type { Hittable } from './Projectiles';
import type { Stats } from './run/Upgrades';

export type HitSource = 'gun' | 'missile' | 'bomblet' | 'ram' | 'nova' | 'arc' | 'meltdown';

const ARC_RANGE = 24; // how far lightning can jump (on-screen distance at flying height)
const ARC_COLOR = '#a9c8ff';

/**
 * Every hit on an enemy goes through here, so upgrades can react to it:
 * - Arc: lightning chains to nearby enemies.
 * - Cryo: chill (slow) and freeze; Frostbite makes chilled/frozen enemies take more damage.
 * - Plasma: set enemies burning; Meltdown makes burning enemies explode when destroyed.
 * Damage dealt also charges the special ability.
 */
export class Combat {
  /** Called with the damage actually dealt (charges the special). */
  onDamage?: (amount: number) => void;
  private staticTimer = 2.5;
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();

  constructor(
    private readonly enemies: EnemyManager,
    private readonly effects: Effects,
    private readonly stats: () => Stats,
  ) {}

  hit(target: Hittable, amount: number, source: HitSource): void {
    const e = target as Enemy;
    if (!e.alive) return;
    const s = this.stats();

    // Frostbite: chilled enemies take +20%, frozen ones +50%.
    let dmg = amount;
    if (s.frostbite > 0) dmg *= e.frozen > 0 ? 1.5 : e.chilled > 0 ? 1.2 : 1;

    // Elemental effects (applied before the damage so a killing blow still triggers visuals).
    const fromGun = source === 'gun';
    const fromBlast = source === 'missile' || source === 'bomblet';
    if (fromGun && s.cryoRounds > 0) e.chill(s.cryoRounds);
    if (fromBlast && s.cryoWarheads > 0) e.freeze(1.2 + 0.6 * s.cryoWarheads);
    if (source === 'arc' && s.superconductor > 0) e.chill(2);
    const igniteGun = fromGun && s.plasmaRounds > 0;
    const igniteBlast = fromBlast && s.plasmaWarheads > 0;
    if (igniteGun || igniteBlast) {
      // Thermal Shock: igniting a chilled or frozen enemy bursts for extra damage.
      if (s.thermalShock > 0 && !e.burning && (e.chilled > 0 || e.frozen > 0)) {
        dmg += 30;
        this.effects.spark(this.posOf(e, this.a), '#ffffff', 2.2);
      }
      e.ignite(igniteBlast ? 10 + 4 * s.plasmaWarheads : 5 + 3 * s.plasmaRounds, igniteBlast ? 4 : 3);
    }

    // Gunfire can be blocked by shields; missiles and explosions get through.
    e.damage(dmg, source !== 'gun' && source !== 'arc');
    this.onDamage?.(dmg);

    // Arc: chain lightning onward.
    if (fromGun && s.arcRounds > 0 && Math.random() < 0.18 + 0.1 * s.arcRounds) this.chain(e, 2, 6 + 4 * s.arcRounds);
    if (fromBlast && s.arcWarheads > 0) this.chain(e, 3, 18 + 10 * s.arcWarheads);
  }

  /** Lightning jumps from `from` to up to `count` nearby enemies. */
  chain(from: Enemy, count: number, damage: number): void {
    const start = this.posOf(from, this.a).clone();
    const targets = this.enemies.nearest(start.x, start.z, ARC_RANGE, count, new Set([from]));
    let prev = start;
    for (const t of targets) {
      const p = this.posOf(t, this.b).clone();
      this.effects.lightning(prev, p, ARC_COLOR);
      this.hit(t, damage, 'arc');
      prev = p;
    }
  }

  /** Static Field: every few seconds, zap the enemy nearest the ship. */
  update(dt: number, ship: THREE.Vector3): void {
    const s = this.stats();
    if (s.staticField <= 0) return;
    this.staticTimer -= dt;
    if (this.staticTimer > 0) return;
    this.staticTimer = 2.5 / (1 + 0.5 * (s.staticField - 1));
    const [t] = this.enemies.nearest(ship.x, ship.z, 40, 1);
    if (!t) return;
    this.effects.lightning(this.a.copy(ship), this.posOf(t, this.b), ARC_COLOR);
    this.hit(t, 18 + 8 * s.staticField, 'arc');
  }

  /** Meltdown: a burning enemy explodes when destroyed. */
  onKill(e: Enemy, pos: THREE.Vector3, groundY: number): void {
    if (this.stats().meltdown <= 0 || !e.burning) return;
    this.effects.explosion(pos, 5, groundY);
    this.enemies.damageAt(pos, 8, 30, (t, amt) => this.hit(t, amt, 'meltdown'));
  }

  /** Where an enemy appears on screen, at flying height (for drawing lightning). */
  private posOf(e: Enemy, out: THREE.Vector3): THREE.Vector3 {
    return this.enemies.visualPosition(e, out);
  }
}
