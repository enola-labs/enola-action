import * as core from "@actions/core";
import { Breach, Finding, Verdict } from "./types.js";
import { enforcesNothing, fatalBreaches, regressionCount } from "./verdict.js";

function short(sha: string): string {
  return sha.slice(0, 8);
}

function breachList(breaches: Breach[]): string {
  return breaches
    .map((breach) => `- **${breach.fatal ? "fail" : "warn"}** — ${breach.measurement.count} ${breach.measurement.label}`)
    .join("\n");
}

function findingList(findings: Finding[]): string {
  return findings
    .map((finding) => {
      const at = finding.location || finding.evidence?.find((item) => item.file);
      const place = at?.file ? ` — \`${at.file}${"line" in at && at.line ? `:${at.line}` : ""}\`` : "";
      return `- **${finding.source || "architecture"} · ${finding.confidence.toFixed(2)}** — ${finding.title}${place}`;
    })
    .join("\n");
}

// The step log, not the job summary. A gate whose successful run prints nothing reads as
// a gate that did not run — the verdict has to be visible where the work appears to happen.
export function logVerdict(verdict: Verdict): void {
  const failures = verdict.failures || [];
  const advisories = verdict.advisories || [];
  core.info(
    `Verdict: ${verdict.status} — ${regressionCount(verdict)} regression(s), ${advisories.length} advisory, ` +
      `${(verdict.resolved || []).length} resolved`,
  );
  for (const breach of verdict.breaches || []) {
    const line = `${breach.measurement.count} ${breach.measurement.label}`;
    if (breach.fatal) core.info(`  Regression: ${line} (over threshold)`);
    else core.info(`  Warning: ${line} (over threshold)`);
  }
  core.info(
    `Delta: facts +${verdict.facts_added}/-${verdict.facts_removed}, ` +
      `edges +${verdict.edges_added}/-${verdict.edges_removed}`,
  );
  for (const warning of verdict.comparability_warnings || []) core.warning(warning);
  // Loud, and a warning rather than an info line: this run had no grounds to fail, so a
  // green check on it means "not graded", not "graded clean".
  if (enforcesNothing(verdict)) {
    core.warning(
      "No policy is set, so nothing in this run could fail the job. Enola reported " +
        `${(verdict.advisories || []).length} finding(s) and exited clean. Set fail-on ` +
        "(e.g. fail-on: layers) or max-spillover to make this a gate.",
    );
  }
  for (const [label, findings] of [["Regression", failures], ["Advisory", advisories]] as const) {
    for (const finding of findings) {
      const at = finding.location || finding.evidence?.find((item) => item.file);
      const place = at?.file ? ` (${at.file}${"line" in at && at.line ? `:${at.line}` : ""})` : "";
      core.info(`  ${label}: ${finding.source || "architecture"} · ${finding.confidence.toFixed(2)} — ${finding.title}${place}`);
    }
  }
}

export async function writeSummary(verdict: Verdict, baseSha: string, headSha: string, version: string): Promise<void> {
  const failures = verdict.failures || [];
  const advisories = verdict.advisories || [];
  const breaches = verdict.breaches || [];
  // Counts breaches, not just findings: a spillover-only failure has no failing finding,
  // and "0 structural regression(s) introduced" over a red job is worse than no summary.
  const regressions = regressionCount(verdict);
  const icon = verdict.status === "clean" ? "✅" : verdict.status === "regression" ? "❌" : "⚠️";
  const unenforced = enforcesNothing(verdict);
  const title = verdict.status === "clean"
    ? regressions ? `${regressions} regression(s) reported in warn-only mode`
      : unenforced && advisories.length ? `${advisories.length} finding(s) reported, nothing enforced`
      : "No structural regression"
    : verdict.status === "regression" ? `${regressions} structural regression(s) introduced`
    : verdict.status === "incomparable" ? "Enola refused to grade incomparable snapshots"
    : "Enola could not complete the architecture check";

  let markdown = `# Enola architecture check\n\n${icon} **${title}**\n\n`;
  markdown += `| Base | Current | Enola |\n|---|---|---|\n| \`${short(baseSha)}\` | \`${short(headSha)}\` | \`${version}\` |\n\n`;
  if (unenforced) {
    markdown += "> **No policy set.** Nothing in this run could fail the job — every finding below is a " +
      "report. Set `fail-on` (e.g. `fail-on: layers`) or `max-spillover` to make this a gate.\n\n";
  }
  if (failures.length) markdown += `## Regressions\n\n${findingList(failures)}\n\n`;
  // Ahead of advisories: a fatal breach is why the job is red, and it must not sit below
  // findings that did not fail it.
  if (breaches.length) markdown += `## Measurements over threshold\n\n${breachList(breaches)}\n\n`;
  if (advisories.length) {
    markdown += `## ${unenforced ? "Findings (reported, not enforced)" : "Advisory findings"}\n\n${findingList(advisories)}\n\n`;
  }
  if (verdict.comparability_warnings?.length) {
    markdown += `## Comparability\n\n${verdict.comparability_warnings.map((warning) => `- ${warning}`).join("\n")}\n\n`;
  }
  markdown += `## Architectural change\n\n| | Added | Removed |\n|---|---:|---:|\n`;
  markdown += `| Facts | ${verdict.facts_added} | ${verdict.facts_removed} |\n`;
  markdown += `| Edges | ${verdict.edges_added} | ${verdict.edges_removed} |\n`;
  markdown += `| Findings | ${failures.length + advisories.length} | ${(verdict.resolved || []).length} |\n`;
  await core.summary.addRaw(markdown).write();
}
