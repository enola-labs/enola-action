import * as core from "@actions/core";
import { Finding, Verdict } from "./types.js";

function short(sha: string): string {
  return sha.slice(0, 8);
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

export async function writeSummary(verdict: Verdict, baseSha: string, headSha: string, version: string): Promise<void> {
  const failures = verdict.failures || [];
  const advisories = verdict.advisories || [];
  const icon = verdict.status === "clean" ? "✅" : verdict.status === "regression" ? "❌" : "⚠️";
  const title = verdict.status === "clean"
    ? failures.length ? `${failures.length} regression(s) reported in warn-only mode` : "No structural regression"
    : verdict.status === "regression" ? `${failures.length} structural regression(s) introduced`
    : verdict.status === "incomparable" ? "Enola refused to grade incomparable snapshots"
    : "Enola could not complete the architecture check";

  let markdown = `# Enola architecture check\n\n${icon} **${title}**\n\n`;
  markdown += `| Base | Current | Enola |\n|---|---|---|\n| \`${short(baseSha)}\` | \`${short(headSha)}\` | \`${version}\` |\n\n`;
  if (failures.length) markdown += `## Regressions\n\n${findingList(failures)}\n\n`;
  if (advisories.length) markdown += `## Advisory findings\n\n${findingList(advisories)}\n\n`;
  if (verdict.comparability_warnings?.length) {
    markdown += `## Comparability\n\n${verdict.comparability_warnings.map((warning) => `- ${warning}`).join("\n")}\n\n`;
  }
  markdown += `## Architectural change\n\n| | Added | Removed |\n|---|---:|---:|\n`;
  markdown += `| Facts | ${verdict.facts_added} | ${verdict.facts_removed} |\n`;
  markdown += `| Edges | ${verdict.edges_added} | ${verdict.edges_removed} |\n`;
  markdown += `| Findings | ${failures.length + advisories.length} | ${(verdict.resolved || []).length} |\n`;
  await core.summary.addRaw(markdown).write();
}
