import { expect, test } from "bun:test"
import { Effect } from "effect"
import { ShellParse } from "../../core/src/shell/parse"

test("the bundled Opened API function passes shell permission scanning", async () => {
  const skill = await Bun.file(new URL("../skills/opened-api/SKILL.md", import.meta.url)).text()
  const shell = skill.match(/```sh\n([\s\S]*?)\n```/)?.[1]
  expect(shell).toBeDefined()
  const scanned = await Effect.runPromise(ShellParse.scan(`${shell}\nopened_api '/roadmaps'`, "/bin/sh", "/workspace"))
  expect(scanned.commands.some((command) => command.resource.startsWith("curl "))).toBe(true)
  expect(scanned.commands.some((command) => command.resource.startsWith("opened_api "))).toBe(true)
})
