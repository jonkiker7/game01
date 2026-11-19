import * as THREE from 'three';
import { glow, rimToon, toon } from '../game/materials';
import { STATION } from './Station';

/**
 * BOLT, the info-desk robot: a hovering retro robot with a CRT screen for a face,
 * a blinking antenna, and little stubby arms.
 */
export class Robot {
  readonly root = new THREE.Group();
  private readonly inner = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly arms: THREE.Object3D[] = [];
  private readonly face: THREE.CanvasTexture;
  private readonly faceCanvas = document.createElement('canvas');
  private readonly antenna: THREE.MeshBasicMaterial;
  private time = Math.random() * 10;
  private blink = 0;

  constructor() {
    const orange = rimToon(STATION.orange, '#ffd9a8', 0.35);
    const cream = rimToon(STATION.cream, '#ffd9a8', 0.3);
    const navy = toon(STATION.navy);

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.85, 0.8, 6, 16), cream);
    body.position.y = 1.9;
    const belly = new THREE.Mesh(new THREE.BoxGeometry(1, 0.5, 0.2), navy);
    belly.position.set(0, 1.9, 0.82);
    const lights = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.14, 0.1), glow(STATION.amber, {}, 1.6));
    lights.position.set(0, 1.9, 0.94);
    // Hover thruster instead of legs.
    const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.7, 0.8, 16), navy);
    skirt.position.y = 0.95;
    skirt.rotation.x = Math.PI;
    const jet = new THREE.Mesh(
      new THREE.ConeGeometry(0.45, 0.9, 12, 1, true),
      glow(STATION.tealGlow, { transparent: true, opacity: 0.6, depthWrite: false }, 1.6),
    );
    jet.position.y = 0.25;
    jet.rotation.x = Math.PI;
    jet.userData.noOutline = true;
    this.root.add(this.inner);
    this.inner.rotation.y = Math.PI;
    this.inner.add(body, belly, lights, skirt, jet);

    for (const s of [-1, 1]) {
      const arm = new THREE.Group();
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.7, 4, 8), orange);
      upper.position.y = -0.4;
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), navy);
      hand.position.y = -0.9;
      arm.add(upper, hand);
      arm.position.set(s * 1, 2.3, 0);
      arm.rotation.z = s * 0.35;
      this.arms.push(arm);
      this.inner.add(arm);
    }

    // Head: an orange TV set with a CRT face.
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.5, 1.4), orange);
    this.faceCanvas.width = 128;
    this.faceCanvas.height = 96;
    this.face = new THREE.CanvasTexture(this.faceCanvas);
    this.face.colorSpace = THREE.SRGBColorSpace;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.45, 1.05), glow('#ffffff', { map: this.face }, 1.15));
    screen.position.z = 0.71;
    screen.userData.noOutline = true;
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.25, 12), navy);
      ear.rotation.z = Math.PI / 2;
      ear.position.x = s * 1.05;
      this.head.add(ear);
    }
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 6), navy);
    stalk.position.y = 1.1;
    this.antenna = glow(STATION.red, {}, 2) as THREE.MeshBasicMaterial;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), this.antenna);
    bulb.position.y = 1.5;
    this.head.add(box, screen, stalk, bulb);
    this.head.position.y = 3.6;
    this.inner.add(this.head);
    this.drawFace(false);
  }

  /** `talking` makes the mouth flap and the arms wave a little. */
  animate(dt: number, talking = false): void {
    this.time += dt;
    const t = this.time;
    this.inner.position.y = 0.35 + Math.sin(t * 2.2) * 0.15;
    this.head.rotation.z = Math.sin(t * 0.9) * 0.08;
    this.head.rotation.y = Math.sin(t * 0.5) * 0.25;
    this.arms[0].rotation.x = Math.sin(t * (talking ? 6 : 1.5)) * (talking ? 0.6 : 0.15);
    this.arms[1].rotation.x = -Math.sin(t * (talking ? 5 : 1.3)) * (talking ? 0.5 : 0.15);
    this.antenna.color.set(Math.sin(t * 4) > 0 ? STATION.red : '#5a1a1a').multiplyScalar(2);
    this.blink -= dt;
    if (this.blink < -3 - Math.random() * 3) this.blink = 0.15;
    this.drawFace(this.blink > 0, talking && Math.sin(t * 18) > 0);
  }

  private drawFace(blinking: boolean, mouthOpen = false): void {
    const g = this.faceCanvas.getContext('2d')!;
    g.fillStyle = '#0d2a1e';
    g.fillRect(0, 0, 128, 96);
    // Scanlines.
    g.fillStyle = 'rgba(125, 255, 154, 0.07)';
    for (let y = 0; y < 96; y += 4) g.fillRect(0, y, 128, 2);
    g.fillStyle = '#7dff9a';
    if (blinking) {
      g.fillRect(30, 38, 20, 5);
      g.fillRect(78, 38, 20, 5);
    } else {
      g.fillRect(32, 26, 16, 22);
      g.fillRect(80, 26, 16, 22);
    }
    if (mouthOpen) g.fillRect(52, 62, 24, 14);
    else g.fillRect(46, 66, 36, 5);
    this.face.needsUpdate = true;
  }
}
