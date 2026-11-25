import * as THREE from 'three';
import { type Ctx, Enemy, ENEMY_ARMOR, ENEMY_BODY, ENEMY_GLOW } from './EnemyBase';
import { TUNING } from './Tuning';
import { addOutlines, GLOW, glow } from './materials';
import { approachAngle } from './math';
import { HOVER_HEIGHT } from './Ship';
import type { World } from './World';

/*
 * The newer enemy types (the drone and the tower live in Enemies.ts). Each one has a clear
 * tell before it attacks, and asks for a different way of dodging:
 *   Swarmer  packs of small bugs that line up and dive at you, exploding on contact
 *   Lancer   paints a red lane, pauses, then dashes down it
 *   Crawler  ground tank with a front energy shield (flank it, or use missiles)
 *   Sniper   hangs back, tracks you with a laser, freezes it, then fires a fast shot
 *   Mine Layer  loops around you dropping proximity mines (which you can shoot)
 *   Pulsar   ground pylon spraying rotating spirals of slow shots
 */

const flyY = (world: World, x: number, z: number) => world.heightAt(x, z) + HOVER_HEIGHT;

/** Ease a velocity toward a target velocity. */
function steer(v: THREE.Vector2, tx: number, tz: number, max: number, accel: number, dt: number): void {
  const len = Math.hypot(tx, tz);
  if (len > max) {
    tx = (tx / len) * max;
    tz = (tz / len) * max;
  }
  const k = 1 - Math.exp(-accel * dt);
  v.x += (tx - v.x) * k;
  v.y += (tz - v.y) * k;
}

/** Heading (rotation.y) that faces from one point to another. */
const facing = (dx: number, dz: number) => Math.atan2(-dx, -dz);

// ---------------------------------------------------------------- Swarmer

/** Swarmer tuning lives in Tuning.ts (and the ?dev panel). */
const SWARM = TUNING.swarmers;

export class Swarmer extends Enemy {
  readonly radius = 1.2;
  readonly kind = 'drone';
  readonly species = 'swarmer';
  readonly hitBottom = -1.6;
  readonly hitTop = 1.8;
  readonly aimHeight = 0;
  private state: 'chase' | 'aim' | 'dive' = 'chase';
  private timer = 1.5 + Math.random() * 3; // staggered, so the pack doesn't all dive at once
  private readonly vel = new THREE.Vector2();
  private readonly dir = new THREE.Vector2();
  private readonly offset = Math.random() * Math.PI * 2;
  private readonly wings: THREE.Mesh[] = [];
  private readonly glowMat = glow('#ffb03a');

