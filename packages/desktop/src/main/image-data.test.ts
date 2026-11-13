import { expect, test } from "bun:test"
import { decodeDataUrl } from "./image-data"

test("decodes base64 data URLs for saving", () => {
  const result = decodeDataUrl("data:image/png;base64,AAEC")

  expect(result).toEqual({
    mime: "image/png",
    bytes: Buffer.from([0, 1, 2]),
  })
})

test("decodes URL-encoded data URLs for saving", () => {
  const result = decodeDataUrl("data:image/svg+xml,%3Csvg%20/%3E")

  expect(result).toEqual({
    mime: "image/svg+xml",
    bytes: Buffer.from("<svg />"),
  })
})
