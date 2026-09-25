# When Enola grades only part of the graph

A pull request that adds the first Ruby file to a TypeScript repository changes **who produced the facts**: the base snapshot has no Ruby extractor, the head does. Enola used to refuse to grade that at all. It now grades the producers both snapshots share, reports `partial_clean` or `partial_regression`, and states plainly what it left out. Exit codes stay `0` and `1`, so the pass/fail meaning of the job does not change.

The action treats a partial verdict as the real pass or fail it is, and never as a whole one:

- the job summary headline carries **(partial verdict)** and a block naming every excluded producer, which side lacked it, and how many facts and findings went ungraded;
- the same sentence is a job warning, so it is visible in the diff and not only in the summary;
- `partial` is `true`, and `ungraded-facts` / `ungraded-findings` carry the counts. Gate on them if your workflow needs a whole verdict:

```yaml
- uses: enola-labs/enola-action@v2
  id: enola
  with:
    fail-on: layers
- if: steps.enola.outputs.partial == 'true'
  run: echo "::error::Enola could not grade every producer"; exit 1
```

A regression among an excluded producer's facts is **not** reported. That is what makes the verdict partial, and it is why the action says so everywhere it says anything.
