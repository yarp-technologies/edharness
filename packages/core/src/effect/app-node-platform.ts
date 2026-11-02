import { LLMClient, RequestExecutor } from "@opencode/ai/route"
import { Effect, Layer } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { Socket } from "effect/socket"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { httpClient } from "@opencode/util/effect/app-node-platform"
import { WebSocketConstructor } from "./websocket-constructor.js"

// Bun's fetch ends a request after five quiet minutes, before provider routes' own header and chunk timeouts.
// A virtual key must not be forwarded to an unrelated URL by fetch's automatic redirect handling.
export const yarpNeuroHttpPolicy = (client: HttpClient.HttpClient) =>
  HttpClient.transform(client, (effect, request) =>
    effect.pipe(
      Effect.provideService(FetchHttpClient.RequestInit, {
        timeout: false,
        ...(request.headers["x-bf-vk"] === undefined ? {} : { redirect: "manual" }),
      } as BunFetchRequestInit),
    ),
  )

const withoutBunTimeout = Layer.effect(
  HttpClient.HttpClient,
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    return yarpNeuroHttpPolicy(client)
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
