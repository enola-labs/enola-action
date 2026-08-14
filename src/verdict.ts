import { promises as fs } from "node:fs";
import { Breach, Verdict, VerdictStatus } from "./types.js";

const statuses = new Set<VerdictStatus>(["clean", "regression", "usage_error", "incomparable"]);
const exitCodes: Record<VerdictStatus, number> = {
  clean: 0,
  regression: 1,
  usage_error: 2,
  incomparable: 3,
};

export function parseVerdict(raw: string): Verdict {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Enola returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!value || typeof value !== "object") throw new Error("Enola verdict is not an object.");
  const verdict = value as Partial<Verdict>;
  if (!verdict.status || !statuses.has(verdict.status)) throw new Error(`Unknown Enola status: ${verdict.status}`);
  for (const key of ["edges_added", "edges_removed", "facts_added", "facts_removed"] as const) {
    if (typeof verdict[key] !== "number") throw new Error(`Enola verdict is missing numeric ${key}.`);
  }
  return verdict as Verdict;
}

export function fatalBreaches(verdict: Verdict): Breach[] {
  return (verdict.breaches || []).filter((breach) => breach.fatal);
}

// What the job should call "a regression", counted in ONE place.
//
// A change can be a regression with zero failing findings: `max-spillover` gates on a
// measurement rather than a finding, and Enola marks that breach fatal. Counting only
// `failures` produced a job that failed with the summary "0 structural regression(s)
// introduced" and no section saying why — the exact contradiction Enola's own renderer
// counts breaches to avoid. Every surface that reports a count reads this.
export function regressionCount(verdict: Verdict): number {
  return (verdict.failures || []).length + fatalBreaches(verdict).length;
}

export function assertExitCode(verdict: Verdict, exitCode: number): void {
  const expected = exitCodes[verdict.status];
  if (exitCode !== expected) {
    throw new Error(`Enola status ${verdict.status} requires exit code ${expected}, received ${exitCode}.`);
  }
}

export async function saveVerdict(file: string, raw: string): Promise<void> {
  await fs.writeFile(file, `${raw.trim()}\n`, "utf8");
}
