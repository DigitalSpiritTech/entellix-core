# Coding standards

- Use strict functional TypeScript and explicit dependency injection.
- Prefer Zod schemas with `z.infer` for data crossing a boundary.
- Prefer unions for state and variants; use derived types for transformations.
- Use interfaces only when an open object contract is genuinely useful.
- Do not declare `type Name = { ... }` object explanations.
- Prefer pure functions and immutable values over classes and mutable state.
- Use Effect for typed errors, resources, concurrency, retries, and composed
  workflows when it improves the contract.
- Write or update a failing focused test before changing product behavior.
- Keep provider, persistence, transport, and host details behind ports.
- Format with Oxfmt and lint with Oxlint.
