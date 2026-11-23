import { createContext, createMemo, For, Show, useContext, type Accessor } from "solid-js"
import type { JSX } from "@opentui/solid"
import type { SessionMessageInfo } from "@opencode/client"
import { canonicalToolName } from "../../util/tool-display"
import { resolvePart, type SessionRow } from "./rows"

const RepetitionCount = createContext<Accessor<number>>(() => 1)
type MessageLookup = (messageID: string) => SessionMessageInfo | undefined

type Props = {
  readonly rows: readonly SessionRow[]
  readonly start: Accessor<number>
  readonly end: Accessor<number>
  readonly boundaries: Accessor<readonly (string | undefined)[]>
  readonly repetitions: Accessor<readonly number[]>
  readonly render: (row: SessionRow, boundaryID?: string) => JSX.Element
}

export function SessionRowsView(props: Props) {
  const visible = createMemo(() => props.rows.slice(props.start(), props.end()))

  return (
    <For each={visible()}>
      {(row, index) => {
        const rowIndex = () => props.start() + index()
        const repetitions = () => displayCount(props.repetitions(), rowIndex(), props.start())
        return (
          <Show when={repetitions() > 0}>
            <RepetitionCount.Provider value={repetitions}>
              {props.render(row, props.boundaries()[rowIndex()])}
            </RepetitionCount.Provider>
          </Show>
        )
      }}
    </For>
  )
}

export function useRowRepetitions() {
  return useContext(RepetitionCount)
}

function displayCount(counts: readonly number[], index: number, visibleStart: number) {
  const count = counts[index] ?? 1
  if (count !== 0 || index !== visibleStart) return count
  let first = index
  while (first > 0 && counts[first] === 0) first--
  return counts[first] ?? 1
}

export function rowRepetitionCounts(
  rows: readonly SessionRow[],
  message: MessageLookup,
) {
  const counts = rows.map(() => 1)
  for (let index = 0; index < rows.length; ) {
    const row = rows[index]
    const key = row && openEdKey(row, message)
    if (!key) {
      index++
      continue
    }
    let end = index + 1
    while (end < rows.length && rows[end] && openEdKey(rows[end], message) === key) end++
    if (end - index > 1) {
      counts[index] = end - index
      for (let duplicate = index + 1; duplicate < end; duplicate++) counts[duplicate] = 0
    }
    index = end
  }
  return counts
}

function openEdKey(row: SessionRow, message: MessageLookup) {
  if (row.type !== "part") return
  const owner = message(row.ref.messageID)
  if (owner?.type !== "assistant") return
  const part = resolvePart(owner, row.ref.partID)
  if (part?.type !== "tool" || canonicalToolName(part.name) !== "opened_api" || part.state.status !== "completed")
    return
  return JSON.stringify([part.name, part.state.input])
}
