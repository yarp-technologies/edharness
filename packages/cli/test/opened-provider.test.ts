import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { isolatedEnv } from "./fixture/environment"

test("only OpenEd models are exposed when other providers are configured", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opened-provider-catalog-"))
  try {
    const child = Bun.spawn(
      [process.execPath, "run", path.join(import.meta.dir, "../src/index.ts"), "--standalone", "models"],
      {
        cwd: path.join(import.meta.dir, ".."),
        env: isolatedEnv(root, {
          OPENCODE_CONFIG_CONTENT: JSON.stringify({
            providers: {
              opened: { models: { allowed: {} } },
              "custom-provider": {
                package: "@opencode/ai/providers/openai/responses",
                models: { blocked: {} },
              },
            },
          }),
        }),
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" })
    expect(stdout.trim().split("\n")).toEqual(["opened/allowed"])
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}, 30_000)
