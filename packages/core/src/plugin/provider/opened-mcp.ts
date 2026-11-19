import type { Context } from "@opencode/plugin/effect/plugin"
import { McpEvent } from "@opencode/schema/mcp-event"
import { Effect, Stream } from "effect"
import { Bus } from "../../bus.js"
import { Integration } from "../../integration.js"
import { Mcp } from "../../mcp/index.js"
import { openedOrigin } from "../../opened.js"

const server = "opened"
const integrationID = Integration.ID.make(server)
const message = "OpenEd authorization is no longer valid. Reconnect to OpenEd."

export function install(input: { readonly ctx: Context }) {
  let access: string | undefined
  return Effect.gen(function* () {
    yield* input.ctx.mcp.transform((servers) => {
      if (access === undefined) {
        servers.remove(server)
        return
      }
      servers.set(server, {
        type: "remote",
        url: new URL("/api/mcp", openedOrigin()).href,
        headers: { Authorization: `Bearer ${access}` },
        oauth: false,
        protocol: "2026-07-28",
        codemode: false,
      })
    })
    const update = (next: string | undefined) =>
      Effect.sync(() => {
        access = next
      }).pipe(Effect.andThen(input.ctx.mcp.reload()))
    yield* update(undefined)
    return update
  })
}

export function watchUnauthorized(input: {
  readonly ctx: Context
  readonly clear: () => Effect.Effect<void>
  readonly invalidate: () => Effect.Effect<void>
}) {
  return Effect.gen(function* () {
    const bus = yield* Bus.Service
    const mcp = yield* Mcp.Service
    yield* bus.subscribe([McpEvent.StatusChanged]).pipe(
      Stream.filter((event) => event.data.server === server),
      Stream.runForEach(() =>
        Effect.gen(function* () {
          const status = (yield* mcp.servers()).find((entry) => entry.name === server)?.status
          if (status?.status !== "needs_auth") return
          const connection = yield* input.ctx.integration.connection.active(integrationID)
          if (connection)
            yield* input.ctx.integration.connection.status({
              integrationID,
              connection,
              status: { status: "needs_auth", message },
            })
          yield* input.clear()
          yield* input.invalidate()
        }),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
  })
}
