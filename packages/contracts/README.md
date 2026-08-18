# @entellix/contracts

Zod schemas and inferred TypeScript contracts shared by the Entellix memory
engine and its hosts. Runtime schemas are the source of truth for data crossing
package, persistence, process, and public API boundaries.

## Requirements and installation

Use Node.js 24 or newer in an ESM project.

```sh
pnpm add @entellix/contracts
# or
npm install @entellix/contracts
```

## Quickstart

Parse data at the boundary before handing it to an Entellix host or engine.

<!-- verify-example:contracts -->

```js
import { saveMemoryInputSchema } from "@entellix/contracts";

const input = saveMemoryInputSchema.parse({
  text: "Use UTC timestamps in public APIs.",
  provenance: "explicit_request",
});

if (input.scope !== "profile") throw new Error("expected the default profile scope");
console.log(input);
```

## Public exports

Only the following package specifiers are supported public-beta entry points.

<!-- public-exports:start -->

- `@entellix/contracts` — memory, event, entity, and common tool contracts.
- `@entellix/contracts/candidates` — extracted memory-candidate contracts.
- `@entellix/contracts/classification` — classification inputs and results.
- `@entellix/contracts/conflicts` — conflict annotations and relations.
- `@entellix/contracts/core-ports` — persistence-neutral core port data.
- `@entellix/contracts/data-rights` — export, checksum, and data-rights contracts.
- `@entellix/contracts/directive-precedence` — directive ordering contracts.
- `@entellix/contracts/directives` — directive creation and rendering data.
- `@entellix/contracts/packet` — memory packet and context-envelope contracts.
- `@entellix/contracts/pipeline` — intake routing and batch lifecycle contracts.
- `@entellix/contracts/policy-matrix` — policy disposition contracts.
- `@entellix/contracts/reconciler` — canonical-memory reconciliation contracts.
- `@entellix/contracts/retrieval` — retrieval and fusion contracts.
- `@entellix/contracts/reviews` — operator review queue and decision contracts.

<!-- public-exports:end -->

Paths under `src` or `dist`, and any other undeclared deep import, are
implementation details. This package is in public beta on the `0.x` line;
review its changelog before upgrading.

## License

Licensed under Apache-2.0. Entellix names and branding remain subject to the
repository trademark policy.
