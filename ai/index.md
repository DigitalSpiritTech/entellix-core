# Entellix Core agent context

This directory is the durable technical context for the public Entellix Core
repository.

The current public baseline is `0.1.2`: npm publication uses trusted publishing
with provenance, and the matching standalone release path produces and verifies
a GitHub-attested archive in the same release workflow. The
[`0.1.2` public-beta closeout](implementation/public-beta-0.1.2.md) records the
registry, release, attestation, public-consumer, and first-run evidence.
`DigitalSpiritTech` is the confirmed long-term GitHub organization and release
identity for Entellix.

- `architecture.md` describes the system and dependency direction.
- `folder-structure.md` records ownership of each top-level directory.
- `coding-standards.md` defines the TypeScript and test conventions.
- `implementation/index.md` lists local verification and release commands.
- `adrs/index.md` indexes durable architectural decisions.
