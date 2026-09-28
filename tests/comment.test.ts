import { describe, expect, it } from "vitest";
import {
  COMMENT_LIMIT,
  commentMarker,
  neutralizeMentions,
  renderComment,
  renderResolvedComment,
  shouldComment,
} from "../src/report/comment.js";
import { renderSummary } from "../src/report/summary.js";
import { Finding, Verdict } from "../src/core/types.js";

function verdict(overrides: Partial<Verdict> = {}): Verdict {
  return { status: "clean", edges_added: 1, edges_removed: 2, facts_added: 3, facts_removed: 4, ...overrides };
}

const enforcing = { fail_explainers: ["layers"], min_confidence: 1, thresholds: [] };
const unenforced = { fail_explainers: [], min_confidence: 1, thresholds: [] };
const advisory: Finding = { title: "Hotspot: src/a.ts", source: "hotspots", confidence: 0.7 };
const failure: Finding = { title: "Layer violation: storage -> delivery", source: "layers", confidence: 1 };

const ctx = {
  marker: commentMarker("."),
  baseSha: "abcdef1234567890",
  headSha: "1234567890abcdef",
  version: "0.4.26",
  runUrl: "https://github.com/o/r/actions/runs/7",
};

describe("shouldComment", () => {
  it("auto comments on every run while nothing is enforced", () => {
    expect(shouldComment("auto", verdict({ policy: unenforced }), 0)).toBe(true);
  });

  it("auto comments only on failure once a policy is enforced", () => {
    expect(shouldComment("auto", verdict({ policy: enforcing, advisories: [advisory] }), 0)).toBe(false);
    expect(shouldComment("auto", verdict({ status: "regression", policy: enforcing, failures: [failure] }), 1)).toBe(true);
  });

  it("auto treats an Enola that reports no policy as enforcing", () => {
    expect(shouldComment("auto", verdict(), 0)).toBe(false);
  });

  it("findings comments when anything was reported", () => {
    expect(shouldComment("findings", verdict({ policy: enforcing }), 0)).toBe(false);
    expect(shouldComment("findings", verdict({ policy: enforcing, advisories: [advisory] }), 0)).toBe(true);
  });

  // The replacement for a comment that was not earned says "passing". An incomparable
  // run fails with no finding, so it must earn a comment in every mode, or that note
  // would overwrite a real failure with good news.
  it("comments on every failed job whatever the mode", () => {
    for (const when of ["auto", "always", "findings", "failure"] as const) {
      expect(shouldComment(when, verdict({ status: "incomparable", policy: enforcing }), 3)).toBe(true);
    }
  });

  it("always comments on a clean enforced run", () => {
    expect(shouldComment("always", verdict({ policy: enforcing }), 0)).toBe(true);
  });
});

describe("commentMarker", () => {
  it("keeps keys apart and cannot close the HTML comment early", () => {
    expect(commentMarker("services/api")).toBe("<!-- enola-action:services/api -->");
    expect(commentMarker("a --> b")).toBe("<!-- enola-action:a_--__b -->");
    expect(commentMarker("a")).not.toBe(commentMarker("ab").slice(0, commentMarker("a").length));
  });
});

describe("renderComment", () => {
  it("leads with the marker, the headline and what failed, and folds the rest", () => {
    const body = renderComment(
      verdict({
        status: "regression",
        policy: enforcing,
        failures: [failure],
        declared: [{ title: "Newly declared", source: "constraints", confidence: 1 }],
      }),
      ctx,
    );
    expect(body.startsWith(ctx.marker)).toBe(true);
    expect(body).toContain("1 structural regression(s) introduced");
    expect(body).toContain("## Regressions");
    expect(body).toContain("<details><summary>Other findings</summary>");
    expect(body).toContain("<details><summary>Architectural change</summary>");
    expect(body).toMatch(/\|\n\n<\/details>/);
    expect(body).toContain("Full report: [workflow run](https://github.com/o/r/actions/runs/7)");
  });

  it("never carries the full delta, even when the summary does", () => {
    const v = verdict({ diff: { facts_added: [{ kind: "symbol", name: "x" }] } });
    expect(renderSummary(v, "b", "h", "1", true)).toContain("## Full delta");
    expect(renderComment(v, ctx)).not.toContain("## Full delta");
  });

  it("stays under GitHub's comment limit and says it was shortened", () => {
    const long = (n: number): Finding[] =>
      Array.from({ length: n }, (_, i) => ({ title: `${"x".repeat(3000)} ${i}`, source: "hotspots", confidence: 0.5 }));
    const body = renderComment(verdict({ policy: enforcing, advisories: long(25), incidental: long(25) }), ctx);
    expect(body.length).toBeLessThanOrEqual(COMMENT_LIMIT);
    expect(body).toContain("Shortened to fit a pull request comment");
    expect(body.startsWith(ctx.marker)).toBe(true);
  });
});

describe("renderResolvedComment", () => {
  it("is one passing line under the same marker", () => {
    const body = renderResolvedComment(ctx);
    expect(body.startsWith(ctx.marker)).toBe(true);
    expect(body).toContain("passing** as of `12345678` (base `abcdef12`)");
  });
});

describe("neutralizeMentions", () => {
  it("breaks mentions in prose and leaves code spans and emails alone", () => {
    const out = neutralizeMentions("owner @ada and @org/team, `@scope/pkg`, ada@example.com");
    expect(out).toContain("@​ada");
    expect(out).toContain("@​org/team");
    expect(out).toContain("`@scope/pkg`");
    expect(out).toContain("ada@example.com");
  });
});
