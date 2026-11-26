import * as THREE from 'three';
import { Pilot } from './Pilot';

/**
 * A slowly turning preview of your pilot for the Outfitter's shop: tap a suit or helmet in the
 * list to try it on here before buying. Has its own little renderer, which only runs while the
 * shop is open.
 */
export class WardrobePreview {
  readonly el: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
  private readonly pilot = new Pilot();
  private readonly label: HTMLElement;
  private frame = 0;
  private time = 0;
  suit = 'standard';
  helmet = 'dome';

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'preview';
    this.canvas = document.createElement('canvas');
    this.label = document.createElement('div');
    this.label.className = 'preview-label';
    this.el.append(this.canvas, this.label);

    this.scene.add(new THREE.HemisphereLight('#fff4e0', '#3b2350', 1.7));
    const key = new THREE.DirectionalLight('#fff1d6', 2.2);
    key.position.set(-3, 5, 4);
    const rim = new THREE.DirectionalLight('#6ff7ff', 1.4);
    rim.position.set(3, 3, -4);
    this.scene.add(key, rim, this.pilot.root);
    this.camera.position.set(0, 1.9, 7);
    this.camera.lookAt(0, 1.45, 0);
  }

  /** Dress the preview pilot (and say what's being shown). */
  show(suit: string, helmet: string, label: string): void {
    this.suit = suit;
    this.helmet = helmet;
    this.pilot.setLook(suit, helmet);
    this.label.textContent = label;
  }

  start(): void {
    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
      this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    }
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      this.time += dt;
      const w = this.canvas.clientWidth;
      const h = this.canvas.clientHeight;
      const r = this.renderer!;
      if (w > 0 && h > 0 && (this.canvas.width !== Math.round(w * r.getPixelRatio()) || this.canvas.height !== Math.round(h * r.getPixelRatio()))) {
        r.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
      }
      this.pilot.root.rotation.y = Math.PI + Math.sin(this.time * 0.6) * 0.9 + 0.3; // face us, turning to show the sides
      this.pilot.animate(dt, 0);
      r.render(this.scene, this.camera);
      this.frame = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(tick);
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
  }
}
