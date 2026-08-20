# ADR 0002: Trusted public release and standalone attestation

Status: Accepted

## Context

The `0.1.0` npm packages shipped through GitHub Actions with npm trusted
publishing and provenance. The original standalone artifact path depended on a
tag created by `GITHUB_TOKEN` starting another workflow, so the matching `0.1.0`
standalone asset was not produced automatically.

## Decision

- Stable npm publication remains in `.github/workflows/release.yml` and uses
  GitHub OIDC trusted publishing rather than a long-lived npm token.
- A successful Changesets publication continues in the same workflow to build,
  attest, upload, and verify the version-matched standalone archive.
- Manual repair accepts an exact existing standalone tag and uses the same build,
  attestation, upload, and verification path without publishing npm packages.
- Workflow permissions remain empty by default and are granted narrowly per job.
- Canary publication remains retired until it can preserve the same trusted,
  single-workflow guarantees.

## Consequences

The `0.1.1` release is the first version whose npm packages and standalone archive
both follow the corrected topology. Release validation checks compiled package
contents, production dependencies, secrets, legal requirements, archive layout,
the GitHub release asset, and its artifact attestation. Repository moves require
immediate reconfiguration of npm trusted-publisher identities and release links.
