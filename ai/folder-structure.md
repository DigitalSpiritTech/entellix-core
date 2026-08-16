# Folder structure

- `.changeset/` — pending public release intent and Changesets configuration.
- `.github/` — pull-request, release, canary, and standalone artifact workflows.
- `ai/` — durable agent-facing architecture and implementation context.
- `apps/standalone/` — single-workspace reference host and release artifact.
- `packages/contracts/` — public runtime contracts.
- `packages/core/` — public provider- and persistence-neutral engine.
- `packages/instructions/` — public MCP guidance and setup templates.
- `scripts/` — package, artifact, security, and release verification gates.

Do not add hosted SaaS applications or private adapters to this repository.
