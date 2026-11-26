import * as THREE from 'three';

/**
 * Little speech bubbles over the crew: when you walk up to someone, they say a short line
 * ("Hello!", "Can I help you?") for a couple of seconds. Walk away and come back for another.
 * HTML bubbles, placed over each NPC's head on screen every frame.
 */

/** What each crew member might say as you come near (first line is used the first time). */
export const GREETINGS: Record<string, string[]> = {
  bot: ['Hello!', 'Can I help you?', 'Need directions?', 'Contracts are posted!', 'Welcome back, pilot!'],
  rook: ['Need an upgrade?', 'Salvage buys armor.', 'Back in one piece?', 'What can I get you?'],
  juno: ['Looking sharp!', 'Fancy a new suit?', 'Try something on!', 'Hello, darling!'],
  pip: ['Your ship is ready!', 'Want a new ride?', 'Fueled and fixed!', 'Ready to launch?'],
};

const NEAR = 11; // pop up when you come this close
const RESET = 15; // ...after having been at least this far away
const SHOW = 2.2; // seconds on screen

interface Speaker {
  id: string;
  /** World position of the spot above their head. */
  head: THREE.Vector3;
  el: HTMLElement;
  timer: number;
  armed: boolean;
  said: number;
}

export class SpeechBubbles {
  private readonly speakers: Speaker[] = [];
  private readonly tmp = new THREE.Vector3();

  constructor(private readonly root: HTMLElement) {}

  add(id: string, head: THREE.Vector3): void {
    const el = document.createElement('div');
    el.className = 'speech';
    this.root.appendChild(el);
    this.speakers.push({ id, head, el, timer: 0, armed: true, said: 0 });
  }

  /** Make someone say something now (e.g. BOLT greeting you as you arrive). */
  say(id: string, text?: string): void {
    const s = this.speakers.find((x) => x.id === id);
    if (!s) return;
    this.pop(s, text);
  }

  private pop(s: Speaker, text?: string): void {
    const lines = GREETINGS[s.id] ?? ['Hi!'];
    s.el.textContent = text ?? lines[s.said === 0 ? 0 : 1 + Math.floor(Math.random() * (lines.length - 1))];
    s.said++;
    s.timer = SHOW;
    s.armed = false;
    s.el.classList.remove('show');
    void s.el.offsetWidth;
    s.el.classList.add('show');
  }

  /** Hide them all (e.g. leaving the base, or a conversation opening). */
  hideAll(): void {
    for (const s of this.speakers) {
      s.timer = 0;
      s.el.classList.remove('show');
    }
  }

  update(dt: number, player: THREE.Vector3, camera: THREE.Camera, quiet: boolean): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const s of this.speakers) {
      const d = Math.hypot(player.x - s.head.x, player.z - s.head.z);
      if (d > RESET) s.armed = true;
      if (!quiet && s.armed && d < NEAR) this.pop(s);
      if (s.timer > 0) {
        s.timer -= dt;
        if (s.timer <= 0 || quiet) {
          s.timer = 0;
          s.el.classList.remove('show');
        }
      }
      if (s.timer > 0) {
        const p = this.tmp.copy(s.head).project(camera);
        s.el.style.transform = `translate(${((p.x + 1) / 2) * w}px, ${((1 - p.y) / 2) * h}px) translate(-50%, -100%)`;
      }
    }
  }
}
