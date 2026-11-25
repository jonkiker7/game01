/**
 * Keeps the game up to date, even as a Home Screen app (which has no reload button).
 *
 * Every build has a version stamp, and the build writes it to version.json. The game checks that
 * file (skipping every cache) when it starts and whenever you come back to the app. If a newer
 * build is live, it reloads into it, using a fresh URL so no cached copy of the old page is used.
 * During a sortie it waits until you're back at the station, so a run is never cut short.
 */
declare const __BUILD__: string;

/** This build's version, e.g. "202611251630" (UTC date and time it was built). */
export const BUILD: string = __BUILD__;

let waiting: string | null = null;

async function latestBuild(): Promise<string | null> {
  if (import.meta.env.DEV) return null;
  try {
    const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const { build } = (await res.json()) as { build?: string };
    return typeof build === 'string' ? build : null;
  } catch {
    return null; // offline: keep playing this build
  }
}

function reloadInto(build: string): void {
  // Never loop: only try each new build once per session.
  const key = 'star-rotor-update';
  try {
    if (sessionStorage.getItem(key) === build) return;
    sessionStorage.setItem(key, build);
  } catch {
    /* private mode */
  }
  const url = new URL(location.href);
  url.searchParams.set('v', build);
  location.replace(url.toString());
}

/**
 * Start checking for updates. `safeToReload` says whether reloading now would lose anything
 * (false during a sortie); call `updateIfWaiting()` once it's safe again.
 */
export function startUpdater(safeToReload: () => boolean): void {
  const check = async () => {
    const build = await latestBuild();
    if (!build || build <= BUILD) return;
    if (safeToReload()) reloadInto(build);
    else waiting = build;
  };
  void check();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void check();
  });
}

/** Reload into a newer build found earlier, if there is one (call when it's safe, e.g. back at base). */
export function updateIfWaiting(): void {
  if (waiting) reloadInto(waiting);
}
