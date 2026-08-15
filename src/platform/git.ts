import { capture } from "./exec.js";

export async function ensureCommit(repo: string, sha: string): Promise<void> {
  const present = await capture("git", ["cat-file", "-e", `${sha}^{commit}`], repo, true);
  if (present.exitCode === 0) return;

  const fetched = await capture("git", ["fetch", "--no-tags", "origin", sha], repo, true);
  if (fetched.exitCode !== 0) {
    throw new Error(`Unable to fetch base commit ${sha}: ${fetched.stderr.trim()}`);
  }
}

export async function addWorktree(repo: string, target: string, sha: string): Promise<void> {
  const result = await capture("git", ["worktree", "add", "--detach", target, sha], repo, true);
  if (result.exitCode !== 0) throw new Error(`Unable to create base worktree: ${result.stderr.trim()}`);
}

export async function removeWorktree(repo: string, target: string): Promise<void> {
  await capture("git", ["worktree", "remove", "--force", target], repo, true);
  await capture("git", ["worktree", "prune"], repo, true);
}
