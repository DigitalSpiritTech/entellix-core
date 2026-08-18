# Folder structure

- `.changeset/` — pending public release intent and Changesets configuration.
- `.github/` — pull-request checks and the trusted package/standalone release workflow.
- `ai/` — durable agent-facing architecture and implementation context.
- `apps/standalone/` — single-workspace reference host and release artifact.
- `packages/contracts/` — public runtime contracts.
- `packages/core/` — public provider- and persistence-neutral engine.
- `packages/instructions/` — public MCP guidance and setup templates.
- `plan/` — temporary active implementation plans; remove a plan after its
  acceptance criteria are complete and preserve durable outcomes in `ai/`.
- `scripts/` — package, artifact, security, and release verification gates.

Keep additions within the public packages, standalone host, release tooling, or
their supporting documentation and tests.
