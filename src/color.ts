export const DEFAULT_COLOR = 0x626262;

// True black reads as a featureless silhouette against the viewer's
// shadows, so any spelling of black is nudged to a dark gray that still
// reads as "black".
const NEAR_BLACK = 0x444444;

/**
 * Parses a user-supplied color. Accepts `0x` hex (`0x3b6ea5`, `0x0`) and
 * CSS-style hex (`#3b6ea5`, `#fff`). Returns `undefined` when the value is
 * missing or malformed, so callers can fall back to the model's own colors
 * or the default instead of rendering `NaN` (which three.js turns into
 * black).
 */
export function parseColor(raw: string | null | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }

  const value = raw.trim();
  let hex: string | undefined;

  const prefixed = /^0x([0-9a-f]{1,6})$/i.exec(value);
  if (prefixed) {
    hex = prefixed[1];
  }

  const css = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (css) {
    hex =
      css[1].length === 3
        ? css[1]
            .split("")
            .map((digit) => digit + digit)
            .join("")
        : css[1];
  }

  if (hex === undefined) {
    return undefined;
  }

  const color = parseInt(hex, 16);

  return color === 0 ? NEAR_BLACK : color;
}
