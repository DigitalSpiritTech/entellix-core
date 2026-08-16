# AGENTS.md

## Required context

Start with `ai/index.md`, then open only the documents needed for the task.

## Repository boundary

This repository owns the public Entellix contracts, provider- and
persistence-neutral memory engine, MCP instructions, and single-workspace
standalone host. It must not depend on hosted Entellix API, web, database,
authentication, billing, tenant-lifecycle, or private evaluation code.

The dependency direction is one-way: hosted Entellix applications consume
versioned public packages from this repository.

## Working rules

- Keep changes narrow and protect the public/private boundary.
- Use TDD for product behavior and run the focused gate before handoff.
- Prefer functional TypeScript; avoid classes unless a framework requires them.
- Declare types in this order: inferred from Zod with `z.infer`, unions or
  discriminated unions, derived utility types, then interfaces.
- Never declare a bare object-shape type alias.
- Use Effect when typed failures, resource safety, retries, or composition make
  the behavior clearer; do not wrap simple pure functions without benefit.
- Add a Changeset for user-visible package or standalone changes.
- Never commit secrets, customer data, generated release artifacts, or `.env`
  files.
