import { describe, expect, it } from "vitest";
import { assertExitCode, parseVerdict } from "../src/policy/verdict.js";

const clean = JSON.stringify({ status: "clean", edges_added: 0, edges_removed: 0, facts_added: 0, facts_removed: 0 });

describe("verdict contract", () => {
  it("parses a valid verdict", () => expect(parseVerdict(clean).status).toBe("clean"));
  it("rejects a status/exit mismatch", () => expect(() => assertExitCode(parseVerdict(clean), 1)).toThrow("requires exit code 0"));
  it("rejects prose", () => expect(() => parseVerdict("PASS")).toThrow("invalid JSON"));
});
