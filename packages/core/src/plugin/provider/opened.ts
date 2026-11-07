import type { IntegrationOAuthMethodRegistration } from "@opencode/plugin/effect/integration"
import { define } from "@opencode/plugin/effect/plugin"
import { Deferred, Duration, Effect, Schedule, Schema, Semaphore, Stream } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import type { Server, ServerResponse } from "node:http"
import { Bus } from "../../bus.js"
import { Credential } from "../../credential.js"
import { Integration } from "../../integration.js"
import { IntegrationConnection } from "../../integration/connection.js"
import { Model } from "../../model.js"
import { Provider } from "../../provider.js"
import { configuredOpenedURL, openedOrigin } from "../../opened.js"
import { OpenedApiTool } from "../../tool/plugin/opened-api.js"
import { WellKnown } from "../../wellknown.js"
import type { PluginInternal } from "../internal.js"

const providerID = Provider.ID.make("opened")
const integrationID = Integration.ID.make(providerID)
const methodID = Integration.MethodID.make("opened-browser")
const clientID = "opened-native-agent"
const modelIDPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/
const reservedModelIDs = new Set(["__proto__", "constructor", "prototype"])
const ExchangeRequest = Schema.Struct({
  grant_type: Schema.Literal("authorization_code"),
  client_id: Schema.Literal(clientID),
  code: Schema.String,
  redirect_uri: Schema.String,
  code_verifier: Schema.String,
})
const TokenResponse = Schema.Struct({
  access_token: Schema.String,
  token_type: Schema.Literal("Bearer"),
  scope: Schema.String,
})
const ModelsResponse = Schema.Struct({ data: Schema.Array(Schema.Struct({ id: Schema.String })) })

