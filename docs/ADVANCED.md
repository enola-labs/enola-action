# Advanced usage

## Outputs

`status`, `partial`, `regressions`, `advisories`, `facts-added`, `facts-removed`, `edges-added`, `edges-removed`, `ungraded-facts`, `ungraded-findings`, `sarif-file`, and `verdict-file`: the path to the complete JSON verdict, which carries more than the others summarise.

`status` is `clean`, `regression`, `usage_error`, `incomparable`, or one of the two **partial** forms, see [PARTIAL-VERDICTS.md](PARTIAL-VERDICTS.md).

## SARIF

Set `sarif: "true"` to get a SARIF 2.1.0 file alongside the verdict, rendered from the same run: one rule per declared rule id with your `because:` as its description, the evidence span as the region, and a stable fingerprint so a host can follow one finding across builds:

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

## Pinning an Enola release

By default the action downloads the latest Enola release. Pin a specific release instead by setting `version` to a tag from the [Enola releases page](https://github.com/enola-labs/enola/releases), e.g. `version: "0.4.24"`, for reproducible checks that don't change when a new Enola version ships.

## Grading with your own build

Set `binary` to grade with an engine the workflow builds itself, instead of a published release. Both sides of the comparison use that one executable, so the base and the head stay comparable.

```yaml
- run: go build -o /tmp/enola ./cmd/enola
- uses: enola-labs/enola-action@v2
  with:
    binary: /tmp/enola
    warn-only: "true"
```

This is what a repository that develops Enola, or ships a wrapper around it, needs: a change to what gets extracted or explained exists only in that build, so a released binary cannot see it. Relative paths resolve against the workspace, `version` is ignored, and no checksum is verified: the trust boundary is the workflow that produced the binary.

## Changing Enola's defaults

There is no config file to write. Enola ships its own defaults: it detects the languages in your repository, ignores the usual build output, vendored dependencies and test trees, and runs every extractor and explainer it has.

An `mcp-arch.yaml` exists for one purpose: to change those defaults. Ignore a directory Enola indexes and you don't care about, declare your layers, narrow a run to one language. If your repository already keeps one, point `config` at it and both sides of the comparison read the same file. Note that keys like `extractors:` and `ignore:` **replace** the built-in list rather than extend it, and a config that sets a custom `output.dir` is not supported by this action yet.

## Base commit

The action requires the base commit to be available. `fetch-depth: 0` is recommended; if the exact base is missing, the action attempts to fetch that commit from `origin`. Set `base-sha` to override the base the action resolved.
