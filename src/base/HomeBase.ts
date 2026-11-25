import * as THREE from 'three';
import { audio } from '../audio/Audio';
import type { Input } from '../game/Input';
import { addOutlines, glow } from '../game/materials';
import { approachAngle, damp } from '../game/math';
import { buildShipDesign, SHIP_DESIGNS, type ShipDesignId, type ShipParts } from '../game/ShipDesigns';
import { CONVERSATIONS, IDLE, type Line, type StoryState } from '../content/dialogue';
import type { BaseUI, ShopRow } from './BaseUI';
import type { ConversationUI } from './Conversation';
import { CORRIDORS, DESTINATIONS, heightAt, HOLES, inRect, type Rect, ROOMS, roomAt, SPOTS, WALKABLE } from './Layout';
import { LeaderboardSign } from './Leaderboard';
import { Pilot } from './Pilot';
import { Robot } from './Robot';
import { HELMETS, PERKS, type SaveData, SHIP_PRICES, SUITS, writeSave } from './Save';
import { buildStation, type Collider, type SlidingDoor, STATION, type WallSegment } from './Station';

const WALK_SPEED = 11;
const TALK_RANGE = 7.5; // generous, so you can talk across a counter
const LAUNCH_RANGE = 9.5;
const BODY = 0.9; // the pilot's radius for walls and furniture
/** Isometric-style camera: up and to the south-east, looking north-west (Diablo / old Fallout). */
const CAM_OFFSET = new THREE.Vector3(13, 24, 13);
// Stick directions on the ground, matching the diagonal camera.
const CAM_RIGHT = new THREE.Vector2(1, -1).normalize();
const CAM_FORWARD = new THREE.Vector2(-1, -1).normalize();

const PAD = new THREE.Vector3(SPOTS.pad.x, heightAt(SPOTS.pad.x, SPOTS.pad.z), SPOTS.pad.z);
const BAY_EXIT = new THREE.Vector3(SPOTS.bayExit.x, PAD.y + 30, SPOTS.bayExit.z);
const DOOR_RANGE = 6; // doors slide open when you're this close
const SEE_THROUGH = 0.15; // how solid a wall stays when it's faded out of your way

/** A wall piece's own materials (so it can fade alone) and its ink outlines. */
interface WallLook {
  mats: { mat: THREE.Material; opacity: number; transparent: boolean }[];
  lines: THREE.Object3D[];
  faded: boolean;
}
const SHIP_YAW = 0.45 + Math.PI / 2; // parked nose-west (turned 270° clockwise from nose-north)

export type Spawn = 'wake' | 'landed';

interface Npc {
  id: 'bot' | 'rook' | 'juno' | 'pip';
  model: { root: THREE.Object3D };
  animate: (dt: number) => void;
  pos: THREE.Vector3;
  shop?: () => void;
  shopLabel?: string;
  /** "!" over their head when they have something new to say. */
  marker: THREE.Sprite;
  markerY: number;
}

type Target = { kind: 'npc'; npc: Npc } | { kind: 'ship' };

/** A spot on the way between areas (doorways); `areas` are the rooms/corridors it joins. */
interface Waypoint {
  x: number;
  z: number;
  areas: string[];
}

const DOORS: Waypoint[] = [
  { x: 0, z: -22, areas: ['hangar', 'c0'] },
  { x: 0, z: -14, areas: ['concourse', 'c0'] },
  { x: -18, z: 0, areas: ['concourse', 'c1'] },
  { x: -26, z: 0, areas: ['armory', 'c1'] },
  { x: 18, z: 0, areas: ['concourse', 'c2'] },
  { x: 26, z: 0, areas: ['boutique', 'c2'] },
  { x: 0, z: 16, areas: ['concourse', 'c3'] },
  { x: 0, z: 23, areas: ['c3', 'c4', 'c5'] },
  { x: -18, z: 23, areas: ['c4', 'quarters'] },
];

/** Area ids: room ids, or 'c<n>' for corridors. */
function areasAt(x: number, z: number): string[] {
  const out = ROOMS.filter((r) => inRect(r.rect, x, z, -0.5)).map((r) => r.id);
  CORRIDORS.forEach((c, i) => inRect(c.rect, x, z, -0.5) && out.push(`c${i}`));
  return out;
}

