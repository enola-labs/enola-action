import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({
  info: vi.fn(),
  warning: vi.fn(),
  notice: vi.fn(),
  setOutput: vi.fn(),
  setFailed: vi.fn(),
  summary: { addRaw: vi.fn().mockReturnThis(), write: vi.fn() },
}));
vi.mock("@actions/core", () => core);

const fsMock = vi.hoisted(() => ({ readFile: vi.fn(), mkdtemp: vi.fn(), writeFile: vi.fn() }));
// existsSync is what resolves a repository-prefixed fact path against the checkout. Here
// nothing exists, which is the honest answer for a mocked filesystem: the path is then
// used exactly as Enola recorded it, never guessed at.
vi.mock("node:fs", () => ({ promises: fsMock, existsSync: () => false }));

const annotate = vi.hoisted(() => vi.fn());
vi.mock("../src/report/annotations.js", () => ({ annotate }));

const contextModule = vi.hoisted(() => ({ resolveRevisionContext: vi.fn() }));
vi.mock("../src/policy/context.js", () => contextModule);

const capture = vi.hoisted(() => vi.fn());
vi.mock("../src/platform/exec.js", () => ({ capture }));

const git = vi.hoisted(() => ({
  ensureCommit: vi.fn(),
  addWorktree: vi.fn(),
  removeWorktree: vi.fn(),
  commitAuthor: vi.fn(),
}));
vi.mock("../src/platform/git.js", () => git);

const inputsModule = vi.hoisted(() => ({ readInputs: vi.fn(), checkArguments: vi.fn(() => ["check", "--json"]) }));
vi.mock("../src/policy/inputs.js", () => inputsModule);

const install = vi.hoisted(() => ({ installEnola: vi.fn(), useLocalEnola: vi.fn() }));
vi.mock("../src/platform/install.js", () => install);

const summaryModule = vi.hoisted(() => ({ writeSummary: vi.fn(), logVerdict: vi.fn() }));
vi.mock("../src/report/summary.js", () => summaryModule);

const verdictModule = vi.hoisted(() => ({ parseVerdict: vi.fn(), assertExitCode: vi.fn(), saveVerdict: vi.fn() }));
// Only the three that touch the outside world are stubbed. regressionCount and
// fatalBreaches are pure functions of the verdict, and re-implementing them in a mock
// would let main.ts and the tests drift apart on the one number the job is graded by.
vi.mock("../src/policy/verdict.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/policy/verdict.js")>()),
  ...verdictModule,
}));

