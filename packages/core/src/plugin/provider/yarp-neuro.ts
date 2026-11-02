import { define } from "@opencode/plugin/effect/plugin"
import { Duration, Effect, Schedule, Schema, Semaphore, Stream } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { Bus } from "../../bus.js"
import { Credential } from "../../credential.js"
import { Integration } from "../../integration.js"
import { IntegrationConnection } from "../../integration/connection.js"
import { Model } from "../../model.js"
import { Provider } from "../../provider.js"
import { WellKnown } from "../../wellknown.js"
import type { PluginInternal } from "../internal.js"

const providerID = Provider.ID.make("yarp-neuro")
const integrationID = Integration.ID.make(providerID)
const baseURL = "https://neuro.tfcp.ru/v1"
const modelIDPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/
const reservedModelIDs = new Set(["__proto__", "constructor", "prototype"])
const ModelsResponse = Schema.Struct({ data: Schema.Array(Schema.Struct({ id: Schema.String })) })

export const YarpNeuroPlugin = define({
  id: "opencode.provider.yarp-neuro",
  effect: Effect.fn(function* (ctx) {
    const http = yield* HttpClient.HttpClient
    const bus = yield* Bus.Service
    const loading = Semaphore.makeUnsafe(1)
    const loaded: {
      models: readonly string[]
      connection?: Effect.Success<ReturnType<typeof ctx.integration.connection.active>>
    } = { models: [] }

    yield* ctx.integration.transform((integrations) => {
      integrations.update(integrationID, (integration) => (integration.name = "YarpNeuro"))
      integrations.method.update({ integrationID, method: { type: "key", label: "API key" } })
    })
    yield* ctx.provider.transform((providers) => {
      providers.update(providerID, (provider) => {
        provider.name = "YarpNeuro"
        provider.integrationID = integrationID
        provider.package = "@opencode/ai/providers/openai/responses"
        provider.settings = { baseURL }
      })
      for (const item of providers.get(providerID)?.models.values() ?? []) {
        if (!loaded.models.includes(item.id)) providers.models.remove(providerID, item.id)
      }
      for (const id of loaded.models) {
        providers.models.update(providerID, id, (model) => {
          model.modelID = Model.ID.make(id)
          model.name = id
          model.capabilities = { tools: true, input: ["text", "image"], output: ["text"] }
          model.status = "active"
          model.enabled = true
        })
      }
      const current = providers.get(providerID)
      if (current && loaded.connection)
        providers.add({
          info: current.provider,
          models: Array.from(current.models.values()),
          sourceConnection: loaded.connection,
        })
    })

    const refresh = Effect.fn("YarpNeuroPlugin.refresh")(function* () {
      const connection = yield* ctx.integration.connection.active(integrationID)
      const credential = connection
        ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.orElseSucceed(() => undefined))
        : undefined
      if (credential?.type !== "key") {
        if (loaded.connection) {
          loaded.models = []
          loaded.connection = undefined
          yield* ctx.provider.reload()
        }
        return
      }
      const next = yield* http
        .execute(
          HttpClientRequest.get(`${baseURL}/models`).pipe(
            HttpClientRequest.acceptJson,
            HttpClientRequest.setHeader("x-bf-vk", credential.key),
          ),
        )
        .pipe(
          Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
          Effect.timeout("3 seconds"),
          Effect.flatMap(HttpClientResponse.filterStatusOk),
          Effect.flatMap(HttpClientResponse.schemaBodyJson(ModelsResponse)),
          Effect.map((response) => [
            ...new Set(
              response.data.map((item) => item.id).filter((id) => modelIDPattern.test(id) && !reservedModelIDs.has(id)),
            ),
          ]),
          Effect.catch((cause) =>
            Effect.logWarning("failed to load YarpNeuro models", { cause }).pipe(Effect.as(undefined)),
          ),
        )
      if (!next) return
      if (
        IntegrationConnection.key(connection) !==
        IntegrationConnection.key(yield* ctx.integration.connection.active(integrationID))
      )
        return
      loaded.models = next
      loaded.connection = connection
      yield* ctx.provider.reload()
    })

    yield* bus.subscribe([Credential.Event.Updated, Credential.Event.Switched]).pipe(
      Stream.runForEach(() => loading.withPermit(refresh())),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* loading
      .withPermit(refresh())
      .pipe(
        Effect.repeat(Schedule.spaced(Duration.minutes(10))),
        Effect.ignore,
        Effect.forkScoped({ startImmediately: true }),
      )
  }),
} satisfies PluginInternal.InternalPlugin)

export const YarpNeuroCatalogFilter = define({
  id: "opencode.provider.yarp-neuro-catalog",
  effect: Effect.fn(function* (ctx) {
    const catalog = yield* Integration.Service
    const wellknown = yield* WellKnown.Service
    yield* catalog.transform((integrations) => {
      const configured = new Set(wellknown.snapshot().map((entry) => entry.integrationID))
      for (const integration of integrations.list())
        if (
          integration.id !== integrationID &&
          integration.metadata?.source !== "mcp" &&
          !configured.has(integration.id)
        )
          integrations.remove(integration.id)
    })
    yield* ctx.provider.transform((providers) => {
      for (const { provider } of providers.list()) if (provider.id !== providerID) providers.remove(provider.id)
    })
  }),
} satisfies PluginInternal.InternalPlugin)
