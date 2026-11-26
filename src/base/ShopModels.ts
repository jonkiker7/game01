import * as THREE from 'three';
import { Drone } from '../game/Enemies';
import { addOutlines, glow, toon } from '../game/materials';
import { buildShipDesign, type ShipDesignId } from '../game/ShipDesigns';

/**
 * Little models for the shop previews: each of Rook's upgrades (many of them are never seen on
 * the ship, like armor, so these are just pictures of the idea), the ships, and the contracts.
 */

const ORANGE = '#e2733a';
const CREAM = '#ece4d4';
const NAVY = '#2a3150';
const DARK = '#1d1a2a';
const TEAL = '#2f8f95';

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

/** A model for one of Rook's permanent upgrades. */
export function upgradeModel(id: string): THREE.Group {
  const g = new THREE.Group();
  switch (id) {
    case 'plating': {
      // A stack of three thick armor plates (bevelled edges, rivets, an orange middle plate).
      for (let i = 0; i < 3; i++) {
        const y = i * 0.55;
        const w = 3 - i * 0.35;
        const d = 2.2 - i * 0.3;
        g.add(mesh(new THREE.BoxGeometry(w, 0.45, d), toon(i === 1 ? ORANGE : CREAM), 0, y, 0));
        g.add(mesh(new THREE.BoxGeometry(w + 0.08, 0.12, d + 0.08), toon(NAVY), 0, y - 0.24, 0));
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(mesh(new THREE.SphereGeometry(0.1, 8, 6), toon(DARK), sx * (w / 2 - 0.25), y + 0.24, sz * (d / 2 - 0.25)));
      }
      break;
    }
    case 'calibration': {
      // A gun barrel with a scope and a glowing targeting ring.
      const barrel = mesh(new THREE.CylinderGeometry(0.25, 0.3, 4, 12), toon(CREAM));
      barrel.rotation.z = Math.PI / 2;
      const body = mesh(new THREE.BoxGeometry(1.6, 0.9, 0.9), toon(NAVY), -2.2, 0, 0);
      const muzzle = mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.5, 12), toon(ORANGE), 2.1, 0, 0);
      muzzle.rotation.z = Math.PI / 2;
      const scope = mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.6, 10), toon(DARK), -1.2, 0.7, 0);
      scope.rotation.z = Math.PI / 2;
      const ring = mesh(new THREE.TorusGeometry(0.9, 0.06, 6, 32), glow('#ff6b6b'), 3.2, 0, 0);
      ring.rotation.y = Math.PI / 2;
      const dot = mesh(new THREE.SphereGeometry(0.12, 8, 6), glow('#ff6b6b'), 3.2, 0, 0);
      g.add(barrel, body, muzzle, scope, ring, dot);
      break;
    }
    case 'rack': {
      // A missile rack with three missiles.
      g.add(mesh(new THREE.BoxGeometry(3.4, 0.3, 1.4), toon(NAVY), 0, -0.55, 0));
      for (let i = -1; i <= 1; i++) {
        const body = mesh(new THREE.CylinderGeometry(0.28, 0.28, 2.6, 10), toon(CREAM), i * 1.05, 0, 0);
        body.rotation.x = Math.PI / 2;
        const tip = mesh(new THREE.ConeGeometry(0.28, 0.7, 10), toon('#d8453f'), i * 1.05, 0, -1.65);
        tip.rotation.x = -Math.PI / 2;
        const fin = mesh(new THREE.BoxGeometry(0.8, 0.08, 0.5), toon(ORANGE), i * 1.05, 0, 1.1);
        g.add(body, tip, fin);
      }
      break;
    }
    case 'capacitor': {
      // A glowing Nova core inside spinning coils.
      g.add(mesh(new THREE.SphereGeometry(0.8, 18, 14), glow('#c9a8ff')));
      for (let i = 0; i < 3; i++) {
        const coil = mesh(new THREE.TorusGeometry(1.3 + i * 0.12, 0.09, 6, 40), toon(i === 1 ? ORANGE : CREAM));
        coil.rotation.set(i * 1.05, i * 0.6, 0);
        g.add(coil);
      }
      g.add(mesh(new THREE.CylinderGeometry(1.1, 1.3, 0.4, 16), toon(NAVY), 0, -1.7, 0));
      break;
    }
    case 'thrusters': {
      // A thruster nozzle with its blue flame.
      const housing = mesh(new THREE.CylinderGeometry(0.9, 0.9, 1.2, 16), toon(CREAM), 0, 0, -0.8);
      housing.rotation.x = Math.PI / 2;
      const nozzle = mesh(new THREE.CylinderGeometry(0.55, 1.05, 1.2, 16, 1, true), toon(DARK), 0, 0, 0.4);
      nozzle.rotation.x = Math.PI / 2;
      const band = mesh(new THREE.TorusGeometry(0.92, 0.1, 6, 24), toon(ORANGE), 0, 0, -0.3);
      const flame = mesh(new THREE.ConeGeometry(0.75, 2.6, 16), glow('#6ff7ff', { transparent: true, opacity: 0.85 }), 0, 0, 2.3);
      flame.rotation.x = Math.PI / 2;
      g.add(housing, nozzle, band, flame);
      break;
    }
    default: {
      // Scavenger: an open crate overflowing with glowing salvage crystals (the ⬢ currency).
      g.add(mesh(new THREE.BoxGeometry(2.4, 1.2, 1.8), toon(TEAL), 0, -0.5, 0));
      g.add(mesh(new THREE.BoxGeometry(2.5, 0.25, 1.9), toon(ORANGE), 0, 0.1, 0));
      const crystal = (x: number, y: number, z: number, s: number, rx: number, rz: number) => {
        const c = mesh(new THREE.OctahedronGeometry(0.45 * s, 0), glow('#6ff7ff'), x, y, z);
        c.scale.set(1, 1.6, 1);
        c.rotation.set(rx, 0, rz);
        g.add(c);
      };
      crystal(0, 0.9, 0, 1.2, 0, 0.1);
      crystal(-0.7, 0.65, 0.35, 0.9, 0.3, 0.4);
      crystal(0.75, 0.6, -0.3, 0.85, -0.2, -0.45);
      crystal(0.3, 0.55, 0.6, 0.7, 0.5, -0.2);
      crystal(1.6, -0.85, 0.9, 0.6, 0, 1.3);
    }
  }
  addOutlines(g);
  return g;
}