  constructor(hpMul = 1) {
    super(9 * hpMul);
    this.salvage = 1;
    this.weight = 0.25;
    this.dropChance = 0.06;
    const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7, 0), this.mat(ENEMY_ARMOR));
    const tail = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6), this.glowMat);
    tail.position.z = 0.75;
    tail.scale.set(1, 0.8, 1.4);
    for (const s of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.7), glow('#ffd9a8', { transparent: true, opacity: 0.6, side: THREE.DoubleSide }, 1));
      wing.position.set(s * 0.85, 0.3, 0);
      wing.rotation.x = -Math.PI / 2;
      this.wings.push(wing);
      this.root.add(wing);
    }
    this.root.add(body, tail);
    addOutlines(this.root);
  }

  protected think({ ship, world, dt, effects }: Ctx): void {
    const p = this.root.position;
    const { dx, dz, dist } = this.distanceTo(ship);
    for (const [i, w] of this.wings.entries()) w.rotation.z = Math.sin(this.time * 40 + i * Math.PI) * 0.6;
    if (this.state === 'chase') {
      // Buzz around the ship in a loose cloud.
      const a = this.offset + this.time * 1.4;
      const tx = ship.root.position.x + Math.cos(a) * 14 - p.x;
      const tz = ship.root.position.z + Math.sin(a) * 14 - p.z;
      steer(this.vel, tx * 2, tz * 2, SWARM.chaseSpeed, 3, dt);
      this.timer -= dt;
      if (this.timer <= 0 && ship.alive && dist < SWARM.diveRange) {
        this.state = 'aim';
        this.timer = SWARM.windup;
      }
    } else if (this.state === 'aim') {
      // Tell: stop, glow hot, and point at the ship.
      steer(this.vel, 0, 0, SWARM.chaseSpeed, 8, dt);
      this.root.rotation.y = facing(dx, dz);
      this.timer -= dt;
      if (this.timer <= 0) {
        this.dir.set(dx / Math.max(dist, 0.01), dz / Math.max(dist, 0.01));
        this.vel.copy(this.dir).multiplyScalar(SWARM.diveSpeed);
        this.state = 'dive';
        this.timer = SWARM.diveTime;
      }
    } else {
      this.timer -= dt;
      if (ship.alive && ship.invulnerable <= 0 && dist < SWARM.hitRadius) {
        ship.damage(SWARM.damage);
        this.alive = false; // explodes on contact (no salvage)
        effects.explosion(p, 2.6, world.heightAt(p.x, p.z));
        return;
      }
      if (this.timer <= 0) {
        this.state = 'chase';
        this.timer = SWARM.restMin + Math.random() * SWARM.restExtra;
      }
    }
    p.x += this.vel.x * dt;
    p.z += this.vel.y * dt;
    p.y = flyY(world, p.x, p.z) + Math.sin(this.time * 6 + this.offset) * 0.5;
    if (this.state !== 'aim') this.root.rotation.y = approachAngle(this.root.rotation.y, facing(this.vel.x, this.vel.y), 8 * dt);
    const hot = this.state === 'aim' ? 2.4 : this.state === 'dive' ? 2 : 1;
    this.glowMat.color.set('#ffb03a').multiplyScalar(GLOW * hot);
  }
}

// ---------------------------------------------------------------- Lancer

export class Lancer extends Enemy {
  readonly radius = 2;
  readonly kind = 'drone';
  readonly species = 'lancer';
  readonly hitBottom = -2.2;
  readonly hitTop = 2.4;
  readonly aimHeight = 0;
  private state: 'hover' | 'aim' | 'dash' = 'hover';
  private timer = 2 + Math.random() * 2;
  private readonly vel = new THREE.Vector2();
  private readonly dir = new THREE.Vector2();
  private dashLeft = 0;
  private hitDone = false;
  private readonly orbitDir = Math.random() < 0.5 ? 1 : -1;
  private readonly lane: THREE.Mesh;
  private readonly laneMat = glow('#ff3d3d', { transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending }, 1.4);
  private readonly body = new THREE.Group();

