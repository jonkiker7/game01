import * as THREE from 'three';
import { addOutlines, glow, rimToon } from '../game/materials';
import { HELMETS, type SuitStyle, SUITS } from './Save';

/**
 * A pilot on foot: a chunky, slightly chibi tactical astronaut (armored suit, backpack, big
 * helmet). Used for the player and the NPCs, with different suits and helmets.
 * Facing: -Z when rotation.y = 0. About 2.6 units tall.
 */
export class Pilot {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly legs: THREE.Group[] = [];
  private readonly arms: THREE.Group[] = [];
  private helmet = new THREE.Group();
  private walk = 0;
  private time = Math.random() * 10;

  constructor(suitId = 'standard', helmetId = 'dome') {
    this.root.add(this.body);
    this.build(suitId, helmetId);
  }

  /** Rebuild with a different suit and helmet. */
  setLook(suitId: string, helmetId: string): void {
    this.body.clear();
    this.legs.length = 0;
    this.arms.length = 0;
    this.build(suitId, helmetId);
  }

  /**
   * @param speed how fast it's walking (0 = standing), for the walk cycle.
   */
  animate(dt: number, speed: number): void {
    this.time += dt;
    const moving = Math.min(1, speed / 6);
    this.walk += dt * (4 + speed * 1.4) * (moving > 0.05 ? 1 : 0);
    const swing = Math.sin(this.walk) * 0.7 * moving;
    this.legs[0].rotation.x = swing;
    this.legs[1].rotation.x = -swing;
    this.arms[0].rotation.x = -swing * 0.8;
    this.arms[1].rotation.x = swing * 0.8;
    // Bob while walking; gentle breathing while idle.
    this.body.position.y = Math.abs(Math.sin(this.walk)) * 0.14 * moving + Math.sin(this.time * 2) * 0.03;
    this.helmet.rotation.z = Math.sin(this.time * 1.3) * 0.04 * (1 - moving);
  }

  private build(suitId: string, helmetId: string): void {
    const s: SuitStyle = SUITS.find((x) => x.id === suitId) ?? SUITS[0];
    const rim = '#ffd38a';
    const suit = rimToon(s.suit, rim, 0.45);
    const armor = rimToon(s.armor, rim, 0.5);
    const dark = rimToon(s.dark, rim, 0.4);
    const accent = glow(s.accent);
    const b = this.body;

    // Legs (pivot at the hip) with chunky boots.
    for (const side of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(side * 0.28, 1.0, 0);
      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.45, 4, 10), suit);
      thigh.position.y = -0.35;
      const knee = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), armor);
      knee.position.set(0, -0.55, -0.12);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.26, 0.52), dark);
      boot.position.set(0, -0.86, -0.06);
      leg.add(thigh, knee, boot);
      b.add(leg);
      this.legs.push(leg);
    }

    // Torso, chest armor, belt with a glowing buckle.
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.45, 4, 12), suit);
    torso.position.y = 1.45;
    torso.scale.set(1, 1, 0.85);
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.48, 0.25), armor);
    chest.position.set(0, 1.58, -0.3);
    chest.rotation.x = -0.12;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.4, 0.04), accent);
    stripe.position.set(-0.2, 1.6, -0.44);
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.14, 14), dark);
    belt.position.y = 1.08;
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.06), accent);
    buckle.position.set(0, 1.08, -0.45);
    b.add(torso, chest, stripe, belt, buckle);

    // Backpack: life-support box with twin tanks and a status light.
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.7, 0.34), armor);
    pack.position.set(0, 1.55, 0.45);
    for (const side of [-1, 1]) {
      const tank = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.42, 4, 8), dark);
      tank.position.set(side * 0.22, 1.55, 0.66);
      b.add(tank);
    }
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), accent);
    light.position.set(0, 1.85, 0.64);
    b.add(pack, light);

    // Arms (pivot at the shoulder) with big shoulder pads and gloves.
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(side * 0.6, 1.78, 0);
      const pad = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 8), armor);
      pad.scale.set(1.15, 0.8, 1.1);
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.4, 4, 8), suit);
      upper.position.y = -0.35;
      const glove = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), dark);
      glove.position.y = -0.72;
      arm.add(pad, upper, glove);
      b.add(arm);
      this.arms.push(arm);
    }

    // Helmet.
    this.helmet = new THREE.Group();
    this.helmet.position.y = 2.3;
    const style = HELMETS.find((h) => h.id === helmetId)?.id ?? 'dome';
    if (style === 'tactical') {
      // Angular, armored, with a narrow glowing visor slit.
      const shell = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5, 0), suit);
      shell.scale.set(1, 0.95, 1.05);
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.18, 0.4), armor);
      brow.position.set(0, 0.16, -0.25);
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.13, 0.1), accent);
      visor.position.set(0, 0.0, -0.45);
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.25, 0.55), armor);
      fin.position.set(0, 0.47, 0.02);
      const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 4), dark);
      antenna.position.set(0.38, 0.35, 0.15);
      this.helmet.add(shell, brow, visor, fin, antenna);
    } else if (style === 'fishbowl') {
      // Retro glass bubble with tinted, reflective glass: the pilot stays faceless.
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.08, 8, 20), armor);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -0.35;
      const glass = new THREE.Mesh(new THREE.SphereGeometry(0.58, 18, 14), rimToon('#1d2a3a', s.accent, 0.8));
      const shine = new THREE.Mesh(
        new THREE.SphereGeometry(0.2, 10, 8),
        glow('#ffffff', { transparent: true, opacity: 0.55, depthWrite: false }, 1.2),
      );
      shine.scale.set(1.3, 0.6, 0.3);
      shine.position.set(-0.22, 0.26, -0.42);
      shine.userData.noOutline = true;
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.04, 6, 24, Math.PI), glow(s.accent, {}, 1.4));
      band.position.set(0, 0.02, -0.12);
      band.rotation.set(0.15, 0, 0);
      this.helmet.add(ring, glass, shine, band);
    } else {
      // Classic dome with a big glowing visor and an armor crest.
      const shell = new THREE.Mesh(new THREE.SphereGeometry(0.52, 18, 14), suit);
      const visor = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2.2), accent);
      visor.rotation.x = -Math.PI / 2;
      visor.position.set(0, 0, -0.2);
      visor.scale.set(1.05, 1, 0.75);
      const crest = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.7), armor);
      crest.position.set(0, 0.48, 0);
      const ear = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1.12, 10), armor);
      ear.rotation.z = Math.PI / 2;
      this.helmet.add(shell, visor, crest, ear);
    }
    b.add(this.helmet);
    addOutlines(b);
  }
}