/** One of the ships, as it looks in flight. */
export function shipModel(id: ShipDesignId): THREE.Group {
  const g = new THREE.Group();
  buildShipDesign(id, g, glow('#6ff7ff'));
  addOutlines(g);
  return g;
}

/** A picture for each kind of contract. */
export function contractModel(type: string): THREE.Group {
  const g = new THREE.Group();
  if (type === 'hunt') {
    // The alpha drone you're hunting.
    g.add(new Drone(1, 1.8).root);
    return g;
  }
  if (type === 'uplink') {
    // A relay dish on a mast, bowl facing up, with a glowing transmitter over it.
    g.add(mesh(new THREE.CylinderGeometry(1.1, 1.3, 0.35, 12), toon(NAVY), 0, -1.6, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.14, 0.18, 1.8, 8), toon(CREAM), 0, -0.6, 0));
    const dish = new THREE.Group();
    const bowl = mesh(new THREE.SphereGeometry(1.4, 22, 10, 0, Math.PI * 2, Math.PI - 1.0, 1.0), toon(CREAM), 0, 1.2, 0);
    (bowl.material as THREE.Material).side = THREE.DoubleSide;
    const rim = mesh(new THREE.TorusGeometry(1.18, 0.07, 6, 28), toon(ORANGE), 0, 0.45, 0);
    rim.rotation.x = Math.PI / 2;
    const post = mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.3, 6), toon(DARK), 0, 0.85, 0);
    const tip = mesh(new THREE.SphereGeometry(0.22, 10, 8), glow('#6ff7ff'), 0, 1.5, 0);
    dish.add(bowl, rim, post, tip);
    dish.position.y = 0.25;
    dish.rotation.x = -0.55; // tilted toward the sky
    g.add(dish);
  } else {
    // Retrieve: a supply crate with a flare.
    g.add(mesh(new THREE.BoxGeometry(2.4, 1.8, 1.8), toon(ORANGE), 0, 0, 0));
    g.add(mesh(new THREE.BoxGeometry(2.5, 0.4, 1.9), toon(TEAL), 0, 0, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.6, 6), toon(DARK), 0.8, 1.6, 0.5));
    g.add(mesh(new THREE.SphereGeometry(0.25, 10, 8), glow('#ffd36b'), 0.8, 2.45, 0.5));
  }
  addOutlines(g);
  return g;
}
