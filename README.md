# Enola Architecture Check

Architectural regression testing for GitHub pull requests. The action compares the exact pull-request base with the checked-out commit, reports new structural findings as source annotations, and writes an architecture delta to the job summary.

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

Version 1.0 expects Enola's default `.enola` output directory. Support for a custom `output.dir` will be added without requiring changes to the Enola repository.

## Configuration

```yaml
- uses: enola-labs/enola-action@v1
  with:
    config: mcp-arch.yaml
    fail-on: cycles,layers
    min-confidence: "0.8"
    target: internal/auth
    max-spillover: "0"
```

The action requires the base commit to be available. `fetch-depth: 0` is recommended; if the exact base is missing, the action attempts to fetch that commit from `origin`.

By default the action downloads the latest Enola release. Pin a specific release instead by setting `version` to a tag from the [Enola releases page](https://github.com/enola-labs/enola/releases), e.g. `version: "0.3.13"`, for reproducible checks that don't change when a new Enola version ships.

## Security

The action requires only `contents: read`, does not execute repository scripts, verifies the checksum of the downloaded Enola release, and stores its temporary base worktree under `RUNNER_TEMP`. Avoid `pull_request_target`; ordinary `pull_request` events work for forks without a write token.
