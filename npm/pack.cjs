const fs = require("node:fs")
const path = require("node:path")

const root = path.resolve(__dirname, "..")
const sourceArg = process.argv.find((arg) => arg.startsWith("--source="))
const targetArg = process.argv.find((arg) => arg.startsWith("--target="))
const sourceRoot = path.resolve(root, sourceArg ? sourceArg.slice("--source=".length) : "packages/cli/dist/npm")
const requestedTarget = targetArg && targetArg.slice("--target=".length)
const outputRoot = path.join(__dirname, "dist")
const app = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
const baseTemplate = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"))

const allTargets = [
  { name: "darwin-arm64", build: "darwin-arm64", os: "darwin", cpu: "arm64" },
  { name: "darwin-x64", build: "darwin-x64-baseline", os: "darwin", cpu: "x64" },
  { name: "linux-arm64", build: "linux-arm64", os: "linux", cpu: "arm64", libc: "glibc" },
  { name: "linux-arm64-musl", build: "linux-arm64-musl", os: "linux", cpu: "arm64", libc: "musl" },
  { name: "linux-x64", build: "linux-x64-baseline", os: "linux", cpu: "x64", libc: "glibc" },
  { name: "linux-x64-musl", build: "linux-x64-baseline-musl", os: "linux", cpu: "x64", libc: "musl" },
  { name: "windows-arm64", build: "windows-arm64", os: "win32", cpu: "arm64" },
  { name: "windows-x64", build: "windows-x64-baseline", os: "win32", cpu: "x64" },
]
const targets = allTargets.filter((target) => requestedTarget === undefined || requestedTarget === target.name)

if (requestedTarget && targets.length === 0) throw new Error("Unknown npm target: " + requestedTarget)
fs.rmSync(outputRoot, { recursive: true, force: true })
fs.mkdirSync(outputRoot, { recursive: true })

const optionalDependencies = {}
for (const target of targets) {
  const name = "edharness-" + target.name
  const source = path.join(sourceRoot, "cli-" + target.build)
  const sourceBinary = path.join(source, "bin", target.os === "win32" ? "opencode.exe" : "opencode")
  if (!fs.existsSync(sourceBinary) || fs.statSync(sourceBinary).size === 0) {
    throw new Error("Missing CLI build for " + target.name + ": " + sourceBinary)
  }
  const sourceSkills = path.join(source, "bin", "skills")
  if (!fs.existsSync(sourceSkills)) throw new Error("Missing bundled skills for " + target.name + ": " + sourceSkills)

  const packageRoot = path.join(outputRoot, name)
  const bin = path.join(packageRoot, "bin")
  fs.mkdirSync(bin, { recursive: true })
  const binary = path.join(bin, target.os === "win32" ? "edharness.exe" : "edharness")
  fs.copyFileSync(sourceBinary, binary)
  if (target.os !== "win32") fs.chmodSync(binary, 0o755)
  fs.cpSync(sourceSkills, path.join(bin, "skills"), { recursive: true })
  const manifest = {
    name,
    version: app.version,
    description: "EdHarness CLI binary for " + target.name,
    license: app.license,
    repository: baseTemplate.repository,
    os: [target.os],
    cpu: [target.cpu],
    ...(target.libc ? { libc: target.libc } : {}),
    files: ["bin"],
  }
  fs.writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify(manifest, null, 2) + "\n")
  optionalDependencies[name] = app.version
}

const base = { ...baseTemplate, version: app.version, optionalDependencies }
delete base.private
const baseRoot = path.join(outputRoot, "edharness")
fs.mkdirSync(path.join(baseRoot, "bin"), { recursive: true })
fs.copyFileSync(path.join(__dirname, "bin", "edharness.cjs"), path.join(baseRoot, "bin", "edharness.cjs"))
fs.copyFileSync(path.join(__dirname, "README.md"), path.join(baseRoot, "README.md"))
fs.writeFileSync(path.join(baseRoot, "package.json"), JSON.stringify(base, null, 2) + "\n")

console.log("Prepared EdHarness npm packages " + app.version + ": " + Object.keys(optionalDependencies).join(", "))
