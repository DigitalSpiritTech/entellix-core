# AGENTS.md

## Required context

Start with `ai/index.md`, then open only the documents needed for the task.

## Entellix memory

An Entellix Brain is connected over MCP and is the durable memory for work in
this repository.

- At the start of every conversation, and before responding to or acting on
  every new user directive, call `get_context`. Summarize the active task,
  repository, files, named people, tools, decisions, and constraints in
  `taskContext`; use returned memories as quiet working context.
- Attribute recall and capture at this layer to client **Digital Spirit
  Technology** and project **Entellix**. Include
  `Client: Digital Spirit Technology; Project: Entellix` in `taskContext` and
  in the `sessionNote` or `sourceContext` of capture calls. Use organization
  scope for explicit `save_memory` calls at this layer.
- When the user clearly states or changes a durable preference, decision, fact,
  correction, rule, or procedure, call `save_memory` without asking permission.
  For a broader exchange that may contain multiple durable items, call
  `log_context` with the relevant raw exchange instead. Do not submit the same
  context through both tools.
- When a meaningful task is complete, call `save_memory` with a concise summary
  of the durable outcome, including important decisions and changed behavior;
  omit transient execution details.
- Memory processing is asynchronous. A queued receipt confirms intake, not that
  a memory has already been committed. Do not announce retrieval or expose
  memory-review links unless the user asks.

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
- Keep TypeScript modules, classes, and documentable function declarations
  compliant with the TSDoc contract in `ai/coding-standards.md`; run
  `pnpm tsdoc:check` after changing TypeScript source.
- Never commit secrets, customer data, generated release artifacts, or `.env`
  files.
