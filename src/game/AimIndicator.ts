import * as THREE from 'three';
import { missileRange } from './Missiles';
import type { Ship } from './Ship';
import type { World } from './World';

const CHARGING = new THREE.Color('#6ff7ff');
const FULL = new THREE.Color('#ffd36b');

/**
 * Ground marker shown while the missile is charging: a beam that grows from the
 * ship as the charge builds, plus a target ring where the missile will land.
 * Turns gold and pulses when fully charged.
 */
export class AimIndicator {
  private readonly group = new THREE.Group();
  private readonly beam: THREE.Mesh;
  private readonly beamMat: THREE.MeshBasicMaterial;
  private readonly reticle: THREE.Group;
  private readonly reticleMat: THREE.MeshBasicMaterial;
  private readonly color = new THREE.Color();
  private time = 0;

  constructor(scene: THREE.Scene) {
    this.beamMat = this.overlayMaterial(this.beamTexture());
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, -0.5); // starts at the ship and extends forward (-Z)
    this.beam = new THREE.Mesh(geo, this.beamMat);

    this.reticleMat = this.overlayMaterial();
    this.reticle = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.9, 32), this.reticleMat);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.45, 16), this.reticleMat);
    for (const m of [ring, dot]) {
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 10;
      this.reticle.add(m);
    }
    this.beam.renderOrder = 10;

    this.group.add(this.beam, this.reticle);
    this.group.visible = false;
    scene.add(this.group);
  }

  update(dt: number, ship: Ship, world: World): void {
    this.time += dt;
    if (!ship.isCharging) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;

    const p = ship.root.position;
    const range = missileRange(ship.charge);
    this.group.position.set(p.x, world.heightAt(p.x, p.z) + 0.4, p.z);
    this.group.rotation.y = ship.aimHeading;

    this.beam.scale.set(1.1 + ship.charge * 0.6, 1, range);
    this.reticle.position.z = -range;

    const full = ship.charge >= 1;
    const pulse = full ? 0.75 + Math.sin(this.time * 18) * 0.25 : 1;
    this.color.copy(CHARGING).lerp(FULL, full ? 1 : 0);
    this.beamMat.color.copy(this.color).multiplyScalar(pulse);
    this.reticleMat.color.copy(this.color).multiplyScalar(pulse);
    this.reticle.scale.setScalar(full ? 1.15 + Math.sin(this.time * 18) * 0.08 : 0.8 + ship.charge * 0.3);
  }

  /** Drawn on top of the terrain so dunes never hide it. */
  private overlayMaterial(map?: THREE.Texture): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
      map,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
  }

  /** Bright centre line with soft edges, fading in from the ship toward the target. */
  private beamTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 128;
    const g = c.getContext('2d')!;
    const across = g.createLinearGradient(0, 0, 32, 0);
    across.addColorStop(0, 'rgba(255,255,255,0)');
    across.addColorStop(0.35, 'rgba(255,255,255,0.35)');
    across.addColorStop(0.5, 'rgba(255,255,255,1)');
    across.addColorStop(0.65, 'rgba(255,255,255,0.35)');
    across.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = across;
    g.fillRect(0, 0, 32, 128);
    // Fade toward the ship end (bottom of the canvas).
    g.globalCompositeOperation = 'destination-in';
    const along = g.createLinearGradient(0, 128, 0, 0);
    along.addColorStop(0, 'rgba(0,0,0,0)');
    along.addColorStop(0.25, 'rgba(0,0,0,0.8)');
    along.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = along;
    g.fillRect(0, 0, 32, 128);
    return new THREE.CanvasTexture(c);
  }
}
