import { LLMClient, RequestExecutor } from "@opencode/ai/route"
import { Effect, Layer } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { Socket } from "effect/socket"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { httpClient } from "@opencode/util/effect/app-node-platform"
import { WebSocketConstructor } from "./websocket-constructor.js"

// Bun's fetch ends a request after five quiet minutes, before provider routes' own header and chunk timeouts.
// OpenEd's bearer token must not be forwarded to another path by fetch's automatic redirect handling.
export const openedHttpPolicy = (client: HttpClient.HttpClient) =>
  HttpClient.transform(client, (effect, request) =>
    effect.pipe(
      Effect.provideService(FetchHttpClient.RequestInit, {
        timeout: false,
        ...(openedLLMRequest(request.url) ? { redirect: "manual" } : {}),
      } as BunFetchRequestInit),
    ),
  )

function openedLLMRequest(value: string) {
  const endpoint = new URL(process.env.OPENED_LLM_URL?.trim() || "https://llm.opened.site/v1")
  const request = new URL(value)
  const basePath = endpoint.pathname.replace(/\/$/, "")
  return (
    request.origin === endpoint.origin &&
    (request.pathname === basePath || request.pathname.startsWith(`${basePath}/`))
  )
}

const withoutBunTimeout = Layer.effect(
  HttpClient.HttpClient,
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    return openedHttpPolicy(client)
  }),
)

export const requestExecutor = makeGlobalNode({
  service: RequestExecutor.Service,
  layer: RequestExecutor.layer.pipe(Layer.provide(withoutBunTimeout)),
  deps: [httpClient],
})

export const llmClient = makeGlobalNode({ service: LLMClient.Service, layer: LLMClient.layer, deps: [requestExecutor] })

export const webSocketConstructor = makeGlobalNode({
  service: Socket.WebSocketConstructor,
  layer: WebSocketConstructor.layer,
  deps: [],
})

export * as LayerNodePlatform from "./app-node-platform.js"
