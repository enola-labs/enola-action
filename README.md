# Enola Architecture Check

[![CI](https://github.com/enola-labs/enola-action/actions/workflows/ci.yml/badge.svg)](https://github.com/enola-labs/enola-action/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/enola-labs/enola-action)](https://github.com/enola-labs/enola-action/releases)
[![License](https://img.shields.io/github/license/enola-labs/enola-action)](LICENSE)

Architectural regression testing for GitHub pull requests, powered by [enola](https://github.com/enola-labs/enola). The action compares the exact pull-request base with the checked-out commit, reports new structural findings as source annotations, and writes an architecture delta to the job summary.

```yaml
name: Architecture
on:
  pull_request:
  merge_group:

permissions:
  contents: read

jobs:
  enola:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: enola-labs/enola-action@v1
```

With no inputs, one thing fails the job: a **newly introduced dependency cycle**. Enola still runs all eleven of its checks - it calls them **explainers** - and everything the other ten find is reported as advisory. That is a default, not a limit: `fail-on` promotes any of them, and `max-spillover` can fail a pull request with no failing findings at all. See [what fails the job](#what-fails-the-job).

Enola runs entirely on the GitHub runner; source code is not uploaded by this action.

## What fails the job

Two separate things decide that: what Enola **finds**, and what your inputs **fail on**. Every explainer runs on every pull request; the inputs pick which of their findings set the exit code.

| Input | What it does |
|---|---|
| *(none)* | fail on a new `cycles` finding at confidence `1.00` |
| `fail-on` | **replaces** that list. `fail-on: layers` stops failing on cycles - write `cycles,layers` for both |
| `min-confidence` | **lowers** the floor within those explainers. The default is `1.00`, already the strictest value; `0.8` makes the job fail on *more*, not less |
| `max-spillover` | fails when the change reached more than N packages outside the `target` you declared. This is not a finding, and it can fail a job whose findings are all clean |
| `warn-only` | downgrades findings and spillover breaches to warnings. It does **not** suppress a check that could not run: a missing base still fails, and an incomparable base still makes Enola decline to grade |

**`fail-on` accepts all eleven explainer names**, not just the two or three that show up in most examples. Each row below is a real value you can paste into `with:`:

| You want | Set |
|---|---|
| The default: fail only on new cycles | *omit `fail-on` entirely* |
| Also fail on an undeclared cross-repo seam, and on a layer order you declared being crossed the wrong way | `fail-on: cycles,intent,layers` |
| Everything Enola proves, plus the eight it infers | `fail-on: cycles,intent,layers,crossrepo,coverage,unused-routes,god-class,hotspots,dependency-depth,exported-surface,complexity-outliers` **and** `min-confidence: "0.8"` |
| Report everything, fail nothing | `warn-only: "true"` |
| Fail if the change spread outside the area you named | `target: internal/auth` **and** `max-spillover: "0"` |

The third row needs both halves, which is the trap below in one line: the names alone would change nothing.

### What lands on the pull request

A failing run, with `fail-on: cycles,layers` and no cycle in the change. The job summary, verbatim:

> # Enola architecture check
>
> ❌ **1 structural regression(s) introduced**
>
> | Base | Current | Enola |
> |---|---|---|
> | `9f2c1ab4` | `3b7e5c2a` | `0.3.18` |
>
> ## Regressions
>
> - **layers · 1.00** — Layer violation: storage -> api — `src/storage/mod.rs`
>
> ## Architectural change
>
> | | Added | Removed |
> |---|---:|---:|
> | Facts | 1 | 0 |
> | Edges | 2 | 0 |
> | Findings | 1 | 0 |

The same finding also lands on `src/storage/mod.rs` as a source annotation, so it shows up in the **Files changed** tab next to the import that caused it. Had this been an advisory rather than a regression, it would appear under its own heading and annotate as a warning, and the job would pass.

Two traps worth knowing before you set `fail-on`:

- **A misspelled name is not an error.** It matches nothing, so the gate quietly stops enforcing what you thought you asked for. The `verdict-file` output holds the policy that actually ran.
- **Naming an explainer is not always enough, because the floor applies per finding.** Only three of the eleven ever reach `1.00`: `cycles`, `intent`, and `layers` when the layer order is *declared* in `enola-intent.yaml`. Everything else is inferred rather than proven and is capped at `0.95` by design, so it cannot fail at the default floor no matter what you put in `fail-on`. Naming any of the other eight is a no-op until you also lower `min-confidence`.

## Configuration

Every input is optional. The workflow above is the whole setup.

```yaml
- uses: enola-labs/enola-action@v1
  with:
    # Explainers whose new findings fail the job. Replaces the default, which is
    # cycles alone. Any of: cycles, layers, intent, crossrepo, coverage,
    # unused-routes, god-class, hotspots, dependency-depth, exported-surface,
    # complexity-outliers
    fail-on: cycles,layers,intent
    # Confidence floor within those explainers. Default "1.00" — only cycles, intent
    # and declared-layer violations reach it, so lower this to enforce the rest.
    min-confidence: "0.8"
    # What this pull request is meant to change. Packages it reached outside that
    # area are spillover; max-spillover turns the count into a pass/fail bound.
    target: internal/auth
    max-spillover: "0"
```

That block sets four inputs at once to show what they look like together; each one is independently optional. There are [twelve more](#every-input) - the base override, the annotation and summary switches, the working directory, and the version or binary to grade with.

**There is no config file to write.** Enola ships its own defaults - it detects the languages in your repository, ignores the usual build output, vendored dependencies and test trees, and runs every extractor and explainer it has. That is what the quickstart above does, with no `mcp-arch.yaml` anywhere.

An `mcp-arch.yaml` exists for one purpose: to change those defaults. Ignore a directory Enola indexes and you don't care about, declare your layers, narrow a run to one language. If your repository already keeps one, point `config` at it and both sides of the comparison read the same file. If it doesn't, you are not missing a setup step. Note that keys like `extractors:` and `ignore:` **replace** the built-in list rather than extend it, and a config that sets a custom `output.dir` is not supported by this action yet.

The action requires the base commit to be available. `fetch-depth: 0` is recommended; if the exact base is missing, the action attempts to fetch that commit from `origin`.

### Every input

Sixteen, all optional, defaults in the right-hand column.

| Input | Default | What it does |
|---|---|---|
| `fail-on` | `cycles` | explainer names whose new findings fail the job; replaces the default |
| `min-confidence` | `1.00` | confidence floor within those explainers; lowering it fails on more |
| `warn-only` | `false` | report findings and spillover breaches without failing the job |
| `target` | - | the symbol, type or package this change is meant to be about |
| `expected` | - | further packages you expect to touch, comma separated |
| `max-spillover` | - | fail when more than N packages are reached outside that scope |
| `focus` | - | narrow the reported delta to one module, file or symbol |
| `detail` | `false` | put the complete structural delta in the job summary |
| `config` | - | repository-relative `mcp-arch.yaml`, read on both sides of the comparison |
| `version` | `latest` | Enola release to download, e.g. `"0.3.13"` |
| `binary` | - | grade with an executable the workflow built instead; wins over `version` |
| `base-sha` | - | override the base commit the action resolved |
| `annotations` | `true` | emit source annotations |
| `summary` | `true` | write the job summary |
| `working-directory` | `.` | repository-relative project directory |
| `token` | `github.token` | used only to resolve the latest release version |

And eight outputs: `status`, `regressions`, `advisories`, `facts-added`, `facts-removed`, `edges-added`, `edges-removed`, and `verdict-file` - the path to the complete JSON verdict, which carries more than the other seven summarise.

By default the action downloads the latest Enola release. Pin a specific release instead by setting `version` to a tag from the [Enola releases page](https://github.com/enola-labs/enola/releases), e.g. `version: "0.3.13"`, for reproducible checks that don't change when a new Enola version ships.

## Grading with your own build

Set `binary` to grade with an engine the workflow builds itself, instead of a published release. Both sides of the comparison use that one executable, so the base and the head stay comparable.

```yaml
- run: go build -o /tmp/enola ./cmd/enola
- uses: enola-labs/enola-action@v1
  with:
    binary: /tmp/enola
    warn-only: "true"
```

This is what a repository that develops Enola, or ships a wrapper around it, needs: a change to what gets extracted or explained exists only in that build, so a released binary cannot see it. Relative paths resolve against the workspace, `version` is ignored, and no checksum is verified - the trust boundary is the workflow that produced the binary.

## This action and enola

The action is the CI face of [enola](https://github.com/enola-labs/enola), an Apache-2.0 engine that indexes a repository into a dependency graph and grades a change against a pinned baseline. Every finding reported here comes from `enola check`, so the verdict on a pull request is the verdict you get in your shell:

```bash
enola baseline pin      # freeze the architecture before you edit
enola check             # exit 1 on a structural regression
```

Same explainers, same exit codes. What the action adds is the pull-request wiring: it resolves the exact base commit, pins and grades both sides itself - no baseline artifact to publish and restore - turns new findings into source annotations, and writes the delta to the job summary. Failing findings annotate as errors and advisory ones as warnings, capped at ten of each so a large delta doesn't bury the page; the `verdict-file` output always holds the complete verdict.

- **[enola](https://github.com/enola-labs/enola)** - what it is, what fails a build, and the 20+ languages it parses
- **[docs/CLI.md](https://github.com/enola-labs/enola/blob/main/docs/CLI.md)** - the flags behind the `fail-on`, `min-confidence`, `target` and `max-spillover` inputs
- **[docs/EXPLAINERS.md](https://github.com/enola-labs/enola/blob/main/docs/EXPLAINERS.md)** - what each explainer computes, and why cycles are the one thing that fails by default
- **MCP** - the same graph inside your agent, before it edits rather than only after

## Security

The action requires only `contents: read`, does not execute repository scripts, verifies the checksum of the downloaded Enola release, and stores its temporary base worktree under `RUNNER_TEMP`. Avoid `pull_request_target`; ordinary `pull_request` events work for forks without a write token.

## Found it useful?

If this action stopped a structural regression before it reached your default branch, a star on [enola-action](https://github.com/enola-labs/enola-action) helps other people find it - and one on [enola](https://github.com/enola-labs/enola) helps them find the engine underneath.

If it graded a pull request wrong - a regression that was already there, a base it couldn't resolve, an annotation on the wrong line - [open an issue](https://github.com/enola-labs/enola-action/issues). A gate you can't trust is worse than no gate, so those reports come first.

## License

Apache License 2.0 - see [`LICENSE`](LICENSE).
