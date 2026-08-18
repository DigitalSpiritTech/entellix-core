# Entellix Core

Entellix Core is the Apache-2.0 foundation for durable organizational memory in
MCP-capable AI clients. This repository contains the provider-neutral memory
engine, its versioned Zod contracts, reusable MCP instructions, and a
single-workspace self-hosted server.

Each package can be consumed through its documented public exports, while the
standalone server provides a complete single-workspace composition.

Status: early public beta. The standalone host is a self-hosted reference
distribution, not a turnkey managed service; review its prerequisites,
limitations, and production guidance before exposing it outside a trusted
development environment.

## Workspace

- `packages/contracts` — runtime-validated Zod contracts and inferred types.
- `packages/core` — pure memory classification, extraction, reconciliation,
  retrieval, policy, and packet composition.
- `packages/instructions` — versioned MCP guidance and client setup templates.
- `apps/standalone` — a single-workspace Mastra MCP host with PostgreSQL-backed
  durable storage.

## Development

Entellix Core requires Node.js 24 or newer and pnpm 11.9.0.

```sh
corepack enable
pnpm install
pnpm check
pnpm build
```

Run the standalone host with `pnpm dev`. See
[`apps/standalone/README.md`](apps/standalone/README.md) for configuration,
migration, and deployment details.

## Releases

Public package changes require a Changeset. `pnpm check:all` exercises the
source, packed npm packages, standalone distribution, dependency audit, secret
scan, and legal preflight without publishing anything.

Publishing is performed only by the repository release workflow after a
version pull request is merged.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) before proposing changes. Report
vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

Apache-2.0. The Entellix name and visual identity remain subject to
[TRADEMARKS.md](TRADEMARKS.md).
