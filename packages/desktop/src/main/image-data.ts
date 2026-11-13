export function decodeDataUrl(value: string) {
  if (!value.startsWith("data:")) return

  const separator = value.indexOf(",")
  if (separator === -1) return

  const metadata = value.slice("data:".length, separator)
  const body = value.slice(separator + 1)
  const [mime = "application/octet-stream", ...parameters] = metadata.split(";")
  const bytes = parameters.includes("base64")
    ? Buffer.from(body, "base64")
    : Buffer.from(decodeURIComponent(body), "utf8")

  return { mime, bytes }
}

export function imageExtension(mime: string) {
  return (
    {
      "image/bmp": "bmp",
      "image/gif": "gif",
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/svg+xml": "svg",
      "image/webp": "webp",
    }[mime.toLowerCase()] ?? "png"
  )
}

export function imageMime(bytes: Uint8Array) {
  const matches = (signature: ReadonlyArray<number>, offset = 0) =>
    signature.every((byte, index) => bytes[offset + index] === byte)

  if (matches([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png"
  if (matches([0xff, 0xd8, 0xff])) return "image/jpeg"
  if (matches([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || matches([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) {
    return "image/gif"
  }
  if (matches([0x52, 0x49, 0x46, 0x46]) && matches([0x57, 0x45, 0x42, 0x50], 8)) return "image/webp"
  if (matches([0x42, 0x4d])) return "image/bmp"

  return
}
