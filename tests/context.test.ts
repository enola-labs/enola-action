import { describe, expect, it } from "vitest";
import { resolveRevisionContext } from "../src/policy/context.js";
import { Inputs } from "../src/core/types.js";

const inputs = { baseSha: undefined } as Inputs;

describe("resolveRevisionContext", () => {
  it("uses the pull request base", () => {
    expect(resolveRevisionContext(inputs, "pull_request", { pull_request: { base: { sha: "base" } } }, "head"))
      .toEqual({ baseSha: "base", headSha: "head", authorSha: "head", eventName: "pull_request" });
  });

  // GitHub checks out a merge commit for a pull request; its author is not whose change it is.
  it("takes the author from the pull request head, not the merge commit", () => {
    const payload = { pull_request: { base: { sha: "base" }, head: { sha: "prhead" } } };
    expect(resolveRevisionContext(inputs, "pull_request", payload, "merge").authorSha).toBe("prhead");
  });

  it("rejects a branch creation push", () => {
    expect(() => resolveRevisionContext(inputs, "push", { before: "000000" }, "head"))
      .toThrow("No usable base commit");
  });
});
