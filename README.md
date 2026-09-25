# Enola Architecture Check

[![CI](https://github.com/enola-labs/enola-action/actions/workflows/ci.yml/badge.svg)](https://github.com/enola-labs/enola-action/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/enola-labs/enola-action)](https://github.com/enola-labs/enola-action/releases)
[![License](https://img.shields.io/github/license/enola-labs/enola-action)](LICENSE)

**Catch architecture regressions before they merge.** Enola Architecture Check compares the exact pull-request base with the checked-out commit, reports only the structural findings introduced by the pull request as source annotations, and writes the complete architecture delta to the job summary. Powered by [enola](https://github.com/enola-labs/enola).

It runs entirely on the GitHub runner. No source code is uploaded, and there is no baseline to publish or restore.

## Step 1: try it, fail nothing

This workflow reports on every pull request and never fails one, whatever Enola finds. Add it as `.github/workflows/architecture.yml`:

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
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - uses: enola-labs/enola-action@v2
```

That is the whole setup: no inputs, no config file. Open a pull request and you get:

- a green job, with a **No policy set** warning so nobody mistakes the green for a verdict;
- a job summary listing what the pull request changed in the architecture, and its findings under **Findings (reported, not enforced)**;
- a warning annotation in the **Files changed** tab on each line that introduced a finding.

Only what the pull request introduced is reported. Problems the repository already had stay out. [docs/PULL-REQUEST.md](docs/PULL-REQUEST.md) walks through every section the summary can carry.

## Step 2: choose what fails

Two inputs decide what fails the job.

**`fail-on`** names the explainers whose findings can fail it, comma separated. An explainer is one of Enola's checks, such as `layers` or `cycles`; every finding in the report starts with the name of the one that produced it. [EXPLAINERS.md](https://github.com/enola-labs/enola/blob/main/docs/EXPLAINERS.md) lists them all.

**`min-confidence`** sets how sure Enola must be of a finding for it to fail the job: any number from `0` to `1`. Every finding in the report carries this number after its explainer's name. The default is `1.00`, which means proven findings only.

With the default, only four explainers can fail the job: `cycles`, `intent`, `constraints`, and `layers` once you [declare a layer order](https://github.com/enola-labs/enola/blob/main/docs/INTENT.md). To fail on any other explainer, lower `min-confidence` as well:

```yaml
- uses: enola-labs/enola-action@v2
  with:
    fail-on: layers,hotspots
    min-confidence: "0.8"
```

A failing run looks like this. The job summary, verbatim:

> # Enola architecture check
>
> ❌ **1 structural regression(s) introduced**
>
> | Base       | Current    | Enola    |
> | ---------- | ---------- | -------- |
> | `9f2c1ab4` | `3b7e5c2a` | `0.4.24` |
>
> _could not see: 0 files and 1 directory excluded by ignore globs; 2 imports targets outside the graph_
>
> ## Regressions
>
> - **layers · 1.00** — Layer violation: storage -> delivery — `storage/storage.go`
>
> ## Architectural change
>
> |          | Added | Removed |
> | -------- | ----: | ------: |
> | Facts    |     1 |       0 |
> | Edges    |     2 |       0 |
> | Findings |     1 |       0 |

The same finding lands on `storage/storage.go` as an error annotation, next to the import that caused it. The italic line is what the run could not see, printed on every outcome, so a green check over files Enola skipped never passes for a clean one.

## Step 3: go further

- **Your own rules.** Forbid one part of the code from reaching another, and fail with your reason in the annotation: [policy as code](#policy-as-code) below.
- **Scope a change.** Name what a pull request is meant to touch with `target`, and fail when it spreads further with `max-spillover`: [docs/POLICY.md](docs/POLICY.md#spillover).
- **Roll out gently.** `warn-only: "true"` keeps a policy but turns failures back into warnings, e.g. on one branch.
- **Suggested reviewers.** `reviewers: "true"` names the owner of each module the change touched: [docs/PULL-REQUEST.md](docs/PULL-REQUEST.md#guidance-and-reviewers).
- **Code scanning, pinned releases, your own build, outputs:** [docs/ADVANCED.md](docs/ADVANCED.md).

Every input is listed in [the table below](#inputs).

## The action and `enola check`

Every finding comes from `enola check`, so the verdict on a pull request is the verdict you get in your shell:

```bash
enola baseline pin                  # freeze the architecture before you edit
enola check                         # report the structural delta; exit 0
enola check --fail-on=layers        # exit 1 on a new declared-layer violation
```

Same explainers, same exit codes. What the action adds is the pull-request wiring: it resolves the exact base commit, grades both sides itself, turns new findings into source annotations, and writes the delta to the job summary.

## Policy as code

Beyond the architecture Enola infers, you can write down rules of your own and commit them next to the code they govern. This one keeps personal data out of application logs:

```yaml
# enola/constraints/gdpr.yaml
components:
  - name: personal-data
    match: ["customers/**"]

rules:
  - id: gdpr-art-5-1-f-personal-data-never-reaches-the-log
    forbid: personal-data
    to_name: ["log.*"]
    via: calls
    mode: strict
    because: >-
      GDPR Art. 5(1)(f): a subject's name in an application log is a second
      copy with a different retention period and no erasure path.
```

With `fail-on: constraints`, a pull request that adds `log.Printf("erasing %s", subject)` to `customers/` compiles, passes `go vet`, and fails this job. The annotation carries the rule's `because:`, so the reviewer reads _why_ the rule exists, not only that it broke. [`examples/policy-as-code`](https://github.com/enola-labs/enola/tree/main/examples/policy-as-code) runs PCI DSS and GDPR rules end to end, and [docs/CONSTRAINTS.md](https://github.com/enola-labs/enola/blob/main/docs/CONSTRAINTS.md) is the full rule vocabulary.

## Inputs

All optional.

| Input               | Default               | What it does                                                                                |
| ------------------- | --------------------- | ------------------------------------------------------------------------------------------- |
| `fail-on`           | -                     | explainer names whose new findings fail the job. Unset means nothing fails                  |
| `min-confidence`    | `1.00`                | confidence floor within those explainers; lowering it fails on more                         |
| `warn-only`         | `false`               | report findings and spillover breaches without failing the job                              |
| `target`            | -                     | the symbol, type or package this change is meant to be about                                |
| `expected`          | -                     | further packages you expect to touch, comma separated                                       |
| `max-spillover`     | -                     | fail when more than N packages are reached outside that scope                               |
| `focus`             | -                     | narrow the reported delta to one module, file or symbol                                     |
| `detail`            | `false`               | put the complete structural delta in the job summary                                        |
| `config`            | -                     | repository-relative `mcp-arch.yaml`, read on both sides of the comparison                   |
| `version`           | `latest`              | Enola release to download, e.g. `"0.4.24"`                                                  |
| `binary`            | -                     | grade with an executable the workflow built instead; wins over `version`                    |
| `reviewers`         | `false`               | report who owns the modules this change touched and suggest a reviewer; never fails the job |
| `reviewer-window`   | `500`                 | with `reviewers`, how many recent commits authorship is measured over                       |
| `author`            | PR head commit author | with `reviewers`, whose change this is, as git history spells the name                      |
| `base-sha`          | -                     | override the base commit the action resolved                                                |
| `annotations`       | `true`                | emit source annotations                                                                     |
| `sarif`             | `false`               | also write the findings as SARIF 2.1.0, for upload to code scanning                         |
| `summary`           | `true`                | write the job summary                                                                       |
| `working-directory` | `.`                   | repository-relative project directory                                                       |
| `token`             | `github.token`        | used only to resolve the latest release version                                             |

Outputs, SARIF upload, release pinning, grading with your own build and `mcp-arch.yaml` are in [docs/ADVANCED.md](docs/ADVANCED.md). When a pull request changes which extractors produce facts, Enola grades only the part both sides share and says so: [docs/PARTIAL-VERDICTS.md](docs/PARTIAL-VERDICTS.md).

## Security

The action requires only `contents: read`, does not execute repository scripts, verifies the checksum of the downloaded Enola release, and stores its temporary base worktree under `RUNNER_TEMP`. Avoid `pull_request_target`; ordinary `pull_request` events work for forks without a write token.

## Found it useful?

If this action stopped a structural regression before it reached your default branch, a star on [enola-action](https://github.com/enola-labs/enola-action) helps other people find it, and one on [enola](https://github.com/enola-labs/enola) helps them find the engine underneath.

If it graded a pull request wrong (a regression that was already there, a base it couldn't resolve, an annotation on the wrong line), [open an issue](https://github.com/enola-labs/enola-action/issues). A gate you can't trust is worse than no gate, so those reports come first.

## License

Apache License 2.0, see [`LICENSE`](LICENSE).
