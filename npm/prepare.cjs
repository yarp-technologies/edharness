const childProcess = require("node:child_process")
const fs = require("node:fs")
const path = require("node:path")

// Keep npm's Git dependency preparation isolated from the Bun workspace manifest at the repository root.
const root = path.resolve(__dirname, "..")
const manifestPath = path.join(__dirname, "package.json")
const installerManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
const rootManifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))

if (installerManifest.version !== rootManifest.version) {
  installerManifest.version = rootManifest.version
  fs.writeFileSync(manifestPath, `${JSON.stringify(installerManifest, null, 2)}\n`)
}

const env = { ...process.env, npm_lifecycle_event: "prepare" }
delete env.BUN_WHICH_IGNORE_CWD
const result = childProcess.spawnSync(process.execPath, [path.join(root, "script/npm-lifecycle.cjs")], {
  cwd: root,
  stdio: "inherit",
  env,
})
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)

const sourceBin = path.join(root, "bin")
const targetBin = path.join(__dirname, "bin")
fs.mkdirSync(targetBin, { recursive: true })
for (const file of ["edharness.cjs", process.platform === "win32" ? "edharness.exe" : "edharness"]) {
  const source = path.join(sourceBin, file)
  if (!fs.existsSync(source)) throw new Error(`EdHarness build did not produce ${source}`)
  fs.copyFileSync(source, path.join(targetBin, file))
}

const targetSkills = path.join(targetBin, "skills")
fs.rmSync(targetSkills, { recursive: true, force: true })
fs.cpSync(path.join(sourceBin, "skills"), targetSkills, { recursive: true })
