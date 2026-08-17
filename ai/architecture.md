# Architecture

Entellix Core separates pure memory behavior from its hosts.

1. `@entellix/contracts` owns Zod schemas and the types inferred from them.
2. `@entellix/core` depends on contracts and implements deterministic memory
   behavior behind functional ports.
3. `@entellix/instructions` owns versioned MCP guidance and templates.
4. `@entellix/standalone` composes the public packages with Mastra, model
   providers, and PostgreSQL for one self-hosted workspace.

The hosted Entellix SaaS is a downstream consumer. SaaS-only authentication,
tenant resolution, row-level security, billing, UI, and managed infrastructure
do not flow back into the public packages.

Organization-aware memory contracts are domain concepts, not a hosted tenant
implementation. The standalone host resolves all requests within its single
configured workspace and has no tenant provisioning or cross-workspace path.
