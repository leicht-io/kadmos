import { Box3, Mesh, Object3D, Vector3 } from "three";

export interface ModelStats {
  /** Bounding box extents, in millimeters. */
  size: Vector3;
  /** Enclosed volume in cubic millimeters (meaningful for closed meshes). */
  volume: number;
  triangles: number;
}

const a = new Vector3();
const b = new Vector3();
const c = new Vector3();

/**
 * Measures a model in world space. Expects `object.matrixWorld` to be up
 * to date.
 */
export function computeModelStats(object: Object3D): ModelStats {
  const size = new Box3().setFromObject(object).getSize(new Vector3());
  let volume = 0;
  let triangles = 0;

  object.traverse((child) => {
    if (!(child instanceof Mesh)) {
      return;
    }

    const position = child.geometry.getAttribute("position");
    const index = child.geometry.getIndex();
    const count = index ? index.count : position.count;
    let meshVolume = 0;

    // Sum the signed volumes of the tetrahedra formed by each triangle
    // and the origin; for a closed mesh the outside contributions cancel.
    for (let i = 0; i + 2 < count; i += 3) {
      const ia = index ? index.getX(i) : i;
      const ib = index ? index.getX(i + 1) : i + 1;
      const ic = index ? index.getX(i + 2) : i + 2;

      a.fromBufferAttribute(position, ia).applyMatrix4(child.matrixWorld);
      b.fromBufferAttribute(position, ib).applyMatrix4(child.matrixWorld);
      c.fromBufferAttribute(position, ic).applyMatrix4(child.matrixWorld);

      meshVolume += a.dot(b.cross(c)) / 6;
    }

    // Per mesh, so a mirrored part (negative winding) doesn't subtract.
    volume += Math.abs(meshVolume);
    triangles += Math.floor(count / 3);
  });

  return { size, volume, triangles };
}
