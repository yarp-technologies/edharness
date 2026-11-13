---
name: opened-api
description: Use when an agent needs to read or change an OpenEd account through the Loom API in EdHarness.
compatibility: Requires EdHarness's opened_api tool and an active OpenEd connection.
---

# OpenEd API

Use the Loom API to carry out the user's request within the active OpenEd connection's permissions.
The bearer token acts as its owner and remains subject to resource ownership, granted scopes, and the
owner's current role and account status. For routes, permission names, and product workflows, read
[references/api.md](references/api.md). Managing API keys and administering users are outside this
skill; do not use `/api-keys` or `/admin` routes.

## Authentication

Use the native `opened_api` tool for every authenticated request. It reads the active OAuth
credential from EdHarness's protected integration storage and attaches the bearer header inside the
host. Never request, read, print, copy, or persist the token yourself.

If the tool reports that OpenEd is not connected, ask the user to connect OpenEd in EdHarness and
retry the request. A revoked token requires a new connection; there is no refresh token.

The API root is `https://opened.site/api`. `OPENED_URL` on the EdHarness host overrides the service
origin for local testing; it must be an origin without `/api`. The tool only sends requests to that
configured origin and rejects redirects.

## Make a request

Call the `opened_api` tool with an HTTP method, a path relative to `/api`, and an optional JSON body.
The tool handles authorization; never construct an `Authorization` header yourself.

For example, use `{ "method": "GET", "path": "/roadmaps" }` to list roadmaps. The server checks
the connection's grants and permissions. Use returned or user-provided IDs; do not invent resource
identifiers.

The deployment's OpenAPI contract is at `<service-origin>/api/schema/openapi.json`. Fetch it through
`opened_api` when needed; if it is unavailable, use the bundled reference and report that the
deployed contract could not be verified. If the deployed contract differs from the reference,
follow it within this skill's scope.

For `401`, report an invalid or revoked token or inactive account; for `403`, report the missing
permission or role. Do not attempt to bypass either. For a `409` or uncertain mutation result,
read the current resource or task state before deciding whether another request is appropriate.