  constructor(hpMul = 1) {
    super(45 * hpMul);
    this.salvage = 4;
    // A spear: long nose cone, swept fins, glowing tail.
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.8, 4.4, 6), this.mat(ENEMY_ARMOR));
    nose.rotation.x = -Math.PI / 2;
    nose.position.z = -1.2;
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.6, 1.8, 6), this.mat(ENEMY_BODY));
    hull.rotation.x = Math.PI / 2;
    hull.position.z = 1.4;
    for (const s of [-1, 1]) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.2, 1.2), this.mat(ENEMY_BODY));
      fin.position.set(s * 1.3, 0, 1.4);
      fin.rotation.y = s * -0.5;
      this.body.add(fin);
    }
    const tail = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6), glow(ENEMY_GLOW, {}, 2));
    tail.position.z = 2.4;
    this.body.add(nose, hull, tail);
    this.root.add(this.body);
    // The red lane it's about to dash down (local -Z, scaled to length).
    this.lane = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.1, 1), this.laneMat);
    this.lane.visible = false;
    this.lane.userData.noOutline = true;
    this.root.add(this.lane);
    addOutlines(this.body);
  }

  protected think({ ship, world, dt, onScreen }: Ctx): void {
    const p = this.root.position;
    const { dx, dz, dist } = this.distanceTo(ship);
    const nx = dist > 0.01 ? dx / dist : 0;
    const nz = dist > 0.01 ? dz / dist : 0;
    if (this.state === 'hover') {
      const radial = (dist - 30) * 0.8;
      steer(this.vel, nx * radial - nz * this.orbitDir * 10, nz * radial + nx * this.orbitDir * 10, 22, 2, dt);
      this.root.rotation.y = approachAngle(this.root.rotation.y, facing(dx, dz), 4 * dt);
      this.timer -= dt;
      if (this.timer <= 0 && ship.alive && dist < 60 && onScreen(this)) {
        // Lock the lane through where the ship is now, and a bit beyond.
        this.state = 'aim';
        this.timer = 0.95;
        this.dir.set(nx, nz);
        this.dashLeft = dist + 26;
        this.root.rotation.y = facing(nx, nz);
        this.lane.scale.z = this.dashLeft;
        this.lane.position.set(0, -1.2, -this.dashLeft / 2);
        this.lane.visible = true;
      }
    } else if (this.state === 'aim') {
      steer(this.vel, 0, 0, 22, 10, dt);
      this.timer -= dt;
      this.laneMat.opacity = 0.2 + 0.35 * (0.5 + 0.5 * Math.sin(this.time * (20 + (1 - this.timer) * 30)));
      this.body.position.x = (Math.random() - 0.5) * 0.25; // shudders before launching
      if (this.timer <= 0) {
        this.state = 'dash';
        this.lane.visible = false;
        this.body.position.x = 0;
        this.hitDone = false;
        this.vel.copy(this.dir).multiplyScalar(125);
      }
    } else {
      const step = 125 * dt;
      this.dashLeft -= step;
      if (!this.hitDone && ship.alive && ship.invulnerable <= 0 && dist < 3.4) {
        ship.damage(18);
        this.hitDone = true;
      }
      if (this.dashLeft <= 0) {
        this.state = 'hover';
        this.timer = 3.2 + Math.random() * 1.6;
        this.vel.multiplyScalar(0.15);
      }
    }
    p.x += this.vel.x * dt;
    p.z += this.vel.y * dt;
    p.y = flyY(world, p.x, p.z) + (this.state === 'dash' ? 0 : Math.sin(this.time * 2.2) * 0.4);
  }
}

// ---------------------------------------------------------------- Shield Crawler

const CRAWLER_SHIELD_ARC = (65 * Math.PI) / 180; // shots from within this angle of its nose are blocked

export class Crawler extends Enemy {
  readonly radius = 3.4;
  readonly kind = 'ground';
  readonly species = 'crawler';
  readonly hitBottom = 0;
  readonly hitTop = 5.5;
  readonly aimHeight = 2.8;
  private cooldown = 2 + Math.random() * 1.5;
  private readonly shipPos = new THREE.Vector3();
  private readonly shield: THREE.Mesh;
  private readonly shieldMat = glow('#6ff7ff', { transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }, 1.2);
  private shieldFlash = 0;
  private readonly legs: THREE.Object3D[] = [];
  private readonly muzzle = new THREE.Object3D();
  private readonly tmp = new THREE.Vector3();

