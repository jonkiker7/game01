import * as THREE from 'three';
import type { Effects } from './Effects';
import { addOutlines, GLOW, glow, rimToon } from './materials';
import { approachAngle, mulberry32, wrapAngle } from './math';
import type { EnemyShots, Hittable } from './Projectiles';
import { HOVER_HEIGHT, type Ship } from './Ship';
import type { World } from './World';

const ENEMY_BODY = '#3b1d4a';
const ENEMY_ARMOR = '#6a2f63';
const ENEMY_GLOW = '#ff2e63';
/** Enemies only attack inside this distance, which roughly matches what's visible on screen. */
const ATTACK_RANGE = 36;

interface Ctx {
  ship: Ship;
  shots: EnemyShots;
  world: World;
  dt: number;
}

abstract class Enemy implements Hittable {
  readonly root = new THREE.Group();
  abstract readonly radius: number;
  abstract readonly kind: 'turret' | 'drone';
  alive = true;
  protected hp: number;
  protected flash = 0;
  protected readonly mats: THREE.MeshToonMaterial[] = [];
  protected time = Math.random() * 10;

  constructor(readonly maxHp: number) {
    this.hp = maxHp;
  }

  /** Set by the manager so a kill can trigger effects/score. */
  onKilled?: (e: Enemy) => void;

  damage(amount: number): void {
    if (!this.alive) return;
    this.hp -= amount;
    this.flash = 0.08;
    if (this.hp <= 0) {
      this.alive = false;
      this.onKilled?.(this);
    }
  }

  update(ctx: Ctx): void {
    this.time += ctx.dt;
    this.flash = Math.max(0, this.flash - ctx.dt);
    const f = this.flash > 0 ? 1 : 0;
    for (const m of this.mats) m.emissive.setRGB(f, f, f);
    this.think(ctx);
  }

  protected abstract think(ctx: Ctx): void;

  protected mat(color: string): THREE.MeshToonMaterial {
    const m = rimToon(color, ENEMY_GLOW, 0.75);
    this.mats.push(m);
    return m;
  }

  protected distanceTo(ship: Ship): { dx: number; dz: number; dist: number } {
    const dx = ship.root.position.x - this.root.position.x;
    const dz = ship.root.position.z - this.root.position.z;
    return { dx, dz, dist: Math.hypot(dx, dz) };
  }
}

/** Ground turret: turns to track you and fires a fan of three orbs. */
class Turret extends Enemy {
  readonly radius = 2.4;
  readonly kind = 'turret';
  private readonly head = new THREE.Group();
  private readonly eye: THREE.MeshBasicMaterial;
  private cooldown = 1 + Math.random() * 2;
  private readonly muzzle = new THREE.Object3D();
  private readonly tmp = new THREE.Vector3();

  constructor() {
    super(70);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.6, 1.2, 6), this.mat(ENEMY_BODY));
    base.position.y = 0.6;
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.9, 0.6, 6), this.mat(ENEMY_ARMOR));
    collar.position.y = 1.45;

    this.head.position.y = 1.9;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.35, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), this.mat(ENEMY_ARMOR));
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.32, 2.2, 8), this.mat(ENEMY_BODY));
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.5, -1.5);
    this.eye = glow(ENEMY_GLOW);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.38, 10, 8), this.eye);
    eye.position.set(0, 0.75, -0.95);
    this.muzzle.position.set(0, 0.5, -2.7);
    this.head.add(dome, barrel, eye, this.muzzle);
    this.root.add(base, collar, this.head);
    addOutlines(this.root);
  }

  protected think({ ship, shots, dt }: Ctx): void {
    const { dx, dz, dist } = this.distanceTo(ship);
    const awake = ship.alive && dist < ATTACK_RANGE;
    if (awake) {
      this.head.rotation.y = approachAngle(this.head.rotation.y, Math.atan2(-dx, -dz), 2.2 * dt);
    }
    // Eye glows brighter as the next volley gets close.
    const warn = awake ? Math.max(0, 1 - this.cooldown / 0.6) : 0;
    this.eye.color.set(ENEMY_GLOW).multiplyScalar(GLOW * (0.6 + warn * 0.9));

    this.cooldown -= dt;
    if (this.cooldown <= 0) {
      this.cooldown = 2.6 + Math.random() * 0.8;
      if (!awake) return;
      this.muzzle.getWorldPosition(this.tmp);
      const yaw = this.head.rotation.y;
      for (const spread of [-0.22, 0, 0.22]) {
        const a = yaw + spread;
        shots.fire(this.tmp, -Math.sin(a), -Math.cos(a), 15, ship.root.position.y);
      }
    }
  }
}

