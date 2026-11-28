/**
 * Keeps the on-screen controls and HUD the same size relative to the screen on every device.
 * They were laid out on a phone (about 932×430); on a bigger screen (a tablet) everything grows
 * to match, on a smaller one it shrinks a little. The player can also make it smaller or bigger
 * with the UI SIZE slider in the pause menu.
 *
 * The HUD's widgets are grouped by the screen corner (or edge) they're anchored to, and each
 * group is scaled from that corner, so positions and gaps grow along with the widgets.
 */

/** The phone the layout was designed on (CSS pixels, landscape). */
const REF = Math.sqrt(932 * 430);
const KEY = 'star-rotor-ui-scale';

/** Which widgets belong to which corner group. */
const GROUPS: Record<string, { origin: string; ids: string[] }> = {
  tl: { origin: '0 0', ids: ['armor', 'salvage', 'btn-pause', 'btn-exit-training', 'base-salvage'] },
  tr: { origin: '100% 0', ids: ['radar', 'objective', 'ship-full'] },
  tc: { origin: '50% 0', ids: ['score', 'fps', 'btn-sound', 'boss-bar'] },
  mc: { origin: '50% 50%', ids: ['score-pop'] },
  br: { origin: '100% 100%', ids: ['buttons', 'btn-tutorial'] },
};

let user = 1;
try {
  const v = Number(localStorage.getItem(KEY));
  if (v >= 0.5 && v <= 1.5) user = v;
} catch {
  /* private mode */
}

let scale = 1;

/** The current HUD scale (auto × the player's setting). */
export function uiScale(): number {
  return scale;
}

/** The player's UI SIZE setting (1 = 100%). */
export function userUiScale(): number {
  return user;
}

export function setUserUiScale(v: number): void {
  user = Math.min(1.5, Math.max(0.5, v));
  try {
    localStorage.setItem(KEY, String(user));
  } catch {
    /* private mode */
  }
  apply();
}

function apply(): void {
  const auto = Math.min(2.2, Math.max(0.75, Math.sqrt(window.innerWidth * window.innerHeight) / REF));
  scale = auto * user;
  document.documentElement.style.setProperty('--ui', scale.toFixed(3));
}

/** Group the HUD's widgets into scaled corner groups (call once the HUD is built). */
export function setupUiScale(hud: HTMLElement): void {
  // Groups go early in the HUD, so menus and overlays added later still draw on top of them.
  const anchor = document.getElementById('stick-zone')?.nextSibling ?? hud.firstChild;
  for (const [name, g] of Object.entries(GROUPS)) {
    const wrap = document.createElement('div');
    wrap.className = 'ui-group';
    wrap.dataset.corner = name;
    wrap.style.transformOrigin = g.origin;
    hud.insertBefore(wrap, anchor);
    for (const id of g.ids) {
      const el = document.getElementById(id);
      if (el) wrap.appendChild(el);
    }
  }
  apply();
  window.addEventListener('resize', apply);
}
