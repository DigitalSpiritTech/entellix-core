# Support Policy

Entellix Core is an early public beta in the `0.x` version line. It is suitable
for evaluation and controlled self-hosted use, but it does not provide a managed
service SLA.

## Supported release

Only the latest published `0.x` release is supported. Fixes are developed on
`main` and normally ship in the next release. Older releases, prereleases, and
canaries are unsupported unless a security advisory explicitly identifies an
exception.

The standalone host supports the Node.js and PostgreSQL versions documented in
its packaged README. A supported package version still requires a supported
runtime and provider configuration.

## Compatibility during `0.x`

Documented package exports are the supported public API. Undeclared deep imports,
source paths, generated `dist` layout, and other implementation details are not
supported contracts.

Breaking public-API changes may ship in a minor release while the project is in
`0.x`. Patch releases are intended to remain compatible, except when a security
or correctness issue makes preserving existing behavior unsafe. Every
user-visible package change requires a Changeset; breaking changes are called out
in the generated changelog and GitHub release notes.

Review Changesets and release notes before upgrading, pin exact versions for
production evaluation, and test the packaged standalone migration and smoke path
against a backup before replacing a running instance.

## Getting help

Use the focused GitHub issue templates for reproducible bugs, documentation
gaps, and scoped proposals. Report security vulnerabilities privately according
to [SECURITY.md](SECURITY.md).
