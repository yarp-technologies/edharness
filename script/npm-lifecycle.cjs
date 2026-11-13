const childProcess = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const root = path.resolve(__dirname, "..")
const event = process.env.npm_lifecycle_event
const bunAgent = process.env.npm_config_user_agent?.startsWith("bun/")
// Bun can inherit npm's user agent when it is launched through npm exec.
const bunInstall = process.env.EDHARNESS_NPM_BUILD === "1" || bunAgent || !!process.env.BUN_WHICH_IGNORE_CWD

function run(command, args, options = {}) {
  const result = childProcess.spawnSync(command, args, { cwd: root, stdio: "inherit", ...options })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

if (bunInstall && event === "postinstall") {
  run(process.env.EDHARNESS_BUN_PATH ?? (bunAgent ? process.env.npm_execpath : "bun"), [
    "run",
    "--cwd",
    "packages/core",
    "fix-node-pty",
  ])
} else if (bunInstall && event === "prepare") {
  run(process.execPath, [path.join(root, "node_modules/husky/bin.js")])
} else if (!bunInstall && event === "prepare") {
  const binary = path.join(root, "bin", process.platform === "win32" ? "edharness.exe" : "edharness")
  if (!fs.existsSync(binary)) {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
    const version = pkg.packageManager.split("@")[1]
    const installed = childProcess.spawnSync("bun", ["--version"], { encoding: "utf8" })
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "edharness-bun-"))
    const env = { ...process.env }
    delete env.npm_config_global
    delete env.npm_config_prefix
    delete env.npm_config_omit
    delete env.NODE_ENV
    try {
      let bun = "bun"
      if (installed.status !== 0 || installed.stdout.trim() !== version) {
        run(
          process.execPath,
          [
            process.env.npm_execpath,
            "install",
            "--prefix",
            temporary,
            "--no-save",
            "--no-audit",
            "--no-fund",
            `bun@${version}`,
          ],
          { env },
        )
        bun = path.join(temporary, "node_modules", "bun", "bin", "bun.exe")
        env.PATH = `${path.join(temporary, "node_modules", ".bin")}${path.delimiter}${env.PATH}`
      }
      env.EDHARNESS_NPM_BUILD = "1"
      env.EDHARNESS_BUN_PATH = bun
      const platform = { darwin: "darwin", linux: "linux", win32: "windows" }[process.platform]
      if (!platform || !["x64", "arm64"].includes(process.arch)) {
        throw new Error(`Unsupported platform: ${process.platform} ${process.arch}`)
      }
      const musl = process.platform === "linux" && !process.report.getReport().header.glibcVersionRuntime
      const target = [
        platform,
        process.arch,
        process.arch === "x64" ? "baseline" : undefined,
        musl ? "musl" : undefined,
      ]
        .filter(Boolean)
        .join("-")
      console.log(`Building EdHarness for ${target} with Bun ${version}...`)
      run(bun, ["install", "--frozen-lockfile"], { env })
      run(bun, ["run", "--cwd", "packages/cli", "build", "--skip-install"], {
        env: {
          ...env,
          OPENCODE_CHANNEL: "edharness",
          OPENCODE_VERSION: `${pkg.version}-edharness`,
          OPENCODE_CLI_NAME: "edharness",
          OPENCODE_TARGET: target,
        },
      })
      const output = path.join(root, "packages/cli/dist", `cli-${target}`, "bin")
      fs.mkdirSync(path.dirname(binary), { recursive: true })
      fs.copyFileSync(path.join(output, process.platform === "win32" ? "opencode.exe" : "opencode"), binary)
      fs.cpSync(path.join(output, "skills"), path.join(root, "bin/skills"), { recursive: true })
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  }
}
