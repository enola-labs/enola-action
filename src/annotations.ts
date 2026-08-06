import * as core from "@actions/core";
import { Finding, Location, Verdict } from "./types.js";

const LIMIT = 10;

function location(finding: Finding): Location | undefined {
  if (finding.location?.file) return finding.location;
  const evidence = finding.evidence?.find((item) => item.file);
  return evidence?.file ? { file: evidence.file } : undefined;
}

function properties(finding: Finding): core.AnnotationProperties {
  const at = location(finding);
  return {
    title: `Enola: ${finding.source || "architecture"}`,
    file: at?.file,
    startLine: at?.line,
    endLine: at?.end_line || at?.line,
  };
}

function message(finding: Finding): string {
  return `${finding.title} (confidence ${finding.confidence.toFixed(2)})`;
}

export function annotate(verdict: Verdict): void {
  for (const finding of (verdict.failures || []).slice(0, LIMIT)) {
    core.error(message(finding), properties(finding));
  }
  for (const finding of (verdict.advisories || []).slice(0, LIMIT)) {
    core.warning(message(finding), properties(finding));
  }
  if (verdict.status === "incomparable") {
    core.error(`Enola refused to grade this change: ${(verdict.comparability_warnings || []).join("; ") || "snapshots are not comparable"}`);
  }
}
