import { expect, test } from "bun:test"

test("OpenEd skills use EdHarness's protected connection", async () => {
  const api = await Bun.file(new URL("../skills/opened-api/SKILL.md", import.meta.url)).text()
  const init = await Bun.file(new URL("../skills/opened-init/SKILL.md", import.meta.url)).text()

  expect(api).toContain("native `opened_api` tool")
  expect(api).toContain("protected integration storage")
  expect(api).not.toContain("OPENED_API_KEY")
  expect(api).not.toContain("curl")
  expect(init).toContain("native **Connect OpenEd** flow")
  expect(init).not.toContain("scripts/opened-init.mjs")
})
