# OpenEd Remote Callback URL Implementation Plan

> **For agentic workers:** Implement this plan directly in the current TUI checkout. Keep the existing OAuth attempt mounted while the optional prompt is open.

**Goal:** Let users running EdHarness on a VPS paste the localhost callback URL from a browser on another device.

**Architecture:** Add an OpenEd-only prompt to the TUI's existing OAuth waiting dialog. Validate the pasted URL against the active authorization attempt, then make one GET from the TUI process to the same-host loopback listener; preserve existing polling, callback validation, and token exchange.

**Tech Stack:** TypeScript, SolidJS, OpenTUI, Bun.

**Spec:** `docs/superpowers/specs/2026-11-15-opened-remote-callback-design.md`

## Global Constraints

- The manual input is optional and only appears for OpenEd.
- Accept only the active attempt's exact loopback origin, port, and callback path.
- Require exactly one non-empty `code` and one matching `state` before sending a request.
- The existing callback listener remains authoritative for callback validation and token exchange.
- Never persist, log, or include the callback URL, authorization code, or state in error reporting.
- Preserve the existing uncommitted changes in `packages/tui/src/component/dialog-integration.tsx`.

## Review Focus

- Missing or repeated `code`/`state`: reject before contacting the listener.
- Mismatched `state`: reject before contacting the listener and keep the attempt available for a correct URL.
- Wrong scheme, host, port, or path: reject before contacting the listener.
- Fetch failure or non-success response: show a generic error without echoing the supplied URL.
- Cancelling the prompt: leave the current OAuth attempt and status polling active.

---

### Task 1: Add optional callback entry to the OpenEd waiting dialog

**Files:**
- Modify: `packages/tui/src/component/dialog-integration.tsx`

**Interfaces:**
- Consumes: `IntegrationAttempt.url`, containing the active Loom authorization URL and its `redirect_uri` and `state` parameters.
- Produces: an OpenEd-only “Paste callback URL” action that submits an accepted URL to the active loopback listener.

- [x] Add prompt state inside `OAuthAuto`; keep `OAuthAuto` mounted while displaying `DialogPrompt`, so its poll and cancellation lifecycle stay active.
- [x] Validate the callback URL's protocol, loopback host, port, path, and query cardinality/state against the active authorization URL before making a request.
- [x] Send one GET with redirect-following disabled; on success return to the waiting view, and on failure show generic text that omits URL/code/state.
- [x] Expose the action in the waiting dialog only for OpenEd, preserving the existing open/copy actions and working-tree edits.
- [x] Run `nix develop ../.. --command bun typecheck` from `packages/tui` and inspect the focused diff; do not run or add tests unless requested.