const oauth = (http: HttpClient.HttpClient) =>
  ({
    integrationID,
    method: {
      id: methodID,
      type: "oauth",
      label: "Connect with Loom",
    },
    authorize: () =>
      Effect.gen(function* () {
        const origin = openedOrigin()
        const pkce = yield* Effect.promise(generatePKCE)
        const state = base64url(crypto.getRandomValues(new Uint8Array(32)))
        const result = yield* Deferred.make<string, Error>()
        const { createServer } = yield* Effect.promise(() => import("node:http"))
        let received = false
        const server = createServer((request, response) => {
          const url = new URL(request.url ?? "/", "http://127.0.0.1")
          if (url.pathname !== "/oauth/callback") {
            response.writeHead(404).end("Not found")
            return
          }
          if (!loopback(request.socket.remoteAddress)) {
            response.writeHead(403).end("Loopback requests only")
            return
          }
          if (received) {
            response.writeHead(409, { Connection: "close" }).end("Authorization attempt already used")
            return
          }
          received = true
          if (server.listening) server.close()
          if (request.method !== "GET") {
            fail(result, response)
            return
          }
          const codes = url.searchParams.getAll("code")
          const states = url.searchParams.getAll("state")
          if (codes.length !== 1 || !codes[0] || states.length !== 1 || states[0] !== state) {
            fail(result, response)
            return
          }
          Effect.runFork(Deferred.succeed(result, codes[0]))
          response
            .writeHead(200, { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" })
            .end("Authorization response received. Return to EdHarness.")
        })
        const port = yield* listen(server)
        yield* Effect.addFinalizer(() => Effect.sync(() => server.listening && server.close()))
        const redirectURI = `http://127.0.0.1:${port}/oauth/callback`
        return {
          mode: "auto" as const,
          url: authorizeURL(origin, redirectURI, state, pkce.challenge),
          instructions: [
            "Approve access in Loom. The key does not expire automatically.",
            "Revoke it in Profile → API keys; disconnecting here only removes the saved key from this device.",
          ].join(" "),
          callback: Deferred.await(result).pipe(
            Effect.flatMap((code) => exchange({ http, origin, code, redirectURI, verifier: pkce.verifier })),
            Effect.flatMap((token) => {
              if (!token.access_token || !hasScope(token.scope, "llm:use"))
                return Effect.fail(
                  new Error("Loom did not grant the required llm:use permission. Start a new attempt."),
                )
              return Effect.succeed(
                Credential.OAuth.make({
                  type: "oauth",
                  methodID,
                  access: token.access_token,
                  refresh: "",
                  expires: 0,
                  metadata: { scope: token.scope },
                }),
              )
            }),
          ),
        }
      }),
    label: (credential) =>
      typeof credential.metadata?.scope === "string" ? `OpenEd · ${credential.metadata.scope}` : "OpenEd",
  }) satisfies IntegrationOAuthMethodRegistration

export const OpenedPlugin = define({
  id: "opencode.provider.opened",
  effect: Effect.fn(function* (ctx) {
    const http = yield* HttpClient.HttpClient
    const bus = yield* Bus.Service
    const llmBaseURL = openedLLMBaseURL()
    const loading = Semaphore.makeUnsafe(1)
    type ActiveConnection = Effect.Success<ReturnType<typeof ctx.integration.connection.active>>
    const loaded: { models: readonly string[]; connection?: ActiveConnection } = { models: [] }

    yield* ctx.integration.transform((integrations) => {
      integrations.update(integrationID, (integration) => (integration.name = "OpenEd"))
      integrations.method.update(oauth(http))
    })
    yield* OpenedApiTool.Plugin.effect(ctx)
    yield* ctx.provider.transform((providers) => {
      providers.update(providerID, (provider) => {
        provider.name = "OpenEd"
        provider.integrationID = integrationID
        provider.package = "@opencode/ai/providers/openai/responses"
        provider.settings = { baseURL: llmBaseURL }
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

    const refresh = Effect.fn("OpenedPlugin.refresh")(function* () {
      const connection = yield* ctx.integration.connection.active(integrationID)
      const credential = connection
        ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.orElseSucceed(() => undefined))
        : undefined
      const scope = credential?.type === "oauth" ? credential.metadata?.scope : undefined
      if (!connection || credential?.type !== "oauth" || typeof scope !== "string" || !hasScope(scope, "llm:use")) {
        if (connection?.type === "credential" && credential?.type === "oauth")
          yield* ctx.integration.connection.status({
            integrationID,
            connection,
            status: { status: "needs_auth", message: "Reconnect OpenEd with the llm:use permission." },
          })
        if (loaded.connection) {
          loaded.models = []
          loaded.connection = undefined
          yield* ctx.provider.reload()
        }
        return
      }

      const response = yield* http
        .execute(
          HttpClientRequest.get(`${llmBaseURL}/models`).pipe(
            HttpClientRequest.acceptJson,
            HttpClientRequest.bearerToken(credential.access),
          ),
        )
        .pipe(
          Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
          Effect.timeout("3 seconds"),
          Effect.catch(() => Effect.succeed(undefined)),
        )
      if (!response) return
      if (response.status === 401 || response.status === 403) {
        yield* ctx.integration.connection.status({
          integrationID,
          connection,
          status: { status: "needs_auth", message: "OpenEd authorization is no longer valid. Reconnect to OpenEd." },
        })
        if (loaded.connection) {
          loaded.models = []
          loaded.connection = undefined
          yield* ctx.provider.reload()
        }
        return
      }
      if (response.status < 200 || response.status >= 300) return

      const next = yield* HttpClientResponse.schemaBodyJson(ModelsResponse)(response).pipe(
        Effect.map((body) => [
          ...new Set(
            body.data.map((item) => item.id).filter((id) => modelIDPattern.test(id) && !reservedModelIDs.has(id)),
          ),
        ]),
        Effect.catch(() => Effect.logWarning("failed to load OpenEd models").pipe(Effect.as(undefined))),
      )
      if (!next) return
      if (
        IntegrationConnection.key(connection) !==
        IntegrationConnection.key(yield* ctx.integration.connection.active(integrationID))
      )
        return
      yield* ctx.integration.connection.status({ integrationID, connection, status: undefined })
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

export const OpenedCatalogFilter = define({
  id: "opencode.provider.opened-catalog",
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

function fail(result: Deferred.Deferred<string, Error>, response: ServerResponse) {
  Effect.runFork(Deferred.fail(result, new Error("OpenEd authorization failed. Start a new attempt.")))
  response
    .writeHead(400, { "Cache-Control": "no-store", "Connection": "close", "Content-Type": "text/plain; charset=utf-8" })
    .end("Authorization failed. Start a new attempt in EdHarness.")
}

function listen(server: Server) {
  return Effect.callback<number, Error>((resume) => {
    const onError = (error: Error) => resume(Effect.fail(error))
    server.once("error", onError)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError)
      const address = server.address()
      if (!address || typeof address === "string") {
        server.close()
        resume(Effect.fail(new Error("Could not start the OpenEd authorization listener")))
        return
      }
      resume(Effect.succeed(address.port))
    })
  })
}

function exchange(input: {
  http: HttpClient.HttpClient
  origin: string
  code: string
  redirectURI: string
  verifier: string
}) {
  return Effect.gen(function* () {
    const request = yield* HttpClientRequest.post(`${input.origin}/api/agent-authorizations/token`).pipe(
      HttpClientRequest.setHeader("Content-Type", "application/json"),
      HttpClientRequest.schemaBodyJson(ExchangeRequest)({
          grant_type: "authorization_code",
          client_id: clientID,
          code: input.code,
          redirect_uri: input.redirectURI,
          code_verifier: input.verifier,
      }),
    )
    const response = yield* input.http.execute(request).pipe(
      Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
      Effect.flatMap(HttpClientResponse.filterStatusOk),
    )
    return yield* HttpClientResponse.schemaBodyJson(TokenResponse)(response)
  }).pipe(Effect.mapError(() => new Error("Loom token exchange failed. Start a new authorization attempt.")))
}

async function generatePKCE() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const challenge = base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))
  return { verifier, challenge }
}

function authorizeURL(origin: string, redirectURI: string, state: string, challenge: string) {
  const url = new URL("/app/agent/authorize", origin)
  url.search = new URLSearchParams({
    client_id: clientID,
    client_name: "EdHarness",
    redirect_uri: redirectURI,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString()
  return url.href
}

function openedLLMBaseURL() {
  return configuredOpenedURL(process.env.OPENED_LLM_URL, "https://llm.opened.site/v1", "OPENED_LLM_URL").href.replace(
    /\/$/,
    "",
  )
}

function hasScope(scope: string, required: string) {
  return scope.trim().split(/\s+/).includes(required)
}

function base64url(value: ArrayBuffer | Uint8Array) {
  return Buffer.from(value instanceof Uint8Array ? value : new Uint8Array(value)).toString("base64url")
}

function loopback(address: string | undefined) {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1"
}
