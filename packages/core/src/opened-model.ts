export type OpenedModel = {
  readonly id: "light" | "smart" | "max" | "image"
  readonly name: "OpenEd Light" | "OpenEd Smart" | "OpenEd Max" | "OpenEd Image"
  readonly alias: "opened-light" | "opened-smart" | "opened-max" | "opened-image"
  readonly type: "chat" | "image"
  readonly package?: string
  readonly routeModelID: string
}

const configured = [
  { id: "light", name: "OpenEd Light", alias: "opened-light", type: "chat" },
  { id: "smart", name: "OpenEd Smart", alias: "opened-smart", type: "chat" },
  { id: "max", name: "OpenEd Max", alias: "opened-max", type: "chat" },
  {
    id: "image",
    name: "OpenEd Image",
    alias: "opened-image",
    type: "image",
    package: "@opencode/ai/providers/openai-compatible/images",
  },
] as const

const byAlias = new Map(configured.map((model) => [model.alias, model]))

/** Resolves only the service's public aliases and keeps the provider target out of the catalog. */
export function fromServerID(modelID: string): OpenedModel | undefined {
  const alias = modelID.slice(modelID.lastIndexOf("/") + 1)
  const model = byAlias.get(alias as OpenedModel["alias"])
  return model ? { ...model, routeModelID: model.alias } : undefined
}

/** Maps IDs saved before OpenEd aliases were made public to the new catalog identity. */
export function publicModelID(modelID: string): string {
  return fromServerID(modelID)?.id ?? (modelID.includes("/") ? "unknown" : modelID)
}
