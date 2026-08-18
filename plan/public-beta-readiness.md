# Entellix Core Public Beta Readiness

Status: Active
Started: 2026-08-17
Target: the next public Entellix Core release after `0.1.0`

## Outcome

Turn the published `0.1.0` open-core foundation into a public beta that a
developer can discover, install, run, verify, and evaluate entirely from public
artifacts and documentation.

## Current Baseline

- `@entellix/contracts`, `@entellix/core`, and `@entellix/instructions` `0.1.0`
  are public on npm.
- Stable publication from `.github/workflows/release.yml` uses npm trusted
  publishing and produces SLSA provenance attestations.
- The public repository is Apache-2.0 and has passing source, package, security,
  secret, and legal release gates.
- The single-workspace standalone host builds and passes its repository release
  verifier.
- The `@entellix/standalone@0.1.0` GitHub release exists, but it has no
  downloadable tarball. Its tag was created by a workflow using `GITHUB_TOKEN`,
  so the separate tag-triggered workflow did not run.
- The standalone README and npm package READMEs describe ownership but do not
  yet provide adequate installation, configuration, usage, or verification
  guidance.
- Some security and release documentation still describes the first public
  release as pending.
- npm trusts `release.yml` for each package. A separate `canary.yml` cannot use
  that same trusted-publisher identity, so stable and canary publication must
  share the trusted workflow or the canary design must be retired.

## Implementation Constraints

- Keep contracts, core, and instructions independently consumable through their
  documented public exports.
- Keep standalone as a single-workspace composition of the public packages.
- Preserve Zod-owned runtime contracts, functional TypeScript, narrow Effect
  boundaries, exact internal package versions, and compiled consumer exports.
- Do not solve release chaining with a long-lived npm token. Preserve trusted
  publishing and least-privilege GitHub permissions.
- Add a Changeset for user-visible package or standalone changes.

## Phase 1: Repair the Release Topology

1. Consolidate stable and optional canary publication under the trusted
   `release.yml` workflow, or explicitly retire canary publication until it has
   a trustworthy single-workflow design.
2. Make standalone artifact production an explicit continuation of a successful
   Changesets publish instead of relying on a tag event created by
   `GITHUB_TOKEN` to trigger another workflow.
3. Attach a versioned standalone tarball to its matching GitHub release and
   produce a GitHub artifact attestation.
4. Backfill the missing `@entellix/standalone@0.1.0` asset if it can be built
   reproducibly from that tag; otherwise document the omission and prove the
   corrected path with the next patch release.
5. Add a CI assertion that fails when a standalone version tag/release lacks the
   expected tarball and attestation.

### Phase 1 acceptance

- A release does not depend on workflow-recursion behavior that GitHub blocks.
- Stable npm publishing still uses OIDC and produces npm provenance.
- The matching standalone release contains a downloadable, versioned tarball.
- The tarball has a verifiable GitHub artifact attestation.
- A clean temporary consumer can extract, configure, migrate, start, and health
  check the released artifact.

## Phase 2: Make the Public Surface Usable

1. Expand `apps/standalone/README.md` into an exact quickstart:
   - supported Node, pnpm, and PostgreSQL versions;
   - download-from-release and source-checkout paths;
   - database creation, environment configuration, and migration;
   - secure local-token generation;
   - Anthropic generation setup and optional embedding setup;
   - server start, health verification, MCP client configuration, and first
     memory round trip;
   - operator review, retention, export, and confirmed-deletion routes;
   - current limitations and production-security guidance.
2. Add installation and minimal functional usage examples to each public npm
   package README.
3. Document the supported package exports and distinguish stable public
   contracts from implementation details.
4. Add a clean-room documentation smoke test that follows only the published
   instructions and released artifacts.

### Phase 2 acceptance

- A developer unfamiliar with the repository can complete the documented
  standalone quickstart without private knowledge.
- Every npm package README shows an ordinary package-manager install and at
  least one working import/use example.
- Documented commands and imports are checked in CI.
- The repository clearly labels the release as an early public beta rather than
  a turnkey managed service.

## Phase 3: Normalize Public Status and Governance

1. Update `SECURITY.md`, release operations, ADRs, and agent context to record
   that `0.1.0` shipped with trusted publishing and provenance.
2. Remove or rewrite first-release blockers that are no longer true.
3. Add concise CI/release/license badges and useful GitHub topics to improve
   public discoverability without turning the README into marketing copy.
4. Add focused issue templates for bugs, documentation gaps, and proposals.
5. State the support policy for the current `0.x` line and how breaking changes
   will be communicated.
6. Confirm the long-term GitHub organization. If ownership moves, reconfigure
   all npm trusted publishers, repository metadata, and release links
   immediately after the move.

### Phase 3 acceptance

- Public documentation agrees on current release and support status.
- Security reporting and supported-version language are current.
- A visitor can identify the license, stability level, CI state, release path,
  contribution path, and ownership from the repository landing page.
- Repository ownership matches the organization that owns the Entellix product.

## Phase 4: Publish and Prove the Public Beta

1. Add the required Changeset and run `pnpm check:all`.
2. Open and merge a focused implementation PR.
3. Merge the generated version PR only after release, documentation, and
   clean-room gates pass.
4. Verify npm versions, exact internal dependencies, provenance attestations,
   GitHub tags, release notes, standalone tarball, and artifact attestation.
5. Install the released packages and standalone artifact from their public
   locations in a disposable consumer and perform the documented smoke test.
6. Record the shipped outcome in durable `ai/` documentation and remove this
   active plan when every acceptance criterion is satisfied.

### Phase 4 acceptance

- All public release units share the intended version.
- The three npm packages install from the registry and expose only documented
  compiled entry points.
- The standalone release downloads and completes the documented first-run flow.
- npm and GitHub provenance/attestation are independently visible.
- CI, dependency security, secret, legal, package-content, and documentation
  gates pass on the released commit.

## Recommended First Task in the New Project

Repair release topology and backfill the standalone artifact before expanding
documentation. This closes the only current gap where a public release claims a
standalone distribution but provides no downloadable distribution.

Start by inspecting:

- `.github/workflows/release.yml`
- `.github/workflows/canary.yml`
- `.github/workflows/standalone-release.yml`
- `scripts/package-standalone.mjs`
- the `@entellix/standalone@0.1.0` GitHub release

Run before handoff:

```sh
pnpm check:all
```
