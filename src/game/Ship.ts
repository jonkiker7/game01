import * as THREE from 'three';
import type { Input } from './Input';
import { addOutlines, GLOW, glow } from './materials';
import { approachAngle, clamp, damp } from './math';
import { defaultStats, type Stats } from './run/Upgrades';
import { TUNING } from './Tuning';
import { buildShipDesign, type ShipDesignId, type ShipParts } from './ShipDesigns';
import type { World } from './World';

// ---- Handling (speeds and rolls are in Tuning.ts; tweak these for the rest of the feel) ----
const ACCEL = 3.6; // how quickly the ship reaches the stick's speed (higher = snappier)
const TURN_RATE = 6.5; // radians/second when turning to face the stick direction
const TURN_RATE_FIRING = 1.3; // slow turning while firing without aiming, so you can strafe
const AIM_TURN_RATE = 12; // the ship snaps quickly toward where you're aiming
const BOOST_TIME = 0.38; // seconds of dash
const BOOST_INVULNERABLE = 0.45; // dodge through enemy shots while dashing
const ROLL_TIME = 0.42; // seconds per roll (one full spin)
const ROLL_INVULNERABLE = 0.4;
export const HOVER_HEIGHT = 32.5; // well above the jungle canopy

// ---- Weapons ----
const GUN_SPEED = 0.85; // fly slightly slower while shooting
const CHARGE_TIME = 0.75; // seconds for a missile to reach full power
const CHARGING_SPEED = 0.5; // fly at half speed while charging a missile
// Missile capacity and recharge time come from the run's stats (see run/Upgrades.ts).

// ---- Armor ----
const SPAWN_INVULNERABLE = 2;

/**
 * The player's space helicopter. Built from simple shapes for now; it can be
 * swapped for a Blender model later without changing the flight code.
 *
 * Facing: the model points down -Z when heading = 0.
 */
export class Ship {
  readonly root = new THREE.Group(); // position + heading
  readonly velocity = new THREE.Vector2(); // (x, z) world units/second
  heading = 0;
  boostCooldown = 0;
  rollCooldown = 0;
  private rollTimer = 0;
  private rollDir = 0; // -1 left, +1 right

  readonly radius = 1.7;
  readonly hitBottom = -2;
  readonly hitTop = 2;
  readonly aimHeight = 0;
  /** Current run stats (upgrades change these). */
  stats: Stats = defaultStats();
  armor = 100;
  alive = true;
  invulnerable = 0;

  /** True while GUN is held and the ship is alive. */
  isFiring = false;
  /** Missile charge 0..1 while MSL is held. */
  charge = 0;
  isCharging = false;
  /** Direction the missile will fire (same convention as `heading`). */
  aimHeading = 0;

  onBoost?: () => void;
  onRoll?: (dir: number) => void;
  onFullCharge?: () => void;
  onMissile?: (charge: number, heading: number) => void;
  /** Pressed MSL with no missiles left. */
  onMissileEmpty?: () => void;

  /** Missiles ready to fire (0..stats.missileMax), and progress (0..1) on the next one recharging. */
  missiles = 3;
  missileRecharge = 0;
  onHit?: (damage: number) => void;
  onDeath?: () => void;

  private readonly tilt = new THREE.Group(); // pitch + bank
  private parts: ShipParts;
  private readonly engineMat = glow('#6ff7ff');
  private readonly shadow: THREE.Mesh;
  private pitch = 0;
  private roll = 0;
  private lastHeading = 0;
  private throttle = 0; // how far the stick is pushed (0..1)
  private flameLen = 0;
  private turnRate = 0; // radians/second, + = turning left
  private sideSpeed = 0; // + = sliding right
  private readonly thrust = [0, 0]; // left, right side thrusters (0..1)
  private time = 0;
  private boostTimer = 0;
  private hitFlash = 0;
  private muzzleFlash = 0;

  constructor(scene: THREE.Scene, design: ShipDesignId = 'b') {
    this.root.add(this.tilt);
    this.parts = buildShipDesign(design, this.tilt, this.engineMat);
    addOutlines(this.tilt);
    this.root.scale.setScalar(0.85);
    this.shadow = this.buildShadow();
    scene.add(this.root, this.shadow);
  }

  /** Swap to a different ship design (chosen at the Mechanic in home base). */
  setDesign(design: ShipDesignId): void {
    this.tilt.clear();
    this.parts = buildShipDesign(design, this.tilt, this.engineMat);
    addOutlines(this.tilt);
  }

  get isBoosting(): boolean {
    return this.boostTimer > 0;
  }

