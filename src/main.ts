import * as core from "@actions/core";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { annotate } from "./report/annotations.js";
import { resolveRevisionContext } from "./policy/context.js";
import { capture } from "./platform/exec.js";
import { addWorktree, ensureCommit, removeWorktree } from "./platform/git.js";
import { checkArguments, readInputs } from "./policy/inputs.js";
import { installEnola, useLocalEnola } from "./platform/install.js";
import { logVerdict, writeSummary } from "./report/summary.js";
import { WebhookPayload } from "./core/types.js";
import { assertExitCode, parseVerdict, regressionCount, saveVerdict } from "./policy/verdict.js";

export async function run(): Promise<void> {
  const inputs = readInputs();
  const eventName = process.env.GITHUB_EVENT_NAME || "";
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const payload = eventPath ? JSON.parse(await fs.readFile(eventPath, "utf8")) as Record<string, unknown> : {};
  const revisions = resolveRevisionContext(inputs, eventName, payload, process.env.GITHUB_SHA || "");
  const workspace = process.env.GITHUB_WORKSPACE;
  if (!workspace) throw new Error("GITHUB_WORKSPACE is not set.");
  const headRoot = path.resolve(workspace);
  const headDirectory = path.resolve(headRoot, inputs.workingDirectory);
  if (!headDirectory.startsWith(`${headRoot}${path.sep}`) && headDirectory !== headRoot) {
    throw new Error("working-directory must stay inside GITHUB_WORKSPACE.");
  }

  if (inputs.binary && inputs.version !== "latest") {
    core.warning("Both binary and version were set; binary wins and the release is not downloaded.");
  }
  const installed = inputs.binary
    ? await useLocalEnola(inputs.binary, headRoot)
    : await installEnola(inputs.version, inputs.token);
  core.info(`Using Enola ${installed.version}`);
  await ensureCommit(headRoot, revisions.baseSha);

  const temporaryRoot = await fs.mkdtemp(path.join(process.env.RUNNER_TEMP || os.tmpdir(), "enola-action-"));
  // The base worktree MUST carry the same directory name as the head checkout.
  //
  // Enola labels every fact with the repository it came from, and that label is the
  // indexed directory's basename. A worktree called "base" therefore produces facts
  // labelled `base` while the workspace produces `enola` — different keys for the same
  // code, so a diff between them reports the entire graph as added and removed. The
  // comparability check does not catch it: it identifies a repository by its normalized
  // git remote, which a linked worktree shares, so the gate grades a delta that is
  // meaningless rather than declining to.
  //
  // Findings survive it (they are keyed by title, not by repo), which is exactly why
  // this stayed invisible: the verdict looked right while every count under it was wrong.
  const baseRoot = path.join(temporaryRoot, path.basename(headRoot));
  const verdictFile = path.join(temporaryRoot, "verdict.json");
  await addWorktree(headRoot, baseRoot, revisions.baseSha);

  try {
    const baseDirectory = path.resolve(baseRoot, inputs.workingDirectory);
    const baseConfig = inputs.config ? path.resolve(baseRoot, inputs.config) : undefined;
    const headConfig = inputs.config ? path.resolve(headRoot, inputs.config) : undefined;
    const pinArgs = ["baseline", "pin"];
    if (baseConfig) pinArgs.push(baseConfig);
    const pin = await capture(installed.path, pinArgs, baseDirectory, true);
    if (pin.exitCode !== 0) throw new Error(`Unable to create base snapshot: ${pin.stderr.trim() || pin.stdout.trim()}`);
    const baseline = path.join(baseDirectory, ".enola", "baseline");
    const headInputs = { ...inputs, config: headConfig };
    const result = await capture(installed.path, checkArguments(headInputs, baseline), headDirectory, true);
    let verdict;
    try {
      verdict = parseVerdict(result.stdout);
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${result.stderr.trim()}`.trim());
    }
    assertExitCode(verdict, result.exitCode);
    await saveVerdict(verdictFile, result.stdout);

    core.setOutput("status", verdict.status);
    core.setOutput("regressions", regressionCount(verdict));
    core.setOutput("advisories", (verdict.advisories || []).length);
    core.setOutput("facts-added", verdict.facts_added);
    core.setOutput("facts-removed", verdict.facts_removed);
    core.setOutput("edges-added", verdict.edges_added);
    core.setOutput("edges-removed", verdict.edges_removed);
    core.setOutput("verdict-file", verdictFile);

    logVerdict(verdict);
    if (inputs.annotations) annotate(verdict);
    if (inputs.summary) await writeSummary(verdict, revisions.baseSha, revisions.headSha, installed.version);

    if (verdict.status !== "clean") {
      core.setFailed(
        verdict.status === "regression"
          ? `${regressionCount(verdict)} architectural regression(s) introduced.`
          : verdict.status === "incomparable"
            ? "Enola refused to grade incomparable snapshots."
            : "Enola could not complete the architecture check.",
      );
    }
  } finally {
    await removeWorktree(headRoot, baseRoot);
  }
}

if (process.env.NODE_ENV !== "test") {
  run().catch((error: unknown) => core.setFailed(error instanceof Error ? error.message : String(error)));
}
