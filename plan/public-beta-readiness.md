# Entellix Core Public Beta Readiness

Status: Active — Phase 3 complete; Phase 4 in progress
Started: 2026-08-17
Target: the next public Entellix Core release after `0.1.1`

## Outcome

Turn the published `0.1.0` open-core foundation into a public beta that a
developer can discover, install, run, verify, and evaluate entirely from public
artifacts and documentation.

## Current Baseline

- `@entellix/contracts`, `@entellix/core`, and `@entellix/instructions` `0.1.1`
  are public on npm.
- Stable publication from `.github/workflows/release.yml` uses npm trusted
  publishing and produces SLSA provenance attestations.
- The public repository is Apache-2.0 and has passing source, package, security,
  secret, and legal release gates.
- The `@entellix/standalone@0.1.1` release topology builds, attests, uploads, and
  verifies the versioned standalone archive in the trusted release workflow.
- The standalone README and npm package READMEs provide executable installation,
  configuration, usage, and verification guidance checked from packed artifacts.
- Security, support, release, ADR, and agent context now describe the shipped
  public beta and its trusted publication and attestation controls.

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

Status: Complete (2026-08-18)

Phase 1 shipped in `@entellix/standalone@0.1.1`. Commit `79058b9` consolidated
publication and standalone artifact production in `.github/workflows/release.yml`,
removed the separate canary and tag-triggered workflows, added the manual
tag-based repair path, and added a release-topology assertion. The `0.1.1`
version commit records the corrected distribution path.

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

Status: Complete (2026-08-19)

### Goal

Make the standalone archive and all three npm packages usable by a developer
who has only the public release artifacts and their included READMEs. Phase 2
documents and verifies the existing public surface; it does not add a managed
service, multi-workspace operation, or a new provider abstraction.

### Implementation decisions

1. Treat only package specifiers present in a published package's `exports` map
   as supported public-beta entry points. `src`, `dist`, and undeclared deep
   imports remain implementation details.
2. Support and document three standalone paths: Docker Compose for isolated
   local evaluation, the GitHub release archive for published-version
   evaluation, and a source checkout for contributors. Keep their commands
   separate wherever installation, migration, or startup differs.
3. Determine the PostgreSQL support floor by exercising the quickstart against
   the oldest version selected for support and the current stable major; do not
   publish an untested version claim.
4. Split verification into a credential-free PR gate and a provider-backed
   clean-room release gate. PR CI checks every documented import and command it
   can run deterministically. The complete save/process/retrieve round trip runs
   with real provider credentials before release and is recorded in the PR.

### Workstream 1: Turn the acceptance criteria into executable checks

1. Add `scripts/verify-public-documentation.mjs` and a root
   `release:documentation:verify` command before expanding the READMEs.
2. Mark executable README snippets with stable identifiers so the verifier runs
   the exact published code rather than a duplicate fixture.
3. Pack the three public packages, install them into a temporary consumer, and
   execute each package quickstart against the packed artifacts.
4. Compare every documented Entellix import specifier with the matching
   `publishConfig.exports` entry. Fail on an undocumented internal deep import,
   a documented entry point that is not exported, or an exported entry point
   missing from the public-surface inventory.
5. Add the credential-free documentation verifier to `pnpm check:all`; preserve
   the current package, security, secret, legal, and topology gates.

Deliverables:

- `scripts/verify-public-documentation.mjs`
- root `package.json` verification command
- focused tests for snippet discovery, export-map comparison, and useful
  failures

### Workstream 2: Document the three npm packages

For each of `packages/contracts/README.md`, `packages/core/README.md`, and
`packages/instructions/README.md`:

1. State the Node requirement, ESM expectation, and ordinary pnpm/npm install
   commands.
2. Add one minimal, executable example that demonstrates the package's primary
   role:
   - parse a public runtime input with `@entellix/contracts`;
   - invoke a pure provider-neutral decision or composition function from
     `@entellix/core` without requiring a database or model call;
   - load the active MCP instructions or a client template from
     `@entellix/instructions`.
3. Inventory every supported root and subpath export from the package manifest,
   grouped by purpose, with links to the relevant source or package docs.
4. Add a public-beta compatibility note: documented exports are the supported
   surface, implementation paths are private, and `0.x` consumers should review
   changelogs before upgrading.

Deliverables:

- three independently useful package READMEs included in their npm tarballs
- executable examples verified from a temporary external consumer
- a machine-checked public-export inventory

### Workstream 3: Build the standalone quickstart

Expand `apps/standalone/README.md` in user-journey order:

1. Put an early-public-beta notice and the single-workspace/security boundary
   before the quickstart.
