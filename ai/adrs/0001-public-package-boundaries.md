# ADR 0001: Public package and standalone boundaries

Status: Accepted

## Decision

`entellix-core` is the source of truth for its versioned contracts, neutral
memory engine, MCP instructions, and single-workspace standalone host.

- `@entellix/contracts` owns runtime schemas and their inferred types.
- `@entellix/core` may depend on contracts and exposes memory behavior through
  provider- and persistence-neutral functions and ports.
- `@entellix/instructions` owns versioned MCP guidance and templates.
- `@entellix/standalone` composes the public packages with concrete runtime,
  provider, and PostgreSQL adapters for one workspace.
- Cross-package consumers use documented public exports rather than source-file
  imports.

## Consequences

Each public package can build, test, pack, and release independently from its
documented inputs. The standalone host proves that the packages compose into a
durable system without adding alternate implementations of core memory
behavior. Cross-package API changes require coordinated versions and consumer
verification.
