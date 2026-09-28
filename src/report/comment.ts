import { CommentWhen, Verdict } from "../core/types.js";
import { enforcesNothing, jobFailed } from "../policy/verdict.js";
import {
  comparabilityMarkdown,
  deltaMarkdown,
  gradedSections,
  guidanceMarkdown,
  headerMarkdown,
  otherFindingSections,
  reviewersMarkdown,
  short,
} from "./summary.js";
import { packageMetricsMarkdown } from "./packagemetrics.js";

// GitHub rejects a comment body over 65,536 characters. The margin is for the marker,
// the footer and the truncation note.
export const COMMENT_LIMIT = 60_000;

export interface CommentContext {
  marker: string;
  baseSha: string;
  headSha: string;
  version: string;
  runUrl?: string;
}

// The marker that finds this step's comment again on the next push. Keyed, so two steps
// grading two directories of one repository each keep a comment of their own.
export function commentMarker(key: string): string {
  return `<!-- enola-action:${key.replace(/[^\w./-]/g, "_")} -->`;
}

// Whether this run earns a comment. `auto` follows the policy Enola reports it enforced,
// not the inputs: a run that could fail nothing is being evaluated and comments every
// time; one that enforces something comments only when it fails. An Enola too old to
// report its policy counts as enforcing, so it comments only when the job fails.
//
// A failed job earns one in every mode. That is what lets the replacement for a comment
// that was not earned say "passing" without ever being wrong: an incomparable run fails
// with no finding at all, and must not overwrite a comment with good news.
export function shouldComment(when: CommentWhen, verdict: Verdict, exitCode: number): boolean {
  if (jobFailed(verdict, exitCode)) return true;
  const mode = when === "auto" ? (enforcesNothing(verdict) ? "always" : "failure") : when;
  if (mode === "always") return true;
  if (mode === "findings") {
    return (verdict.failures || []).length + (verdict.advisories || []).length + (verdict.breaches || []).length > 0;
  }
  return false;
}

function footer(ctx: CommentContext): string {
  return ctx.runUrl ? `Full report: [workflow run](${ctx.runUrl}).\n` : "";
}

function details(title: string, markdown: string): string {
  // The blank line before </details> ends a table the section closes on; without it
  // GitHub can read the closing tag as another row.
  return markdown ? `<details><summary>${title}</summary>\n\n${markdown.trimEnd()}\n\n</details>\n\n` : "";
}

// The comment: what the job summary leads with, in full, and the rest folded away. It
// never carries the full delta, which is what the job summary is for.
export function renderComment(verdict: Verdict, ctx: CommentContext): string {
  const head = `${ctx.marker}\n${headerMarkdown(verdict, ctx.baseSha, ctx.headSha, ctx.version)}${gradedSections(verdict)}`;
  const folded = [
    details("Other findings", otherFindingSections(verdict)),
    details("Guidance", guidanceMarkdown(verdict.guidance)),
    details("Reviewers", reviewersMarkdown(verdict.reviewers)),
    details("Comparability", comparabilityMarkdown(verdict)),
    details("Package metrics", packageMetricsMarkdown(verdict.package_metrics)),
    details("Architectural change", deltaMarkdown(verdict, false)),
  ].filter(Boolean);
  const tail = footer(ctx);

  // Folded sections go first, last to first, so what the reader needs most is what stays.
  let dropped = 0;
  while (folded.length && head.length + folded.join("").length + tail.length > COMMENT_LIMIT) {
    folded.pop();
    dropped++;
  }
  let body = head + folded.join("");
  if (body.length + tail.length > COMMENT_LIMIT) {
    body = `${body.slice(0, COMMENT_LIMIT - tail.length - 200)}\n\n`;
    dropped++;
  }
  if (dropped) body += "_Shortened to fit a pull request comment; the workflow run has the complete report._\n\n";
  return neutralizeMentions(body + tail);
}

// What replaces a comment the current run does not earn, so a failure fixed by a later
// push does not keep saying the pull request fails.
export function renderResolvedComment(ctx: CommentContext): string {
  return `${ctx.marker}\n✅ **Enola architecture check: passing** as of \`${short(ctx.headSha)}\` ` +
    `(base \`${short(ctx.baseSha)}\`).\n\n${footer(ctx)}`;
}

// A name in a finding, a path or a git author must not notify anybody. Code spans are
// left alone: GitHub never resolves a mention inside one.
export function neutralizeMentions(markdown: string): string {
  return markdown
    .split(/(`[^`\n]*`)/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/(^|[^\w`])@(?=[A-Za-z0-9])/g, "$1@​")))
    .join("");
}
