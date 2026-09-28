import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { upsertComment } from "../src/platform/github.js";

const target = { apiUrl: "https://api.github.com/", token: "t", repository: "o/r", issueNumber: 9 };
const marker = "<!-- enola-action:. -->";

function reply(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("upsertComment", () => {
  it("creates a comment when none carries the marker", async () => {
    fetchMock
      .mockResolvedValueOnce(reply(200, [{ id: 1, body: "someone else", html_url: "u1" }]))
      .mockResolvedValueOnce(reply(201, { id: 2, html_url: "u2" }));
    const result = await upsertComment(target, marker, `${marker}\nbody`, true);
    expect(result).toEqual({ action: "created", url: "u2" });
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("https://api.github.com/repos/o/r/issues/9/comments");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer t");
  });

  it("edits the marked comment in place, found on a later page", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({ id: i, body: "noise", html_url: "x" }));
    fetchMock
      .mockResolvedValueOnce(reply(200, page1))
      .mockResolvedValueOnce(reply(200, [{ id: 500, body: `${marker}\nold`, html_url: "u500" }]))
      .mockResolvedValueOnce(reply(200, { id: 500, html_url: "u500" }));
    const result = await upsertComment(target, marker, `${marker}\nnew`, true);
    expect(result).toEqual({ action: "updated", url: "u500" });
    expect(fetchMock.mock.calls[1][0]).toContain("page=2");
    expect(fetchMock.mock.calls[2][0]).toBe("https://api.github.com/repos/o/r/issues/comments/500");
    expect(fetchMock.mock.calls[2][1].method).toBe("PATCH");
  });

  it("does not match a comment that only mentions the marker", async () => {
    fetchMock
      .mockResolvedValueOnce(reply(200, [{ id: 1, body: `quoting ${marker}`, html_url: "u1" }]))
      .mockResolvedValueOnce(reply(201, { id: 2, html_url: "u2" }));
    expect((await upsertComment(target, marker, "b", true)).action).toBe("created");
  });

  it("creates nothing when the run did not earn a comment", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, []));
    expect(await upsertComment(target, marker, "b", false)).toEqual({ action: "skipped" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("names the permission when the token cannot write", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, [])).mockResolvedValueOnce(reply(403, { message: "nope" }));
    await expect(upsertComment(target, marker, "b", true)).rejects.toThrow("pull-requests: write");
  });
});
