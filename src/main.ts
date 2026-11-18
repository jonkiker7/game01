import * as THREE from 'three';
import './style.css';
import { AimIndicator } from './game/AimIndicator';
import { CameraRig } from './game/CameraRig';
import { Input } from './game/Input';
import { MissileSystem, missileRange } from './game/Missiles';
import { BOOST_COOLDOWN, Ship } from './game/Ship';
import { CRIMSON_DUNES, World } from './game/World';

const $ = (id: string) => document.getElementById(id) as HTMLElement;

// ---------- Renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
// Phones have very dense screens; capping the pixel ratio keeps the frame rate up.
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;
$('app').appendChild(renderer.domElement);

// ---------- Scene & lighting ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(CRIMSON_DUNES.sky);
scene.fog = new THREE.Fog(CRIMSON_DUNES.sky, 85, 210);

scene.add(new THREE.HemisphereLight('#ffc6e0', '#2b0c38', 1.1));
const sun = new THREE.DirectionalLight('#ffe0b8', 2.4);
sun.position.set(-40, 60, 25);
scene.add(sun);
const rim = new THREE.DirectionalLight('#5fd8ff', 0.9); // cool back light for colour contrast
rim.position.set(30, 20, -40);
scene.add(rim);

// ---------- Game objects ----------
const world = new World(scene);
const ship = new Ship(scene);
ship.root.position.set(0, world.heightAt(0, 0) + 6.5, 0);
const missiles = new MissileSystem(scene, world);
const aim = new AimIndicator(scene);

const rig = new CameraRig(window.innerWidth / window.innerHeight);
rig.snapTo(ship.root.position);

const input = new Input({
  stickZone: $('stick-zone'),
  stickBase: $('stick-base'),
  stickKnob: $('stick-knob'),
  aimRing: $('aim-ring'),
  aimKnob: $('aim-knob'),
  buttons: { gun: $('btn-gun'), missile: $('btn-missile'), boost: $('btn-boost') },
});

ship.onBoost = () => {
  rig.kick(6, 0.35);
  input.vibrate(20);
};
ship.onFullCharge = () => input.vibrate(15);
ship.onMissile = (charge, heading) => {
  missiles.fire(ship.root.position, heading, charge);
  rig.kick(1 + charge * 2, 0.15);
};
missiles.onExplode = (_x, _z, power) => {
  rig.kick(0, 0.5 + power * 0.9);
  input.vibrate(25 + Math.round(power * 30));
};

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
const aimLead = new THREE.Vector2();
const boostBtn = $('btn-boost');
let frames = 0;
let fpsTimer = 0;
let last = performance.now();

renderer.setAnimationLoop((now: number) => {
  const dt = Math.min((now - last) / 1000, 1 / 20); // clamp so a hiccup doesn't teleport the ship
  last = now;

  ship.update(dt, input, world);
  missiles.update(dt);
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
