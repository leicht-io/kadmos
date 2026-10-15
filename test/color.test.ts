import { describe, expect, it } from "vitest";
import { parseColor } from "../src/color.js";

describe("parseColor", () => {
  it("parses 0x-prefixed hex", () => {
    expect(parseColor("0x3b6ea5")).toBe(0x3b6ea5);
    expect(parseColor(" 0X3B6EA5 ")).toBe(0x3b6ea5);
  });

  it("parses CSS-style hex, including the short form", () => {
    expect(parseColor("#3b6ea5")).toBe(0x3b6ea5);
    expect(parseColor("#fa0")).toBe(0xffaa00);
  });

  it("nudges any spelling of black to dark gray", () => {
    for (const black of ["0x000000", "0x0", "#000", "#000000"]) {
      expect(parseColor(black)).toBe(0x444444);
    }
  });

  it("rejects missing and malformed values instead of returning NaN", () => {
    for (const value of [
      null,
      undefined,
      "",
      "red",
      "0x",
      "#12",
      "333333",
      "0x1234567",
    ]) {
      expect(parseColor(value)).toBeUndefined();
    }
  });
});
