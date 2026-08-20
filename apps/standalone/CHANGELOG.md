# @entellix/standalone

## 0.1.2

### Patch Changes

- 29eb888: Constrain classifier entity suggestions to the public registry vocabulary so valid memories do not fail processing on invented entity types.
- 29eb888: Add executable package quickstarts and checked public-export inventories, and
  ship an archive-first standalone guide with an idempotent migration command and
  clean-room PostgreSQL/MCP verification. Add a non-root Docker image and an
  isolated PostgreSQL 16 Compose quickstart for one-command local evaluation.
- 29eb888: Fix authenticated MCP tool execution with Mastra MCP 2.0 by enforcing the
  standalone bearer token at the protected HTTP route boundary.
- Updated dependencies [29eb888]
- Updated dependencies [29eb888]
  - @entellix/contracts@0.1.2
  - @entellix/core@0.1.2
  - @entellix/instructions@0.1.2

## 0.1.1

### Patch Changes

- 79058b9: Build, attest, upload, and verify the standalone archive directly from the
  trusted public release workflow, with a manual tag-based path for repairing
  missing release assets.
- Updated dependencies [57d4340]
  - @entellix/core@0.1.1
  - @entellix/contracts@0.1.1
  - @entellix/instructions@0.1.1

## 0.1.0

### Minor Changes

- 214d1fb: Publish the first Apache-2.0 Entellix open-core packages and standalone
  distribution with compiled consumer exports and durable PostgreSQL-backed
  runtime state.

### Patch Changes

- Updated dependencies [214d1fb]
  - @entellix/contracts@0.1.0
  - @entellix/core@0.1.0
  - @entellix/instructions@0.1.0
