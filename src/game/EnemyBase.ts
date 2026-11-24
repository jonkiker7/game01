import * as THREE from 'three';
import type { Effects } from './Effects';
import { glow, rimToon } from './materials';
import type { Mortars } from './Mortars';
import type { EnemyShots, Hittable } from './Projectiles';
import type { Ship } from './Ship';
import type { World } from './World';

export const ENEMY_BODY = '#3b1d4a';
export const ENEMY_ARMOR = '#6a2f63';
export const ENEMY_GLOW = '#ff2e63';
export const TOWER_STONE = '#4a2f5e';
/** Enemies only attack inside this distance, which roughly matches what's visible on screen. */
export const ATTACK_RANGE = 36;
/** Towers lob mortars from much farther away (the landing ring warns you where they'll hit). */
export const TOWER_RANGE = 75;

export interface Ctx {
  ship: Ship;
  shots: EnemyShots;
  mortars: Mortars;
  world: World;
  dt: number;
  /** True if this enemy's gun is on screen. Enemies only shoot when you can see them. */
  onScreen: (e: Enemy) => boolean;
  effects: Effects;
  /** For big moments (bosses announcing things). */
  hud?: { show: (text: string, seconds?: number) => void };
  /** Add a new enemy (e.g. a mine) at (x, z). */
  spawn: (e: Enemy, x: number, z: number) => void;
}

/** Every enemy species (see EnemyTypes.ts for the newer ones). */
export type Species = 'turret' | 'drone' | 'swarmer' | 'lancer' | 'crawler' | 'sniper' | 'minelayer' | 'pulsar' | 'mine' | 'boss' | 'bosspart' | 'saboteur' | 'pylon' | 'fortress';

export abstract class Enemy implements Hittable {
  readonly root = new THREE.Group();
  abstract readonly radius: number;
  abstract readonly hitBottom: number;
  abstract readonly hitTop: number;
  abstract readonly aimHeight: number;
  /** 'turret' = objective towers, 'drone' = anything flying, 'ground' = ground units. */
  abstract readonly kind: 'turret' | 'drone' | 'ground';
  /** Which kind of enemy this is (for spawning, names and tuning). */
  abstract readonly species: Species;
  /** Salvage for destroying it. */
  salvage = 3;
  /** How much of a wave's enemy budget this takes (a swarm bug is a fraction, mines are free). */
  weight = 1;
  /** Whether aim assist and missile lock-on may pick this enemy (a shielded boss core says no). */
  get aimable(): boolean {
    return true;
  }
  /** Chance a wreck drops a healing orb. */
  dropChance = 0.25;
  alive = true;
  /** A contract target (the "alpha"): bigger, tougher, marked on the radar. */
  elite = false;
  protected hp: number;
  protected flash = 0;
  protected readonly mats: THREE.MeshToonMaterial[] = [];
  /** Every toon material, for status tints (chilled blue, burning orange). */
  private readonly allMats: THREE.MeshToonMaterial[] = [];
  protected time = Math.random() * 10;

  // ---- Status effects (from Cryo and Plasma upgrades) ----
  /** Seconds left chilled (slowed), and chill stacks building toward a freeze. */
  chilled = 0;
  private chillStacks = 0;
  /** Seconds left frozen solid (can't move or shoot). */
  frozen = 0;
  /** Burning: damage per second and seconds left. */
  burnDps = 0;
  burnTime = 0;
  private ice: THREE.Mesh | null = null;

  constructor(readonly maxHp: number) {
    this.hp = maxHp;
  }

  /** Set by the manager so a kill can trigger effects/score. */
  onKilled?: (e: Enemy) => void;

  /** `blast` is true for missiles and explosions (they get past shields). */
  damage(amount: number, _blast = false): void {
    if (!this.alive) return;
    this.hp -= amount;
    this.flash = 0.08;
    if (this.hp <= 0) {
      this.alive = false;
      this.onKilled?.(this);
    }
  }

  get burning(): boolean {
    return this.burnTime > 0;
  }

  /** Add chill stacks; 5 stacks freezes the enemy. */
  chill(stacks: number): void {
    if (!this.alive) return;
    this.chilled = 2.5;
    this.chillStacks += stacks;
    if (this.chillStacks >= 5) {
      this.chillStacks = 0;
      this.freeze(1.6);
    }
  }

  freeze(seconds: number): void {
    if (!this.alive) return;
    this.frozen = Math.max(this.frozen, seconds);
    this.chilled = Math.max(this.chilled, seconds + 1);
  }

  ignite(dps: number, seconds: number): void {
    if (!this.alive) return;
    this.burnDps = Math.max(this.burnDps, dps);
    this.burnTime = Math.max(this.burnTime, seconds);
  }

  update(ctx: Ctx): void {
    const dt = ctx.dt;
    this.time += dt;
    this.flash = Math.max(0, this.flash - dt);

    // Burning: damage over time (in small ticks, without the white hit flash).
    if (this.burnTime > 0) {
      this.burnTime -= dt;
      this.hp -= this.burnDps * dt;
      if (this.hp <= 0 && this.alive) {
        this.alive = false;
        this.onKilled?.(this);
        return;
      }
      if (this.burnTime <= 0) this.burnDps = 0;
    }
    this.frozen = Math.max(0, this.frozen - dt);
    this.chilled = Math.max(0, this.chilled - dt);
    if (this.chilled <= 0) this.chillStacks = 0;

    // Status tint: frozen pale blue, chilled blue, burning flickering orange; hits flash white.
    let r = 0;
    let g = 0;
    let b = 0;
    if (this.frozen > 0) [r, g, b] = [0.35, 0.7, 0.95];
    else if (this.chilled > 0) [r, g, b] = [0.08, 0.28, 0.55];
    if (this.burnTime > 0) {
      const k = 0.55 + Math.sin(this.time * 22) * 0.25;
      r = Math.max(r, 0.95 * k);
      g = Math.max(g, 0.35 * k);
      b = Math.max(b, 0.05 * k);
    }
    for (const m of this.allMats) m.emissive.setRGB(r, g, b);
    if (this.flash > 0) for (const m of this.mats) m.emissive.setRGB(1, 1, 1);

    // Ice shell while frozen.
    if (this.frozen > 0 && !this.ice) {
      this.ice = new THREE.Mesh(
        new THREE.IcosahedronGeometry(this.radius * 1.25, 1),
        glow('#c8f6ff', { transparent: true, opacity: 0.4, depthWrite: false }, 1.2),
      );
      this.ice.position.y = this.aimHeight + (this.kind === 'turret' ? 0.8 : 0);
      this.root.add(this.ice);
    }
    if (this.ice) this.ice.visible = this.frozen > 0;

    // Frozen enemies don't act; chilled ones act at a slower pace.
    if (this.frozen > 0) return;
    this.think(this.chilled > 0 ? { ...ctx, dt: dt * 0.55 } : ctx);
  }

  protected abstract think(ctx: Ctx): void;

  /** @param flashes whether this part flashes white when hit (towers only flash their gun). */
  protected mat(color: string, flashes = true): THREE.MeshToonMaterial {
    const m = rimToon(color, ENEMY_GLOW, 0.75);
    this.allMats.push(m);
    if (flashes) this.mats.push(m);
    return m;
  }

  protected distanceTo(ship: Ship): { dx: number; dz: number; dist: number } {
    const dx = ship.root.position.x - this.root.position.x;
    const dz = ship.root.position.z - this.root.position.z;
    return { dx, dz, dist: Math.hypot(dx, dz) };
  }
}

