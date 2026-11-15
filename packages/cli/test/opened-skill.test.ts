import { expect, test } from "bun:test"

test("OpenEd API uses the saved authorization and no setup skill is bundled", async () => {
  const api = await Bun.file(new URL("../skills/opened-api/SKILL.md", import.meta.url)).text()
  const init = Bun.file(new URL("../skills/opened-init/SKILL.md", import.meta.url))

  expect(api).toContain("native `opened_api` tool")
  expect(api).toContain("active OAuth")
  expect(api).toContain("protected integration storage")
  expect(api).toContain("user-facing response")
  expect(api).toContain("plain language")
  expect(api).not.toContain("OPENED_API_KEY")
  expect(api).not.toContain("curl")
  expect(await init.exists()).toBe(false)
})
