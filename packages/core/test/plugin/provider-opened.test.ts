import { describe, expect } from "bun:test"
import { Deferred, Duration, Effect, Schedule, Schema } from "effect"
import { TestClock, TestConsole } from "effect/testing"
import { Credential } from "@opencode/core/credential"
import { Agent } from "@opencode/core/agent"
import { Integration } from "@opencode/core/integration"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { Session } from "@opencode/core/session"
import { SessionMessage } from "@opencode/core/session/message"
import { Tool } from "@opencode/core/tool"
import { OpenedCatalogFilter, OpenedPlugin } from "@opencode/core/plugin/provider/opened"
import { ProviderPlugins } from "@opencode/core/plugin/provider"
import { Provider } from "@opencode/core/provider"
import { WellKnown } from "@opencode/core/wellknown"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const providerID = Provider.ID.make("opened")
const integrationID = Integration.ID.make("opened")
const methodID = Integration.MethodID.make("opened-browser")
const ExchangeBody = Schema.Struct({
  grant_type: Schema.String,
  client_id: Schema.String,
  code: Schema.String,
  redirect_uri: Schema.String,
  code_verifier: Schema.String,
})
type Exchange = typeof ExchangeBody.Type

type Remote = {
  exchanges: Array<{ url: string; headers: Record<string, string>; body: Exchange }>
  modelRequests: Array<{ url: string; headers: Record<string, string> }>
  apiRequests: Array<{ url: string; method: string; headers: Record<string, string> }>
  token: { access_token: string; token_type: string; scope: string }
  exchangeStatus: number
  modelIDs: string[]
  onModels?: () => void
}

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* OpenedPlugin.effect(host)
  return host
})

const status = Effect.fn(function* (attempt: Integration.Attempt) {
  const integrations = yield* Integration.Service
  return yield* integrations.oauth
    .status({ integrationID, attemptID: attempt.attemptID })
    .pipe(
      Effect.repeat({ until: (value) => value.status !== "pending", schedule: Schedule.spaced("10 millis") }),
      Effect.timeout("3 seconds"),
    )
})

const remote = (): Remote => ({
  exchanges: [],
  modelRequests: [],
  apiRequests: [],
  token: { access_token: "test-opened-access-secret", token_type: "Bearer", scope: "llm:use roadmaps:read" },
  exchangeStatus: 200,
  modelIDs: ["configured-by-loom"],
})

function openedServer(state: Remote) {
  return Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          const url = new URL(request.url)
          const headers = Object.fromEntries(request.headers.entries())
          if (url.pathname === "/api/agent-authorizations/token" && request.method === "POST") {
            state.exchanges.push({
              url: request.url,
              headers,
              body: Schema.decodeUnknownSync(ExchangeBody)(await request.json()),
            })
            return Response.json(state.token, { status: state.exchangeStatus })
          }
          if (url.pathname === "/v1/models" && request.method === "GET") {
            state.modelRequests.push({ url: request.url, headers })
            state.onModels?.()
            return Response.json({ data: state.modelIDs.map((id) => ({ id })) })
          }
          if (url.pathname === "/api/roadmaps" && request.method === "GET") {
            state.apiRequests.push({ url: request.url, method: request.method, headers })
            return Response.json([{ id: "roadmap-from-opened" }])
          }
          return new Response("Not found", { status: 404 })
        },
      }),
    ),
    (server) => Effect.promise(() => server.stop(true)),
  )
}

function withEnvironment<A, E, R>(variables: Record<string, string | undefined>, effect: Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = Object.fromEntries(Object.keys(variables).map((key) => [key, process.env[key]]))
      for (const [key, value] of Object.entries(variables)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      return previous
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }
      }),
  )
}

function callbackURL(attempt: Integration.Attempt) {
  const redirectURI = new URL(attempt.url).searchParams.get("redirect_uri")
  if (!redirectURI) throw new Error("Expected the authorization URL to contain redirect_uri")
  return new URL(redirectURI)
}

function openedAPICall(snapshot: Tool.Snapshot, path: string, id: string) {
  return snapshot.execute({
    sessionID: Session.ID.make("ses_opened_api"),
    agent: Agent.ID.make("build"),
    messageID: SessionMessage.ID.make("msg_opened_api"),
    call: { type: "tool-call", id, name: "opened_api", input: { method: "GET", path } },
  })
}

