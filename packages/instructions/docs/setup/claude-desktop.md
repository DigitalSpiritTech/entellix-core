# Entellix setup — Claude Desktop

Claude Desktop has no file Entellix can write to, so this is a **copy-paste**
template: you paste the body into project instructions manually.

## 1. Connect the MCP server

Add the Entellix remote MCP server as a connector in Claude Desktop and
complete the OAuth flow. Use your Entellix workspace's MCP endpoint
(`<ENTELLIX_MCP_URL>`, from the Entellix web app). Tools are served by the
server after authentication.

## 2. Paste the instruction block

Open the project you want the Brain in → **Instructions**, and paste the
`claude-desktop` template body (plain prose, no markers). For a global effect,
paste it into a project you use as your default workspace.

## 3. What to expect

- Before answering, Claude Desktop calls `get_context` with a short summary of
  the current work and uses returned memories as quiet working context.
- After a task — or when you state a preference, decision, or fact — it calls
  `save_memory`.
- Scope is decided server-side by Entellix.

> Claude Desktop is a future remote-MCP packaging surface. Transport, auth,
> tool/prompt support, and this template's live behavior are assumptions until
> validated on the platform — see `docs/verification-checklist.md`.
