import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// enola-intent.yaml declares this action's layer order, and CI gates on it. The failure
// mode it cannot report itself: a directory that no declared path matches is simply
// UNCLASSIFIED — it produces no findings, so renaming src/policy to src/decide would not
// fail a build, it would quietly stop being governed. A gate that goes silent when the
// code moves is worse than no gate, because nothing about the job's output changes.
//
// The file is parsed by pulling the quoted globs out of it rather than by adding a YAML
// dependency to the action's runtime tree, which is deliberately tiny.
// vitest runs from the project root, and the action has no bundler indirection to work
// around, so cwd is the simplest thing that is also true.
const root = process.cwd();

function declaredPaths(): string[] {
  const raw = readFileSync(path.join(root, "enola-intent.yaml"), "utf8");
  // Only the entries, never the prose: the comment block above the declaration quotes
  // sample output, and matching quotes across the whole file picked those up as paths.
  const entries = raw
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .filter((line) => line.includes("paths:"));
  return entries.flatMap((line) => [...line.matchAll(/"([^"]+)"/g)].map((m) => m[1]));
}

function sourceDirectories(): string[] {
  return readdirSync(path.join(root, "src"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `src/${entry.name}`);
}

describe("the declared layer order", () => {
  it("covers every directory under src/", () => {
    const covered = new Set(declaredPaths().map((glob) => glob.replace(/\/\*\*$/, "")));
    for (const dir of sourceDirectories()) {
      expect(covered, `${dir} is in no declared layer, so nothing governs it`).toContain(dir);
    }
  });

  it("declares no path that has stopped existing", () => {
    const dirs = new Set([...sourceDirectories(), "src"]);
    for (const glob of declaredPaths()) {
      const dir = glob.replace(/\/\*\*$/, "");
      expect(dirs, `${glob} matches nothing — the declaration outlived the directory`).toContain(dir);
    }
  });

  // The entry layer is the one that cannot be expressed as a subtree: main.ts lives at
  // src/ itself, so its module is "src" and its path is exact rather than a glob. A
  // "src/**" here would swallow every other layer and classify the whole action as entry.
  it("matches the entry module exactly, not as a subtree", () => {
    expect(declaredPaths()).toContain("src");
    expect(declaredPaths()).not.toContain("src/**");
  });
});
