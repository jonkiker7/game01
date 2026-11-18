export type ButtonName = 'gun' | 'missile' | 'boost';

interface InputElements {
  stickZone: HTMLElement;
  stickBase: HTMLElement;
  stickKnob: HTMLElement;
  buttons: Record<ButtonName, HTMLElement>;
}

const DEADZONE = 0.12;

const KEY_BUTTONS: Record<string, ButtonName> = {
  KeyJ: 'gun',
  KeyK: 'missile',
  KeyL: 'boost',
  Space: 'boost',
};

/**
 * Touch + keyboard input.
 * - Left half of the screen: a floating stick that appears under your thumb.
 * - Right side: buttons (each tracked by its own finger, so you can hold GUN while tapping BOOST).
 * - Keyboard for testing on a computer: WASD/arrows, J gun, K missile, L/Space boost.
 */
export class Input {
  private stickX = 0;
  private stickY = 0;
  private stickPointer: number | null = null;
  private stickOriginX = 0;
  private stickOriginY = 0;
  private readonly stickRadius = 60;

  private readonly touchHeld: Record<ButtonName, boolean> = { gun: false, missile: false, boost: false };
  private readonly keys = new Set<string>();
  private readonly pressed = new Set<ButtonName>();

  constructor(private readonly el: InputElements) {
    this.bindStick();
    for (const name of Object.keys(el.buttons) as ButtonName[]) this.bindButton(name, el.buttons[name]);
    this.bindKeyboard();

    // Block long-press menus and iOS pinch gestures.
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('gesturestart', (e) => e.preventDefault());
  }

  /** Movement direction. x = right, y = up on screen. Length is 0..1. */
  getMove(): { x: number; y: number } {
    const kx = (this.key('KeyD', 'ArrowRight') ? 1 : 0) - (this.key('KeyA', 'ArrowLeft') ? 1 : 0);
    const ky = (this.key('KeyW', 'ArrowUp') ? 1 : 0) - (this.key('KeyS', 'ArrowDown') ? 1 : 0);
    if (kx !== 0 || ky !== 0) {
      const len = Math.hypot(kx, ky);
      return { x: kx / len, y: ky / len };
    }
    return { x: this.stickX, y: this.stickY };
  }

  isHeld(name: ButtonName): boolean {
    if (this.touchHeld[name]) return true;
    for (const [code, btn] of Object.entries(KEY_BUTTONS)) {
      if (btn === name && this.keys.has(code)) return true;
    }
    return false;
  }

  /** True once per tap/keypress. */
  consumePress(name: ButtonName): boolean {
    return this.pressed.delete(name);
  }

  /** Call at the end of every frame so unused taps don't linger. */
  endFrame(): void {
    this.pressed.clear();
  }

  vibrate(ms: number): void {
    navigator.vibrate?.(ms);
  }

  private key(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  private bindStick(): void {
    const { stickZone, stickBase } = this.el;

    stickZone.addEventListener('pointerdown', (e) => {
      if (this.stickPointer !== null) return;
      e.preventDefault();
      this.stickPointer = e.pointerId;
      stickZone.setPointerCapture(e.pointerId);
      this.stickOriginX = e.clientX;
      this.stickOriginY = e.clientY;
      stickBase.style.left = `${e.clientX}px`;
      stickBase.style.top = `${e.clientY}px`;
      stickBase.classList.add('active');
      this.updateStick(e.clientX, e.clientY);
    });

    stickZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickPointer) return;
      this.updateStick(e.clientX, e.clientY);
    });

    const release = (e: PointerEvent) => {
      if (e.pointerId !== this.stickPointer) return;
      this.stickPointer = null;
      this.stickX = 0;
      this.stickY = 0;
      this.el.stickKnob.style.transform = '';
      stickBase.classList.remove('active');
      // Return the stick to its resting spot so players can see where it is.
      stickBase.style.left = '';
      stickBase.style.top = '';
    };
    stickZone.addEventListener('pointerup', release);
    stickZone.addEventListener('pointercancel', release);
  }

  private updateStick(px: number, py: number): void {
    let dx = px - this.stickOriginX;
    let dy = py - this.stickOriginY;
    const dist = Math.hypot(dx, dy);
    if (dist > this.stickRadius) {
      dx = (dx / dist) * this.stickRadius;
      dy = (dy / dist) * this.stickRadius;
    }
    this.el.stickKnob.style.transform = `translate(${dx}px, ${dy}px)`;

    const len = Math.min(dist, this.stickRadius) / this.stickRadius;
    if (len < DEADZONE) {
      this.stickX = 0;
      this.stickY = 0;
      return;
    }
    // Rescale so movement starts smoothly just outside the deadzone.
    const scaled = (len - DEADZONE) / (1 - DEADZONE);
    this.stickX = (dx / (len * this.stickRadius)) * scaled;
    this.stickY = (-dy / (len * this.stickRadius)) * scaled;
  }

  private bindButton(name: ButtonName, el: HTMLElement): void {
    let pointer: number | null = null;

    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (pointer !== null) return;
      pointer = e.pointerId;
      el.setPointerCapture(e.pointerId);
      this.touchHeld[name] = true;
      this.pressed.add(name);
      el.classList.add('pressed');
      this.vibrate(8);
    });

    const release = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      pointer = null;
      this.touchHeld[name] = false;
      el.classList.remove('pressed');
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('lostpointercapture', release);
  }

  private bindKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      if (e.code in KEY_BUTTONS || e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
      if (!e.repeat && KEY_BUTTONS[e.code]) this.pressed.add(KEY_BUTTONS[e.code]);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }
}
