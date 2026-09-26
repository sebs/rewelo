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
    assert.deepEqual(dropped, [{ id: 'a"b' }]);
  });

  it("finds the request's id anywhere at the top level, not inside the parameters", async () => {
    const { dropped } = await run([`{"params":{"id":5,"x":"${"y".repeat(50)}"},"id":9}\n`, `{"id":7,"x":"${"y".repeat(50)}"}\n`], 40);
    assert.deepEqual(dropped, [{ id: 9 }, { id: 7 }]);
  });

  it("tells a notification (no answer due) from a message whose id can't be read", async () => {
    const long = "y".repeat(50);
    const { dropped } = await run([
      `{"jsonrpc":"2.0","method":"notifications/x","params":{"id":3,"v":"${long}"}}\n`,
      `{"jsonrpc":"2.0","params":{"v":"${long}"}}\n`,
      `[{"id":1,"method":"m","params":{"v":"${long}"}}]\n`,
      `{"method":"m","params":{"v":"}\\"{${long}"},"id":"x\\"y"}\n`,
    ], 40);
    assert.deepEqual(dropped, [{ notification: true }, { id: null }, { id: null }, { id: 'x"y' }]);
  });
});
