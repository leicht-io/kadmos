import { describe, expect, it } from "vitest";
import {
  inverseNeutralToneMap,
  neutralToneMap,
  Rgb,
} from "../src/toneMapping.js";

describe("inverseNeutralToneMap", () => {
  const targets: Rgb[] = [
    [0.024, 0.028, 0.039], // dark backdrop: the toe would saturate it
    [0.1, 0.2, 0.3],
    [0.78, 0.8, 0.84], // light backdrop: in the highlight compression
  ];

  it.each(targets)("round-trips %j through the tone mapping", (...target) => {
    const mapped = neutralToneMap(inverseNeutralToneMap(target));
    mapped.forEach((channel, index) =>
      expect(channel).toBeCloseTo(target[index], 4),
    );
  });

  it("caps unreachable targets just below white", () => {
    const mapped = neutralToneMap(inverseNeutralToneMap([1, 1, 1]));
    for (const channel of mapped) {
      expect(channel).toBeGreaterThan(0.99);
      expect(channel).toBeLessThan(1);
    }
  });
});
