import * as core from "@actions/core";
import { Breach, Census, Edge, Fact, Finding, Verdict } from "../core/types.js";
import {
  enforcesNothing,
  excludedProducers,
  isPartial,
  regressionCount,
  ungradedFacts,
  ungradedFindings,
} from "../policy/verdict.js";
import { buckets, placeOf, plural, ruleOf } from "./findings.js";

// How many entries any one section prints. The rest are counted, never dropped in
// silence: a rule declared over an existing codebase can produce thousands of findings
// at once, and a job summary that tries to render them all exceeds GitHub's size limit
// and writes nothing at all.
const LIST_LIMIT = 25;
const DELTA_LIMIT = 50;

function short(sha: string): string {
  return sha.slice(0, 8);
}

function breachList(breaches: Breach[]): string {
  return breaches
    .map((breach) => `- **${breach.fatal ? "fail" : "warn"}** — ${breach.measurement.count} ${breach.measurement.label}`)
    .join("\n");
}

function findingLine(finding: Finding): string {
  const at = placeOf(finding);
  const place = at?.file ? ` — \`${at.file}${at.line ? `:${at.line}` : ""}\`` : "";
  return `- **${ruleOf(finding)} · ${finding.confidence.toFixed(2)}** — ${finding.title}${place}`;
}

function findingList(findings: Finding[]): string {
  const shown = findings.slice(0, LIST_LIMIT).map(findingLine);
  if (findings.length > LIST_LIMIT) {
    shown.push(`- …and ${findings.length - LIST_LIMIT} more, in the \`verdict-file\` output.`);
  }
  return shown.join("\n");
}

// What the run could not see, as Enola's own verdict prints it. Ported from
// `pkg/check/census.go` so the sentence in the job summary is the sentence in the log.
export function censusLine(census?: Census | null): string {
  if (!census) return "";
  if (!census.recorded) return "could not see: not recorded (snapshot predates the census)";
  const parts: string[] = [];
  if (census.files_excluded_by_ignore > 0 || census.dirs_excluded_by_ignore > 0) {
    parts.push(
      `${plural(census.files_excluded_by_ignore, "file", "files")} and ` +
        `${plural(census.dirs_excluded_by_ignore, "directory", "directories")} excluded by ignore globs`,
    );
  }
  for (const skip of census.provider_skips || []) {
    if (skip.reason) {
      parts.push(`${skip.name} skipped (${skip.reason})`);
      continue;
    }
    const causes = (skip.causes || []).map((cause) => `${cause.count} ${cause.cause}`);
    if (causes.length) parts.push(`${skip.name}: ${causes.join(", ")}`);
  }
  for (const kind of Object.keys(census.outside_graph || {}).sort()) {
    const count = (census.outside_graph || {})[kind];
    if (count > 0) parts.push(`${count} ${kind} targets outside the graph`);
  }
  if (census.dead_exemptions > 0) {
    parts.push(plural(census.dead_exemptions, "exemption matching nothing", "exemptions matching nothing"));
  }
  if (census.unused_suppressions > 0) {
    parts.push(plural(census.unused_suppressions, "unused suppression", "unused suppressions"));
  }
  for (const overlap of census.provider_overlap || []) {
    if (overlap.conflict > 0 || overlap.respelled > 0) {
      parts.push(
        `${overlap.name}: ${overlap.conflict} relations contradict the extractor, ` +
          `${overlap.respelled} respelled, ${overlap.already_resolved} repeated`,
      );
    }
  }
  if (census.dynamic_feature_classes > 0) {
    parts.push(
      plural(census.dynamic_feature_classes, "class carrying a dynamic dispatch", "classes carrying a dynamic dispatch"),
    );
  }
  return parts.length ? `could not see: ${parts.join("; ")}` : "could not see: nothing";
}

// What a partial verdict graded and what it could not, in the engine's own words.
export function intersectionLines(verdict: Verdict): string[] {
  const grading = verdict.intersection_grading;
  if (!grading) return [];
  const shared = [...(grading.shared_extractors || []), ...(grading.shared_providers || []).map((p) => `${p} provider`)];
  const lines = [
    "**Partial verdict.** The two snapshots were produced by different producer sets, so only facts from " +
      "producers present in BOTH snapshots were graded. This is NOT a full verdict.",
    `Graded over the shared producer set (${plural(shared.length, "family", "families")}: ${shared.join(", ")}).`,
  ];
  for (const producer of grading.excluded || []) {
    const label = producer.kind === "provider" ? `${producer.name} provider` : producer.name;
    lines.push(`Excluded from grading: ${label} (${producer.lacked_by} lacks it) — ${exclusionTally(producer)}.`);
  }
  lines.push("A regression among an excluded producer's facts cannot be graded here and is NOT reported.");
  return lines;
}

