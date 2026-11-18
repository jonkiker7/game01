import * as THREE from 'three';
import { addOutlines, glow } from './game/materials';
import { buildShipDesign, SHIP_DESIGNS } from './game/ShipDesigns';

/**
 * Ship design gallery: the four designs side by side, turning slowly, lit like the game.
 * Each card links to the game with that ship selected.
 */
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setScissorTest(true);
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight('#e4fff6', '#3b2350', 1.1));
const sun = new THREE.DirectionalLight('#fff1d6', 2.3);
sun.position.set(-40, 60, 25);
scene.add(sun);
const rim = new THREE.DirectionalLight('#5fd8ff', 0.9);
rim.position.set(30, 20, -40);
scene.add(rim);

const cards = document.getElementById('cards') as HTMLElement;
const SPACING = 40;
const ships = SHIP_DESIGNS.map((d, i) => {
  const holder = new THREE.Group();
  holder.position.x = i * SPACING;
  const engineMat = glow('#6ff7ff');
  const parts = buildShipDesign(d.id, holder, engineMat);
  addOutlines(holder);
  // Jungle-green disc underneath, like the game's ground, so colours read in context.
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(9, 48),
    new THREE.MeshBasicMaterial({ color: '#7fa43f' }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(i * SPACING, -4, 0);
  scene.add(holder, ground);

  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<div class="label"><b>${String.fromCharCode(65 + i)} · ${d.name}</b><span>${d.blurb}</span></div>
    <a class="fly" href="./index.html?ship=${d.id}">FLY IT ▸</a>`;
  cards.appendChild(card);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 200);
  return { holder, parts, camera, card };
});

function resize(): void {
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);
resize();

let last = performance.now();
let time = 0;
renderer.setAnimationLoop((now: number) => {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  time += dt;
  const h = window.innerHeight;
  renderer.setClearColor('#1c1233');
  renderer.clear();
  ships.forEach((s, i) => {
    s.holder.rotation.y = time * 0.4 + i;
    for (const sp of s.parts.spinners) sp.obj.rotation.y += sp.dir * dt * 14;
    // Each card gets its own viewport and camera (3/4 view from above, like in game).
    const r = s.card.getBoundingClientRect();
    renderer.setViewport(r.left, h - r.bottom, r.width, r.height);
    renderer.setScissor(r.left, h - r.bottom, r.width, r.height);
    s.camera.aspect = r.width / r.height;
    const dist = r.width / r.height < 1.2 ? 20 : 16;
    s.camera.position.set(i * SPACING, dist * 0.75, dist * 0.6);
    s.camera.lookAt(i * SPACING, -0.8, 0);
    s.camera.updateProjectionMatrix();
    renderer.render(scene, s.camera);
  });
});
