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

By default, only a newly introduced dependency cycle fails. Other findings are advisory. Enola runs entirely on the GitHub runner; source code is not uploaded by this action.

## Configuration

Every input is optional. The workflow above is the whole setup.

```yaml
- uses: enola-labs/enola-action@v1
  with:
    fail-on: cycles,layers
    min-confidence: "0.8"
    target: internal/auth
    max-spillover: "0"
```

**There is no config file to write.** Enola ships its own defaults - it detects the languages in your repository, ignores the usual build output, vendored dependencies and test trees, and runs every extractor and explainer it has. That is what the quickstart above does, with no `mcp-arch.yaml` anywhere.

An `mcp-arch.yaml` exists for one purpose: to change those defaults. Ignore a directory Enola indexes and you don't care about, declare your layers, narrow a run to one language. If your repository already keeps one, point `config` at it and both sides of the comparison read the same file. If it doesn't, you are not missing a setup step. Note that keys like `extractors:` and `ignore:` **replace** the built-in list rather than extend it, and a config that sets a custom `output.dir` is not supported by this action yet.

The action requires the base commit to be available. `fetch-depth: 0` is recommended; if the exact base is missing, the action attempts to fetch that commit from `origin`.

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

Same explainers, same exit codes. What the action adds is the pull-request wiring: it resolves the exact base commit, pins and grades both sides itself - no baseline artifact to publish and restore - turns new findings into source annotations, and writes the delta to the job summary.

- **[enola](https://github.com/enola-labs/enola)** - what it is, what fails a build, and the 20+ languages it parses
- **[docs/CLI.md](https://github.com/enola-labs/enola/blob/main/docs/CLI.md)** - the flags behind the `fail-on`, `min-confidence`, `target` and `max-spillover` inputs
- **[docs/EXPLAINERS.md](https://github.com/enola-labs/enola/blob/main/docs/EXPLAINERS.md)** - what each explainer computes, and why only cycles fail by default
- **MCP** - the same graph inside your agent, before it edits rather than only after

## Security

The action requires only `contents: read`, does not execute repository scripts, verifies the checksum of the downloaded Enola release, and stores its temporary base worktree under `RUNNER_TEMP`. Avoid `pull_request_target`; ordinary `pull_request` events work for forks without a write token.

## Found it useful?

If this action stopped a dependency cycle before it reached your default branch, a star on [enola-action](https://github.com/enola-labs/enola-action) helps other people find it - and one on [enola](https://github.com/enola-labs/enola) helps them find the engine underneath.

If it graded a pull request wrong - a regression that was already there, a base it couldn't resolve, an annotation on the wrong line - [open an issue](https://github.com/enola-labs/enola-action/issues). A gate you can't trust is worse than no gate, so those reports come first.

## License

Apache License 2.0 - see [`LICENSE`](LICENSE).
