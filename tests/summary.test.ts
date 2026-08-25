import { beforeEach, describe, expect, it, vi } from "vitest";

const { write, addRaw } = vi.hoisted(() => {
  const write = vi.fn();
  const addRaw = vi.fn((_markdown: string) => ({ write }));
  return { write, addRaw };
});
vi.mock("@actions/core", () => ({ summary: { addRaw } }));

import { lawLine, writeSummary } from "../src/report/summary.js";
import { LedgerSummary, Verdict } from "../src/core/types.js";

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

describe("a partial verdict", () => {
  // Enola grades the intersection of the producers both snapshots share instead of
  // declining. It is a real pass — of part of the graph — and a summary that printed it
  // as a whole one would be the most expensive kind of wrong: a green check over facts
  // nobody compared.
  const partial: Partial<Verdict> = {
    status: "partial_clean",
    intersection_grading: {
      shared_extractors: ["typescript", "mdintent"],
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
  };

  it("marks the headline and names what went ungraded", async () => {
    await writeSummary(verdict(partial), "base", "head", "1.2.3");
    const markdown = addRaw.mock.calls[0][0] as string;
    expect(markdown).toContain("No structural regression (partial verdict)");
    expect(markdown).toContain("Partial verdict.");
    expect(markdown).toContain("Excluded from grading: ruby (baseline lacks it)");
    expect(markdown).toContain("2 facts and 1 finding on the current side not graded");
    expect(markdown).toContain("A regression among an excluded producer's facts cannot be graded here and is NOT reported.");
    expect(markdown).toContain("2 fact(s) and 1 finding(s) from 1 producer were not graded.");
  });

  it("keeps the failing headline when the graded part regressed", async () => {
    await writeSummary(
      verdict({ ...partial, status: "partial_regression", failures: [{ title: "Cycle", source: "cycles", confidence: 1 }] }),
      "base",
      "head",
      "1.2.3",
    );
    const markdown = addRaw.mock.calls[0][0] as string;
    expect(markdown).toContain("1 structural regression(s) introduced (partial verdict)");
  });
});

describe("the buckets Enola splits out of advisories", () => {
  it("gives a newly declared rule its own section rather than counting it as a regression", async () => {
    await writeSummary(
      verdict({ declared: [{ title: "Constraint storage-stays-home violated: here", confidence: 1 }] }),
      "base",
      "head",
      "1.2.3",
    );
    const markdown = addRaw.mock.calls[0][0] as string;
    expect(markdown).toContain("## Declared by this change (1)");
    expect(markdown).toContain("The rules are new; the code they name is not.");
    expect(markdown).toContain("No structural regression");
  });

  it("keeps what a ledger excused auditable", async () => {
    await writeSummary(
      verdict({ suppressed: [{ title: "s", confidence: 1 }], exempted: [{ title: "e", confidence: 1 }] }),
      "base",
      "head",
      "1.2.3",
    );
    expect(addRaw.mock.calls[0][0] as string).toContain("## Excused (2)");
  });

  // A breach that stopped being reported because its rule was deleted is not a fix, and
  // must never appear under "resolved".
  it("reports what stopped being asked without calling it good news", async () => {
    await writeSummary(
      verdict({
        silenced: [{ title: "left the component", confidence: 1 }],
        undeclared: [{ title: "rule deleted", confidence: 1 }],
      }),
      "base",
      "head",
      "1.2.3",
    );
    const markdown = addRaw.mock.calls[0][0] as string;
    expect(markdown).toContain("## Reported, not graded");
    expect(markdown).toContain("Silenced — the code left the component the rule binds");
    expect(markdown).toContain("Undeclared — the rule changed, the code did not");
  });

  it("caps a section that would otherwise not fit, and says how many it held back", async () => {
    const declared = Array.from({ length: 40 }, (_, i) => ({ title: `d${i}`, confidence: 1 }));
    await writeSummary(verdict({ declared }), "base", "head", "1.2.3");
    const markdown = addRaw.mock.calls[0][0] as string;
    expect(markdown).toContain("…and 15 more, in the `verdict-file` output.");
  });
});

describe("what the run could not see", () => {
  it("prints the census under the headline, on a pass", async () => {
    await writeSummary(
      verdict({
        census: {
          recorded: true,
          files_excluded_by_ignore: 12,
          dirs_excluded_by_ignore: 1,
          dead_exemptions: 0,
          unused_suppressions: 2,
          dynamic_feature_classes: 0,
          provider_skips: [{ name: "eslint", reason: "not installed" }],
        },
      }),
      "base",
      "head",
      "1.2.3",
    );
    const markdown = addRaw.mock.calls[0][0] as string;
    expect(markdown).toContain("could not see: 12 files and 1 directory excluded by ignore globs");
    expect(markdown).toContain("eslint skipped (not installed)");
    expect(markdown).toContain("2 unused suppressions");
  });

  it("says so plainly when it saw everything it was asked to", async () => {
    await writeSummary(
      verdict({
        census: {
          recorded: true,
          files_excluded_by_ignore: 0,
          dirs_excluded_by_ignore: 0,
          dead_exemptions: 0,
          unused_suppressions: 0,
          dynamic_feature_classes: 0,
        },
      }),
      "base",
      "head",
      "1.2.3",
    );
    expect(addRaw.mock.calls[0][0] as string).toContain("could not see: nothing");
  });
});

// `detail` used to pass --detail to a run that was reading JSON, where Enola ignores it:
// the input did nothing at all. The delta was in the verdict the whole time.
describe("the detail input", () => {
  const diff = {
    edges_added: [{ source: "a", kind: "imports", target: "b" }],
    facts_removed: [{ kind: "symbol", name: "Old", file: "src/a.ts", line: 3 }],
  };

  it("renders the delta from the verdict when asked", async () => {
    await writeSummary(verdict({ diff }), "base", "head", "1.2.3", true);
    const markdown = addRaw.mock.calls[0][0] as string;
    expect(markdown).toContain("## Full delta");
    expect(markdown).toContain("`a` —imports→ `b`");
    expect(markdown).toContain("`symbol` Old");
  });

  it("stays out of the summary otherwise", async () => {
    await writeSummary(verdict({ diff }), "base", "head", "1.2.3");
    expect(addRaw.mock.calls[0][0] as string).not.toContain("## Full delta");
  });
});

describe("lawLine", () => {
  const law = (overrides: Partial<LedgerSummary>): LedgerSummary => ({
    rules: 1,
    breaches: 0,
    suppressed: 0,
    exempted: 0,
    excused: 0,
    ...overrides,
  });

  // A repository that declares no rules is unasked, not clean: a zeroed ledger would
  // read as a law with nothing wrong with it.
  it("renders nothing when no rules are declared", () => {
    expect(lawLine(undefined)).toBe("");
    expect(lawLine(null)).toBe("");
    expect(lawLine(law({ rules: 0 }))).toBe("");
  });

  it("names a law nobody has had to excuse", () => {
    expect(lawLine(law({ rules: 2 }))).toBe("law: 2 rules · no breaches");
  });

  // The mode breakdown only appears when it discriminates.
  it("breaks down modes only when more than one is present", () => {
    expect(lawLine(law({ rules: 2, by_mode: { ratchet: 2 } }))).toBe("law: 2 rules · no breaches");
    expect(lawLine(law({ rules: 3, by_mode: { ratchet: 1, advisory: 1, strict: 1 } }))).toBe(
      "law: 3 rules (1 ratchet, 1 strict, 1 advisory) · no breaches",
    );
  });

  it("reports the excuse rate over every breach the law raised", () => {
    // 2 excused over 4 raised: 3 reported plus 1 carved out by an exemption.
    const line = lawLine(law({ rules: 2, breaches: 3, exempted: 1, suppressed: 1, excused: 2, oldest_excuse_days: 236 }));
    expect(line).toBe("law: 2 rules · 4 breaches · 2 excused (50%) · oldest excuse 236 days");
  });

  it("says none excused rather than nothing", () => {
    expect(lawLine(law({ rules: 1, breaches: 1 }))).toBe("law: 1 rule · 1 breach · none excused");
  });

  it("names idle and undatable excuses", () => {
    const line = lawLine(law({ rules: 1, idle_excuses: 2, undatable_excuses: 1 }));
    expect(line).toBe(
      "law: 1 rule · no breaches · 2 excuses matched nothing · 1 excuse with an unreadable date",
    );
  });

  // Go's %.0f rounds half to even, so 1 excused of 200 prints 0%, not 1%. The line is
  // ported to read identically in the job summary and in the step log.
  it("rounds the share the way Go formats it", () => {
    expect(lawLine(law({ rules: 1, breaches: 200, excused: 1, suppressed: 1 }))).toContain("1 excused (0%)");
    expect(lawLine(law({ rules: 1, breaches: 200, excused: 3, suppressed: 3 }))).toContain("3 excused (2%)");
  });

  it("renders into the job summary beside the census line", async () => {
    await writeSummary(
      verdict({ law: law({ rules: 1, breaches: 1, suppressed: 1, excused: 1, oldest_excuse_days: 5 }) }),
      "abcdef1234567890",
      "1234567890abcdef",
      "1.2.3",
    );
    const markdown = addRaw.mock.calls[0][0] as string;
    expect(markdown).toContain("_law: 1 rule · 1 breach · 1 excused (100%) · oldest excuse 5 days_");
  });
});
