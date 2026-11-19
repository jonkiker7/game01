import * as THREE from 'three';
import type { Effects } from './Effects';
import { addOutlines, GLOW, glow, rimToon } from './materials';
import { approachAngle, mulberry32, wrapAngle } from './math';
import type { Mortars } from './Mortars';
import type { EnemyShots, Hittable } from './Projectiles';
import { HOVER_HEIGHT, type Ship } from './Ship';
import type { World } from './World';

const ENEMY_BODY = '#3b1d4a';
const ENEMY_ARMOR = '#6a2f63';
const ENEMY_GLOW = '#ff2e63';
const TOWER_STONE = '#4a2f5e';
/** Enemies only attack inside this distance, which roughly matches what's visible on screen. */
const ATTACK_RANGE = 36;
/** Towers lob mortars from much farther away (the landing ring warns you where they'll hit). */
const TOWER_RANGE = 75;

interface Ctx {
  ship: Ship;
  shots: EnemyShots;
  mortars: Mortars;
  world: World;
  dt: number;
  /** True if this enemy's gun is on screen. Enemies only shoot when you can see them. */
  onScreen: (e: Enemy) => boolean;
}

export abstract class Enemy implements Hittable {
  readonly root = new THREE.Group();
  abstract readonly radius: number;
  abstract readonly hitBottom: number;
  abstract readonly hitTop: number;
  abstract readonly aimHeight: number;
  abstract readonly kind: 'turret' | 'drone';
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

  damage(amount: number): void {
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

/**
 * Turret tower: a stone pillar with the gun on top, about halfway up to the ship.
 * Tracks you and fires a fan of three orbs.
 */
const TOWER_HEIGHT = (HOVER_HEIGHT - 6.5) / 2; // platform top (13 units); the gun head sits just above it

class Turret extends Enemy {
  readonly radius = 2.6;
  readonly kind = 'turret';
  // Bullets hit the gun and platform on top (what looks like the tower's head on screen).
  readonly hitBottom = TOWER_HEIGHT - 1.5;
  readonly hitTop = TOWER_HEIGHT + 5;
  readonly aimHeight = TOWER_HEIGHT + 2.6;
  private readonly head = new THREE.Group();
  private readonly eye: THREE.MeshBasicMaterial;
  private cooldown = 1 + Math.random() * 2;
  private readonly muzzle = new THREE.Object3D();
  private readonly tmp = new THREE.Vector3();

  constructor(hpMul = 1) {
    super(70 * hpMul);
    const H = TOWER_HEIGHT;
    const stone = this.mat(TOWER_STONE, false);
    const armor = this.mat(ENEMY_ARMOR, false);

    // Flared foot, tapering pillar, and buttress fins up the sides.
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(3.0, 3.8, 2.2, 6), stone);
    foot.position.y = 1.1;
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.4, H - 2.2, 6), stone);
    pillar.position.y = 2.2 + (H - 2.2) / 2;
    const parts: THREE.Object3D[] = [foot, pillar];
    for (let i = 0; i < 3; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.5, H * 0.55, 1.6), armor);
      const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
      fin.position.set(Math.cos(a) * 2.1, H * 0.3, Math.sin(a) * 2.1);
      fin.rotation.y = -a;
      parts.push(fin);
    }
    // Glowing red rune bands that pulse with the eye.
    for (const k of [0.3, 0.62, 0.9]) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(2.45 - k * 0.95, 2.5 - k * 0.95, 0.35, 6), this.bandMat);
      band.position.y = H * k;
      parts.push(band);
    }
    // Platform the gun sits on.
    const platform = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 1.8, 1.3, 6), this.mat(ENEMY_ARMOR));
    platform.position.y = H + 0.1;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.3, 0.8, 6), this.mat(ENEMY_BODY));
    base.position.y = H + 1.1;
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.9, 0.6, 6), this.mat(ENEMY_ARMOR));
    collar.position.y = H + 1.75;
    parts.push(platform, base, collar);

    this.head.position.y = H + 2.2;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.35, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), this.mat(ENEMY_ARMOR));
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.32, 2.2, 8), this.mat(ENEMY_BODY));
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.5, -1.5);
    this.eye = glow(ENEMY_GLOW);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.38, 10, 8), this.eye);
    eye.position.set(0, 0.75, -0.95);
    this.muzzle.position.set(0, 0.5, -2.7);
    this.head.add(dome, barrel, eye, this.muzzle);
    this.root.add(...parts, this.head);
    addOutlines(this.root);
  }

  private readonly bandMat = glow(ENEMY_GLOW);

  protected think({ ship, mortars, dt }: Ctx): void {
    const { dx, dz, dist } = this.distanceTo(ship);
    const awake = ship.alive && dist < TOWER_RANGE;
    if (awake) {
      this.head.rotation.y = approachAngle(this.head.rotation.y, Math.atan2(-dx, -dz), 2.2 * dt);
    }
    // Eye glows brighter as the next volley gets close.
    const warn = awake ? Math.max(0, 1 - this.cooldown / 0.6) : 0;
    this.eye.color.set(ENEMY_GLOW).multiplyScalar(GLOW * (0.6 + warn * 0.9));
    this.bandMat.color.set(ENEMY_GLOW).multiplyScalar(GLOW * (0.35 + warn * 0.5));

    this.cooldown -= dt;
    if (this.cooldown <= 0) {
      this.cooldown = 3 + Math.random() * 1.2;
      if (!awake) return;
      this.muzzle.getWorldPosition(this.tmp);
      mortars.fire(this.tmp, ship);
    }
  }
}

