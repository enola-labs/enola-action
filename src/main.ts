import * as core from "@actions/core";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { annotate } from "./annotations.js";
import { resolveRevisionContext } from "./context.js";
import { capture } from "./exec.js";
import { addWorktree, ensureCommit, removeWorktree } from "./git.js";
import { checkArguments, readInputs } from "./inputs.js";
import { installEnola } from "./install.js";
import { writeSummary } from "./summary.js";
import { WebhookPayload } from "./types.js";
import { assertExitCode, parseVerdict, saveVerdict } from "./verdict.js";

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

  const installed = await installEnola(inputs.version, inputs.token);
  core.info(`Using Enola ${installed.version}`);
  await ensureCommit(headRoot, revisions.baseSha);

  const temporaryRoot = await fs.mkdtemp(path.join(process.env.RUNNER_TEMP || os.tmpdir(), "enola-action-"));
  const baseRoot = path.join(temporaryRoot, "base");
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
    core.setOutput("regressions", (verdict.failures || []).length);
    core.setOutput("advisories", (verdict.advisories || []).length);
    core.setOutput("facts-added", verdict.facts_added);
    core.setOutput("facts-removed", verdict.facts_removed);
    core.setOutput("edges-added", verdict.edges_added);
    core.setOutput("edges-removed", verdict.edges_removed);
    core.setOutput("verdict-file", verdictFile);

    if (inputs.annotations) annotate(verdict);
    if (inputs.summary) await writeSummary(verdict, revisions.baseSha, revisions.headSha, installed.version);

    if (verdict.status !== "clean") {
      core.setFailed(
        verdict.status === "regression"
          ? `${(verdict.failures || []).length} architectural regression(s) introduced.`
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
