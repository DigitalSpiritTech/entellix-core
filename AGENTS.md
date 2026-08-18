# AGENTS.md

## Required context

Start with `ai/index.md`, then open only the documents needed for the task.

## Repository scope

This repository owns the public Entellix contracts, provider- and
persistence-neutral memory engine, MCP instructions, and single-workspace
standalone host. Keep its packages independently buildable, publishable, and
usable through their documented public exports.

## Working rules

- Keep changes narrow and protect the documented public package surface.
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
