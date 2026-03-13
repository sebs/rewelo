import { describe, it, expect } from "vitest";
import {
  validateProjectName,
  validateTicketTitle,
  validateTicketDescription,
  validateTagPrefix,
  validateTagValue,
  ValidationError,
} from "../../src/validation/strings.js";

describe("validateProjectName", () => {
  it("accepts valid names", () => {
    expect(validateProjectName("Acme")).toBe("Acme");
    expect(validateProjectName("my-project")).toBe("my-project");
    expect(validateProjectName("project_123")).toBe("project_123");
    expect(validateProjectName("My Project")).toBe("My Project");
  });

  it("trims whitespace", () => {
    expect(validateProjectName("  Acme  ")).toBe("Acme");
  });

  it("rejects empty names", () => {
    expect(() => validateProjectName("")).toThrow(ValidationError);
    expect(() => validateProjectName("  ")).toThrow(ValidationError);
  });

  it("rejects null bytes", () => {
    expect(() => validateProjectName("Acme\0Corp")).toThrow("null bytes");
  });

  it("rejects names exceeding max length", () => {
    expect(() => validateProjectName("a".repeat(101))).toThrow("exceed");
  });

  it("rejects special characters", () => {
    expect(() => validateProjectName("Acme; DROP TABLE")).toThrow(ValidationError);
    expect(() => validateProjectName("project<script>")).toThrow(ValidationError);
    expect(() => validateProjectName("../etc/passwd")).toThrow(ValidationError);
  });

  it("NFC normalises unicode", () => {
    // é as combining e + acute vs precomposed é - test on ticket title since project names restrict to ASCII
    const combining = "e\u0301";
    const precomposed = "\u00e9";
    expect(validateTicketTitle(combining)).toBe(validateTicketTitle(precomposed));
  });
});

describe("validateTicketTitle", () => {
  it("accepts valid titles", () => {
    expect(validateTicketTitle("Login page")).toBe("Login page");
    expect(validateTicketTitle("Fix bug #123")).toBe("Fix bug #123");
  });

  it("rejects empty titles", () => {
    expect(() => validateTicketTitle("")).toThrow(ValidationError);
  });

  it("rejects null bytes", () => {
    expect(() => validateTicketTitle("title\0bad")).toThrow("null bytes");
  });

  it("rejects titles exceeding max length", () => {
    expect(() => validateTicketTitle("a".repeat(501))).toThrow("exceed");
  });
});

describe("validateTicketDescription", () => {
  it("passes through undefined", () => {
    expect(validateTicketDescription(undefined)).toBeUndefined();
  });

  it("accepts valid descriptions", () => {
    expect(validateTicketDescription("Some description")).toBe("Some description");
  });

  it("rejects null bytes", () => {
    expect(() => validateTicketDescription("desc\0bad")).toThrow("null bytes");
  });

  it("rejects descriptions exceeding max length", () => {
    expect(() => validateTicketDescription("a".repeat(10_001))).toThrow("exceed");
  });
});

describe("validateTagPrefix", () => {
  it("accepts valid prefixes", () => {
    expect(validateTagPrefix("state")).toBe("state");
    expect(validateTagPrefix("feature")).toBe("feature");
    expect(validateTagPrefix("my-prefix")).toBe("my-prefix");
  });

  it("lowercases input", () => {
    expect(validateTagPrefix("STATE")).toBe("state");
  });

  it("rejects empty prefixes", () => {
    expect(() => validateTagPrefix("")).toThrow(ValidationError);
  });

  it("rejects null bytes", () => {
    expect(() => validateTagPrefix("state\0")).toThrow("null bytes");
  });

  it("rejects special characters", () => {
    expect(() => validateTagPrefix("state:value")).toThrow(ValidationError);
    expect(() => validateTagPrefix("my prefix")).toThrow(ValidationError);
    expect(() => validateTagPrefix("my_prefix")).toThrow(ValidationError);
  });

  it("rejects prefixes exceeding max length", () => {
    expect(() => validateTagPrefix("a".repeat(51))).toThrow("exceed");
  });

  it("rejects SQL injection payloads", () => {
    expect(() => validateTagPrefix("'; DROP TABLE--")).toThrow(ValidationError);
  });
});

describe("validateTagValue", () => {
  it("accepts valid values", () => {
    expect(validateTagValue("backlog")).toBe("backlog");
    expect(validateTagValue("in-progress")).toBe("in-progress");
  });

  it("lowercases input", () => {
    expect(validateTagValue("WIP")).toBe("wip");
  });

  it("rejects empty values", () => {
    expect(() => validateTagValue("")).toThrow(ValidationError);
  });

  it("rejects values exceeding max length", () => {
    expect(() => validateTagValue("a".repeat(101))).toThrow("exceed");
  });
});
