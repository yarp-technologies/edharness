import { writeFile } from "node:fs/promises"
import type { SaveDialogOptions, SaveDialogReturnValue, WebContents } from "electron"
import { decodeDataUrl, imageExtension, imageMime } from "./image-data"

type ShowSaveDialog = (options: SaveDialogOptions) => Promise<SaveDialogReturnValue>
type ImagePoint = { x: number; y: number }

export async function saveImageSource(
  source: string,
  webContents: WebContents,
  showSaveDialog: ShowSaveDialog,
  point?: ImagePoint,
) {
  const dataUrl = point || !source.startsWith("data:") ? await resolveImageSource(source, webContents, point) : source
  const image = decodeDataUrl(dataUrl)
  if (!image) throw new Error("The image source cannot be saved")

  const mime = image.mime.startsWith("image/") ? image.mime : imageMime(image.bytes)
  if (!mime) throw new Error("The image source cannot be saved")

  const extension = imageExtension(mime)
  const result = await showSaveDialog({
    defaultPath: `image.${extension}`,
    filters: [{ name: mime, extensions: [extension] }],
  })
  if (result.canceled || !result.filePath) return

  await writeFile(result.filePath, image.bytes)
}

function resolveImageSource(source: string, webContents: WebContents, point?: ImagePoint) {
  const pointValue = point ? JSON.stringify(point) : "undefined"

  return webContents
    .executeJavaScript(
      `(async () => {
        const point = ${pointValue}
        if (point) {
          const image = document.elementsFromPoint(point.x, point.y).find((element) => element instanceof HTMLImageElement)
          if (image instanceof HTMLImageElement && image.naturalWidth > 0 && image.naturalHeight > 0) {
            const canvas = document.createElement("canvas")
            canvas.width = image.naturalWidth
            canvas.height = image.naturalHeight
            const context = canvas.getContext("2d")
            if (!context) throw new Error("Could not create image canvas")
            context.drawImage(image, 0, 0)
            return canvas.toDataURL("image/png")
          }
        }

        const response = await fetch(${JSON.stringify(source)})
        if (!response.ok) throw new Error(\`Failed to load image: \${response.status}\`)
        const blob = await response.blob()
        return new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result)
          reader.onerror = () => reject(reader.error?.message ?? "Failed to read image")
          reader.readAsDataURL(blob)
        })
      })()`,
      true,
    )
    .then((value) => {
      if (typeof value !== "string") throw new Error("The image source did not produce image data")
      return value
    })
}
