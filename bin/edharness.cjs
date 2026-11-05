#!/usr/bin/env node

const childProcess = require("node:child_process")
const path = require("node:path")

const binary = path.join(__dirname, process.platform === "win32" ? "edharness.exe" : "edharness")
const env = {
  ...process.env,
  OPENCODE_BUNDLED_SKILLS: process.env.OPENCODE_BUNDLED_SKILLS ?? path.join(__dirname, "skills"),
  OPENCODE_DISABLE_AUTOUPDATE: "1",
}
const child = childProcess.spawn(binary, process.argv.slice(2), { stdio: "inherit", env })
const signals =
  process.platform === "win32" ? ["SIGINT", "SIGTERM", "SIGHUP"] : ["SIGINT", "SIGTERM", "SIGHUP", "SIGUSR1"]
const forwarders = new Map(signals.map((signal) => [signal, () => child.kill(signal)]))
for (const [signal, forward] of forwarders) process.on(signal, forward)
child.on("error", (error) => {
  console.error(`Could not start EdHarness: ${error.message}`)
  process.exit(1)
})
child.on("exit", (code, signal) => {
  for (const [forwarded, forward] of forwarders) process.removeListener(forwarded, forward)
  if (signal) return process.kill(process.pid, signal)
  process.exit(code ?? 1)
})
