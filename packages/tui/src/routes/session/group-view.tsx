import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js"
import type { Renderable } from "@opentui/core"
import { useRenderer, type JSX } from "@opentui/solid"
import type { SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client"
import { useTheme } from "../../context/theme"
import { EntryAnchor, GroupAnchor, visitEntries } from "./anchor-view"
import { groupID } from "./anchors"
import { instructionPaths, type PartRef, type SessionEntry, type SessionGroup, type SessionNode } from "./grouping/session"
import { summarizeActivity } from "./activity-summary"
import { InlineToolRow, toolDisplay } from "./message-parts"
import { use } from "./render-context"
import { resolvePart } from "./rows"

type Renderers = {
  message: (messageID: string) => SessionMessageInfo | undefined
  entry: (entry: SessionEntry, images?: boolean) => JSX.Element
  images: (parts: readonly SessionMessageAssistantTool[]) => JSX.Element
}

type GroupProps = Renderers & {
  node: Extract<SessionNode, { type: "group" }>
  level: number
  completed: boolean
  pending: readonly PartRef[]
  pendingOutside?: boolean
  imagesOutside?: boolean
  reasoningStatusOutside?: boolean
}

export function SessionGroupView(props: Renderers & { row: SessionGroup }) {
  return (
    <Group
      {...props}
      node={props.row}
      level={0}
      completed={props.row.completed}
      pending={props.row.kind === "exploration" || props.row.kind === "activity" ? props.row.pending : []}
    />
  )
}

function Group(props: GroupProps) {
  // Keep kind-specific hover/title state isolated during reconciliation.
  return (
    <Show when={props.node.kind} keyed>
      {(kind) => (
        <Switch fallback={<GroupContent {...props} />}>
          <Match when={kind === "activity"}>
            <ActivityGroup {...props} />
          </Match>
          <Match when={kind === "instructions"}>
            <InstructionsGroup {...props} />
          </Match>
          <Match when={kind === "reasoning"}>
            <ReasoningGroup {...props} />
          </Match>
        </Switch>
      )}
    </Show>
  )
}

function ReasoningGroup(props: GroupProps) {
  const theme = useTheme()
  const active = createMemo(
    () =>
      !props.completed &&
      !props.reasoningStatusOutside &&
      descendants(props.node).some((entry) => {
        if (entry.type !== "part") return false
        const message = props.message(entry.ref.messageID)
        if (message?.type !== "assistant" || message.time.completed !== undefined) return false
        const part = resolvePart(message, entry.ref.partID)
        return part?.type === "reasoning" && part.time?.completed === undefined
      }),
  )
  return (
    <GroupAnchor groupID={groupID(props.node, props.level)} active={active()}>
      <Show when={active()}>
        <InlineToolRow icon="" color={theme.text.base} complete={false} pending="Думаю…" spinner>
          Думаю…
        </InlineToolRow>
      </Show>
    </GroupAnchor>
  )
}

function GroupContent(props: GroupProps) {
  const ctx = use()
  const theme = useTheme()
  const disclosure = useDisclosure(props)
  const id = disclosure.id
  const expanded = disclosure.expanded
  const [hover, setHover] = createSignal(false)
  const entries = createMemo(() => descendants(props.node))
  const refs = createMemo(() =>
    entries().flatMap((entry) => (entry.type === "part" && !isPending(entry, props.pending) ? [entry.ref] : [])),
  )
  const tools = createMemo(() =>
    props.node.kind !== "exploration"
      ? []
      : refs().flatMap((ref) => {
          const message = props.message(ref.messageID)
          if (message?.type !== "assistant") return []
          const part = resolvePart(message, ref.partID)
          return part?.type === "tool" ? [part] : []
        }),
  )
  const grouped = () => ctx.groupExploration()
  const completed = () =>
    props.completed || (tools().length > 0 && tools().every((part) => part.time.completed !== undefined))
  const label = createMemo(() => {
    const counts = tools().reduce<Record<string, number>>((result, part) => {
      const tool = toolDisplay(part.name)
      const name =
        tool === "grep" || tool === "glob" || tool === "websearch" ? "search" : tool === "webfetch" ? "fetch" : tool
      result[name] = (result[name] ?? 0) + 1
      return result
    }, {})
    const names = Object.entries(counts).map(
      ([name, count]) =>
        `${count} ${count === 1 ? name : name === "search" || name === "fetch" ? `${name}es` : `${name}s`}`,
    )
    return `${completed() ? "Explored" : "Exploring"}: ${names.join(", ")}`
  })
  const toggle = () => disclosure.toggle()
  const children = (mode: "normal" | "tool") => (
    <Children {...props} nodes={props.node.children} mode={mode} />
  )

  return (
    <GroupAnchor groupID={id()} active={grouped() && tools().length > 0}>
      <Show when={grouped()} fallback={children("normal")}>
        <Show when={tools().length > 0}>
          <InlineToolRow
            icon={completed() ? "→" : "✱"}
            color={hover() ? theme.text.base : theme.text.muted}
            complete={completed()}
            pending={label()}
            spinner={!completed()}
            onMouseOver={() => setHover(true)}
            onMouseOut={() => setHover(false)}
            onMouseUp={toggle}
          >
            {label()}
          </InlineToolRow>
        </Show>
        <Show when={expanded() && tools().length > 0}>{children("tool")}</Show>
        <Show when={!props.imagesOutside}>{props.images(tools())}</Show>
      </Show>
      <PendingEntries {...props} entries={entries()} />
    </GroupAnchor>
  )
}

/** Low verbosity: one summary for a run of tools, thoughts and instruction loads. */
function ActivityGroup(props: GroupProps) {
  const theme = useTheme()
  const disclosure = useDisclosure(props)
  const [hover, setHover] = createSignal(false)
  const entries = createMemo(() => descendants(props.node))
  const summary = createMemo(() => summarizeActivity(props.node, props.message, props.pending, props.completed))
  return (
    <GroupAnchor groupID={disclosure.id()} active={summary().label !== ""}>
      <Show when={summary().label}>
        <InlineToolRow
          icon={disclosure.expanded() ? "−" : "+"}
          color={hover() ? theme.text.base : theme.text.muted}
          complete={true}
          pending={summary().label}
          spinner={!disclosure.expanded() && summary().active}
          onMouseOver={() => setHover(true)}
          onMouseOut={() => setHover(false)}
          onMouseUp={(event) => disclosure.toggle(event.currentTarget)}
        >
          {summary().label}
        </InlineToolRow>
        <Show when={disclosure.expanded()}>
          <box flexDirection="column" gap={1} marginTop={1}>
            <Children {...props} nodes={props.node.children} mode="normal" reasoningStatusOutside />
          </box>
        </Show>
      </Show>
      <PendingEntries {...props} entries={entries()} />
    </GroupAnchor>
  )
}

/** Consecutive instruction loads, summarized by the number of distinct files. */
function InstructionsGroup(props: GroupProps) {
  const theme = useTheme()
  const disclosure = useDisclosure(props)
  const [hover, setHover] = createSignal(false)
  const files = createMemo(
    () =>
      new Set(
        descendants(props.node).flatMap((entry) =>
          entry.type === "message" ? instructionPaths(props.message(entry.messageID)) : [],
        ),
      ).size,
  )
  return (
    <GroupAnchor groupID={disclosure.id()} active={files() > 0}>
      <InlineToolRow
        icon="◈"
        color={hover() ? theme.text.base : theme.text.muted}
        complete={true}
        pending=""
        onMouseOver={() => setHover(true)}
        onMouseOut={() => setHover(false)}
        onMouseUp={() => disclosure.toggle()}
      >
        Instructions: {files()} {files() === 1 ? "file" : "files"}
      </InlineToolRow>
      <Show when={disclosure.expanded()}>
        <Children {...props} nodes={props.node.children} mode="normal" />
      </Show>
    </GroupAnchor>
  )
}

function useDisclosure(props: GroupProps) {
  const ctx = use()
  const renderer = useRenderer()
  const id = createMemo(() => groupID(props.node, props.level))
  const expanded = () => {
    const key = id()
    return key ? ctx.groupExpanded(key, props.node.kind) : false
  }
  return {
    id,
    expanded,
    toggle(anchor?: Renderable | null) {
      if (renderer.getSelection()?.getSelectedText()) return
      const key = id()
      if (key) ctx.setGroupExpanded(key, !expanded(), anchor)
    },
  }
}

function descendants(node: Extract<SessionNode, { type: "group" }>) {
  const result: SessionEntry[] = []
  visitEntries(node.children, (entry) => result.push(entry))
  return result
}

/** Permission-blocked tools stay visible below the root group, even when collapsed. */
function PendingEntries(props: GroupProps & { entries: readonly SessionEntry[] }) {
  return (
    <Show when={!props.pendingOutside}>
      <For each={props.pending}>
        {(ref) => {
          const leaf = createMemo(() =>
            props.entries.find(
              (entry) =>
                entry.type === "part" && entry.ref.messageID === ref.messageID && entry.ref.partID === ref.partID,
            ),
          )
          return <Show when={leaf()}>{(item) => <EntryAnchor entry={item()}>{props.entry(item())}</EntryAnchor>}</Show>
        }}
      </For>
    </Show>
  )
}

function Children(props: GroupProps & { nodes: readonly SessionNode[]; mode: "normal" | "tool" }) {
  return (
    <For each={props.nodes}>
      {(node, index) => {
        return (
          <Switch>
            <Match when={node.type === "group" ? node : undefined}>
              {(node) => (
                <Group
                  {...props}
                  node={node()}
                  level={props.level + 1}
                  pendingOutside
                  imagesOutside={props.imagesOutside || props.mode === "tool"}
                  completed={
                    props.completed ||
                    props.nodes
                      .slice(index() + 1)
                      .some((next) => next.type === "group" || !isPending(next.entry, props.pending)) ||
                    (node().kind === "reasoning" && reasoningCompleted(node().children, props.message))
                  }
                />
              )}
            </Match>
            <Match when={node.type === "entry" ? node : undefined}>
              {(node) => (
                <Show when={!isPending(node().entry, props.pending)}>
                  <EntryAnchor entry={node().entry}>
                    {props.entry(node().entry, props.mode === "tool" ? false : undefined)}
                  </EntryAnchor>
                </Show>
              )}
            </Match>
          </Switch>
        )
      }}
    </For>
  )
}

function isPending(entry: SessionEntry, pending: readonly PartRef[]) {
  return (
    entry.type === "part" &&
    pending.some((ref) => ref.messageID === entry.ref.messageID && ref.partID === entry.ref.partID)
  )
}

function reasoningCompleted(nodes: readonly SessionNode[], message: Renderers["message"]): boolean {
  return nodes.every((node) => {
    if (node.type === "group") return reasoningCompleted(node.children, message)
    if (node.entry.type !== "part") return false
    const item = message(node.entry.ref.messageID)
    if (item?.type !== "assistant") return false
    const part = resolvePart(item, node.entry.ref.partID)
    return part?.type === "reasoning" && part.time?.completed !== undefined
  })
}