  /** World position of engine 0 or 1 (for the boost trail). */
  getEngine(index: number, out: THREE.Vector3): THREE.Vector3 {
    return this.parts.engines[index].getWorldPosition(out);
  }

  /** World position of gun barrel 0 or 1. */
  getMuzzle(index: number, out: THREE.Vector3): THREE.Vector3 {
    return this.parts.muzzles[index].getWorldPosition(out);
  }

  /** Called by the gun each time a bullet leaves a barrel. */
  flashMuzzle(): void {
    this.muzzleFlash = 0.05;
  }

  /** Restore armor (healing pickups). */
  heal(amount: number): void {
    if (!this.alive) return;
    this.armor = Math.min(this.stats.maxArmor, this.armor + amount);
  }

  damage(amount: number): void {
    if (!this.alive || this.invulnerable > 0) return;
    this.armor = Math.max(0, this.armor - amount);
    this.hitFlash = 0.18;
    this.onHit?.(amount);
    if (this.armor <= 0) {
      this.alive = false;
      this.isFiring = false;
      this.isCharging = false;
      this.charge = 0;
      this.root.visible = false;
      this.shadow.visible = false;
      this.velocity.set(0, 0);
      this.onDeath?.();
    }
  }

  update(dt: number, input: Input, world: World): void {
    this.time += dt;
    this.invulnerable = Math.max(0, this.invulnerable - dt);

    if (!this.alive) {
      // Drain button events while the wreck burns (the run decides what happens next).
      input.consumePress('missile');
      input.consumePress('boost');
      input.consumePress('rollL');
      input.consumePress('rollR');
      return;
    }

    const move = input.getMove();
    // Screen up = world -Z, screen right = world +X (camera looks from the south).
    const dirX = move.x;
    const dirZ = -move.y;
    const mag = Math.hypot(dirX, dirZ);
    this.throttle = Math.min(1, mag);

    // --- Boost: a short dash toward the stick (or straight ahead if centered) ---
    this.boostCooldown = Math.max(0, this.boostCooldown - dt);
    if (input.consumePress('boost') && this.boostCooldown <= 0) {
      let bx = -Math.sin(this.heading);
      let bz = -Math.cos(this.heading);
      if (mag > 0.2) {
        bx = dirX / mag;
        bz = dirZ / mag;
      }
      this.velocity.set(bx * TUNING.ship.boostSpeed, bz * TUNING.ship.boostSpeed);
      this.boostTimer = BOOST_TIME;
      this.boostCooldown = this.stats.boostCooldown;
      this.invulnerable = Math.max(this.invulnerable, BOOST_INVULNERABLE);
      this.onBoost?.();
    }

    // --- Barrel roll: a quick dodge to screen left or right (whichever way the ship faces) ---
    this.rollCooldown = Math.max(0, this.rollCooldown - dt);
    const rollL = input.consumePress('rollL');
    const rollR = input.consumePress('rollR');
    if ((rollL || rollR) && this.rollCooldown <= 0 && this.boostTimer <= 0) {
      const screenDir = rollR ? 1 : -1; // world +X is screen right
      // Keep the up/down (screen) momentum, add a hard sideways kick.
      this.velocity.set(screenDir * TUNING.ship.rollSpeed, this.velocity.y);
      // Spin toward the side of the ship that's moving: ship-right is (cos h, -sin h) in world.
      const towardShipRight = screenDir * Math.cos(this.heading);
      this.rollDir = towardShipRight >= 0 ? 1 : -1;
      this.rollTimer = ROLL_TIME;
      this.rollCooldown = TUNING.ship.rollCooldown;
      this.invulnerable = Math.max(this.invulnerable, ROLL_INVULNERABLE);
      this.onRoll?.(this.rollDir);
    }

    // --- Missile ammo: refills one at a time, each taking stats.missileRecharge seconds ---
    const missileMax = this.stats.missileMax;
    if (this.missiles < missileMax) {
      this.missileRecharge += dt / this.stats.missileRecharge;
      if (this.missileRecharge >= 1) {
        this.missiles++;
        this.missileRecharge = this.missiles < missileMax ? this.missileRecharge - 1 : 0;
      }
    }

    // --- Missile: hold to charge, drag from the button to aim, release to fire ---
    if (input.consumePress('missile') && !this.isCharging) {
      if (this.missiles > 0) {
        this.isCharging = true;
        this.charge = 0;
        this.aimHeading = this.heading;
      } else {
        this.onMissileEmpty?.();
      }
    }
    if (this.isCharging) {
      const before = this.charge;
      this.charge = Math.min(1, this.charge + dt / CHARGE_TIME);
      if (before < 1 && this.charge >= 1) this.onFullCharge?.();
      const aim = input.getAim('missile');
      if (aim.x !== 0 || aim.y !== 0) this.aimHeading = Math.atan2(-aim.x, aim.y);
    }
    if (input.consumeRelease('missile') && this.isCharging) {
      this.missiles--;
      this.onMissile?.(this.charge, this.aimHeading);
      this.isCharging = false;
      this.charge = 0;
    }

    // --- Gun: hold to fire; drag from the button to aim (twin-stick) ---
    this.isFiring = input.isHeld('gun');
    const gunAim = input.getAim('gun');
    const gunAiming = this.isFiring && (gunAim.x !== 0 || gunAim.y !== 0);

    // --- Velocity: ease toward where the stick is pointing (gives helicopter momentum) ---
    const speedScale = this.isCharging ? CHARGING_SPEED : this.isFiring ? GUN_SPEED : 1;
    if (this.boostTimer > 0) {
      this.boostTimer -= dt;
      this.velocity.multiplyScalar(Math.exp(-1.5 * dt));
    } else if (this.rollTimer > 0) {
      this.rollTimer -= dt;
      this.velocity.multiplyScalar(Math.exp(-2.2 * dt));
    } else {
      const k = 1 - Math.exp(-ACCEL * dt);
      const top = TUNING.ship.maxSpeed * this.stats.speedMul * speedScale;
      this.velocity.x += (dirX * top - this.velocity.x) * k;
      this.velocity.y += (dirZ * top - this.velocity.y) * k;
    }

    // --- Heading: missile aim > gun aim > stick direction ---
    if (this.isCharging) {
      this.heading = approachAngle(this.heading, this.aimHeading, AIM_TURN_RATE * dt);
    } else if (gunAiming) {
      this.heading = approachAngle(this.heading, Math.atan2(-gunAim.x, gunAim.y), AIM_TURN_RATE * dt);
    } else if (mag > 0.15) {
      const target = Math.atan2(-dirX, -dirZ);
      this.heading = approachAngle(this.heading, target, (this.isFiring ? TURN_RATE_FIRING : TURN_RATE) * dt);
    }

    // --- Position, kept inside the map ---
    const p = this.root.position;
    p.x += this.velocity.x * dt;
    p.z += this.velocity.y * dt;
    const limit = world.halfSize - 4;
    if (Math.abs(p.x) > limit) {
      p.x = clamp(p.x, -limit, limit);
      this.velocity.x = 0;
    }
    if (Math.abs(p.z) > limit) {
      p.z = clamp(p.z, -limit, limit);
      this.velocity.y = 0;
    }
    const ground = world.heightAt(p.x, p.z);
    p.y = damp(p.y, ground + HOVER_HEIGHT + Math.sin(this.time * 2.1) * 0.18, 6, dt);
    this.root.rotation.y = this.heading;

    // --- Tilt: nose dips when flying forward, banks when sliding sideways ---
    const fx = -Math.sin(this.heading);
    const fz = -Math.cos(this.heading);
    const forwardSpeed = this.velocity.x * fx + this.velocity.y * fz;
    const sideSpeed = this.velocity.x * -fz + this.velocity.y * fx;
    this.sideSpeed = sideSpeed;
    if (dt > 0) {
      let dh = this.heading - this.lastHeading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      this.turnRate = damp(this.turnRate, dh / dt, 12, dt);
    }
    this.lastHeading = this.heading;
    this.pitch = damp(this.pitch, clamp(-forwardSpeed * 0.022, -0.55, 0.55), 6, dt);
    this.roll = damp(this.roll, clamp(-sideSpeed * 0.03, -0.6, 0.6), 6, dt);
    // A barrel roll spins the ship once around its nose (eased so it snaps out of the spin).
    let spin = 0;
    if (this.rollTimer > 0) {
      const u = 1 - this.rollTimer / ROLL_TIME;
      spin = -this.rollDir * Math.PI * 2 * (1 - (1 - u) * (1 - u));
    }
    this.tilt.rotation.set(this.pitch, 0, this.roll + spin);

    this.updateVisuals(dt, ground);
  }