/** Flying drone: closes in, circles you, and fires quick bursts. */
class Drone extends Enemy {
  readonly radius = 1.9;
  readonly kind = 'drone';
  private readonly body = new THREE.Group();
  private readonly ring: THREE.Mesh;
  private readonly velocity = new THREE.Vector2();
  private readonly orbitDir = Math.random() < 0.5 ? 1 : -1;
  private readonly orbitDist = 14 + Math.random() * 6;
  private cooldown = 1.5 + Math.random() * 2;
  private burst = 0;
  private burstTimer = 0;
  private readonly tmp = new THREE.Vector3();

  constructor() {
    super(30);
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 0), this.mat(ENEMY_ARMOR));
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), glow(ENEMY_GLOW));
    eye.position.z = -0.75;
    const spikeMat = this.mat(ENEMY_BODY);
    for (let i = 0; i < 4; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.3, 5), spikeMat);
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      spike.position.set(Math.cos(a) * 1.2, 0, Math.sin(a) * 1.2);
      spike.rotation.set(0, -a, -Math.PI / 2);
      this.body.add(spike);
    }
    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.7, 0.08, 6, 24),
      glow(ENEMY_GLOW, { transparent: true, opacity: 0.6 }),
    );
    this.ring.rotation.x = Math.PI / 2;
    this.body.add(core, eye);
    this.root.add(this.body, this.ring);
    addOutlines(this.root);
  }

  protected think({ ship, shots, world, dt }: Ctx): void {
    const p = this.root.position;
    const { dx, dz, dist } = this.distanceTo(ship);
    const nx = dist > 0.001 ? dx / dist : 0;
    const nz = dist > 0.001 ? dz / dist : 0;

    // Steering: pull toward the orbit distance, and slide sideways around the player.
    let tx = 0;
    let tz = 0;
    if (ship.alive) {
      const radial = (dist - this.orbitDist) * 0.6;
      tx = nx * radial + -nz * this.orbitDir * 8;
      tz = nz * radial + nx * this.orbitDir * 8;
    }
    const len = Math.hypot(tx, tz);
    const maxSpeed = 10;
    if (len > maxSpeed) {
      tx = (tx / len) * maxSpeed;
      tz = (tz / len) * maxSpeed;
    }
    const k = 1 - Math.exp(-2 * dt);
    this.velocity.x += (tx - this.velocity.x) * k;
    this.velocity.y += (tz - this.velocity.y) * k;
    p.x += this.velocity.x * dt;
    p.z += this.velocity.y * dt;
    p.y = world.heightAt(p.x, p.z) + HOVER_HEIGHT + Math.sin(this.time * 2.5) * 0.4;

    this.body.rotation.y = Math.atan2(-nx, -nz);
    this.ring.rotation.z += dt * 3;

    // Fire a 3-shot burst at the player every few seconds.
    this.cooldown -= dt;
    if (this.cooldown <= 0 && ship.alive && dist < ATTACK_RANGE - 4) {
      this.cooldown = 2.4 + Math.random();
      this.burst = 3;
      this.burstTimer = 0;
    }
    if (this.burst > 0) {
      this.burstTimer -= dt;
      if (this.burstTimer <= 0) {
        this.burstTimer = 0.14;
        this.burst--;
        this.tmp.set(p.x + nx * 1.2, p.y, p.z + nz * 1.2);
        shots.fire(this.tmp, nx, nz, 19, ship.root.position.y);
      }
    }
  }
}

/** Groups of turrets placed around the map. Coordinates are (x, z); the landing pad is at 0, 0. */
const OUTPOSTS: [number, number][] = [
  [0, -48],
  [45, -78],
  [-55, -62],
  [75, 12],
  [-78, 20],
  [12, 85],
  [-40, 120],
  [95, -125],
  [-120, -110],
  [130, 95],
  [-150, 40],
  [150, -40],
];

const MAX_DRONES = 4;
const DRONE_SPAWN_TIME = 7;
const CULL_DISTANCE = 130;