2. Publish a tested prerequisites table for Node, pnpm on the source path,
   PostgreSQL, `psql`, and the required Anthropic account/key.
3. Provide separate setup sequences for:
   - building and starting the packaged server with an isolated PostgreSQL 16
     service through Docker Compose;
   - downloading, verifying, and extracting the versioned GitHub archive; and
   - cloning the repository and installing the locked workspace dependencies.
4. Cover database/user creation, `.env` creation, secure local-token generation,
   Anthropic generation configuration, optional embeddings, and migration. Use
   `psql` for the archive path and the workspace migration command for the source
   path.
5. Cover start/stop behavior, `/healthz`, the authenticated
   `/api/mcp/entellix/mcp` endpoint, one tested MCP client configuration, and a
   first save/process/retrieve round trip.
6. Document bearer-authenticated operator examples for listing/deciding reviews,
   running retention, exporting data, and confirmed workspace deletion. Put the
   irreversible deletion warning before its command.
7. Close with backup/restore expectations, TLS and reverse-proxy guidance,
   database and secret protection, provider data handling, observability limits,
   upgrade guidance, and explicit non-goals for the standalone beta.

Deliverables:

- an archive-first quickstart that also covers contributors
- copy/paste-safe commands using placeholders consistently
- operator and production-security reference sections

### Workstream 4: Prove the quickstart from a clean room

1. Add a standalone smoke runner that accepts an archive path or release URL and
   creates all working files under a temporary directory.
2. In PR CI, use a PostgreSQL service and the locally assembled archive to prove
   extraction, environment loading, SQL migration, startup, health, bearer-token
   rejection/acceptance, and MCP discovery without external provider calls.
3. Verify that the README commands used by that runner still match the packaged
   archive layout, including `.env.example`, `migrations`, `server`, and the
   start command. Include the runner in the archive if the README asks users to
   invoke it.
4. Before release, run the same clean-room flow against the candidate archive
   with real Anthropic credentials, enable embeddings once and leave them
   disabled once, and prove the documented save/process/retrieve round trip.
5. Record the tested OS, Node, PostgreSQL, archive version, model configuration,
   and pass/fail result in the implementation PR. Do not record credentials,
   database contents, or raw provider responses.

Deliverables:

- deterministic standalone documentation smoke coverage in CI
- a repeatable provider-backed release checklist
- evidence that the packaged README, not repository knowledge, is sufficient

### Workstream 5: Integrate, review, and release

1. Keep behavioral changes limited to what the documented path exposes. If the
   clean-room test reveals a missing migration/start/smoke entry point, add the
   smallest public fix with a failing focused test first.
2. Update `scripts/package-standalone.mjs` only as needed to include files that
   the packaged README actually references.
3. Add a Changeset for the three npm README updates and the standalone
   distribution update.
4. Run the focused documentation/package gates during development, then run
   `pnpm check:all` before handoff.
5. Open one focused implementation PR. Include the clean-room evidence,
   screenshots or logs only where they improve review, and a checklist mapped
   to every Phase 2 acceptance criterion.

### Implementation sequence

1. Approve the four decisions above and select the tested PostgreSQL versions
   and MCP client.
2. Land the failing documentation/export checks.
3. Write and verify the package READMEs.
4. Write the standalone quickstart and credential-free artifact smoke path.
5. Run the provider-backed clean-room flow, fix only gaps it exposes, and add
   the Changeset.
6. Run `pnpm check:all` and submit the implementation PR for review.

### Phase 2 acceptance

- A developer unfamiliar with the repository can complete the documented
  standalone archive quickstart without private knowledge or a source checkout.
- Every npm package README shows an ordinary package-manager install and at
  least one working import/use example.
- Every documented package entry point matches the published export map, and
  implementation-only paths are clearly excluded.
- Documented commands and imports that do not require third-party credentials
  are checked in CI from packed artifacts.
- The provider-backed save/process/retrieve flow passes from a clean directory
  by following only the packaged README.
- Review, retention, export, and confirmed deletion examples are authenticated,
  tested, and carry appropriate safety language.
- The repository clearly labels the release as an early public beta rather than
  a turnkey managed service.

### Phase 2 implementation evidence

- The three package READMEs contain executable examples and manifest-checked
  public export inventories. `pnpm release:documentation:verify` runs them from
  packed tarballs in a temporary external consumer.
- The standalone archive now includes an idempotent `npm run migrate` command.
  Artifact assembly preserves the pnpm dependency graph rather than flattening
  symlinked packages and losing transitive runtime dependencies.
- `docker compose up --build --detach --wait` runs that verified archive as a
  non-root container with a private PostgreSQL 16 service and persistent named
  volume. Its automated smoke checks migration, health, and bearer
  authentication, then removes only its uniquely named disposable test volume.
