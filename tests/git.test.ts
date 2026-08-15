import { beforeEach, describe, expect, it, vi } from "vitest";

const capture = vi.hoisted(() => vi.fn());
vi.mock("../src/platform/exec.js", () => ({ capture }));

import { addWorktree, ensureCommit, removeWorktree } from "../src/platform/git.js";

beforeEach(() => vi.clearAllMocks());

describe("ensureCommit", () => {
  it("does nothing when the commit already exists locally", async () => {
    capture.mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" });
    await ensureCommit("/repo", "abc123");
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("fetches the commit from origin when missing", async () => {
    capture
      .mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" });
    await ensureCommit("/repo", "abc123");
    expect(capture).toHaveBeenNthCalledWith(2, "git", ["fetch", "--no-tags", "origin", "abc123"], "/repo", true);
  });

  it("throws with the git error when the commit cannot be fetched", async () => {
    capture
      .mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "unknown revision" });
    await expect(ensureCommit("/repo", "abc123")).rejects.toThrow(
      "Unable to fetch base commit abc123: unknown revision",
    );
  });
});

describe("addWorktree", () => {
  it("adds a detached worktree at the target path", async () => {
    capture.mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" });
    await addWorktree("/repo", "/tmp/base", "abc123");
    expect(capture).toHaveBeenCalledWith(
      "git",
      ["worktree", "add", "--detach", "/tmp/base", "abc123"],
      "/repo",
      true,
    );
  });

  it("throws with the git error on failure", async () => {
    capture.mockResolvedValueOnce({ exitCode: 128, stdout: "", stderr: "already exists" });
    await expect(addWorktree("/repo", "/tmp/base", "abc123")).rejects.toThrow(
      "Unable to create base worktree: already exists",
    );
  });
});

describe("removeWorktree", () => {
  it("removes then prunes, even when removal itself reports an error", async () => {
    capture.mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "not a worktree" });
    capture.mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" });
    await removeWorktree("/repo", "/tmp/base");
    expect(capture).toHaveBeenNthCalledWith(1, "git", ["worktree", "remove", "--force", "/tmp/base"], "/repo", true);
    expect(capture).toHaveBeenNthCalledWith(2, "git", ["worktree", "prune"], "/repo", true);
  });
});
