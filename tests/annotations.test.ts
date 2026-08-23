import { beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({ error: vi.fn(), warning: vi.fn(), notice: vi.fn() }));
vi.mock("@actions/core", () => core);

import { annotate } from "../src/report/annotations.js";
import { Verdict } from "../src/core/types.js";

function verdict(overrides: Partial<Verdict>): Verdict {
  return { status: "clean", edges_added: 0, edges_removed: 0, facts_added: 0, facts_removed: 0, ...overrides };
}

beforeEach(() => vi.clearAllMocks());

describe("annotate", () => {
  it("emits an error annotation per failure with confidence and location", () => {
    annotate(
      verdict({
        status: "regression",
        failures: [
          { title: "Cycle introduced", source: "cycles", confidence: 0.92, location: { file: "src/a.ts", line: 10 } },
        ],
      }),
    );
    expect(core.error).toHaveBeenCalledWith(
      "Cycle introduced (confidence 0.92)",
      expect.objectContaining({ title: "Enola: cycles", file: "src/a.ts", startLine: 10, endLine: 10 }),
    );
  });

  it("falls back to evidence location when the finding has none of its own", () => {
    annotate(
      verdict({
        status: "regression",
        failures: [{ title: "X", confidence: 0.5, evidence: [{ symbol: "Foo" }, { file: "src/b.ts" }] }],
      }),
    );
    expect(core.error).toHaveBeenCalledWith("X (confidence 0.50)", expect.objectContaining({ file: "src/b.ts" }));
  });

  // The span the extractor measured. Before Enola carried it on evidence there was
  // nothing to place a finding with, so every annotation landed at the head of a file;
  // now the import that caused a layer violation can be annotated on its own line.
  it("prefers a measured span over a bare file, and carries the columns", () => {
    annotate(
      verdict({
        status: "regression",
        failures: [
          {
            title: "Layer violation",
            source: "layers",
            confidence: 1,
            evidence: [{ file: "src/z.ts" }, { file: "src/a.ts", line: 12, end_line: 12, column: 3, end_column: 40 }],
          },
        ],
      }),
    );
    expect(core.error).toHaveBeenCalledWith(
      expect.stringContaining("Layer violation"),
      expect.objectContaining({ file: "src/a.ts", startLine: 12, endLine: 12, startColumn: 3, endColumn: 40 }),
    );
  });

  it("titles the annotation with the declared rule id rather than the explainer", () => {
    annotate(
      verdict({
        status: "regression",
        failures: [
          {
            title: "Strict constraint storage-stays-home violated: delivery reads the store",
            source: "constraints",
            description: "Because: the store is the storage layer's to own.",
            confidence: 1,
            suggested_actions: ["Move the read behind the storage port."],
            evidence: [{ fact: "rule: storage-stays-home", file: "src/a.ts", line: 4 }],
          },
        ],
      }),
    );
    const [message, properties] = core.error.mock.calls[0];
    expect(properties).toMatchObject({ title: "Enola: storage-stays-home" });
    expect(message).toContain("Because: the store is the storage layer's to own.");
    expect(message).toContain("Action: Move the read behind the storage port.");
  });

  it("annotates a newly declared rule as a warning that says the change did not cause it", () => {
    annotate(verdict({ declared: [{ title: "Constraint x violated: here", confidence: 1, evidence: [{ file: "a.ts", line: 1 }] }] }));
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining("the rule is new, the code it names is not"),
      expect.objectContaining({ file: "a.ts" }),
    );
  });

  // Note-level buckets are things that did NOT happen to this change. Pinning them to
  // lines in the diff would bury the ones that did.
  it("leaves suppressed, silenced and descriptive findings to the summary", () => {
    annotate(
      verdict({
        suppressed: [{ title: "s", confidence: 1, evidence: [{ file: "a.ts", line: 1 }] }],
        silenced: [{ title: "q", confidence: 1, evidence: [{ file: "a.ts", line: 2 }] }],
        descriptive: [{ title: "d", confidence: 1, evidence: [{ file: "a.ts", line: 3 }] }],
      }),
    );
    expect(core.error).not.toHaveBeenCalled();
    expect(core.warning).not.toHaveBeenCalled();
  });

  it("caps annotations at 10 per level and says how many it withheld", () => {
    const failures = Array.from({ length: 15 }, (_, i) => ({
      title: `f${i}`,
      confidence: 0.5,
      evidence: [{ file: `src/f${i}.ts`, line: 1 }],
    }));
    annotate(verdict({ status: "regression", failures }));
    expect(core.error).toHaveBeenCalledTimes(10);
    expect(core.notice).toHaveBeenCalledWith(expect.stringContaining("5 further error-level findings are"));
  });

  it("counts the findings it could not place instead of pinning them somewhere plausible", () => {
    annotate(verdict({ status: "regression", failures: [{ title: "module-level", confidence: 1 }] }));
    expect(core.error).not.toHaveBeenCalled();
    expect(core.notice).toHaveBeenCalledWith(expect.stringContaining("1 finding without a position stays"));
  });

  it("emits an extra error summarizing comparability warnings when incomparable", () => {
    annotate(verdict({ status: "incomparable", comparability_warnings: ["renamed module boundary"] }));
    expect(core.error).toHaveBeenCalledWith("Enola refused to grade this change: renamed module boundary");
  });

  it("emits warnings for advisories", () => {
    annotate(verdict({ advisories: [{ title: "Consider splitting", confidence: 0.4, evidence: [{ file: "src/c.ts" }] }] }));
    expect(core.warning).toHaveBeenCalledWith("Consider splitting (confidence 0.40)", expect.anything());
  });

  // A partial pass in the diff must not read like a whole one.
  it("says what a partial verdict did not grade", () => {
    annotate(
      verdict({
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
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining("Partial verdict: only producers present in BOTH snapshots were graded"),
    );
  });
});
