import * as THREE from 'three';
import './style.css';
import { AimIndicator } from './game/AimIndicator';
import { CameraRig } from './game/CameraRig';
import { Effects } from './game/Effects';
import { EnemyManager } from './game/Enemies';
import { Hud } from './game/Hud';
import { Input } from './game/Input';
import { missileBlastRadius, missileDamage, MissileSystem, missileRange } from './game/Missiles';
import { Bullets, EnemyShots } from './game/Projectiles';
import { BOOST_COOLDOWN, HOVER_HEIGHT, Ship } from './game/Ship';
import { CRIMSON_DUNES, World } from './game/World';

const $ = (id: string) => document.getElementById(id) as HTMLElement;

// ---- Gun tuning ----
const GUN_RATE = 11; // bullets per second (alternating barrels)
const AIM_ASSIST_ANGLE = 0.2; // radians either side of the nose where bullets bend toward an enemy
const AIM_ASSIST_RANGE = 38;
const GUN_SPREAD = 0.03;

// ---------- Renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
// Phones have very dense screens; capping the pixel ratio keeps the frame rate up.
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;
$('app').appendChild(renderer.domElement);

// ---------- Scene & lighting ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(CRIMSON_DUNES.sky);
scene.fog = new THREE.Fog(CRIMSON_DUNES.sky, 95, 230);

scene.add(new THREE.HemisphereLight('#ffc6e0', '#2b0c38', 1.1));
const sun = new THREE.DirectionalLight('#ffe0b8', 2.4);
sun.position.set(-40, 60, 25);
scene.add(sun);
const rim = new THREE.DirectionalLight('#5fd8ff', 0.9); // cool back light for colour contrast
rim.position.set(30, 20, -40);
scene.add(rim);

// ---------- Game objects ----------
const world = new World(scene);
const effects = new Effects(scene);
const ship = new Ship(scene);
ship.root.position.set(0, world.heightAt(0, 0) + HOVER_HEIGHT, 0);
const missiles = new MissileSystem(scene, world, effects);
const aim = new AimIndicator(scene);
const bullets = new Bullets(scene, effects);
const enemyShots = new EnemyShots(scene, effects);
const enemies = new EnemyManager(scene, world, effects);
const hud = new Hud($('hud'));

const rig = new CameraRig(window.innerWidth / window.innerHeight);
rig.snapTo(ship.root.position);

const input = new Input({
  hud: $('hud'),
  stickZone: $('stick-zone'),
  stickBase: $('stick-base'),
  stickKnob: $('stick-knob'),
  buttons: { gun: $('btn-gun'), missile: $('btn-missile'), boost: $('btn-boost') },
});

// ---------- Events ----------
ship.onBoost = () => {
  rig.kick(6, 0.35);
  input.vibrate(20);
};
ship.onFullCharge = () => input.vibrate(15);
ship.onMissile = (charge, heading) => {
  missiles.fire(ship.root.position, heading, charge);
  rig.kick(1 + charge * 2, 0.15);
};
ship.onHit = () => {
  hud.flashDamage();
  rig.kick(0, 0.6);
  input.vibrate(40);
};
ship.onDeath = () => {
  const p = ship.root.position;
  effects.explosion(p, 7, world.heightAt(p.x, p.z));
  rig.kick(4, 2);
  input.vibrate(200);
  hud.show('SHIP DOWN');
};
ship.onRespawn = () => hud.show('BACK IN THE FIGHT', 1.5);

missiles.onExplode = (pos, power) => {
  enemies.damageCircle(pos.x, pos.z, missileBlastRadius(power), missileDamage(power));
  rig.kick(0, 0.5 + power * 0.9);
  input.vibrate(25 + Math.round(power * 30));
};
enemies.onKill = (kind) => {
  rig.kick(0, kind === 'turret' ? 1 : 0.6);
  input.vibrate(30);
};
enemies.onAreaCleared = () => hud.show('AREA CLEARED', 3);

// ---------- Machine gun ----------
let gunTimer = 0;
let barrel = 0;
const muzzlePos = new THREE.Vector3();

function updateGun(dt: number): void {
  gunTimer -= dt;
  if (!ship.isFiring || gunTimer > 0) return;
  gunTimer += 1 / GUN_RATE;
  if (gunTimer < 0) gunTimer = 0;

  ship.getMuzzle(barrel, muzzlePos);
  barrel = 1 - barrel;
  ship.flashMuzzle();

  // Shoot along the nose, bending toward an enemy if one is close to the line of fire.
  let angle = ship.heading;
  const p = ship.root.position;
  const target = enemies.findInCone(p.x, p.z, ship.heading, AIM_ASSIST_RANGE, AIM_ASSIST_ANGLE);
  if (target) {
    angle = Math.atan2(-(target.root.position.x - muzzlePos.x), -(target.root.position.z - muzzlePos.z));
  }
  angle += (Math.random() - 0.5) * GUN_SPREAD * 2;
  bullets.fire(muzzlePos, -Math.sin(angle), -Math.cos(angle));
}

// ---------- Resize & fullscreen ----------
function resize(): void {
  renderer.setSize(window.innerWidth, window.innerHeight);
  rig.setAspect(window.innerWidth / window.innerHeight);
}
window.addEventListener('resize', resize);
resize();

// On Android, the first touch goes fullscreen and locks landscape.
// (iPhone Safari doesn't allow this; use "Add to Home Screen" there instead.)
if (window.matchMedia('(pointer: coarse)').matches) {
  window.addEventListener(
    'pointerdown',
    async () => {
      try {
        if (document.fullscreenEnabled && !document.fullscreenElement) {
          await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
        }
        const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
        await orientation.lock?.('landscape');
      } catch {
        /* not supported on this device — that's fine */
      }
    },
    { once: true },
  );
}

// ---------- Main loop ----------
const fpsEl = $('fps');
const boostBtn = $('btn-boost');
const aimLead = new THREE.Vector2();
let frames = 0;
let fpsTimer = 0;
let last = performance.now();

renderer.setAnimationLoop((now: number) => {
  const dt = Math.min((now - last) / 1000, 1 / 20); // clamp so a hiccup doesn't teleport the ship
  last = now;

  ship.update(dt, input, world);
  updateGun(dt);
  enemies.update(dt, ship, enemyShots);
  bullets.update(dt, enemies.enemies);
  enemyShots.update(dt, ship);
  missiles.update(dt);
  effects.update(dt);
  aim.update(dt, ship, world);
  world.update(dt);

  // While charging a missile, lean the camera toward the target so it stays on screen.
  if (ship.isCharging) {
    const r = missileRange(ship.charge) * 0.4;
    aimLead.set(-Math.sin(ship.aimHeading) * r, -Math.cos(ship.aimHeading) * r);
  } else {
    aimLead.set(0, 0);
  }
  rig.update(dt, ship.root.position, ship.velocity, aimLead);

  boostBtn.style.setProperty('--cd', String(ship.boostCooldown / BOOST_COOLDOWN));
  hud.setArmor(ship.armor);
  hud.setTargets(enemies.turretsLeft);
  hud.update(dt);

  renderer.render(scene, rig.camera);
  input.endFrame();

  frames++;
  fpsTimer += dt;
  if (fpsTimer >= 0.5) {
    fpsEl.textContent = `${Math.round(frames / fpsTimer)} fps`;
    frames = 0;
    fpsTimer = 0;
  }
});
