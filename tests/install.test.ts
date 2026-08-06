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
}));
vi.mock("node:fs", () => ({ promises: fsMock }));

const capture = vi.hoisted(() => vi.fn());
vi.mock("../src/exec.js", () => ({ capture }));

import { installEnola } from "../src/install.js";

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
