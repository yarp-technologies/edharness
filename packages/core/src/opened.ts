export const openedOrigin = () => {
  const url = configuredOpenedURL(process.env.OPENED_URL, "https://opened.site", "OPENED_URL")
  if (url.pathname !== "/") throw new Error("OPENED_URL must be an origin without a path")
  return url.origin
}

export const configuredOpenedURL = (value: string | undefined, fallback: string, name: string) => {
  const url = new URL(value?.trim() || fallback)
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local))
    throw new Error(`${name} must use HTTPS, except for local test servers`)
  if (url.username || url.password || url.search || url.hash)
    throw new Error(`${name} must not contain credentials, a query, or a fragment`)
  return url
}
