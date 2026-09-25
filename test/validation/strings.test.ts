import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ValidationError } from "../../src/errors.js";
import { truncate } from "../../src/text.js";
import { validateProjectName, validateTicketTitle, validateTicketDescription, validateTagPrefix, validateTagValue } from "../../src/validation/strings.js";

describe("truncate", () => {
  it("never cuts an emoji in half", () => {
    assert.equal(truncate("ab", 5), "ab");
    assert.equal(truncate("a😀b", 3), "a😀");
    assert.equal(truncate("a😀b", 2), "a");
    assert.doesNotMatch(truncate("😀".repeat(10), 7), /[\uD800-\uDBFF]$/);
  });

  it("keeps flags and joined emoji whole", () => {
    assert.equal(truncate("ab" + "🇩🇪".repeat(3), 8), "ab🇩🇪");
    const family = "👨‍👩‍👧";
    assert.equal(truncate("a" + family.repeat(2), 1 + family.length + 4), "a" + family);
  });
});

describe("validateProjectName", () => {
  it("accepts valid names", () => {
    assert.equal(validateProjectName("Acme"), "Acme");
    assert.equal(validateProjectName("my-project"), "my-project");
    assert.equal(validateProjectName("project_123"), "project_123");
    assert.equal(validateProjectName("My Project"), "My Project");
  });

  it("trims whitespace", () => {
    assert.equal(validateProjectName("  Acme  "), "Acme");
  });

  it("rejects empty names", () => {
    assert.throws(() => validateProjectName(""), ValidationError);
    assert.throws(() => validateProjectName("  "), ValidationError);
  });

  it("rejects null bytes", () => {
    assert.throws(() => validateProjectName("Acme\0Corp"), /null bytes/);
  });

  it("rejects names exceeding max length", () => {
    assert.throws(() => validateProjectName("a".repeat(101)), /exceed/);
  });

  it("rejects special characters", () => {
    assert.throws(() => validateProjectName("Acme; DROP TABLE"), ValidationError);
    assert.throws(() => validateProjectName("project<script>"), ValidationError);
    assert.throws(() => validateProjectName("../etc/passwd"), ValidationError);
  });

  it("NFC normalises unicode", () => {
    // é as combining e + acute vs precomposed é - test on ticket title since project names restrict to ASCII
    const combining = "e\u0301";
    const precomposed = "\u00e9";
    assert.equal(validateTicketTitle(combining), validateTicketTitle(precomposed));
  });
});

describe("validateTicketTitle", () => {
  it("accepts valid titles", () => {
    assert.equal(validateTicketTitle("Login page"), "Login page");
    assert.equal(validateTicketTitle("Fix bug #123"), "Fix bug #123");
  });

  it("rejects empty titles", () => {
    assert.throws(() => validateTicketTitle(""), ValidationError);
  });

  it("rejects null bytes", () => {
    assert.throws(() => validateTicketTitle("title\0bad"), /null bytes/);
  });

  it("rejects titles exceeding max length", () => {
    assert.throws(() => validateTicketTitle("a".repeat(501)), /exceed/);
  });
});

describe("validateTicketDescription", () => {
  it("passes through undefined", () => {
    assert.equal(validateTicketDescription(undefined), undefined);
  });

  it("accepts valid descriptions", () => {
    assert.equal(validateTicketDescription("Some description"), "Some description");
  });

  it("rejects null bytes", () => {
    assert.throws(() => validateTicketDescription("desc\0bad"), /null bytes/);
  });

  it("rejects descriptions exceeding max length", () => {
    assert.throws(() => validateTicketDescription("a".repeat(10_001)), /exceed/);
  });
});

