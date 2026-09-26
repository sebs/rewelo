import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calibrate, parseSuggestion, similarity, words } from "../../src/reports/calibration.js";

const ticket = (title: string, benefit: number, estimate: number, description: string | null = null) =>
  ({ title, description, benefit, penalty: 1, estimate, risk: 1 });

describe("calibrate", () => {
  const tickets = [
    ticket("Export CSV", 3, 2),
    ticket("Login page", 8, 5, "Users sign in with email"),
    ticket("Login form validation", 5, 3),
    ticket("Dark mode", 2, 8),
  ];

  it("measures similarity by shared words, ignoring case, punctuation and common words", () => {
    assert.deepEqual([...words("The Login-Page, for users!")], ["login", "page", "users"]);
    assert.equal(similarity(words("Login page"), words("login page redesign")), 2 / 3);
    assert.equal(similarity(words("Login page"), words("Dark mode")), 0);
  });

  it("lists similar tickets, most similar first, and none that share nothing", () => {
    const { similar } = calibrate(tickets, "Login page redesign");
    // login page redesign / login page users sign in email: 2 of 7 words
    assert.deepEqual(similar.map((s) => [s.title, s.similarity]), [["Login page", 0.29], ["Login form validation", 0.2]]);
    assert.deepEqual([similar[0].benefit, similar[0].estimate], [8, 5]);
  });

  it("finds the scores in an answer with braces around them", () => {
    const scores = '{"benefit": 5, "penalty": 3, "estimate": 2, "risk": 1}';
    for (const answer of [
      `Considering {Big} and the rest: ${scores}`,
      "```json\n" + scores + "\n```\nNote: the {estimate} is low",
      `{"note": "nested {braces}"} then ${scores}`,
    ]) {
      assert.deepEqual(parseSuggestion(answer), { benefit: 5, penalty: 3, estimate: 2, risk: 1 }, answer);
    }
  });

  it("reads a large answer quickly: in one pass, and only its start", () => {
    const scores = '{"benefit": 5, "penalty": 3, "estimate": 2, "risk": 1}';
    const started = Date.now();
    assert.equal(parseSuggestion("{".repeat(200_000)), undefined);
    assert.deepEqual(parseSuggestion("{".repeat(10_000) + scores), { benefit: 5, penalty: 3, estimate: 2, risk: 1 });
    // Every level valid JSON: only the start of such an answer is read
    assert.equal(parseSuggestion('{"a":'.repeat(50_000) + "1" + "}".repeat(50_000)), undefined);
    assert.ok(Date.now() - started < 1000, `took ${Date.now() - started} ms`);
  });

  it("cuts excerpts and the model's reasoning between characters, not inside an emoji", () => {
    const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    const { references } = calibrate([ticket("Party", 1, 1, "x".repeat(199) + "🎉 tail")], "Party");
    assert.doesNotMatch(references.benefit[0].description!, loneSurrogate);
    const suggestion = parseSuggestion(JSON.stringify({ benefit: 1, penalty: 1, estimate: 1, risk: 1, reasoning: "a".repeat(999) + "🎉" }));
    assert.doesNotMatch(suggestion!.reasoning!, loneSurrogate);
  });

  it("lists no similar ticket whose similarity rounds to 0", () => {
    // 1 shared word of 301
    const long = ticket("Big", 1, 1, ["login", ...Array.from({ length: 299 }, (_, i) => `w${i}`)].join(" "));
    assert.deepEqual(calibrate([long], "login").similar, []);
  });

  it("rounds similarities half up, as every other number rw shows", () => {
    // 23 shared words of 40: 0.575, which is 0.57499999999999996 as a double
    const wordList = Array.from({ length: 40 }, (_, i) => `word${i}`);
    const { similar } = calibrate([ticket(wordList.slice(0, 23).join(" "), 1, 1)], wordList.join(" "));
    assert.equal(similar[0].similarity, 0.58);
  });

  it("gives, per dimension and score, the closest ticket with that score", () => {
    const { references } = calibrate(tickets, "Login page redesign");
    assert.deepEqual(references.benefit.map((r) => [r.score, r.title]), [[2, "Dark mode"], [3, "Export CSV"], [5, "Login form validation"], [8, "Login page"]]);
    // Every ticket has penalty 1: the closest one stands for it
    assert.deepEqual(references.penalty, [{ score: 1, title: "Login page", description: "Users sign in with email" }]);
  });
});

describe("parseSuggestion", () => {
  it("reads the scores from a model's JSON answer, also inside other text", () => {
    assert.deepEqual(parseSuggestion('Sure: {"benefit": 8, "penalty": 3, "estimate": 5, "risk": 2, "reasoning": "Like Login page"}'),
      { benefit: 8, penalty: 3, estimate: 5, risk: 2, reasoning: "Like Login page" });
  });

  it("rejects answers without four Fibonacci scores", () => {
    assert.equal(parseSuggestion("I can't tell"), undefined);
    assert.equal(parseSuggestion('{"benefit": 4, "penalty": 3, "estimate": 5, "risk": 2}'), undefined);
    assert.equal(parseSuggestion('{"benefit": 8, "penalty": 3, "estimate": 5}'), undefined);
    assert.equal(parseSuggestion("{not json}"), undefined);
  });
});
