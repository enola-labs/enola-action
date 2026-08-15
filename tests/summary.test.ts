import { beforeEach, describe, expect, it, vi } from "vitest";

const { write, addRaw } = vi.hoisted(() => {
  const write = vi.fn();
  const addRaw = vi.fn((_markdown: string) => ({ write }));
  return { write, addRaw };
});
vi.mock("@actions/core", () => ({ summary: { addRaw } }));

import { writeSummary } from "../src/summary.js";
import { Verdict } from "../src/types.js";

function verdict(overrides: Partial<Verdict>): Verdict {
  return { status: "clean", edges_added: 1, edges_removed: 2, facts_added: 3, facts_removed: 4, ...overrides };
}

beforeEach(() => vi.clearAllMocks());

describe("writeSummary", () => {
  it("renders a clean verdict without a regressions section", async () => {
    await writeSummary(verdict({}), "abcdef1234567890", "1234567890abcdef", "1.2.3");
    const markdown = addRaw.mock.calls[0][0] as string;
    expect(markdown).toContain("No structural regression");
    expect(markdown).toContain("`abcdef12`");
    expect(markdown).toContain("`1.2.3`");
    expect(markdown).not.toContain("## Regressions");
    expect(write).toHaveBeenCalled();
  });

  it("lists regressions with source, confidence and location", async () => {
    await writeSummary(
      verdict({
        status: "regression",
        failures: [{ title: "Cycle", source: "cycles", confidence: 0.75, location: { file: "src/a.ts", line: 5 } }],
      }),
      "base",
      "head",
      "1.2.3",
    );
    const markdown = addRaw.mock.calls[0][0] as string;
    expect(markdown).toContain("1 structural regression(s) introduced");
    expect(markdown).toContain("- **cycles · 0.75** — Cycle — `src/a.ts:5`");
  });

  it("includes a comparability section when warnings are present", async () => {
    await writeSummary(
      verdict({ status: "incomparable", comparability_warnings: ["no shared baseline"] }),
      "base",
      "head",
      "1.2.3",
    );
    const markdown = addRaw.mock.calls[0][0] as string;
    expect(markdown).toContain("## Comparability");
    expect(markdown).toContain("- no shared baseline");
  });
});

describe("an unenforced run", () => {
  // The failure mode this guards: a workflow with no fail-on set is a report, and a
  // green check on it must not read as "graded clean". Both surfaces have to say so.
  it("marks the summary as enforcing nothing and relabels the findings section", async () => {
    await writeSummary(
      verdict({
        policy: { fail_explainers: [], min_confidence: 1, thresholds: [] },
        advisories: [{ title: "Layer violation: storage -> delivery", source: "layers", confidence: 1 }],
      }),
      "base",
      "head",
      "1.2.3",
    );
    const markdown = addRaw.mock.calls[0][0] as string;
    expect(markdown).toContain("1 finding(s) reported, nothing enforced");
    expect(markdown).toContain("No policy set.");
    expect(markdown).toContain("Findings (reported, not enforced)");
    expect(markdown).not.toContain("## Advisory findings");
  });

  it("says nothing of the sort when a policy is set", async () => {
    await writeSummary(
      verdict({
        policy: { fail_explainers: ["layers"], min_confidence: 1 },
        advisories: [{ title: "Call-graph hotspot", source: "hotspots", confidence: 0.7 }],
      }),
      "base",
      "head",
      "1.2.3",
    );
    const markdown = addRaw.mock.calls[0][0] as string;
    expect(markdown).toContain("## Advisory findings");
    expect(markdown).not.toContain("No policy set.");
  });

  // An Enola old enough not to report its policy must not be described as ungated —
  // that build fails on cycles by default, and claiming otherwise would be a lie about
  // a run this action did not configure.
  it("stays silent when the verdict carries no policy at all", async () => {
    await writeSummary(verdict({ advisories: [{ title: "x", source: "layers", confidence: 1 }] }), "base", "head", "1.2.3");
    const markdown = addRaw.mock.calls[0][0] as string;
    expect(markdown).not.toContain("No policy set.");
  });
});