/**
 * Spawns, updates and tracks all enemies.
 * Turrets sit in outposts; when every turret is destroyed the area is cleared and they return.
 * Drones keep arriving from off-screen, a few at a time.
 */
export class EnemyManager {
  readonly enemies: Enemy[] = [];
  onKill?: (kind: 'turret' | 'drone', pos: THREE.Vector3) => void;
  onAreaCleared?: () => void;

  private droneTimer = 4;
  private respawnTimer = -1;
  private readonly rand = mulberry32(99);
  private readonly tmp = new THREE.Vector3();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: World,
    private readonly effects: Effects,
  ) {
    this.spawnOutposts();
  }

  get turretsLeft(): number {
    let n = 0;
    for (const e of this.enemies) if (e.alive && e.kind === 'turret') n++;
    return n;
  }

  update(dt: number, ship: Ship, shots: EnemyShots): void {
    const ctx: Ctx = { ship, shots, world: this.world, dt };
    const sp = ship.root.position;
    for (const e of this.enemies) {
      const far = Math.hypot(e.root.position.x - sp.x, e.root.position.z - sp.z) > CULL_DISTANCE;
      e.root.visible = !far;
      if (e.alive && (!far || e.kind === 'drone')) e.update(ctx);
    }
    // Remove destroyed enemies.
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (!e.alive) {
        this.scene.remove(e.root);
        this.enemies.splice(i, 1);
      }
    }

    // Keep drones coming.
    this.droneTimer -= dt;
    const drones = this.enemies.filter((e) => e.kind === 'drone').length;
    if (this.droneTimer <= 0 && ship.alive) {
      this.droneTimer = DRONE_SPAWN_TIME;
      if (drones < MAX_DRONES) this.spawnDrone(ship);
    }

    // When the area is cleared, bring the outposts back after a pause.
    if (this.respawnTimer > 0) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) this.spawnOutposts();
    }
  }

  /** Splash damage (missiles). */
  damageCircle(x: number, z: number, radius: number, amount: number): void {
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const r = radius + e.radius;
      const dx = e.root.position.x - x;
      const dz = e.root.position.z - z;
      if (dx * dx + dz * dz < r * r) e.damage(amount);
    }
  }

  /**
   * Aim assist: the closest living enemy inside a cone in front of the ship.
   * Makes thumb-aiming forgiving on a small screen.
   */
  findInCone(x: number, z: number, heading: number, range: number, halfAngle: number): Enemy | null {
    let best: Enemy | null = null;
    let bestDist = range;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const dx = e.root.position.x - x;
      const dz = e.root.position.z - z;
      const dist = Math.hypot(dx, dz);
      if (dist > bestDist) continue;
      const off = Math.abs(wrapAngle(Math.atan2(-dx, -dz) - heading));
      if (off < halfAngle + Math.atan2(e.radius, dist)) {
        best = e;
        bestDist = dist;
      }
    }
    return best;
  }

  private register(e: Enemy, x: number, z: number): void {
    e.root.position.set(x, this.world.heightAt(x, z), z);
    e.onKilled = (dead) => {
      const pos = this.tmp.copy(dead.root.position);
      pos.y += dead.kind === 'turret' ? 1.5 : 0;
      this.effects.explosion(pos, dead.kind === 'turret' ? 5 : 3.5, this.world.heightAt(pos.x, pos.z));
      this.onKill?.(dead.kind, pos);
      if (dead.kind === 'turret' && this.turretsLeft === 0) {
        this.onAreaCleared?.();
        this.respawnTimer = 8;
      }
    };
    this.enemies.push(e);
    this.scene.add(e.root);
  }

  private spawnOutposts(): void {
    for (const [ox, oz] of OUTPOSTS) {
      const count = 2 + Math.floor(this.rand() * 2);
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + this.rand();
        const r = count === 1 ? 0 : 5 + this.rand() * 3;
        this.register(new Turret(), ox + Math.cos(a) * r, oz + Math.sin(a) * r);
      }
    }
  }

  private spawnDrone(ship: Ship): void {
    const limit = this.world.halfSize - 10;
    const a = this.rand() * Math.PI * 2;
    const x = Math.max(-limit, Math.min(limit, ship.root.position.x + Math.cos(a) * 55));
    const z = Math.max(-limit, Math.min(limit, ship.root.position.z + Math.sin(a) * 55));
    this.register(new Drone(), x, z);
  }
}
