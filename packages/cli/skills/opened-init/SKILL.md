---
name: opened-init
description: Use when connecting an OpenEd account to EdHarness.
compatibility: Requires EdHarness's native OpenEd connection flow.
---

# Connect OpenEd

Start EdHarness's native **Connect OpenEd** flow and let the user complete authorization on OpenEd.
Do not ask for an API key or try to create, migrate, or store one yourself. If the connection fails
or the authorization is revoked, ask the user to start a new connection in EdHarness.