/** Walkable areas shrunk so you can't touch the walls, but stretched across doorways. */
const FLOOR: Rect[] = (() => {
  const rooms = ROOMS.map((r) => ({ x0: r.rect.x0 + BODY, z0: r.rect.z0 + BODY, x1: r.rect.x1 - BODY, z1: r.rect.z1 - BODY }));
  const corridors = CORRIDORS.map((c) => {
    const r = c.rect;
    const ns = c.axis === 'ns';
    const out = ns
      ? { x0: r.x0 + BODY, x1: r.x1 - BODY, z0: r.z0, z1: r.z1 }
      : { x0: r.x0, x1: r.x1, z0: r.z0 + BODY, z1: r.z1 - BODY };
    // Reach into whatever it connects to at each end (but not through a sealed door).
    const reach = BODY + 0.5;
    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;
    const joins = (x: number, z: number) => WALKABLE.some((w) => w !== r && inRect(w, x, z));
    if (ns) {
      if (joins(cx, r.z0 - 0.5)) out.z0 -= reach;
      if (joins(cx, r.z1 + 0.5)) out.z1 += reach;
    } else {
      if (joins(r.x0 - 0.5, cz)) out.x0 -= reach;
      if (joins(r.x1 + 0.5, cz)) out.x1 += reach;
    }
    return out;
  });
  return [...rooms, ...corridors];
})();

