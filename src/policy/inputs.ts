import * as core from "@actions/core";
import { Inputs } from "../core/types.js";

function optional(name: string): string | undefined {
  return core.getInput(name).trim() || undefined;
}

export function readInputs(): Inputs {
  return {
    version: core.getInput("version").trim() || "latest",
    binary: optional("binary"),
    config: optional("config"),
    failOn: optional("fail-on"),
    minConfidence: optional("min-confidence"),
    warnOnly: core.getBooleanInput("warn-only"),
    focus: optional("focus"),
    detail: core.getBooleanInput("detail"),
    target: optional("target"),
    expected: optional("expected"),
    maxSpillover: optional("max-spillover"),
    reviewers: core.getBooleanInput("reviewers"),
    reviewerWindow: optional("reviewer-window"),
    author: optional("author"),
    baseSha: optional("base-sha"),
    annotations: core.getBooleanInput("annotations"),
    sarif: core.getBooleanInput("sarif"),
    summary: core.getBooleanInput("summary"),
    workingDirectory: core.getInput("working-directory").trim() || ".",
    token: optional("token"),
  };
}

// The `enola check` invocation. One run, one format: the JSON verdict, which is what the
// outputs, the summary, the annotations and the SARIF file are all rendered from.
//
// `--detail` is deliberately NOT passed. Enola honours it only when it is writing text —
// the JSON document always carries the whole delta — so passing it alongside `--json`
// changed nothing at all, which is what the `detail` input used to do. The input now
// renders that delta into the job summary instead.
export function checkArguments(inputs: Inputs, baseline: string): string[] {
  const args = ["check", "--baseline", baseline, "--json"];
  if (inputs.failOn) args.push("--fail-on", inputs.failOn);
  if (inputs.minConfidence) args.push("--min-confidence", inputs.minConfidence);
  if (inputs.warnOnly) args.push("--warn-only");
  if (inputs.focus) args.push("--focus", inputs.focus);
  if (inputs.target) args.push("--target", inputs.target);
  if (inputs.expected) args.push("--expected", inputs.expected);
  if (inputs.maxSpillover) args.push("--max-spillover", inputs.maxSpillover);
  // Opt-in, like the engine's flag: without it no git author name is read at all. The
  // window and author mean nothing without --reviewers, so they only ride along with it.
  if (inputs.reviewers) {
    args.push("--reviewers");
    if (inputs.reviewerWindow) args.push("--reviewer-window", inputs.reviewerWindow);
    if (inputs.author) args.push("--author", inputs.author);
  }
  if (inputs.config) args.push(inputs.config);
  return args;
}
