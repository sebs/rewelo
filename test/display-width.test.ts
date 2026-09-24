import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { displayWidth } from "../src/display-width.js";

describe("displayWidth", () => {
  it("counts ASCII, CJK and combining marks", () => {
    assert.equal(displayWidth("abc"), 3);
    assert.equal(displayWidth("日本"), 4);
    assert.equal(displayWidth("é"), 1);
  });

  it("counts emoji as two columns, whatever their block", () => {
    assert.equal(displayWidth("🚀"), 2);
    assert.equal(displayWidth("🚢"), 2);
    assert.equal(displayWidth("💻"), 2);
    assert.equal(displayWidth("❤️"), 2);
    assert.equal(displayWidth("👨‍👩‍👧"), 2);
    assert.equal(displayWidth("🇩🇪"), 2);
    assert.equal(displayWidth("👍🏽"), 2);
  });

  it("counts text-style symbols as one column", () => {
    assert.equal(displayWidth("❤"), 1);
    assert.equal(displayWidth("©"), 1);
  });
});
