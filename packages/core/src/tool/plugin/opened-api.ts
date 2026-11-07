export * as OpenedApiTool from "./opened-api.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { ToolFailure } from "@opencode/ai/effect"
import { Duration, Effect, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"
import { Integration } from "../../integration.js"
import { openedOrigin } from "../../opened.js"
import { Permission } from "../../permission.js"
import { collectBoundedResponseBody } from "../http-body.js"

export const name = "opened_api"

export const Input = Schema.Struct({
  method: Schema.Literals(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]),
  path: Schema.String,
  body: Schema.optionalKey(Schema.Unknown),
})

const Output = Schema.Struct({
  status: Schema.Number,
  contentType: Schema.String,
  body: Schema.String,
})

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024

export const Plugin = {
  id: "opencode.tool.opened-api",
  effect: Effect.fn("OpenedApiTool.Plugin")(function* (ctx: Context) {
    const http = yield* HttpClient.HttpClient
    const integrations = yield* Integration.Service
    const permission = yield* Permission.Service

    yield* ctx.tool.transform((editor) =>
      editor.add({
        name,
        options: { codemode: false },
        description: `Call the authenticated OpenEd API using the active EdHarness OpenEd connection. Paths are relative to /api. The saved bearer token is attached inside the harness and is never returned to the model.`,
        input: Input,
        output: Output,
        execute: (input, context) =>
          Effect.gen(function* () {
            const target = yield* Effect.try({
              try: () => apiURL(input.path),
              catch: () => new ToolFailure({ message: "Invalid OpenEd API path" }),
            })

            if ((input.method === "GET" || input.method === "HEAD") && input.body !== undefined)
              return yield* new ToolFailure({ message: "GET and HEAD OpenEd API requests cannot include a body" })

            yield* permission.assert({
              action: name,
              resources: [`${input.method} ${target.href}`],
              save: ["*"],
              metadata: { method: input.method, path: target.pathname + target.search },
              sessionID: context.sessionID,
              agent: context.agent,
              source: { type: "tool", messageID: context.messageID, id: context.id },
            }).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message })))

            const connection = yield* integrations.connection.active(Integration.ID.make("opened"))
            const credential = connection
              ? yield* integrations.connection.resolve(connection).pipe(
                  Effect.mapError(
                    () =>
                      new ToolFailure({
                        message: "Could not read the saved OpenEd connection. Reconnect OpenEd in EdHarness.",
                      }),
                  ),
                )
              : undefined
            const scope = credential?.type === "oauth" ? credential.metadata?.scope : undefined
            if (credential?.type !== "oauth" || typeof scope !== "string" || !scope.split(/\s+/).includes("llm:use"))
              return yield* new ToolFailure({
                message: "Connect OpenEd in EdHarness with the required API permissions before using this skill.",
              })

            let request = HttpClientRequest.make(input.method)(target).pipe(
              HttpClientRequest.bearerToken(credential.access),
            )
            if (input.body !== undefined)
              request = yield* HttpClientRequest.bodyJson(input.body)(request).pipe(
                Effect.mapError(() => new ToolFailure({ message: "OpenEd API request body is not valid JSON" })),
              )

            const result = yield* Effect.gen(function* () {
              const response = yield* http.execute(request).pipe(
                Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
              )
              const body = yield* collectBoundedResponseBody(
                response,
                MAX_RESPONSE_BYTES,
                () => new Error("OpenEd API response exceeds the 8 MiB limit"),
              ).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message })))
              return {
                status: response.status,
                contentType: response.headers["content-type"] ?? "",
                body: new TextDecoder().decode(body),
              }
            }).pipe(
              Effect.timeoutOrElse({
                duration: Duration.minutes(2),
                orElse: () => Effect.fail(new ToolFailure({ message: "OpenEd API request timed out" })),
              }),
              Effect.mapError((error) =>
                error instanceof ToolFailure ? error : new ToolFailure({ message: "OpenEd API request failed" }),
              ),
            )
            return { output: result, content: result.body, metadata: { status: result.status } }
          }),
      }),
    )
  }),
}

function apiURL(path: string) {
  const pathname = path.split("?", 1)[0] ?? ""
  if (
    !pathname.startsWith("/") ||
    pathname.startsWith("//") ||
    pathname.includes("%") ||
    path.includes("#") ||
    pathname.includes("\\") ||
    pathname.includes("//") ||
    pathname.split("/").some((part) => part === "." || part === "..")
  )
    throw new Error("Invalid OpenEd API path")

  const origin = openedOrigin()
  const url = new URL(path.slice(1), `${origin}/api/`)
  const resource = url.pathname.slice("/api/".length).split("/", 1)[0]
  if (url.origin !== origin || !url.pathname.startsWith("/api/") || !resource || resource === "api-keys" || resource === "admin")
    throw new Error("Invalid OpenEd API path")
  return url
}
