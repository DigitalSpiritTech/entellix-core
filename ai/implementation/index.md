# Implementation

## Local setup

The isolated standalone evaluation path builds the release archive into a
non-root image and starts it with a private PostgreSQL 16 service:

```sh
cp apps/standalone/.env.compose.example apps/standalone/.env.compose
docker compose up --build --detach --wait
```

Set a real Anthropic key and random bearer token in `.env.compose` first. Use
`docker compose down` to preserve the named database volume, or
`docker compose down --volumes` only when intentionally deleting its data.

For source development:

```sh
corepack enable
pnpm install
```

## Verification

- `pnpm check` — typechecks, unit tests, lint, and format check.
- `pnpm build` — builds all packages and the standalone host.
- `pnpm release:packages:verify` — packs and imports all public npm packages as
  an external consumer.
- `pnpm release:documentation:verify` — runs the examples embedded in the three
  package READMEs from packed tarballs and checks their documented exports
  against the publish manifests.
- `pnpm release:standalone:verify` — assembles and inspects the standalone
  tarball in a temporary directory.
- `pnpm release:standalone:compose:smoke` — builds the runtime image, starts an
  isolated Compose project, checks migration/health/authentication, and removes
  its disposable database volume.
- `pnpm check:all` — runs all of the above release gates, including dependency,
  secret, and license checks.

The credential-free standalone clean-room gate needs an explicitly disposable
PostgreSQL database whose name contains `smoke` or `test`:

```sh
ENTELLIX_SMOKE_DATABASE_URL=postgres://.../entellix_smoke \
  pnpm release:standalone:smoke -- \
  --archive artifacts/entellix-standalone-<version>.tgz
```

Add `--provider-round-trip` and supply `ANTHROPIC_API_KEY` for the pre-release
save/process/review/list proof. Optional embedding variables exercise semantic
retrieval during the same run. Never print or record provider credentials.

## Release flow

The `0.1.0` packages established npm trusted publishing and provenance. The
`0.1.1` topology made standalone artifact production a continuation of that same
workflow and added GitHub artifact attestation and release-asset verification.
The `0.1.2` release completed the public-beta readiness plan. Its durable
registry, attestation, clean-room, and CI evidence is recorded in
[`public-beta-0.1.2.md`](public-beta-0.1.2.md).

Add a Changeset for public behavior, merge through a pull request, then merge
the Changesets-generated version pull request. Publishing uses npm trusted
publishing from `DigitalSpiritTech/entellix-core`; no local npm token is needed
or expected. A successful Changesets publish continues in the same trusted
workflow to build, attest, upload, and verify the matching standalone archive.
`scripts/release-publish.mjs` consumes the Changesets 3 structured tag report
and emits the compatibility markers used by `changesets/action@v1`; this keeps
GitHub releases and the standalone continuation tied to the packages actually
tagged by Changesets rather than human-readable CLI output.
To repair an existing release asset, manually run the public release workflow
with its exact `@entellix/standalone@<version>` tag; the workflow checks out that
tag and performs the same artifact and attestation path without publishing npm
packages.
