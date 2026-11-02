import http from "node:http"
import { getCACertificates, setDefaultCACertificates } from "node:tls"
import { app, dialog, webContents } from "electron"
import type { BrowserView, BrowserWindow, WebContents, WebContentsView } from "electron"
import { Effect, Path } from "effect"
import { DesktopPaths } from "../paths"
import { getUserShell, loadShellEnv } from "../service/shell-env"
import { registerRendererProtocol, setDockIcon, setProtocolReporter } from "../windows"
import { scoped } from "../native/logging"
import { applySpellcheck, spellcheckMenuItems } from "../native/spellcheck"
import { saveImageSource } from "../image-save"

// electron-context-menu attaches to every existing and future window, so it can load once the first
// window is up instead of holding up startup with its dependency tree.
export const installContextMenu = Effect.gen(function* () {
  const { default: contextMenu } = yield* Effect.promise(() => import("electron-context-menu"))
  contextMenu({
    showSaveImageAs: false,
    showLookUpSelection: false,
    showSearchWithGoogle: false,
    append: (actions, params, target) => {
      if (params.isEditable) return spellcheckMenuItems()
      if (params.mediaType !== "image" || !target) return []
      const item = actions.saveImageAs({})
      if (/^https?:\/\//i.test(params.srcURL)) return [item]
      return [
        {
          ...item,
          click() {
            void Promise.resolve()
              .then(() =>
                saveImageSource(params.srcURL, targetContents(target), (options) => dialog.showSaveDialog(options), {
                  x: params.x,
                  y: params.y,
                }),
              )
              .catch((error) =>
                dialog.showErrorBox(item.label ?? "", error instanceof Error ? error.message : String(error)),
              )
          },
        },
      ]
    },
  })
})

function targetContents(target: BrowserWindow | BrowserView | WebContentsView | Electron.WebviewTag | WebContents) {
  if ("webContents" in target) return target.webContents
  if (!("getWebContentsId" in target)) return target
  const contents = webContents.fromId(target.getWebContentsId())
  if (!contents) throw new Error("The image view is no longer available")
  return contents
}

export const prepareApplicationEnvironment = Effect.gen(function* () {
  yield* loadSystemCertificates
  yield* loadProxyEnvironment
})

export const preferApplicationEnvironment = Effect.gen(function* () {
  const path = yield* Path.Path
  const paths = yield* DesktopPaths.resolve
  const shell = process.platform === "win32" ? null : getUserShell()
  const shellEnv = shell ? yield* loadShellEnv(shell) : null
  yield* Effect.sync(() => {
    if (!shellEnv?.XDG_STATE_HOME) delete process.env.XDG_STATE_HOME
    Object.assign(process.env, {
      ...shellEnv,
      OPENCODE_EXPERIMENTAL_ICON_DISCOVERY: "true",
      OPENCODE_EXPERIMENTAL_FILEWATCHER: "true",
      OPENCODE_CLIENT: "desktop",
      OPENCODE_BUNDLED_SKILLS:
        shellEnv?.OPENCODE_BUNDLED_SKILLS ??
        process.env.OPENCODE_BUNDLED_SKILLS ??
        (app.isPackaged
          ? path.join(process.resourcesPath, "skills")
          : path.join(paths.developmentResourcesRoot, "../../cli/skills")),
    })
  })
})

export const prepareDesktop = Effect.gen(function* () {
  const path = yield* Path.Path
  const paths = yield* DesktopPaths.resolve

  if (app.isPackaged || process.env.OPENCODE_DESKTOP_DISABLE_PROTOCOL_REGISTRATION !== "1")
    app.setAsDefaultProtocolClient("opencode")
  const runFork = Effect.runForkWith(yield* Effect.context())
  setProtocolReporter((level, message, data) =>
    runFork(scoped("protocol", level === "error" ? Effect.logError(message, data) : Effect.logWarning(message, data))),
  )
  registerRendererProtocol(paths.rendererRoot)
  setDockIcon(path, paths)
  applySpellcheck()
})

export const loadProxyEnvironment = Effect.gen(function* () {
  yield* Effect.try(() => {
    ensureLoopbackNoProxy()
    // SAFETY: Electron 41.2 ships a Node with http.setGlobalProxyFromEnv, which the current @types/node lacks.
    const proxyAwareHttp = http as typeof http & { setGlobalProxyFromEnv(): void }
    proxyAwareHttp.setGlobalProxyFromEnv()
  }).pipe(Effect.catch((error) => Effect.logWarning("failed to load proxy environment", { error })))
})

const loadSystemCertificates = Effect.try({
  try: () => {
    setDefaultCACertificates([...new Set([...getCACertificates("default"), ...getCACertificates("system")])])
  },
  catch: (error) => error,
}).pipe(Effect.catch((error) => Effect.logWarning("failed to load system certificates", { error })))

// Bun reads lowercase `no_proxy` alone whenever it is set, so both spellings get the same merged list.
function ensureLoopbackNoProxy() {
  const noProxy = [
    ...new Set(
      [process.env.NO_PROXY, process.env.no_proxy, "127.0.0.1,localhost,::1"].flatMap((value) =>
        (value ?? "").split(",").flatMap((entry) => entry.trim() || []),
      ),
    ),
  ].join(",")

  process.env.NO_PROXY = noProxy
  process.env.no_proxy = noProxy
}
