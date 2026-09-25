import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { explain, rank, simulate } from "../../src/calculations/scenario.js";

const DEFAULT = { w1: 1.5, w2: 1.5, w3: 1.5, w4: 1.5 };

// Priorities: A 11/3 = 3.67, B 10/5 = 2, C 5/8 = 0.63, D 3/2 = 1.5
const tickets = () => [
  { title: "A", benefit: 8, penalty: 3, estimate: 2, risk: 1 },
  { title: "B", benefit: 5, penalty: 5, estimate: 3, risk: 2 },
  { title: "C", benefit: 3, penalty: 2, estimate: 5, risk: 3 },
  { title: "D", benefit: 2, penalty: 1, estimate: 1, risk: 1 },
];

describe("rank", () => {
  it("orders by weighted priority and keeps ties in the given order", () => {
    assert.deepEqual(rank(tickets(), DEFAULT).map((t) => t.title), ["A", "B", "D", "C"]);
    const tied = [
      { title: "X", benefit: 1, penalty: 1, estimate: 1, risk: 1 },
      { title: "Y", benefit: 2, penalty: 2, estimate: 2, risk: 2 },
    ];
    assert.deepEqual(rank(tied, DEFAULT).map((t) => t.title), ["X", "Y"]);
  });
});

describe("simulate", () => {
  it("reports the changed ticket and the ones it pushed down, not the unmoved ones", () => {
    const r = simulate(tickets(), DEFAULT, { changes: [{ title: "C", estimate: 1, risk: 1 }] }, { top: 2, limit: 100 });
    assert.deepEqual(r.top, [{ rank: 1, title: "A", priority: 3.67 }, { rank: 2, title: "C", priority: 2.5 }]);
    assert.deepEqual(r.tickets, [
      { title: "C", baselineRank: 4, scenarioRank: 2, rankChange: 2, baselinePriority: 0.63, scenarioPriority: 2.5, change: "scores" },
      { title: "B", baselineRank: 2, scenarioRank: 3, rankChange: -1, baselinePriority: 2, scenarioPriority: 2 },
      { title: "D", baselineRank: 3, scenarioRank: 4, rankChange: -1, baselinePriority: 1.5, scenarioPriority: 1.5 },
    ]);
    assert.equal(r.moved, 3);
    assert.equal(r.total, 4);
  });

  it("adds and removes tickets, defaulting a new ticket's omitted scores to 1", () => {
    const r = simulate(tickets(), DEFAULT, { add: [{ title: "E", benefit: 21 }], remove: ["A"] }, { top: 10, limit: 100 });
    assert.deepEqual(r.top.map((t) => t.title), ["E", "B", "D", "C"]);
    const e = r.tickets.find((t) => t.title === "E")!;
    assert.deepEqual(e, { title: "E", baselineRank: null, scenarioRank: 1, rankChange: null, baselinePriority: null, scenarioPriority: 11, change: "added" });
    // Removed last, whatever its rank was
    assert.deepEqual(r.tickets.at(-1), { title: "A", baselineRank: 1, scenarioRank: null, rankChange: null, baselinePriority: 3.67, scenarioPriority: null, change: "removed" });
    assert.equal(r.total, 4);
  });

  it("ranks with hypothetical weights, keeping the omitted ones", () => {
    // Without benefit, A (3/3) ties B (5/5) and stays ahead, so nothing moves
    const r = simulate(tickets(), DEFAULT, { weights: { w1: 0 } }, { top: 4, limit: 100 });
    assert.deepEqual(r.scenarioWeights, { w1: 0, w2: 1.5, w3: 1.5, w4: 1.5 });
    assert.deepEqual(r.top.map((t) => [t.title, t.priority]), [["A", 1], ["B", 1], ["D", 0.5], ["C", 0.25]]);
    assert.deepEqual(r.tickets, []);
  });

  it("limits the rows but not the counts", () => {
    const r = simulate(tickets(), DEFAULT, { changes: [{ title: "C", estimate: 1, risk: 1 }] }, { top: 1, limit: 1 });
    assert.deepEqual(r.tickets.map((t) => t.title), ["C"]);
    assert.equal(r.moved, 3);
  });

  it("rejects unknown, doubled or contradictory tickets and invalid weights", () => {
    const run = (scenario: Parameters<typeof simulate>[2]) => () => simulate(tickets(), DEFAULT, scenario, { top: 1, limit: 1 });
    assert.throws(run({ changes: [{ title: "Z", risk: 1 }] }), /Ticket "Z" not found/);
    assert.throws(run({ remove: ["Z"] }), /Ticket "Z" not found/);
    assert.throws(run({ add: [{ title: "A" }] }), /A ticket with title "A" already exists/);
    assert.throws(run({ changes: [{ title: "A", risk: 2 }], remove: ["A"] }), /both changed and removed/);
    assert.throws(run({ changes: [{ title: "A", risk: 2 }, { title: "A", risk: 3 }] }), /changed twice/);
    assert.throws(run({ weights: { w3: 0, w4: 0 } }), /cannot both be zero/);
  });
});

describe("explain", () => {
  it("shows the formula with the weights, and the rank", () => {
    const e = explain(tickets(), DEFAULT, "C", 4);
    assert.equal(e.formula, "(1.5 × 3 + 1.5 × 2) / (1.5 × 5 + 1.5 × 3) = 7.5 / 12 = 0.63");
    assert.deepEqual([e.priority, e.rank, e.of, e.weightedValue, e.weightedCost], [0.63, 4, 4, 7.5, 12]);
    assert.deepEqual(e.target, { top: 4, reached: true, priorityToBeat: null, options: [] });
  });

  it("finds the smallest single score change that reaches the rank, where one does", () => {
    const e = explain(tickets(), DEFAULT, "C", 2);
    assert.equal(e.target.reached, false);
    assert.equal(e.target.priorityToBeat, 2); // B holds rank 2
    // Penalty 13 would tie B at 2, which keeps B ahead; estimate and risk
    // can't get C there at all
    assert.deepEqual(e.target.options, [
      { dimension: "benefit", from: 3, to: 21, priority: 2.88, rank: 2 },
      { dimension: "penalty", from: 2, to: 21, priority: 3, rank: 2 },
    ]);
  });

  it("rejects an unknown ticket", () => {
    assert.throws(() => explain(tickets(), DEFAULT, "Z", 1), /Ticket "Z" not found/);
  });
});
