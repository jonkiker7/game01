import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import './style.css';
import { BaseUI } from './base/BaseUI';
import { ConversationUI } from './base/Conversation';
import { HomeBase } from './base/HomeBase';
import { applyPerks, loadSave, PERKS, rollContracts, writeSave } from './base/Save';
import { devModeOn, PauseMenu } from './game/run/PauseMenu';
import { AimIndicator } from './game/AimIndicator';
import { CameraRig } from './game/CameraRig';
import { Effects } from './game/Effects';
import { EnemyManager } from './game/Enemies';
import { Hud } from './game/Hud';
import { Input } from './game/Input';
import { Pickups } from './game/Pickups';
import { type Blip, Radar } from './game/Radar';
import {
  MISSILE_LOCK_ANGLE,
  MISSILE_LOCK_REACH,
  missileBlastRadius,
  missileDamage,
  MissileSystem,
  missileRange,
} from './game/Missiles';
import { BULLET_STYLES, Bullets, EnemyShots } from './game/Projectiles';
import { Combat } from './game/Combat';
import { Mortars } from './game/Mortars';
import { ArenaVisual } from './game/run/Arena';
import { ContractTracker } from './game/run/Contracts';
import { Run } from './game/run/Run';
import { defaultStats } from './game/run/Upgrades';
import { RunUI } from './game/run/RunUI';
import { Ship } from './game/Ship';
import { TUNING } from './game/Tuning';
import { SunShadows } from './game/Shadows';
import { isShipDesign } from './game/ShipDesigns';
import { World } from './game/World';

const $ = (id: string) => document.getElementById(id) as HTMLElement;

// ---- Gun tuning (fire rate and damage come from the run's stats) ----
const AIM_ASSIST_ANGLE = 0.2; // radians either side of the nose where bullets bend toward an enemy
const AIM_ASSIST_RANGE = 38;
const GUN_SPREAD = 0.03;
const SIDE_SHOT_ANGLE = 0.14; // radians between Split Shot bullets

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
scene.background = new THREE.Color('#000000'); // beyond the arena's tree band it's all black
// No distance fog and no sky fill light: the canyon fog and the blue rim light do those jobs, and
// leaving them out (rather than at zero) saves shader work on every surface.
const sun = new THREE.DirectionalLight('#ffffff', 4.25);
sun.position.set(-40, 60, 25);
scene.add(sun);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
const sunShadows = new SunShadows(sun, scene);
sunShadows.setDirection(79, 31); // compass direction the light comes from, and height above the horizon
sunShadows.darkness = 1;
sunShadows.enabled = quality === 'high';
const rim = new THREE.DirectionalLight('#5fd8ff', 2.8); // cool back light for colour contrast
rim.position.set(30, 20, -40);
scene.add(rim);

// ---------- Game objects ----------
const world = new World(scene);
const effects = new Effects(scene, (x, z) => world.heightAt(x, z));
// Pick the ship design with ?ship=a|b|c|d (see designs.html); defaults to the Manta.
const shipParam = new URLSearchParams(location.search).get('ship');
const save = loadSave();
const ship = new Ship(scene, isShipDesign(shipParam) ? shipParam : save.ship);
const missiles = new MissileSystem(scene, world, effects);
const aim = new AimIndicator(scene);
// One bullet pool per gun type, each with its own look, speed and range.
const guns = {
  machinegun: new Bullets(scene, effects, BULLET_STYLES.machinegun),
  scatter: new Bullets(scene, effects, BULLET_STYLES.scatter),
  rail: new Bullets(scene, effects, BULLET_STYLES.rail),
};
const allGuns = Object.values(guns);
const enemyShots = new EnemyShots(scene, effects);
const mortars = new Mortars(scene, effects);
const enemies = new EnemyManager(scene, world, effects);
const hud = new Hud($('hud'));
enemies.hud = hud;
const pickups = new Pickups(scene, effects);
const pickupTarget = new THREE.Vector3();
// All hits go through Combat so Arc / Cryo / Plasma upgrades can react.
const combat = new Combat(enemies, effects, () => ship.stats);
for (const g of allGuns) g.onHit = (t, dmg) => combat.hit(t, dmg, 'gun');

