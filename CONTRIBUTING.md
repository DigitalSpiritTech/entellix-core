# Contributing

Entellix core packages and the standalone distribution are licensed under the
Apache License 2.0. Contributions intentionally submitted for inclusion are
licensed under Apache-2.0 as described by section 5 of the license.

After that gate is resolved, contributions should:

- start from an issue or focused proposal for non-trivial behavior changes;
- preserve the core/SaaS dependency direction and standalone workspace boundary;
- follow the functional TypeScript, Zod-first, Effect, and TDD rules in
  `AGENTS.md` and `ai/coding-standards.md`;
- include a Changeset for user-visible public-package changes; and
- pass `pnpm check:all`, `pnpm release:packages:verify`, and the production
  dependency audit.

No separate contributor license agreement or developer certificate of origin is
currently required.
