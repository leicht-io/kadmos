import { describe, expect, it } from "vitest";
import { parseFlag } from "../src/options.js";

describe("parseFlag", () => {
  it("reads common spellings of true and false", () => {
    for (const value of ["true", "1", "on", " TRUE ", true]) {
      expect(parseFlag(value)).toBe(true);
    }
    for (const value of ["false", "0", "off", "Off", false]) {
      expect(parseFlag(value)).toBe(false);
    }
  });

  it("leaves anything else to the default", () => {
    for (const value of [undefined, null, "", "yes please"]) {
      expect(parseFlag(value)).toBeUndefined();
    }
  });
});
