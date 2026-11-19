# OpenEd MCP Client and Skill Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace EdHarness's OpenEd API skill and generic tool with Loom's authenticated remote MCP server.

**Architecture:** Extend the existing OpenEd OAuth provider to register a remote Streamable HTTP MCP connection from the protected credential at runtime. Keep bearer material in memory, preserve model discovery and LLM access, remove the legacy skill/tool installation path, and keep OpenEd tool activity private in the TUI.

**Tech Stack:** TypeScript, Bun, EdHarness core provider and MCP client, protected credential store, OpenTUI.

**Spec:** `../loom/docs/superpowers/specs/2026-11-18-opened-mcp-design.md`

## Global Constraints

- Build the MCP URL as `<OPENED_URL>/api/mcp`; `OPENED_URL` remains the test/service-origin override.
- Use the active OpenEd access token from protected integration storage as `Authorization: Bearer <token>`.
- Require `llm:use` before registering OpenEd MCP tools; do not persist the token in MCP config, URLs, logs, or tool output.
- Refresh the runtime connection on credential replacement/switch; remove it on disconnect, missing credentials, or authorization failure.
- Preserve OpenEd model discovery and LLM requests.
- Remove the generic `opened_api` tool and the `opened-api` and `opened-init` skills, including installer and packaging references.
- Keep natural-language OpenEd instructions and hide technical OpenEd tool details in the TUI.

## Review Focus

- No saved credential or insufficient `llm:use` must leave no OpenEd MCP tools registered (Task 1).
- Credential replacement, provider switch, disconnect, and revoked-token `401` must update or remove the active connection without retaining stale credentials (Task 1).
- URL joining must handle `OPENED_URL` with and without a trailing slash and always resolve to `/api/mcp` (Task 1).
- The bearer token must not appear in persisted config, status text, logs, history, or tool outputs (Task 1).
- Namespaced MCP tool names such as `opened_<tool>` must retain the existing private, nontechnical display behavior (Task 3).

---

### Task 1: Register and maintain the remote OpenEd MCP connection

**Files:**
- Modify: `packages/core/src/plugin/provider/opened.ts`
- Modify: `packages/core/src/mcp/client.ts`
- Modify: `packages/core/src/mcp/index.ts`
- Test: `packages/core/test/plugin/provider-opened.test.ts`
- Test: `packages/core/test/mcp.test.ts`

**Interfaces:**
- Consumes: existing OpenEd protected OAuth credential, `Credential.Event.Updated` / `Credential.Event.Switched`, `McpEvent.StatusChanged`, `ctx.mcp.transform()`, `ctx.mcp.remove()`, and `ctx.mcp.reload()`.
- Produces: runtime MCP server `opened` at `<OPENED_URL>/api/mcp`, using Streamable HTTP protocol `2026-07-28`, the active bearer header in memory, and no OAuth handshake in the MCP client.

- [ ] **Step 1: Add failing provider lifecycle tests**

Add tests named `registers_opened_mcp_from_active_credential`, `does_not_register_opened_mcp_without_llm_use`, `updates_opened_mcp_when_credential_changes`, `removes_opened_mcp_when_connection_is_cleared`, `removes_opened_mcp_after_unauthorized_response`, `joins_opened_url_with_api_mcp`, and `does_not_persist_or_log_opened_access_token`. Assert the runtime connection has URL `<origin>/api/mcp`, `protocol: "2026-07-28"`, `oauth: false`, and an Authorization header; assert the token is absent from serialized config, logs, and status output.

Add `test_mcp_tool_call_unauthorized_marks_server_needs_auth_and_clears_tools` in `packages/core/test/mcp.test.ts` to prove a stateless HTTP `401`/`403` removes the connected tool catalog and marks the runtime server as needing authorization, without retrying the denied call.

- [ ] **Step 2: Run the focused provider tests and verify the missing behavior**

Run from `packages/core/`: `bun test test/plugin/provider-opened.test.ts`.
Expected: MCP registration, credential lifecycle, and unauthorized-call assertions fail while existing OAuth and model tests remain unchanged.

- [ ] **Step 3: Add runtime registration and cleanup to the OpenEd provider**

In `packages/core/src/mcp/client.ts`, preserve HTTP `401`/`403` as a typed `NeedsAuthError` on remote requests. In `packages/core/src/mcp/index.ts`, stop the affected transport, clear its tools, set `needs_auth`, and publish `McpEvent.StatusChanged` when a tool call returns that error. In `packages/core/src/plugin/provider/opened.ts`, derive the endpoint from `openedOrigin()`, obtain the token and scope from the active protected credential, require `llm:use`, then apply the `opened` remote server with `protocol: "2026-07-28"`, `oauth: false`, and `ctx.mcp.transform()` before reloading discovery. Update the runtime entry after credential update/switch; when the active credential is cleared, remove the entry. Subscribe to the OpenEd MCP status event: on `needs_auth`, mark the OpenEd integration connection `needs_auth` with a reconnect message and remove the runtime server config so its bearer is discarded. Keep existing OAuth persistence, model discovery, and LLM request behavior intact.

- [ ] **Step 4: Run provider tests and core typecheck**

Run from `packages/core/`: `bun test test/plugin/provider-opened.test.ts test/mcp.test.ts` and `bun run typecheck`.
Expected: provider tests and package typecheck pass; no assertion finds token material outside the runtime Authorization header.

