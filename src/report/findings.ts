import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { Evidence, Finding, Verdict } from "../core/types.js";

// How to read a finding, in one place, ported from the engine's own reader
// (`pkg/check/format.go`). Every surface the job leaves behind — annotations, the
// summary, SARIF — describes a finding through these, so the three cannot come to
// disagree about which rule a finding is, where it points, or why it did not fail.

export const LEVEL_ERROR = "error";
export const LEVEL_WARNING = "warning";
export const LEVEL_NOTE = "note";
export const LEVEL_NONE = "none";

export interface Bucket {
  name: string;
  level: string;
  findings: Finding[];
}

// Every bucket a verdict carries, in the engine's order.
//
// The buckets below `advisory` are the ones this action used to drop on the floor.
// They are not noise: `declared` is a rule that arrived over code nobody touched (a
// count that would read as "this change introduced 3,980 findings" if folded into
// advisories), `silenced` and `undeclared` are breaches that stopped being REPORTED
// without being fixed, and `suppressed`/`exempted` are the audit trail of what a ledger
// excused. Enola splits them apart precisely so a reader is not told a fix happened
// when a question stopped being asked.
export function buckets(verdict: Verdict): Bucket[] {
  return [
    { name: "failure", level: LEVEL_ERROR, findings: verdict.failures || [] },
    { name: "advisory", level: LEVEL_WARNING, findings: verdict.advisories || [] },
    { name: "declared", level: LEVEL_WARNING, findings: verdict.declared || [] },
    { name: "descriptive", level: LEVEL_NOTE, findings: verdict.descriptive || [] },
    { name: "incidental", level: LEVEL_NOTE, findings: verdict.incidental || [] },
    { name: "suppressed", level: LEVEL_NOTE, findings: verdict.suppressed || [] },
    { name: "exempted", level: LEVEL_NOTE, findings: verdict.exempted || [] },
    { name: "silenced", level: LEVEL_NOTE, findings: verdict.silenced || [] },
    { name: "undeclared", level: LEVEL_NOTE, findings: verdict.undeclared || [] },
    { name: "unattributed", level: LEVEL_NOTE, findings: verdict.unattributed || [] },
    { name: "resolved", level: LEVEL_NONE, findings: verdict.resolved || [] },
  ];
}

export interface Placement {
  bucket: Bucket;
  finding: Finding;
  at?: Evidence;
  /** Whether `at` carries a line, i.e. whether the extractor measured a position. */
  located: boolean;
  identity: string;
}

export function placements(verdict: Verdict): Placement[] {
  const out: Placement[] = [];
  for (const bucket of buckets(verdict)) {
    for (const finding of bucket.findings) {
      const at = placeOf(finding);
      out.push({ bucket, finding, at, located: Boolean(at?.file && at.line), identity: identityOf(finding) });
    }
  }
  return out;
}

const ruleTitle = /^(?:Strict constraint|Advisory constraint|Constraint|Exempted from constraint) (\S+?):? /;
const becauseSuffix = /(?:^|\s)(?:Rule because|Because): (.+)$/;

// The rule a finding reports under: the declared constraint's id when the finding is a
// constraint verdict, the explainer's name otherwise. Read from the evidence the
// explainer stamps, then from the title, never guessed from the description.
export function ruleOf(finding: Finding): string {
  for (const evidence of finding.evidence || []) {
    if (evidence.fact?.startsWith("rule: ")) return evidence.fact.slice("rule: ".length);
  }
  const match = ruleTitle.exec(finding.title || "");
  if (match) return match[1];
  return finding.source || "unknown";
}

// The `because` a declared rule carries. Findings from other explainers have no reason
// the team wrote, so their description stands in.
export function reasonOf(finding: Finding): string {
  const match = becauseSuffix.exec(finding.description || "");
  return match ? match[1].trim() : oneLine(finding.description || "");
}

// The reason the TEAM wrote, and only that. `reasonOf` falls back to the explainer's own
// description, which is right for a SARIF rule description and wrong for an annotation:
// it would repeat prose the summary already carries onto every line of the diff.
export function becauseOf(finding: Finding): string {
  const match = becauseSuffix.exec(finding.description || "");
  return match ? match[1].trim() : "";
}

export function actionOf(finding: Finding): string {
  return finding.suggested_actions?.[0] || "";
}

