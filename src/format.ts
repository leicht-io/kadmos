// Kept free of three.js imports so the page-level UI can use these
// without pulling the 3D engine into the initial bundle.

export function formatLength(millimeters: number): string {
  const digits = millimeters < 10 ? 2 : millimeters < 1000 ? 1 : 0;

  return millimeters.toFixed(digits);
}

export function formatVolume(cubicMillimeters: number): string {
  const cubicCentimeters = cubicMillimeters / 1000;
  const digits = cubicCentimeters < 10 ? 2 : 1;

  return `${cubicCentimeters.toFixed(digits)} cm³`;
}
