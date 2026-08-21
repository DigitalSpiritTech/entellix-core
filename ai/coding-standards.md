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
- Start every TypeScript source file with a TSDoc block containing a short
  module description, explicit `Inputs:`, `Outputs:`, and `Errors:` statements,
  and `@packageDocumentation`.
- Give every class and documentable function declaration an adjacent TSDoc
  block. This includes methods, call signatures, constructors, accessors, and
  function- or class-valued variables and properties. Use `@param` for each
  input, `@returns` for output, and `@throws` for possible errors; explicitly
  state `Inputs: None.`, `Nothing`, or that no error is intentionally thrown
  when those parts do not apply. Anonymous inline callbacks are documented by
  their owning operation because they cannot own stable API documentation.
- Run `pnpm tsdoc:check` for the focused TSDoc compliance gate. `pnpm check`
  also runs this gate.
