export type Rgb = [number, number, number];

/**
 * three.js' NeutralToneMapping (Khronos PBR Neutral) at exposure 1, for
 * linear RGB. Mirrors the shader in tonemapping_pars_fragment.
 */
export function neutralToneMap([r, g, b]: Rgb): Rgb {
  const startCompression = 0.8 - 0.04;
  const desaturation = 0.15;

  const x = Math.min(r, g, b);
  const offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  let color: Rgb = [r - offset, g - offset, b - offset];

  const peak = Math.max(...color);
  if (peak < startCompression) {
    return color;
  }

  const d = 1 - startCompression;
  const newPeak = 1 - (d * d) / (peak + d - startCompression);
  color = color.map((channel) => (channel * newPeak) / peak) as Rgb;
  const mix = 1 - 1 / (desaturation * (peak - newPeak) + 1);

  return color.map((channel) => channel + (newPeak - channel) * mix) as Rgb;
}

/**
 * Finds the linear color that neutralToneMap() turns into `target`, so
 * flat colors like the backdrop render exactly as specified instead of
 * having their darks saturated and their highlights compressed. Targets
 * at or above 1 can't be reached and are capped just below it.
 */
export function inverseNeutralToneMap(target: Rgb): Rgb {
  const goal = target.map((channel) => Math.min(channel, 0.995)) as Rgb;
  let color: Rgb = [...goal];

  // Newton's method per channel, with the slope measured numerically:
  // the mapping is monotonic per channel but nearly flat close to white,
  // where plain fixed-point steps would crawl.
  for (let i = 0; i < 50; i++) {
    const mapped = neutralToneMap(color);
    color = color.map((channel, index) => {
      const nudged: Rgb = [...color];
      nudged[index] += 1e-5;
      const slope = (neutralToneMap(nudged)[index] - mapped[index]) / 1e-5;
      const step = slope > 1e-6 ? (goal[index] - mapped[index]) / slope : 0;

      return Math.max(0, channel + step);
    }) as Rgb;
  }

  return color;
}
