# Entellix setup — OpenAI Codex

Wire your Entellix Brain into Codex so it recalls durable context before coding
and captures new context after.

## 1. Connect the MCP server

Add the Entellix remote MCP server to your Codex MCP configuration and complete
the OAuth flow. Point the server entry at your Entellix workspace's MCP
endpoint (`<ENTELLIX_MCP_URL>`, from the Entellix web app). Tools and prompts
are served by the server after authentication.

## 2. Paste the instruction block

Copy the `codex` template body into your project's `AGENTS.md`. Codex discovers
nested `AGENTS.md` files, so a closer file can refine broader guidance. The
block is wrapped in the Entellix managed-block markers:

```md
<!-- entellix:begin -->

...

<!-- entellix:end -->
```

Keep the markers intact — the `entellix init` CLI (S4.1.2) uses them to update
the block in place.

## 3. What to expect

- Before coding, Codex calls `get_context` with a short summary of the current
  work and uses returned memories as quiet working context.
- After a task — or when you state a preference, decision, or fact — it calls
  `save_memory`.
- Scope is decided server-side by Entellix, not by Codex.

> Codex uses `AGENTS.md`, MCP config, and hooks with behavior that differs from
> Claude Code. Treat live behavior as an assumption until confirmed in a real
> Codex session — see `docs/verification-checklist.md`. Codex sessions are a
> proxy example only and do not validate Claude Code behavior.
