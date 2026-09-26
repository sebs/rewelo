import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MAX_RESULT_BYTES, textResult, ToolResult } from "../../src/mcp/results.js";
import { documentOrLink } from "../../src/mcp/documents.js";

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

  it("links a document whenever the tool result would be too large, also just under 5 MB", async () => {
    // Under 5 MB as the document is measured, just over as the tool result
    // (whose envelope adds a few bytes)
    for (const text of ["x".repeat(MAX_RESULT_BYTES - 10), '"'.repeat(2_600_000)]) {
      const result = await documentOrLink(async () => text, "rewelo://P/export/csv", "CSV export", "text/csv");
      assert.ok(result instanceof ToolResult);
      assert.equal((result.result.content as Array<{ type: string }>)[1]?.type, "resource_link");
    }
    const small = await documentOrLink(async () => "title\nA\n", "rewelo://P/export/csv", "CSV export", "text/csv");
    assert.equal((small.result.content as Array<{ text: string }>)[0].text, "title\nA\n");
  });
});
