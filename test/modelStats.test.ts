import { BoxGeometry, Group, Mesh } from "three";
import { describe, expect, it } from "vitest";
import { computeModelStats } from "../src/modelStats.js";
import { formatLength, formatVolume } from "../src/format.js";

describe("computeModelStats", () => {
  it("measures size, volume and triangles in world space", () => {
    const group = new Group();
    const mesh = new Mesh(new BoxGeometry(10, 20, 30));
    mesh.scale.set(2, 1, 1);
    group.add(mesh);
    group.updateMatrixWorld(true);

    const stats = computeModelStats(group);

    expect(stats.size.toArray()).toEqual([20, 20, 30]);
    expect(stats.volume).toBeCloseTo(12000);
    expect(stats.triangles).toBe(12);
  });

  it("doesn't let a mirrored part subtract volume", () => {
    const group = new Group();
    const mirrored = new Mesh(new BoxGeometry(10, 10, 10));
    mirrored.scale.x = -1;
    group.add(new Mesh(new BoxGeometry(10, 10, 10)), mirrored);
    group.updateMatrixWorld(true);

    expect(computeModelStats(group).volume).toBeCloseTo(2000);
  });
});

describe("formatting", () => {
  it("uses more precision for small lengths", () => {
    expect(formatLength(4.567)).toBe("4.57");
    expect(formatLength(45.67)).toBe("45.7");
    expect(formatLength(4567.8)).toBe("4568");
  });

  it("formats volume in cubic centimeters", () => {
    expect(formatVolume(1234)).toBe("1.23 cm³");
    expect(formatVolume(123456)).toBe("123.5 cm³");
  });
});