function exclusionTally(producer: {
  baseline_facts_excluded: number;
  current_facts_excluded: number;
  baseline_findings_excluded: number;
  current_findings_excluded: number;
}): string {
  const parts: string[] = [];
  const side = (label: string, factCount: number, findingCount: number) => {
    if (factCount === 0 && findingCount === 0) return;
    const facts = plural(factCount, "fact", "facts");
    parts.push(findingCount > 0 ? `${facts} and ${plural(findingCount, "finding", "findings")} ${label}` : `${facts} ${label}`);
  };
  side("on the baseline side", producer.baseline_facts_excluded, producer.baseline_findings_excluded);
  side("on the current side", producer.current_facts_excluded, producer.current_findings_excluded);
  return parts.length ? `${parts.join(", ")} not graded` : "no facts on either side matched it";
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
  const census = censusLine(verdict.census);
  if (census) core.info(`  ${census}`);
  for (const breach of verdict.breaches || []) {
    const line = `${breach.measurement.count} ${breach.measurement.label}`;
    if (breach.fatal) core.info(`  Regression: ${line} (over threshold)`);
    else core.info(`  Warning: ${line} (over threshold)`);
  }
  core.info(
    `Delta: facts +${verdict.facts_added}/-${verdict.facts_removed}, ` +
      `edges +${verdict.edges_added}/-${verdict.edges_removed}`,
  );
  // Every bucket that carries something, so nothing the engine reported is invisible in
  // the log even when this action has no section of its own for it.
  const others = buckets(verdict)
    .filter((bucket) => !["failure", "advisory", "resolved"].includes(bucket.name) && bucket.findings.length)
    .map((bucket) => `${bucket.findings.length} ${bucket.name}`);
  if (others.length) core.info(`Also reported: ${others.join(", ")}`);
  for (const warning of verdict.comparability_warnings || []) core.warning(warning);
  // A partial verdict is a real pass or fail over PART of the graph. Warned, not merely
  // logged: a green check that graded half the producers must not read as a full one.
  if (isPartial(verdict)) {
    for (const line of intersectionLines(verdict)) core.warning(line.replace(/\*\*/g, ""));
  }
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
      const at = placeOf(finding);
      const place = at?.file ? ` (${at.file}${at.line ? `:${at.line}` : ""})` : "";
      core.info(`  ${label}: ${ruleOf(finding)} · ${finding.confidence.toFixed(2)} — ${finding.title}${place}`);
    }
  }
}

function factLine(fact: Fact): string {
  return `- \`${fact.kind}\` ${fact.name}${fact.file ? ` — \`${fact.file}${fact.line ? `:${fact.line}` : ""}\`` : ""}`;
}

function edgeLine(edge: Edge): string {
  return `- \`${edge.source}\` —${edge.kind}→ \`${edge.target}\``;
}

function deltaSection<T>(title: string, entries: T[], line: (entry: T) => string): string {
  if (!entries.length) return "";
  const shown = entries.slice(0, DELTA_LIMIT).map(line);
  if (entries.length > DELTA_LIMIT) shown.push(`- …and ${entries.length - DELTA_LIMIT} more.`);
  return `<details><summary>${title} (${entries.length})</summary>\n\n${shown.join("\n")}\n\n</details>\n\n`;
}

// The one line a reader skims, and the mark beside it.
//
// Every branch here is a distinct thing that happened, and collapsing any two would make
// the summary say something untrue: a warn-only run that reported regressions is not "no
// structural regression", a run with no policy did not look and find nothing, and a
// partial verdict is not a verdict over the whole graph.
function headlineOf(verdict: Verdict): { icon: string; title: string } {
  // Counts breaches, not just findings: a spillover-only failure has no failing finding,
  // and "0 structural regression(s) introduced" over a red job is worse than no summary.
  const regressions = regressionCount(verdict);
  const advisories = (verdict.advisories || []).length;
  const unenforced = enforcesNothing(verdict);
  const passed = verdict.status === "clean" || verdict.status === "partial_clean";
  const regressed = verdict.status === "regression" || verdict.status === "partial_regression";
  // A partial pass gets the mark of an outcome that needs reading, not the tick of one
  // that does not: it graded part of the graph.
  const icon = passed ? (isPartial(verdict) ? "⚠️" : "✅") : regressed ? "❌" : "⚠️";

  let title: string;
  if (passed && regressions) title = `${regressions} regression(s) reported in warn-only mode`;
  else if (passed && unenforced && advisories) title = `${advisories} finding(s) reported, nothing enforced`;
  else if (passed) title = "No structural regression";
  else if (regressed) title = `${regressions} structural regression(s) introduced`;
  else if (verdict.status === "incomparable") title = "Enola refused to grade incomparable snapshots";
  else title = "Enola could not complete the architecture check";

  return { icon, title: isPartial(verdict) ? `${title} (partial verdict)` : title };
}

