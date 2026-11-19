import { describe, expect, test } from "bun:test"
import { toolImageCommits } from "../../src/mini/stream-v2.image"
import { normalizeTool, toolEntryBody, toolInlineInfo, toolOutputText, toolPath, toolScroll } from "../../src/mini/tool"
import { canonicalToolPart } from "./fixture/tool-part"

describe("Mini tool presentation", () => {
  test("uses V2 shell output without the model-facing status", () => {
    expect(
      toolOutputText("shell", [
        { type: "text", text: "mini-output\n" },
        { type: "text", text: "Command exited with code 0." },
      ]),
    ).toBe("mini-output\n")

    expect(
      toolOutputText("shell", [
        { type: "text", text: "" },
        { type: "text", text: "Command exited with code 0." },
      ]),
    ).toBe("")
  })

  test("normalizes only persisted tool aliases into current fields", () => {
    expect(
      normalizeTool({
        type: "tool",
        id: "call-patch",
        name: "apply_patch",
        state: {
          status: "completed",
          input: { patchText: "*** Begin Patch\n*** End Patch" },
          metadata: {
            files: [
              {
                type: "update",
                filePath: "/tmp/project/src/a.ts",
                relativePath: "src/a.ts",
                patch: "@@ -1 +1 @@\n-old\n+new",
              },
            ],
          },
          content: [{ type: "text", text: "patched" }],
        },
        time: { created: 1, ran: 1, completed: 2 },
      }),
    ).toMatchObject({
      name: "patch",
      state: {
        metadata: {
          files: [
            {
              status: "modified",
              file: "src/a.ts",
              patch: "@@ -1 +1 @@\n-old\n+new",
            },
          ],
        },
        content: [{ type: "text", text: "patched" }],
      },
    })

    expect(
      normalizeTool({
        type: "tool",
        id: "call-subagent",
        name: "task",
        state: {
          status: "running",
          input: { subagent_type: "explore", description: "Inspect" },
          metadata: {},
        },
        time: { created: 1, ran: 1 },
      }),
    ).toMatchObject({ name: "subagent", state: { input: { agent: "explore" } } })
  })

  test("renders the skill name from tool metadata with the input id as fallback", () => {
    const skill = (metadata: { name?: string }) =>
      canonicalToolPart(
        "skill",
        {
          status: "completed",
          input: { id: "tigerstyle" },
          metadata,
          content: [{ type: "text", text: "" }],
        },
        "call-skill",
      )

    expect(toolInlineInfo(skill({ name: "effect" })).title).toBe('Skill "effect"')
    expect(toolInlineInfo(skill({})).title).toBe('Skill "tigerstyle"')
    expect(
      toolScroll("start", {
        directory: "/work/project",
        raw: "",
        name: "skill",
        input: { id: "tigerstyle" },
        meta: { name: "effect" },
        state: {},
        status: "completed",
        error: "",
        output: "",
        time: {},
      }),
    ).toBe('→ Skill "effect"')
  })

  test("renders compact search metadata", () => {
    expect(
      toolInlineInfo(
        canonicalToolPart("glob", {
          status: "completed",
          input: { pattern: "*.ts" },
          metadata: { count: 3 },
          content: [{ type: "text", text: "" }],
        }),
      ).description,
    ).toBe("3 matches")
    expect(
      toolInlineInfo(
        canonicalToolPart("grep", {
          status: "completed",
          input: { pattern: "needle" },
          metadata: { matches: 1 },
          content: [{ type: "text", text: "" }],
        }),
      ).description,
    ).toBe("1 match")
  })

  test("shows OpenEd activity without exposing compact tool input or output", () => {
    const part = canonicalToolPart("opened_get_profile", {
      status: "completed",
      input: { query: "PRIVATE_INPUT" },
      metadata: {},
      content: [{ type: "text", text: "PRIVATE_OUTPUT" }],
    })
    const entry = { kind: "tool", source: "tool", tool: part.name, part, text: "PRIVATE_OUTPUT" } as const

    expect(toolInlineInfo(part)).toEqual({ icon: "◈", title: "OpenEd account" })
    expect(toolEntryBody({ ...entry, phase: "start" }, "")).toEqual({
      type: "text",
      content: "◈ Checking your OpenEd account",
    })
    expect(toolEntryBody({ ...entry, phase: "progress" }, "PRIVATE_OUTPUT")).toBeUndefined()
    expect(toolEntryBody({ ...entry, phase: "final" }, "PRIVATE_OUTPUT")).toBeUndefined()
    expect(toolOutputText(part.name, [{ type: "text", text: "PRIVATE_OUTPUT" }])).toBe("")
    expect(
      toolEntryBody({ ...entry, phase: "final", toolState: "error", toolError: "PRIVATE_ERROR" }, "PRIVATE_ERROR"),
    ).toEqual({ type: "text", content: "Could not complete the OpenEd action." })
  })

  test("suppresses compact OpenEd image output and preserves other MCP output", () => {
    const part = (name: string) =>
      canonicalToolPart(name, {
        status: "completed",
        input: { query: "demo" },
        metadata: {},
        content: [{ type: "file", mime: "image/png", uri: "data:image/png;base64,AAAA", name: "result.png" }],
      })

    expect(toolImageCommits(normalizeTool(part("opened_get_image")), "message")).toEqual([])
    const generic = part("demo_opened_get_image")
    expect(toolInlineInfo(generic)).toMatchObject({ title: 'demo_opened_get_image {"query":"demo"}' })
    expect(toolImageCommits(normalizeTool(generic), "message")).toMatchObject([{ text: "result.png" }])
    expect(toolOutputText(generic.name, [{ type: "text", text: "DEMO_OUTPUT" }])).toBe("DEMO_OUTPUT")
  })

  test("keeps segment-safe contained tool paths relative", () => {
    expect(toolPath("..cache/result.txt", { directory: "/work/project" })).toBe("..cache/result.txt")
    expect(toolPath("../shared/result.txt", { directory: "/work/project" })).toBe("/work/shared/result.txt")
  })
})