  constructor(hpMul = 1) {
    super(110 * hpMul);
    this.salvage = 6;
    this.weight = 1.5;
    this.dropChance = 0.35;
    const hull = new THREE.Mesh(new THREE.BoxGeometry(4.6, 2, 5.6), this.mat(ENEMY_ARMOR));
    hull.position.y = 2;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.9, 3.6), this.mat(ENEMY_BODY));
    deck.position.y = 3.4;
    const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 2.6, 8), this.mat(ENEMY_BODY));
    gun.rotation.x = Math.PI / 2.4;
    gun.position.set(0, 4, -1.6);
    this.muzzle.position.set(0, 4.6, -2.8);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), glow(ENEMY_GLOW, {}, 1.8));
    eye.position.set(0, 2.4, -2.85);
    this.root.add(hull, deck, gun, eye, this.muzzle);
    for (let i = 0; i < 6; i++) {
      const side = i < 3 ? -1 : 1;
      const leg = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.4, 0.5), this.mat(ENEMY_BODY));
      leg.position.set(side * 3, 1, -1.8 + (i % 3) * 1.8);
      leg.rotation.z = side * -0.5;
      this.legs.push(leg);
      this.root.add(leg);
    }
    // The front energy shield: a curved wall of light in front of its nose.
    this.shield = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.6, 6, 24, 1, true, Math.PI - 1.15, 2.3), this.shieldMat);
    this.shield.position.y = 3;
    this.shield.userData.noOutline = true;
    this.root.add(this.shield);
    addOutlines(this.root);
  }

  /** Blocks gunfire from the front; missiles and explosions get through. */
  damage(amount: number, blast = false): void {
    if (!blast && this.alive) {
      const dx = this.shipPos.x - this.root.position.x;
      const dz = this.shipPos.z - this.root.position.z;
      const fx = -Math.sin(this.root.rotation.y);
      const fz = -Math.cos(this.root.rotation.y);
      const cos = (dx * fx + dz * fz) / Math.max(0.01, Math.hypot(dx, dz));
      if (cos > Math.cos(CRAWLER_SHIELD_ARC)) {
        this.shieldFlash = 0.12;
        return;
      }
    }
    super.damage(amount, blast);
  }

  protected think({ ship, shots, world, dt }: Ctx): void {
    const p = this.root.position;
    this.shipPos.copy(ship.root.position);
    const { dx, dz, dist } = this.distanceTo(ship);
    // Turn slowly to keep the shield toward you, and crawl to medium range.
    this.root.rotation.y = approachAngle(this.root.rotation.y, facing(dx, dz), 0.9 * dt);
    const want = dist > 26 ? 1 : dist < 16 ? -0.6 : 0;
    const nx = p.x + (dx / Math.max(dist, 0.01)) * 7 * want * dt;
    const nz = p.z + (dz / Math.max(dist, 0.01)) * 7 * want * dt;
    if (want !== 0 && dist > 0.01 && world.isRock(nx, nz, this.radius)) {
      p.x = nx;
      p.z = nz;
      for (const [i, leg] of this.legs.entries()) leg.rotation.x = Math.sin(this.time * 8 + i * 1.3) * 0.35;
    }
    p.y = world.heightAt(p.x, p.z);
    this.shieldFlash = Math.max(0, this.shieldFlash - dt);
    this.shieldMat.opacity = 0.3 + (this.shieldFlash > 0 ? 0.5 : 0.08 * Math.sin(this.time * 5));

    // Heavy shells: a slow three-shot spread.
    this.cooldown -= dt;
    if (this.cooldown <= 0) {
      this.cooldown = 2.8 + Math.random();
      if (!ship.alive || dist > 60) return;
      this.muzzle.getWorldPosition(this.tmp);
      const base = Math.atan2(dz, dx);
      for (const off of [-0.22, 0, 0.22]) {
        shots.fire(this.tmp, Math.cos(base + off), Math.sin(base + off), 17, ship.root.position.y, Math.min(dist, 20), 10, 5);
      }
    }
  }
}

// ---------------------------------------------------------------- Sniper

export class Sniper extends Enemy {
  readonly radius = 1.7;
  readonly kind = 'drone';
  readonly species = 'sniper';
  readonly hitBottom = -2;
  readonly hitTop = 2.2;
  readonly aimHeight = 0;
  private state: 'idle' | 'track' | 'lock' = 'idle';
  private timer = 2 + Math.random() * 2;
  private readonly vel = new THREE.Vector2();
  private readonly orbitDir = Math.random() < 0.5 ? 1 : -1;
  private aim = 0;
  private readonly beam: THREE.Mesh;
  private readonly beamMat = glow('#ff3d3d', { transparent: true, opacity: 0.5, depthWrite: false }, 1.6);
  private readonly lens = glow('#ff3d3d', {}, 1.5);
  private readonly tmp = new THREE.Vector3();

