import { promises as fs } from "node:fs";
import { Breach, Verdict, VerdictStatus } from "../core/types.js";

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

// Whether this run could have failed at all.
//
// Enola fails nothing unless a policy names it: no `fail-on`, no `max-spillover`, and
// every finding is reported while the job stays green. That is a legitimate way to run
// the action — a pull-request report rather than a gate — but it is indistinguishable
// from a working gate if nobody says so, and a green check nobody configured is the
// worst outcome this action has: it looks like protection and is not.
export function enforcesNothing(verdict: Verdict): boolean {
  const policy = verdict.policy;
  if (!policy) return false; // An older Enola that does not report its policy.
  return (policy.fail_explainers || []).length === 0 && (policy.thresholds || []).length === 0;
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