// ---- Nova (special ability): charges from damage dealt ----
const NOVA_COST = 350; // damage dealt to fill the charge
const NOVA_RADIUS = 26;
const NOVA_DAMAGE = 90;
let specialCharge = 0;
combat.onDamage = (amount) => {
  specialCharge = Math.min(1, specialCharge + (amount / NOVA_COST) * ship.stats.specialChargeMul);
};

// ---- Cluster bomblets waiting to go off ----
const bomblets: { x: number; y: number; z: number; t: number }[] = [];
const bombletPos = new THREE.Vector3();
const radar = new Radar($('hud'));

// ?debug in the URL exposes game objects for automated tests and console tinkering.
if (new URLSearchParams(location.search).has('debug')) {
  Object.assign(window, { __game: { get rig() { return rig; }, ship, enemies, enemyShots, missiles, pickups, combat, mortars, save, get base() { return base; }, get run() { return run; }, chargeNova: () => (specialCharge = 1) } });
}

const rig = new CameraRig(window.innerWidth / window.innerHeight);
rig.snapTo(ship.root.position);

// ---------- The run (sortie) ----------
const runUI = new RunUI($('hud'));
let paused = false;
const blips: Blip[] = [];
const contracts = new ContractTracker(scene, world, enemies, hud);
const run = new Run({
  scene,
  effects,
  contracts,
  activeContract: () => save.contracts.active,
  ship,
  enemies,
  world,
  arena: new ArenaVisual(scene),
  ui: runUI,
  hud,
  clearField: () => {
    for (const g of allGuns) g.clear();
    bomblets.length = 0;
    enemyShots.clear();
    mortars.clear();
    missiles.clear();
    pickups.clear();
  },
  snapCamera: () => rig.snapTo(ship.root.position),
  setPaused: (p) => (paused = p),
  resetRunState: () => (specialCharge = 0),
  baseStats: () => {
    const st = defaultStats();
    applyPerks(st, save); // permanent upgrades bought from the Quartermaster
    return st;
  },
  onFinish: (r) => {
    save.salvage += r.salvage;
    if (r.contract?.done && save.contracts.active) {
      // Contract complete: pay out, and the crew member who posted it remembers.
      const c = save.contracts.active;
      save.salvage += c.reward;
      save.contracts.done++;
      save.contracts.byClient[c.client] = (save.contracts.byClient[c.client] ?? 0) + 1;
      save.contracts.active = null;
    }
    save.contracts.offers = rollContracts(); // a fresh board after every sortie
    save.lastRun = { won: r.won, sectors: r.sectorsCleared, kills: r.kills };
    save.runs++;
    if (r.won) save.wins++;
    else save.deaths++;
    writeSave(save);
    runUI.showEnd({ ...r, totalSalvage: save.salvage }, () => runUI.fade(() => goToBase('landed')), 'RETURN TO STATION ▸');
  },
  releaseInput: () => input.releaseAll(),
});

// ---------- Post-processing (HIGH quality) ----------
const composer = new EffectComposer(
  renderer,
  new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }),
);
const renderPass = new RenderPass(scene, rig.camera);
composer.addPass(renderPass);

// ---------- Home base (the space station) ----------
const baseUI = new BaseUI($('hud'));
const base = new HomeBase(save, baseUI, new ConversationUI($('hud')));
type Mode = 'base' | 'run';
let mode: Mode = 'base';
const gunBtn = $('btn-gun');

function setMode(m: Mode): void {
  mode = m;
  document.body.classList.toggle('mode-base', m === 'base');
  renderPass.scene = m === 'base' ? base.scene : scene;
  renderPass.camera = m === 'base' ? base.camera : rig.camera;
  gunBtn.textContent = 'GUN';
  gunBtn.classList.remove('idle');
  input.releaseAll();
}

function goToBase(spawn: 'wake' | 'landed' = 'wake'): void {
  setMode('base');
  base.enter(spawn);
}

