#!/usr/bin/env node

const childProcess = require("node:child_process")
const fs = require("node:fs")
const path = require("node:path")

const platform = { darwin: "darwin", linux: "linux", win32: "windows" }[process.platform]
const architecture = process.arch
const musl = process.platform === "linux" && !process.report.getReport().header.glibcVersionRuntime
const target = platform && ("edharness-" + platform + "-" + architecture + (musl ? "-musl" : ""))
const executable = platform === "windows" ? "edharness.exe" : "edharness"
const scriptDirectory = path.dirname(fs.realpathSync(__filename))

function findBinary() {
  const local = path.join(scriptDirectory, executable)
  if (fs.existsSync(local)) return local

  for (let directory = scriptDirectory; ; directory = path.dirname(directory)) {
    const binary = path.join(directory, "node_modules", target, "bin", executable)
    if (fs.existsSync(binary)) return binary
    const parent = path.dirname(directory)
    if (parent === directory) return undefined
  }
}

const binary = target && findBinary()
if (!binary) {
  const libc = process.platform === "linux" ? (musl ? " musl" : " glibc") : ""
  console.error("No EdHarness binary is available for " + process.platform + " " + architecture + libc + ".")
  console.error("Reinstall with optional dependencies enabled: npm install --global edharness")
  process.exit(1)
}

const env = {
  ...process.env,
  OPENCODE_BUNDLED_SKILLS: process.env.OPENCODE_BUNDLED_SKILLS ?? path.join(path.dirname(binary), "skills"),
  OPENCODE_DISABLE_AUTOUPDATE: "1",
}
const child = childProcess.spawn(binary, process.argv.slice(2), { stdio: "inherit", env })
const signals =
  process.platform === "win32" ? ["SIGINT", "SIGTERM", "SIGHUP"] : ["SIGINT", "SIGTERM", "SIGHUP", "SIGUSR1"]
const forwarders = new Map(signals.map((signal) => [signal, () => child.kill(signal)]))
for (const [signal, forward] of forwarders) process.on(signal, forward)

child.on("error", (error) => {
  console.error("Could not start EdHarness: " + error.message)
  process.exit(1)
})
child.on("exit", (code, signal) => {
  for (const [forwarded, forward] of forwarders) process.removeListener(forwarded, forward)
  if (signal) return process.kill(process.pid, signal)
  process.exit(code ?? 1)
})
