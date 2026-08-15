import { describe, expect, it } from "vitest";
import { resolveRevisionContext } from "../src/policy/context.js";
import { Inputs } from "../src/core/types.js";

const inputs = { baseSha: undefined } as Inputs;

describe("resolveRevisionContext", () => {
  it("uses the pull request base", () => {
    expect(resolveRevisionContext(inputs, "pull_request", { pull_request: { base: { sha: "base" } } }, "head"))
      .toEqual({ baseSha: "base", headSha: "head", eventName: "pull_request" });
  });

  it("rejects a branch creation push", () => {
    expect(() => resolveRevisionContext(inputs, "push", { before: "000000" }, "head"))
      .toThrow("No usable base commit");
  });
});
