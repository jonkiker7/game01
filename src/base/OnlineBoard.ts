import type { LeaderEntry } from './Save';

/**
 * The shared leaderboard: the top 10 scores from everyone who plays, stored in Firebase (Firestore, the
 * `scores` collection). Each score is a new document {name, score, pid, at}; the database's
 * rules only allow adding valid scores (1–10 allowed characters, 1–200,000 points), never editing
 * or deleting. `pid` is a random id kept on this device, so your own rows stay highlighted (and
 * show your current name) even after you rename yourself.
 *
 * The Firebase library loads in the background the first time it's needed. Offline, the board
 * falls back to this device's own scores, and unsent scores wait here until the next try.
 */

const CONFIG = {
  apiKey: 'AIzaSyBeiYwZIxx1mJwdcXGCjF-7C5IDRwGwLzY', // public by design: it only names the project
  authDomain: 'starrotor-ec24e.firebaseapp.com',
  projectId: 'starrotor-ec24e',
  storageBucket: 'starrotor-ec24e.firebasestorage.app',
  messagingSenderId: '777931163268',
  appId: '1:777931163268:web:bef5921022e33e1b36a4d1',
};

const PID_KEY = 'star-rotor-pid';
const PENDING_KEY = 'star-rotor-pending-scores';
const MAX_SCORE = 200000; // matches the database rules
const BOARD_SIZE = 10;

/** This device's player id (random, made once). */
export function playerId(): string {
  try {
    let id = localStorage.getItem(PID_KEY);
    if (!id) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(PID_KEY, id);
    }
    return id;
  } catch {
    return 'anon';
  }
}

type Firestore = typeof import('firebase/firestore/lite');
let lib: Promise<{ fs: Firestore; db: import('firebase/firestore/lite').Firestore }> | null = null;
function firestore() {
  lib ??= Promise.all([import('firebase/app'), import('firebase/firestore/lite')]).then(([app, fs]) => ({
    fs,
    db: fs.getFirestore(app.initializeApp(CONFIG)),
  }));
  return lib;
}

function pending(): { name: string; score: number }[] {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) ?? '[]');
  } catch {
    return [];
  }
}
function setPending(list: { name: string; score: number }[]): void {
  try {
    if (list.length) localStorage.setItem(PENDING_KEY, JSON.stringify(list.slice(-20)));
    else localStorage.removeItem(PENDING_KEY);
  } catch {
    /* private mode */
  }
}

/** Send a finished sortie's score (kept and retried later if it can't be sent now). */
export async function submitScore(name: string, score: number): Promise<void> {
  const s = Math.min(MAX_SCORE, Math.round(score));
  if (s <= 0) return;
  setPending([...pending(), { name, score: s }]);
  await flushPending();
}

/** Send any scores still waiting on this device. */
export async function flushPending(): Promise<void> {
  const list = pending();
  if (!list.length) return;
  try {
    const { fs, db } = await firestore();
    const pid = playerId();
    while (list.length) {
      const e = list[0];
      await fs.addDoc(fs.collection(db, 'scores'), { name: e.name, score: e.score, pid, at: fs.serverTimestamp() });
      list.shift();
      setPending(list);
    }
  } catch (err) {
    console.warn('Leaderboard: score not sent yet', err);
  }
}

/**
 * The top 10 scores (arcade style: a player can hold several places), with your rows marked. `myName` replaces the
 * name on your own rows. Resolves null if the board can't be reached.
 */
export async function fetchTop(myName: string): Promise<LeaderEntry[] | null> {
  try {
    await flushPending();
    const { fs, db } = await firestore();
    const snap = await fs.getDocs(fs.query(fs.collection(db, 'scores'), fs.orderBy('score', 'desc'), fs.limit(BOARD_SIZE)));
    const me = playerId();
    return snap.docs.map((d) => {
      const { name, score, pid } = d.data() as { name: string; score: number; pid: string };
      return pid === me ? { name: myName, score, you: true } : { name, score };
    });
  } catch (err) {
    console.warn('Leaderboard: could not load the shared board', err);
    return null;
  }
}
