import * as THREE from 'three';
import { addOutlines, glow } from '../materials';
import { buildShipDesign, type ShipDesignId } from '../ShipDesigns';
import { PRIMARY_NAMES, SECONDARY_NAMES, type Stats, UPGRADES } from './Upgrades';

export interface PauseInfo {
  stats: Stats;
  armor: number;
  ship: ShipDesignId;
  /** Upgrades taken this sortie (id → times taken). */
  levels: Map<string, number>;
  /** Permanent station upgrades: [name, level, max]. */
  perks: [string, number, number][];
  /** The current round's objective lines. */
  objective: string[];
  /** The active contract, if any. */
  contract: { title: string; sector: number; status: string } | null;
}

/**
 * The pause screen: a spinning preview of your ship, its stats, your upgrades and perks, and
 * your current missions. Also holds the dev panel switch (the Home Screen app can't use ?dev).
 */
export class PauseMenu {
  private readonly el: HTMLElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  private readonly holder = new THREE.Group();
  private shown: ShipDesignId | null = null;
  private frame = 0;
  onResume?: () => void;
  onDevToggle?: (on: boolean) => void;

  constructor(root: HTMLElement) {
    root.insertAdjacentHTML(
      'beforeend',
      `<button id="btn-pause" aria-label="Pause">❚❚</button>
       <div id="pause" class="overlay">
         <div class="panel">
           <h2>PAUSED</h2>
           <div class="cols">
             <div class="ship-col"><canvas class="ship-view"></canvas><div class="ship-name"></div></div>
             <div class="info-col">
               <section class="stats"><h3>SHIP</h3><div class="body"></div></section>
               <section class="missions"><h3>MISSIONS</h3><div class="body"></div></section>
               <section class="perks"><h3>POWER-UPS THIS SORTIE</h3><div class="body"></div></section>
               <section class="station"><h3>BASE UPGRADES</h3><div class="body"></div></section>
             </div>
           </div>
           <div class="buttons"><button class="dev"></button><button class="resume">RESUME ▸</button></div>
         </div>
       </div>`,
    );
    this.el = root.querySelector('#pause') as HTMLElement;
    const tap = (sel: string, fn: () => void) =>
      this.el.querySelector(sel)!.addEventListener('pointerup', (e) => {
        e.stopPropagation();
        fn();
      });
    tap('.resume', () => this.onResume?.());
    tap('.dev', () => {
      const on = !devModeOn();
      setDevMode(on);
      this.updateDevButton();
      this.onDevToggle?.(on);
    });
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());

    this.camera.position.set(0, 9, 13);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(new THREE.HemisphereLight('#fff4e0', '#3b2350', 1.6));
    const key = new THREE.DirectionalLight('#fff1d6', 2.4);
    key.position.set(-5, 10, 6);
    this.scene.add(key, this.holder);
  }

  get pauseButton(): HTMLElement {
    return document.getElementById('btn-pause')!;
  }

  get open(): boolean {
    return this.el.classList.contains('visible');
  }

  show(info: PauseInfo): void {
    this.fill(info);
    this.updateDevButton();
    this.el.classList.add('visible');
    this.startPreview(info.ship);
  }

  hide(): void {
    this.el.classList.remove('visible');
    cancelAnimationFrame(this.frame);
  }

  private updateDevButton(): void {
    (this.el.querySelector('.dev') as HTMLElement).textContent = `DEV PANEL: ${devModeOn() ? 'ON' : 'OFF'}`;
  }

  private fill(i: PauseInfo): void {
    const s = i.stats;
    const row = (k: string, v: string) => `<div class="row"><span>${k}</span><b>${v}</b></div>`;
    const pct = (m: number) => `${Math.round(m * 100)}%`;
    const shots = 1 + s.gunSideShots * 2;
    this.body('.stats', [
      row('Armor', `${Math.ceil(i.armor)} / ${Math.round(s.maxArmor)}`),
      row('Speed', pct(s.speedMul)),
      row(PRIMARY_NAMES[s.primary], `${s.gunDamage.toFixed(1)} dmg × ${s.gunRate.toFixed(1)}/s${shots > 1 ? ` × ${shots}` : ''}`),
      row(SECONDARY_NAMES[s.secondary], `${s.missileMax} · ${s.missileRecharge.toFixed(1)}s reload · ${pct(s.missileDamageMul)} dmg`),
      row('Boost cooldown', `${s.boostCooldown.toFixed(2)}s`),
      row('Salvage bonus', pct(s.salvageMul)),
    ].join(''));
    const missions = i.objective.map((l) => `<div class="line">${l}</div>`).join('');
    const contract = i.contract
      ? `<div class="line contract">◆ ${i.contract.title} <small>(sector ${i.contract.sector})</small>${i.contract.status ? ` — ${i.contract.status}` : ''}</div>`
      : '<div class="line dim">No contract taken</div>';
    this.body('.missions', missions + contract);
    const taken = [...i.levels.entries()]
      .map(([id, n]) => {
        const u = UPGRADES.find((x) => x.id === id);
        return u ? `<div class="chip" title="${u.text}"><b>${u.name}</b>${n > 1 ? ` ×${n}` : ''}<small>${u.text}</small></div>` : '';
      })
      .join('');
    this.body('.perks', taken || '<div class="line dim">None yet: clear a sector and grab its power orb</div>');
    const perks = i.perks
      .filter(([, lv]) => lv > 0)
      .map(([name, lv, max]) => `<div class="chip"><b>${name}</b> LV ${lv}/${max}</div>`)
      .join('');
    this.body('.station', perks || '<div class="line dim">None yet: buy them from Rook in the Armory</div>');
  }

  private body(sel: string, html: string): void {
    (this.el.querySelector(`${sel} .body`) as HTMLElement).innerHTML = html;
  }

  /** A small separate renderer just for the spinning ship (only runs while the menu is open). */
  private startPreview(id: ShipDesignId): void {
    const canvas = this.el.querySelector('.ship-view') as HTMLCanvasElement;
    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    }
    if (this.shown !== id) {
      this.holder.clear();
      buildShipDesign(id, this.holder, glow('#6ff7ff'));
      addOutlines(this.holder);
      this.shown = id;
    }
    const tick = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w > 0 && h > 0 && (canvas.width !== Math.round(w * this.renderer!.getPixelRatio()) || canvas.height !== Math.round(h * this.renderer!.getPixelRatio()))) {
        this.renderer!.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
      }
      this.holder.rotation.y += 0.012;
      this.renderer!.render(this.scene, this.camera);
      this.frame = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(this.frame);
    tick();
  }
}

// ---------------------------------------------------------------- dev mode switch

const DEV_KEY = 'star-rotor-devmode';

/** The dev panel is on with `?dev` in the URL, or after switching it on in the pause menu. */
export function devModeOn(): boolean {
  if (new URLSearchParams(location.search).has('dev')) return true;
  try {
    return localStorage.getItem(DEV_KEY) === '1';
  } catch {
    return false;
  }
}

function setDevMode(on: boolean): void {
  try {
    if (on) localStorage.setItem(DEV_KEY, '1');
    else localStorage.removeItem(DEV_KEY);
  } catch {
    /* private mode */
  }
}
