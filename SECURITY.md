# Security policy

Please report vulnerabilities privately through GitHub's security-advisory interface for this repository. Do not open a public issue for a suspected vulnerability.

The action treats checked-out repository content as untrusted. It does not run repository scripts, requires only `contents: read`, verifies downloaded Enola release checksums, and creates temporary worktrees under `RUNNER_TEMP`.

The one exception is the optional `binary` input, which runs an executable the workflow supplies instead of a checksum-verified release. Point it only at something an earlier step in the same workflow built or installed, never at a path derived from pull-request content.
