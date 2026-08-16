# ADR 0001: Public core boundary and downstream SaaS

Status: Accepted

## Decision

`entellix-core` is the upstream source of truth for contracts, the neutral
memory engine, MCP instructions, and the single-workspace standalone host.
Hosted Entellix consumes exact released package versions through the package
manager.

Hosted applications, database adapters, tenant lifecycle, authentication,
billing, web UI, managed infrastructure, private evaluations, and customer data
remain in the private SaaS repository.

## Consequences

Core changes reach the SaaS through normal dependency updates. The public
workspace can build, test, pack, and release without access to the private
repository. Cross-boundary changes require a public release before the SaaS
adopts them.
