# @entellix/core

Provider- and persistence-neutral memory-engine decisions shared by Entellix
hosts. Hosts inject model, persistence, identity, and operational effects
through ports; concrete providers, databases, transports, and deployment
behavior stay in the host.

## Requirements and installation

Use Node.js 24 or newer in an ESM project.

```sh
pnpm add @entellix/core
# or
npm install @entellix/core
```

## Quickstart

Pure decisions can be used without a model provider or database.

<!-- verify-example:core -->

```js
import { decideRoute } from "@entellix/core";

const decision = decideRoute({
  triggers: [],
  noveltyScore: 0.9,
  nearDuplicate: false,
});

if (decision.route !== "batch") throw new Error(`unexpected route: ${decision.route}`);
console.log(decision);
```

## Public exports

The root export is the ordinary starting point. Subpaths let consumers depend
on a narrower capability.

<!-- public-exports:start -->

- `@entellix/core` — the complete supported provider-neutral engine surface.
- `@entellix/core/classifier` — candidate classification orchestration.
- `@entellix/core/conflicts` — conflict detection and operation suggestions.
- `@entellix/core/directive-precedence` — directive resolution and rendering.
- `@entellix/core/directives` — directive creation policy and invariants.
- `@entellix/core/extractor` — memory extraction orchestration.
- `@entellix/core/model-output` — model-output parsing helpers.
- `@entellix/core/packet` — memory packet composition.
- `@entellix/core/ports` — host dependency ports.
- `@entellix/core/policy-matrix` — governed disposition evaluation.
- `@entellix/core/reconciler` — canonical-memory reconciliation.
- `@entellix/core/retrieval` — the complete retrieval surface.
- `@entellix/core/retrieval/config` — versioned retrieval configuration.
- `@entellix/core/retrieval/eval-exclusion` — exclusion evaluation.
- `@entellix/core/retrieval/fusion` — candidate filtering, fusion, and ranking.
- `@entellix/core/retrieval/metrics` — retrieval contribution metrics.
- `@entellix/core/salience` — intake salience detection and routing.

<!-- public-exports:end -->

Paths under `src` or `dist`, and any other undeclared deep import, are
implementation details. This package is in public beta on the `0.x` line;
review its changelog before upgrading.

## License

Licensed under Apache-2.0. Entellix names and branding remain subject to the
repository trademark policy.