describe("validateTagPrefix", () => {
  it("accepts valid prefixes", () => {
    assert.equal(validateTagPrefix("state"), "state");
    assert.equal(validateTagPrefix("feature"), "feature");
    assert.equal(validateTagPrefix("my-prefix"), "my-prefix");
  });

  it("lowercases input", () => {
    assert.equal(validateTagPrefix("STATE"), "state");
  });

  it("rejects empty prefixes", () => {
    assert.throws(() => validateTagPrefix(""), ValidationError);
  });

  it("rejects null bytes", () => {
    assert.throws(() => validateTagPrefix("state\0"), /null bytes/);
  });

  it("rejects special characters", () => {
    assert.throws(() => validateTagPrefix("state:value"), ValidationError);
    assert.throws(() => validateTagPrefix("my prefix"), ValidationError);
    assert.throws(() => validateTagPrefix("my_prefix"), ValidationError);
  });

  it("rejects prefixes exceeding max length", () => {
    assert.throws(() => validateTagPrefix("a".repeat(51)), /exceed/);
  });

  it("rejects SQL injection payloads", () => {
    assert.throws(() => validateTagPrefix("'; DROP TABLE--"), ValidationError);
  });
});

describe("validateTagValue", () => {
  it("accepts valid values", () => {
    assert.equal(validateTagValue("backlog"), "backlog");
    assert.equal(validateTagValue("in-progress"), "in-progress");
  });

  it("lowercases input", () => {
    assert.equal(validateTagValue("WIP"), "wip");
  });

  it("rejects empty values", () => {
    assert.throws(() => validateTagValue(""), ValidationError);
  });

  it("rejects values exceeding max length", () => {
    assert.throws(() => validateTagValue("a".repeat(101)), /exceed/);
  });
});

describe("control characters", () => {
  it("are rejected in ticket titles", () => {
    assert.throws(() => validateTicketTitle("esc\u001b[31mRED"), /must not contain control characters/);
    assert.throws(() => validateTicketTitle("tab\there"), /must not contain control characters/);
    assert.throws(() => validateTicketTitle("c1\u009bx"), /must not contain control characters/);
  });

  it("are rejected in descriptions except line breaks and tabs", () => {
    assert.equal(validateTicketDescription("line1\nline2\r\n\tindented"), "line1\nline2\r\n\tindented");
    assert.throws(() => validateTicketDescription("esc\u001b[31mRED"), /must not contain control characters/);
  });
});

describe("invisible and text-direction characters", () => {
  it("rejects bidi overrides and invisible spaces in titles", () => {
    for (const title of ["\u202Eevil", "zero\u200Bwidth", "a\u2066b\u2069", "\uFEFFbom"]) {
      assert.throws(() => validateTicketTitle(title), /invisible or text-direction/, JSON.stringify(title));
    }
  });

  it("keeps joiners that emoji sequences need", () => {
    assert.equal(validateTicketTitle("Family \u{1F468}\u200D\u{1F469}\u200D\u{1F467}"), "Family \u{1F468}\u200D\u{1F469}\u200D\u{1F467}");
  });
});

describe("project name spacing", () => {
  it("rejects consecutive spaces, which look like a single one in listings", () => {
    assert.throws(() => validateProjectName("a  b"), /consecutive spaces/);
    assert.equal(validateProjectName("a b"), "a b");
  });
});

describe("line separators", () => {
  it("rejects Unicode line and paragraph separators in titles like newlines", () => {
    assert.throws(() => validateTicketTitle("first\u2028second"), /must not contain newline characters/);
    assert.throws(() => validateTicketTitle("first\u2029second"), /must not contain newline characters/);
  });
});

describe("invalid UTF-8", () => {
  it("rejects titles containing the replacement character invalid UTF-8 decodes to", () => {
    assert.throws(() => validateTicketTitle(Buffer.from([0x78, 0xff]).toString("utf-8")), /not valid UTF-8/);
  });
});

describe("invisible characters by category", () => {
  it("rejects every invisible or bidi character, not just a hand-picked few", () => {
    for (const ch of ["\u00AD", "\u061C", "\u180E", "\u034F", "\u3164", "\u115F", "\u206A", "\uFFF9", "\u2800", "\u{E0001}", "\u{1D173}"]) {
      assert.throws(() => validateTicketTitle(`Login page${ch}`), /invisible or text-direction/, ch.codePointAt(0)!.toString(16));
    }
  });

  it("rejects titles made only of joiners", () => {
    for (const title of ["\u200D", "\u200C", "\u200D\u200D"]) {
      assert.throws(() => validateTicketTitle(title), /invisible or text-direction/);
    }
  });

  it("keeps emoji sequences with variation selectors and tags", () => {
    validateTicketTitle("Love \u2764\uFE0F");
    validateTicketTitle("Scotland \u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}");
  });
});
