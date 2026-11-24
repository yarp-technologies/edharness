import { stringWidth } from "./string-width"
import { english } from "@opencode/ui/i18n/en"
import { dict } from "@opencode/ui/i18n/ru"
import tuiRussian from "./locale.ru"
import { duration as compactDuration } from "@opencode/util/duration"

export type Language = "en" | "ru"

const russian = new Map(Object.entries(dict))
const sharedRussian = Object.entries(english).reduce(
  (result, [key, value]) => {
    const translated = russian.get(key)
    if (translated && translated !== value && result[value] === undefined) result[value] = translated
    return result
  },
  {} as Record<string, string>,
)

const dynamicPatterns: readonly [RegExp, string][] = [
  [/^Connect (.+)$/, "Подключить $1"],
  [/^Connected (.+)$/, "Подключено: $1"],
  [/^Disconnected (.+)$/, "Отключено: $1"],
  [/^Press (.+) again to confirm$/, "Нажмите $1 ещё раз для подтверждения"],
  [/^Switch to session in quick slot (\d+)$/, "Перейти к сессии в быстром слоте $1"],
  [/^Switch to tab (\d+)$/, "Перейти к вкладке $1"],
  [/^MCP server failed: (.+)$/, "Ошибка MCP-сервера: $1"],
  [/^(\d+(?:\.\d+)?)% used$/, "Использовано $1%"],
  [/^(\$[\d,.]+) spent$/, "Потрачено $1"],
  [/^Connect "(.+)" to use its tools\.$/, "Подключите «$1», чтобы использовать его инструменты."],
  [/^Session "(.+)" was deleted$/, "Сессия «$1» удалена"],
  [/^Switched agent to (.+)$/, "Выбран агент: $1"],
  [/^Switched agent from (.+) to (.+)$/, "Агент изменён: $1 → $2"],
  [/^Retrying in (\d+)s$/, "Повтор через $1 с"],
  [/^Skill (.+)$/, "Навык: $1"],
  [/^Edit (.+)$/, "Изменить $1"],
  [/^Read (.+)$/, "Прочитать $1"],
  [/^List (.+)$/, "Список: $1"],
  [/^Glob "(.*)"$/, "Поиск файлов: «$1»"],
  [/^Grep "(.*)"$/, "Поиск текста: «$1»"],
  [/^Access external directory (.+)$/, "Доступ к внешней папке $1"],
  [/^Path: (.+)$/, "Путь: $1"],
  [/^Pattern: (.*)$/, "Шаблон: $1"],
  [/^Operation: (.+)$/, "Операция: $1"],
  [/^Position: (.+)$/, "Позиция: $1"],
  [/^Query: (.*)$/, "Запрос: $1"],
  [/^URL: (.+)$/, "Ссылка: $1"],
  [/^This will always allow (.+) for this project\.$/, "Это действие всегда будет разрешено для проекта: $1."],
  [/^\+(\d+) more$/, "+$1 ещё"],
]

export function text(value: string): string {
  return textFor(value)
}

export function textFor(value: string, language: Language = locale()): string {
  if (language === "en") return value
  return tuiRussian[value] ?? sharedRussian[value] ?? dynamicRussian(value) ?? value
}

function dynamicRussian(value: string): string | undefined {
  const tokens = value.match(/^([\d,.\s\u00a0\u202f]+) tokens$/)
  if (tokens) {
    const count = Number(tokens[1].replace(/\D/g, ""))
    const mod100 = count % 100
    const mod10 = count % 10
    const unit =
      mod10 === 1 && mod100 !== 11
        ? "токен"
        : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
          ? "токена"
          : "токенов"
    return `${count.toLocaleString(locale())} ${unit}`
  }
  const reverted = value.match(/^(\d+) messages? reverted$/)
  if (reverted) {
    const count = Number(reverted[1])
    const mod100 = count % 100
    const mod10 = count % 10
    if (mod10 === 1 && mod100 !== 11) return `${count} сообщение отменено`
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} сообщения отменено`
    return `${count} сообщений отменено`
  }
  const connections = value.match(/^(\d+) connections$/)
  if (connections) {
    const count = Number(connections[1])
    const mod100 = count % 100
    const mod10 = count % 10
    const word = mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "подключения" : "подключений"
    return `${count} ${word}`
  }
  for (const [pattern, replacement] of dynamicPatterns) {
    if (pattern.test(value)) return value.replace(pattern, replacement)
  }
}

export function titlecase(str: string) {
  return str.replace(/\b\w/g, (c) => c.toUpperCase())
}

export function time(input: number): string {
  const date = new Date(input)
  return date.toLocaleTimeString(locale(), { timeStyle: "short" })
}

export function datetime(input: number): string {
  const date = new Date(input)
  const localTime = time(input)
  const localDate = date.toLocaleDateString(locale())
  return `${localTime} · ${localDate}`
}

export function number(num: number): string {
  // 999950+ would round to "1000.0K"
  if (num >= 999950) {
    return (num / 1000000).toFixed(1) + "M"
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + "K"
  }
  return num.toString()
}

const durationUnits: Record<string, string> = { ms: "мс", s: "с", m: "м", h: "ч", d: "д" }

export function duration(input: number): string {
  const value = compactDuration(input)
  if (locale() === "en") return value
  return value.replace(/(\d+(?:\.\d+)?)(ms|s|m|h|d)/g, (_, amount: string, unit: string) => amount + durationUnits[unit])
}

export function truncate(str: string, len: number): string {
  if (str.length <= len) return str
  return str.slice(0, len - 1) + "…"
}

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })

export function graphemes(str: string) {
  return Array.from(graphemeSegmenter.segment(str), (item) => item.segment)
}

export function takeWidth(str: string, width: number) {
  if (width <= 0) return ""
  if (stringWidth(str) <= width) return str

  const result: string[] = []
  let used = 0
  for (const segment of graphemes(str)) {
    const next = stringWidth(segment)
    if (used + next > width) break
    result.push(segment)
    used += next
  }
  return result.join("")
}

export function truncateWidth(str: string, width: number): string {
  if (width <= 0) return ""
  if (stringWidth(str) <= width) return str
  if (width === 1) return "…"
  return takeWidth(str, width - 1) + "…"
}

export function truncateLeft(str: string, len: number): string {
  if (str.length <= len) return str
  return "…" + str.slice(-(len - 1))
}

export function truncateMiddle(str: string, maxLength: number = 35): string {
  if (maxLength <= 0) return ""
  if (str.length <= maxLength) return str

  const ellipsis = "…"
  const keepStart = Math.ceil((maxLength - ellipsis.length) / 2)
  const keepEnd = Math.floor((maxLength - ellipsis.length) / 2)
  if (keepEnd <= 0) return str.slice(0, keepStart) + ellipsis

  return str.slice(0, keepStart) + ellipsis + str.slice(-keepEnd)
}

function locale(): Language {
  return (process.env.EDHARNESS_LANGUAGE ?? "ru").toLowerCase().startsWith("en") ? "en" : "ru"
}

export * as Locale from "./locale"