// One section per bucket that carries something, in the order a reader needs them: what
// failed, why the job is red, what was merely reported, and then the four kinds of
// finding Enola deliberately refuses to fold into any of those.
function findingSections(verdict: Verdict): string {
  const unenforced = enforcesNothing(verdict);
  const advisories = verdict.advisories || [];
  const breaches = verdict.breaches || [];
  let markdown = "";

  if ((verdict.failures || []).length) markdown += `## Regressions\n\n${findingList(verdict.failures || [])}\n\n`;
  // Ahead of advisories: a fatal breach is why the job is red, and it must not sit below
  // findings that did not fail it.
  if (breaches.length) markdown += `## Measurements over threshold\n\n${breachList(breaches)}\n\n`;
  if (advisories.length) {
    markdown += `## ${unenforced ? "Findings (reported, not enforced)" : "Advisory findings"}\n\n${findingList(advisories)}\n\n`;
  }
  // A rule that arrived with this change, over code the change did not touch. Its own
  // section because folding it into advisories would report "this change introduced
  // 3,980 findings" about a pull request that introduced one declaration.
  const declared = verdict.declared || [];
  if (declared.length) {
    markdown += `## Declared by this change (${declared.length})\n\nThe rules are new; the code they name is not. ` +
      `Not counted as regressions.\n\n${findingList(declared)}\n\n`;
  }
  const excused = [...(verdict.suppressed || []), ...(verdict.exempted || [])];
  if (excused.length) {
    markdown += `## Excused (${excused.length})\n\nSigned away by the ledger or exempted by the declaration — ` +
      `reported so the excuse stays auditable.\n\n${findingList(excused)}\n\n`;
  }
  // Breaches that stopped being reported without being fixed, and findings that moved
  // with no structural cause. Enola holds them out of "resolved" on purpose: a rule that
  // stopped asking the question is not an answer to it.
  const notGraded: [string, Finding[]][] = [
    ["Silenced — the code left the component the rule binds", verdict.silenced || []],
    ["Undeclared — the rule changed, the code did not", verdict.undeclared || []],
    ["Unattributed — this pair of snapshots cannot judge them", verdict.unattributed || []],
    ["Incidental — moved with no structural cause", verdict.incidental || []],
    ["Descriptive — describes the graph rather than complains about it", verdict.descriptive || []],
  ].filter(([, findings]) => (findings as Finding[]).length) as [string, Finding[]][];
  if (notGraded.length) {
    markdown += "## Reported, not graded\n\n";
    for (const [label, findings] of notGraded) {
      markdown += `**${label}** (${findings.length})\n\n${findingList(findings)}\n\n`;
    }
  }
  return markdown;
}

// The delta table, and the complete delta under it on request. Enola's own --detail
// prints that under the text verdict; the JSON the action reads carries the same delta,
// so the input renders it here rather than asking the engine for a second run.
function deltaMarkdown(verdict: Verdict, detail: boolean): string {
  const findings = (verdict.failures || []).length + (verdict.advisories || []).length;
  let markdown = `## Architectural change\n\n| | Added | Removed |\n|---|---:|---:|\n`;
  markdown += `| Facts | ${verdict.facts_added} | ${verdict.facts_removed} |\n`;
  markdown += `| Edges | ${verdict.edges_added} | ${verdict.edges_removed} |\n`;
  markdown += `| Findings | ${findings} | ${(verdict.resolved || []).length} |\n`;
  if (isPartial(verdict)) {
    markdown += `\n${ungradedFacts(verdict)} fact(s) and ${ungradedFindings(verdict)} finding(s) from ` +
      `${plural(excludedProducers(verdict).length, "producer", "producers")} were not graded.\n`;
  }
  if (detail && verdict.diff) {
    markdown += `\n## Full delta\n\n`;
    markdown += deltaSection("Edges added", verdict.diff.edges_added || [], edgeLine);
    markdown += deltaSection("Edges removed", verdict.diff.edges_removed || [], edgeLine);
    markdown += deltaSection("Facts added", verdict.diff.facts_added || [], factLine);
    markdown += deltaSection("Facts removed", verdict.diff.facts_removed || [], factLine);
  }
  return markdown;
}

export async function writeSummary(
  verdict: Verdict,
  baseSha: string,
  headSha: string,
  version: string,
  detail = false,
): Promise<void> {
  const { icon, title } = headlineOf(verdict);
  let markdown = `# Enola architecture check\n\n${icon} **${title}**\n\n`;
  markdown += `| Base | Current | Enola |\n|---|---|---|\n| \`${short(baseSha)}\` | \`${short(headSha)}\` | \`${version}\` |\n\n`;
  const census = censusLine(verdict.census);
  if (census) markdown += `_${census}_\n\n`;
  const intersection = intersectionLines(verdict);
  if (intersection.length) markdown += `${intersection.map((line) => `> ${line}`).join("\n>\n")}\n\n`;
  if (enforcesNothing(verdict)) {
    markdown += "> **No policy set.** Nothing in this run could fail the job — every finding below is a " +
      "report. Set `fail-on` (e.g. `fail-on: layers`) or `max-spillover` to make this a gate.\n\n";
  }
  markdown += findingSections(verdict);
  if (verdict.comparability_warnings?.length) {
    markdown += `## Comparability\n\n${verdict.comparability_warnings.map((warning) => `- ${warning}`).join("\n")}\n\n`;
  }
  markdown += deltaMarkdown(verdict, detail);
  await core.summary.addRaw(markdown).write();
}