// Boarding the ship at the base plays the launch cutscene, then fades into a sortie.
base.onLaunch = () =>
  runUI.fade(() => {
    ship.setDesign(save.ship);
    setMode('run');
    run.start();
  });
// Only colours brighter than 1.2 (glows; not even sunlit white hulls) bloom, so the ground and models stay crisp.
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.35, 0.4, 1.2);
composer.addPass(bloom);

// Developer panel: `?dev` in the URL adds sliders for lighting, shadows, glow and tuning.
let devPanelLoaded = false;
/** Load and show the dev panel (from ?dev, or the switch in the pause menu). */
function showDevPanel(on: boolean): void {
  const el = document.getElementById('dev-panel');
  if (el) el.style.display = on ? '' : 'none';
  if (!on || devPanelLoaded) return;
  devPanelLoaded = true;
  import('./dev/DevPanel').then(({ openDevPanel }) =>
    openDevPanel({
      sun,
      rim,
      scene,
      bloom,
      shadows: sunShadows,
      setCanyonFog: (c, d, h) => world.setCanyonFog(c, d, h),
      isHigh: () => quality === 'high',
    }),
  );
}
if (devModeOn()) showDevPanel(true);

// ---------- Pause menu ----------
const pauseMenu = new PauseMenu($('hud'));
let menuPaused = false;
function openPause(): void {
  if (mode !== 'run' || paused || menuPaused || run.phase === 'over' || run.phase === 'transition') return;
  menuPaused = true;
  input.releaseAll();
  const r = run;
  const active = save.contracts.active;
  pauseMenu.show({
    stats: r.stats,
    armor: ship.armor,
    ship: save.ship,
    levels: r.levels,
    perks: PERKS.map((p) => [p.name, save.perks[p.id] ?? 0, p.costs.length]),
    objective: [...r.objective().split('\n').filter((l) => !l.startsWith('◆')), `LEVEL SEED ${r.seed}`], // the contract gets its own line
    contract: active ? { title: active.title, sector: active.sector, status: contracts.objectiveLine(r.sector)?.replace('◆ ', '') ?? '' } : null,
  });
}
function closePause(): void {
  menuPaused = false;
  pauseMenu.hide();
  input.releaseAll();
}
pauseMenu.pauseButton.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  openPause();
});
pauseMenu.onResume = closePause;
pauseMenu.onDevToggle = (on) => showDevPanel(on);
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' || e.code === 'KeyP') {
    if (menuPaused) closePause();
    else openPause();
  }
});
// Leaving the app (switching apps, locking the phone) pauses a sortie.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) openPause();
});
composer.addPass(new OutputPass());

// ---------- Hit-stop: freeze for a split second on big impacts (Hades does this a lot) ----------
let hitStop = 0;
// Longest frame step. `?dtmax=0.3` (testing only) lets very slow test browsers keep real time.
const MAX_DT = Number(new URLSearchParams(location.search).get('dtmax')) || 1 / 20;
const freeze = (seconds: number) => (hitStop = Math.max(hitStop, seconds));

const input = new Input({
  hud: $('hud'),
  stickZone: $('stick-zone'),
  stickBase: $('stick-base'),
  stickKnob: $('stick-knob'),
  buttons: { gun: $('btn-gun'), missile: $('btn-missile'), boost: $('btn-boost'), special: $('btn-special'), rollL: $('btn-roll-l'), rollR: $('btn-roll-r') },
});

// ---------- Events ----------
// Ramjet upgrade: each boost damages every enemy it passes through, once.
const rammed = new Set<object>();
ship.onBoost = () => {
  rammed.clear();
  rig.kick(12, 0.6);
  input.vibrate(30);
  effects.boostBurst(ship.root.position);
};
ship.onRoll = () => {
  rig.kick(6, 0.4);
  input.vibrate(18);
};
ship.onFullCharge = () => input.vibrate(15);
ship.onMissileEmpty = () => {
  hud.missileEmpty();
  input.vibrate(8);
};
/** The enemy a missile would lock onto right now (closest one near the aim line, within range). */
function missileLock(charge: number, heading: number) {
  const p = ship.root.position;
  return enemies.findInCone(p.x, p.z, heading, missileRange(charge) + MISSILE_LOCK_REACH, MISSILE_LOCK_ANGLE);
}

