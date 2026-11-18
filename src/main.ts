import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import './style.css';
import { AimIndicator } from './game/AimIndicator';
import { CameraRig } from './game/CameraRig';
import { Effects } from './game/Effects';
import { EnemyManager } from './game/Enemies';
import { Hud } from './game/Hud';
import { Input } from './game/Input';
import {
  MISSILE_LOCK_ANGLE,
  MISSILE_LOCK_REACH,
  missileBlastRadius,
  missileDamage,
  MissileSystem,
  missileRange,
} from './game/Missiles';
import { Bullets, EnemyShots } from './game/Projectiles';
import { BOOST_COOLDOWN, HOVER_HEIGHT, Ship } from './game/Ship';
import { JUNGLE, World } from './game/World';

const $ = (id: string) => document.getElementById(id) as HTMLElement;

// ---- Gun tuning ----
const GUN_RATE = 11; // bullets per second (alternating barrels)
const AIM_ASSIST_ANGLE = 0.2; // radians either side of the nose where bullets bend toward an enemy
const AIM_ASSIST_RANGE = 38;
const FREE_AIM_DISTANCE = 30; // with nothing targeted, bullets aim at tower-head height this far ahead
const FREE_AIM_DROP = 4.5; // how far below the ship that is
const GUN_SPREAD = 0.03;

// ---------- Renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
$('app').appendChild(renderer.domElement);

/**
 * Quality levels. HIGH adds bloom (the soft glow around bright things).
 * LOW skips it and renders at a lower resolution for slower phones.
 * Tap the fps counter to switch; the game also drops to LOW by itself if it runs slowly.
 */
type Quality = 'high' | 'low';
const QUALITY_KEY = 'star-rotor-quality';
function savedQuality(): Quality | null {
  const fromUrl = new URLSearchParams(location.search).get('quality');
  if (fromUrl === 'high' || fromUrl === 'low') return fromUrl;
  try {
    const v = localStorage.getItem(QUALITY_KEY);
    return v === 'high' || v === 'low' ? v : null;
  } catch {
    return null;
  }
}
let quality: Quality = savedQuality() ?? 'high';
let qualityChosen = savedQuality() !== null; // if the player picked one, don't auto-switch

// ---------- Scene & lighting ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(JUNGLE.sky);
scene.fog = new THREE.Fog(JUNGLE.sky, 120, 270);

scene.add(new THREE.HemisphereLight(JUNGLE.hemiSky, JUNGLE.hemiGround, 1.1));
const sun = new THREE.DirectionalLight('#fff1d6', 2.3);
sun.position.set(-40, 60, 25);
scene.add(sun);
const rim = new THREE.DirectionalLight('#5fd8ff', 0.9); // cool back light for colour contrast
rim.position.set(30, 20, -40);
scene.add(rim);

// ---------- Game objects ----------
const world = new World(scene);
const effects = new Effects(scene, (x, z) => world.heightAt(x, z));
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

// ---------- Post-processing (HIGH quality) ----------
const composer = new EffectComposer(
  renderer,
  new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }),
);
composer.addPass(new RenderPass(scene, rig.camera));
// Only colours brighter than 1.0 (glows) bloom, so the ground and models stay crisp.
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.75, 0.45, 1.0);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---------- Hit-stop: freeze for a split second on big impacts (Hades does this a lot) ----------
let hitStop = 0;
const freeze = (seconds: number) => (hitStop = Math.max(hitStop, seconds));

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
  effects.embersBurst(ship.root.position, 6, 6, 0.12);
};
ship.onFullCharge = () => input.vibrate(15);
/** The enemy a missile would lock onto right now (closest one near the aim line, within range). */
function missileLock(charge: number, heading: number) {
  const p = ship.root.position;
  return enemies.findInCone(p.x, p.z, heading, missileRange(charge) + MISSILE_LOCK_REACH, MISSILE_LOCK_ANGLE);
}

ship.onMissile = (charge, heading) => {
  missiles.fire(ship.root.position, heading, charge, missileLock(charge, heading));
  rig.kick(1 + charge * 2, 0.15);
};
ship.onHit = () => {
  freeze(0.05);
  hud.flashDamage();
  rig.kick(0, 0.6);
  input.vibrate(40);
};
ship.onDeath = () => {
  freeze(0.18);
  const p = ship.root.position;
  effects.explosion(p, 7, world.heightAt(p.x, p.z));
  rig.kick(4, 2);
  input.vibrate(200);
  hud.show('SHIP DOWN');
};
ship.onRespawn = () => hud.show('BACK IN THE FIGHT', 1.5);

missiles.onExplode = (pos, power) => {
  freeze(0.03 + power * 0.04);
  enemies.damageCircle(pos.x, pos.z, missileBlastRadius(power), missileDamage(power));
  rig.kick(0, 0.5 + power * 0.9);
  input.vibrate(25 + Math.round(power * 30));
};
enemies.onKill = (kind) => {
  freeze(kind === 'turret' ? 0.08 : 0.05);
  rig.kick(0, kind === 'turret' ? 1 : 0.6);
  input.vibrate(30);
};
enemies.onAreaCleared = () => hud.show('AREA CLEARED', 3);

