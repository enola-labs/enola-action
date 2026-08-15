import { describe, expect, it } from "vitest";
import { checkArguments } from "../src/policy/inputs.js";
import { Inputs } from "../src/core/types.js";

describe("checkArguments", () => {
  it("passes policy without a shell", () => {
    const inputs = {
      failOn: "cycles,layers",
      minConfidence: "0.8",
      warnOnly: false,
      detail: false,
      annotations: true,
      summary: true,
      version: "latest",
      workingDirectory: ".",
    } as Inputs;
    expect(checkArguments(inputs, "/tmp/base")).toEqual([
      "check", "--baseline", "/tmp/base", "--json", "--fail-on", "cycles,layers", "--min-confidence", "0.8",
    ]);
  });
});
