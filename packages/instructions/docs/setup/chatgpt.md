# Entellix setup — ChatGPT

ChatGPT takes pasted instructions (Project instructions or account-level custom
instructions), so this is a **copy-paste** template. It is kept short to fit
ChatGPT's instruction-length norms.

## 1. Connect the MCP server

Add Entellix as an MCP connector for the ChatGPT project and complete the OAuth
flow. Use your Entellix workspace's MCP endpoint (`<ENTELLIX_MCP_URL>`, from the
Entellix web app). MCP connector availability depends on your ChatGPT plan and
admin/workspace settings.

## 2. Paste the instruction block

- **Per project:** open the project → **Instructions**, and paste the `chatgpt`
  template body.
- **Everywhere:** paste it into **Settings → Personalization → Custom
  instructions** instead.

The body is plain prose with no markers.

## 3. What to expect

- Before answering, ChatGPT calls `get_context` with a short summary of the
  current work and uses returned memories as quiet working context.
- After a task — or when you state a preference, decision, or fact — it calls
  `save_memory`.
- Scope is decided server-side by Entellix.

> ChatGPT is a future custom-app / MCP surface. Plan, admin, and product-surface
> constraints affect whether MCP tools are callable, and this template's live
> behavior is an assumption until validated — see
> `docs/verification-checklist.md`.