ship.onMissile = (charge, heading) => {
  const p = ship.root.position;
  if (ship.stats.secondary === 'swarm') {
    // Swarm Rockets: a volley of small homing rockets, one per nearby target (more with charge).
    const count = 3 + Math.round(charge * 3);
    const range = missileRange(charge) + 12;
    const targets = enemies.nearest(p.x, p.z, range, count);
    for (let i = 0; i < count; i++) {
      const t = targets.length ? targets[i % targets.length] : null;
      const spread = heading + (i - (count - 1) / 2) * 0.22;
      missiles.fire(p, spread, 0.12 + charge * 0.2, t);
    }
  } else {
    missiles.fire(p, heading, charge, missileLock(charge, heading));
  }
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
  run.onDeath();
};
pickups.onCollect = (heal) => {
  ship.heal(heal);
  hud.flashHeal();
  input.vibrate(25);
};

missiles.onExplode = (pos, power) => {
  freeze(0.03 + power * 0.04);
  const st = ship.stats;
  const swarm = st.secondary === 'swarm';
  const dmg = missileDamage(power) * st.missileDamageMul * (swarm ? 0.6 : 1);
  enemies.damageAt(pos, missileBlastRadius(power) * st.missileRadiusMul, dmg, (t, amt) => combat.hit(t, amt, 'missile'));
  // Cluster Bomb: the blast throws out 5 bomblets that go off a moment later.
  if (st.secondary === 'cluster') {
    const spreadR = missileBlastRadius(power) * st.missileRadiusMul * 1.7;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + Math.random() * 0.8;
      const r = spreadR * (0.55 + Math.random() * 0.45);
      bomblets.push({ x: pos.x + Math.cos(a) * r, y: pos.y, z: pos.z + Math.sin(a) * r, t: 0.12 + Math.random() * 0.25 });
    }
  }
  rig.kick(0, 0.5 + power * 0.9);
  input.vibrate(25 + Math.round(power * 30));
};
enemies.onKill = (kind, pos, enemy) => {
  run.onKill(kind, enemy);
  combat.onKill(enemy, pos, world.heightAt(pos.x, pos.z));
  // Sometimes a wreck drops a healing orb that floats up to flying height.
  if (Math.random() < enemy.dropChance + ship.stats.dropBonus) {
    enemies.projectToPlane(pos, pickupTarget);
    pickups.drop(pos, pickupTarget);
  }
  const big = kind !== 'drone';
  freeze(big ? 0.08 : 0.05);
  rig.kick(0, big ? 1 : 0.6);
  input.vibrate(30);
};

// ---------- Machine gun ----------
let gunTimer = 0;
let barrel = 0;
const muzzlePos = new THREE.Vector3();
const visualPos = new THREE.Vector3();
const bulletDir = new THREE.Vector3();
const cameraPos = new THREE.Vector3();

