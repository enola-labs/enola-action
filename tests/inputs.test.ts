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

// `--detail` is honoured by Enola only when it is writing TEXT: the JSON document always
// carries the whole delta. Passing it beside `--json` did nothing, so the `detail` input
// silently did nothing either. It renders the delta into the job summary now, and the
// flag is gone from the invocation rather than left there looking load-bearing.
describe("the flags the check run does NOT get", () => {
  const inputs = {
    warnOnly: false,
    detail: true,
    sarif: true,
    annotations: true,
    summary: true,
    version: "latest",
    workingDirectory: ".",
  } as Inputs;

  it("asks for one format, and never for --detail", () => {
    expect(checkArguments(inputs, "/tmp/base")).toEqual(["check", "--baseline", "/tmp/base", "--json"]);
  });
});
