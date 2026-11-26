/**
 * The on-screen action buttons' layout, and an editor for it (from the dev panel): tap a button
 * to select it, drag it to move it, and turn or resize it with the toolbar. SAVE keeps the layout
 * on this device; COPY puts it on the clipboard so it can be made the game's default for everyone.
 *
 * Every button moves, turns and resizes on its own, about its own middle.
 */

const KEY = 'star-rotor-controls';

interface Placement {
  right: number;
  bottom: number;
  tilt: number;
  size: number;
}
type Layout = Record<string, Placement>;

/** Each selectable group: the button you tap, and the elements that move with it. */
const GROUPS: { name: string; ids: string[] }[] = [
  { name: 'GUN', ids: ['btn-gun'] },
  { name: 'MSL', ids: ['btn-missile', 'msl-pips'] },
  { name: 'NOVA', ids: ['btn-special'] },
  { name: 'BOOST', ids: ['btn-boost'] },
  { name: 'ROLL LEFT', ids: ['btn-roll-l'] },
  { name: 'ROLL RIGHT', ids: ['btn-roll-r'] },
];
const ALL_IDS = GROUPS.flatMap((g) => g.ids);

const el = (id: string) => document.getElementById(id);

function read(id: string): Placement | null {
  const e = el(id);
  if (!e) return null;
  const cs = getComputedStyle(e);
  return {
    right: parseFloat(cs.right) || 0,
    bottom: parseFloat(cs.bottom) || 0,
    tilt: parseFloat(cs.getPropertyValue('--tilt')) || 0,
    size: parseFloat(cs.getPropertyValue('--size')) || 1,
  };
}

function write(id: string, p: Placement): void {
  const e = el(id);
  if (!e) return;
  e.style.right = `${Math.round(p.right)}px`;
  e.style.bottom = `${Math.round(p.bottom)}px`;
  if (ROLLS.includes(id)) e.style.transformOrigin = '50% 50%';
  if (id === 'msl-pips') {
    e.style.transform = `scale(${p.size})`; // the pips stay upright
  } else {
    e.style.setProperty('--tilt', `${p.tilt}deg`);
    e.style.setProperty('--size', String(p.size));
  }
}

function clear(id: string): void {
  const e = el(id);
  if (!e) return;
  for (const prop of ['right', 'bottom', 'transform', 'transform-origin', '--tilt', '--size']) e.style.removeProperty(prop);
}

const ROLLS = ['btn-roll-l', 'btn-roll-r'];

/** Switch a roll to turning about its own middle, without it visibly moving. */
function ownPivot(id: string): void {
  const e = el(id);
  if (!e || e.style.transformOrigin) return;
  const a = e.getBoundingClientRect();
  e.style.transformOrigin = '50% 50%';
  const b = e.getBoundingClientRect();
  const p = read(id);
  if (!p) return;
  p.right += b.left + b.width / 2 - (a.left + a.width / 2);
  p.bottom += b.top + b.height / 2 - (a.top + a.height / 2);
  write(id, p);
}

function snapshot(): Layout {
  const out: Layout = {};
  for (const id of ALL_IDS) {
    const p = read(id);
    if (p) out[id] = p;
  }
  return out;
}

/** Apply the layout saved on this device, if any (call once the HUD exists). */
export function applySavedControlLayout(): void {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const layout = JSON.parse(raw) as Layout;
    for (const [id, p] of Object.entries(layout)) if (ALL_IDS.includes(id)) write(id, p);
  } catch {
    /* private mode or a bad save: keep the built-in layout */
  }
}

