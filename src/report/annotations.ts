import * as core from "@actions/core";
import { Verdict } from "../core/types.js";
import {
  LEVEL_ERROR,
  LEVEL_WARNING,
  Placement,
  actionOf,
  becauseOf,
  hostPath,
  oneLine,
  placements,
  plural,
  ruleOf,
} from "./findings.js";

const LIMIT = 10;

function properties(placement: Placement, root?: string): core.AnnotationProperties {
  const at = placement.at;
  return {
    title: `Enola: ${ruleOf(placement.finding)}`,
    file: at?.file ? hostPath(at.file, root) : undefined,
    startLine: at?.line,
    endLine: at?.end_line || at?.line,
    startColumn: at?.line ? at.column : undefined,
    endColumn: at?.line ? at.end_column : undefined,
  };
}

// One annotation's text: what the finding says, how certain it is, and — when the team
// wrote one — the reason their own rule gives and the action it suggests. The rule id
// goes in the annotation's title, so it is not repeated here.
function message(placement: Placement): string {
  const finding = placement.finding;
  const lines = [`${oneLine(finding.title)} (confidence ${finding.confidence.toFixed(2)})`];
  if (placement.bucket.name === "declared") {
    lines.push("Declared by this change: the rule is new, the code it names is not. Not counted as a regression.");
  }
  const because = becauseOf(finding);
  if (because) lines.push(`Because: ${because}`);
  const action = actionOf(finding);
  if (action) lines.push(`Action: ${action}`);
  return lines.join("\n");
}

// Annotations for the buckets a reviewer can act on: failures as errors, advisories and
// newly declared rules as warnings. The note-level buckets — suppressed, exempted,
// silenced, undeclared, incidental, descriptive, unattributed — stay in the summary:
// they are things that did NOT happen to this change, and pinning them to lines in the
// diff would bury the ones that did.
//
// `root` is the checked-out directory the verdict was computed in. It is what lets a
// repository-prefixed path from a union snapshot resolve to a file the host can open;
// without it the path is used exactly as recorded, never guessed at.
export function annotate(verdict: Verdict, root?: string): void {
  const shown: Record<string, number> = { [LEVEL_ERROR]: 0, [LEVEL_WARNING]: 0 };
  const dropped: Record<string, number> = { [LEVEL_ERROR]: 0, [LEVEL_WARNING]: 0 };
  let unplaced = 0;

  for (const placement of placements(verdict)) {
    const level = placement.bucket.level;
    if (level !== LEVEL_ERROR && level !== LEVEL_WARNING) continue;
    if (!placement.at?.file) {
      unplaced++;
      continue;
    }
    if (shown[level] >= LIMIT) {
      dropped[level]++;
      continue;
    }
    shown[level]++;
    const emit = level === LEVEL_ERROR ? core.error : core.warning;
    emit(message(placement), properties(placement, root));
  }

  // A cap that hides findings without saying so reads as "that was all of them".
  for (const [level, count] of Object.entries(dropped)) {
    if (count > 0) {
      core.notice(
        `${plural(count, `further ${level}-level finding is`, `further ${level}-level findings are`)} ` +
          "not annotated (10 per level); the job summary and the verdict file carry them all.",
      );
    }
  }
  if (unplaced > 0) {
    core.notice(
      `${plural(unplaced, "finding", "findings")} without a position ${unplaced === 1 ? "stays" : "stay"} in the ` +
        "summary rather than being pinned to a line nobody wrote.",
    );
  }

  // A partial verdict passed or failed over PART of the graph. Said here as well as in
  // the summary, because the annotations are what a reviewer reads in the diff.
  const excluded = verdict.intersection_grading?.excluded || [];
  if (excluded.length) {
    const named = excluded.map((producer) => `${producer.name} (${producer.kind}, ${producer.lacked_by} lacks it)`);
    core.warning(
      `Partial verdict: only producers present in BOTH snapshots were graded. Excluded: ${named.join("; ")}. ` +
        "A regression among an excluded producer's facts is NOT reported.",
    );
  }
  if (verdict.status === "incomparable") {
    core.error(
      `Enola refused to grade this change: ${(verdict.comparability_warnings || []).join("; ") || "snapshots are not comparable"}`,
    );
  }
}
