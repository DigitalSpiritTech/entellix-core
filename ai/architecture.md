# Architecture

Entellix Core separates pure memory behavior from its hosts.

1. `@entellix/contracts` owns Zod schemas and the types inferred from them.
2. `@entellix/core` depends on contracts and implements deterministic memory
   behavior behind functional ports.
3. `@entellix/instructions` owns versioned MCP guidance and templates.
4. `@entellix/standalone` composes the public packages with Mastra, model
   providers, and PostgreSQL for one self-hosted workspace.

Package dependencies point from the standalone composition toward the public
packages and from core toward contracts. Contracts and instructions remain
independently consumable. Model providers, persistence, identity, and runtime
effects enter through explicit ports at composition boundaries.

The standalone host resolves every request within its single configured
workspace.
