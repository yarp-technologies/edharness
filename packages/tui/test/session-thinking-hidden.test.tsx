import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"
import { waitForHighlightedFrame } from "./fixture/frame"

test.each(["", "**Private title**\n\nPrivate reasoning body"])(
  "shows a neutral status from reasoning start until completion",
  async (reasoning) => {
    const session = {
      id: "ses_thinking_hidden",
      title: "Thinking fixture",
      projectID: "proj_test",
      location: { directory },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 0, updated: 0 },
    }
    const messages = [
      { type: "user", id: "msg_user", text: "Fixture prompt", time: { created: 0 } },
      {
        type: "assistant",
        id: "msg_assistant",
        agent: "build",
        model: { providerID: "fixture", id: "fixture" },
        time: { created: 1 },
        content: [],
      },
    ]
    await using app = await createAppFixture({
      width: 80,
      height: 30,
      args: { sessionID: session.id },
      config: { animations: false, session: { thinking: "show" } },
      fetch: (url) => {
        if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
        if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
        if (url.pathname === `/api/session/${session.id}/message`)
          return json({ data: messages.toReversed(), cursor: {} })
        if ([`/api/session/${session.id}/inbox`, `/api/session/${session.id}/permission`].includes(url.pathname))
          return json({ data: [] })
      },
    })
    await app.ready
    await waitForHighlightedFrame(app, (frame) => frame.includes("Fixture prompt"))
    const common = { sessionID: session.id, assistantMessageID: "msg_assistant", ordinal: 0 }
    app.events.emit({
      id: "evt_reasoning_started",
      created: 2,
      type: "session.reasoning.started",
      location: { directory },
      durable: { aggregateID: session.id, seq: 1, version: 1 },
      data: common,
    })
    await app.waitForFrame((frame) => frame.includes("Думаю…"))
    if (reasoning)
      app.events.emit({
        id: "evt_reasoning_delta",
        created: 3,
        type: "session.reasoning.delta",
        location: { directory },
        data: { ...common, delta: reasoning },
      })
    app.events.emit({
      id: "evt_reasoning_ended",
      created: 4,
      type: "session.reasoning.ended",
      location: { directory },
      durable: { aggregateID: session.id, seq: 2, version: 1 },
      data: { ...common, text: reasoning },
    })
    app.events.emit({
      id: "evt_text_started",
      created: 5,
      type: "session.text.started",
      location: { directory },
      durable: { aggregateID: session.id, seq: 3, version: 1 },
      data: common,
    })
    app.events.emit({
      id: "evt_text_delta",
      created: 6,
      type: "session.text.delta",
      location: { directory },
      data: { ...common, delta: "Visible answer" },
    })
    await waitForHighlightedFrame(app, (frame) => frame.includes("Visible answer"))
    expect(app.captureCharFrame()).not.toContain("Думаю…")
    expect(app.captureCharFrame()).not.toContain("Private title")
    expect(app.captureCharFrame()).not.toContain("Private reasoning body")
  },
)