// Where a finding points. A measured span wins over a bare file: an annotation on the
// import that caused a layer violation is worth having, and it is what the evidence now
// carries. A file with no line still annotates — GitHub shows it at the head of the
// file — but it never invents one.
export function placeOf(finding: Finding): Evidence | undefined {
  if (finding.location?.file) {
    const { file, line, end_line } = finding.location;
    return { file, line, end_line };
  }
  const positioned = (finding.evidence || []).find((item) => item.file && item.line && item.line > 0);
  if (positioned) return positioned;
  return (finding.evidence || []).find((item) => item.file);
}

// The path a host can open: the fact's file with the repository label a union snapshot
// prefixes removed when the rest resolves on disk, and the file as recorded otherwise.
// A wrong guess here pins a finding to a file the reviewer does not have, so the guess
// is only made when the filesystem confirms it.
export function hostPath(file: string, root?: string): string {
  if (!root) return file;
  if (existsSync(path.join(root, file))) return file;
  const cut = file.indexOf("/");
  if (cut > 0) {
    const rest = file.slice(cut + 1);
    if (existsSync(path.join(root, rest))) return rest;
  }
  return file;
}

// What the policy did with a finding's explainer: fail, warn (a fail-on explainer under
// warn-only), or report.
export function policyOf(verdict: Verdict, finding: Finding): string {
  const enforced = (verdict.policy?.fail_explainers || []).some((name) => name === finding.source);
  if (enforced && verdict.policy?.warn_only) return "warn";
  if (enforced) return "fail";
  return "report";
}

// The ledger entry or exemption that kept a finding out of the gate, for the two buckets
// that have one. Re-matched from the policy the verdict recorded, so the excuse named is
// the one that applied.
export function excuseOf(verdict: Verdict, bucket: string, finding: Finding): string {
  if (bucket === "suppressed") {
    for (const entry of verdict.policy?.suppressions || []) {
      if (suppresses(entry, finding)) {
        const owner = entry.owner || "the ledger";
        const date = entry.date || "an unstated date";
        return `suppressed by ${owner} on ${date}: ${entry.reason || "no reason given"}`;
      }
    }
    return "suppressed by the ledger";
  }
  if (bucket === "exempted") {
    for (const evidence of finding.evidence || []) {
      if (evidence.fact?.startsWith("rule: ") && evidence.detail?.startsWith("exempted by ")) return evidence.detail;
    }
    return "exempted by the declaration";
  }
  return "";
}

function suppresses(entry: { finding_title_prefix?: string; rule?: string }, finding: Finding): boolean {
  if (entry.finding_title_prefix) return (finding.title || "").startsWith(entry.finding_title_prefix);
  if (finding.source !== "constraints") return false;
  return ["Constraint", "Advisory constraint", "Strict constraint"].some((prefix) =>
    (finding.title || "").startsWith(`${prefix} ${entry.rule} violated:`),
  );
}

// The stable identity of a finding across snapshots — the same key the engine's diff
// pairs findings on, so a fingerprint that leaves this action is the one the verdict was
// computed with rather than a second derivation of it.
export function identityOf(finding: Finding): string {
  return createHash("sha256").update(findingKey(finding)).digest("hex").slice(0, 16);
}

// The engine's own separators, byte for byte: a NUL between the source and the title,
// a unit separator between cited entities. A fingerprint derived from a different key
// is a different identity, and the point of carrying one is that CI sees the identity
// the verdict was computed with.
const KEY_SEPARATOR = "\u0000";
const ENTITY_SEPARATOR = "\u001f";

function findingKey(finding: Finding): string {
  const source = finding.source || "";
  if (source === "cycles") return source + KEY_SEPARATOR + sortedEvidenceEntities(finding);
  return source + KEY_SEPARATOR + normalizeTitle(finding.title || "");
}

function sortedEvidenceEntities(finding: Finding): string {
  return (finding.evidence || [])
    .map((item) => item.fact || item.symbol || item.file || "")
    .filter(Boolean)
    .sort()
    .join(ENTITY_SEPARATOR);
}

function normalizeTitle(title: string): string {
  return title.replace(/[0-9]+(\.[0-9]+)?/g, "#");
}

export function oneLine(text: string): string {
  return text.split(/\s+/).filter(Boolean).join(" ");
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