/** Flying drone: closes in, circles you, and fires quick bursts. */
class Drone extends Enemy {
  readonly radius: number;
  readonly kind = 'drone';
  readonly hitBottom: number;
  readonly hitTop: number;
  readonly aimHeight = 0;
  private readonly body = new THREE.Group();
  private readonly ring: THREE.Mesh;
  private readonly velocity = new THREE.Vector2();
  private readonly orbitDir = Math.random() < 0.5 ? 1 : -1;
  private readonly orbitDist = 14 + Math.random() * 6;
  private cooldown = 1.5 + Math.random() * 2;
  private burst = 0;
  private burstTimer = 0;
  private readonly tmp = new THREE.Vector3();

  constructor(hpMul = 1, readonly size = 1) {
    super(30 * hpMul);
    this.radius = 1.9 * size;
    this.hitBottom = -2.5 * size;
    this.hitTop = 3 * size;
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
    if (size > 1) {
      // The alpha: a gold crown of spikes and a halo.
      const gold = glow('#ffc23a', {}, 1.6);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.9, 5), gold);
        spike.position.set(Math.cos(a) * 0.7, 1.2, Math.sin(a) * 0.7);
        this.body.add(spike);
      }
      const halo = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.1, 6, 32), gold);
      halo.rotation.x = Math.PI / 2;
      this.ring.add(halo);
      this.body.scale.setScalar(size);
      this.ring.scale.setScalar(size);
    }
    addOutlines(this.root);
  }

  protected think({ ship, shots, world, dt, onScreen }: Ctx): void {
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
    const maxSpeed = 24; // keeps up with the (fast) player
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
    if (this.cooldown <= 0 && ship.alive && dist < ATTACK_RANGE - 4 && onScreen(this)) {
      this.cooldown = (2.4 + Math.random()) / (this.size > 1 ? 1.6 : 1);
      this.burst = this.size > 1 ? 5 : 3;
      this.burstTimer = 0;
    }
    if (this.burst > 0) {
      this.burstTimer -= dt;
      if (this.burstTimer <= 0) {
        this.burstTimer = 0.14;
        this.burst--;
        this.tmp.set(p.x + nx * 1.2, p.y, p.z + nz * 1.2);
        shots.fire(this.tmp, nx, nz, 19, ship.root.position.y, dist);
      }
    }
  }
}

const CULL_DISTANCE = 130;

/** How drones arrive during an encounter. */
export interface DroneWaves {
  max: number; // most drones alive at once
  interval: number; // seconds between arrivals
}

/** A circular arena the fight is confined to. */
export interface ArenaBounds {
  x: number;
  z: number;
  r: number;
}

