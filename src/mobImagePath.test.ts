import { describe, expect, it } from "vitest";
import { getMobImagePath, isGifMobImagePath } from "./mobImagePath";

describe("mobImagePath", () => {
  it("normalizes mob image file names to the local asset directory", () => {
    expect(getMobImagePath({ imagePath: "https://example.com/assets/mobs/bat.gif?cache=1" })).toBe("/images/mobs/bat.gif");
  });

  it("detects gif image paths even when they include query strings", () => {
    expect(isGifMobImagePath("/images/mobs/bat.gif?cache=1")).toBe(true);
    expect(isGifMobImagePath("/images/mobs/cow.png")).toBe(false);
    expect(isGifMobImagePath()).toBe(false);
  });
});
