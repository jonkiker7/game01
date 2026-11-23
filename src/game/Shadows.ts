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

/** How much area around the player the shadows cover (bigger = blurrier). */
const AREA = 85;

/**
 * Follows the ship with the sun's shadow camera, so shadows stay sharp wherever you fly
 * (the map is far too big to cover in one shadow map).
 */
export class SunShadows {
  private readonly offset: THREE.Vector3;
  private readonly snap: number;

  constructor(
    private readonly sun: THREE.DirectionalLight,
    scene: THREE.Scene,
  ) {
    this.offset = sun.position.clone();
    scene.add(sun.target);
    const s = sun.shadow;
    s.mapSize.set(2048, 2048);
    const cam = s.camera as THREE.OrthographicCamera;
    cam.left = -AREA;
    cam.right = AREA;
    cam.top = AREA;
    cam.bottom = -AREA;
    cam.near = 1;
    cam.far = 260;
    cam.updateProjectionMatrix();
    s.bias = -0.0006;
    s.normalBias = 0.6;
    // Move in whole shadow-map texels so the edges don't shimmer as you fly.
    this.snap = (AREA * 2) / s.mapSize.x;
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
    const sz = Math.round(z / this.snap) * this.snap;
    this.sun.target.position.set(sx, 0, sz);
    this.sun.position.set(sx + this.offset.x, this.offset.y, sz + this.offset.z);
  }
}