function onFloor(x: number, z: number): boolean {
  if (HOLES.some((h) => inRect(h, x, z, -BODY - 0.3))) return false; // stay behind the railings
  return FLOOR.some((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);
}

/**
 * The home base: walk your pilot through the station's rooms, ask BOLT at the info desk for
 * directions, talk to the crew, spend salvage, and board your ship in the hangar to launch.
 */
export class HomeBase {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 2, 1400);
  /** Called when the launch cutscene is nearly done (start the fade into the sortie). */
  onLaunch?: () => void;

  private readonly pilot: Pilot;
  private readonly npcs: Npc[] = [];
  private readonly colliders: Collider[];
  private readonly walls: WallSegment[];
  private readonly doors: SlidingDoor[];
  private readonly wallLooks: WallLook[] = [];
  private readonly spinners: THREE.Object3D[];
  private readonly holo: THREE.Object3D;
  private readonly planets: THREE.Object3D[];
  private readonly robot = new Robot();
  private readonly shipHolder = new THREE.Group();
  private shipParts: ShipParts | null = null;
  private readonly engineMat = glow('#6ff7ff');
  private readonly focus = new THREE.Vector3();
  private target: Target | null = null;
  private launching = -1; // seconds into the launch cutscene, or -1
  private launchFrom = new THREE.Vector3();
  private time = 0;
  private room: string | null = null;
  private talkingTo: Npc | null = null;
  // BOLT's waypoint: an arrow at your feet and a beacon at the destination.
  private guide: (typeof DESTINATIONS)[number] | null = null;
  private readonly arrow = new THREE.Group();
  private readonly beacon = new THREE.Group();

  constructor(
    private readonly save: SaveData,
    private readonly ui: BaseUI,
    private readonly convo: ConversationUI,
  ) {
    this.scene.background = new THREE.Color(STATION.space);
    this.scene.fog = new THREE.Fog(STATION.space, 70, 230);
    this.scene.add(new THREE.HemisphereLight('#ffe9d0', '#2a2440', 1.25));
    const key = new THREE.DirectionalLight('#fff1d6', 2);
    key.position.set(25, 45, 18);
    this.scene.add(key);
    const planetGlow = new THREE.DirectionalLight('#9ff0e0', 0.7); // light bouncing up from the planet
    planetGlow.position.set(0, -30, -40);
    this.scene.add(planetGlow);

    const built = buildStation(this.scene);
    this.colliders = built.colliders;
    this.walls = built.walls;
    this.doors = built.doors;
    for (const w of this.walls) this.wallLooks.push(ownMaterials(w.obj));
    this.spinners = built.spinners;
    this.holo = built.holo;
    this.planets = built.planets;

    this.pilot = new Pilot(save.suit, save.helmet);
    this.scene.add(this.pilot.root);

    this.shipHolder.scale.setScalar(1.35);
    this.scene.add(this.shipHolder);
    // The leaderboard, high on the concourse's north wall above the hangar doorway.
    // Hung upright on the wall between the two halves of the balcony, facing the room.
    this.board.root.position.set(0, 9, -13.3);
    this.scene.add(this.board.root);
    this.board.draw(this.save.leaderboard);
    this.parkShip();
    this.setShip(save.ship);

    this.buildGuide();
    this.addCrew();
    convo.onAction = (a) => {
      if (a.startsWith('guide:')) this.setGuide(a.slice(6));
    };
  }

  /** Arrive at the base: wake up in your quarters (first load) or step off the ship (after a sortie). */
  private readonly board = new LeaderboardSign();

  enter(spawn: Spawn = 'wake'): void {
    this.launching = -1;
    this.board.draw(this.save.leaderboard); // new scores from the sortie you just flew
    this.pilot.root.visible = true;
    this.pilot.root.scale.setScalar(1);
    const at = SPOTS[spawn];
    this.pilot.root.position.set(at.x, heightAt(at.x, at.z), at.z);
    this.pilot.root.rotation.y = spawn === 'landed' ? Math.PI : -Math.PI / 2; // toward the door
    this.parkShip();
    this.focus.copy(this.pilot.root.position);
    this.focus.y += 1.6;
    this.placeCamera(1);
    this.room = null; // so the room name shows on arrival
    this.setGuide(null);
    this.ui.setSalvage(this.save.salvage);
    this.pilot.setLook(this.save.suit, this.save.helmet);
    this.setShip(this.save.ship);
    this.updateMarkers();
    for (const w of this.walls) w.cut = -1; // snap the cutaway walls this frame
    for (const d of this.doors) d.open = 0;
  }

  /** Is a menu or conversation open? (Then the pilot doesn't walk.) */
  /** Launching, or a menu or conversation is open (not a good moment to reload for an update). */
  get busyLaunching(): boolean {
    return this.launching >= 0 || this.busy;
  }

  private get busy(): boolean {
    return this.ui.busy || this.convo.active;
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** What the action button should say right now (null = nothing in reach). */
  get actionLabel(): string | null {
    if (this.launching >= 0 || this.busy) return null;
    if (!this.target) return null;
    return this.target.kind === 'ship' ? 'LAUNCH' : 'TALK';
  }

  update(dt: number, input: Input): void {
    this.time += dt;
    this.holo.rotation.y += dt * 0.6;
    for (const p of this.planets) p.rotation.y += dt * 0.008;
    for (const sp of this.spinners) sp.rotation.z += dt * 0.5;
    if (!this.convo.active) this.talkingTo = null;
    for (const n of this.npcs) {
      n.animate(dt);
      n.marker.position.y = n.markerY + Math.sin(this.time * 4) * 0.15;
    }
    if (this.shipParts) for (const s of this.shipParts.spinners) s.obj.rotation.y += s.dir * dt * (this.launching >= 0 ? 22 : 2);

    if (this.launching >= 0) {
      this.updateLaunch(dt);
      this.updateWalls(dt, this.focus);
      this.updateDoors(dt);
      return;
    }

    // Walk (unless a menu is open). The stick is relative to the diagonal camera.
    const p = this.pilot.root.position;
    let speed = 0;
    if (!this.busy) {
      const m = input.getMove();
      const len = Math.hypot(m.x, m.y);
      if (len > 0.05) {
        const dx = (CAM_RIGHT.x * m.x + CAM_FORWARD.x * m.y) * WALK_SPEED * dt;
        const dz = (CAM_RIGHT.y * m.x + CAM_FORWARD.y * m.y) * WALK_SPEED * dt;
        this.move(p, dx, dz);
        speed = len * WALK_SPEED;
        this.pilot.root.rotation.y = approachAngle(this.pilot.root.rotation.y, Math.atan2(-dx, -dz), 12 * dt);
      }
    }
    p.y = heightAt(p.x, p.z); // up and down the stairs
    this.pilot.animate(dt, speed);

    // Announce the room when you walk into one.
    const room = roomAt(p.x, p.z);
    if (room && room.id !== this.room) {
      this.room = room.id;
      this.ui.toast(room.name, room.subtitle);
    }

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

    if (input.consumePress('gun') && this.target && !this.busy) this.act(this.target);

    this.updateGuide(dt);

    // Camera follows the pilot.
    this.focus.x = damp(this.focus.x, p.x, 5, dt);
    this.focus.z = damp(this.focus.z, p.z, 5, dt);
    this.focus.y = damp(this.focus.y, p.y + 1.6, 6, dt);
    this.placeCamera(1);
    this.updateWalls(dt, p);
    this.updateDoors(dt);
  }

  /** Sliding doors part when the pilot walks up to them, and close behind. */
  private updateDoors(dt: number): void {
    const p = this.pilot.root.position;
    const near = this.pilot.root.visible;
    for (const d of this.doors) {
      const want = near && Math.hypot(p.x - d.x, p.z - d.z) < DOOR_RANGE ? 1 : 0;
      if (want && d.open < 0.02) audio.play('door');
      d.open = damp(d.open, want, want ? 9 : 5, dt);
      const slide = d.open * (d.half - 0.15);
      d.left.position.x = -slide;
      d.right.position.x = slide;
      d.light.color.set(d.open > 0.5 ? '#7dff9a' : STATION.red).multiplyScalar(1.6);
    }
  }

  private placeCamera(back: number): void {
    this.camera.position.copy(this.focus).addScaledVector(CAM_OFFSET, back);
    this.camera.lookAt(this.focus);
  }

  /** Slide along walls: try the full step, then each axis on its own. Then push out of furniture. */
  private move(p: THREE.Vector3, dx: number, dz: number): void {
    if (onFloor(p.x + dx, p.z + dz)) {
      p.x += dx;
      p.z += dz;
    } else if (Math.abs(dx) > 1e-4 && onFloor(p.x + dx, p.z)) p.x += dx;
    else if (Math.abs(dz) > 1e-4 && onFloor(p.x, p.z + dz)) p.z += dz;
    else {
      // Caught on a corner (e.g. a doorway's edge): try veering a little either way.
      for (const turn of [0.5, -0.5, 1, -1]) {
        const c = Math.cos(turn);
        const s = Math.sin(turn);
        const nx = (dx * c - dz * s) * 0.8;
        const nz = (dx * s + dz * c) * 0.8;
        if (onFloor(p.x + nx, p.z + nz)) {
          p.x += nx;
          p.z += nz;
          break;
        }
      }
    }
    for (const c of this.colliders) {
      const ox = p.x - c.x;
      const oz = p.z - c.z;
      const dist = Math.hypot(ox, oz);
      const r = c.r + 0.6;
      if (dist < r && dist > 0.001) {
        const nx = c.x + (ox / dist) * r;
        const nz = c.z + (oz / dist) * r;
        if (onFloor(nx, nz)) {
          p.x = nx;
          p.z = nz;
        }
      }
    }
  }

  /** Each wall piece's bounds in the world (walls never move, so measured once). */
  private wallBoxes: THREE.Box3[] | null = null;
  private readonly ray = new THREE.Ray();
  private readonly sightPoints = Array.from({ length: 6 }, () => new THREE.Vector3());
  private readonly hitPoint = new THREE.Vector3();

  /**
   * See-through walls: a wall fades to a ghost of itself only when it actually blocks the line
   * of sight from the camera to the pilot (a few points: feet, middle, head and either side).
   * Walls anywhere else stay solid, however near they are. Walls are axis-aligned boxes, so a
   * ray-box test is exact enough.
   */
  private updateWalls(dt: number, at: THREE.Vector3): void {
    const cam = this.camera;
    cam.updateMatrixWorld();
    if (!this.wallBoxes) {
      this.scene.updateMatrixWorld();
      this.wallBoxes = this.walls.map((w) => new THREE.Box3().setFromObject(w.obj).expandByScalar(-0.05));
    }
    const eye = cam.position;
    // Camera-right on the ground (for the side points), from the diagonal camera.
    const rx = CAM_RIGHT.x * 1.3;
    const rz = CAM_RIGHT.y * 1.3;
    const pts = this.sightPoints;
    pts[0].set(at.x, at.y + 0.3, at.z);
    pts[1].set(at.x, at.y + 1.3, at.z);
    pts[2].set(at.x, at.y + 2.5, at.z);
    pts[3].set(at.x + rx, at.y + 1.3, at.z + rz);
    pts[4].set(at.x - rx, at.y + 1.3, at.z - rz);
    pts[5].set(at.x, at.y + 4, at.z);

    this.walls.forEach((w, i) => {
      const box = this.wallBoxes![i];
      let blocks = false;
      for (const pt of pts) {
        this.ray.origin.copy(eye);
        this.ray.direction.subVectors(pt, eye);
        const dist = this.ray.direction.length();
        this.ray.direction.divideScalar(dist);
        const hit = this.ray.intersectBox(box, this.hitPoint);
        if (hit && hit.distanceTo(eye) < dist - 0.3) {
          blocks = true;
          break;
        }
      }
      const goal = blocks ? SEE_THROUGH : 1;
      const before = w.cut;
      w.cut = w.cut < 0 ? goal : damp(w.cut, goal, 10, dt);
      if (Math.abs(w.cut - before) > 1e-4 || before < 0) applyFade(this.wallLooks[i], w.cut);
    });
  }

  private act(t: Target): void {
    if (t.kind === 'ship') {
      this.startLaunch();
      return;
    }
    const n = t.npc;
    // Face the player while talking.
    const p = this.pilot.root.position;
    n.model.root.rotation.y = Math.atan2(-(p.x - n.pos.x), -(p.z - n.pos.z));
    this.talkingTo = n;
    const next = this.nextConversation(n.id);
    const idle = IDLE[n.id];
    const lines: Line[] = next ? [...next.lines] : [{ who: n.id, mood: 'neutral', text: idle[Math.floor(Math.random() * idle.length)] }];
    if (next) {
      this.save.seen.push(next.id);
      writeSave(this.save);
    }
    if (n.id === 'bot') {
      this.convo.play(n.id, lines, [
        { label: 'CONTRACTS', action: () => this.openContracts() },
        { label: 'DIRECTIONS', action: () => this.convo.play('bot', this.directions()) },
        { label: 'LEAVE' },
      ]);
    } else {
      // You found who BOLT pointed you to.
      if (this.guide && SPOTS[n.id as 'rook'] && this.guide.id === GUIDE_FOR[n.id]) this.setGuide(null);
      this.convo.play(n.id, lines, [{ label: n.shopLabel!, action: () => n.shop?.() }, { label: 'LEAVE' }]);
    }
    this.updateMarkers();
  }

  /** BOLT's contract board: take one job at a time for your next sortie. */
  private openContracts(): void {
    const board = this.save.contracts;
    const who = (c: { client: string }) => c.client.toUpperCase();
    this.ui.openShop('CONTRACT BOARD · ONE AT A TIME', () => {
      const rows: ShopRow[] = [];
      const active = board.active;
      if (active) {
        rows.push({
          name: `▶ ${active.title}`,
          text: `${active.text} <i>${KIND_LABEL[active.type]} · from ${who(active)}</i>`,
          status: `ACTIVE · SECTOR ${active.sector} · ⬢ ${active.reward}`,
          button: 'DROP',
          onClick: () => {
            board.active = null;
            writeSave(this.save);
          },
        });
      }
      for (const c of board.offers) {
        rows.push({
          name: c.title,
          text: `${c.text} <i>${KIND_LABEL[c.type]} · from ${who(c)}</i>`,
          status: `SECTOR ${c.sector} · ⬢ ${c.reward}`,
          button: active ? null : 'ACCEPT',
          onClick: () => {
            if (board.active) return;
            board.active = c;
            board.offers = board.offers.filter((o) => o !== c);
            writeSave(this.save);
          },
        });
      }
      if (rows.length === 0) rows.push({ name: 'No contracts posted', text: 'New jobs go up after every sortie.', status: '', button: null });
      return rows;
    });
  }

  /** BOLT's menu: where everyone is. Picking one lights a path there. */
  private directions(): Line[] {
    return [
      { who: 'bot', mood: 'neutral', text: 'WHERE WOULD YOU LIKE TO GO?' },
      {
        choices: [
          {
            text: 'Where is Rook?',
            action: 'guide:armory',
            reply: [{ who: 'bot', mood: 'happy', text: 'Quartermaster Rook runs the ARMORY, down the west corridor. Permanent upgrades, for salvage. Follow the arrow!' }],
          },
          {
            text: 'Where is Juno?',
            action: 'guide:boutique',
            reply: [{ who: 'bot', mood: 'happy', text: 'Juno keeps the BOUTIQUE, east corridor. Suits and helmets. She says you need both. Follow the arrow!' }],
          },
          {
            text: 'Where is Pip? (and my ship)',
            action: 'guide:hangar',
            reply: [{ who: 'bot', mood: 'happy', text: 'Pip is in the HANGAR BAY, straight north. Your ship is on the pad. Board it to launch a sortie!' }],
          },
          {
            text: 'Where are my quarters?',
            action: 'guide:quarters',
            reply: [{ who: 'bot', mood: 'neutral', text: 'PILOT QUARTERS: south hall, first door on the right... I mean, the left. Your left. Follow the arrow.' }],
          },
          { text: "Nothing, thanks.", reply: [{ who: 'bot', mood: 'happy', text: 'HAVE A STATISTICALLY SAFE DAY!' }] },
        ],
      },
    ];
  }

  /** The best unheard conversation for this crew member right now, if any. */
  private nextConversation(npc: Npc['id']) {
    const s = this.save;
    const state: StoryState = {
      runs: s.runs,
      wins: s.wins,
      deaths: s.deaths,
      salvage: s.salvage,
      lastRun: s.lastRun,
      seen: (id) => s.seen.includes(id),
      contracts: s.contracts.done,
      contractsFor: (who) => s.contracts.byClient[who] ?? 0,
    };
    return CONVERSATIONS.filter((c) => c.npc === npc && !s.seen.includes(c.id) && (!c.when || c.when(state))).sort(
      (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
    )[0];
  }

  private updateMarkers(): void {
    for (const n of this.npcs) n.marker.visible = !!this.nextConversation(n.id);
  }

  // ---------------------------------------------------------------- BOLT's guide

  private buildGuide(): void {
    const mat = glow('#7dff9a', { transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }, 0.75);
    for (let i = 0; i < 3; i++) {
      const chev = new THREE.Shape();
      chev.moveTo(-0.8, 0);
      chev.lineTo(0, 0.7);
      chev.lineTo(0.8, 0);
      chev.lineTo(0.8, -0.35);
      chev.lineTo(0, 0.35);
      chev.lineTo(-0.8, -0.35);
      const m = new THREE.Mesh(new THREE.ShapeGeometry(chev), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(0, 0.06, -(2 + i * 1.3));
      m.scale.setScalar(1.6);
      m.userData.i = i;
      this.arrow.add(m);
    }
    this.arrow.visible = false;
    this.scene.add(this.arrow);

    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(1.6, 1.6, 40, 20, 1, true),
      glow('#7dff9a', { transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }, 1.2),
    );
    pillar.position.y = 20;
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.8, 2.3, 32), glow('#7dff9a', { side: THREE.DoubleSide }, 1.6));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    this.beacon.add(pillar, ring);
    this.beacon.traverse((o) => (o.userData.noOutline = true));
    this.beacon.visible = false;
    this.scene.add(this.beacon);
  }

  private setGuide(id: string | null): void {
    this.guide = DESTINATIONS.find((d) => d.id === id) ?? null;
    this.arrow.visible = this.beacon.visible = !!this.guide;
    if (this.guide) this.beacon.position.set(this.guide.x, heightAt(this.guide.x, this.guide.z), this.guide.z);
    this.ui.setGuide(this.guide ? `▶ GUIDING TO ${this.guide.label.toUpperCase()}` : null);
  }

  private updateGuide(dt: number): void {
    const g = this.guide;
    if (!g) return;
    const p = this.pilot.root.position;
    if (Math.hypot(p.x - g.x, p.z - g.z) < 6) {
      this.setGuide(null); // arrived
      return;
    }
    const next = this.nextStep(p.x, p.z, g);
    this.arrow.position.set(p.x, p.y, p.z);
    this.arrow.rotation.y = approachAngle(this.arrow.rotation.y, Math.atan2(-(next.x - p.x), -(next.z - p.z)), 10 * dt);
    for (const c of this.arrow.children) {
      const k = (this.time * 2 - c.userData.i * 0.33) % 1;
      c.scale.setScalar(1.4 + 0.5 * Math.max(0, Math.sin(k * Math.PI)));
    }
    (this.beacon.children[1] as THREE.Mesh).scale.setScalar(1 + 0.15 * Math.sin(this.time * 5));
  }

  /** Where to head next toward a destination: through the doorways (shortest route). */
  private nextStep(x: number, z: number, goal: { x: number; z: number; id: string }): { x: number; z: number } {
    const here = areasAt(x, z);
    if (here.includes(goal.id)) return goal;
    // Dijkstra over the doorway waypoints (there are only a few).
    const n = DOORS.length;
    const dist = new Array(n).fill(Infinity);
    const prev = new Array<number>(n).fill(-1);
    const done = new Array(n).fill(false);
    DOORS.forEach((d, i) => {
      if (d.areas.some((a) => here.includes(a))) dist[i] = Math.hypot(d.x - x, d.z - z);
    });
    let bestEnd = -1;
    let bestLen = Infinity;
    for (;;) {
      let u = -1;
      for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0) break;
      done[u] = true;
      const du = DOORS[u];
      if (du.areas.includes(goal.id)) {
        const total = dist[u] + Math.hypot(goal.x - du.x, goal.z - du.z);
        if (total < bestLen) {
          bestLen = total;
          bestEnd = u;
        }
      }
      for (let v = 0; v < n; v++) {
        if (done[v] || !DOORS[v].areas.some((a) => du.areas.includes(a))) continue;
        const alt = dist[u] + Math.hypot(DOORS[v].x - du.x, DOORS[v].z - du.z);
        if (alt < dist[v]) {
          dist[v] = alt;
          prev[v] = u;
        }
      }
    }
    if (bestEnd < 0) return goal;
    const path: { x: number; z: number }[] = [goal];
    for (let i = bestEnd; i >= 0; i = prev[i]) path.unshift(DOORS[i]);
    // Head for the first point on the route you haven't reached yet.
    return path.find((q) => Math.hypot(q.x - x, q.z - z) > 2.5) ?? goal;
  }

  // ---------------------------------------------------------------- launch cutscene

  private parkShip(): void {
    this.shipHolder.position.set(PAD.x, PAD.y + 1.8, PAD.z);
    this.shipHolder.rotation.set(0, SHIP_YAW, 0);
    this.flameLen = 0;
    this.thrust = [0, 0];
    this.animateShip(0, 0, 0, 0);
  }

  private startLaunch(): void {
    this.launching = 0;
    audio.play('launch');
    this.launchFrom.copy(this.pilot.root.position);
    this.setGuide(null);
  }

  private flameLen = 0;
  private thrust = [0, 0];

  /**
   * The parked ship's engines, animated like the flying ship's (see Ship.updateVisuals): rear
   * flames grow with `throttle`, and each side thruster fires with its own push (0..1).
   */
  private animateShip(dt: number, throttle: number, left: number, right: number): void {
    const parts = this.shipParts;
    if (!parts) return;
    this.flameLen = dt ? damp(this.flameLen, throttle, throttle > this.flameLen ? 10 : 6, dt) : throttle;
    for (const [i, f] of parts.flames.entries()) {
      const flicker = 0.88 + Math.sin(this.time * 47 + i * 1.7) * 0.12;
      f.visible = this.flameLen > 0.02;
      f.scale.set(1, 1, Math.max(0.01, this.flameLen * flicker));
    }
    for (const th of parts.thrusters) {
      const i = th.side < 0 ? 0 : 1;
      const want = th.side < 0 ? left : right;
      this.thrust[i] = dt ? damp(this.thrust[i], want, want > this.thrust[i] ? 25 : 8, dt) : want;
      const k = this.thrust[i];
      th.obj.visible = k > 0.03;
      const flicker = 0.85 + Math.sin(this.time * 55 + i * 2) * 0.15;
      th.obj.scale.set(0.6 + k * 0.6, Math.max(0.01, k * flicker * 1.4), 0.6 + k * 0.6);
    }
  }

  /**
   * 0.0–1.0 s  the pilot walks to the ship
   * 1.0–1.3 s  climbs in (shrinks away)
   * 1.3–3.1 s  the ship lifts off the pad on its thrusters, turning to face the bay door
   * 3.1–5.1 s  accelerates out through the bay door into space
   */
  private updateLaunch(dt: number): void {
    const t = (this.launching += dt);
    const pilot = this.pilot.root;
    const boarding = new THREE.Vector3(PAD.x + 4, PAD.y, PAD.z + 3.5);
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
    const dir = BAY_EXIT.clone().sub(PAD).normalize();
    const exitYaw = Math.atan2(-dir.x, -dir.z);
    const before = ship.rotation.y;
    let throttle = 0;
    let lift = 0;
    if (t >= 1.3 && t < 3.1) {
      // Lift off, and turn (smoothly) from the parked heading to face the bay door.
      const k = (t - 1.3) / 1.8;
      ship.position.y = PAD.y + 1.8 + (k * k * (3 - 2 * k)) * 5;
      const turn = Math.min(1, Math.max(0, (t - 1.7) / 1.3));
      ship.rotation.y = SHIP_YAW + (exitYaw - SHIP_YAW) * turn * turn * (3 - 2 * turn);
      ship.rotation.z = Math.sin(t * 9) * 0.03;
      throttle = 0.9;
      lift = 0.75;
    } else if (t >= 3.1) {
      const k = Math.min(1, (t - 3.1) / 2);
      ship.rotation.y = exitYaw;
      ship.rotation.x = -0.25 * k;
      ship.rotation.z = 0;
      const dist = 70 * k * k * k; // accelerate
      ship.position.set(PAD.x + dir.x * dist, PAD.y + 6.8 + dir.y * dist * 0.4, PAD.z + dir.z * dist);
      throttle = 2 + k * 4.5;
      lift = k < 0.5 ? 1 : 0.3;
    }
    // Side thrusters: both push it up while lifting; while turning, the outside one fires harder.
    const turnRate = dt > 0 ? (ship.rotation.y - before) / dt : 0;
    const turnPush = Math.min(1, Math.abs(turnRate) / 1.5);
    this.animateShip(dt, throttle, lift + (turnRate < 0 ? turnPush : 0), lift + (turnRate > 0 ? turnPush : 0));
    this.engineMat.color.set('#6ff7ff').multiplyScalar(1.8 * (t > 1.3 ? 1.6 : 1) * (t > 3.1 ? 1.3 : 1));

    // Camera: drift from the pilot to the ship, pulling back as it leaves.
    const look = t < 1.3 ? pilot.position : ship.position;
    this.focus.lerp(look, 1 - Math.exp(-3 * dt));
    this.placeCamera(1 + Math.max(0, t - 3.1) * 0.25);

    if (t >= 4.6 && t - dt < 4.6) this.onLaunch?.();
  }

  // ---------------------------------------------------------------- the crew

  private addCrew(): void {
    const save = this.save;
    const bot: Npc = {
      id: 'bot',
      marker: newMarker(),
      markerY: 5.9,
      model: this.robot,
      animate: (dt) => this.robot.animate(dt, this.talkingTo === bot),
      pos: new THREE.Vector3(SPOTS.bot.x, heightAt(SPOTS.bot.x, SPOTS.bot.z), SPOTS.bot.z),
    };
    const crew = (suit: string, helmet: string) => {
      const p = new Pilot(suit, helmet);
      return { model: p, animate: (dt: number) => p.animate(dt, 0) };
    };
    const rook: Npc = {
      id: 'rook',
      marker: newMarker(),
      markerY: 4.1,
      ...crew('crimson', 'tactical'),
      pos: new THREE.Vector3(SPOTS.rook.x, heightAt(SPOTS.rook.x, SPOTS.rook.z), SPOTS.rook.z),
      shopLabel: 'UPGRADES',
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
      id: 'juno',
      marker: newMarker(),
      markerY: 4.1,
      ...crew('midnight', 'fishbowl'),
      pos: new THREE.Vector3(SPOTS.juno.x, heightAt(SPOTS.juno.x, SPOTS.juno.z), SPOTS.juno.z),
      shopLabel: 'WARDROBE',
      shop: () =>
        this.ui.openShop('OUTFITTER · SUITS & HELMETS', () => [
          ...SUITS.map((suit): ShopRow => this.cosmeticRow(suit.name, 'Suit', suit.id, suit.price, 'suits', 'suit')),
          ...HELMETS.map((h): ShopRow => this.cosmeticRow(h.name, 'Helmet', h.id, h.price, 'helmets', 'helmet')),
        ]),
    };
    const pip: Npc = {
      id: 'pip',
      marker: newMarker(),
      markerY: 4.1,
      ...crew('arctic', 'dome'),
      pos: new THREE.Vector3(SPOTS.pip.x, heightAt(SPOTS.pip.x, SPOTS.pip.z), SPOTS.pip.z),
      shopLabel: 'HANGAR',
      shop: () =>
        this.ui.openShop('MECHANIC · SHIPS', () =>
          SHIP_DESIGNS.map((d): ShopRow => {
            const owned = save.ships.includes(d.id);
            const selected = save.ship === d.id;
            const price = SHIP_PRICES[d.id];
            return {
              name: d.name,
              text: `${d.blurb}. Carries ${d.cargo} cargo.`,
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
    for (const n of [bot, rook, juno, pip]) {
      n.model.root.position.copy(n.pos);
      n.model.root.rotation.y = Math.PI; // face south, toward whoever walks up
      n.markerY += n.pos.y;
      n.marker.position.set(n.pos.x, n.markerY, n.pos.z);
      this.scene.add(n.model.root, n.marker);
      if (n.id !== 'bot') this.colliders.push({ x: n.pos.x, z: n.pos.z, r: 1.1 });
      this.npcs.push(n);
    }
    // Rook stands behind the counter, BOLT behind the desk: face the doorway.
    rook.model.root.rotation.y = Math.atan2(-1, -0.6);
    pip.model.root.rotation.y = -Math.PI / 2; // faces east, across his desk
    addOutlines(this.robot.root);
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
    if (this.launching < 0) this.animateShip(0, 0, 0, 0); // parked: engines off
  }
}

const KIND_LABEL = { retrieve: 'RETRIEVE', hunt: 'HUNT', uplink: 'UPLINK' } as const;

/** Which of BOLT's destinations each crew member is at. */
const GUIDE_FOR: Record<string, string> = { rook: 'armory', juno: 'boutique', pip: 'hangar' };

/** A bobbing gold "!" shown over a crew member who has something new to say. */
function newMarker(): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1b1233';
  g.beginPath();
  g.arc(64, 64, 56, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#f2c46d';
  g.beginPath();
  g.arc(64, 64, 48, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#1b1233';
  g.font = "900 80px 'Cinzel', Georgia, serif";
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('!', 64, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(1.4, 1.4, 1);
  s.renderOrder = 30;
  return s;
}

/** Give a wall piece its own copies of its materials (they're shared between walls). */
function ownMaterials(root: THREE.Object3D): WallLook {
  const look: WallLook = { mats: [], lines: [], faded: false };
  const copies = new Map<THREE.Material, THREE.Material>();
  root.traverse((o) => {
    if (o.userData.isOutline) {
      look.lines.push(o);
      return;
    }
    const mesh = o as THREE.Mesh | THREE.Sprite;
    if (!('material' in mesh) || !mesh.material || Array.isArray(mesh.material)) return;
    const orig = mesh.material as THREE.Material;
    let copy = copies.get(orig);
    if (!copy) {
      copy = orig.clone();
      copies.set(orig, copy);
      look.mats.push({ mat: copy, opacity: copy.opacity, transparent: copy.transparent });
    }
    mesh.material = copy;
  });
  return look;
}

/** Fade a wall piece: 1 = solid, lower = see-through. */
function applyFade(look: WallLook, k: number): void {
  const faded = k < 0.98;
  for (const m of look.mats) {
    m.mat.opacity = m.opacity * (faded ? k : 1);
    const transparent = faded || m.transparent;
    if (m.mat.transparent !== transparent) {
      m.mat.transparent = transparent;
      m.mat.needsUpdate = true; // three bakes "opaque" into the shader, so switch variants
    }
    // Faded walls don't hide what's behind them.
    m.mat.depthWrite = !faded && !m.transparent;
  }
  if (faded !== look.faded) {
    look.faded = faded;
    for (const l of look.lines) l.visible = !faded;
  }
}
