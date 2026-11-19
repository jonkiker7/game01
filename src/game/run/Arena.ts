import * as THREE from 'three';
import { glow } from '../materials';

export type Reward = 'upgrade' | 'weapon' | 'repair' | 'salvage' | 'final';

export const REWARD_STYLE: Record<Reward, { color: string; label: string }> = {
  upgrade: { color: '#ffd36b', label: '★ UPGRADE' },
  weapon: { color: '#e0b3ff', label: '⚔ ARMORY' },
  repair: { color: '#5dff8a', label: '✚ REPAIR' },
  salvage: { color: '#6ff7ff', label: '⬢ SALVAGE' },
  final: { color: '#ff5a7a', label: '☠ STRONGHOLD' },
};

export interface Gate {
  x: number;
  z: number;
  reward: Reward;
}

/** A floating text label that always faces the camera. */
function label(text: string, color: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.font = "900 64px 'Cinzel', Georgia, serif";
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 12;
  g.strokeStyle = 'rgba(10, 6, 20, 0.85)';
  g.strokeText(text, 256, 64);
  g.fillStyle = color;
  g.fillText(text, 256, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(22, 5.5, 1);
  sprite.renderOrder = 20;
  return sprite;
}

/** Soft vertical gradient for the arena's energy wall (bright band at flying height). */
function wallTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.15, 'rgba(255,255,255,0.05)');
  grad.addColorStop(0.18, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.2, 'rgba(255,255,255,0.12)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.03)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  return new THREE.CanvasTexture(c);
}

/**
 * Everything drawn for the current encounter's arena: the circular energy wall that keeps the
 * fight contained, the reward orb that appears when it's cleared, and the gates to the next one.
 */
export class ArenaVisual {
  private readonly wall: THREE.Mesh;
  private readonly wallMat: THREE.MeshBasicMaterial;
  private readonly rewardObj = new THREE.Group();
  private readonly rewardCore: THREE.Mesh;
  private readonly rewardRing: THREE.Mesh;
  private rewardLabel: THREE.Sprite | null = null;
  private readonly gates: { group: THREE.Group; ring: THREE.Mesh; disc: THREE.Mesh }[] = [];
  private time = 0;

  constructor(private readonly scene: THREE.Scene) {
    this.wallMat = glow('#6ff7ff', {
      map: wallTexture(),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    }, 0.9);
    this.wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 96, 1, true), this.wallMat);
    scene.add(this.wall);

    this.rewardCore = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 1), glow('#ffffff'));
    this.rewardRing = new THREE.Mesh(new THREE.TorusGeometry(2.8, 0.15, 8, 40), glow('#ffffff'));
    this.rewardObj.add(this.rewardCore, this.rewardRing);
    this.rewardObj.visible = false;
    scene.add(this.rewardObj);
  }

  /** Place the wall: a ring of radius r around (x, z), glowing brightest at flying height. */
  setArena(x: number, z: number, r: number, flyHeight: number): void {
    // The texture's bright band sits 18% down from the top, which lands near flying height.
    const bottom = -10;
    const top = flyHeight + 8;
    this.wall.scale.set(r, top - bottom, r);
    this.wall.position.set(x, (top + bottom) / 2, z);
  }

  showReward(reward: Reward, pos: THREE.Vector3): void {
    const color = REWARD_STYLE[reward].color;
    (this.rewardCore.material as THREE.MeshBasicMaterial).color.set(color).multiplyScalar(1.8);
    (this.rewardRing.material as THREE.MeshBasicMaterial).color.set(color).multiplyScalar(1.4);
    if (this.rewardLabel) this.rewardObj.remove(this.rewardLabel);
    this.rewardLabel = label(REWARD_STYLE[reward].label, color);
    this.rewardLabel.position.y = 5;
    this.rewardObj.add(this.rewardLabel);
    this.rewardObj.position.copy(pos);
    this.rewardObj.visible = true;
  }

  hideReward(): void {
    this.rewardObj.visible = false;
  }

  get rewardPosition(): THREE.Vector3 {
    return this.rewardObj.position;
  }

  showGates(gates: Gate[], y: number): void {
    this.hideGates();
    for (const gate of gates) {
      const { color, label: text } = REWARD_STYLE[gate.reward];
      const group = new THREE.Group();
      group.position.set(gate.x, y, gate.z);
      // A standing ring facing the camera (south), like a doorway in the sky.
      const ring = new THREE.Mesh(new THREE.TorusGeometry(5, 0.45, 10, 48), glow(color, {}, 1.6));
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(4.6, 40),
        glow(color, { transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
      );
      const tag = label(text, color);
      tag.position.y = -7.5; // below the ring, so it's readable as you approach from the south
      group.add(ring, disc, tag);
      this.scene.add(group);
      this.gates.push({ group, ring, disc });
    }
  }

  hideGates(): void {
    for (const g of this.gates) this.scene.remove(g.group);
    this.gates.length = 0;
  }

  update(dt: number): void {
    this.time += dt;
    this.wallMat.opacity = 0.4 + Math.sin(this.time * 2) * 0.1;
    if (this.rewardObj.visible) {
      this.rewardCore.rotation.y += dt * 1.5;
      this.rewardCore.rotation.x += dt * 0.7;
      this.rewardRing.rotation.set(Math.PI / 2 + Math.sin(this.time * 2) * 0.3, this.time * 2, 0);
      this.rewardCore.scale.setScalar(1 + Math.sin(this.time * 5) * 0.1);
    }
    for (const g of this.gates) {
      g.ring.rotation.z += dt * 0.8;
      (g.disc.material as THREE.MeshBasicMaterial).opacity = 0.2 + Math.sin(this.time * 4) * 0.08;
    }
  }
}