### Task 2: Remove legacy OpenEd tool and skills

**Files:**
- Delete: `packages/core/src/tool/plugin/opened-api.ts`
- Delete: `packages/cli/skills/opened-api/`
- Modify: `packages/core/src/plugin/identity.ts`
- Modify: `install`
- Modify: `tests/install-skills.sh`
- Modify: `tests/npm-git-install.sh`
- Modify: `README.md`
- Modify: `packages/cli/skills/README.md`
- Replace: `packages/cli/test/opened-skill.test.ts`
- Modify: `packages/core/test/plugin/provider-opened.test.ts`

**Interfaces:**
- Consumes: remote MCP registration from Task 1.
- Produces: no `opened_api` native tool, no OpenEd skill download or bundled skill, and concise provider/MCP instructions directing the model to named OpenEd MCP tools in the user's language.

- [ ] **Step 1: Replace legacy assertions with failing removal tests**

Update `packages/cli/test/opened-skill.test.ts` to assert the packaged `opened-api` directory is absent and the default installer no longer requests `opened-api` or `opened-init`. Update installer/package shell tests to assert neither folder is downloaded or copied. Update provider identity tests to assert instructions refer to OpenEd MCP tools and do not mention `opened_api`, endpoint paths, JSON schemas, or raw HTTP details.

- [ ] **Step 2: Run the focused CLI and provider tests**

Run from `packages/cli/`: `bun test test/opened-skill.test.ts`; from `packages/core/`: `bun test test/plugin/provider-opened.test.ts`.
Expected: tests fail while the native tool, skill installer entries, or stale identity copy remain.

- [ ] **Step 3: Remove the tool/skill path and retain plain-language guidance**

Remove `OpenedApiTool` registration from `packages/core/src/plugin/provider/opened.ts`; remove the skill names and external OpenEd skill-fetch block from `install`; remove the old skill bundle and its copy/install references; update `README.md`, `packages/cli/skills/README.md`, and `packages/core/src/plugin/identity.ts`. Keep concise instructions to answer in the user's language, use OpenEd MCP tools for explicit OpenEd requests, keep tool activity private, read before editing, write only when requested, and reread after conflicts or uncertain results.

- [ ] **Step 4: Run the removal and packaging checks**

Run from `packages/cli/`: `bun test test/opened-skill.test.ts`; run `tests/install-skills.sh` and the relevant `tests/npm-git-install.sh` case from the repository root.
Expected: no installer/package path downloads, copies, or advertises either retired skill.

### Task 3: Keep OpenEd MCP activity private in the TUI

**Files:**
- Modify: `packages/tui/src/util/tool-display.ts`
- Modify: `packages/tui/src/mini/tool.ts`
- Modify: `packages/tui/src/routes/session/index.tsx`
- Test: `packages/tui/test/util/tool-display.test.ts`
- Test: `packages/tui/test/mini/tool.test.ts`
- Test: `packages/tui/test/session-home.test.tsx`

**Interfaces:**
- Consumes: MCP tool names discovered under remote server name `opened`.
- Produces: namespaced OpenEd tools share the current private account-tool rendering: concise activity label, no arguments or raw output in the visible transcript.

- [ ] **Step 1: Add failing TUI display tests**

Add tests proving `opened_<tool>` names normalize to the private OpenEd display group and tool input/output are hidden in compact and session views. Preserve generic rendering for tools from other remote MCP servers.

- [ ] **Step 2: Run the focused TUI tests and verify the current leak**

Run from `packages/tui/`: `bun test --timeout 30000 test/util/tool-display.test.ts test/mini/tool.test.ts test/session-home.test.tsx`.
Expected: namespaced OpenEd tools currently render as generic remote tools and the new privacy assertions fail.

- [ ] **Step 3: Normalize OpenEd tool names and reuse private rendering**

In `packages/tui/src/util/tool-display.ts`, map the `opened_` namespace to the existing OpenEd private tool group. Update the compact and session render paths to use the same hidden-input/output behavior as the removed `opened_api` tool; leave other MCP providers unchanged.

- [ ] **Step 4: Run TUI tests and the EdHarness verification gate**

Run from `packages/tui/`: `bun test --timeout 30000 test/util/tool-display.test.ts test/mini/tool.test.ts test/session-home.test.tsx`; from the EdHarness repository root: `bun run check`.
Expected: focused TUI tests, lint, and typecheck pass.

### Task 4: Verify the EdHarness-to-Loom flow

**Files:**
- Verify changes from Tasks 1–3.

- [ ] From the EdHarness repository root, run `bash tests/install-skills.sh "$PWD"` and `bash tests/npm-git-install.sh "$PWD"`; verify retired skill names are absent from install logs and the packaged CLI.
- [ ] Run the provider tests, skill removal tests, and TUI display tests listed above.
- [ ] With a local Loom service and `OPENED_URL` pointing to it, connect OpenEd and verify the runtime MCP client lists tools using the protected credential; confirm model discovery and one LLM request still work.
- [ ] Disconnect and reconnect OpenEd; verify tools disappear and return with the new credential, without stale server configuration.
- [ ] Revoke the test key and verify the next MCP request removes the connection and gives a reconnect prompt without exposing the token or raw server diagnostics.
