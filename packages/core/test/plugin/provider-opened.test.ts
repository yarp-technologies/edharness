import { describe, expect, test } from "bun:test"
import { createMcpHandler, Server } from "@modelcontextprotocol/server"
import { Config } from "@opencode/core/config"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Mcp } from "@opencode/core/mcp/index"
import { Deferred, Duration, Effect, Layer, Logger, Schedule, Schema } from "effect"
import { TestClock, TestConsole } from "effect/testing"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { Tool } from "@opencode/core/tool"
import { ToolOutput } from "@opencode/core/tool-output"
import { McpTool } from "@opencode/core/tool/mcp"
import { IdentityPlugin } from "@opencode/core/plugin/identity"
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
  token: { access_token: string; token_type: string; scope: string }
  exchangeStatus: number
  mcpRequests: Array<{ url: string; method: string; authorization: string | null }>
  callFailure?: number
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
  mcpRequests: [],
  modelRequests: [],
  token: { access_token: "test-opened-access-secret", token_type: "Bearer", scope: "llm:use roadmaps:read" },
  exchangeStatus: 200,
  modelIDs: [
    "minimax/opened-light",
    "minimax/opened-smart",
    "minimax/opened-max",
    "minimax/opened-image",
    "minimax/MiniMax-M2.7",
  ],
})

function openedServer(state: Remote) {
  const mcp = createMcpHandler(
    () => {
      const server = new Server({ name: "OpenEd", version: "1" }, { capabilities: { tools: {} } })
      server.setRequestHandler("tools/list", async () => ({
        tools: [{ name: "list_roadmaps", inputSchema: { type: "object" } }],
      }))
      server.setRequestHandler("tools/call", async () => ({ content: [{ type: "text", text: "Roadmaps" }] }))
      return server
    },
    { legacy: "reject" },
  )
  return Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          const url = new URL(request.url)
          const headers = Object.fromEntries(request.headers.entries())
          if (url.pathname === "/api/mcp") {
            const method = headers["mcp-method"] ?? ""
            state.mcpRequests.push({ url: url.href, method, authorization: headers.authorization ?? null })
            if (state.callFailure && method === "tools/call")
              return new Response(headers.authorization, { status: state.callFailure })
            return mcp.fetch(request)
          }
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

const mcpTests = testEffect(
  Mcp.layer().pipe(
    Layer.provideMerge(PluginTestLayer),
    Layer.provideMerge(Logger.layer([Logger.withConsoleLog(Logger.formatStructured)])),
  ),
)
const oauthValue = (access: string, scope = "llm:use") =>
  Credential.OAuth.make({ type: "oauth", methodID, access, refresh: "", expires: 0, metadata: { scope } })

function until<A, E, R>(effect: Effect.Effect<A, E, R>, predicate: (value: A) => boolean) {
  return effect.pipe(
    Effect.repeat({ until: predicate, schedule: Schedule.spaced("10 millis") }),
    Effect.timeout("2 seconds"),
  )
}

const withOpenedMcp = <A, E, R>(run: (state: Remote, origin: string) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const state = remote()
    const server = yield* openedServer(state)
    return yield* withEnvironment(
      { OPENED_URL: server.url.href, OPENED_LLM_URL: `${server.url.origin}/v1` },
      run(state, server.url.origin),
    )
  })

const connectMcp = Effect.fn(function* (state: Remote) {
  const credentials = yield* Credential.Service
  const mcp = yield* Mcp.Service
  const saved = yield* credentials.create({ integrationID, value: oauthValue(state.token.access_token) })
  yield* addPlugin()
  yield* until(mcp.tools(), (tools) => tools.some((tool) => tool.name === "list_roadmaps"))
  return saved
})