- `pnpm release:standalone:smoke` extracts the archive into a temporary
  directory, runs migrations twice, starts the built server, and verifies
  health, bearer authentication, MCP initialization/tool discovery, operator
  routes, export, and confirmed deletion.
- The credential-free clean-room smoke passed on macOS with Node 24.10.0, a
  PostgreSQL 16 container, and the locally assembled `0.1.1` archive. Pull
  request CI repeats it for PostgreSQL 16, 17, and 18.
- The `--provider-round-trip` release gate passed on 2026-08-19 from the packed
  `0.1.1` archive in a disposable Debian/Node 24.19.0 container against a private
  PostgreSQL 16 test database. It exercised authenticated save, provider-backed
  extraction and classification, review approval, canonical commit, and list
  retrieval with embeddings enabled; the disposable database was removed after
  the run.

## Phase 3: Normalize Public Status and Governance

Status: Complete (2026-08-20)

### Implementation decisions

1. Support only the latest published `0.x` release unless a security advisory
   explicitly names an exception. Treat `main`, older releases, prereleases, and
   canaries as unsupported development or validation states.
2. Allow breaking public-API changes in `0.x` minor releases, while treating
   patch releases as compatible unless security or correctness requires a break.
   Communicate user-visible changes through Changesets, generated changelogs,
   and GitHub release notes.
3. Keep the landing page operational: expose CI, latest-release, and license
   status, then link to support, contribution, security, and ownership details
   without adding promotional sections.
4. Preserve `DigitalSpiritTech/entellix-core` as Entellix's confirmed long-term
   release identity. Any future repository move requires an explicit product-owner
   decision and immediate updates to trusted publishers, repository metadata,
   documentation links, and release verification.

5. Update `SECURITY.md`, release operations, ADRs, and agent context to record
   that `0.1.0` shipped with trusted publishing and provenance.
6. Remove or rewrite first-release blockers that are no longer true.
7. Add concise CI/release/license badges and useful GitHub topics to improve
   public discoverability without turning the README into marketing copy.
8. Add focused issue templates for bugs, documentation gaps, and proposals.
9. State the support policy for the current `0.x` line and how breaking changes
   will be communicated.
10. Confirm the long-term GitHub organization. If ownership moves, reconfigure
    all npm trusted publishers, repository metadata, and release links
    immediately after the move.

### Phase 3 implementation evidence

- `SECURITY.md` and `SUPPORT.md` now describe the shipped early-public-beta
  state, latest-`0.x` support boundary, breaking-change convention, private
  reporting path, and trusted `0.1.0`/attested `0.1.1` release history.
- The root README exposes CI, latest-release, and Apache-2.0 badges and links the
  support, contribution, security, release, and current ownership paths.
- ADR 0002 and `ai/` implementation context record npm OIDC publishing,
  provenance, the corrected single-workflow standalone path, and the repository
  move consequence.
- Focused GitHub issue forms cover bugs, documentation gaps, and proposals;
  blank issues are disabled and security reports route to private advisories.
- The live GitHub repository has focused `ai-agents`, `long-term-memory`, `mcp`,
  `postgresql`, `self-hosted`, `typescript`, and `zod` topics.
- `scripts/public-governance.test.mjs` prevents stale first-release language and
  missing landing-page, support, ADR, or issue-template governance surfaces from
  silently returning.
- The product owner confirmed `DigitalSpiritTech` as Entellix's long-term GitHub
  organization on 2026-08-20; repository ownership and release identity now
  match.

### Phase 3 acceptance

- Public documentation agrees on current release and support status.
- Security reporting and supported-version language are current.
- A visitor can identify the license, stability level, CI state, release path,
  contribution path, and ownership from the repository landing page.
- Repository ownership matches the organization that owns the Entellix product.

## Phase 4: Publish and Prove the Public Beta

Status: In progress (2026-08-20)

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

## Phase 2 Review Checklist

- [x] The supported PostgreSQL range is evidence-based and small enough to test.
- [x] The selected MCP client can authenticate to the standalone streamable HTTP
      endpoint with copy/pasteable public configuration.
- [x] CI coverage is credential-free while the release gate still proves the
      real model-backed memory round trip.
- [x] Export documentation is derived from, and checked against, package
      manifests rather than maintained as an unchecked parallel list.
- [x] Destructive operator examples are clearly separated from the quickstart
      and require explicit confirmation.
- [x] The default local evaluation path isolates PostgreSQL from host databases
      and documents the difference between stopping and deleting its volume.
- [x] The work stays within documentation, verification tooling, and the
      smallest product fixes discovered by the clean-room test.
