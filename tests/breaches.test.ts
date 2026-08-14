import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const { write, addRaw, info } = vi.hoisted(() => {
  const write = vi.fn();
  const addRaw = vi.fn((_markdown: string) => ({ write }));
  const info = vi.fn();
  return { write, addRaw, info };
});
vi.mock("@actions/core", () => ({ summary: { addRaw }, info, warning: vi.fn(), error: vi.fn() }));

import { logVerdict, writeSummary } from "../src/summary.js";
import { regressionCount } from "../src/verdict.js";
import { Verdict } from "../src/types.js";

// A real `enola check --target=… --max-spillover=0` verdict, captured from the engine
// rather than hand-written: status regression, ZERO failing findings, one fatal breach.
// The shape is the whole point of these tests, so inventing it would test nothing.
const spillover = JSON.parse(
  readFileSync(path.join(__dirname, "fixtures", "spillover-verdict.json"), "utf8"),
) as Verdict;

beforeEach(() => vi.clearAllMocks());

describe("a regression carried by a measurement rather than a finding", () => {
  it("is the shape the fixture claims — otherwise the rest of this file proves nothing", () => {
    expect(spillover.status).toBe("regression");
    expect(spillover.failures ?? []).toHaveLength(0);
    expect((spillover.breaches ?? []).filter((breach) => breach.fatal)).toHaveLength(1);
  });

  it("counts toward the regression total", () => {
    expect(regressionCount(spillover)).toBe(1);
  });

  // The bug this file exists for: the job went red while every surface reported zero.
  it("never reports zero regressions above a failed job", async () => {
    await writeSummary(spillover, "abcdef1234567890", "1234567890abcdef", "1.2.3");
    const markdown = addRaw.mock.calls[0][0] as string;
    expect(markdown).toContain("1 structural regression(s) introduced");
    expect(markdown).not.toContain("0 structural regression(s)");
  });

  it("says what went over the threshold, in the summary", async () => {
    await writeSummary(spillover, "abcdef1234567890", "1234567890abcdef", "1.2.3");
    const markdown = addRaw.mock.calls[0][0] as string;
    expect(markdown).toContain("## Measurements over threshold");
    expect(markdown).toContain("package(s) reached outside the declared scope");
    // Ahead of advisories: the breach is why the job failed; the advisory is not.
    expect(markdown.indexOf("## Measurements over threshold")).toBeLessThan(markdown.indexOf("## Advisory findings"));
  });

  it("says it in the step log too, where the failure appears", () => {
    logVerdict(spillover);
    const logged = info.mock.calls.map((call) => call[0] as string).join("\n");
    expect(logged).toContain("1 regression(s)");
    expect(logged).toMatch(/package\(s\) reached outside the declared scope/);
  });
});

describe("warn-only", () => {
  it("reports the breach count without claiming the job failed", async () => {
    await writeSummary({ ...spillover, status: "clean" }, "abcdef1234567890", "1234567890abcdef", "1.2.3");
    const markdown = addRaw.mock.calls[0][0] as string;
    expect(markdown).toContain("1 regression(s) reported in warn-only mode");
    expect(markdown).toContain("## Measurements over threshold");
  });
});

describe("a non-fatal breach", () => {
  it("is reported as a warning and does not inflate the regression count", async () => {
    const warnOnly: Verdict = {
      ...spillover,
      status: "clean",
      breaches: [{ measurement: { name: "spillover_packages", label: "package(s) reached outside the declared scope", count: 2 } }],
    };
    expect(regressionCount(warnOnly)).toBe(0);
    await writeSummary(warnOnly, "abcdef1234567890", "1234567890abcdef", "1.2.3");
    const markdown = addRaw.mock.calls[0][0] as string;
    expect(markdown).toContain("No structural regression");
    expect(markdown).toContain("**warn** — 2 package(s) reached outside the declared scope");
  });
});