function updateGun(dt: number): void {
  const st = ship.stats;
  const weapon = st.primary;
  // Each gun fires at its own pace: machine gun fast, scatter and rail slower but heavier.
  const rate = st.gunRate * (weapon === 'scatter' ? 0.36 : weapon === 'rail' ? 0.2 : 1);
  gunTimer -= dt;
  if (!ship.isFiring || gunTimer > 0) return;
  gunTimer += 1 / rate;
  if (gunTimer < 0) gunTimer = 0;

  ship.getMuzzle(barrel, muzzlePos);
  barrel = 1 - barrel;
  ship.flashMuzzle();

  // Bullets always fly level. Aim assist turns them toward where an enemy appears on screen;
  // hits are judged on screen too (see Bullets.update), so towers below can still be hit.
  const p = ship.root.position;
  let angle = ship.heading;
  const target = enemies.findInCone(p.x, p.z, ship.heading, AIM_ASSIST_RANGE, AIM_ASSIST_ANGLE);
  if (target) {
    const v = enemies.visualPosition(target, visualPos);
    angle = Math.atan2(-(v.x - muzzlePos.x), -(v.z - muzzlePos.z));
  }
  const pool = guns[weapon];
  const fire = (a: number, damage: number) =>
    pool.fire(muzzlePos, bulletDir.set(-Math.sin(a), 0, -Math.cos(a)), damage, ship.velocity);

  if (weapon === 'scatter') {
    // A cone of pellets; Split Shot adds two more per level.
    const pellets = 6 + st.gunSideShots * 2;
    for (let i = 0; i < pellets; i++) {
      const k = pellets === 1 ? 0 : i / (pellets - 1) - 0.5;
      fire(angle + k * 0.56 + (Math.random() - 0.5) * 0.05, st.gunDamage * 0.85);
    }
    rig.kick(0, 0.12);
    return;
  }
  const damage = weapon === 'rail' ? st.gunDamage * 4.5 : st.gunDamage;
  angle += weapon === 'rail' ? 0 : (Math.random() - 0.5) * GUN_SPREAD * 2;
  // Split Shot adds bullets fanned out to each side.
  for (let i = -st.gunSideShots; i <= st.gunSideShots; i++) fire(angle + i * SIDE_SHOT_ANGLE, damage);
  if (weapon === 'rail') rig.kick(0, 0.2);
}

/** Nova: a shockwave around the ship that damages everything nearby and wipes out enemy shots. */
function fireNova(): void {
  const p = ship.root.position;
  const radius = NOVA_RADIUS * ship.stats.novaRadiusMul;
  specialCharge = 0;
  ship.invulnerable = Math.max(ship.invulnerable, 0.6);
  enemyShots.clear();
  mortars.clear();
  enemies.damageAt(p, radius, NOVA_DAMAGE, (t, amt) => combat.hit(t, amt, 'nova'));
  effects.nova(p, radius);
  freeze(0.1);
  rig.kick(10, 1.4);
  input.vibrate(80);
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
  base.setAspect(w / h);
}

