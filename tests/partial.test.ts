import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const { write, addRaw, warning, error, notice, info } = vi.hoisted(() => {
  const write = vi.fn();
  const addRaw = vi.fn((_markdown: string) => ({ write }));
  return { write, addRaw, warning: vi.fn(), error: vi.fn(), notice: vi.fn(), info: vi.fn() };
});
vi.mock("@actions/core", () => ({ summary: { addRaw }, warning, error, notice, info }));

import { annotate } from "../src/report/annotations.js";
import { logVerdict, writeSummary } from "../src/report/summary.js";
import { toSarif } from "../src/report/sarif.js";
import { assertExitCode, isPartial, jobFailed, parseVerdict, ungradedFacts } from "../src/policy/verdict.js";

// A real `enola check --json` verdict, captured from the engine rather than written by
// hand: a repository whose baseline predates its first Ruby file, which is the ordinary
// pull request that produces a partial verdict. Enola grades the producers both
// snapshots share, reports `partial_clean`, and exits 0.
//
// The action used to reject the status name outright and fail the job. The whole point
// of this file is that the shape is the engine's, so a fixture written to match the code
// could not prove it.
const raw = readFileSync(path.join(__dirname, "fixtures", "partial-verdict.json"), "utf8");

beforeEach(() => vi.clearAllMocks());

describe("a partial verdict from the engine", () => {
  it("is the shape the fixture claims — otherwise the rest of this file proves nothing", () => {
    const verdict = parseVerdict(raw);
    expect(verdict.status).toBe("partial_clean");
    expect(verdict.intersection_grading?.excluded[0].name).toBe("ruby");
    expect(verdict.intersection_grading?.shared_extractors).toContain("typescript");
  });

  it("parses, passes the job, and holds the exit-code contract", () => {
    const verdict = parseVerdict(raw);
    expect(() => assertExitCode(verdict, 0)).not.toThrow();
    expect(jobFailed(verdict, 0)).toBe(false);
    expect(isPartial(verdict)).toBe(true);
    expect(ungradedFacts(verdict)).toBe(2);
  });

  it("says in the summary that it graded part of the graph", async () => {
    await writeSummary(parseVerdict(raw), "basesha00", "headsha00", "0.4.5");
    const markdown = addRaw.mock.calls[0][0] as string;
    expect(markdown).toContain("(partial verdict)");
    expect(markdown).toContain("Excluded from grading: ruby (baseline lacks it)");
    expect(markdown).toContain("2 facts and 1 finding on the current side not graded");
  });

  it("says it in the step log, where the run appears to happen", () => {
    logVerdict(parseVerdict(raw));
    const warned = warning.mock.calls.map((call) => call[0] as string).join("\n");
    expect(warned).toContain("This is NOT a full verdict.");
  });

  it("says it on the diff, where the reviewer reads", () => {
    annotate(parseVerdict(raw));
    const warned = warning.mock.calls.map((call) => call[0] as string).join("\n");
    expect(warned).toContain("Partial verdict: only producers present in BOTH snapshots were graded");
  });

  it("renders SARIF over it without a second check run", () => {
    const document = JSON.parse(toSarif(parseVerdict(raw), "0.4.5"));
    expect(document.version).toBe("2.1.0");
    expect(document.runs[0].tool.driver.name).toBe("enola");
    // This particular change introduced no findings at all — the graded intersection was
    // clean — so the run is empty rather than absent. A SARIF upload of it says "nothing
    // found here", which is true, and is the point of writing one on a pass.
    expect(document.runs[0].results).toEqual([]);
  });
});
