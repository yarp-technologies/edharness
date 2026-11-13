import { afterEach, expect, mock, test } from "bun:test"
import { rm } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { SaveDialogOptions, WebContents } from "electron"
import { saveImageSource } from "./image-save"

const outputs = new Set<string>()

afterEach(async () => {
  await Promise.all(Array.from(outputs).map((path) => rm(path, { force: true })))
  outputs.clear()
})

test("saves a data URL as image bytes", async () => {
  const output = join(tmpdir(), `yncode-image-${randomUUID()}.png`)
  outputs.add(output)
  const showSaveDialog = async (_options: SaveDialogOptions) => ({ canceled: false, filePath: output })
  const webContents = { executeJavaScript: mock() } as unknown as WebContents

  await saveImageSource("data:image/png;base64,AAEC", webContents, showSaveDialog)

  expect(Array.from(await Bun.file(output).bytes())).toEqual([0, 1, 2])
  expect(webContents.executeJavaScript).not.toHaveBeenCalled()
})

test("resolves blob URLs in the renderer before saving", async () => {
  const output = join(tmpdir(), `yncode-image-${randomUUID()}.png`)
  outputs.add(output)
  const showSaveDialog = async (_options: SaveDialogOptions) => ({ canceled: false, filePath: output })
  const executeJavaScript = mock(async () => "data:image/png;base64,AAEC")
  const webContents = { executeJavaScript } as unknown as WebContents

  await saveImageSource("blob:image", webContents, showSaveDialog)

  expect(Array.from(await Bun.file(output).bytes())).toEqual([0, 1, 2])
  expect(executeJavaScript).toHaveBeenCalledWith(expect.stringContaining('fetch("blob:image")'), true)
})

test("saves image bytes when the renderer reports a generic MIME", async () => {
  const output = join(tmpdir(), `yncode-image-${randomUUID()}.png`)
  outputs.add(output)
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
  const showSaveDialog = async (_options: SaveDialogOptions) => ({ canceled: false, filePath: output })
  const executeJavaScript = mock(async () => `data:text/plain;base64,${png}`)
  const webContents = { executeJavaScript } as unknown as WebContents

  await saveImageSource("blob:image", webContents, showSaveDialog)

  expect(Array.from(await Bun.file(output).bytes())).toEqual(Array.from(Buffer.from(png, "base64")))
})

test("resolves non-data images from the rendered element at the context-menu point", async () => {
  const output = join(tmpdir(), `yncode-image-${randomUUID()}.png`)
  outputs.add(output)
  const showSaveDialog = async (_options: SaveDialogOptions) => ({ canceled: false, filePath: output })
  const executeJavaScript = mock(async () => "data:image/png;base64,AAEC")
  const webContents = { executeJavaScript } as unknown as WebContents

  await saveImageSource("blob:image", webContents, showSaveDialog, { x: 14, y: 28 })

  expect(Array.from(await Bun.file(output).bytes())).toEqual([0, 1, 2])
  expect(executeJavaScript).toHaveBeenCalledWith(expect.stringContaining("document.elementsFromPoint"), true)
})

test("uses the rendered image when a data URL is supplied at the context-menu point", async () => {
  const output = join(tmpdir(), `yncode-image-${randomUUID()}.png`)
  outputs.add(output)
  const showSaveDialog = async (_options: SaveDialogOptions) => ({ canceled: false, filePath: output })
  const executeJavaScript = mock(async () => "data:image/png;base64,AAEC")
  const webContents = { executeJavaScript } as unknown as WebContents

  await saveImageSource("data:image/png;base64,AAEC", webContents, showSaveDialog, { x: 14, y: 28 })

  expect(Array.from(await Bun.file(output).bytes())).toEqual([0, 1, 2])
  expect(executeJavaScript).toHaveBeenCalledWith(expect.stringContaining("document.elementsFromPoint"), true)
})
