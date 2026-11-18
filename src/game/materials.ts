import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * How bright glowing things are. Values above 1 are what the bloom pass picks up,
 * so only glows (not the ground) get the soft halo.
 */
export const GLOW = 1.8;

let gradient: THREE.DataTexture | null = null;

/**
 * A 3-step lighting ramp. Toon materials snap their shading to these bands,
 * which gives the flat, painted look.
 */
export function toonGradient(): THREE.DataTexture {
  if (!gradient) {
    const data = new Uint8Array([90, 165, 255]);
    gradient = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
    gradient.minFilter = THREE.NearestFilter;
    gradient.magFilter = THREE.NearestFilter;
    gradient.generateMipmaps = false;
    gradient.needsUpdate = true;
  }
  return gradient;
}

export function toon(
  color: THREE.ColorRepresentation,
  opts: Omit<THREE.MeshToonMaterialParameters, 'color' | 'gradientMap'> = {},
): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...opts });
}

/**
 * Toon material with a hard-edged rim light: a bright band around the silhouette.
 * Used for characters (the ship and enemies) so they pop off the background.
 */
export function rimToon(
  color: THREE.ColorRepresentation,
  rimColor: THREE.ColorRepresentation,
  strength = 1,
): THREE.MeshToonMaterial {
  const m = toon(color);
  const rim = { value: new THREE.Color(rimColor).multiplyScalar(strength) };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.rimColor = rim;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 rimColor;')
      .replace(
        '#include <opaque_fragment>',
        `float facing = dot(normal, normalize(vViewPosition));
        outgoingLight += rimColor * smoothstep(0.62, 0.7, 1.0 - facing);
        #include <opaque_fragment>`,
      );
  };
  m.customProgramCacheKey = () => 'rim';
  return m;
}

/** Unlit, full-brightness material for glowing parts (engines, canopy, crystals). */
export function glow(
  color: THREE.ColorRepresentation,
  opts: Omit<THREE.MeshBasicMaterialParameters, 'color'> = {},
  intensity = GLOW,
): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ toneMapped: false, ...opts });
  m.color.set(color).multiplyScalar(intensity);
  return m;
}

// ---------------------------------------------------------------------------
// Ink outlines ("inverted hull"): a dark copy of each mesh, pushed out along its
// normals and drawn inside-out, so only a rim shows around the silhouette.
// Thickness scales with distance, so lines look the same width on screen.
// ---------------------------------------------------------------------------

const INK = new THREE.Color('#1b1233'); // deep indigo, softer than pure black
let outlineMat: THREE.ShaderMaterial | null = null;

export function outlineMaterial(): THREE.ShaderMaterial {
  if (outlineMat) return outlineMat;
  outlineMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { color: { value: INK }, thickness: { value: 0.0032 } },
    ]),
    vertexShader: /* glsl */ `
      uniform float thickness;
      #include <common>
      #include <fog_pars_vertex>
      void main() {
        mat4 model = modelMatrix;
        #ifdef USE_INSTANCING
          model = modelMatrix * instanceMatrix;
        #endif
        vec4 world = model * vec4(position, 1.0);
        vec3 worldNormal = normalize(mat3(model) * normal);
        float dist = length(cameraPosition - world.xyz);
        world.xyz += worldNormal * thickness * dist;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      #include <common>
      #include <fog_pars_fragment>
      void main() {
        gl_FragColor = vec4(color, 1.0);
        #include <fog_fragment>
      }`,
  });
  return outlineMat;
}

/**
 * Outline geometry with smooth normals. Flat-shaded shapes (rocks, crystals) have split
 * normals that would crack the outline at the corners, so vertices are merged first.
 */
const outlineGeoCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();
function outlineGeometry(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  let out = outlineGeoCache.get(geo);
  if (!out) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', geo.getAttribute('position'));
    if (geo.index) g.setIndex(geo.index);
    out = mergeVertices(g, 1e-3);
    out.computeVertexNormals();
    outlineGeoCache.set(geo, out);
  }
  return out;
}

/** Adds ink outlines to every toon-shaded mesh inside `root` (skips glows and flagged meshes). */
export function addOutlines(root: THREE.Object3D): void {
  const targets: THREE.Mesh[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && !o.userData.noOutline && !o.userData.isOutline && mesh.material instanceof THREE.MeshToonMaterial) {
      targets.push(mesh);
    }
  });
  for (const mesh of targets) {
    const line = new THREE.Mesh(outlineGeometry(mesh.geometry), outlineMaterial());
    line.userData.isOutline = true;
    mesh.add(line);
  }
}

/** Outline for an InstancedMesh: a twin that shares the same per-instance transforms. */
export function outlineInstanced(mesh: THREE.InstancedMesh): THREE.InstancedMesh {
  const line = new THREE.InstancedMesh(outlineGeometry(mesh.geometry), outlineMaterial(), mesh.count);
  line.instanceMatrix = mesh.instanceMatrix;
  line.count = mesh.count;
  line.userData.isOutline = true;
  return line;
}
