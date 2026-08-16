# Entellix setup — Claude Code

Wire your Entellix Brain into Claude Code so it recalls durable context before
work and captures new context after.

## 1. Connect the MCP server

Add the Entellix remote MCP server and complete the browser OAuth flow:

```sh
claude mcp add --transport http entellix <ENTELLIX_MCP_URL>
```

`<ENTELLIX_MCP_URL>` is your Entellix workspace's MCP endpoint (from the
Entellix web app → Claude Code setup). The first tool call opens a browser to
authorize; tools and prompts are served by the server after OAuth.

## 2. Paste the instruction block

Copy the `claude-code` template body into your project's `CLAUDE.md` (or your
user-level `~/.claude/CLAUDE.md` for all projects). The block is wrapped in the
Entellix managed-block markers:

```md
<!-- entellix:begin -->

...

<!-- entellix:end -->
```

Keep the markers intact — the `entellix init` CLI (S4.1.2) finds them to update
the block in place without disturbing the rest of the file.

## 3. What to expect

- Before a task, Claude Code calls `get_context` with a short summary of the
  current work and uses returned memories as quiet working context.
- After a task — or when you state a preference, decision, or fact — it calls
  `save_memory`.
- Scope (personal / client / project) is decided server-side by Entellix, not
  by Claude Code.

> Claude Code behavior is only considered validated after a real Claude Code
> session confirms these calls — see `docs/verification-checklist.md`.
