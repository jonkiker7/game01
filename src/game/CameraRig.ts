import * as THREE from 'three';
import { damp } from './math';

const BASE_FOV = 50;
/** Look at a point slightly behind (south of) the ship so the view is balanced in every direction. */
const FOCUS_BEHIND = 7;
const LOOK_AHEAD = 0.3; // seconds of velocity to lead the camera by
const FOLLOW = 5; // how tightly the camera follows (higher = less lag); balanced with LOOK_AHEAD so the ship stays near centre
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
  /** Camera distance multiplier (dev panel): pulls back along the same angle. */
  private distance = 1;
  private aspectK = 1;
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
    this.focus.z += FOCUS_BEHIND;
    this.camera.position.copy(this.focus).add(this.offset);
    this.camera.lookAt(this.focus);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    // Pull back on tall screens so you can still see enough around the ship.
    this.aspectK = aspect < 1 ? 1.6 : 1;
    this.applyOffset();
  }

  /** Move the camera further away (or closer), keeping its angle. 1 = normal. */
  setDistance(d: number): void {
    this.distance = d;
    this.applyOffset();
  }

  private applyOffset(): void {
    const k = this.aspectK * this.distance;
    this.offset.set(0, CAM_HEIGHT * k, CAM_BACK * k);
    this.camera.far = 500 * Math.max(1, this.distance);
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
    this.focus.x = damp(this.focus.x, target.x + velocity.x * LOOK_AHEAD + lx, FOLLOW, dt);
    this.focus.z = damp(this.focus.z, target.z + velocity.y * LOOK_AHEAD + lz + FOCUS_BEHIND, FOLLOW, dt);
    this.focus.y = damp(this.focus.y, target.y, 4, dt); // keep the ship centred at any altitude

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
