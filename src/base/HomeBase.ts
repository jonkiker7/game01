import * as THREE from 'three';
import type { Input } from '../game/Input';
import { addOutlines, glow } from '../game/materials';
import { approachAngle, damp } from '../game/math';
import { buildShipDesign, SHIP_DESIGNS, type ShipDesignId, type ShipParts } from '../game/ShipDesigns';
import type { BaseUI, ShopRow, Speaker } from './BaseUI';
import { Pilot } from './Pilot';
import { HELMETS, PERKS, type SaveData, SHIP_PRICES, SUITS, writeSave } from './Save';
import { BAY_EXIT, buildStation, type Collider, DECK_RADIUS, PAD, STATION } from './Station';

const WALK_SPEED = 9;
const TALK_RANGE = 7.5; // generous, so you can talk across a counter
const LAUNCH_RANGE = 9.5;
const CAM_OFFSET = new THREE.Vector3(0, 11.5, 13.5); // close and fairly low, so the windows and planets show behind the crew

interface Npc {
  speaker: Speaker;
  pilot: Pilot;
  pos: THREE.Vector3;
  lines: (s: SaveData) => string;
  shop: () => void;
  shopLabel: string;
}

type Target = { kind: 'npc'; npc: Npc } | { kind: 'ship' };

/**
 * The home base: walk your pilot around the station deck, talk to the crew, spend salvage,
 * and board your ship to launch a sortie (with a short cutscene).
 */
