import { strToU8, zipSync } from "three/addons/libs/fflate.module.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadModel,
  ModelTooLargeError,
  read3mfUnitScale,
} from "../src/loadModel.js";

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

describe("loadModel size limit", () => {
  const stubFetch = (body: BodyInit, headers: Record<string, string> = {}) => {
    const cancelled: boolean[] = [];
    vi.stubGlobal("fetch", async () => {
      const response = new Response(body, { headers });
      const cancel = response.body!.cancel.bind(response.body);
      response.body!.cancel = (reason) => {
        cancelled.push(true);
        return cancel(reason);
      };
      return response;
    });
    return cancelled;
  };

  afterEach(() => vi.unstubAllGlobals());

  it("rejects a declared size over the limit without reading the body", async () => {
    const cancelled = stubFetch(new Uint8Array(10), {
      "content-length": "2048",
    });

    await expect(loadModel("model.stl", { maxFileSize: 1024 })).rejects.toThrow(
      ModelTooLargeError,
    );
    expect(cancelled).toEqual([true]);
  });

  it("rejects a body that grows past the limit without a Content-Length", async () => {
    stubFetch(new Uint8Array(4096));

    await expect(loadModel("model.stl", { maxFileSize: 1024 })).rejects.toThrow(
      ModelTooLargeError,
    );
  });

  it("rejects a 3MF whose unpacked contents exceed the limit", () => {
    const bomb = zipSync({ "3D/3dmodel.model": new Uint8Array(4096) });
    const buffer = bomb.buffer.slice(
      bomb.byteOffset,
      bomb.byteOffset + bomb.byteLength,
    ) as ArrayBuffer;

    expect(buffer.byteLength).toBeLessThan(1024);
    expect(() => read3mfUnitScale(buffer, 1024)).toThrow(ModelTooLargeError);
  });
});