describe("OpenEd MCP", () => {
  mcpTests.live("registers named MCP tools in place of the retired OpenEd API tool", () =>
    withOpenedMcp((state) =>
      Effect.gen(function* () {
        yield* connectMcp(state)
        yield* Effect.gen(function* () {
          const registration = yield* McpTool.Service
          const tools = yield* Tool.Service
          yield* registration.flush

          const ids = (yield* tools.list()).map((tool) => tool.id)
          expect(ids).toContain("opened_list_roadmaps")
          expect(ids).not.toContain("opened_api")
        }).pipe(Effect.provide(McpTool.layer.pipe(Layer.provide(AppNodeBuilder.build(ToolOutput.node)))))
      }),
    ),
  )

  mcpTests.live("registers_opened_mcp_from_active_credential", () =>
    withOpenedMcp((state, origin) =>
      Effect.gen(function* () {
        yield* connectMcp(state)
        const mcp = yield* Mcp.Service
        yield* mcp.transform((editor) => {
          expect(editor.get("opened")).toMatchObject({
            type: "remote",
            protocol: "2026-07-28",
            oauth: false,
            url: `${origin}/api/mcp`,
            headers: { Authorization: `Bearer ${state.token.access_token}` },
          })
        })
        expect(
          state.mcpRequests.every((request) => request.authorization === `Bearer ${state.token.access_token}`),
        ).toBe(true)
      }),
    ),
  )

  mcpTests.live("does_not_register_opened_mcp_without_llm_use", () =>
    withOpenedMcp((state) =>
      Effect.gen(function* () {
        const credentials = yield* Credential.Service
        const integrations = yield* Integration.Service
        const mcp = yield* Mcp.Service
        yield* credentials.create({ integrationID, value: oauthValue(state.token.access_token, "llm:use-other") })
        yield* addPlugin()
        yield* until(integrations.get(integrationID), (data) => data?.connections[0]?.status?.status === "needs_auth")
        expect(yield* mcp.servers()).toEqual([])
        expect(state.mcpRequests).toEqual([])
      }),
    ),
  )

  mcpTests.live("updates_opened_mcp_when_credential_changes", () =>
    withOpenedMcp((state) =>
      Effect.gen(function* () {
        const saved = yield* connectMcp(state)
        const credentials = yield* Credential.Service
        const mcp = yield* Mcp.Service
        const toolUses = (secret: string) =>
          Effect.gen(function* () {
            yield* until(
              Effect.sync(() => state.mcpRequests.at(-1)?.authorization),
              (auth) => auth === `Bearer ${secret}`,
            )
            yield* mcp.callTool({ server: "opened", name: "list_roadmaps" })
            expect(state.mcpRequests.at(-1)?.authorization).toBe(`Bearer ${secret}`)
          })
        yield* credentials.update(saved.id, { value: oauthValue("updated-opened-secret") })
        yield* toolUses("updated-opened-secret")
        yield* credentials.create({ integrationID, value: oauthValue("switched-opened-secret") })
        yield* toolUses("switched-opened-secret")
        yield* credentials.activate(saved.id)
        yield* toolUses("updated-opened-secret")
      }),
    ),
  )

  mcpTests.live("removes_opened_mcp_when_connection_is_cleared", () =>
    withOpenedMcp((state) =>
      Effect.gen(function* () {
        const saved = yield* connectMcp(state)
        const integrations = yield* Integration.Service
        const mcp = yield* Mcp.Service
        yield* integrations.connection.remove(saved.id)
        yield* until(mcp.servers(), (servers) => servers.length === 0)
        expect(yield* mcp.tools()).toEqual([])
        yield* mcp.transform((editor) => expect(editor.get("opened")).toBeUndefined())
      }),
    ),
  )

  mcpTests.live("removes_opened_mcp_after_unauthorized_response", () =>
    withOpenedMcp((state) =>
      Effect.gen(function* () {
        const saved = yield* connectMcp(state)
        const integrations = yield* Integration.Service
        const mcp = yield* Mcp.Service
        state.callFailure = 403
        const error = yield* mcp.callTool({ server: "opened", name: "list_roadmaps" }).pipe(Effect.flip)
        expect(error.message).not.toContain(state.token.access_token)
        yield* until(mcp.servers(), (servers) => servers.length === 0)
        expect((yield* integrations.get(integrationID))?.connections[0]?.status).toMatchObject({
          status: "needs_auth",
          message: expect.stringMatching(/reconnect/i),
        })
        expect(state.mcpRequests.filter((request) => request.method === "tools/call")).toHaveLength(1)
        yield* mcp.transform((editor) => expect(editor.get("opened")).toBeUndefined()).pipe(Effect.scoped)
        const credentials = yield* Credential.Service
        const previous = state.modelRequests.length
        yield* credentials.update(saved.id, { label: "renamed" })
        yield* until(
          Effect.sync(() => state.modelRequests.length),
          (count) => count > previous,
        )
        expect(yield* mcp.servers()).toEqual([])
        expect((yield* integrations.get(integrationID))?.connections[0]?.status?.status).toBe("needs_auth")
        yield* credentials.update(saved.id, { value: oauthValue("fresh-opened-secret") })
        yield* until(mcp.tools(), (tools) => tools.length > 0)
        expect(state.mcpRequests.at(-1)?.authorization).toBe("Bearer fresh-opened-secret")
      }),
    ),
  )

  mcpTests.live("joins_opened_url_with_api_mcp", () =>
    withOpenedMcp((state, origin) =>
      Effect.gen(function* () {
        yield* connectMcp(state)
        expect(new Set(state.mcpRequests.map((request) => request.url))).toEqual(new Set([`${origin}/api/mcp`]))
      }),
    ),
  )

  mcpTests.live("does_not_persist_or_log_opened_access_token", () =>
    withOpenedMcp((state) =>
      Effect.gen(function* () {
        yield* connectMcp(state)
        const config = yield* Config.Service
        const mcp = yield* Mcp.Service
        const integrations = yield* Integration.Service
        const result = yield* mcp.callTool({ server: "opened", name: "list_roadmaps" })
        state.callFailure = 500
        const failure = yield* mcp.callTool({ server: "opened", name: "list_roadmaps" }).pipe(Effect.flip)
        state.callFailure = 403
        const denied = yield* mcp.callTool({ server: "opened", name: "list_roadmaps" }).pipe(Effect.flip)
        yield* until(mcp.servers(), (servers) => servers.length === 0)
        const logs = [...(yield* TestConsole.logLines), ...(yield* TestConsole.errorLines)]
        expect(JSON.stringify(logs)).toContain("mcp http authentication rejected")
        expect(
          JSON.stringify([
            yield* config.entries(),
            yield* mcp.servers(),
            yield* integrations.get(integrationID),
            result,
            denied.message,
            failure.message,
            logs,
          ]),
        ).not.toContain(state.token.access_token)
      }),
    ),
  )
})