  constructor(hpMul = 1) {
    super(32 * hpMul);
    this.salvage = 4;
    const body = new THREE.Mesh(new THREE.OctahedronGeometry(1.2, 0), this.mat(ENEMY_ARMOR));
    body.scale.set(0.8, 0.8, 1.4);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 3.6, 6), this.mat(ENEMY_BODY));
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = -2;
    const scope = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), this.lens);
    scope.position.set(0, 0.7, -0.4);
    this.root.add(body, barrel, scope);
    addOutlines(this.root);
    // Targeting laser (thin, along local -Z).
    this.beam = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 1), this.beamMat);
    this.beam.visible = false;
    this.beam.userData.noOutline = true;
    this.root.add(this.beam);
  }

  protected think({ ship, shots, world, dt, onScreen }: Ctx): void {
    const p = this.root.position;
    const { dx, dz, dist } = this.distanceTo(ship);
    const nx = dist > 0.01 ? dx / dist : 0;
    const nz = dist > 0.01 ? dz / dist : 0;
    // Hang back at long range, drifting sideways.
    const radial = (dist - 40) * 0.7; // far, but still on screen
    const move = this.state === 'idle' ? 1 : 0.25;
    steer(this.vel, (nx * radial - nz * this.orbitDir * 8) * move, (nz * radial + nx * this.orbitDir * 8) * move, 20, 2, dt);
    p.x += this.vel.x * dt;
    p.z += this.vel.y * dt;
    p.y = flyY(world, p.x, p.z) + Math.sin(this.time * 1.8) * 0.3;

    if (this.state === 'idle') {
      this.root.rotation.y = approachAngle(this.root.rotation.y, facing(dx, dz), 3 * dt);
      this.timer -= dt;
      if (this.timer <= 0 && ship.alive && dist < 80 && onScreen(this)) {
        this.state = 'track';
        this.timer = 1.1;
        this.beam.visible = true;
      }
    } else if (this.state === 'track') {
      // The laser follows you...
      this.aim = facing(dx, dz);
      this.root.rotation.y = this.aim;
      this.timer -= dt;
      this.beamMat.opacity = 0.35;
      if (this.timer <= 0) {
        this.state = 'lock';
        this.timer = 0.45;
      }
    } else {
      // ...then freezes and flickers: move now!
      this.root.rotation.y = this.aim;
      this.timer -= dt;
      this.beamMat.opacity = Math.sin(this.time * 60) > 0 ? 0.9 : 0.4;
      if (this.timer <= 0) {
        this.state = 'idle';
        this.timer = 3.2 + Math.random() * 1.5;
        this.beam.visible = false;
        this.tmp.set(p.x - Math.sin(this.aim) * 3.5, p.y, p.z - Math.cos(this.aim) * 3.5);
        shots.fire(this.tmp, -Math.sin(this.aim), -Math.cos(this.aim), 90, p.y, 1, 16, 1.5);
      }
    }
    const len = Math.max(4, dist + 30);
    this.beam.scale.z = len;
    this.beam.position.set(0, 0, -len / 2);
    this.lens.color.set('#ff3d3d').multiplyScalar(GLOW * (this.state === 'idle' ? 0.7 : 1.6));
  }
}

// ---------------------------------------------------------------- Mine Layer and mines

export class Mine extends Enemy {
  readonly radius = 1.4;
  readonly kind = 'drone';
  readonly species = 'mine';
  readonly hitBottom = -1.6;
  readonly hitTop = 1.6;
  readonly aimHeight = 0;
  private age = 0;
  private readonly light = glow(ENEMY_GLOW, {}, 1);
  private readonly offset = Math.random() * 10;
  private readonly halo: THREE.Mesh;

