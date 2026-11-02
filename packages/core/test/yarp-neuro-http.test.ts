import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"
import { yarpNeuroHttpPolicy } from "@opencode/core/effect/app-node-platform"
import { testEffect } from "./lib/effect"

const it = testEffect(FetchHttpClient.layer)

describe("YarpNeuro HTTP policy", () => {
  it.live("does not forward virtual keys through redirects", () =>
    Effect.gen(function* () {
      const received: string[] = []
      const server = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            hostname: "127.0.0.1",
            port: 0,
            fetch(request) {
              const url = new URL(request.url)
              received.push(`${url.pathname}:${request.headers.get("x-bf-vk") ?? "none"}`)
              return url.pathname === "/redirect"
                ? new Response(null, { status: 302, headers: { location: "/target" } })
                : new Response("ok")
            },
          }),
        ),
        (server) => Effect.promise(() => server.stop(true)),
      )
      const client = yarpNeuroHttpPolicy(yield* HttpClient.HttpClient)
      const url = `http://127.0.0.1:${server.port}/redirect`
      const secure = yield* client.execute(
        HttpClientRequest.get(url).pipe(HttpClientRequest.setHeader("x-bf-vk", "key")),
      )
      expect(secure.status).toBe(302)
      expect(received).toEqual(["/redirect:key"])

      const normal = yield* client.execute(HttpClientRequest.get(url))
      expect(normal.status).toBe(200)
      expect(received).toEqual(["/redirect:key", "/redirect:none", "/target:none"])
    }),
  )
})