describe("OpenEd provider", () => {
  it.effect("registers the authenticated OpenEd API tool for the bundled skill", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const tools = yield* Tool.Service
      expect((yield* tools.list()).some((tool) => tool.name === "opened_api")).toBe(true)
    }),
  )

  it.effect("registers OpenEd and keeps it as the only model provider", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Service
      const integrations = yield* Integration.Service
      const host = yield* addPlugin()
      yield* integrations.transform((editor) => {
        editor.update(Integration.ID.make("mcp-test"), (item) => {
          item.name = "MCP test"
          item.metadata = { source: "mcp" }
        })
        editor.update(Integration.ID.make("https://configured.example"), (item) => (item.name = "Configured"))
      })
      yield* providers.transform((editor) => {
        editor.update(Provider.ID.make("upstream"), (item) => (item.name = "Upstream"))
        editor.update(Provider.ID.make("custom"), (item) => (item.name = "Custom"))
      })
      yield* OpenedCatalogFilter.effect(host).pipe(
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

      expect(ProviderPlugins.map((item) => item.id)).toContain("opencode.provider.opened")
      expect((yield* providers.all()).map((item) => item.id)).toEqual([providerID])
      expect(yield* integrations.get(Integration.ID.make("mcp-test"))).toBeDefined()
      expect(yield* integrations.get(Integration.ID.make("https://configured.example"))).toBeDefined()
      expect(yield* integrations.get(integrationID)).toMatchObject({
        name: "OpenEd",
        methods: [{ id: methodID, type: "oauth", label: "Connect with Loom" }],
      })
    }),
  )

  it.effect("requires an active OpenEd authorization and blocks administrative API routes", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const tools = yield* Tool.Service
      const snapshot = yield* tools.snapshot()
      const missing = yield* openedAPICall(snapshot, "/roadmaps", "call_opened_api_missing").pipe(Effect.flip)
      expect(missing.message).toContain("Connect OpenEd in EdHarness")
      const restricted = yield* openedAPICall(snapshot, "/admin/users", "call_opened_api_admin").pipe(Effect.flip)
      expect(restricted.message).toBe("Invalid OpenEd API path")
    }),
  )

  it.live("authorizes with Loom, exchanges once, shows scope, and supports disconnect and reconnect", () =>
    Effect.gen(function* () {
      const state = remote()
      const server = yield* openedServer(state)
      const modelLoaded = yield* Deferred.make<void>()
      state.onModels = () => Effect.runFork(Deferred.succeed(modelLoaded, undefined))
      yield* withEnvironment(
        { OPENED_URL: server.url.origin, OPENED_LLM_URL: `${server.url.origin}/v1` },
        Effect.gen(function* () {
          yield* addPlugin()
          const integrations = yield* Integration.Service
          const credentials = yield* Credential.Service
          const models = yield* Model.Service
          const attempt = yield* integrations.oauth.connect({ integrationID, methodID })
          const authorization = new URL(attempt.url)
          const redirectURI = authorization.searchParams.get("redirect_uri")
          const flowState = authorization.searchParams.get("state")
          if (!redirectURI || !flowState) throw new Error("Expected a loopback redirect and state")

          expect(authorization.origin).toBe(server.url.origin)
          expect(authorization.pathname).toBe("/app/agent/authorize")
          expect(authorization.searchParams.get("client_id")).toBe("opened-native-agent")
          expect(authorization.searchParams.get("client_name")).toBe("EdHarness")
          expect(authorization.searchParams.get("code_challenge_method")).toBe("S256")
          expect(authorization.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/)
          expect(flowState).toMatch(/^[A-Za-z0-9_-]{43}$/)
          expect(attempt.url).toContain(`redirect_uri=${encodeURIComponent(redirectURI)}`)
          expect(attempt.url).not.toContain("code_verifier")
          expect(redirectURI).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/)
          expect(attempt.instructions).toContain("Profile → API keys")
          expect(attempt.instructions).toContain("only removes the saved key")

          const callback = new URL(redirectURI)
          callback.searchParams.set("code", "single-use-test-code")
          callback.searchParams.set("state", flowState)
          const callbackResponse = yield* Effect.promise(() => fetch(callback, { headers: { Connection: "close" } }))
          expect(callbackResponse.status).toBe(200)
          expect(yield* Effect.promise(() => callbackResponse.text())).toContain("Return to EdHarness")
          expect(yield* status(attempt)).toMatchObject({ status: "complete" })
          expect(state.exchanges).toHaveLength(1)

          const exchange = state.exchanges[0]
          if (!exchange) throw new Error("Expected one token exchange")
          expect(exchange.url).toBe(`${server.url.origin}/api/agent-authorizations/token`)
          expect(exchange.headers["content-type"]).toBe("application/json")
          expect(exchange.headers.cookie).toBeUndefined()
          expect(Object.keys(exchange.body).toSorted()).toEqual(
            ["grant_type", "client_id", "code", "redirect_uri", "code_verifier"].toSorted(),
          )
          expect(exchange.body).toMatchObject({
            grant_type: "authorization_code",
            client_id: "opened-native-agent",
            code: "single-use-test-code",
            redirect_uri: redirectURI,
          })
          expect(Buffer.from(exchange.body.code_verifier, "base64url")).toHaveLength(32)
          const challenge = Buffer.from(
            yield* Effect.promise(() =>
              crypto.subtle.digest("SHA-256", new TextEncoder().encode(exchange.body.code_verifier)),
            ),
          ).toString("base64url")
          expect(authorization.searchParams.get("code_challenge")).toBe(challenge)

          const saved = (yield* credentials.list(integrationID))[0]
          if (!saved || saved.value.type !== "oauth") throw new Error("Expected a saved Loom credential")
          expect(saved.value).toMatchObject({ access: state.token.access_token, refresh: "", expires: 0 })
          expect(saved.value.metadata).toEqual({ scope: "llm:use roadmaps:read" })
          const exposed = yield* integrations.get(integrationID)
          expect(exposed?.connections[0]).toMatchObject({
            method: "oauth",
            label: "OpenEd · llm:use roadmaps:read",
          })
          expect(JSON.stringify(exposed)).not.toContain(state.token.access_token)

          yield* Deferred.await(modelLoaded).pipe(Effect.timeout("3 seconds"), Effect.ignore)
          expect(state.modelRequests.length).toBeGreaterThan(0)
          expect(state.modelRequests[0]?.url).toBe(`${server.url.origin}/v1/models`)
          expect(state.modelRequests[0]?.headers.authorization).toBe(`Bearer ${state.token.access_token}`)
          const discoveredModel = yield* Effect.gen(function* () {
            return yield* models.get(providerID, Model.ID.make("configured-by-loom"))
          }).pipe(
            Effect.repeat({ until: (model) => model !== undefined, schedule: Schedule.spaced("10 millis") }),
            Effect.timeout("3 seconds"),
          )
          expect(discoveredModel).toBeDefined()

          const toolService = yield* Tool.Service
          const toolSnapshot = yield* toolService.snapshot()
          const apiResult = yield* openedAPICall(toolSnapshot, "/roadmaps", "call_opened_api")
          expect(apiResult.output).toEqual({
            status: 200,
            contentType: "application/json;charset=utf-8",
            body: '[{"id":"roadmap-from-opened"}]',
          })
          expect(state.apiRequests).toHaveLength(1)
          expect(state.apiRequests[0]).toMatchObject({
            url: `${server.url.origin}/api/roadmaps`,
            method: "GET",
            headers: { authorization: `Bearer ${state.token.access_token}` },
          })
          expect(JSON.stringify(apiResult)).not.toContain(state.token.access_token)
          const callbackClosed = yield* Effect.promise(() =>
            fetch(callback, { headers: { Connection: "close" } })
              .then(() => false)
              .catch(() => true),
          )
          expect(callbackClosed).toBe(true)

          const output = JSON.stringify([yield* TestConsole.logLines, yield* TestConsole.errorLines])
          for (const secret of [
            state.token.access_token,
            flowState,
            redirectURI,
            exchange.body.code,
            exchange.body.code_verifier,
          ])
            expect(output).not.toContain(secret)

          yield* integrations.connection.remove(saved.id)
          expect(yield* credentials.list(integrationID)).toHaveLength(0)
          expect((yield* integrations.get(integrationID))?.connections).toEqual([])
          const reconnect = yield* integrations.oauth.connect({ integrationID, methodID })
          expect(new URL(reconnect.url).searchParams.get("state")).not.toBe(flowState)
          yield* integrations.oauth.cancel({ integrationID, attemptID: reconnect.attemptID })
        }),
      )
    }),
  )

  it.live("rejects wrong, missing, and repeated callback parameters without exchanging a code", () =>
    Effect.gen(function* () {
      const state = remote()
      const server = yield* openedServer(state)
      yield* withEnvironment(
        { OPENED_URL: server.url.origin, OPENED_LLM_URL: `${server.url.origin}/v1` },
        Effect.gen(function* () {
          yield* addPlugin()
          const integrations = yield* Integration.Service
          const cases = [
            { name: "wrong state", code: "present", states: ["wrong"] },
            { name: "missing code", code: undefined, states: ["valid"] },
            { name: "repeated code", code: "present", extraCodes: ["duplicate"], states: ["valid"] },
            { name: "missing state", code: "present", states: [] },
            { name: "repeated state", code: "present", states: ["valid", "duplicate"] },
          ]
          for (const item of cases) {
            const attempt = yield* integrations.oauth.connect({ integrationID, methodID })
            const authorization = new URL(attempt.url)
            const expectedState = authorization.searchParams.get("state")
            if (!expectedState) throw new Error("Expected state in authorization URL")
            const callback = callbackURL(attempt)
            if (item.code) callback.searchParams.set("code", item.code)
            for (const code of item.extraCodes ?? []) callback.searchParams.append("code", code)
            for (const value of item.states)
              callback.searchParams.append("state", value === "valid" ? expectedState : value)
            const response = yield* Effect.promise(() => fetch(callback, { headers: { Connection: "close" } }))
            expect(response.status, item.name).toBe(400)
            expect(yield* status(attempt), item.name).toMatchObject({ status: "failed" })
          }
          expect(state.exchanges).toHaveLength(0)
        }),
      )
    }),
  )

  it.live("does not retry an uncertain one-time-code exchange or save a rejected token", () =>
    Effect.gen(function* () {
      const state = remote()
      state.exchangeStatus = 500
      const server = yield* openedServer(state)
      yield* withEnvironment(
        { OPENED_URL: server.url.origin, OPENED_LLM_URL: `${server.url.origin}/v1` },
        Effect.gen(function* () {
          yield* addPlugin()
          const integrations = yield* Integration.Service
          const credentials = yield* Credential.Service
          const attempt = yield* integrations.oauth.connect({ integrationID, methodID })
          const authorization = new URL(attempt.url)
          const flowState = authorization.searchParams.get("state")
          if (!flowState) throw new Error("Expected state in authorization URL")
          const callback = callbackURL(attempt)
          callback.searchParams.set("code", "single-use-test-code")
          callback.searchParams.set("state", flowState)
          expect((yield* Effect.promise(() => fetch(callback, { headers: { Connection: "close" } }))).status).toBe(200)
          expect(yield* status(attempt)).toMatchObject({ status: "failed" })
          expect(state.exchanges).toHaveLength(1)
          expect(yield* credentials.list(integrationID)).toHaveLength(0)
        }),
      )
    }),
  )

  it.live("closes the loopback listener when the attempt is cancelled", () =>
    Effect.gen(function* () {
      const state = remote()
      const server = yield* openedServer(state)
      yield* withEnvironment(
        { OPENED_URL: server.url.origin, OPENED_LLM_URL: `${server.url.origin}/v1` },
        Effect.gen(function* () {
          yield* addPlugin()
          const integrations = yield* Integration.Service
          const attempt = yield* integrations.oauth.connect({ integrationID, methodID })
          const callback = callbackURL(attempt)
          yield* integrations.oauth.cancel({ integrationID, attemptID: attempt.attemptID })
          expect(
            yield* Effect.promise(() =>
              fetch(callback, { headers: { Connection: "close" } })
                .then(() => false)
                .catch(() => true),
            ),
          ).toBe(true)
        }),
      )
    }),
  )

  it.effect("closes the loopback listener when an attempt expires", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      yield* addPlugin()
      const attempt = yield* integrations.oauth.connect({ integrationID, methodID })
      const callback = callbackURL(attempt)
      yield* TestClock.adjust(Duration.minutes(10))
      expect(yield* integrations.oauth.status({ integrationID, attemptID: attempt.attemptID })).toMatchObject({
        status: "expired",
      })
      expect(
        yield* Effect.promise(() =>
          fetch(callback, { headers: { Connection: "close" } })
            .then(() => false)
            .catch(() => true),
        ),
      ).toBe(true)
    }),
  )

  it.live("rejects a token response without llm:use", () =>
    Effect.gen(function* () {
      const state = remote()
      state.token.scope = "roadmaps:read"
      const server = yield* openedServer(state)
      yield* withEnvironment(
        { OPENED_URL: server.url.origin, OPENED_LLM_URL: `${server.url.origin}/v1` },
        Effect.gen(function* () {
          yield* addPlugin()
          const integrations = yield* Integration.Service
          const credentials = yield* Credential.Service
          const attempt = yield* integrations.oauth.connect({ integrationID, methodID })
          const authorization = new URL(attempt.url)
          const flowState = authorization.searchParams.get("state")
          if (!flowState) throw new Error("Expected state in authorization URL")
          const callback = callbackURL(attempt)
          callback.searchParams.set("code", "single-use-test-code")
          callback.searchParams.set("state", flowState)
          yield* Effect.promise(() => fetch(callback, { headers: { Connection: "close" } }))
          expect(yield* status(attempt)).toMatchObject({ status: "failed" })
          expect(state.exchanges).toHaveLength(1)
          expect(yield* credentials.list(integrationID)).toHaveLength(0)
          expect(state.modelRequests).toHaveLength(0)
        }),
      )
    }),
  )
})
