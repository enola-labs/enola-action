# What fails the job

Two separate things decide that: what Enola **finds**, and what your inputs **fail on**. Every explainer runs on every pull request; the inputs pick which of their findings set the exit code.

| Input            | What it does                                                                                                                                                                                                                                                                                                                                               |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| _(none)_         | nothing fails. Every finding is reported, the job is green, and the summary carries a **No policy set** notice so the green is not mistaken for a verdict                                                                                                                                                                                                  |
| `fail-on`        | the policy. `fail-on: layers` fails on new layer violations; `fail-on: cycles,layers` on both                                                                                                                                                                                                                                                              |
| `min-confidence` | **lowers** the floor within those explainers. The default is `1.00`, already the strictest value; `0.8` makes the job fail on _more_, not less                                                                                                                                                                                                             |
| `max-spillover`  | fails when the change reached more than N packages outside the `target` you declared. This is not a finding, and it can fail a job whose findings are all clean                                                                                                                                                                                            |
| `warn-only`      | downgrades findings and spillover breaches to warnings. It does **not** suppress a check that could not run: a missing base still fails, and a base Enola cannot compare against at all still makes it decline to grade (a base that differs only in _who produced the facts_ is graded partially instead, see [PARTIAL-VERDICTS.md](PARTIAL-VERDICTS.md)) |

## Explainer names

**`fail-on` accepts every explainer name** listed in [docs/EXPLAINERS.md](https://github.com/enola-labs/enola/blob/main/docs/EXPLAINERS.md), not just the few that show up in most examples. A name Enola does not recognise stops the run and says so, rather than matching nothing: matching is exact, so `CYCLES` is not `cycles`, and a list mixing valid and invalid names is refused whole. The `verdict-file` output holds the policy that actually ran.

## The confidence floor

Naming an explainer is not always enough, because the floor applies per finding. Only four explainers ever reach `1.00`: `cycles`, `intent`, `constraints` for a rule in enforcing mode, and `layers` when the layer order is _declared_ in `enola-intent.yaml`. Everything else is inferred rather than proven and is capped at `0.95` by design, so it cannot fail at the default floor no matter what you put in `fail-on`. Naming any other explainer is a no-op until you also lower `min-confidence`.

So failing on everything Enola proves plus every explainer it infers takes both halves: `fail-on:` with every name from [docs/EXPLAINERS.md](https://github.com/enola-labs/enola/blob/main/docs/EXPLAINERS.md), comma separated, **and** `min-confidence: "0.8"`. The names alone would change nothing.

## Spillover

`target` names what the pull request is meant to change: a symbol, type or package. `expected` adds further packages you expect it to touch. Packages the change reached outside that scope are spillover, and `max-spillover` turns the count into a pass/fail bound:

```yaml
- uses: enola-labs/enola-action@v2
  with:
    target: internal/auth
    max-spillover: "0"
```

## No policy, no gate

A workflow that sets neither `fail-on` nor `max-spillover` cannot fail, whatever Enola finds. The action emits a job warning and a summary notice on every such run rather than letting a green check speak for itself, but a required status check configured on it is protecting nothing.

This repository holds itself to its own declared layer order in [`enola-intent.yaml`](../enola-intent.yaml), enforced by its CI with `fail-on: layers`.

[docs/GATING.md](https://github.com/enola-labs/enola/blob/main/docs/GATING.md) in the enola repository covers what a verdict contains and every way it can fail, for the CLI and the action alike.