function setQuality(q: Quality, remember: boolean): void {
  quality = q;
  sunShadows.enabled = q === 'high'; // real shadows on HIGH; LOW keeps just the blob shadows
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
const rollBtns = [$('btn-roll-l'), $('btn-roll-r')];
const specialBtn = $('btn-special');
const aimLead = new THREE.Vector2();
const camTarget = new THREE.Vector3();
let frames = 0;
let fpsTimer = 0;
let last = performance.now();

/** One step of the sortie's game logic (movement, enemies, shots, effects). */
function simulate(dt: number): void {
  if (paused || menuPaused) dt = 0; // upgrade screen or pause menu is open: the world holds still

  if (!paused && !menuPaused) {
    ship.update(dt, input, world);
    run.update(dt);
    updateGun(dt);
  }
  // Ramjet: damage enemies the ship boosts through.
  if (ship.isBoosting && ship.stats.ramDamage > 0) {
    const p = ship.root.position;
    enemies.forEachNear(p.x, p.z, 3, (e) => {
      if (rammed.has(e)) return;
      rammed.add(e);
      combat.hit(e, ship.stats.ramDamage, 'ram');
      effects.spark(e.root.position, '#6ff7ff', 2);
    });
  }
  missiles.radiusMul = ship.stats.missileRadiusMul;
  combat.update(dt, ship.root.position);
  // Nova button.
  if (input.consumePress('special') && ship.alive && !paused && !menuPaused) {
    if (specialCharge >= 1) fireNova();
    else input.vibrate(8);
  }
  // Cluster bomblets.
  for (let i = bomblets.length - 1; i >= 0; i--) {
    const bm = bomblets[i];
    bm.t -= dt;
    if (bm.t > 0) continue;
    bomblets.splice(i, 1);
    const st = ship.stats;
    bombletPos.set(bm.x, bm.y, bm.z);
    effects.explosion(bombletPos, 2.8 * st.missileRadiusMul, world.heightAt(bm.x, bm.z));
    enemies.damageAt(bombletPos, 3.5 * st.missileRadiusMul, 22 * st.missileDamageMul, (t, amt) => combat.hit(t, amt, 'bomblet'));
    rig.kick(0, 0.2);
  }
  pickups.healMul = ship.stats.healMul;
  enemies.update(dt, ship, enemyShots, mortars, rig.camera);
  mortars.update(dt, ship, (x, z) => world.heightAt(x, z));
  cameraPos.setFromMatrixPosition(rig.camera.matrixWorld);
  for (const g of allGuns) g.update(dt, enemies.enemies, (x, z) => world.heightAt(x, z), cameraPos);
  enemyShots.update(dt, ship, cameraPos.setFromMatrixPosition(rig.camera.matrixWorld));
  pickups.update(dt, ship);
  missiles.update(dt, enemies.enemies, cameraPos.setFromMatrixPosition(rig.camera.matrixWorld));
  if (ship.isBoosting && ship.alive) {
    for (let i = 0; i < 2; i++) effects.trail(ship.getEngine(i, enginePos));
  }
  effects.update(dt, rig.lookTarget);
  aim.update(dt, ship, ship.isCharging ? missileLock(ship.charge, ship.aimHeading) : null);
  world.update(dt);
}

renderer.setAnimationLoop((now: number) => {
  const realDt = Math.min((now - last) / 1000, MAX_DT); // clamp so a hiccup doesn't teleport the ship
  last = now;
  elapsed += realDt;

  // Hit-stop: the world pauses for a moment, but the screen keeps rendering.
  let dt = realDt;
  if (hitStop > 0) {
    hitStop -= realDt;
    dt = realDt * 0.05;
  }

  if (mode === 'base') {
    base.update(realDt, input);
    const label = base.actionLabel;
    if (gunBtn.textContent !== (label ?? 'USE')) gunBtn.textContent = label ?? 'USE';
    gunBtn.classList.toggle('idle', label === null);
    present(realDt);
    return;
  }

  // Very slow test browsers (`?dtmax=`) run the game logic in small steps per frame, so fast
  // things still collide properly; normal play is always one step per frame.
  const steps = MAX_DT > 1 / 20 ? Math.max(1, Math.ceil(dt / (1 / 30))) : 1;
  for (let i = 0; i < steps; i++) simulate(dt / steps);
  if (paused || menuPaused) dt = 0;

  // While charging a missile, lean the camera toward the target so it stays on screen.
  if (ship.isCharging) {
    const r = missileRange(ship.charge) * 0.4;
    aimLead.set(-Math.sin(ship.aimHeading) * r, -Math.cos(ship.aimHeading) * r);
  } else {
    aimLead.set(0, 0);
  }
  rig.update(dt, run.cameraTarget(ship.root.position, camTarget), ship.velocity, aimLead);
  sunShadows.follow(rig.lookTarget.x, rig.lookTarget.z);

  boostBtn.style.setProperty('--cd', String(ship.boostCooldown / ship.stats.boostCooldown));
  for (const b of rollBtns) b.style.setProperty('--cd', String(ship.rollCooldown / TUNING.ship.rollCooldown));
  hud.setArmor(ship.armor, ship.stats.maxArmor);
  hud.setMissiles(ship.missiles, ship.missileRecharge, ship.stats.missileMax);
  hud.setSalvage(run.salvage);
  specialBtn.style.setProperty('--charge', String(specialCharge));
  specialBtn.classList.toggle('ready', specialCharge >= 1);
  hud.setObjective(run.objective());
  run.blips(blips);
  radar.draw(ship.root.position.x, ship.root.position.z, ship.heading, blips, elapsed, { outline: run.shape.outline });
  hud.update(dt);

  present(realDt);
});

/** Draw the frame (base or sortie), then housekeeping: input, fps readout, auto quality. */
function present(realDt: number): void {
  if (quality === 'high') composer.render(realDt);
  else if (mode === 'base') renderer.render(base.scene, base.camera);
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
}

// Go! Start at the station (or straight into a sortie with ?sortie, handy for testing).
if (new URLSearchParams(location.search).has('sortie')) {
  setMode('run');
  run.start();
} else {
  goToBase();
}
