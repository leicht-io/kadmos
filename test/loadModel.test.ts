import { strToU8, zipSync } from "three/addons/libs/fflate.module.js";
import { describe, expect, it } from "vitest";
import { read3mfUnitScale } from "../src/loadModel.js";

function make3mf(modelAttributes: string): ArrayBuffer {
  const zip = zipSync({
    "3D/3dmodel.model": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><model ${modelAttributes} xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources/><build/></model>`,
    ),
  });

  return zip.buffer.slice(
    zip.byteOffset,
    zip.byteOffset + zip.byteLength,
  ) as ArrayBuffer;
}

describe("read3mfUnitScale", () => {
  it("converts declared units to millimeters", () => {
    expect(read3mfUnitScale(make3mf('unit="inch"'))).toBe(25.4);
    expect(read3mfUnitScale(make3mf('xml:lang="en" unit="centimeter"'))).toBe(
      10,
    );
    expect(read3mfUnitScale(make3mf('unit="micron"'))).toBe(0.001);
  });

  it("defaults to millimeters", () => {
    expect(read3mfUnitScale(make3mf(""))).toBe(1);
    expect(read3mfUnitScale(make3mf('unit="parsec"'))).toBe(1);
  });
});
