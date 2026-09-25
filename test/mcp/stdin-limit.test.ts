import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { limitLines } from "../../src/mcp/stdin-limit.js";

async function run(chunks: string[], max: number): Promise<{ out: string; dropped: unknown[] }> {
  const dropped: unknown[] = [];
  const limiter = limitLines(max, (id) => dropped.push(id));
  let out = "";
  limiter.on("data", (d) => (out += d));
  for (const chunk of chunks) limiter.write(Buffer.from(chunk));
  limiter.end();
  await new Promise((done) => limiter.once("end", done));
  return { out, dropped };
}

describe("limitLines", () => {
  it("passes lines within the limit on unchanged, also split across chunks", async () => {
    const { out, dropped } = await run(['{"id":1}\n{"i', 'd":2}\n', '{"id":3}\n'], 10);
    assert.equal(out, '{"id":1}\n{"id":2}\n{"id":3}\n');
    assert.deepEqual(dropped, []);
  });

  it("drops a line over the limit and names its id, keeping the lines around it", async () => {
    const long = `{"jsonrpc":"2.0","id":"a\\"b","params":{"x":"${"y".repeat(50)}"}}`;
    const { out, dropped } = await run(['{"id":1}\n', long.slice(0, 30), long.slice(30) + "\n", '{"id":3}\n'], 40);
    // The part passed on before the line was known to be too long ends in a
    // newline of its own (a line that isn't JSON, which is skipped)
    assert.deepEqual(out.split("\n"), ['{"id":1}', long.slice(0, 30), '{"id":3}', ""]);
    assert.deepEqual(dropped, ['a"b']);
  });

  it("doesn't take an id inside the parameters for the request's", async () => {
    const { dropped } = await run([`{"params":{"id":5,"x":"${"y".repeat(50)}"},"id":9}\n`, `{"id":7,"x":"${"y".repeat(50)}"}\n`], 40);
    assert.deepEqual(dropped, [undefined, 7]);
  });
});
