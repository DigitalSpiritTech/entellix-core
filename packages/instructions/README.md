# @entellix/instructions

Versioned, Zod-validated MCP server guidance and per-client instruction
templates shared by Entellix distributions.

## Requirements and installation

Use Node.js 24 or newer in an ESM project.

```sh
pnpm add @entellix/instructions
# or
npm install @entellix/instructions
```

## Quickstart

Load the active MCP guidance and the template for a supported client.

<!-- verify-example:instructions -->

```js
import { getInstructionTemplate } from "@entellix/instructions";
import { ACTIVE_ENTELLIX_SERVER_INSTRUCTIONS } from "@entellix/instructions/mcp";

const template = getInstructionTemplate("codex");
if (template.target !== "AGENTS.md") throw new Error("unexpected Codex target");
if (!ACTIVE_ENTELLIX_SERVER_INSTRUCTIONS.includes("Recall before you act")) {
  throw new Error("active MCP guidance is missing");
}

console.log(template.body);
```

Setup guides for the supported client surfaces and a manual verification
checklist are included in the published package under `docs/`.

## Public exports

<!-- public-exports:start -->

- `@entellix/instructions` — schemas, templates, and MCP guidance.
- `@entellix/instructions/mcp` — active MCP tool descriptions and server instructions.
- `@entellix/instructions/schema` — instruction-template runtime schemas.
- `@entellix/instructions/templates` — versioned client template packs.

<!-- public-exports:end -->

Paths under `src` or `dist`, and any other undeclared deep import, are
implementation details. This package is in public beta on the `0.x` line;
review its changelog before upgrading.

## License

Licensed under Apache-2.0. Entellix names and branding remain subject to the
repository trademark policy.
