export * as SessionLegacy from "./session-legacy.js"

/**
 * Storage and wire compatibility for current-architecture data written before v2.1 (not V1 contracts). Native data
 * was then named `state` or `providerState`, a tool's result native data `resultState` or `providerResultState`,
 * summary compactions stored the text of the messages they kept in `recent`, and provider compactions stored their
 * replacement window in `providerContext`. Stored events, projected messages, and exported transcripts keep whichever
 * shape they were written with, so these upgrade them before decoding.
 */

const renames: Record<string, readonly [string, string]> = {
  "session.text.ended": ["state", "native"],
  "session.reasoning.started": ["state", "native"],
  "session.reasoning.ended": ["state", "native"],
  "session.tool.called": ["state", "native"],
  "session.step.ended": ["providerState", "native"],
  "session.step.failed": ["providerState", "native"],
  "session.tool.success": ["resultState", "native"],
  "session.tool.failed": ["resultState", "native"],
}

/** Upgrades a durable event payload by event type. */
export function event(type: string, data: unknown) {
  if (!isRecord(data)) return data
  if (type === "session.message.content.updated") return content(data)
  // Messages carry a legacy compaction's kept text; its events have no reader for it.
  if (type === "session.compaction.started") return omit(data, "recent")
  if (type === "session.compaction.ended")
    return providerContext(omit(rename(data, "providerState", "native"), "recent"))
  const entry = renames[type]
  return entry ? rename(data, entry[0], entry[1]) : data
}

/** Upgrades a projected message's data by message type. */
export function message(type: unknown, data: Record<string, unknown>) {
  if (type === "user") return prompt(data)
  if (type === "assistant") return content(rename(data, "providerState", "native"))
  if (type === "compaction") {
    const current = providerContext(recent(rename(data, "providerState", "native")))
    return current.status === undefined && typeof current.summary === "string"
      ? { ...current, status: "completed" }
      : current
  }
  if (type === "shell" && typeof data.callID === "string" && data.shellID === undefined) {
    const output = typeof data.output === "string" ? data.output : ""
    const size = new TextEncoder().encode(output).length
    return {
      ...data,
      shellID: `sh_${data.callID}`,
      status: isRecord(data.time) && data.time.completed !== undefined ? "exited" : "running",
      output: { output, cursor: size, size, truncated: false },
    }
  }
  return data
}

/** Converts prompts stored by the earlier YarpNeuro fork to the current attachment shape. */
export function prompt(data: Record<string, unknown>) {
  const files = Array.isArray(data.files) ? data.files.map(file) : undefined
  const agents = Array.isArray(data.agents)
    ? data.agents.map((agent) =>
        isRecord(agent) && isRecord(agent.source) ? rename(agent, "source", "mention") : agent,
      )
    : undefined
  if (
    files?.every((item, index) => item === (data.files as unknown[])[index]) !== false &&
    agents?.every((item, index) => item === (data.agents as unknown[])[index]) !== false
  )
    return data
  return { ...data, ...(files ? { files } : {}), ...(agents ? { agents } : {}) }
}

function file(value: unknown) {
  if (!isRecord(value) || typeof value.uri !== "string" || value.uri.startsWith("media:") || "data" in value)
    return value
  const { uri, source: mention, ...rest } = value
  const inline = /^data:[^,]*;base64,(.*)$/s.exec(uri)
  return {
    ...rest,
    data: inline?.[1] ?? "",
    source: inline ? { type: "inline" } : { type: "uri", uri },
    ...(isRecord(mention) ? { mention } : {}),
  }
}

/** Upgrades complete messages, such as those in an exported session, before decoding. */
export function messages(values: ReadonlyArray<unknown>) {
  return values.map((value) => (isRecord(value) ? message(value.type, value) : value))
}

function content(data: Record<string, unknown>) {
  if (!Array.isArray(data.content)) return data
  return { ...data, content: data.content.map(part) }
}

