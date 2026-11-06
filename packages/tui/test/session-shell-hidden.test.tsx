import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"
import { waitForHighlightedFrame } from "./fixture/frame"

test.each([
  ["streaming", "high", 44, "Выполняю команду…"],
  ["running", "high", 100, "Выполняю команду…"],
  ["completed", "high", 44, "Команда выполнена"],
  ["error", "medium", 100, "Ошибка команды"],
  ["exit", "high", 100, "Ошибка команды"],
  ["background", "high", 100, "Команда запущена в фоне"],
  ["completed", "low", 100, "Команда выполнена"],
  ["debug", "high", 100, "Команда выполнена"],
] as const)("hides an agent shell command when %s at %s verbosity", async (scenario, verbosity, width, label) => {
  const session = {
    id: "ses_hidden_shell",
    title: "Shell fixture",
    projectID: "proj_test",
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  const command = "printf COMMAND_FIXTURE_SECRET"
  const input = { command, workdir: "/workspace/secret-directory" }
  const output = [{ type: "text", text: "OUTPUT_FIXTURE_SECRET" }]
  const states = {
    streaming: { status: "streaming", input: JSON.stringify(input) },
    running: { status: "running", input, metadata: {} },
    completed: { status: "completed", input, content: output, metadata: { exit: 0 } },
    error: { status: "error", input, error: { type: "Fixture", message: `Failed: ${command}` }, metadata: {} },
    exit: { status: "completed", input, content: output, metadata: { exit: 7 } },
    background: {
      status: "completed",
      input,
      content: output,
      metadata: { status: "running", shellID: "shell-fixture" },
    },
    debug: { status: "completed", input, content: output, metadata: { exit: 0 } },
  }
  const state = states[scenario]
  const messages = [
    { type: "user", id: "msg_user", text: "Fixture prompt", time: { created: 0 } },
    {
      type: "assistant",
      id: "msg_assistant",
      agent: "build",
      model: { providerID: "fixture", id: "fixture" },
      ...(scenario === "debug"
        ? { finish: "stop", tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } } }
        : {}),
      time: { created: 1, ...(["running", "streaming"].includes(scenario) ? {} : { completed: 4 }) },
      content: [
        { type: "tool", id: "tool_shell", name: "shell", state, time: { created: 1 } },
        { type: "text", text: "Fixture answer", time: { created: 3 } },
      ],
    },
  ]
  await using app = await createAppFixture({
    width,
    height: 30,
    args: { sessionID: session.id },
    config: {
      animations: false,
      session: { verbosity },
      ...(scenario === "debug" ? { debug: { turn_tokens: "verbose" } } : {}),
    },
    fetch: (url) => {
      if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (url.pathname === `/api/session/${session.id}/message`) return json({ data: messages.toReversed(), cursor: {} })
      if ([`/api/session/${session.id}/inbox`, `/api/session/${session.id}/permission`].includes(url.pathname))
        return json({ data: [] })
    },
  })
  await app.ready
  await waitForHighlightedFrame(app, (frame) => frame.includes("Fixture answer"))
  if (verbosity === "low") {
    const lines = app.captureCharFrame().split("\n")
    const y = lines.findIndex((line) => line.includes("1 command"))
    expect(y).toBeGreaterThanOrEqual(0)
    await app.mockMouse.click(lines[y].indexOf("1 command"), y)
    await app.waitForFrame((frame) => frame.includes("− 1 command"))
  }
  if (scenario === "debug") {
    const lines = app.captureCharFrame().split("\n")
    const y = lines.findIndex((line) => line.includes("Tokens:"))
    expect(y).toBeGreaterThanOrEqual(0)
    await app.mockMouse.click(lines[y].indexOf("Tokens:"), y)
    await app.waitForFrame((frame) => frame.includes("Cached") && frame.includes("shell"))
  }
  const frame = app.captureCharFrame()
  expect(frame).not.toContain("COMMAND_FIXTURE_SECRET")
  expect(frame).not.toContain("secret-directory")
  expect(frame).not.toContain("OUTPUT_FIXTURE_SECRET")
  expect(frame).toContain(label)
  expect(frame).toContain("Fixture answer")
})
