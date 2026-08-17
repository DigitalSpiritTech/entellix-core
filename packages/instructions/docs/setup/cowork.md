# Entellix setup — Claude Cowork

Cowork Projects take pasted instructions, so this is a **copy-paste** template.
The Brain acts as shared memory for the project.

## 1. Connect the MCP server

Add the Entellix remote MCP server to the Cowork project and complete the OAuth
flow. Use your Entellix workspace's MCP endpoint (`<ENTELLIX_MCP_URL>`, from the
Entellix web app). Tools are served by the server after authentication.

## 2. Paste the instruction block

Open the Cowork project → **Instructions**, and paste the `cowork` template body
(plain prose, no markers).

## 3. What to expect

- Before starting or responding, Cowork calls `get_context` with a short summary
  of the current work and uses returned memories as quiet working context.
- After a task — or when a teammate states a preference, decision, or fact — it
  calls `save_memory` so the shared Brain keeps it.
- Scope is decided server-side by Entellix.

> Cowork is a future workflow surface. Hooks are treated as plugin-supported,
> but GUI setup and this template's live behavior still require validation —
> see `docs/verification-checklist.md`.
