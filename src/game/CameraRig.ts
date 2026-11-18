import * as THREE from 'three';
import { damp } from './math';

const BASE_FOV = 45;
const LOOK_AHEAD = 0.45; // seconds of velocity to lead the camera by
const CAM_HEIGHT = 44; // camera height above the ship's focus point
const CAM_BACK = 30; // and how far behind (south of) it

/**
 * Angled top-down camera (a 3/4 view) that follows the ship, leads slightly in
 * the direction of travel, and supports FOV kicks + screen shake.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private readonly focus = new THREE.Vector3();
  private readonly offset = new THREE.Vector3(0, CAM_HEIGHT, CAM_BACK);
  private fovKick = 0;
  private shake = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, aspect, 1, 500);
  }

  /** The point on the ground the camera is looking at. */
  get lookTarget(): THREE.Vector3 {
    return this.focus;
  }

  snapTo(target: THREE.Vector3): void {
    this.focus.copy(target);
    this.camera.position.copy(this.focus).add(this.offset);
    this.camera.lookAt(this.focus);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    // Pull back on tall screens so you can still see enough around the ship.
    const k = aspect < 1 ? 1.6 : 1;
    this.offset.set(0, CAM_HEIGHT * k, CAM_BACK * k);
    this.camera.updateProjectionMatrix();
  }

  /** Punchy feedback for boosts, explosions, hits. */
  kick(fov: number, shake: number): void {
    this.fovKick = Math.max(this.fovKick, fov);
    this.shake = Math.max(this.shake, shake);
  }

  /**
   * @param lead extra offset (x, z) to look toward, e.g. the missile target while aiming
   */
  update(dt: number, target: THREE.Vector3, velocity: THREE.Vector2, lead?: THREE.Vector2): void {
    const lx = lead?.x ?? 0;
    const lz = lead?.y ?? 0;
    this.focus.x = damp(this.focus.x, target.x + velocity.x * LOOK_AHEAD + lx, 4, dt);
    this.focus.z = damp(this.focus.z, target.z + velocity.y * LOOK_AHEAD + lz, 4, dt);
    this.focus.y = damp(this.focus.y, target.y * 0.5, 4, dt);

    this.camera.position.copy(this.focus).add(this.offset);
    if (this.shake > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.camera.position.z += (Math.random() - 0.5) * this.shake;
    }
    this.camera.lookAt(this.focus);
    this.shake = damp(this.shake, 0, 8, dt);

    this.fovKick = damp(this.fovKick, 0, 5, dt);
    this.camera.fov = BASE_FOV + this.fovKick;
    this.camera.updateProjectionMatrix();
  }
}
