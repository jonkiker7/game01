import * as THREE from 'three';

/**
 * A turntable preview for the shops (the Armory, the Hangar, the contract board): whatever is
 * selected in the list spins slowly on the right, framed to fit. Has its own little renderer,
 * which only runs while a shop is open.
 */
export class ItemPreview {
  readonly el: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 500);
  private readonly holder = new THREE.Group();
  private readonly label: HTMLElement;
  private frame = 0;
  /** Id of what's being shown (so the list can highlight it). */
  current = '';

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'preview';
    this.canvas = document.createElement('canvas');
    this.label = document.createElement('div');
    this.label.className = 'preview-label';
    this.el.append(this.canvas, this.label);
    this.scene.add(new THREE.HemisphereLight('#fff4e0', '#3b2350', 1.7));
    const key = new THREE.DirectionalLight('#fff1d6', 2.3);
    key.position.set(-4, 7, 5);
    const rim = new THREE.DirectionalLight('#6ff7ff', 1.4);
    rim.position.set(4, 3, -5);
    this.scene.add(key, rim, this.holder);
  }

  /** Show `obj` (centred and framed to fit), with a caption. `pitch` tilts the view down. */
  show(id: string, obj: THREE.Object3D, label: string, pitch = 0.42): void {
    this.current = id;
    this.holder.clear();
    this.holder.rotation.set(0, 0.6, 0);
    this.holder.add(obj);
    this.label.textContent = label;
    // Frame it: centre the object and back the camera off to fit its bounding sphere.
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    const centre = box.getCenter(new THREE.Vector3());
    obj.position.sub(centre);
    const r = box.getBoundingSphere(new THREE.Sphere()).radius || 1;
    const dist = (r / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 0.92;
    this.camera.position.set(0, Math.sin(pitch) * dist, Math.cos(pitch) * dist);
    this.camera.near = dist / 50;
    this.camera.far = dist * 4;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(0, 0, 0);
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
      const w = this.canvas.clientWidth;
      const h = this.canvas.clientHeight;
      const r = this.renderer!;
      if (w > 0 && h > 0 && (this.canvas.width !== Math.round(w * r.getPixelRatio()) || this.canvas.height !== Math.round(h * r.getPixelRatio()))) {
        r.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
      }
      this.holder.rotation.y += dt * 0.5;
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
