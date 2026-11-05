import { Match, Show, Switch } from "solid-js"
import { TextAttributes, type MouseEvent, type RGBA } from "@opentui/core"
import type { JSX } from "@opentui/solid"
import type {
  SessionMessageAssistant,
  SessionMessageAssistantReasoning,
  SessionMessageAssistantText,
} from "@opencode/client"
import { Spinner } from "../../component/spinner"
import { useTheme, useThemes } from "../../context/theme"
import { usePlugin } from "../../plugin/context"
import { use } from "./render-context"
import { canonicalToolName } from "../../util/tool-display"

export const INLINE_TOOL_ICON_WIDTH = 2

const toolDisplays = new Set([
  "shell",
  "glob",
  "read",
  "grep",
  "webfetch",
  "websearch",
  "write",
  "edit",
  "subagent",
  "execute",
  "patch",
  "todowrite",
  "question",
  "skill",
])

export function toolDisplay(tool: string) {
  const normalized = canonicalToolName(tool)
  return toolDisplays.has(normalized) ? normalized : "generic"
}

export function ReasoningPart(props: {
  last: boolean
  part: SessionMessageAssistantReasoning
  message: SessionMessageAssistant
}) {
  const theme = useTheme()
  return (
    <Show when={props.part.time?.completed === undefined && props.message.time.completed === undefined}>
      <InlineToolRow icon="" color={theme.text.base} complete={false} pending="Думаю…" spinner>
        Думаю…
      </InlineToolRow>
    </Show>
  )
}

export function TextPart(props: {
  last: boolean
  part: SessionMessageAssistantText
  message: SessionMessageAssistant
}) {
  const ctx = use()
  const theme = useTheme()
  const { currentSyntax: syntax } = useThemes()
  const plugins = usePlugin()
  return (
    <Show when={props.part.text.trim()}>
      <box paddingLeft={3} flexShrink={0}>
        {/* Configure custom nodes before parsing; apply content before streaming so completion keeps the final tokens. */}
        <markdown
          syntaxStyle={syntax()}
          renderNode={plugins.markdown()}
          content={props.part.text.trim()}
          streaming={props.message.time.completed === undefined}
          internalBlockMode="top-level"
          tableOptions={{ style: "grid", cellPaddingX: 1 }}
          conceal={ctx.markdownMode() === "rendered"}
          fg={theme.markdown.text}
          bg={theme.background.base}
        />
      </box>
    </Show>
  )
}

export function InlineToolRow(props: {
  icon: string
  iconColor?: RGBA
  color?: RGBA
  errorColor?: RGBA
  failed?: boolean
  denied?: boolean
  error?: string
  errorExpanded?: boolean
  complete: unknown
  pending: string
  failure?: string
  spinner?: boolean
  status?: JSX.Element
  children: JSX.Element
  onMouseOver?: () => void
  onMouseOut?: () => void
  onMouseUp?: (event: MouseEvent) => void
}) {
  return (
    <box paddingLeft={3} onMouseOver={props.onMouseOver} onMouseOut={props.onMouseOut} onMouseUp={props.onMouseUp}>
      <Switch>
        <Match when={props.spinner}>
          <Show when={props.status} fallback={<Spinner color={props.color} children={props.children} />}>
            {(status) => (
              <box flexDirection="row" gap={1}>
                <Spinner color={props.color} />
                <InlineToolLabel color={props.color} status={status()}>
                  {props.children}
                </InlineToolLabel>
              </box>
            )}
          </Show>
        </Match>
        <Match when={true}>
          <Show fallback={<Spinner color={props.color}>{props.pending}</Spinner>} when={props.complete || props.failed}>
            <box flexDirection="row">
              <text
                width={INLINE_TOOL_ICON_WIDTH}
                fg={props.failed ? props.errorColor : (props.iconColor ?? props.color)}
                attributes={props.denied ? TextAttributes.STRIKETHROUGH : undefined}
              >
                {props.icon}
              </text>
              <Show
                when={props.status}
                fallback={
                  <text
                    flexGrow={1}
                    fg={props.failed ? props.errorColor : props.color}
                    attributes={props.denied ? TextAttributes.STRIKETHROUGH : undefined}
                  >
                    {props.failed && !props.complete ? (props.failure ?? props.children) : props.children}
                  </text>
                }
              >
                {(status) => (
                  <InlineToolLabel
                    color={props.failed ? props.errorColor : props.color}
                    denied={props.denied}
                    status={status()}
                  >
                    {props.failed && !props.complete ? (props.failure ?? props.children) : props.children}
                  </InlineToolLabel>
                )}
              </Show>
            </box>
          </Show>
        </Match>
      </Switch>
      <Show when={props.failed && props.errorExpanded}>
        <box paddingLeft={INLINE_TOOL_ICON_WIDTH}>
          <text fg={props.errorColor}>{props.error}</text>
        </box>
      </Show>
    </box>
  )
}

function InlineToolLabel(props: { color?: RGBA; denied?: boolean; status: JSX.Element; children: JSX.Element }) {
  return (
    <box flexDirection="row" flexWrap="wrap" columnGap={1} flexGrow={1}>
      <text
        maxWidth="100%"
        flexShrink={0}
        fg={props.color}
        attributes={props.denied ? TextAttributes.STRIKETHROUGH : undefined}
      >
        {props.children}
      </text>
      {props.status}
    </box>
  )
}
