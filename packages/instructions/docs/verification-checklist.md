# Instruction-tier live verification checklist

Manual, human-run checklist (Ted) to confirm each per-client instruction
template actually drives Entellix recall/log behavior on the live platform.
A template is only considered validated for a surface after the steps below
pass in a real session on that surface. Evidence from one client is a proxy
example only and never validates another client.

## Per-client procedure

Run this for each client: `claude-code`, `codex`, `claude-desktop`, `cowork`,
`chatgpt`.

1. **Connect MCP.** Add the Entellix remote MCP server and complete OAuth using
   the client's setup guide in `docs/setup/<client>.md`. Confirm the Entellix
   tools (`get_context`, `save_memory`, …) are listed/available.
2. **Install the block.**
   - Managed-block clients (`claude-code`, `codex`): insert the template body
     into `CLAUDE.md` / `AGENTS.md` between the `<!-- entellix:begin -->` and
     `<!-- entellix:end -->` markers.
     Confirm the markers are present and the block is inside them.
   - Copy-paste clients (`claude-desktop`, `cowork`, `chatgpt`): paste the body
     into the project / custom instructions field per the setup guide.
3. **Run the scenario suite** (the 3.2.2-style scenarios) in a fresh session:
   - **Recall-before:** start a task that depends on saved context. Confirm the
     client calls `get_context` before doing the work and uses returned
     memories quietly (no announced retrieval).
   - **Log-after:** finish a task and, separately, state a preference / decision
     / fact. Confirm the client calls `save_memory` after each.
   - **Never-decide-scope:** confirm the client does not pre-label scope
     (personal / client / project) — it passes raw context and lets Entellix
     classify.
   - **Session-end summary:** end the session and confirm the client writes a
     short summary and saves it with `save_memory`.
4. **Observe the calls.** Verify each `get_context` / `save_memory` call in the
   session tool log (and, where possible, that the memory appears in the
   Entellix web app for the expected owner/scope).
5. **Record the result** in the sign-off table with the exact platform build /
   version tested and the date.

## Sign-off table

| Client         | Connected + tools listed | Block installed | Recall-before | Log-after | Never-decide-scope | Session-end summary | Platform build / version | Date | Result |
| -------------- | ------------------------ | --------------- | ------------- | --------- | ------------------ | ------------------- | ------------------------ | ---- | ------ |
| claude-code    |                          |                 |               |           |                    |                     |                          |      |        |
| codex          |                          |                 |               |           |                    |                     |                          |      |        |
| claude-desktop |                          |                 |               |           |                    |                     |                          |      |        |
| cowork         |                          |                 |               |           |                    |                     |                          |      |        |
| chatgpt        |                          |                 |               |           |                    |                     |                          |      |        |

## Notes

- Until a row passes end-to-end, treat that client's template as an assumption,
  not validated behavior. Document any gated or unclear behavior (auth,
  transport, tool support, instruction-length truncation) as an open question
  next to the row.
- Re-run the affected rows whenever the template pack version changes (see
  `TEMPLATE_PACK_VERSIONS` in `src/templates.ts`).