  constructor() {
    super(6);
    this.salvage = 0;
    this.weight = 0;
    this.dropChance = 0;
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 0), this.mat(ENEMY_ARMOR));
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.75, 10, 8), this.light);
    // A faint red danger halo showing roughly where it goes off.
    this.halo = new THREE.Mesh(
      new THREE.RingGeometry(3.9, 4.6, 32),
      glow(ENEMY_GLOW, { transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }, 1.2),
    );
    this.halo.rotation.x = -Math.PI / 2;
    this.halo.userData.noOutline = true;
    this.root.add(core, dot, this.halo);
    for (let i = 0; i < 6; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.8, 5), this.mat(ENEMY_ARMOR));
      const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]][i];
      spike.position.set(dirs[0] * 1.15, dirs[1] * 1.15, dirs[2] * 1.15);
      spike.lookAt(dirs[0] * 2, dirs[1] * 2, dirs[2] * 2);
      spike.rotateX(Math.PI / 2);
      this.root.add(spike);
    }
    addOutlines(this.root);
  }

  protected think({ ship, world, dt, effects }: Ctx): void {
    const p = this.root.position;
    this.age += dt;
    const armed = this.age > 0.9;
    // Blinks slowly while arming, fast once armed.
    const blink = Math.sin(this.time * (armed ? 14 : 4)) > 0;
    this.light.color.set(armed ? ENEMY_GLOW : '#ffb03a').multiplyScalar(GLOW * (blink ? 2 : 0.6));
    this.halo.visible = armed;
    this.root.rotation.y += dt * 1.2;
    p.y = flyY(world, p.x, p.z) + Math.sin(this.time * 2 + this.offset) * 0.3;
    if (armed && ship.alive && ship.invulnerable <= 0 && this.distanceTo(ship).dist < 4.8) {
      ship.damage(12);
      this.alive = false;
      effects.explosion(p, 4, world.heightAt(p.x, p.z));
      return;
    }
    if (this.age > 16) {
      this.alive = false; // fizzles out
      effects.spark(p, '#ff6b8f', 1.2);
    }
  }
}

export class MineLayer extends Enemy {
  readonly radius = 2.3;
  readonly kind = 'drone';
  readonly species = 'minelayer';
  readonly hitBottom = -2;
  readonly hitTop = 2;
  readonly aimHeight = 0;
  private angle = Math.random() * Math.PI * 2;
  private readonly dirSign = Math.random() < 0.5 ? 1 : -1;
  private dropTimer = 1.5;
  private readonly mines: Mine[] = [];
  private readonly ring: THREE.Mesh;

  constructor(hpMul = 1) {
    super(45 * hpMul);
    this.salvage = 4;
    const saucer = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 1.4, 0.9, 12), this.mat(ENEMY_ARMOR));
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), this.mat(ENEMY_BODY));
    dome.position.y = 0.4;
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.15, 6, 20), glow('#ffb03a', {}, 1.6));
    this.ring.rotation.x = Math.PI / 2;
    this.ring.position.y = -0.5;
    this.root.add(saucer, dome, this.ring);
    addOutlines(this.root);
  }

  protected think({ ship, world, dt, spawn }: Ctx): void {
    const p = this.root.position;
    const s = ship.root.position;
    // Fly a wide loop around the ship, seeding mines across your path.
    this.angle += this.dirSign * dt * 0.75;
    const tx = s.x + Math.cos(this.angle) * 34;
    const tz = s.z + Math.sin(this.angle) * 34;
    const k = 1 - Math.exp(-1.6 * dt);
    p.x += (tx - p.x) * k;
    p.z += (tz - p.z) * k;
    p.y = flyY(world, p.x, p.z) + Math.sin(this.time * 2) * 0.4;
    this.root.rotation.y += dt * 2;
    this.ring.scale.setScalar(1 + Math.max(0, 0.3 - this.dropTimer) * 2);

    for (let i = this.mines.length - 1; i >= 0; i--) if (!this.mines[i].alive) this.mines.splice(i, 1);
    this.dropTimer -= dt;
    if (this.dropTimer <= 0) {
      this.dropTimer = 1.1;
      if (ship.alive && this.distanceTo(ship).dist < 70 && this.mines.length < 9) {
        const mine = new Mine();
        this.mines.push(mine);
        spawn(mine, p.x, p.z);
      }
    }
  }
}

