import { describe, it, expect } from "vitest";
import { VERSION } from "../src/version.generated.js";

describe("version.generated", () => {
  it("exports a semver-like version string", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("is not the dev placeholder", () => {
    // After `npm run build`, VERSION should match package.json
    expect(VERSION).not.toBe("0.0.0-dev");
  });
});
