import { beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({ error: vi.fn(), warning: vi.fn() }));
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

  it("caps annotations at 10 per category", () => {
    const failures = Array.from({ length: 15 }, (_, i) => ({ title: `f${i}`, confidence: 0.5 }));
    annotate(verdict({ status: "regression", failures }));
    expect(core.error).toHaveBeenCalledTimes(10);
  });

  it("emits an extra error summarizing comparability warnings when incomparable", () => {
    annotate(verdict({ status: "incomparable", comparability_warnings: ["renamed module boundary"] }));
    expect(core.error).toHaveBeenCalledWith("Enola refused to grade this change: renamed module boundary");
  });

  it("emits warnings for advisories", () => {
    annotate(verdict({ advisories: [{ title: "Consider splitting", confidence: 0.4 }] }));
    expect(core.warning).toHaveBeenCalledWith("Consider splitting (confidence 0.40)", expect.anything());
  });
});
