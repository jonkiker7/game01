import * as THREE from 'three';

/**
 * Halos: a cheap stand-in for bloom. Instead of blurring the whole screen every frame, each
 * glowing object gets a soft, slightly bigger "glow shell" drawn around it with additive
 * blending. No extra full-screen passes, so the game can draw straight to the screen.
 *
 * It's automatic: anything whose material is bright enough that bloom would pick it up (a basic
 * material with a colour above 1, like the ones from `glow()`) gets a halo the first time it's
 * seen. The halo follows its object (it's a child of it), and its colour and strength follow
 * the material every frame, so pulsing lights pulse their halo too.
 */

/** Glows dimmer than this (bloom's threshold) don't get a halo. */
const THRESHOLD = 1.2;
/** Things bigger than this (radius) don't get one (huge panels would just wash the screen out). */
const MAX_RADIUS = 30;

export class Halos {
  /** How strong halos are (dev panel). */
  strength = 0.8;
  private on = false;
  private readonly all = new Set<THREE.Mesh>();
  private readonly mats = new Map<string, THREE.ShaderMaterial>();
  private timer = 0;

  constructor(private readonly roots: () => THREE.Object3D[]) {}

  set enabled(on: boolean) {
    if (on === this.on) return;
    this.on = on;
    for (const h of this.all) h.visible = on;
    if (on) this.scan();
  }

  get enabled(): boolean {
    return this.on;
  }

  /** How many halos exist (for the performance panel). */
  get count(): number {
    return this.all.size;
  }

  /** Look for new glowing things now and then (new enemies, shots, effects). */
  update(dt: number): void {
    if (!this.on) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.5;
    this.scan();
  }

  private scan(): void {
    for (const root of this.roots()) {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || m.userData.halo !== undefined || m.userData.isOutline || m.userData.isHalo || m.userData.noHalo) return;
        m.userData.halo = this.attach(m) ?? null;
      });
    }
    // Forget halos whose object was removed from the scene.
    for (const h of this.all) if (!h.parent?.parent) this.all.delete(h);
  }

  private attach(src: THREE.Mesh): THREE.Mesh | undefined {
    const mat = src.material as THREE.MeshBasicMaterial;
    if (Array.isArray(mat) || !mat || !(mat as THREE.Material & { isMeshBasicMaterial?: boolean }).isMeshBasicMaterial) return;
    // Is it a glow at all (now or when it pulses)? glow() materials are created bright.
    const c = mat.color;
    if (Math.max(c.r, c.g, c.b) < THRESHOLD && !mat.userData.glow) return;
    const geo = src.geometry;
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    if (!geo.boundingBox) geo.computeBoundingBox();
    const radius = geo.boundingSphere!.radius;
    if (!(radius > 0) || radius > MAX_RADIUS) return;
    // Flat things (cards, rings, planes) fade out from their centre; solid ones fade at the
    // silhouette, so a sphere gets a soft round glow and a capsule a soft streak.
    const size = geo.boundingBox!.getSize(new THREE.Vector3());
    const flat = Math.min(size.x, size.y, size.z) < radius * 0.08;
    const grow = 1 + THREE.MathUtils.clamp(1.4 / radius, 0.35, 1.6);
    const key = `${mat.uuid}|${flat ? 'f' : 's'}|${radius.toFixed(2)}|${grow.toFixed(2)}`;
    let haloMat = this.mats.get(key);
    if (!haloMat) {
      haloMat = makeMaterial(flat, radius, grow);
      this.mats.set(key, haloMat);
    }
    const inst = src as THREE.InstancedMesh;
    let halo: THREE.Mesh;
    if (inst.isInstancedMesh) {
      // Shares the instances' positions, so it moves with them for free.
      const ih = new THREE.InstancedMesh(geo, haloMat, inst.instanceMatrix.count);
      ih.instanceMatrix = inst.instanceMatrix;
      ih.count = inst.count;
      halo = ih;
    } else {
      halo = new THREE.Mesh(geo, haloMat);
    }
    halo.userData.isHalo = true;
    halo.frustumCulled = false;
    halo.renderOrder = 5;
    halo.castShadow = false;
    halo.receiveShadow = false;
    halo.visible = this.on;
    const u = haloMat.uniforms;
    const strength = () => this.strength;
    halo.onBeforeRender = () => {
      if (inst.isInstancedMesh) (halo as THREE.InstancedMesh).count = inst.count;
      // Colour from the glow's hue; strength from how far over the bloom threshold it is.
      const col = mat.color;
      const peak = Math.max(col.r, col.g, col.b, 1e-4);
      u.color.value.setRGB(col.r / peak, col.g / peak, col.b / peak);
      const over = THREE.MathUtils.clamp((peak - 0.9) / 1.4, 0, 1);
      u.opacity.value = over * strength() * (mat.transparent ? mat.opacity : 1) * (mat.visible ? 1 : 0);
    };
    src.add(halo);
    this.all.add(halo);
    return halo;
  }
}

function makeMaterial(flat: boolean, radius: number, grow: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      color: { value: new THREE.Color() },
      opacity: { value: 0 },
      grow: { value: grow },
      radius: { value: radius },
    },
    defines: flat ? { FLAT: 1 } : {},
    vertexShader: /* glsl */ `
      uniform float grow;
      uniform float radius;
      varying float vFade;
      varying vec3 vLocal;
      void main() {
        vLocal = position;
        vec4 p = vec4(position * grow, 1.0);
        vec3 n = normal;
        #ifdef USE_INSTANCING
          p = instanceMatrix * p;
          n = mat3(instanceMatrix) * n;
        #endif
        vec4 mv = modelViewMatrix * p;
        vFade = abs(dot(normalize(normalMatrix * n), normalize(-mv.xyz)));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      uniform float opacity;
      uniform float radius;
      varying float vFade;
      varying vec3 vLocal;
      void main() {
        #ifdef FLAT
          float f = 1.0 - clamp(length(vLocal) / radius, 0.0, 1.0);
        #else
          float f = vFade;
        #endif
        float a = f * f * opacity;
        if (a < 0.004) discard;
        gl_FragColor = vec4(color, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
  });
}
