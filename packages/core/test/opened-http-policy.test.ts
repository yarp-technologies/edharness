import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"
import { openedHttpPolicy } from "@opencode/core/effect/app-node-platform"
import { withEnv } from "./fixture/env"
import { testEffect } from "./lib/effect"

const it = testEffect(FetchHttpClient.layer)

describe("OpenEd HTTP policy", () => {
  it.live("does not forward a bearer token through an LLM redirect", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const received: string[] = []
        const server = Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch(request) {
            const url = new URL(request.url)
            received.push(`${url.pathname}:${request.headers.has("authorization") ? "bearer" : "none"}`)
            return url.pathname === "/v1/redirect"
              ? new Response(null, { status: 302, headers: { location: "/v1/target" } })
              : new Response("ok")
          },
        })
        return { received, server }
      }),
      ({ received, server }) =>
        withEnv({ OPENED_LLM_URL: `${server.url.origin}/v1` }, () =>
          Effect.gen(function* () {
            const client = openedHttpPolicy(yield* HttpClient.HttpClient)
            const url = `${server.url.origin}/v1/redirect`
            const response = yield* client.execute(
              HttpClientRequest.get(url).pipe(HttpClientRequest.bearerToken("test-access-secret")),
            )
            expect(response.status).toBe(302)
            expect(received).toEqual(["/v1/redirect:bearer"])
          }),
        ),
      ({ server }) => Effect.promise(() => server.stop(true)),
    ),
  )
})
