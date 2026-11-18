import * as THREE from 'three';

let gradient: THREE.DataTexture | null = null;

/**
 * A 3-step lighting ramp. Toon materials snap their shading to these bands,
 * which gives the flat, painted look we're going for (outlines & bloom come in the art pass).
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

/** Unlit, full-brightness material for glowing parts (engines, canopy, crystals). */
export function glow(
  color: THREE.ColorRepresentation,
  opts: Omit<THREE.MeshBasicMaterialParameters, 'color'> = {},
): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, toneMapped: false, ...opts });
}