// ---------------------------------------------------------------- Pulsar

const PULSAR_HEIGHT = 9;

export class Pulsar extends Enemy {
  readonly radius = 2.4;
  readonly kind = 'ground';
  readonly species = 'pulsar';
  readonly hitBottom = PULSAR_HEIGHT - 4;
  readonly hitTop = PULSAR_HEIGHT + 3;
  readonly aimHeight = PULSAR_HEIGHT;
  private phase: 'rest' | 'fire' = 'rest';
  private timer = 1.5 + Math.random();
  private volley = 0;
  private spin = Math.random() * Math.PI * 2;
  private readonly orb = glow('#ff5fd2', {}, 1.4);
  private readonly rings: THREE.Mesh[] = [];
  private readonly tmp = new THREE.Vector3();

  constructor(hpMul = 1) {
    super(85 * hpMul);
    this.salvage = 6;
    this.weight = 1.5;
    this.dropChance = 0.35;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 3.2, 1.6, 8), this.mat(ENEMY_ARMOR, false));
    base.position.y = 0.8;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.2, PULSAR_HEIGHT - 1.6, 8), this.mat(ENEMY_BODY, false));
    mast.position.y = 1.6 + (PULSAR_HEIGHT - 1.6) / 2;
    const orb = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 12), this.orb);
    orb.position.y = PULSAR_HEIGHT + 0.6;
    const cradle = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.3, 6, 16), this.mat(ENEMY_ARMOR));
    cradle.rotation.x = Math.PI / 2;
    cradle.position.y = PULSAR_HEIGHT;
    this.root.add(base, mast, orb, cradle);
    for (let i = 0; i < 2; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.4 + i * 0.6, 0.08, 6, 24), glow('#ff5fd2', {}, 1.3));
      ring.position.y = PULSAR_HEIGHT + 0.6;
      this.rings.push(ring);
      this.root.add(ring);
    }
    addOutlines(this.root);
  }

  protected think({ ship, shots, world, dt }: Ctx): void {
    const p = this.root.position;
    p.y = world.heightAt(p.x, p.z);
    const dist = this.distanceTo(ship).dist;
    const awake = ship.alive && dist < 65;
    this.timer -= dt;
    this.rings[0].rotation.x += dt * (this.phase === 'fire' ? 6 : 1);
    this.rings[1].rotation.y += dt * (this.phase === 'fire' ? 7 : 1.2);
    // The orb swells just before a spiral starts.
    const charging = this.phase === 'rest' && this.timer < 0.6 && awake;
    this.orb.color.set('#ff5fd2').multiplyScalar(GLOW * (this.phase === 'fire' ? 1.8 : charging ? 1.4 + Math.sin(this.time * 30) * 0.4 : 0.8));
    if (this.phase === 'rest') {
      if (this.timer <= 0 && awake) {
        this.phase = 'fire';
        this.timer = 3.2;
        this.volley = 0;
      }
      return;
    }
    // Firing: three arms of a rotating spiral, a volley every 0.16 s.
    this.volley -= dt;
    if (this.volley <= 0) {
      this.volley = 0.16;
      this.spin += 0.33;
      this.tmp.set(p.x, p.y + PULSAR_HEIGHT + 0.6, p.z);
      for (let i = 0; i < 3; i++) {
        const a = this.spin + (i / 3) * Math.PI * 2;
        shots.fire(this.tmp, Math.cos(a), Math.sin(a), 16, ship.root.position.y, 9, 6, 5);
      }
    }
    if (this.timer <= 0) {
      this.phase = 'rest';
      this.timer = 2.2;
    }
  }
}

/** Display names (plural) for the HUD. */
export const SPECIES_NAMES: Record<string, string> = {
  drone: 'DRONES',
  swarmer: 'SWARMERS',
  lancer: 'LANCERS',
  crawler: 'CRAWLERS',
  sniper: 'SNIPERS',
  minelayer: 'MINE LAYERS',
  pulsar: 'PULSARS',
};
