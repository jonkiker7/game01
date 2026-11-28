import GUI from 'lil-gui';
import * as THREE from 'three';
import type { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { Halos } from '../game/Halos';
import type { ShadowMode, SunShadows } from '../game/Shadows';
import { TUNING } from '../game/Tuning';
import { sameValue } from '../game/Choices';
import { CAMERA_DISTANCE } from '../game/CameraRig';
import { DEFAULT_ENEMY_PALETTE, ENEMY_PALETTES, type EnemyPalette, setEnemyPalette } from '../game/EnemyBase';
import { BIOME_FOG, BIOME_FOG_DENSITY, BIOME_FOG_HEIGHT, type Biome } from '../game/World';

/**
 * Developer panel (open the game with `?dev`): sliders for lighting, shadows, fog, glow, the
 * vignette, and some gameplay numbers. Changes apply live and are remembered on this device
 * (only while `?dev` is on). "Copy settings" puts them on the clipboard so they can be made
 * the game's defaults.
 */

export interface DevHooks {
  sun: THREE.DirectionalLight;
  rim: THREE.DirectionalLight;
  scene: THREE.Scene;
  bloom: UnrealBloomPass;
  shadows: SunShadows;
  /** Canyon fog (each planet's colour, density 0..1, height 0..1 of the canyon depth). */
  setCanyonFog: (colors: Record<Biome, string>, densities: Record<Biome, number>, heights: Record<Biome, number>) => void;
  /** Which planet you're on (the fog colour shown is that planet's). */
  getBiome: () => Biome;
  /** Whether HIGH quality is on (real shadows only exist on HIGH). */
  isHigh: () => boolean;
  /** Shadow mode (baked / live / off) and strength 0..1. */
  setShadows: (mode: ShadowMode, strength: number) => void;
  getShadowMode: () => ShadowMode;
  /** Re-bake the arena's shadows (after the sun moves). */
  rebake: () => void;
  /** Live numbers for the Performance section. */
  perf: { fps: number; frameMs: number; cpuMs: number; drawCalls: number; triangles: number; bakeMs: number };
  setQuality: (q: 'high' | 'low') => void;
  getQuality: () => 'high' | 'low';
  setResScale: (v: number) => void;
  setOutlines: (on: boolean) => void;
  /** Glow: 'auto' (full bloom on HIGH, halos on LOW), 'full', 'light', 'halos' or 'off'. */
  setGlow: (g: 'auto' | 'full' | 'light' | 'halos' | 'off') => void;
  getGlow: () => 'auto' | 'full' | 'light' | 'halos' | 'off';
  halos: Halos;
  setProps: (on: boolean) => void;
  /** Camera distance multiplier (1 = normal). */
  setCameraDistance: (d: number) => void;
  /** Jump to the start of a planet (starting a sortie first if at the station). */
  skipTo: (planet: 'desert' | 'ice') => void;
  /** Open the on-screen control layout editor. */
  editControls: () => void;
  /** Wipe salvage and Rook's permanent upgrades (for testing). */
  resetProgress: () => void;
}

const KEY = 'star-rotor-dev';

/** Current defaults (must match the game's starting values). */
const LOOK_DEFAULTS = {
  sunIntensity: 4.25,
  sunColor: '#ffffff',
  sunAngle: 79, // compass direction the sunlight comes from
  sunHeight: 31, // degrees above the horizon (lower = longer shadows)
  rimLight: 2.8,
  shadowMode: 'baked' as ShadowMode,
  shadowDarkness: 1,
  shadowArea: 190,
  glowStrength: 0.35,
  glowSpread: 0.4,
  glowThreshold: 1.2,
  haloStrength: 0.8,
  vignette: 0.9,
  canyonFogColor: BIOME_FOG.jungle, // the jungle's
  desertFogColor: BIOME_FOG.desert,
  iceFogColor: BIOME_FOG.ice,
  jungleFogDensity: BIOME_FOG_DENSITY.jungle,
  desertFogDensity: BIOME_FOG_DENSITY.desert,
  iceFogDensity: BIOME_FOG_DENSITY.ice,
  jungleFogHeight: BIOME_FOG_HEIGHT.jungle,
  desertFogHeight: BIOME_FOG_HEIGHT.desert,
  iceFogHeight: BIOME_FOG_HEIGHT.ice,
  vignetteSize: 62,
  cameraDistance: CAMERA_DISTANCE,
  enemyColors: DEFAULT_ENEMY_PALETTE as EnemyPalette,
};

type Look = typeof LOOK_DEFAULTS;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const TUNING_DEFAULTS = clone(TUNING);

export function openDevPanel(h: DevHooks): void {
  const look: Look = { ...LOOK_DEFAULTS, shadowMode: h.getShadowMode() };
  // Restore what was set last time on this device: each value only while the game's default
  // for it is still the one it replaced (a newer default wins). Saves from before defaults were
  // recorded are out of date, so they're skipped.
  try {
    type Saved = { look?: Partial<Look>; tuning?: typeof TUNING; defaults?: { look?: Partial<Look>; tuning?: typeof TUNING } };
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Saved | null;
    const was = saved?.defaults;
    if (saved?.look && was?.look) {
      for (const k of Object.keys(LOOK_DEFAULTS) as (keyof Look)[]) {
        if (k === 'shadowMode' || !(k in saved.look)) continue; // the game remembers the shadow mode itself
        if (sameValue(was.look[k], LOOK_DEFAULTS[k])) (look as Record<string, unknown>)[k] = saved.look[k];
      }
    }
    if (saved?.tuning && was?.tuning) {
      for (const g of Object.keys(TUNING) as (keyof typeof TUNING)[]) {
        const mine = saved.tuning[g] as Record<string, number> | undefined;
        const old = was.tuning[g] as Record<string, number> | undefined;
        const now = TUNING_DEFAULTS[g] as Record<string, number>;
        if (!mine || !old) continue;
        for (const k of Object.keys(now)) if (k in mine && sameValue(old[k], now[k])) (TUNING[g] as Record<string, number>)[k] = mine[k];
      }
    }
  } catch {
    /* ignore a broken save */
  }

  let lastShadow = '';
  let lastSun = '';
  const apply = () => {
    h.sun.intensity = look.sunIntensity;
    h.sun.color.set(look.sunColor);
    h.shadows.setDirection(look.sunAngle, look.sunHeight);
    h.rim.intensity = look.rimLight;
    h.shadows.area = look.shadowArea;
    // Shadows re-bake only when something that affects them changed (baking takes a moment).
    const shadowKey = `${look.shadowMode}|${look.shadowDarkness}`;
    const sunKey = `${look.sunAngle}|${look.sunHeight}`;
    if (shadowKey !== lastShadow) h.setShadows(look.shadowMode, look.shadowDarkness);
    else if (sunKey !== lastSun) h.rebake();
    lastShadow = shadowKey;
    lastSun = sunKey;
    h.bloom.strength = look.glowStrength;
    h.bloom.radius = look.glowSpread;
    h.bloom.threshold = look.glowThreshold;
    h.halos.strength = look.haloStrength;
    h.setCanyonFog(
      { jungle: look.canyonFogColor, desert: look.desertFogColor, ice: look.iceFogColor },
      { jungle: look.jungleFogDensity, desert: look.desertFogDensity, ice: look.iceFogDensity },
      { jungle: look.jungleFogHeight, desert: look.desertFogHeight, ice: look.iceFogHeight },
    );
    h.setCameraDistance(look.cameraDistance);
    setEnemyPalette(look.enemyColors);
    const root = document.documentElement.style;
    root.setProperty('--vig', String(look.vignette));
    root.setProperty('--vig-size', `${look.vignetteSize}%`);
  };
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ look, tuning: TUNING, defaults: { look: LOOK_DEFAULTS, tuning: TUNING_DEFAULTS } }));
    } catch {
      /* private mode */
    }
  };
  const changed = () => {
    apply();
    save();
  };

  // Our own fixed box on the left of the screen (lil-gui's default placement is top-centre/right).
  const box = document.createElement('div');
  box.id = 'dev-panel';
  document.body.appendChild(box);
  const gui = new GUI({ title: 'DEV', container: box, width: 250 });
  gui.close();

  const light = gui.addFolder('Lighting');
  light.add(look, 'sunIntensity', 0, 5, 0.05).name('sun brightness').onChange(changed);
  light.addColor(look, 'sunColor').name('sun colour').onChange(changed);
  light.add(look, 'sunAngle', -180, 180, 1).name('sun direction °').onChange(changed);
  light.add(look, 'sunHeight', 15, 89, 1).name('sun height °').onChange(changed);
  light.add(look, 'rimLight', 0, 3, 0.05).name('blue rim light').onChange(changed);

  const enemyF = gui.addFolder('Enemies');
  enemyF
    .add(look, 'enemyColors', Object.keys(ENEMY_PALETTES))
    .name('colours (new enemies)')
    .onChange(changed);

  const camF = gui.addFolder('Camera');
  camF.add(look, 'cameraDistance', 0.7, 3, 0.05).name('camera distance ×').onChange(changed);

  const shade = gui.addFolder('Shadows');
  shade.add(look, 'shadowMode', { 'baked (terrain once per arena)': 'baked', 'live (all, every frame)': 'live', off: 'off' }).name('mode').onChange(changed);
  shade.add(look, 'shadowDarkness', 0, 1, 0.05).name('darkness').onChange(changed);
  shade.add(look, 'shadowArea', 60, 250, 5).name('live area (bigger = blurrier)').onChange(changed);

  // ---- Performance: live numbers, and switches to see what each feature costs (not saved).
  const perfF = gui.addFolder('Performance');
  const p = h.perf;
  perfF.add(p, 'fps').name('fps').listen().disable();
  perfF.add(p, 'frameMs').name('frame time ms').listen().disable();
  perfF.add(p, 'cpuMs').name('game code ms').listen().disable();
  perfF.add(p, 'drawCalls').name('draw calls').listen().disable();
  perfF.add(p, 'triangles').name('triangles').listen().disable();
  perfF.add(p, 'bakeMs').name('last shadow bake ms').listen().disable();
  const sw = { quality: h.getQuality(), glow: h.getGlow(), outlines: true, plants: true, resolution: 1 };
  perfF.add(sw, 'quality', { HIGH: 'high', LOW: 'low' }).name('quality').onChange((q: 'high' | 'low') => h.setQuality(q));
  perfF
    .add(sw, 'glow', {
      'auto (full on HIGH, halos on LOW)': 'auto',
      'full bloom': 'full',
      'light bloom (½ res)': 'light',
      'halos (no post-processing)': 'halos',
      off: 'off',
    })
    .name('glow (saved)')
    .onChange((g: 'auto' | 'full' | 'light' | 'halos' | 'off') => h.setGlow(g));

  perfF.add(sw, 'outlines').name('ink outlines').onChange((on: boolean) => h.setOutlines(on));
  perfF.add(sw, 'plants').name('trees, plants, rocks').onChange((on: boolean) => h.setProps(on));
  perfF.add(sw, 'resolution', 0.4, 1, 0.05).name('resolution ×').onChange((v: number) => h.setResScale(v));
  // New enemies come with outlines: keep them hidden while the switch is off.
  setInterval(() => {
    if (!sw.outlines) h.setOutlines(false);
  }, 1000);

  const canyon = gui.addFolder('Canyon fog');
  // One colour, density and height (0 = floor, 1 = rim) per planet: only the planet you're on's show.
  const fogColor: Record<Biome, ReturnType<typeof canyon.addColor>> = {
    jungle: canyon.addColor(look, 'canyonFogColor').name('colour (jungle)').onChange(changed),
    desert: canyon.addColor(look, 'desertFogColor').name('colour (desert)').onChange(changed),
    ice: canyon.addColor(look, 'iceFogColor').name('colour (ice)').onChange(changed),
  };
  let shownBiome: Biome | null = null;
  const showFog = () => {
    const b = h.getBiome();
    if (b === shownBiome) return;
    shownBiome = b;
    for (const k of Object.keys(fogColor) as Biome[]) {
      fogColor[k].show(k === b);
      fogDensity[k].show(k === b);
      fogHeight[k].show(k === b);
    }
    canyon.title(`Canyon fog: ${b} planet`);
  };
  const fogDensity: Record<Biome, ReturnType<typeof canyon.add>> = {
    jungle: canyon.add(look, 'jungleFogDensity', 0, 0.6, 0.01).name('density (jungle)').onChange(changed),
    desert: canyon.add(look, 'desertFogDensity', 0, 0.6, 0.01).name('density (desert)').onChange(changed),
    ice: canyon.add(look, 'iceFogDensity', 0, 0.6, 0.01).name('density (ice)').onChange(changed),
  };
  const fogHeight: Record<Biome, ReturnType<typeof canyon.add>> = {
    jungle: canyon.add(look, 'jungleFogHeight', 0, 1, 0.01).name('height (jungle)').onChange(changed),
    desert: canyon.add(look, 'desertFogHeight', 0, 1, 0.01).name('height (desert)').onChange(changed),
    ice: canyon.add(look, 'iceFogHeight', 0, 1, 0.01).name('height (ice)').onChange(changed),
  };
  showFog();
  setInterval(showFog, 500);

  const post = gui.addFolder('Glow and vignette');
  post.add(look, 'glowStrength', 0, 3, 0.05).name('glow strength').onChange(changed);
  post.add(look, 'glowSpread', 0, 1, 0.05).name('glow spread').onChange(changed);
  post.add(look, 'glowThreshold', 0, 3, 0.05).name('glow threshold').onChange(changed);
  post.add(look, 'haloStrength', 0, 2, 0.05).name('halo strength (halos mode)').onChange(changed);
  post.add(look, 'vignette', 0, 1, 0.05).name('vignette strength').onChange(changed);
  post.add(look, 'vignetteSize', 0, 90, 1).name('vignette clear centre %').onChange(changed);

  const play = gui.addFolder('Gameplay');
  play.close();
  const ship = play.addFolder('Ship');
  ship.add(TUNING.ship, 'maxSpeed', 10, 120, 1).name('top speed').onChange(changed);
  ship.add(TUNING.ship, 'boostSpeed', 40, 300, 5).name('boost speed').onChange(changed);
  ship.add(TUNING.ship, 'rollSpeed', 20, 200, 5).name('roll speed').onChange(changed);
  ship.add(TUNING.ship, 'rollCooldown', 0.1, 3, 0.05).name('roll cooldown s').onChange(changed);
  const sc = play.addFolder('Score');
  sc.add(TUNING.score, 'perDamage', 0, 5, 0.1).name('points per damage').onChange(changed);
  sc.add(TUNING.score, 'perSecond', 0, 100, 1).name('time bonus per second').onChange(changed);
  sc.add(TUNING.score, 'clear', 0, 5000, 50).name('mission clear bonus').onChange(changed);
  sc.add(TUNING.score, 'bossClear', 0, 10000, 100).name('boss clear bonus').onChange(changed);
  sc.add(TUNING.score, 'protect', 0, 5000, 50).name('protect bonus (full health)').onChange(changed);
  const pul = play.addFolder('Pulsars');
  pul.add(TUNING.pulsar, 'arms', 1, 4, 1).name('spiral arms').onChange(changed);
  pul.add(TUNING.pulsar, 'volleyGap', 0.08, 0.6, 0.01).name('seconds between orbs').onChange(changed);
  pul.add(TUNING.pulsar, 'minDamage', 0, 10, 0.5).name('damage when clustered').onChange(changed);
  pul.add(TUNING.pulsar, 'maxDamage', 0, 10, 0.5).name('damage when spread out').onChange(changed);
  pul.add(TUNING.pulsar, 'fullDamageSpacing', 5, 150, 5).name('spacing for full damage').onChange(changed);
  const nova = play.addFolder('Nova');
  nova.add(TUNING.nova, 'cooldown', 1, 30, 0.5).name('cooldown s').onChange(changed);
  nova.add(TUNING.nova, 'damagePerSecond', 20, 1000, 10).name('damage per second off').onChange(changed);
  const bombs = play.addFolder('Tower bombs');
  bombs.add(TUNING.towerBombs, 'speed', 5, 100, 1).name('speed').onChange(changed);
  bombs.add(TUNING.towerBombs, 'radius', 3, 40, 0.5).name('blast radius').onChange(changed);
  bombs.add(TUNING.towerBombs, 'damage', 0, 50, 1).name('damage').onChange(changed);
  const swarm = play.addFolder('Swarmers');
  swarm.add(TUNING.swarmers, 'chaseSpeed', 5, 60, 1).name('chase speed').onChange(changed);
  swarm.add(TUNING.swarmers, 'windup', 0.1, 2, 0.05).name('warning before dive s').onChange(changed);
  swarm.add(TUNING.swarmers, 'diveSpeed', 10, 120, 1).name('dive speed').onChange(changed);
  swarm.add(TUNING.swarmers, 'damage', 0, 30, 1).name('damage').onChange(changed);
  swarm.add(TUNING.swarmers, 'restMin', 0.2, 6, 0.1).name('rest between dives s').onChange(changed);

  const skip = gui.addFolder('Skip to');
  skip.add({ desert: () => h.skipTo('desert') }, 'desert').name('🏜 Start of the desert');
  skip.add({ ice: () => h.skipTo('ice') }, 'ice').name('❄ Start of the ice planet');
  gui.add({ edit: () => h.editControls() }, 'edit').name('🎮 Edit control layout');
  gui
    .add(
      {
        copy: () => {
          const text = JSON.stringify({ look, tuning: TUNING }, null, 2);
          navigator.clipboard?.writeText(text).then(
            () => alert('Settings copied. Paste them to Claude to make them the defaults.'),
            () => prompt('Copy these settings:', text),
          ) ?? prompt('Copy these settings:', text);
        },
      },
      'copy',
    )
    .name('📋 Copy settings');
  gui
    .add(
      {
        reset: () => {
          if (!confirm('Reset all dev settings to the defaults?')) return;
          Object.assign(look, LOOK_DEFAULTS);
          for (const k of Object.keys(TUNING) as (keyof typeof TUNING)[]) Object.assign(TUNING[k], TUNING_DEFAULTS[k]);
          gui.controllersRecursive().forEach((c) => c.updateDisplay());
          changed();
        },
      },
      'reset',
    )
    .name('↺ Reset to defaults');
  gui
    .add(
      {
        wipe: () => {
          if (!confirm('Reset your salvage to 0 and remove all of Rook\'s upgrades?')) return;
          h.resetProgress();
        },
      },
      'wipe',
    )
    .name('⚠ Reset salvage & upgrades');

  // Keep shadows in step with the quality setting (tap the fps counter to switch).
  let wasHigh = h.isHigh();
  window.setInterval(() => {
    if (h.isHigh() !== wasHigh) {
      wasHigh = h.isHigh();
      apply();
    }
  }, 500);

  apply();
}
