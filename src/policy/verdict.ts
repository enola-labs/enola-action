import { promises as fs } from "node:fs";
import { Breach, ExcludedProducer, Verdict, VerdictStatus } from "../core/types.js";

// The status → exit code contract, and the only place it is written down.
//
// `partial_clean` and `partial_regression` exit 0 and 1 like their whole-verdict
// counterparts: Enola grades the intersection of the producers both snapshots share
// rather than declining, so CI needs no change — but the action does, because it reads
// the NAME. See VerdictStatus.
const exitCodes: Record<VerdictStatus, number> = {
  clean: 0,
  partial_clean: 0,
  regression: 1,
  partial_regression: 1,
  usage_error: 2,
  incomparable: 3,
};

export function isKnownStatus(status: string): status is VerdictStatus {
  return Object.prototype.hasOwnProperty.call(exitCodes, status);
}

// A verdict Enola graded over a subset of its producers. It is a real pass or a real
// fail — of the facts it could compare. What it is NOT is a full verdict, and every
// surface that reports one has to say so.
export function isPartial(verdict: Verdict): boolean {
  return verdict.status === "partial_clean" || verdict.status === "partial_regression";
}

// An unknown status must not fail the job by itself.
//
// This action used to reject any status outside a closed set of four. Enola then added
// two, exiting 0 and 1 as before, and the gate turned every clean pull request red with
// "Unknown Enola status: partial_clean" — a green build reported as broken by the tool
// that was supposed to be reading it. A name this action does not know is now a loud
// warning and the PROCESS EXIT CODE decides, which is the contract Enola documents and
// the one thing that cannot drift out from under a consumer. It never turns a failure
// green: a non-zero exit still fails the job.
export function parseVerdict(raw: string): Verdict {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Enola returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!value || typeof value !== "object") throw new Error("Enola verdict is not an object.");
  const verdict = value as Partial<Verdict>;
  if (typeof verdict.status !== "string" || !verdict.status) throw new Error("Enola verdict is missing a status.");
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

export function excludedProducers(verdict: Verdict): ExcludedProducer[] {
  return verdict.intersection_grading?.excluded || [];
}

// What a partial verdict did not grade. Reported as an output so a workflow can require
// a whole verdict — "fail if anything went ungraded" is a policy this action cannot
// decide for a consumer, but it must give them the number to decide with.
export function ungradedFacts(verdict: Verdict): number {
  return excludedProducers(verdict).reduce((n, p) => n + p.baseline_facts_excluded + p.current_facts_excluded, 0);
}

export function ungradedFindings(verdict: Verdict): number {
  return excludedProducers(verdict).reduce((n, p) => n + p.baseline_findings_excluded + p.current_findings_excluded, 0);
}

// Whether the job goes red. A known status decides by its documented exit code; an
// unknown one by the exit code Enola actually returned.
export function jobFailed(verdict: Verdict, exitCode: number): boolean {
  if (isKnownStatus(verdict.status)) return exitCodes[verdict.status] !== 0;
  return exitCode !== 0;
}

export function assertExitCode(verdict: Verdict, exitCode: number): void {
  if (!isKnownStatus(verdict.status)) return; // Nothing to assert against; the caller warns.
  const expected = exitCodes[verdict.status];
  if (exitCode !== expected) {
    throw new Error(`Enola status ${verdict.status} requires exit code ${expected}, received ${exitCode}.`);
  }
}

export async function saveVerdict(file: string, raw: string): Promise<void> {
  await fs.writeFile(file, `${raw.trim()}\n`, "utf8");
}