import { run } from "../src/main.js";
import { Inputs } from "../src/core/types.js";

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
      authorSha: "prhead",
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

  it("logs the verdict to the step log even when nothing is wrong", async () => {
    await run();
    expect(summaryModule.logVerdict).toHaveBeenCalledWith(expect.objectContaining({ status: "clean" }));
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

  // max-spillover gates on a measurement, not a finding. Counting only `failures` here
  // told the developer "0 architectural regression(s) introduced." on a job it had just
  // turned red, with nothing anywhere naming the reason.
  it("counts a fatal measurement breach when no finding failed", async () => {
    verdictModule.parseVerdict.mockReturnValue({
      status: "regression",
      failures: [],
      advisories: [],
      breaches: [{ measurement: { name: "spillover_packages", label: "package(s) reached outside the declared scope", count: 1 }, fatal: true }],
      edges_added: 0,
      edges_removed: 0,
      facts_added: 0,
      facts_removed: 0,
    });
    await run();
    expect(core.setFailed).toHaveBeenCalledWith("1 architectural regression(s) introduced.");
    expect(core.setOutput).toHaveBeenCalledWith("regressions", 1);
  });

  it("grades with a locally built binary instead of downloading a release", async () => {
    inputsModule.readInputs.mockReturnValue(defaultInputs({ binary: "/tmp/enola-ent" }));
    install.useLocalEnola.mockResolvedValue({ path: "/tmp/enola-ent", version: "0.3.17 (local build)" });

    await run();

    expect(install.useLocalEnola).toHaveBeenCalledWith("/tmp/enola-ent", "/workspace");
    expect(install.installEnola).not.toHaveBeenCalled();
    expect(core.warning).not.toHaveBeenCalled();
    expect(capture).toHaveBeenCalledWith("/tmp/enola-ent", expect.arrayContaining(["baseline", "pin"]), expect.any(String), true);
  });

  it("passes the pull request head's author when reviewers is on", async () => {
    inputsModule.readInputs.mockReturnValue(defaultInputs({ reviewers: true }));
    git.commitAuthor.mockResolvedValue("Ada Lovelace");

    await run();

    expect(git.commitAuthor).toHaveBeenCalledWith("/workspace", "prhead");
    expect(inputsModule.checkArguments).toHaveBeenCalledWith(expect.objectContaining({ author: "Ada Lovelace" }), expect.any(String));
  });

  it("reads no author when reviewers is off, and never overrides an explicit one", async () => {
    await run();
    inputsModule.readInputs.mockReturnValue(defaultInputs({ reviewers: true, author: "Grace Hopper" }));
    capture
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: JSON.stringify({ status: "clean" }), stderr: "" });
    await run();

    expect(git.commitAuthor).not.toHaveBeenCalled();
    expect(inputsModule.checkArguments).toHaveBeenLastCalledWith(expect.objectContaining({ author: "Grace Hopper" }), expect.any(String));
  });

  it("warns that binary wins when an explicit version is also set", async () => {
    inputsModule.readInputs.mockReturnValue(defaultInputs({ binary: "/tmp/enola-ent", version: "0.3.16" }));
    install.useLocalEnola.mockResolvedValue({ path: "/tmp/enola-ent", version: "local build" });

    await run();

    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining("binary wins"));
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

describe("the base worktree's directory name", () => {
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
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: JSON.stringify({ status: "clean" }), stderr: "" });
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

  // Enola labels each fact with the indexed directory's basename, and that label is part
  // of the key a diff matches on. A worktree named anything other than the workspace
  // makes every fact in the base snapshot unmatchable, and the delta reports the whole
  // repository as added and removed — while the verdict still looks plausible, because
  // findings are keyed by title rather than by repo.
  it("matches the workspace, so base and head facts share a repository label", async () => {
    await run();
    const [, worktreePath] = git.addWorktree.mock.calls[0];
    expect(worktreePath).toBe("/tmp/enola-action-xyz/workspace");
  });
});

// The break this action shipped with: Enola returns `partial_clean` at exit 0 whenever
// the two snapshots were produced by different producer sets — a pull request adding the
// first file in a language does it — and the action rejected the name and turned a clean
// build red.
describe("a partial verdict", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(process.env, baseEnv);
    fsMock.readFile.mockResolvedValue("{}");
    fsMock.mkdtemp.mockResolvedValue("/tmp/enola-action-xyz");
    contextModule.resolveRevisionContext.mockReturnValue({ baseSha: "basesha", headSha: "headsha", eventName: "pull_request" });
    install.installEnola.mockResolvedValue({ path: "/bin/enola", version: "1.2.3" });
    inputsModule.readInputs.mockReturnValue(defaultInputs());
  });

  function partial(status: string, extra: Record<string, unknown> = {}) {
    capture.mockReset();
    capture
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ exitCode: status === "partial_regression" ? 1 : 0, stdout: "{}", stderr: "" });
    verdictModule.parseVerdict.mockReturnValue({
      status,
      failures: [],
      advisories: [],
      edges_added: 0,
      edges_removed: 0,
      facts_added: 0,
      facts_removed: 0,
      intersection_grading: {
        shared_extractors: ["typescript"],
        excluded: [
          {
            name: "ruby",
            kind: "extractor",
            lacked_by: "baseline",
            baseline_facts_excluded: 0,
            current_facts_excluded: 2,
            baseline_findings_excluded: 0,
            current_findings_excluded: 1,
          },
        ],
      },
      ...extra,
    });
  }

  it("passes the job and reports what was not graded", async () => {
    partial("partial_clean");
    await run();
    expect(core.setFailed).not.toHaveBeenCalled();
    expect(core.setOutput).toHaveBeenCalledWith("status", "partial_clean");
    expect(core.setOutput).toHaveBeenCalledWith("partial", true);
    expect(core.setOutput).toHaveBeenCalledWith("ungraded-facts", 2);
    expect(core.setOutput).toHaveBeenCalledWith("ungraded-findings", 1);
  });

  it("fails the job on a partial regression, saying it graded only the shared producers", async () => {
    partial("partial_regression", { failures: [{ title: "x", confidence: 1 }] });
    await run();
    expect(core.setFailed).toHaveBeenCalledWith(
      "1 architectural regression(s) introduced. Only the producers both snapshots share were graded.",
    );
  });
});