  /** Start fresh for a new run: full armor and missiles, at (x, z), facing north. */
  reset(world: World, x: number, z: number, stats: Stats): void {
    this.stats = stats;
    this.alive = true;
    this.armor = stats.maxArmor;
    this.missiles = stats.missileMax;
    this.missileRecharge = 0;
    this.boostCooldown = 0;
    this.rollCooldown = 0;
    this.rollTimer = 0;
    this.isCharging = false;
    this.charge = 0;
    this.invulnerable = SPAWN_INVULNERABLE;
    this.teleport(world, x, z);
    this.root.visible = true;
    this.shadow.visible = true;
  }

  /** Move instantly (between arenas), stopped and facing north. */
  teleport(world: World, x: number, z: number): void {
    this.velocity.set(0, 0);
    this.heading = 0;
    this.root.position.set(x, world.heightAt(x, z) + HOVER_HEIGHT, z);
  }

  /** Keep the ship inside a circular arena (soft wall). */
  confine(cx: number, cz: number, r: number): void {
    const p = this.root.position;
    const dx = p.x - cx;
    const dz = p.z - cz;
    const d = Math.hypot(dx, dz);
    if (d <= r) return;
    const nx = dx / d;
    const nz = dz / d;
    p.x = cx + nx * r;
    p.z = cz + nz * r;
    const out = this.velocity.x * nx + this.velocity.y * nz;
    if (out > 0) {
      this.velocity.x -= nx * out;
      this.velocity.y -= nz * out;
    }
  }

