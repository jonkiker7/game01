import * as THREE from 'three';
import { Skyreaver } from '../Bosses';
import { Turret } from '../Enemies';
import { Swarmer } from '../EnemyTypes';
import { addOutlines, glow, toon } from '../materials';
import { Fortress, Pylon, Saboteur } from './Missions';

/**
 * Models for BOLT's mission briefings: each mission type has a few slides, each a model with a
 * caption ("This is the convoy", "These are the saboteurs that latch onto it").
 */

const GREEN = '#5dff8a';
const GOLD = '#ffd36b';
const CYAN = '#6ff7ff';

function group(...parts: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  g.add(...parts);
  addOutlines(g);
  return g;
}

function m(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  return mesh;
}

/** A short glowing beam with a ring at its top, as drawn in missions. */
function beamRing(color: string, r: number, h = 6): THREE.Object3D[] {
  const beam = m(
    new THREE.CylinderGeometry(0.6, 0.8, h, 12, 1, true),
    glow(color, { transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }, 1.1),
    0,
    h / 2,
    0,
  );
  beam.userData.noOutline = true;
  const ring = m(new THREE.RingGeometry(r - 0.4, r, 40), glow(color, { side: THREE.DoubleSide }, 1.3), 0, h, 0);
  ring.rotation.x = -Math.PI / 2;
  ring.userData.noOutline = true;
  return [beam, ring];
}

const truck = () =>
  group(
    m(new THREE.BoxGeometry(5, 2.6, 9), toon('#e8dfcc'), 0, 1.6, 0),
    m(new THREE.BoxGeometry(4, 2, 3), toon('#2f8f95'), 0, 3.6, -2.4),
    m(new THREE.BoxGeometry(5.1, 0.6, 9.1), toon('#e2733a'), 0, 2, 0),
    m(new THREE.SphereGeometry(0.5, 8, 6), glow(GREEN, {}, 1.6), -1.6, 4.8, -2.4),
    m(new THREE.SphereGeometry(0.5, 8, 6), glow(GREEN, {}, 1.6), 1.6, 4.8, -2.4),
  );

const crate = () =>
  group(m(new THREE.BoxGeometry(3, 2.2, 3), toon('#e2733a'), 0, 1.1, 0), m(new THREE.BoxGeometry(3.1, 0.5, 3.1), toon('#2f8f95'), 0, 1.1, 0), ...beamRing(GOLD, 3, 6));

function pod(): THREE.Group {
  const p = m(new THREE.CapsuleGeometry(1.3, 2, 6, 12), toon('#e8dfcc'), 0, 1.2, 0);
  p.rotation.z = 1.2;
  const s = m(new THREE.CylinderGeometry(1.36, 1.36, 0.5, 12), toon('#e2733a'), 0, 1.2, 0);
  s.rotation.z = 1.2;
  return group(p, s, ...beamRing(GOLD, 3, 6));
}

const pad = (color = GREEN) =>
  group(m(new THREE.CylinderGeometry(4, 4.5, 0.6, 6), toon('#2a3150'), 0, 0.3, 0), ...beamRing(color, 4.5, 7));

const generator = () =>
  group(
    m(new THREE.CylinderGeometry(2, 3, 8, 8), toon('#e8dfcc'), 0, 4, 0),
    m(new THREE.CylinderGeometry(2.2, 2.2, 0.8, 8), toon('#e2733a'), 0, 6.5, 0),
    m(new THREE.SphereGeometry(2, 16, 12), glow(CYAN, {}, 1.5), 0, 9.5, 0),
  );

const zone = () => {
  const disc = m(
    new THREE.CircleGeometry(5, 40),
    glow(GOLD, { transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }, 1),
    0,
    0.1,
    0,
  );
  disc.rotation.x = -Math.PI / 2;
  disc.userData.noOutline = true;
  const ring = m(new THREE.RingGeometry(4.5, 5, 48), glow(GOLD, { side: THREE.DoubleSide }, 1.3), 0, 0.12, 0);
  ring.rotation.x = -Math.PI / 2;
  ring.userData.noOutline = true;
  return group(disc, ring, m(new THREE.ConeGeometry(0.6, 1.4, 4), toon('#5a6a80'), 0, 0.7, 0));
};

export interface BriefingSlide {
  caption: string;
  model: () => THREE.Object3D;
}

export interface Briefing {
  id: string;
  name: string;
  summary: string;
  slides: BriefingSlide[];
}

export const BRIEFINGS: Briefing[] = [
  {
    id: 'outpost',
    name: 'Destroy the Outpost',
    summary: 'Find and destroy every tower before the clock runs out.',
    slides: [
      { caption: 'These are towers. Destroy every one of them. Watch for red rings: a bomb is about to land there.', model: () => new Turret(1).root },
    ],
  },
  {
    id: 'survive',
    name: 'Survive the Swarm',
    summary: 'Stay alive until the timer runs out.',
    slides: [{ caption: 'Waves of enemies pour in. Keep moving and stay alive until the timer ends.', model: () => new Swarmer(1).root }],
  },
  {
    id: 'rescue',
    name: 'Rescue the Crew',
    summary: 'Pick up stranded crew and fly them to the landing zone.',
    slides: [
      { caption: 'Stranded crew wait in escape pods. Fly into the gold ring to pick them up.', model: pod },
      { caption: 'Drop them off at the landing zone: the green beam.', model: () => pad() },
    ],
  },
  {
    id: 'defend',
    name: 'Defend the Generator',
    summary: 'Keep the generator alive until the timer runs out.',
    slides: [
      { caption: 'This is the generator. Keep it alive until the timer runs out.', model: generator },
      { caption: 'Saboteurs fly in and drill into it. Shoot them first!', model: () => new Saboteur(1, () => null, () => {}).root },
    ],
  },
  {
    id: 'escort',
    name: 'Escort the Convoy',
    summary: 'Guard the convoy to the end of the road.',
    slides: [
      { caption: 'This is the convoy. Keep it alive all the way to the green beam.', model: truck },
      { caption: 'These saboteurs try to latch onto it and stall it. Shoot them off!', model: () => new Saboteur(1, () => null, () => {}).root },
    ],
  },
  {
    id: 'sabotage',
    name: 'Sabotage the Fortress',
    summary: 'Destroy the pylons, then the fortress.',
    slides: [
      { caption: 'Three pylons power the fortress shield. Destroy all three.', model: () => new Pylon(1).root },
      { caption: 'With the shield down, destroy the fortress.', model: () => new Fortress(1).root },
    ],
  },
  {
    id: 'hold',
    name: 'Hold the Zones',
    summary: 'Capture three zones by staying inside them.',
    slides: [{ caption: 'Stay inside each gold zone until it fills up. Leave and it drains.', model: zone }],
  },
  {
    id: 'cargo',
    name: 'Deliver the Cargo',
    summary: 'Collect crates and deliver them to the safe zone.',
    slides: [
      { caption: 'Fly into the gold ring over each crate to pick it up. Bigger ships carry more.', model: crate },
      { caption: 'Deliver them to the safe zone at the far right: the green beam.', model: () => pad() },
    ],
  },
  {
    id: 'boss',
    name: 'Boss',
    summary: 'The fifth fight of every sortie.',
    slides: [{ caption: 'Every sortie ends with a boss. Watch for red warnings and dodge!', model: () => new Skyreaver(1).root }],
  },
];