/**
 * Spawns, updates and tracks all enemies. The current encounter (see run/Run.ts) decides
 * what to spawn: turret towers placed in the arena, and drones that keep arriving from its edge.
 */
export class EnemyManager {
  readonly enemies: Enemy[] = [];
  onKill?: (kind: 'turret' | 'drone', pos: THREE.Vector3, enemy: Enemy) => void;

  /** Enemy health multiplier (later sectors are tougher). */
  hpMul = 1;
  private drones: DroneWaves | null = null;
  private arena: ArenaBounds = { x: 0, z: 0, r: 100 };
  private droneTimer = 2;
  private readonly rand = mulberry32(99);
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly frustum = new THREE.Frustum();
  private readonly viewProj = new THREE.Matrix4();
  private readonly probe = new THREE.Vector3();
  private readonly probe2 = new THREE.Vector3();
  private readonly camPos = new THREE.Vector3();
  private planeY = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: World,
    private readonly effects: Effects,
  ) {}

  get turretsLeft(): number {
    let n = 0;
    for (const e of this.enemies) if (e.alive && e.kind === 'turret') n++;
    return n;
  }

  get aliveCount(): number {
    let n = 0;
    for (const e of this.enemies) if (e.alive) n++;
    return n;
  }

  /** Set up a new encounter: where the arena is, how tough enemies are, and drone waves (or none). */
  configure(arena: ArenaBounds, hpMul: number, drones: DroneWaves | null): void {
    this.arena = arena;
    this.hpMul = hpMul;
    this.drones = drones;
    this.droneTimer = 2.5;
  }

  /** Stop drone arrivals (e.g. once an encounter is won). */
  stopDrones(): void {
    this.drones = null;
  }

  /** Remove every enemy instantly, with no effects (between arenas / new run). */
  reset(): void {
    for (const e of this.enemies) this.scene.remove(e.root);
    this.enemies.length = 0;
    this.drones = null;
  }

  /** Blow up every remaining enemy (no drops), e.g. when an encounter ends. */
  destroyAll(): void {
    for (const e of this.enemies) {
      if (!e.alive) continue;
      e.alive = false;
      const p = e.root.position;
      const ground = this.world.heightAt(p.x, p.z);
      this.effects.explosion(this.tmp.set(p.x, p.y + e.aimHeight, p.z), 3.5, ground);
    }
  }

  /** Place `count` turret towers in a loose ring around (cx, cz). */
  spawnTurrets(cx: number, cz: number, count: number, minR: number, maxR: number): void {
    const start = this.rand() * Math.PI * 2;
    for (let i = 0; i < count; i++) {
      const a = start + (i / count) * Math.PI * 2 + (this.rand() - 0.5) * 0.5;
      const r = count === 1 ? 0 : minR + this.rand() * (maxR - minR);
      this.register(new Turret(this.hpMul), cx + Math.cos(a) * r, cz + Math.sin(a) * r);
    }
  }

  update(dt: number, ship: Ship, shots: EnemyShots, mortars: Mortars, camera: THREE.Camera): void {
    this.camPos.setFromMatrixPosition(camera.matrixWorld);
    this.planeY = ship.root.position.y;
    this.viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProj);
    const onScreen = (e: Enemy) => {
      this.probe.copy(e.root.position);
      this.probe.y += e.aimHeight;
      return this.frustum.containsPoint(this.probe);
    };
    const ctx: Ctx = { ship, shots, mortars, world: this.world, dt, onScreen };
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

    // Drone waves arrive from the arena's edge.
    if (this.drones && ship.alive) {
      this.droneTimer -= dt;
      if (this.droneTimer <= 0) {
        this.droneTimer = this.drones.interval;
        const alive = this.enemies.filter((e) => e.kind === 'drone' && !e.elite).length;
        if (alive < this.drones.max) this.spawnDrone();
      }
    }
  }

  /**
   * Splash damage (missiles), judged on screen: the blast and every enemy are projected to the
   * ship's altitude along the camera's line of sight, so anything that looks inside the blast
   * is hit, whether it's a drone at your height or a tower gun below.
   */
  damageAt(point: THREE.Vector3, radius: number, amount: number, hit?: (e: Enemy, amount: number) => void): void {
    const b = this.projectToPlane(point, this.probe);
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const v = this.visualPosition(e, this.probe2);
      const r = radius + e.radius;
      const dx = v.x - b.x;
      const dz = v.z - b.z;
      if (dx * dx + dz * dz < r * r) {
        if (hit) hit(e, amount);
        else e.damage(amount);
      }
    }
  }

  /** Living enemies nearest to (x, z) by on-screen position, within `range`, excluding `skip`. */
  nearest(x: number, z: number, range: number, count: number, skip?: Set<Enemy>): Enemy[] {
    const found: { e: Enemy; d: number }[] = [];
    for (const e of this.enemies) {
      if (!e.alive || skip?.has(e)) continue;
      const v = this.visualPosition(e, this.probe2);
      const d = Math.hypot(v.x - x, v.z - z);
      if (d < range) found.push({ e, d });
    }
    return found.sort((a, b) => a.d - b.d).slice(0, count).map((f) => f.e);
  }

  /** Every living enemy whose on-screen position is within `radius` of (x, z) at ship altitude. */
  forEachNear(x: number, z: number, radius: number, fn: (e: Enemy) => void): void {
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const v = this.visualPosition(e, this.probe2);
      const r = radius + e.radius;
      if ((v.x - x) ** 2 + (v.z - z) ** 2 < r * r) fn(e);
    }
  }

  /** Slide a point along the camera's line of sight up to the ship's altitude. */
  projectToPlane(point: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    out.copy(point);
    const c = this.camPos;
    if (out.y >= this.planeY - 0.01 || c.y <= this.planeY) return out;
    const k = (this.planeY - c.y) / (out.y - c.y);
    return out.set(c.x + (out.x - c.x) * k, this.planeY, c.z + (out.z - c.z) * k);
  }

  /**
   * Where an enemy *appears* to be at the ship's altitude: follow the line from the camera
   * through the enemy's gun until it reaches the ship's height. A tower gun far below the ship
   * looks like it's at this spot on screen, so aiming here lines up with what the player sees.
   */
  visualPosition(e: Enemy, out: THREE.Vector3): THREE.Vector3 {
    out.copy(e.root.position);
    out.y += e.aimHeight;
    return this.projectToPlane(out, out);
  }

  /**
   * Aim assist: the closest living enemy inside a cone in front of the ship, judged by where
   * enemies appear on screen. Makes thumb-aiming forgiving on a small screen.
   */
  findInCone(x: number, z: number, heading: number, range: number, halfAngle: number): Enemy | null {
    let best: Enemy | null = null;
    let bestDist = range;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const v = this.visualPosition(e, this.probe2);
      const dx = v.x - x;
      const dz = v.z - z;
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
      const ground = this.world.heightAt(pos.x, pos.z);
      if (dead.kind === 'turret') {
        // Blow the gun off the top, then the base of the tower.
        this.effects.explosion(this.tmp2.set(pos.x, ground + 2, pos.z), 6, ground);
        pos.y += dead.aimHeight;
      }
      this.effects.explosion(pos, dead.kind === 'turret' ? 5 : 3.5, ground);
      this.onKill?.(dead.kind, pos, dead);
    };
    this.enemies.push(e);
    this.scene.add(e.root);
  }

  /** The contract's alpha drone: a big, tough drone arriving from the arena's edge. */
  spawnElite(): Enemy {
    const a = this.rand() * Math.PI * 2;
    const r = this.arena.r * 0.6;
    const e = new Drone(this.hpMul * 9, 1.8);
    e.elite = true;
    this.register(e, this.arena.x + Math.cos(a) * r, this.arena.z + Math.sin(a) * r);
    return e;
  }

  /** A drone arriving from a random point on the arena's edge. */
  private spawnDrone(): void {
    const a = this.rand() * Math.PI * 2;
    const r = this.arena.r - 4;
    this.register(new Drone(this.hpMul), this.arena.x + Math.cos(a) * r, this.arena.z + Math.sin(a) * r);
  }
}
