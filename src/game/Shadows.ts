import * as THREE from 'three';

/**
 * Real-time shadows (HIGH quality only). The sun casts shadows from things standing on the
 * ground (trees, plants, rocks, towers, ground enemies, the tank and titan bosses) onto the
 * ground. Flying things don't cast real shadows: at flying height the sun would throw them far
 * to the side, so they keep the blob shadow straight underneath, which helps you aim.
 */

/** Make every solid, toon-shaded mesh under `root` cast a shadow (skips outlines and glows). */
export function castShadows(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || o.userData.isOutline || o.userData.noCast) return;
    const mat = m.material as THREE.Material;
    if (!(mat instanceof THREE.MeshToonMaterial) || mat.transparent) return;
    m.castShadow = true;
  });
}

/** Half the width of the shadowed area (bigger = covers more of the screen, but blurrier). */
const AREA = 190;
/**
 * The camera tilts forward, so it sees far more ground ahead (up the screen) than behind:
 * the shadowed area is shifted forward to match.
 */
const AHEAD = 45;

/**
 * Follows the ship with the sun's shadow camera, so shadows stay sharp wherever you fly
 * (the map is far too big to cover in one shadow map).
 */
export class SunShadows {
  private readonly offset: THREE.Vector3;
  private snap: number;

  constructor(
    private readonly sun: THREE.DirectionalLight,
    scene: THREE.Scene,
  ) {
    // Keep the sun far back along its direction so tall things at the far edges still fit.
    this.offset = sun.position.clone().setLength(260);
    scene.add(sun.target);
    const s = sun.shadow;
    s.mapSize.set(2048, 2048);
    const cam = s.camera as THREE.OrthographicCamera;
    cam.near = 20;
    cam.far = 520;
    s.bias = -0.0006;
    s.normalBias = 0.6;
    this.snap = 0;
    this.area = AREA;
  }

  /** Half-width of the shadowed area, in world units. */
  set area(half: number) {
    const cam = this.sun.shadow.camera as THREE.OrthographicCamera;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.updateProjectionMatrix();
    // Move in whole shadow-map texels so the edges don't shimmer as you fly.
    this.snap = (half * 2) / this.sun.shadow.mapSize.x;
  }

  /** Sun direction: compass angle (degrees, 0 = from the south) and height above the horizon. */
  setDirection(azimuth: number, elevation: number): void {
    const len = this.offset.length();
    const az = THREE.MathUtils.degToRad(azimuth);
    const el = THREE.MathUtils.degToRad(elevation);
    this.offset.set(Math.cos(el) * Math.sin(az) * len, Math.sin(el) * len, Math.cos(el) * Math.cos(az) * len);
  }

  /** Direction from the ground toward the sun. */
  get toSun(): THREE.Vector3 {
    return this.offset.clone();
  }

  set enabled(on: boolean) {
    this.sun.castShadow = on;
  }

  /** How dark shadows are (0 = invisible, 1 = fully dark). */
  set darkness(v: number) {
    (this.sun.shadow as THREE.LightShadow & { intensity: number }).intensity = v;
  }

  follow(x: number, z: number): void {
    const sx = Math.round(x / this.snap) * this.snap;
    const sz = Math.round((z - AHEAD) / this.snap) * this.snap;
    this.sun.target.position.set(sx, 0, sz);
    this.sun.position.set(sx + this.offset.x, this.offset.y, sz + this.offset.z);
  }
}

// ---------------------------------------------------------------- baked shadows

/**
 * How shadows are drawn:
 * - baked: the arena's terrain, trees and rocks never move, so their shadows are worked out
 *   once when the arena is built (a single render from the sun into a depth texture the
 *   ground reads). Only moving things (ground enemies, bosses, mission objects) still go
 *   through the live shadow pass, which makes that pass far cheaper.
 * - live: everything is redrawn into the shadow map every frame (the old way).
 * - off: no shadows at all.
 */
export type ShadowMode = 'baked' | 'live' | 'off';

const BAKE_SIZE = 2048;

