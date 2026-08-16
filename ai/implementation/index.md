# Implementation

## Local setup

```sh
corepack enable
pnpm install
```

## Verification

- `pnpm check` — typechecks, unit tests, lint, and format check.
- `pnpm build` — builds all packages and the standalone host.
- `pnpm release:packages:verify` — packs and imports all public npm packages as
  an external consumer.
- `pnpm release:standalone:verify` — assembles and inspects the standalone
  tarball in a temporary directory.
- `pnpm check:all` — runs all of the above release gates, including dependency,
  secret, and license checks.

## Release flow

Add a Changeset for public behavior, merge through a pull request, then merge
the Changesets-generated version pull request. Publishing uses npm trusted
publishing from `DigitalSpiritTech/entellix-core`; no local npm token is needed
or expected.
