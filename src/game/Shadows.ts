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
const AREA = 150;
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