export class ShadowBaker {
  /** Shared by every ground material this baker patches. */
  readonly uniforms = {
    bakeMap: { value: null as THREE.Texture | null },
    bakeMatrix: { value: new THREE.Matrix4() },
    bakeStrength: { value: 0.85 },
    bakeTexel: { value: 1 / BAKE_SIZE },
    bakeBias: { value: 0.0025 },
  };
  private readonly target: THREE.WebGLRenderTarget;
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 900);
  private readonly depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
  private readonly temp = new THREE.Scene();
  /** How long the last bake took (ms), for the performance panel. */
  lastBakeMs = 0;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    const depth = new THREE.DepthTexture(BAKE_SIZE, BAKE_SIZE);
    this.target = new THREE.WebGLRenderTarget(BAKE_SIZE, BAKE_SIZE, { depthTexture: depth, depthBuffer: true });
    this.uniforms.bakeMap.value = depth;
    this.temp.overrideMaterial = this.depthOnly;
  }

  /** Strength of baked shadows (0 = none, 1 = no sunlight at all in the shade). */
  set strength(v: number) {
    this.uniforms.bakeStrength.value = v;
  }

  /**
   * Render the static casters under `root` (meshes flagged `userData.bakeCaster`) from the sun.
   * `toSun` points from the ground toward the sun; `area` is the ground to cover.
   */
  bake(root: THREE.Object3D, toSun: THREE.Vector3, area: { x0: number; z0: number; x1: number; z1: number }): void {
    const t0 = performance.now();
    const cx = (area.x0 + area.x1) / 2;
    const cz = (area.z0 + area.z1) / 2;
    const half = Math.hypot(area.x1 - area.x0, area.z1 - area.z0) / 2;
    const cam = this.cam;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.position.set(cx, 0, cz).addScaledVector(toSun.clone().normalize(), 420);
    cam.lookAt(cx, 0, cz);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    this.uniforms.bakeMatrix.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);

    // Only the static casters go into the bake.
    const hidden: THREE.Object3D[] = [];
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.visible && !o.userData.bakeCaster) {
        o.visible = false;
        hidden.push(o);
      }
    });
    const parent = root.parent;
    this.temp.add(root);
    const prevTarget = this.renderer.getRenderTarget();
    const prevAuto = this.renderer.shadowMap.autoUpdate;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.setRenderTarget(this.target);
    this.renderer.clear();
    this.renderer.render(this.temp, cam);
    this.renderer.setRenderTarget(prevTarget);
    this.renderer.shadowMap.autoUpdate = prevAuto;
    parent?.add(root);
    for (const o of hidden) o.visible = true;
    this.lastBakeMs = performance.now() - t0;
  }

  /** Make a ground material darken where the baked shadow map says the sun is blocked. */
  patch(mat: THREE.Material): void {
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform mat4 bakeMatrix;\nvarying vec4 vBakePos;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvBakePos = bakeMatrix * modelMatrix * vec4(transformed, 1.0);');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform sampler2D bakeMap;\nuniform float bakeStrength;\nuniform float bakeTexel;\nuniform float bakeBias;\nvarying vec4 vBakePos;',
        )
        .replace(
          '#include <lights_fragment_end>',
          `#include <lights_fragment_end>
          if (bakeStrength > 0.0) {
            vec3 bp = vBakePos.xyz / vBakePos.w * 0.5 + 0.5;
            float lit = 1.0;
            if (bp.x > 0.0 && bp.x < 1.0 && bp.y > 0.0 && bp.y < 1.0) {
              lit = 0.0;
              for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++)
                lit += step(bp.z - bakeBias, texture2D(bakeMap, bp.xy + vec2(float(i), float(j)) * bakeTexel).r);
              lit /= 9.0;
            }
            reflectedLight.directDiffuse *= mix(1.0 - bakeStrength, 1.0, lit);
          }`,
        );
    };
    mat.customProgramCacheKey = () => 'baked-ground';
    mat.needsUpdate = true;
  }
}