  private updateVisuals(dt: number, ground: number): void {
    const p = this.root.position;
    const speed = this.velocity.length();
    for (const s of this.parts.spinners) s.obj.rotation.y += s.dir * dt * (16 + speed * 0.5);
    for (const m of this.parts.pulses) m.opacity = 0.22 + Math.sin(this.time * 6) * 0.07;

    const boostGlow = this.isBoosting ? 1 : 0;
    this.engineMat.color.setRGB(0.44 + boostGlow * 0.56, 0.97, 1).multiplyScalar(GLOW * (1 + boostGlow * 0.6));
    for (const e of this.parts.engines) e.scale.setScalar(damp(e.scale.x, 1 + boostGlow * 0.9, 12, dt));
    // Rear flames: a short idle flicker, longer the harder you push the stick, longest on boost.
    const wantLen = this.isBoosting ? 6.5 : 0.6 + this.throttle * 3.2;
    this.flameLen = damp(this.flameLen, wantLen, wantLen > this.flameLen ? 14 : 6, dt);
    for (const [i, f] of this.parts.flames.entries()) {
      const flicker = 0.88 + Math.sin(this.time * 47 + i * 1.7) * 0.12;
      f.scale.set(1 + boostGlow * 0.3, 1 + boostGlow * 0.3, Math.max(0.01, this.flameLen * flicker));
    }

    // Side thrusters: the side opposite a turn fires (pushing the nose around); rolls and
    // sideways drift fire the side doing the pushing; boosts fire both.
    const turn = clamp(this.turnRate / 4, -1, 1); // + = turning left → right thruster
    const drift = clamp(this.sideSpeed / 60, -1, 1); // + = sliding right → left thruster
    const rolling = this.rollTimer > 0 ? 1 : 0;
    for (const th of this.parts.thrusters) {
      const i = th.side < 0 ? 0 : 1;
      let want = Math.max(0, th.side > 0 ? turn : -turn) + Math.max(0, th.side > 0 ? -drift : drift) * 0.6;
      if (rolling && Math.sign(this.rollDir) === -th.side) want = 1;
      if (this.isBoosting) want = 1;
      want = Math.min(1, want < 0.12 ? 0 : want);
      this.thrust[i] = damp(this.thrust[i], want, want > this.thrust[i] ? 25 : 8, dt);
      const k = this.thrust[i];
      th.obj.visible = k > 0.03;
      const flicker = 0.85 + Math.sin(this.time * 55 + i * 2) * 0.15;
      th.obj.scale.set(0.6 + k * 0.6, Math.max(0.01, k * flicker * 1.4), 0.6 + k * 0.6);
    }

    this.muzzleFlash -= dt;
    for (const m of this.parts.muzzles) m.visible = this.muzzleFlash > 0;

    // Red flash when hit; blink while invulnerable after spawning.
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    const f = this.hitFlash / 0.18;
    for (const m of this.parts.flashMats) m.emissive.setRGB(f * 0.9, f * 0.1, f * 0.15);
    this.tilt.visible = this.invulnerable > 0.4 ? Math.floor(this.time * 14) % 2 === 0 : true;

    this.shadow.position.set(p.x, ground + 0.15, p.z);
    this.shadow.rotation.y = this.heading;
  }

  /** A soft dark blob under the ship (cheap, and it helps you judge position). */
  private buildShadow(): THREE.Mesh {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(10,0,25,0.7)');
    grad.addColorStop(0.55, 'rgba(10,0,25,0.45)');
    grad.addColorStop(1, 'rgba(10,0,15,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);

    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }),
    );
    mesh.geometry.rotateX(-Math.PI / 2);
    mesh.scale.set(6, 1, 7.5);
    mesh.renderOrder = 1;
    return mesh;
  }
}
