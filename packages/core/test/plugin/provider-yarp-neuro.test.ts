import { describe, expect } from "bun:test"
import { Deferred, Duration, Effect, Ref } from "effect"
import { TestClock } from "effect/testing"
import { HttpClient, HttpClientResponse } from "effect/http"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { ProviderPlugins } from "@opencode/core/plugin/provider"
import { YarpNeuroCatalogFilter, YarpNeuroPlugin } from "@opencode/core/plugin/provider/yarp-neuro"
import { Provider } from "@opencode/core/provider"
import { WellKnown } from "@opencode/core/wellknown"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const providerID = Provider.ID.make("yarp-neuro")
const integrationID = Integration.ID.make("yarp-neuro")

describe("YarpNeuro provider", () => {
  it.effect("keeps only YarpNeuro in the provider catalog while preserving unrelated integrations", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Service
      const integrations = yield* Integration.Service
      const plugin = yield* Plugin.Service
      const host = yield* PluginHost.make(plugin)
      yield* integrations.transform((editor) => {
        editor.update(Integration.ID.make("mcp-test"), (item) => {
          item.name = "MCP test"
          item.metadata = { source: "mcp" }
        })
        editor.update(Integration.ID.make("https://configured.example"), (item) => (item.name = "Configured"))
      })
      yield* providers.transform((editor) => {
        editor.update(Provider.ID.make("yarp-neuro"), (item) => (item.name = "YarpNeuro"))
        editor.update(Provider.ID.make("upstream"), (item) => (item.name = "Upstream"))
        editor.update(Provider.ID.make("custom"), (item) => (item.name = "Custom"))
      })
      yield* YarpNeuroCatalogFilter.effect(host).pipe(
        Effect.provideService(WellKnown.Service, {
          snapshot: () => [
            {
              origin: "https://configured.example",
              integrationID: Integration.ID.make("https://configured.example"),
              manifest: {},
            },
          ],
          entries: () => Effect.succeed([]),
          refresh: () => Effect.succeed(false),
          add: () => Effect.fail(new Error("not needed")),
          remove: () => Effect.void,
          resolve: () => Effect.succeed([]),
          cached: () => Effect.succeed([]),
        }),
      )
      expect((yield* providers.all()).map((item) => item.id)).toEqual([providerID])
      expect(yield* integrations.get(Integration.ID.make("mcp-test"))).toBeDefined()
      expect(yield* integrations.get(Integration.ID.make("https://configured.example"))).toBeDefined()
    }),
  )

  it.effect("loads and refreshes the authorized model list, retaining it on failure", () =>
    Effect.gen(function* () {
      const implementation = ProviderPlugins.find((item) => item.id === "opencode.provider.yarp-neuro")
      expect(implementation).toBeDefined()
      if (!implementation) return

      const credentials = yield* Credential.Service
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      yield* credentials.create({ integrationID, value: Credential.Key.make({ type: "key", key: "virtual-key" }) })

      const requests = yield* Ref.make(0)
      const started = yield* Deferred.make<void>()
      const refreshed = yield* Deferred.make<void>()
      const failed = yield* Deferred.make<void>()
      const seen: Array<{ url: string; headers: Record<string, string> }> = []
      const http = HttpClient.make((request) =>
        Effect.gen(function* () {
          const number = yield* Ref.updateAndGet(requests, (current) => current + 1)
          seen.push({ url: request.url, headers: request.headers })
          if (number === 1) yield* Deferred.succeed(started, undefined)
          if (number === 2) yield* Deferred.succeed(refreshed, undefined)
          if (number === 3) yield* Deferred.succeed(failed, undefined)
          const data = number === 1 ? ["startup-model"] : ["refreshed-model"]
          return HttpClientResponse.fromWeb(
            request,
            number === 3 ? new Response("", { status: 503 }) : Response.json({ data: data.map((id) => ({ id })) }),
          )
        }),
      )
      const plugin = yield* Plugin.Service
      const host = yield* PluginHost.make(plugin)
      yield* YarpNeuroPlugin.effect(host).pipe(Effect.provideService(HttpClient.HttpClient, http))
      yield* Deferred.await(started)
      yield* Effect.yieldNow
      expect(yield* providers.get(providerID)).toMatchObject({ name: "YarpNeuro", integrationID })
      expect(yield* models.get(providerID, Model.ID.make("startup-model"))).toBeDefined()

      yield* TestClock.adjust(Duration.minutes(10))
      yield* Deferred.await(refreshed)
      yield* Effect.yieldNow
      expect(yield* models.get(providerID, Model.ID.make("startup-model"))).toBeUndefined()
      expect(yield* models.get(providerID, Model.ID.make("refreshed-model"))).toBeDefined()

      yield* TestClock.adjust(Duration.minutes(10))
      yield* Deferred.await(failed)
      yield* Effect.yieldNow
      expect(yield* models.get(providerID, Model.ID.make("refreshed-model"))).toBeDefined()
      for (const request of seen) {
        expect(request.url).toBe("https://neuro.tfcp.ru/v1/models")
        expect(request.headers["x-bf-vk"]).toBe("virtual-key")
        expect(request.headers.authorization).toBeUndefined()
      }
    }),
  )
})