/** Open the editor. `onClose` runs when it's closed (saved or not). */
export function openControlLayoutEditor(onClose: () => void): void {
  const hadPivot = ROLLS.filter((id) => el(id)?.style.transformOrigin);
  const before = snapshot();
  const hadInline = ALL_IDS.filter((id) => el(id)?.style.right);
  let selected = GROUPS[0];

  document.body.classList.add('layout-edit');
  const bar = document.createElement('div');
  bar.id = 'layout-bar';
  bar.innerHTML = `
    <div class="hint">Tap a button to select it, then drag it. <b class="sel"></b></div>
    <div class="tools">
      <button data-a="rotL">⟲ turn</button><button data-a="rotR">turn ⟳</button>
      <button data-a="smaller">− size</button><button data-a="bigger">size +</button>
      <button data-a="reset">reset button</button><button data-a="resetAll">reset all</button>
    </div>
    <div class="tools">
      <button data-a="save" class="main">SAVE</button>
      <button data-a="copy">📋 COPY FOR CLAUDE</button>
      <button data-a="cancel">CANCEL</button>
    </div>`;
  document.body.appendChild(bar);
  const selLabel = bar.querySelector('.sel') as HTMLElement;

  ROLLS.forEach(ownPivot);
  const mark = () => {
    for (const id of ALL_IDS) el(id)?.classList.toggle('layout-selected', selected.ids.includes(id));
    selLabel.textContent = `Selected: ${selected.name}`;
  };
  const adjust = (fn: (p: Placement) => void) => {
    for (const id of selected.ids) {
      const p = read(id);
      if (!p) continue;
      fn(p);
      write(id, p);
    }
  };

  // Dragging: catch touches before the game's own button handlers see them.
  let drag: { id: number; x: number; y: number } | null = null;
  const down = (e: PointerEvent) => {
    if (bar.contains(e.target as Node)) return;
    e.stopPropagation();
    e.preventDefault();
    const btn = (e.target as HTMLElement).closest?.('#buttons .btn');
    if (!btn) return;
    selected = GROUPS.find((g) => g.ids.includes(btn.id)) ?? selected;
    mark();
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
  };
  const move = (e: PointerEvent) => {
    if (bar.contains(e.target as Node)) return;
    e.stopPropagation();
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    adjust((p) => {
      p.right -= dx;
      p.bottom -= dy;
    });
  };
  const up = (e: PointerEvent) => {
    if (bar.contains(e.target as Node)) return;
    e.stopPropagation();
    if (drag && e.pointerId === drag.id) drag = null;
  };
  window.addEventListener('pointerdown', down, true);
  window.addEventListener('pointermove', move, true);
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', up, true);

  const close = () => {
    window.removeEventListener('pointerdown', down, true);
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', up, true);
    window.removeEventListener('pointercancel', up, true);
    for (const id of ALL_IDS) el(id)?.classList.remove('layout-selected');
    document.body.classList.remove('layout-edit');
    bar.remove();
    onClose();
  };

  const actions: Record<string, () => void> = {
    rotL: () => adjust((p) => (p.tilt -= 5)),
    rotR: () => adjust((p) => (p.tilt += 5)),
    smaller: () => adjust((p) => (p.size = Math.max(0.6, +(p.size - 0.05).toFixed(2)))),
    bigger: () => adjust((p) => (p.size = Math.min(1.6, +(p.size + 0.05).toFixed(2)))),
    reset: () => {
      selected.ids.forEach(clear);
      ROLLS.forEach(ownPivot);
    },
    resetAll: () => {
      ALL_IDS.forEach(clear);
      ROLLS.forEach(ownPivot);
    },
    save: () => {
      try {
        localStorage.setItem(KEY, JSON.stringify(snapshot()));
      } catch {
        /* private mode: it still applies until the page reloads */
      }
      close();
    },
    copy: () => {
      const text = `Star Rotor control layout (right/bottom px inside #buttons, tilt °, size ×):\n${JSON.stringify(snapshot(), null, 1)}`;
      const fallback = () => prompt('Copy this layout:', text);
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => alert('Layout copied. Paste it to Claude to make it the default for everyone.'), fallback);
      else fallback();
    },
    cancel: () => {
      for (const id of ALL_IDS) {
        clear(id);
        if (hadInline.includes(id)) write(id, before[id]);
      }
      // A roll that was never edited goes back to turning about BOOST.
      for (const id of ROLLS) if (!hadPivot.includes(id) && !hadInline.includes(id)) clear(id);
      close();
    },
  };
  bar.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('button')?.dataset.a;
    if (a) actions[a]?.();
  });
  mark();
}
