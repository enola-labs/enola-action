import { describe, expect, it } from "vitest";
import { packageMetricsMarkdown } from "../src/report/packagemetrics.js";
import { renderSummary } from "../src/report/summary.js";
import { commentMarker, renderComment } from "../src/report/comment.js";
import { PackageMetric, PackageMetricsDelta, Verdict } from "../src/core/types.js";

function m(pkg: string, ca: number, ce: number, i: number, a: number, d: number): PackageMetric {
  return {
    package: pkg,
    classes_interfaces: 4,
    afferent_couplings: ca,
    efferent_couplings: ce,
    instability: i,
    abstractness: a,
    distance: d,
  };
}

const aggregate = { analyzed: 120, avg_instability: 0.502, avg_distance: 0.489, off_main_sequence: 6 };

function delta(overrides: Partial<PackageMetricsDelta> = {}): PackageMetricsDelta {
  return {
    before: aggregate,
    after: { ...aggregate, avg_distance: 0.512, off_main_sequence: 7 },
    worsened: 1,
    improved: 0,
    packages: [
      {
        package: "internal/metrics",
        before: m("internal/metrics", 4, 3, 0.429, 0, 0.571),
        after: m("internal/metrics", 5, 3, 0.375, 0, 0.625),
        zone_before: "neutral",
        zone_after: "neutral",
      },
    ],
    ...overrides,
  };
}

function verdict(overrides: Partial<Verdict> = {}): Verdict {
  return { status: "clean", edges_added: 0, edges_removed: 0, facts_added: 0, facts_removed: 0, ...overrides };
}

describe("packageMetricsMarkdown", () => {
  it("prints the aggregates and only what moved", () => {
    const md = packageMetricsMarkdown(delta());
    expect(md).toContain("## Package metrics");
    expect(md).toContain("avg D 0.49 → 0.51 · avg I 0.50 · off main sequence 6 → 7 · 1 worse, 0 better.");
    expect(md).toContain("Reported, never graded.");
    // Ce and A did not move, so they print once; D rounds 0.625 half to even, as Enola does.
    expect(md).toContain("| `internal/metrics` | 4 → 5 | 3 | 0.43 → 0.38 | 0.00 | 0.57 → 0.62 | neutral |");
  });

  it("is silent for an older Enola and when nothing moved", () => {
    expect(packageMetricsMarkdown(undefined)).toBe("");
    expect(packageMetricsMarkdown(null)).toBe("");
    expect(packageMetricsMarkdown(delta({ packages: [] }))).toBe("");
  });

  it("lists added, removed and zone changes, and marks an incidental flip", () => {
    const md = packageMetricsMarkdown(
      delta({
        packages: [
          {
            package: "hub",
            before: m("hub", 6, 0, 0, 0, 1),
            after: m("hub", 7, 0, 0, 0, 1),
            zone_before: "neutral",
            zone_after: "pain",
          },
          { package: "new", after: m("new", 1, 0, 0, 0, 1), zone_after: "neutral" },
          { package: "gone", before: m("gone", 0, 1, 1, 0, 0), zone_before: "main-sequence" },
          {
            package: "floor",
            before: m("floor", 5, 0, 0, 0, 1),
            after: m("floor", 5, 0, 0, 0, 1),
            zone_before: "pain",
            zone_after: "neutral",
            zone_incidental: true,
          },
        ],
      }),
    );
    expect(md).toContain("| `hub` | 6 → 7 | 0 | 0.00 | 0.00 | 1.00 | neutral → pain |");
    expect(md).toContain("| `new` | 1 | 0 | 0.00 | 0.00 | 1.00 | added (neutral) |");
    expect(md).toContain("| `gone` | 0 | 1 | 1.00 | 0.00 | 0.00 | removed (main-sequence) |");
    expect(md).toContain("| `floor` | 5 | 0 | 0.00 | 0.00 | 1.00 | pain → neutral ¹ |");
    expect(md).toContain("¹ The package's own numbers did not change; the population's rigid floor moved.");
  });

  it("counts packages whose D and zone held, and lists them with detail", () => {
    const quiet = {
      package: "quiet",
      before: m("quiet", 2, 2, 0.5, 0.5, 0),
      after: m("quiet", 3, 3, 0.5, 0.5, 0),
      zone_before: "main-sequence",
      zone_after: "main-sequence",
    };
    const packages = [...(delta().packages || []), quiet];
    const plain = packageMetricsMarkdown(delta({ packages }));
    expect(plain).not.toContain("`quiet`");
    expect(plain).toContain("1 more package moved without a change in D or zone. Set `detail: true` to list them.");
    const full = packageMetricsMarkdown(delta({ packages }), true);
    expect(full).toContain("| `quiet` | 2 → 3 | 2 → 3 | 0.50 | 0.50 | 0.00 | main-sequence |");
    expect(full).not.toContain("more package moved");
  });

  it("caps the table and points at the verdict file", () => {
    const packages = Array.from({ length: 30 }, (_, i) => ({
      package: `p${i}`,
      after: m(`p${i}`, 1, 0, 0, 0, 1),
      zone_after: "neutral",
    }));
    const md = packageMetricsMarkdown(delta({ packages }));
    expect(md).toContain("`p24`");
    expect(md).not.toContain("`p25`");
    expect(md).toContain("…and 5 more, in the `verdict-file` output.");
  });
});

describe("where the section appears", () => {
  it("sits in the job summary just above the architectural change", () => {
    const md = renderSummary(verdict({ package_metrics: delta() }), "b", "h", "1");
    expect(md.indexOf("## Package metrics")).toBeGreaterThan(-1);
    expect(md.indexOf("## Package metrics")).toBeLessThan(md.indexOf("## Architectural change"));
  });

  it("leaves the job summary byte for byte as it was without the field", () => {
    const without = renderSummary(verdict(), "b", "h", "1");
    expect(renderSummary(verdict({ package_metrics: null }), "b", "h", "1")).toBe(without);
    expect(renderSummary(verdict({ package_metrics: delta({ packages: [] }) }), "b", "h", "1")).toBe(without);
  });

  it("is folded in the pull request comment", () => {
    const body = renderComment(verdict({ package_metrics: delta() }), {
      marker: commentMarker("."),
      baseSha: "b",
      headSha: "h",
      version: "1",
    });
    expect(body).toContain("<details><summary>Package metrics</summary>");
    expect(body).toContain("| `internal/metrics` |");
  });
});
