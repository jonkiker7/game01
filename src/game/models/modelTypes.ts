/** Mesh data for one material: flat arrays of positions (xyz), normals (xyz) and triangle indices. */
export interface MeshData {
  p: number[];
  n: number[];
  i: number[];
}

/** A ship model exported from Blender, split by material name. */
export interface ShipModelData {
  /** Everything that doesn't move, already placed in ship space. */
  static: Record<string, MeshData>;
  /** Spinning fans: geometry in the rotor's own space (spin axis = local Y), plus where it sits. */
  rotors: Record<string, { geo: Record<string, MeshData>; pos: number[]; quat: number[] }>;
  /** Weapon attachment points (ship space). */
  hardpoints: Record<string, number[]>;
  /** Bounds of the tail hub, used to place the engine glows. */
  tail: { min: number[]; max: number[] };
}
