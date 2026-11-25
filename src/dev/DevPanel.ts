import GUI from 'lil-gui';
import * as THREE from 'three';
import type { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { SunShadows } from '../game/Shadows';
import { TUNING } from '../game/Tuning';
import { CANYON_FOG } from '../game/World';

/**
 * Developer panel (open the game with `?dev`): sliders for lighting, shadows, fog, glow, the
 * vignette, and some gameplay numbers. Changes apply live and are remembered on this device
 * (only while `?dev` is on). "Copy settings" puts them on the clipboard so they can be made
 * the game's defaults.
 */

export interface DevHooks {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  rim: THREE.DirectionalLight;
  scene: THREE.Scene;
  bloom: UnrealBloomPass;
  shadows: SunShadows;
  /** Canyon fog (colour, density 0..1, height 0..1 of the canyon depth). */
  setCanyonFog: (color: string, density: number, height: number) => void;
  /** Whether HIGH quality is on (real shadows only exist on HIGH). */
  isHigh: () => boolean;
}

const KEY = 'star-rotor-dev';

/** Current defaults (must match the game's starting values). */
const LOOK_DEFAULTS = {
  sunIntensity: 4.25,
  sunColor: '#ffdcc4',
  sunAngle: 79, // compass direction the sunlight comes from
  sunHeight: 57, // degrees above the horizon (lower = longer shadows)
  skyLight: 0.8,
  rimLight: 0.9,
  fogStart: 80,
  fogEnd: 285,
  shadows: true,
  shadowDarkness: 1,
  shadowArea: 150,
  glowStrength: 0.75,
  glowSpread: 0.45,
  glowThreshold: 1.2,
  vignette: 0.7,
  canyonFogColor: CANYON_FOG.color,
  canyonFogDensity: CANYON_FOG.density,
  canyonFogHeight: CANYON_FOG.height,
  vignetteSize: 52,
};

type Look = typeof LOOK_DEFAULTS;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const TUNING_DEFAULTS = clone(TUNING);

export function openDevPanel(h: DevHooks): void {
  const look: Look = { ...LOOK_DEFAULTS };
  // Restore what was set last time on this device.
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { look?: Partial<Look>; tuning?: typeof TUNING } | null;
    if (saved?.look) Object.assign(look, saved.look);
    if (saved?.tuning) for (const k of Object.keys(TUNING) as (keyof typeof TUNING)[]) Object.assign(TUNING[k], saved.tuning[k] ?? {});
  } catch {
    /* ignore a broken save */
  }

  const apply = () => {
    h.sun.intensity = look.sunIntensity;
    h.sun.color.set(look.sunColor);
    h.shadows.setDirection(look.sunAngle, look.sunHeight);
    h.hemi.intensity = look.skyLight;
    h.rim.intensity = look.rimLight;
    const fog = h.scene.fog as THREE.Fog;
    fog.near = look.fogStart;
    fog.far = look.fogEnd;
    h.shadows.enabled = look.shadows && h.isHigh();
    h.shadows.darkness = look.shadowDarkness;
    h.shadows.area = look.shadowArea;
    h.bloom.strength = look.glowStrength;
    h.bloom.radius = look.glowSpread;
    h.bloom.threshold = look.glowThreshold;
    h.setCanyonFog(look.canyonFogColor, look.canyonFogDensity, look.canyonFogHeight);
    const root = document.documentElement.style;
    root.setProperty('--vig', String(look.vignette));
    root.setProperty('--vig-size', `${look.vignetteSize}%`);
  };
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ look, tuning: TUNING }));
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
  light.add(look, 'skyLight', 0, 3, 0.05).name('sky fill light').onChange(changed);
  light.add(look, 'rimLight', 0, 3, 0.05).name('blue rim light').onChange(changed);
  light.add(look, 'fogStart', 20, 400, 5).name('fog start').onChange(changed);
  light.add(look, 'fogEnd', 60, 800, 5).name('fog end').onChange(changed);

  const shade = gui.addFolder('Shadows (HIGH quality)');
  shade.add(look, 'shadows').name('on').onChange(changed);
  shade.add(look, 'shadowDarkness', 0, 1, 0.05).name('darkness').onChange(changed);
  shade.add(look, 'shadowArea', 60, 250, 5).name('area (bigger = blurrier)').onChange(changed);

  const canyon = gui.addFolder('Canyon fog');
  canyon.addColor(look, 'canyonFogColor').name('colour').onChange(changed);
  canyon.add(look, 'canyonFogDensity', 0, 0.6, 0.01).name('density').onChange(changed);
  canyon.add(look, 'canyonFogHeight', 0, 1, 0.01).name('height (0 = floor, 1 = rim)').onChange(changed);

  const post = gui.addFolder('Glow and vignette');
  post.add(look, 'glowStrength', 0, 3, 0.05).name('glow strength').onChange(changed);
  post.add(look, 'glowSpread', 0, 1, 0.05).name('glow spread').onChange(changed);
  post.add(look, 'glowThreshold', 0, 3, 0.05).name('glow threshold').onChange(changed);
  post.add(look, 'vignette', 0, 1, 0.05).name('vignette strength').onChange(changed);
  post.add(look, 'vignetteSize', 0, 90, 1).name('vignette clear centre %').onChange(changed);

  const play = gui.addFolder('Gameplay');
  play.close();
  const ship = play.addFolder('Ship');
  ship.add(TUNING.ship, 'maxSpeed', 10, 120, 1).name('top speed').onChange(changed);
  ship.add(TUNING.ship, 'boostSpeed', 40, 300, 5).name('boost speed').onChange(changed);
  ship.add(TUNING.ship, 'rollSpeed', 20, 200, 5).name('roll speed').onChange(changed);
  ship.add(TUNING.ship, 'rollCooldown', 0.1, 3, 0.05).name('roll cooldown s').onChange(changed);
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
