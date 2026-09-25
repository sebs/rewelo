import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jsonChunks, toFile } from "../../src/transfer/json/stream.js";

describe("streamed JSON", () => {
  const samples: object[] = [
    {},
    { tickets: [] },
    {
      tickets: [
        { title: "A \"quoted\"\n", description: null, tags: [{ prefix: "state", value: "wip" }], skipped: undefined },
        { title: "B", tags: [], revisions: [{ n: 1, nested: { deep: [1, [2]] } }] },
        undefined,
      ],
      tags: [{ prefix: "state", value: "wip" }],
      relations: [],
      weights: { w1: 1.5, w2: 1.5 },
      missing: undefined,
      text: "ü😀",
    },
  ];

  const text = async (chunks: AsyncIterable<string>) => {
    let out = "";
    for await (const chunk of chunks) out += chunk;
    return out;
  };

  it("is exactly JSON.stringify(value, null, 2)", async () => {
    for (const value of samples) {
      assert.equal(await text(jsonChunks(value)), JSON.stringify(value, null, 2));
      assert.equal(await text(jsonChunks(value, { indent: false })), JSON.stringify(value));
    }
  });

  it("writes a list produced while writing like an array", async () => {
    async function* items() {
      yield { a: 1 };
      yield { b: [2] };
    }
    async function* none() {}
    assert.equal(await text(jsonChunks({ x: items(), y: none() })), JSON.stringify({ x: [{ a: 1 }, { b: [2] }], y: [] }, null, 2));
  });

  it("writes a file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rw-json-"));
    try {
      await toFile(join(dir, "x.json"))(jsonChunks(samples[2]));
      assert.equal(readFileSync(join(dir, "x.json"), "utf-8"), JSON.stringify(samples[2], null, 2));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
