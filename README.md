# Enola Architecture Check

[![CI](https://github.com/enola-labs/enola-action/actions/workflows/ci.yml/badge.svg)](https://github.com/enola-labs/enola-action/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/enola-labs/enola-action)](https://github.com/enola-labs/enola-action/releases)
[![License](https://img.shields.io/github/license/enola-labs/enola-action)](LICENSE)

**Catch architecture regressions before they merge.** Enola Architecture Check compares the exact pull-request base with the checked-out commit, reports only the structural findings introduced by the pull request as source annotations, and writes the complete architecture delta to the job summary. Powered by [enola](https://github.com/enola-labs/enola).

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
      # Report-only by default. Add fail-on below to enforce a policy.
      - uses: enola-labs/enola-action@v2
```

With no inputs, **nothing fails the job**. Enola runs all eighteen of its checks - it calls them **explainers** - reports everything they find on the pull request, and stays green: the workflow above is a report, and the summary says so in as many words. One input turns it into a gate:

```yaml
      - uses: enola-labs/enola-action@v2
        with:
          fail-on: layers      # …or cycles, intent, constraints, or any of the eighteen
```

That is deliberate. What counts as an architectural regression is a decision about *your* codebase - a dependency cycle is a defect in one repository and ordinary practice in the next - so the action never picks one for you. See [what fails the job](#what-fails-the-job).

Enola runs entirely on the GitHub runner; source code is not uploaded by this action.

## What fails the job

Two separate things decide that: what Enola **finds**, and what your inputs **fail on**. Every explainer runs on every pull request; the inputs pick which of their findings set the exit code.

| Input | What it does |
|---|---|
| *(none)* | nothing fails. Every finding is reported, the job is green, and the summary carries a **No policy set** notice so the green is not mistaken for a verdict |
| `fail-on` | the policy. `fail-on: layers` fails on new layer violations; `fail-on: cycles,layers` on both |
| `min-confidence` | **lowers** the floor within those explainers. The default is `1.00`, already the strictest value; `0.8` makes the job fail on *more*, not less |
| `max-spillover` | fails when the change reached more than N packages outside the `target` you declared. This is not a finding, and it can fail a job whose findings are all clean |
| `warn-only` | downgrades findings and spillover breaches to warnings. It does **not** suppress a check that could not run: a missing base still fails, and a base Enola cannot compare against at all still makes it decline to grade (a base that differs only in *who produced the facts* is graded partially instead - see [below](#when-enola-grades-only-part-of-the-graph)) |

**`fail-on` accepts all eighteen explainer names**, not just the two or three that show up in most examples. A name Enola does not recognise stops the run and says so, rather than matching nothing: matching is exact, so `CYCLES` is not `cycles`, and a list mixing valid and invalid names is refused whole. The `verdict-file` output holds the policy that actually ran. Each row below is a real value you can paste into `with:`:

| You want | Set |
|---|---|
| The default: report everything, fail nothing | *omit `fail-on` entirely* |
| Fail on a layer order you declared being crossed the wrong way | `fail-on: layers` |
| Also fail on an undeclared cross-repo seam, and on new cycles | `fail-on: layers,intent,cycles` |
| Fail on a breach of an architecture rule you declared in `enola/constraints/` | `fail-on: constraints` |
| Everything Enola proves, plus the fourteen it infers | `fail-on: layers,intent,cycles,constraints,crossrepo,coverage,unused-routes,god-class,hotspots,dependency-depth,exported-surface,complexity-outliers,domain,query-loops,entry-points,messaging-coverage,dead-methods,vendored-candidates` **and** `min-confidence: "0.8"` |
| Enforce a policy, but only warn on this branch | `fail-on: layers` **and** `warn-only: "true"` |
| Fail if the change spread outside the area you named | `target: internal/auth` **and** `max-spillover: "0"` |

The fourth row needs both halves, which is the trap below in one line: the names alone would change nothing.

### What lands on the pull request

A failing run, with `fail-on: layers`. The job summary, verbatim:

> # Enola architecture check
>
> ❌ **1 structural regression(s) introduced**
>
> | Base | Current | Enola |
> |---|---|---|
> | `9f2c1ab4` | `3b7e5c2a` | `0.4.5` |
>
> _could not see: 0 files and 1 directory excluded by ignore globs; 2 imports targets outside the graph_
>
> ## Regressions
>
> - **layers · 1.00** — Layer violation: storage -> delivery — `storage/storage.go`
>
> ## Architectural change
>
> | | Added | Removed |
> |---|---:|---:|
> | Facts | 1 | 0 |
> | Edges | 2 | 0 |
> | Findings | 1 | 0 |

The italic line under the table is Enola's census: what the run could not see, printed on every outcome including a pass, so a green check over a graph that skipped the files the change touched cannot be mistaken for one that resolved them.

A repository that declares constraint rules gets a second italic line beside it - the law's excuse rate, e.g. `law: 34 rules (28 ratchet, 4 advisory, 2 strict) - 12 breaches - 5 excused (42%) - oldest excuse 214 days`. It reports how many of the declared rules' breaches were signed away by a suppression or an exemption rather than fixed, and names the excuses that no longer match anything. It changes no exit code: a rule whose breaches are mostly excused is one to reconsider, and that judgement is the reader's. Repositories that declare no rules get no line.

The same finding also lands on `storage/storage.go` as a source annotation, so it shows up in the **Files changed** tab next to the import that caused it - on the line the extractor measured, when it measured one. Without `fail-on: layers` the identical finding appears under **Findings (reported, not enforced)**, annotates as a warning, and the job passes.

Two traps worth knowing before you set `fail-on`:

- **No `fail-on` means no gate.** A workflow that sets neither `fail-on` nor `max-spillover` cannot fail, whatever Enola finds. The action emits a job warning and a summary notice on every such run rather than letting a green check speak for itself, but a required status check configured on it is protecting nothing.
- **Naming an explainer is not always enough, because the floor applies per finding.** Only four of the eighteen ever reach `1.00`: `cycles`, `intent`, `constraints` for a rule in enforcing mode, and `layers` when the layer order is *declared* in `enola-intent.yaml`. Everything else is inferred rather than proven and is capped at `0.95` by design, so it cannot fail at the default floor no matter what you put in `fail-on`. Naming any of the other fourteen is a no-op until you also lower `min-confidence`.

## Configuration

Every input is optional. The workflow above is the whole setup.

```yaml
- uses: enola-labs/enola-action@v2
  with:
    # Explainers whose new findings fail the job. WITHOUT THIS INPUT NOTHING FAILS.
    # Any of: cycles, layers, intent, constraints, crossrepo, coverage, unused-routes,
    # god-class, hotspots, dependency-depth, exported-surface, complexity-outliers,
    # domain, query-loops, entry-points, messaging-coverage, dead-methods,
    # vendored-candidates
    fail-on: layers,intent,cycles
    # Confidence floor within those explainers. Default "1.00" — only cycles, intent,
    # constraints and declared-layer violations reach it, so lower this to enforce the rest.
    min-confidence: "0.8"
    # What this pull request is meant to change. Packages it reached outside that
    # area are spillover; max-spillover turns the count into a pass/fail bound.
    target: internal/auth
    max-spillover: "0"
```

That block sets four inputs at once to show what they look like together; each one is independently optional. There are [fourteen more](#every-input) - the base override, the annotation and summary switches, the working directory, and the version or binary to grade with.

**There is no config file to write.** Enola ships its own defaults - it detects the languages in your repository, ignores the usual build output, vendored dependencies and test trees, and runs every extractor and explainer it has. That is what the quickstart above does, with no `mcp-arch.yaml` anywhere.

An `mcp-arch.yaml` exists for one purpose: to change those defaults. Ignore a directory Enola indexes and you don't care about, declare your layers, narrow a run to one language. If your repository already keeps one, point `config` at it and both sides of the comparison read the same file. If it doesn't, you are not missing a setup step. Note that keys like `extractors:` and `ignore:` **replace** the built-in list rather than extend it, and a config that sets a custom `output.dir` is not supported by this action yet.

The action requires the base commit to be available. `fetch-depth: 0` is recommended; if the exact base is missing, the action attempts to fetch that commit from `origin`.

### Every input

Eighteen, all optional, defaults in the right-hand column.

| Input | Default | What it does |
|---|---|---|
| `fail-on` | - | explainer names whose new findings fail the job. Unset means nothing fails |
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
| `sarif` | `false` | also write the findings as SARIF 2.1.0, for upload to code scanning |
| `summary` | `true` | write the job summary |
| `working-directory` | `.` | repository-relative project directory |
| `token` | `github.token` | used only to resolve the latest release version |

And twelve outputs: `status`, `partial`, `regressions`, `advisories`, `facts-added`, `facts-removed`, `edges-added`, `edges-removed`, `ungraded-facts`, `ungraded-findings`, `sarif-file`, and `verdict-file` - the path to the complete JSON verdict, which carries more than the others summarise.

`status` is `clean`, `regression`, `usage_error`, `incomparable`, or one of the two **partial** forms - see [when Enola grades only part of the graph](#when-enola-grades-only-part-of-the-graph).

Set `sarif: "true"` to get a SARIF 2.1.0 file alongside the verdict, rendered from the same run - one rule per declared rule id with your `because:` as its description, the evidence span as the region, and a stable fingerprint so a host can follow one finding across builds:

```yaml
- uses: enola-labs/enola-action@v2
  id: enola
  with:
    fail-on: constraints
    sarif: "true"
- uses: github/codeql-action/upload-sarif@v3
  if: always()
  with:
    sarif_file: ${{ steps.enola.outputs.sarif-file }}
```

## When Enola grades only part of the graph

A pull request that adds the first Ruby file to a TypeScript repository changes **who produced the facts**: the base snapshot has no Ruby extractor, the head does. Enola used to refuse to grade that at all. It now grades the producers both snapshots share, reports `partial_clean` or `partial_regression`, and states plainly what it left out - exit codes stay `0` and `1`, so the pass/fail meaning of the job does not change.

The action treats a partial verdict as the real pass or fail it is, and never as a whole one:

- the job summary headline carries **(partial verdict)** and a block naming every excluded producer, which side lacked it, and how many facts and findings went ungraded;
- the same sentence is a job warning, so it is visible in the diff and not only in the summary;
- `partial` is `true`, and `ungraded-facts` / `ungraded-findings` carry the counts - gate on them if your workflow needs a whole verdict:

```yaml
- uses: enola-labs/enola-action@v2
  id: enola
  with:
    fail-on: layers
- if: steps.enola.outputs.partial == 'true'
  run: echo "::error::Enola could not grade every producer"; exit 1
```

A regression among an excluded producer's facts is **not** reported. That is what makes the verdict partial, and it is why the action says so everywhere it says anything.

By default the action downloads the latest Enola release. Pin a specific release instead by setting `version` to a tag from the [Enola releases page](https://github.com/enola-labs/enola/releases), e.g. `version: "0.3.13"`, for reproducible checks that don't change when a new Enola version ships.

## Grading with your own build

Set `binary` to grade with an engine the workflow builds itself, instead of a published release. Both sides of the comparison use that one executable, so the base and the head stay comparable.

```yaml
- run: go build -o /tmp/enola ./cmd/enola
- uses: enola-labs/enola-action@v2
  with:
    binary: /tmp/enola
    warn-only: "true"
```

This is what a repository that develops Enola, or ships a wrapper around it, needs: a change to what gets extracted or explained exists only in that build, so a released binary cannot see it. Relative paths resolve against the workspace, `version` is ignored, and no checksum is verified - the trust boundary is the workflow that produced the binary.

## This action and enola

The action is the CI face of [enola](https://github.com/enola-labs/enola), an Apache-2.0 engine that indexes a repository into a dependency graph and grades a change against a pinned baseline. Every finding reported here comes from `enola check`, so the verdict on a pull request is the verdict you get in your shell:

```bash
enola baseline pin      # freeze the architecture before you edit
enola check                         # report the structural delta; exit 0
enola check --fail-on=layers        # exit 1 on a new declared-layer violation
```

Same explainers, same exit codes. What the action adds is the pull-request wiring: it resolves the exact base commit, pins and grades both sides itself - no baseline artifact to publish and restore - turns new findings into source annotations, and writes the delta to the job summary. Failing findings annotate as errors, advisory ones and rules your change newly declared as warnings, on the line the extractor measured - capped at ten per level, with a notice saying how many were held back so a cap never reads as "that was all of them". Findings with no position are counted rather than pinned to a line nobody wrote. The `verdict-file` output always holds the complete verdict, every bucket included.

- **[enola](https://github.com/enola-labs/enola)** - what it is, what fails a build, and the 20+ languages it parses
- **[docs/CLI.md](https://github.com/enola-labs/enola/blob/main/docs/CLI.md)** - the flags behind the `fail-on`, `min-confidence`, `target` and `max-spillover` inputs
- **[docs/EXPLAINERS.md](https://github.com/enola-labs/enola/blob/main/docs/EXPLAINERS.md)** - what each explainer computes, and which of them Enola proves rather than infers
- **MCP** - the same graph inside your agent, before it edits rather than only after

## Security

The action requires only `contents: read`, does not execute repository scripts, verifies the checksum of the downloaded Enola release, and stores its temporary base worktree under `RUNNER_TEMP`. Avoid `pull_request_target`; ordinary `pull_request` events work for forks without a write token.

## Found it useful?

If this action stopped a structural regression before it reached your default branch, a star on [enola-action](https://github.com/enola-labs/enola-action) helps other people find it - and one on [enola](https://github.com/enola-labs/enola) helps them find the engine underneath.

If it graded a pull request wrong - a regression that was already there, a base it couldn't resolve, an annotation on the wrong line - [open an issue](https://github.com/enola-labs/enola-action/issues). A gate you can't trust is worse than no gate, so those reports come first.

## License

Apache License 2.0 - see [`LICENSE`](LICENSE).
