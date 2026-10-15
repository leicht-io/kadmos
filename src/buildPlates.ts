export interface BuildVolume {
  name: string;
  /** Extent along X, in millimeters. */
  width: number;
  /** Extent along Y, in millimeters. */
  depth: number;
  /** Extent along Z, in millimeters. */
  height: number;
}

export const BUILD_PLATES: Record<string, BuildVolume> = {
  "bambu-x1": {
    name: "Bambu Lab X1 / P1 / A1",
    width: 256,
    depth: 256,
    height: 256,
  },
  "bambu-a1-mini": {
    name: "Bambu Lab A1 mini",
    width: 180,
    depth: 180,
    height: 180,
  },
  "prusa-mk4": { name: "Prusa MK4", width: 250, depth: 210, height: 220 },
  "prusa-mini": { name: "Prusa MINI+", width: 180, depth: 180, height: 180 },
  "prusa-xl": { name: "Prusa XL", width: 360, depth: 360, height: 360 },
  "ender-3": { name: "Creality Ender-3", width: 220, depth: 220, height: 250 },
  "voron-350": { name: "Voron 2.4 (350)", width: 350, depth: 350, height: 340 },
};

/**
 * Resolves a build plate from a preset id (`prusa-mk4`) or explicit
 * dimensions in millimeters (`250x210x220`).
 */
export function parseBuildVolume(
  raw: string | null | undefined,
): BuildVolume | undefined {
  if (!raw) {
    return undefined;
  }

  const value = raw.trim().toLowerCase();
  if (BUILD_PLATES[value]) {
    return BUILD_PLATES[value];
  }

  const match = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/.exec(value);
  if (!match) {
    return undefined;
  }

  const [width, depth, height] = match.slice(1).map(Number);
  if (width <= 0 || depth <= 0 || height <= 0) {
    return undefined;
  }

  return { name: `${width} × ${depth} × ${height} mm`, width, depth, height };
}

export interface FitResult {
  fits: boolean;
  /** True when the model only fits after a 90° turn on the plate. */
  rotated: boolean;
  /** How far the model overhangs the volume on each axis, as placed. */
  overflow: { x: number; y: number; z: number };
}

export function checkFit(
  size: { x: number; y: number; z: number },
  plate: BuildVolume,
): FitResult {
  const overflow = {
    x: Math.max(0, size.x - plate.width),
    y: Math.max(0, size.y - plate.depth),
    z: Math.max(0, size.z - plate.height),
  };

  const fitsAsPlaced = overflow.x === 0 && overflow.y === 0 && overflow.z === 0;
  const fitsRotated =
    size.y <= plate.width && size.x <= plate.depth && size.z <= plate.height;

  return {
    fits: fitsAsPlaced || fitsRotated,
    rotated: !fitsAsPlaced && fitsRotated,
    overflow,
  };
}
