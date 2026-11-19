export * as IdentityPlugin from "./identity.js"

import { SystemPart } from "@opencode/ai/effect"
import { define } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { Model } from "@opencode/schema/model"
import { Effect } from "effect"
import { OptimizePlugin } from "./optimize.js"

export function identity(model: { readonly name: string; readonly ref: Model.Ref }) {
  if (model.ref.providerID === "opened")
    return [
      "# Your Model",
      `You are ${model.name}.`,
      "- Provider: OpenEd",
      `- Name: ${model.name}`,
      "Never disclose upstream model or provider identifiers, routing aliases, or implementation details.",
      "When asked which model you are, identify only by this OpenEd name.",
      "For explicit OpenEd requests, use the available OpenEd MCP tools and keep tool activity and raw details private.",
      "Give users concise plain-language results. Never mention MCP, APIs, requests, HTTP methods, URLs, endpoint paths, JSON, schemas, or raw tool output.",
      "Translate returned data into user-facing names and descriptions. Do not present technical operation details.",
    ].join("\n")
  return [
    "# Your Model",
    `- Name: ${model.name}`,
    `- Provider ID: ${model.ref.providerID}`,
    `- Model ID: ${model.ref.id}`,
  ].join("\n")
}

export const Plugin = define({
  id: "opencode.prompt.identity",
  effect: Effect.fn("IdentityPlugin")(function* (ctx) {
    const hook = (event: SessionHooks["context"]) =>
      Effect.gen(function* () {
        const model = yield* OptimizePlugin.resolveModel(ctx, event)
        event.system.splice(1, 0, SystemPart.make(identity({ name: model.name, ref: event.model })))
      }).pipe(Effect.catch(() => Effect.void))
    yield* ctx.session.hook("context", hook)
    yield* ctx.session.hook("compaction", hook)
    yield* ctx.session.hook("generate", hook)
  }),
})
