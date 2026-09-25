# What lands on the pull request

The action writes two things for every run: a job summary with the complete architecture delta, and source annotations for the findings the pull request introduced. This page walks through both.

## The job summary

A failing run, with `fail-on: layers`. The job summary, verbatim:

> # Enola architecture check
>
> ❌ **1 structural regression(s) introduced**
>
> | Base       | Current    | Enola   |
> | ---------- | ---------- | ------- |
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
> |          | Added | Removed |
> | -------- | ----: | ------: |
> | Facts    |     1 |       0 |
> | Edges    |     2 |       0 |
> | Findings |     1 |       0 |

Without `fail-on: layers` the identical finding appears under **Findings (reported, not enforced)**, annotates as a warning, and the job passes. A run with no policy at all also carries a **No policy set** notice, so the green is not mistaken for a verdict.

### The census line

The italic line under the table is Enola's census: what the run could not see, printed on every outcome including a pass, so a green check over a graph that skipped the files the change touched cannot be mistaken for one that resolved them.

### The excuse-rate line

A repository that declares constraint rules gets a second italic line beside it: the law's excuse rate, e.g. `law: 34 rules (28 ratchet, 4 advisory, 2 strict) - 12 breaches - 5 excused (42%) - oldest excuse 214 days`. It reports how many of the declared rules' breaches were signed away by a suppression or an exemption rather than fixed, and names the excuses that no longer match anything. It changes no exit code: a rule whose breaches are mostly excused is one to reconsider, and that judgement is the reader's. Repositories that declare no rules get no line.

### Guidance and reviewers

Two more sections appear only when there is something to put in them, and neither can fail the job.

**Guidance for this change** lists advice from guidance rules declared over the files the change touched, with the rule's `because:` and any exemplars to copy.

**Reviewers for this change** appears with `reviewers: "true"`: the owner of each module the change touched, measured from git authorship, and a suggested reviewer where the author is a minor contributor. Authorship needs history, so check out with `fetch-depth: 0`; on a shallow clone the section says the shares cover less history than asked for.

```yaml
- uses: actions/checkout@v7
  with:
    fetch-depth: 0
- uses: enola-labs/enola-action@v2
  with:
    fail-on: layers
    reviewers: "true"
```

`reviewer-window` sets how many recent commits authorship is measured over (default `500`), and `author` overrides whose change this is, as git history spells the name (default: the pull request's head commit author).

Set `detail: "true"` to put the complete structural delta in the summary, and `focus` to narrow the reported delta to one module, file or symbol.

## Source annotations

The finding above also lands on `storage/storage.go` as a source annotation, so it shows up in the **Files changed** tab next to the import that caused it, on the line the extractor measured, when it measured one.

Failing findings annotate as errors. Advisory ones, and rules your change newly declared, annotate as warnings. Annotations are capped at ten per level, with a notice saying how many were held back, so a cap never reads as "that was all of them". Findings with no position are counted rather than pinned to a line nobody wrote. The `verdict-file` output always holds the complete verdict, every bucket included.

Set `annotations: "false"` or `summary: "false"` to switch either one off.