// The lesson generalised: a status name this action has not been taught must not be able
// to fail a job Enola passed.
describe("a status from a newer Enola", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(process.env, baseEnv);
    fsMock.readFile.mockResolvedValue("{}");
    fsMock.mkdtemp.mockResolvedValue("/tmp/enola-action-xyz");
    contextModule.resolveRevisionContext.mockReturnValue({ baseSha: "basesha", headSha: "headsha", eventName: "pull_request" });
    install.installEnola.mockResolvedValue({ path: "/bin/enola", version: "1.2.3" });
    inputsModule.readInputs.mockReturnValue(defaultInputs());
    capture
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "{}", stderr: "" });
    verdictModule.parseVerdict.mockReturnValue({
      status: "provisional_clean",
      failures: [],
      advisories: [],
      edges_added: 0,
      edges_removed: 0,
      facts_added: 0,
      facts_removed: 0,
    });
  });

  it("warns about the name and lets the exit code decide", async () => {
    await run();
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining("does not know"));
    expect(core.setFailed).not.toHaveBeenCalled();
    expect(core.setOutput).toHaveBeenCalledWith("status", "provisional_clean");
  });
});

describe("the sarif input", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(process.env, baseEnv);
    fsMock.readFile.mockResolvedValue("{}");
    fsMock.mkdtemp.mockResolvedValue("/tmp/enola-action-xyz");
    fsMock.writeFile.mockResolvedValue(undefined);
    contextModule.resolveRevisionContext.mockReturnValue({ baseSha: "basesha", headSha: "headsha", eventName: "pull_request" });
    install.installEnola.mockResolvedValue({ path: "/bin/enola", version: "1.2.3" });
    capture
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "{}", stderr: "" });
    verdictModule.parseVerdict.mockReturnValue({
      status: "clean",
      failures: [{ title: "Cycle", source: "cycles", confidence: 1, evidence: [{ file: "src/a.ts", line: 4 }] }],
      advisories: [],
      edges_added: 0,
      edges_removed: 0,
      facts_added: 0,
      facts_removed: 0,
    });
  });

  it("writes a SARIF file from the same verdict, without a second check run", async () => {
    inputsModule.readInputs.mockReturnValue(defaultInputs({ sarif: true }));
    await run();
    const [file, body] = fsMock.writeFile.mock.calls.at(-1) as [string, string];
    expect(file).toBe("/tmp/enola-action-xyz/enola.sarif");
    const document = JSON.parse(body);
    expect(document.version).toBe("2.1.0");
    expect(document.runs[0].tool.driver.rules[0].id).toBe("cycles");
    expect(document.runs[0].results[0].locations[0].physicalLocation.region.startLine).toBe(4);
    expect(core.setOutput).toHaveBeenCalledWith("sarif-file", "/tmp/enola-action-xyz/enola.sarif");
    // Two captures: the pin and the check. A third would mean a second snapshot of the
    // whole repository just to re-render numbers already in hand.
    expect(capture).toHaveBeenCalledTimes(2);
  });

  it("writes nothing when it is not asked to", async () => {
    inputsModule.readInputs.mockReturnValue(defaultInputs());
    await run();
    expect(fsMock.writeFile).not.toHaveBeenCalled();
    expect(core.setOutput).not.toHaveBeenCalledWith("sarif-file", expect.anything());
  });
});
