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
    baseSha: optional("base-sha"),
    annotations: core.getBooleanInput("annotations"),
    summary: core.getBooleanInput("summary"),
    workingDirectory: core.getInput("working-directory").trim() || ".",
    token: optional("token"),
  };
}

export function checkArguments(inputs: Inputs, baseline: string): string[] {
  const args = ["check", "--baseline", baseline, "--json"];
  if (inputs.failOn) args.push("--fail-on", inputs.failOn);
  if (inputs.minConfidence) args.push("--min-confidence", inputs.minConfidence);
  if (inputs.warnOnly) args.push("--warn-only");
  if (inputs.focus) args.push("--focus", inputs.focus);
  if (inputs.detail) args.push("--detail");
  if (inputs.target) args.push("--target", inputs.target);
  if (inputs.expected) args.push("--expected", inputs.expected);
  if (inputs.maxSpillover) args.push("--max-spillover", inputs.maxSpillover);
  if (inputs.config) args.push(inputs.config);
  return args;
}
