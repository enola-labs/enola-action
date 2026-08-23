import { describe, expect, it } from "vitest";
import {
  assertExitCode,
  isKnownStatus,
  isPartial,
  jobFailed,
  parseVerdict,
  ungradedFacts,
  ungradedFindings,
} from "../src/policy/verdict.js";

function json(overrides: Record<string, unknown>): string {
  return JSON.stringify({ edges_added: 0, edges_removed: 0, facts_added: 0, facts_removed: 0, ...overrides });
}

const clean = json({ status: "clean" });

describe("verdict contract", () => {
  it("parses a valid verdict", () => expect(parseVerdict(clean).status).toBe("clean"));
  it("rejects a status/exit mismatch", () => expect(() => assertExitCode(parseVerdict(clean), 1)).toThrow("requires exit code 0"));
  it("rejects prose", () => expect(() => parseVerdict("PASS")).toThrow("invalid JSON"));
  it("rejects a verdict with no status at all", () => expect(() => parseVerdict(json({}))).toThrow("missing a status"));
});

// The break this file exists for. Enola grades the intersection of the producers both
// snapshots share rather than declining outright, and reports it under a status name the
// action had never heard of. It exits 0. The action threw, and every clean pull request
// that added the first file in a language went red with "Unknown Enola status".
describe("a partial verdict", () => {
  it("is a pass at exit 0", () => {
    const verdict = parseVerdict(json({ status: "partial_clean" }));
    expect(verdict.status).toBe("partial_clean");
    expect(() => assertExitCode(verdict, 0)).not.toThrow();
    expect(jobFailed(verdict, 0)).toBe(false);
    expect(isPartial(verdict)).toBe(true);
  });

  it("is a failure at exit 1", () => {
    const verdict = parseVerdict(json({ status: "partial_regression" }));
    expect(() => assertExitCode(verdict, 1)).not.toThrow();
    expect(jobFailed(verdict, 1)).toBe(true);
    expect(isPartial(verdict)).toBe(true);
  });

  it("holds the exit-code contract as tightly as a whole verdict does", () => {
    expect(() => assertExitCode(parseVerdict(json({ status: "partial_regression" })), 0)).toThrow("requires exit code 1");
  });

  it("counts what it could not grade, per side and per producer", () => {
    const verdict = parseVerdict(
      json({
        status: "partial_clean",
        intersection_grading: {
          shared_extractors: ["typescript"],
          excluded: [
            {
              name: "ruby",
              kind: "extractor",
              lacked_by: "baseline",
              baseline_facts_excluded: 0,
              current_facts_excluded: 2,
              baseline_findings_excluded: 0,
              current_findings_excluded: 1,
            },
          ],
        },
      }),
    );
    expect(ungradedFacts(verdict)).toBe(2);
    expect(ungradedFindings(verdict)).toBe(1);
  });

  it("reports nothing ungraded when the verdict was whole", () => {
    expect(ungradedFacts(parseVerdict(clean))).toBe(0);
    expect(ungradedFindings(parseVerdict(clean))).toBe(0);
  });
});

// The lesson of that break, generalised: a name this action has not been taught must not
// be able to fail a job Enola passed. The exit code is the contract Enola documents, and
// it is the one thing a new status cannot silently change.
describe("a status from a newer Enola", () => {
  const future = parseVerdict(json({ status: "provisional_clean" }));

  it("parses rather than throwing", () => expect(future.status).toBe("provisional_clean"));
  it("is reported as unknown so the caller can say so", () => expect(isKnownStatus(future.status)).toBe(false));
  it("passes the job when Enola exited 0", () => expect(jobFailed(future, 0)).toBe(false));
  it("still fails the job when Enola exited non-zero", () => expect(jobFailed(future, 1)).toBe(true));
  it("asserts nothing about an exit code it cannot predict", () => expect(() => assertExitCode(future, 7)).not.toThrow());
});
