import * as core from "@actions/core";
import * as tc from "@actions/tool-cache";
import { createHash } from "node:crypto";
import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";
import { capture } from "./exec.js";

function platform(): { os: string; arch: string; extension: string } {
  const os = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "darwin" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "amd64";
  return { os, arch, extension: os === "windows" ? ".exe" : "" };
}

async function latestVersion(token?: string): Promise<string> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch("https://api.github.com/repos/enola-labs/enola/releases/latest", { headers });
  if (!response.ok) throw new Error(`Unable to resolve latest Enola release: HTTP ${response.status}`);
  const body = (await response.json()) as { tag_name?: string };
  if (!body.tag_name) throw new Error("Latest Enola release has no tag name.");
  return body.tag_name.replace(/^v/, "");
}

async function sha256(file: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(await fs.readFile(file));
  return hash.digest("hex");
}

// A locally built engine — the binary the pull request itself produces, or an enterprise
// wrapper that is never published as an Enola release. It is graded through exactly the
// same worktree/pin/check path as a downloaded release, so a repository that builds its
// own engine no longer has to reimplement this workflow in shell.
//
// The caller supplies the executable, so there is nothing to verify a checksum against;
// the trust boundary is the workflow that built it. Everything else is identical.
export async function useLocalEnola(binary: string, workspace: string): Promise<{ path: string; version: string }> {
  const resolved = path.isAbsolute(binary) ? binary : path.resolve(workspace, binary);
  try {
    await fs.access(resolved, fsConstants.X_OK);
  } catch {
    throw new Error(`The binary input does not point at an executable file: ${resolved}`);
  }

  // Report the version the way the download path does, so the job summary states which
  // engine produced the verdict rather than leaving "local" to stand for anything.
  // --version writes to stderr in Enola and the enterprise wrapper does not implement
  // --json, so both streams are searched and an unparsable banner is not fatal.
  const check = await capture(resolved, ["--version"], workspace, true);
  if (check.exitCode !== 0) throw new Error(`The binary input could not start: ${check.stderr.trim() || check.stdout.trim()}`);
  const banner = `${check.stdout} ${check.stderr}`.trim();
  const parsed = /version\s+(\S+)/i.exec(banner)?.[1];
  return { path: resolved, version: parsed ? `${parsed} (local build)` : "local build" };
}

export async function installEnola(requested: string, token?: string): Promise<{ path: string; version: string }> {
  const version = requested === "latest" ? await latestVersion(token) : requested.replace(/^v/, "");
  const cached = tc.find("enola", version);
  const executable = process.platform === "win32" ? "enola.exe" : "enola";
  if (cached) return { path: path.join(cached, executable), version };

  const target = platform();
  const baseName = `enola-${version}-${target.os}-${target.arch}`;
  const release = `https://github.com/enola-labs/enola/releases/download/v${version}`;
  const archive = await tc.downloadTool(`${release}/${baseName}.tar.gz`);
  const checksumFile = await tc.downloadTool(`${release}/${baseName}.sha256`);
  const expected = (await fs.readFile(checksumFile, "utf8")).trim().split(/\s+/)[0]?.toLowerCase();
  const actual = await sha256(archive);
  if (!expected || expected !== actual) throw new Error(`Checksum mismatch for ${baseName}.tar.gz`);

  const extracted = await tc.extractTar(archive);
  const releasedBinary = path.join(extracted, `${baseName}${target.extension}`);
  const installDirectory = await fs.mkdtemp(path.join(process.env.RUNNER_TEMP || extracted, "enola-tool-"));
  await fs.copyFile(releasedBinary, path.join(installDirectory, executable));
  if (process.platform !== "win32") await fs.chmod(path.join(installDirectory, executable), 0o755);
  const cachedDirectory = await tc.cacheDir(installDirectory, "enola", version);
  core.addPath(cachedDirectory);

  const check = await capture(path.join(cachedDirectory, executable), ["--version"], process.cwd(), true);
  if (check.exitCode !== 0) throw new Error(`Installed Enola could not start: ${check.stderr.trim()}`);
  return { path: path.join(cachedDirectory, executable), version };
}