export class HomeBase {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.5, 900);
  /** Called when the launch cutscene is nearly done (start the fade into the sortie). */
  onLaunch?: () => void;

  private readonly pilot: Pilot;
  private readonly npcs: Npc[] = [];
  private readonly colliders: Collider[];
  private readonly holo: THREE.Object3D;
  private readonly planet: THREE.Object3D;
  private readonly shipHolder = new THREE.Group();
  private shipParts: ShipParts | null = null;
  private readonly engineMat = glow('#6ff7ff');
  private readonly focus = new THREE.Vector3();
  private target: Target | null = null;
  private launching = -1; // seconds into the launch cutscene, or -1
  private launchFrom = new THREE.Vector3();
  private time = 0;

  constructor(
    private readonly save: SaveData,
    private readonly ui: BaseUI,
  ) {
    this.scene.background = new THREE.Color(STATION.space);
    this.scene.add(new THREE.HemisphereLight('#ffe9d0', '#2a2440', 1.2));
    const key = new THREE.DirectionalLight('#fff1d6', 2.1);
    key.position.set(-20, 40, 25);
    this.scene.add(key);
    const planetGlow = new THREE.DirectionalLight('#9ff0e0', 0.8); // light bouncing up from the planet
    planetGlow.position.set(0, -30, -40);
    this.scene.add(planetGlow);

    const built = buildStation(this.scene);
    this.colliders = built.colliders;
    this.holo = built.holo;
    this.planet = built.planet;

    this.pilot = new Pilot(save.suit, save.helmet);
    this.scene.add(this.pilot.root);

    this.shipHolder.position.copy(PAD).setY(1.8);
    this.shipHolder.rotation.y = -0.65; // nose toward the bay door
    this.shipHolder.scale.setScalar(1.35);
    this.scene.add(this.shipHolder);
    this.setShip(save.ship);

    this.addCrew();
  }

  /** Arrive at the base (first load, or back from a sortie). */
  enter(): void {
    this.launching = -1;
    this.pilot.root.visible = true;
    this.pilot.root.scale.setScalar(1);
    this.pilot.root.position.set(2, 0, 10);
    this.pilot.root.rotation.y = Math.PI; // facing the camera
    this.shipHolder.position.copy(PAD).setY(1.8);
    this.shipHolder.rotation.set(0, -0.65, 0);
    this.focus.copy(this.pilot.root.position);
    this.ui.setSalvage(this.save.salvage);
    this.pilot.setLook(this.save.suit, this.save.helmet);
    this.setShip(this.save.ship);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** What the action button should say right now (null = nothing in reach). */
  get actionLabel(): string | null {
    if (this.launching >= 0 || this.ui.busy) return null;
    if (!this.target) return null;
    return this.target.kind === 'ship' ? 'LAUNCH' : 'TALK';
  }

  update(dt: number, input: Input): void {
    this.time += dt;
    this.holo.rotation.y += dt * 0.6;
    this.planet.rotation.y += dt * 0.01;
    for (const n of this.npcs) n.pilot.animate(dt, 0);
    if (this.shipParts) for (const s of this.shipParts.spinners) s.obj.rotation.y += s.dir * dt * (this.launching >= 0 ? 22 : 2);

    if (this.launching >= 0) {
      this.updateLaunch(dt);
      return;
    }

    // Walk (unless a menu is open).
    const p = this.pilot.root.position;
    let speed = 0;
    if (!this.ui.busy) {
      const m = input.getMove();
      const len = Math.hypot(m.x, m.y);
      if (len > 0.05) {
        p.x += m.x * WALK_SPEED * dt;
        p.z -= m.y * WALK_SPEED * dt;
        speed = len * WALK_SPEED;
        this.pilot.root.rotation.y = approachAngle(this.pilot.root.rotation.y, Math.atan2(-m.x, m.y), 12 * dt);
      }
      this.collide(p);
    }
    this.pilot.animate(dt, speed);

    // What's in reach?
    this.target = null;
    let best = Infinity;
    for (const n of this.npcs) {
      const d = Math.hypot(p.x - n.pos.x, p.z - n.pos.z);
      if (d < TALK_RANGE && d < best) {
        best = d;
        this.target = { kind: 'npc', npc: n };
      }
    }
    if (Math.hypot(p.x - PAD.x, p.z - PAD.z) < LAUNCH_RANGE && !this.target) this.target = { kind: 'ship' };

    if (input.consumePress('gun') && this.target && !this.ui.busy) this.act(this.target);

    // Camera follows the pilot.
    this.focus.x = damp(this.focus.x, p.x, 5, dt);
    this.focus.z = damp(this.focus.z, p.z, 5, dt);
    this.focus.y = 1.6;
    this.camera.position.copy(this.focus).add(CAM_OFFSET);
    this.camera.lookAt(this.focus);
  }

  private act(t: Target): void {
    if (t.kind === 'ship') {
      this.startLaunch();
      return;
    }
    const n = t.npc;
    this.ui.say(n.speaker, n.lines(this.save), [
      { label: n.shopLabel, action: () => n.shop() },
      { label: 'LATER', action: () => {} },
    ]);
  }

  // ---------------------------------------------------------------- launch cutscene

  private startLaunch(): void {
    this.launching = 0;
    this.launchFrom.copy(this.pilot.root.position);
  }

  /**
   * 0.0–1.0 s  the pilot walks to the ship
   * 1.0–1.3 s  climbs in (shrinks away)
   * 1.3–2.6 s  the ship lifts off the pad, fans spinning up
   * 2.6–4.6 s  turns toward the bay door and accelerates out into space
   */
  private updateLaunch(dt: number): void {
    const t = (this.launching += dt);
    const pilot = this.pilot.root;
    const boarding = new THREE.Vector3(PAD.x - 3.5, 0, PAD.z + 3);
    if (t < 1) {
      const k = t;
      pilot.position.lerpVectors(this.launchFrom, boarding, k * (2 - k));
      pilot.rotation.y = Math.atan2(-(boarding.x - this.launchFrom.x), -(boarding.z - this.launchFrom.z));
      this.pilot.animate(dt, 7);
    } else if (t < 1.3) {
      const k = (t - 1) / 0.3;
      pilot.position.lerpVectors(boarding, this.shipHolder.position, k);
      pilot.scale.setScalar(Math.max(0.01, 1 - k));
    } else {
      pilot.visible = false;
    }

    const ship = this.shipHolder;
    if (t >= 1.3 && t < 2.6) {
      const k = (t - 1.3) / 1.3;
      ship.position.y = 1.8 + k * k * 5;
      ship.rotation.z = Math.sin(t * 9) * 0.03;
    } else if (t >= 2.6) {
      const k = Math.min(1, (t - 2.6) / 2);
      const dir = BAY_EXIT.clone().sub(PAD).normalize();
      ship.rotation.y = approachAngle(ship.rotation.y, Math.atan2(-dir.x, -dir.z), 3 * dt);
      ship.rotation.x = -0.25 * k;
      const dist = 60 * k * k * k; // accelerate
      ship.position.set(PAD.x + dir.x * dist, 6.8 + dir.y * dist * 0.4, PAD.z + dir.z * dist);
    }
    this.engineMat.color.set('#6ff7ff').multiplyScalar(1.8 * (t > 1.3 ? 1.6 : 1));

    // Camera: drift from the pilot to the ship, pulling back as it leaves.
    const look = t < 1.3 ? pilot.position : ship.position;
    this.focus.lerp(look, 1 - Math.exp(-3 * dt));
    const back = 1 + Math.max(0, t - 2.6) * 0.25;
    this.camera.position.copy(this.focus).addScaledVector(CAM_OFFSET, back);
    this.camera.lookAt(this.focus);

    if (t >= 4.1 && t - dt < 4.1) this.onLaunch?.();
  }

  // ---------------------------------------------------------------- the crew

  private addCrew(): void {
    const save = this.save;
    const rook: Npc = {
      speaker: { name: 'ROOK', role: 'QUARTERMASTER', color: '#e2733a', icon: '⚙' },
      pilot: new Pilot('crimson', 'tactical'),
      pos: new THREE.Vector3(-15, 0, -9.2),
      shopLabel: 'UPGRADES',
      lines: (s) =>
        s.runs === 0
          ? "Name's Rook. You bring back salvage, I bolt better gear onto you. Simple arrangement."
          : s.lastRun?.won
            ? "A full sortie. Even I'm impressed. Don't let it go to your helmet. Got salvage to spend?"
            : `Shot down after ${s.lastRun?.sectors ?? 0} sectors, huh? Armor's cheaper than funerals, rookie. Spend that scrap.`,
      shop: () =>
        this.ui.openShop('QUARTERMASTER · PERMANENT UPGRADES', () =>
          PERKS.map((p): ShopRow => {
            const level = save.perks[p.id] ?? 0;
            const maxed = level >= p.costs.length;
            const cost = p.costs[level];
            return {
              name: p.name,
              text: p.text,
              status: `LV ${level}/${p.costs.length}`,
              button: maxed ? null : `⬢ ${cost}`,
              disabled: !maxed && save.salvage < cost,
              onClick: () => {
                if (maxed || save.salvage < cost) return;
                save.salvage -= cost;
                save.perks[p.id] = level + 1;
                this.commit();
              },
            };
          }),
        ),
    };
    const juno: Npc = {
      speaker: { name: 'JUNO', role: 'OUTFITTER', color: '#ff5fd2', icon: '✦' },
      pilot: new Pilot('midnight', 'fishbowl'),
      pos: new THREE.Vector3(-7, 0, -14.2),
      shopLabel: 'WARDROBE',
      lines: (s) =>
        s.suit === 'standard'
          ? "Darling, you can't save the galaxy in standard issue. Let's find you something with a little flair."
          : 'Now THAT is a pilot who gets noticed. The enemy will be so distracted.',
      shop: () =>
        this.ui.openShop('OUTFITTER · SUITS & HELMETS', () => [
          ...SUITS.map((suit): ShopRow => this.cosmeticRow(suit.name, 'Suit', suit.id, suit.price, 'suits', 'suit')),
          ...HELMETS.map((h): ShopRow => this.cosmeticRow(h.name, 'Helmet', h.id, h.price, 'helmets', 'helmet')),
        ]),
    };
    const pip: Npc = {
      speaker: { name: 'PIP', role: 'MECHANIC', color: '#6ff7ff', icon: '🔧' },
      pilot: new Pilot('arctic', 'dome'),
      pos: new THREE.Vector3(3, 0, -16),
      shopLabel: 'HANGAR',
      lines: (s) =>
        s.runs === 0
          ? "Pip here! I keep your birds flying. The Manta's fueled and ready. I've got a few other ships out back, too!"
          : "Welcome back! Not too many dents this time. Want to try a different ship? I've got options!",
      shop: () =>
        this.ui.openShop('MECHANIC · SHIPS', () =>
          SHIP_DESIGNS.map((d): ShopRow => {
            const owned = save.ships.includes(d.id);
            const selected = save.ship === d.id;
            const price = SHIP_PRICES[d.id];
            return {
              name: d.name,
              text: d.blurb,
              status: selected ? 'IN USE' : owned ? 'OWNED' : '',
              button: selected ? null : owned ? 'FLY' : `⬢ ${price}`,
              disabled: !owned && save.salvage < price,
              onClick: () => {
                if (!owned) {
                  if (save.salvage < price) return;
                  save.salvage -= price;
                  save.ships.push(d.id);
                }
                save.ship = d.id;
                this.setShip(d.id);
                this.commit();
              },
            };
          }),
        ),
    };
    for (const n of [rook, juno, pip]) {
      n.pilot.root.position.copy(n.pos);
      n.pilot.root.rotation.y = Math.PI; // face the camera / player
      this.scene.add(n.pilot.root);
      this.colliders.push({ x: n.pos.x, z: n.pos.z, r: 1.1 });
      this.npcs.push(n);
    }
  }

  private cosmeticRow(name: string, kind: string, id: string, price: number, owned: 'suits' | 'helmets', worn: 'suit' | 'helmet'): ShopRow {
    const save = this.save;
    const has = save[owned].includes(id);
    const wearing = save[worn] === id;
    return {
      name,
      text: kind,
      status: wearing ? 'WEARING' : has ? 'OWNED' : '',
      button: wearing ? null : has ? 'WEAR' : `⬢ ${price}`,
      disabled: !has && save.salvage < price,
      onClick: () => {
        if (!has) {
          if (save.salvage < price) return;
          save.salvage -= price;
          save[owned].push(id);
        }
        save[worn] = id;
        this.pilot.setLook(save.suit, save.helmet);
        this.commit();
      },
    };
  }

  private commit(): void {
    writeSave(this.save);
    this.ui.setSalvage(this.save.salvage);
  }

  private setShip(id: ShipDesignId): void {
    this.shipHolder.clear();
    this.shipParts = buildShipDesign(id, this.shipHolder, this.engineMat);
    addOutlines(this.shipHolder);
  }

  /** Keep the pilot on the deck and out of the furniture. */
  private collide(p: THREE.Vector3): void {
    const d = Math.hypot(p.x, p.z);
    const max = DECK_RADIUS - 1.5;
    if (d > max) {
      p.x *= max / d;
      p.z *= max / d;
    }
    for (const c of [...this.colliders, { x: PAD.x, z: PAD.z, r: 5.5 }]) {
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      const dist = Math.hypot(dx, dz);
      const r = c.r + 0.6;
      if (dist < r && dist > 0.001) {
        p.x = c.x + (dx / dist) * r;
        p.z = c.z + (dz / dist) * r;
      }
    }
  }
}
