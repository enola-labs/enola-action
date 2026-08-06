import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({
  info: vi.fn(),
  setOutput: vi.fn(),
  setFailed: vi.fn(),
  summary: { addRaw: vi.fn().mockReturnThis(), write: vi.fn() },
}));
vi.mock("@actions/core", () => core);

const fsMock = vi.hoisted(() => ({ readFile: vi.fn(), mkdtemp: vi.fn() }));
vi.mock("node:fs", () => ({ promises: fsMock }));

const annotate = vi.hoisted(() => vi.fn());
vi.mock("../src/annotations.js", () => ({ annotate }));

const contextModule = vi.hoisted(() => ({ resolveRevisionContext: vi.fn() }));
vi.mock("../src/context.js", () => contextModule);

const capture = vi.hoisted(() => vi.fn());
vi.mock("../src/exec.js", () => ({ capture }));

const git = vi.hoisted(() => ({ ensureCommit: vi.fn(), addWorktree: vi.fn(), removeWorktree: vi.fn() }));
vi.mock("../src/git.js", () => git);

const inputsModule = vi.hoisted(() => ({ readInputs: vi.fn(), checkArguments: vi.fn(() => ["check", "--json"]) }));
vi.mock("../src/inputs.js", () => inputsModule);

const install = vi.hoisted(() => ({ installEnola: vi.fn() }));
vi.mock("../src/install.js", () => install);

const summaryModule = vi.hoisted(() => ({ writeSummary: vi.fn() }));
vi.mock("../src/summary.js", () => summaryModule);

const verdictModule = vi.hoisted(() => ({ parseVerdict: vi.fn(), assertExitCode: vi.fn(), saveVerdict: vi.fn() }));
vi.mock("../src/verdict.js", () => verdictModule);

import { run } from "../src/main.js";
import { Inputs } from "../src/types.js";

const baseEnv = {
  GITHUB_EVENT_NAME: "pull_request",
  GITHUB_EVENT_PATH: "/tmp/event.json",
  GITHUB_SHA: "headsha",
  GITHUB_WORKSPACE: "/workspace",
  RUNNER_TEMP: "/tmp",
};

function defaultInputs(overrides: Partial<Inputs> = {}): Inputs {
  return {
    version: "latest",
    warnOnly: false,
    detail: false,
    annotations: true,
    summary: true,
    workingDirectory: ".",
    ...overrides,
  } as Inputs;
}

describe("run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(process.env, baseEnv);
    fsMock.readFile.mockResolvedValue("{}");
    fsMock.mkdtemp.mockResolvedValue("/tmp/enola-action-xyz");
    contextModule.resolveRevisionContext.mockReturnValue({
      baseSha: "basesha",
      headSha: "headsha",
      eventName: "pull_request",
    });
    install.installEnola.mockResolvedValue({ path: "/bin/enola", version: "1.2.3" });
    inputsModule.readInputs.mockReturnValue(defaultInputs());
    capture
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" }) // baseline pin
      .mockResolvedValueOnce({ exitCode: 0, stdout: JSON.stringify({ status: "clean" }), stderr: "" }); // check
    verdictModule.parseVerdict.mockReturnValue({
      status: "clean",
      failures: [],
      advisories: [],
      edges_added: 0,
      edges_removed: 0,
      facts_added: 0,
      facts_removed: 0,
    });
  });

  afterEach(() => {
    for (const key of Object.keys(baseEnv)) delete process.env[key];
  });

  it("reports a clean status without failing the job", async () => {
    await run();
    expect(core.setFailed).not.toHaveBeenCalled();
    expect(core.setOutput).toHaveBeenCalledWith("status", "clean");
    expect(git.removeWorktree).toHaveBeenCalled();
  });

  it("fails the job on a regression verdict", async () => {
    verdictModule.parseVerdict.mockReturnValue({
      status: "regression",
      failures: [{ title: "x", confidence: 1 }],
      advisories: [],
      edges_added: 0,
      edges_removed: 0,
      facts_added: 0,
      facts_removed: 0,
    });
    await run();
    expect(core.setFailed).toHaveBeenCalledWith("1 architectural regression(s) introduced.");
  });

  it("rejects a working-directory that escapes the workspace", async () => {
    inputsModule.readInputs.mockReturnValue(defaultInputs({ workingDirectory: "../outside" }));
    await expect(run()).rejects.toThrow("working-directory must stay inside GITHUB_WORKSPACE.");
    expect(install.installEnola).not.toHaveBeenCalled();
  });

  it("removes the worktree even when the check step fails", async () => {
    capture.mockReset();
    capture
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" }) // baseline pin
      .mockResolvedValueOnce({ exitCode: 2, stdout: "not json", stderr: "boom" }); // check
    verdictModule.parseVerdict.mockImplementation(() => {
      throw new Error("Enola returned invalid JSON: unexpected token");
    });
    await expect(run()).rejects.toThrow("boom");
    expect(git.removeWorktree).toHaveBeenCalled();
  });
});
