import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MAX_RESULT_BYTES, textResult } from "../../src/mcp/results.js";

describe("textResult", () => {
  it("limits the result as sent: the data twice, and the text escaped", () => {
    // 3 MB of data is under the limit once, but goes out as over 6 MB
    const data = { items: ["x".repeat(3_000_000)] };
    assert.ok(JSON.stringify(data).length < MAX_RESULT_BYTES);
    assert.throws(() => textResult(data), /The result is too large \(6\.0 MB, max 5 MB\)/);

    // Quotes double in the escaped text
    assert.throws(() => textResult({ items: ['"'.repeat(1_800_000)] }), /too large/);

    const fits = textResult({ items: ["x".repeat(2_000_000)] });
    assert.ok(Buffer.byteLength(JSON.stringify(fits)) <= MAX_RESULT_BYTES);
  });

  it("counts a document, which goes out as text only, once", () => {
    // 3.6 MB with its newlines escaped: twice over the limit if it were sent twice
    const csv = "title\n" + "abc,def,ghi\n".repeat(300_000);
    assert.equal(textResult(csv).content[0].text, csv);
  });
});