describe("OpenEd provider", () => {
  test("routes OpenEd requests to MCP without API implementation details", () => {
    const prompt = IdentityPlugin.identity({
      name: "OpenEd Light",
      ref: Model.Ref.make({ providerID, id: Model.ID.make("light") }),
    })

    expect(prompt).toContain("OpenEd MCP")
    expect(prompt).not.toMatch(/opened_api|\/api\/|endpoint paths?|HTTP|\bJSON\b|schemas?/i)
  })

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
          const publicModels = yield* models.available().pipe(
            Effect.repeat({
              until: (available) => available.filter((model) => model.providerID === providerID).length === 3,
              schedule: Schedule.spaced("10 millis"),
            }),
            Effect.timeout("3 seconds"),
          )
          expect(
            publicModels
              .filter((model) => model.providerID === providerID)
              .map((model) => [model.id, model.name, model.modelID]),
          ).toEqual([
            ["light", "OpenEd Light", "opened-light"],
            ["smart", "OpenEd Smart", "opened-smart"],
            ["max", "OpenEd Max", "opened-max"],
          ])
          expect(
            publicModels
              .map((model) => `${model.id} ${model.name}`)
              .join(" ")
              .toLowerCase(),
          ).not.toContain("minimax")
          expect(
            publicModels
              .filter((model) => model.providerID === providerID)
              .some((model) => model.modelID.toLowerCase().includes("minimax")),
          ).toBe(false)
          const imageModels = yield* models.available(["image"])
          expect(imageModels.filter((model) => model.providerID === providerID).map((model) => model.id)).toEqual([
            Model.ID.make("image"),
          ])

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