// ---------- Machine gun ----------
let gunTimer = 0;
let barrel = 0;
const muzzlePos = new THREE.Vector3();
const aimPoint = new THREE.Vector3();
const bulletDir = new THREE.Vector3();

function updateGun(dt: number): void {
  gunTimer -= dt;
  if (!ship.isFiring || gunTimer > 0) return;
  gunTimer += 1 / GUN_RATE;
  if (gunTimer < 0) gunTimer = 0;

  ship.getMuzzle(barrel, muzzlePos);
  barrel = 1 - barrel;
  ship.flashMuzzle();

  // Aim at an enemy near the line of fire (aim assist); otherwise straight ahead.
  const p = ship.root.position;
  const target = enemies.findInCone(p.x, p.z, ship.heading, AIM_ASSIST_RANGE, AIM_ASSIST_ANGLE);
  if (target) {
    aimPoint.copy(target.root.position);
    aimPoint.y += target.aimHeight;
  } else {
    // Nearly level, angled just down to where tower turrets sit.
    aimPoint.set(
      p.x - Math.sin(ship.heading) * FREE_AIM_DISTANCE,
      p.y - FREE_AIM_DROP,
      p.z - Math.cos(ship.heading) * FREE_AIM_DISTANCE,
    );
  }
  bulletDir.subVectors(aimPoint, muzzlePos).normalize();
  // A little random spread sideways.
  const spread = (Math.random() - 0.5) * GUN_SPREAD * 2;
  const cos = Math.cos(spread);
  const sin = Math.sin(spread);
  bulletDir.set(bulletDir.x * cos + bulletDir.z * sin, bulletDir.y, -bulletDir.x * sin + bulletDir.z * cos);
  bullets.fire(muzzlePos, bulletDir);
}

// ---------- Resize & fullscreen ----------
function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  // Phones have very dense screens; capping the pixel ratio keeps the frame rate up.
  const ratio = Math.min(window.devicePixelRatio, quality === 'high' ? 1.75 : 1.25);
  renderer.setPixelRatio(ratio);
  renderer.setSize(w, h);
  composer.setPixelRatio(ratio);
  composer.setSize(w, h);
  rig.setAspect(w / h);
}

function setQuality(q: Quality, remember: boolean): void {
  quality = q;
  if (remember) {
    qualityChosen = true;
    try {
      localStorage.setItem(QUALITY_KEY, q);
    } catch {
      /* private mode — fine */
    }
  }
  resize();
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
fpsEl.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  setQuality(quality === 'high' ? 'low' : 'high', true);
  hud.show(quality === 'high' ? 'QUALITY: HIGH' : 'QUALITY: LOW', 1.2);
});
const enginePos = new THREE.Vector3();
let perfTime = 0;
let perfFrames = 0;
let elapsed = 0;
const boostBtn = $('btn-boost');
const aimLead = new THREE.Vector2();
let frames = 0;
let fpsTimer = 0;
let last = performance.now();

renderer.setAnimationLoop((now: number) => {
  const realDt = Math.min((now - last) / 1000, 1 / 20); // clamp so a hiccup doesn't teleport the ship
  last = now;
  elapsed += realDt;

  // Hit-stop: the world pauses for a moment, but the screen keeps rendering.
  let dt = realDt;
  if (hitStop > 0) {
    hitStop -= realDt;
    dt = realDt * 0.05;
  }

  ship.update(dt, input, world);
  updateGun(dt);
  enemies.update(dt, ship, enemyShots, rig.camera);
  bullets.update(dt, enemies.enemies, (x, z) => world.heightAt(x, z));
  enemyShots.update(dt, ship);
  missiles.update(dt, enemies.enemies);
  if (ship.isBoosting && ship.alive) {
    for (let i = 0; i < 2; i++) effects.trail(ship.getEngine(i, enginePos));
  }
  effects.update(dt, rig.lookTarget);
  aim.update(dt, ship, world, ship.isCharging ? missileLock(ship.charge, ship.aimHeading) : null);
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

  if (quality === 'high') composer.render(realDt);
  else renderer.render(scene, rig.camera);
  input.endFrame();

  frames++;
  fpsTimer += realDt;
  if (fpsTimer >= 0.5) {
    fpsEl.textContent = `${Math.round(frames / fpsTimer)} fps · ${quality.toUpperCase()}`;
    frames = 0;
    fpsTimer = 0;
  }

  // Auto quality: after a few seconds of warm-up, if HIGH averages under 45 fps, drop to LOW.
  if (!qualityChosen && quality === 'high' && elapsed > 3) {
    perfTime += realDt;
    perfFrames++;
    if (perfTime >= 3) {
      if (perfFrames / perfTime < 45) setQuality('low', false);
      qualityChosen = true;
    }
  }
});
