import { describe, expect, it } from "vitest";
import {
  BUILD_PLATES,
  checkFit,
  parseBuildVolume,
} from "../src/buildPlates.js";

describe("parseBuildVolume", () => {
  it("resolves preset ids case-insensitively", () => {
    expect(parseBuildVolume("Prusa-MK4")).toBe(BUILD_PLATES["prusa-mk4"]);
  });

  it("parses explicit dimensions", () => {
    expect(parseBuildVolume("250x210x220.5")).toMatchObject({
      width: 250,
      depth: 210,
      height: 220.5,
    });
  });

  it("rejects unknown or degenerate values", () => {
    for (const value of [undefined, "", "nope", "0x10x10", "10x10", "-1x2x3"]) {
      expect(parseBuildVolume(value)).toBeUndefined();
    }
  });
});

describe("checkFit", () => {
  const plate = { name: "test", width: 200, depth: 100, height: 50 };

  it("fits as placed", () => {
    expect(checkFit({ x: 200, y: 100, z: 50 }, plate)).toEqual({
      fits: true,
      rotated: false,
      overflow: { x: 0, y: 0, z: 0 },
    });
  });

  it("fits only when turned 90° on the plate", () => {
    const fit = checkFit({ x: 90, y: 150, z: 10 }, plate);
    expect(fit.fits).toBe(true);
    expect(fit.rotated).toBe(true);
    expect(fit.overflow.y).toBe(50);
  });

  it("reports overflow per axis when it doesn't fit", () => {
    const fit = checkFit({ x: 250, y: 50, z: 60 }, plate);
    expect(fit.fits).toBe(false);
    expect(fit.overflow).toEqual({ x: 50, y: 0, z: 10 });
  });
});
