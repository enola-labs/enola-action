import { promises as fs } from "node:fs";
import { Verdict, VerdictStatus } from "./types.js";

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

export function assertExitCode(verdict: Verdict, exitCode: number): void {
  const expected = exitCodes[verdict.status];
  if (exitCode !== expected) {
    throw new Error(`Enola status ${verdict.status} requires exit code ${expected}, received ${exitCode}.`);
  }
}

export async function saveVerdict(file: string, raw: string): Promise<void> {
  await fs.writeFile(file, `${raw.trim()}\n`, "utf8");
}
