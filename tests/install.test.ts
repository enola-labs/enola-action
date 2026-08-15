import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({ addPath: vi.fn(), info: vi.fn() }));
vi.mock("@actions/core", () => core);

const tc = vi.hoisted(() => ({
  find: vi.fn(),
  downloadTool: vi.fn(),
  extractTar: vi.fn(),
  cacheDir: vi.fn(),
}));
vi.mock("@actions/tool-cache", () => tc);

const fsMock = vi.hoisted(() => ({
  readFile: vi.fn(),
  mkdtemp: vi.fn(),
  copyFile: vi.fn(),
  chmod: vi.fn(),
  access: vi.fn(),
}));
vi.mock("node:fs", () => ({ promises: fsMock, constants: { X_OK: 1 } }));

const capture = vi.hoisted(() => vi.fn());
vi.mock("../src/platform/exec.js", () => ({ capture }));

import { installEnola, useLocalEnola } from "../src/platform/install.js";

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  delete (globalThis as unknown as { fetch?: unknown }).fetch;
});

describe("installEnola", () => {
  it("reuses a cached toolchain without contacting the network", async () => {
    tc.find.mockReturnValue("/cache/enola/1.0.0");
    const result = await installEnola("1.0.0");
    expect(result.version).toBe("1.0.0");
    expect(tc.downloadTool).not.toHaveBeenCalled();
  });

  it("resolves 'latest' through the GitHub releases API before checking the cache", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tag_name: "v2.5.0" }) }) as never;
    tc.find.mockReturnValue("/cache/enola/2.5.0");
    const result = await installEnola("latest");
    expect(result.version).toBe("2.5.0");
    expect(tc.find).toHaveBeenCalledWith("enola", "2.5.0");
  });

  it("throws when the release lookup fails", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }) as never;
    await expect(installEnola("latest")).rejects.toThrow("Unable to resolve latest Enola release: HTTP 404");
  });

  it("rejects a downloaded archive whose checksum does not match", async () => {
    tc.find.mockReturnValue(undefined);
    tc.downloadTool.mockResolvedValueOnce("/tmp/archive.tar.gz").mockResolvedValueOnce("/tmp/archive.sha256");
    fsMock.readFile.mockImplementation(async (file: string) =>
      file === "/tmp/archive.sha256" ? `${"0".repeat(64)}  archive.tar.gz` : Buffer.from("archive contents"),
    );
    await expect(installEnola("1.0.0")).rejects.toThrow("Checksum mismatch");
  });

  it("installs, verifies a matching checksum, and caches the binary", async () => {
    tc.find.mockReturnValue(undefined);
    tc.downloadTool.mockResolvedValueOnce("/tmp/archive.tar.gz").mockResolvedValueOnce("/tmp/archive.sha256");
    const contents = Buffer.from("archive contents");
    const expected = createHash("sha256").update(contents).digest("hex");
    fsMock.readFile.mockImplementation(async (file: string) =>
      file === "/tmp/archive.sha256" ? `${expected}  archive.tar.gz` : contents,
    );
    tc.extractTar.mockResolvedValue("/tmp/extracted");
    fsMock.mkdtemp.mockResolvedValue("/tmp/enola-tool-xyz");
    tc.cacheDir.mockResolvedValue("/cache/enola/1.0.0");
    capture.mockResolvedValue({ exitCode: 0, stdout: "1.0.0", stderr: "" });

    const result = await installEnola("1.0.0");

    expect(result.version).toBe("1.0.0");
    expect(result.path.startsWith("/cache/enola/1.0.0")).toBe(true);
    expect(core.addPath).toHaveBeenCalledWith("/cache/enola/1.0.0");
  });

  it("fails when the installed binary cannot start", async () => {
    tc.find.mockReturnValue(undefined);
    tc.downloadTool.mockResolvedValueOnce("/tmp/archive.tar.gz").mockResolvedValueOnce("/tmp/archive.sha256");
    const contents = Buffer.from("archive contents");
    const expected = createHash("sha256").update(contents).digest("hex");
    fsMock.readFile.mockImplementation(async (file: string) =>
      file === "/tmp/archive.sha256" ? `${expected}  archive.tar.gz` : contents,
    );
    tc.extractTar.mockResolvedValue("/tmp/extracted");
    fsMock.mkdtemp.mockResolvedValue("/tmp/enola-tool-xyz");
    tc.cacheDir.mockResolvedValue("/cache/enola/1.0.0");
    capture.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "exec format error" });

    await expect(installEnola("1.0.0")).rejects.toThrow("Installed Enola could not start: exec format error");
  });
});

describe("useLocalEnola", () => {
  it("uses an absolute path unchanged and never contacts the network", async () => {
    fsMock.access.mockResolvedValue(undefined);
    capture.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "enola version 0.3.17-dev\n" });

    const result = await useLocalEnola("/tmp/enola-ent", "/workspace");

    expect(result.path).toBe("/tmp/enola-ent");
    expect(result.version).toBe("0.3.17-dev (local build)");
    expect(tc.downloadTool).not.toHaveBeenCalled();
  });

  it("resolves a relative path against the workspace", async () => {
    fsMock.access.mockResolvedValue(undefined);
    capture.mockResolvedValue({ exitCode: 0, stdout: "enola version 1.0.0", stderr: "" });

    const result = await useLocalEnola("build/enola", "/workspace");

    expect(result.path).toBe("/workspace/build/enola");
  });

  // The enterprise wrapper prints its own banner, so an unrecognised one must still grade.
  it("falls back to a plain label when the banner carries no version", async () => {
    fsMock.access.mockResolvedValue(undefined);
    capture.mockResolvedValue({ exitCode: 0, stdout: "enola-ent", stderr: "" });

    expect((await useLocalEnola("/tmp/enola-ent", "/workspace")).version).toBe("local build");
  });

  it("refuses a path that is not executable", async () => {
    fsMock.access.mockRejectedValue(new Error("EACCES"));
    await expect(useLocalEnola("/tmp/enola-ent", "/workspace")).rejects.toThrow(
      "The binary input does not point at an executable file: /tmp/enola-ent",
    );
    expect(capture).not.toHaveBeenCalled();
  });

  it("refuses a binary that cannot start", async () => {
    fsMock.access.mockResolvedValue(undefined);
    capture.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "exec format error" });
    await expect(useLocalEnola("/tmp/enola-ent", "/workspace")).rejects.toThrow(
      "The binary input could not start: exec format error",
    );
  });
});
