# OpenEd callback URL entry in the TUI

## Intent

Let a user finish OpenEd authorization when EdHarness runs on a VPS over SSH and the browser runs on another device. The browser's localhost redirect cannot reach the VPS listener, so the user needs to paste that redirect URL into the waiting TUI.

## Goals and constraints

- Add an optional “Paste callback URL” action to the OpenEd authorization waiting dialog.
- Keep the current automatic localhost callback for local EdHarness runs.
- Validate the pasted URL against the active attempt's redirect URI and state before contacting the listener. The listener remains responsible for the final callback validation and token exchange.
- Do not store, log, or report the callback URL, authorization code, or state.
- Leave other providers' OAuth flows and existing local TUI changes untouched.

## Approaches

- **Chosen — submit to the existing loopback listener.** The prompt accepts the browser's callback URL, checks it against the redirect URI and state in the active authorization URL, then sends one GET to that same URL from the TUI process on the VPS. This fits the user's SSH workflow, reuses the existing one-time listener and avoids a new API surface.
- **Alternative — add a server-side callback handoff API.** This would also support a TUI client running on a different host from its server, but it expands the protocol and attempt lifecycle beyond the confirmed VPS-over-SSH use case.

## Implementation shape

Show a “Paste callback URL” action only for OpenEd while the authorization dialog is waiting. Open a prompt for the full URL. Reject malformed, duplicate, non-loopback, wrong-port/path, or mismatched-state callbacks without sending them. On success, the existing listener completes authorization and the TUI continues its current status polling. If automatic redirect already completed, no manual action is needed.