/** Upgrades an assistant content part written before v2.1. */
export function part(value: unknown) {
  if (!isRecord(value)) return value
  if (value.type === "text" || value.type === "reasoning") return rename(value, "state", "native")
  // A tool part's own `state` is its lifecycle status, not native data.
  if (value.type === "tool") return forkTool(toolResult(rename(value, "providerState", "native")))
  return value
}

function forkTool(value: Record<string, unknown>) {
  const provider = isRecord(value.provider) ? value.provider : undefined
  const state = isRecord(value.state) ? value.state : undefined
  if (!provider && !state?.structured && state?.status !== "pending") return value
  const result = { ...value }
  if (provider) {
    delete result.provider
    if (typeof provider.executed === "boolean") result.executed = provider.executed
    const metadata = isRecord(provider.metadata) ? Object.values(provider.metadata).find(isRecord) : undefined
    const output = isRecord(provider.resultMetadata) ? Object.values(provider.resultMetadata).find(isRecord) : undefined
    if (metadata || output) result.native = { ...(metadata ?? {}), ...(output ?? {}) }
  }
  if (!state) return result
  const { structured, attachments, ...current } = state
  if (state.status === "pending") result.state = { status: "streaming", input: state.input }
  else if (state.status === "running") result.state = { ...current, metadata: isRecord(structured) ? structured : {} }
  else {
    const files = Array.isArray(attachments)
      ? attachments.flatMap((item) =>
          isRecord(item) && typeof item.uri === "string" ? [{ ...item, type: "file" }] : [],
        )
      : []
    const content = [...(Array.isArray(state.content) ? state.content : []), ...files]
    result.state = {
      ...current,
      ...(content.length ? { content } : state.status === "completed" ? { content: [{ type: "text", text: "" }] } : {}),
      ...(isRecord(structured) ? { metadata: structured } : {}),
    }
  }
  return result
}

/** Kept text a summary compaction stored before it referenced `metadata.keepID`; replay still reads it. */
function recent(data: Record<string, unknown>) {
  const text = data.recent
  const rest = omit(data, "recent")
  if (typeof text !== "string" || !text) return rest
  const metadata = isRecord(rest.metadata) ? rest.metadata : {}
  return { ...rest, metadata: { recent: text, ...metadata } }
}

/** The window moves to `native.messages`; the `native` stored beside it was never replayed. */
function providerContext(data: Record<string, unknown>) {
  const context = data.providerContext
  const rest = omit(data, "providerContext")
  if (!isRecord(context)) return rest
  return {
    ...rest,
    native: { messages: Array.isArray(context.messages) ? context.messages.map(media) : context.messages },
  }
}

/** Before 2.0.15, window media parts stored `mediaType` and base64 `data` directly. */
function media(message: unknown) {
  if (!isRecord(message) || !Array.isArray(message.content)) return message
  return {
    ...message,
    content: message.content.map((part: unknown) => {
      if (!isRecord(part) || part.type !== "media" || part.media !== undefined || typeof part.data !== "string")
        return part
      const { mediaType, data, ...rest } = part
      return { ...rest, media: { source: { type: "base64", data, mediaType } } }
    }),
  }
}

function omit(value: Record<string, unknown>, key: string) {
  if (!(key in value)) return value
  const { [key]: _, ...rest } = value
  return rest
}

// Result data now merges into the tool's single `native`, as projection does for current result events.
function toolResult(value: Record<string, unknown>) {
  if (!("providerResultState" in value)) return value
  const { providerResultState, ...rest } = value
  if (!isRecord(providerResultState)) return rest
  return { ...rest, native: { ...(isRecord(rest.native) ? rest.native : {}), ...providerResultState } }
}

// The current name wins when a payload carries both.
function rename(value: Record<string, unknown>, from: string, to: string) {
  if (!(from in value)) return value
  const { [from]: moved, ...rest } = value
  return to in rest ? rest : { ...rest, [to]: moved }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
