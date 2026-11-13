/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { RGBA } from "@opentui/core"
import { expect, test } from "bun:test"
import { resolveThemeDocument } from "@opencode/theme/tui"
import { ConfigProvider, useConfig, type Info } from "../../src/config"
import { ThemeProvider, useTheme, useThemes } from "../../src/context/theme"
import { getEdHarnessTheme, getOpenCode2Theme, getOpenCodeTheme } from "../../src/theme"
import { emptyThemeSource, tmpdir } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { Logo } from "../../src/component/logo"

test.each([20, 30] as const)("shows the EdHarness name in a %s-column terminal", async (width) => {
  await using temporary = await tmpdir()
  const app = await testRender(
    () => (
      <TestTuiContexts paths={{ state: temporary.path }}>
        <ConfigProvider config={createTuiResolvedConfig({})} service={{ get: async () => ({}), update: async () => ({}) }}>
          <ThemeProvider mode="dark" source={emptyThemeSource}>
            <Logo />
          </ThemeProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width, height: 18 },
  )

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("EdHarness")
  } finally {
    app.renderer.destroy()
  }
})

test.each([
  { mode: "dark", background: "#120f0d", accent: "#8a9bff" },
  { mode: "light", background: "#f1f1f6", accent: "#4f46e5" },
] as const)("uses the EdHarness palette by default in $mode mode", async ({ mode, background, accent }) => {
  await using temporary = await tmpdir()
  let themes!: ReturnType<typeof useThemes>
  let theme!: ReturnType<typeof useTheme>
  function Probe() {
    themes = useThemes()
    theme = useTheme()
    return null
  }
  const app = await testRender(() => (
    <TestTuiContexts paths={{ state: temporary.path }}>
      <ConfigProvider config={createTuiResolvedConfig({})} service={{ get: async () => ({}), update: async () => ({}) }}>
        <ThemeProvider mode={mode} source={emptyThemeSource}>
          <Probe />
        </ThemeProvider>
      </ConfigProvider>
    </TestTuiContexts>
  ))

  try {
    await app.renderOnce()
    expect(themes.selected).toBe("edharness")
    expect(themes.has("opencode")).toBeTrue()
    expect(theme.background.base.equals(RGBA.fromHex(background))).toBeTrue()
    expect(theme.text.formfield.selected.equals(RGBA.fromHex(accent))).toBeTrue()
  } finally {
    app.renderer.destroy()
  }
})

test("keeps an explicitly selected OpenCode theme", async () => {
  await using temporary = await tmpdir()
  let themes!: ReturnType<typeof useThemes>
  let theme!: ReturnType<typeof useTheme>
  function Probe() {
    themes = useThemes()
    theme = useTheme()
    return null
  }
  const settings: Info = { theme: { name: "opencode", mode: "light" } }
  const app = await testRender(() => (
    <TestTuiContexts paths={{ state: temporary.path }}>
      <ConfigProvider config={createTuiResolvedConfig(settings)} service={{ get: async () => settings, update: async () => settings }}>
        <ThemeProvider mode="dark" source={emptyThemeSource}>
          <Probe />
        </ThemeProvider>
      </ConfigProvider>
    </TestTuiContexts>
  ))

  try {
    await app.renderOnce()
    expect(themes.selected).toBe("opencode")
    expect(theme.background.base.equals(resolveThemeDocument(getOpenCodeTheme(), "light").background.base)).toBeTrue()
  } finally {
    app.renderer.destroy()
  }
})

test("offers opencode2 only while the new designs experiment is enabled", async () => {
  await using temporary = await tmpdir()
  const settings: Info = {}
  let config!: ReturnType<typeof useConfig>
  let themes!: ReturnType<typeof useThemes>
  let theme!: ReturnType<typeof useTheme>
  function Probe() {
    config = useConfig()
    themes = useThemes()
    theme = useTheme()
    return null
  }
  const app = await testRender(() => (
    <TestTuiContexts paths={{ state: temporary.path }}>
      <ConfigProvider
        config={createTuiResolvedConfig(settings)}
        service={{
          get: async () => settings,
          update: async (update) => {
            update(settings)
            return settings
          },
        }}
      >
        <ThemeProvider mode="dark" source={emptyThemeSource}>
          <Probe />
        </ThemeProvider>
      </ConfigProvider>
    </TestTuiContexts>
  ))

  try {
    app.renderer.start()
    await app.waitForFrame(() => themes !== undefined)
    expect(themes.has("opencode2")).toBeFalse()
    expect(Object.keys(themes.all())).not.toContain("opencode2")
    expect(themes.set("opencode2")).toBeFalse()

    await config.update((draft) => {
      draft.experimental = { "new-designs": true }
    })
    expect(themes.has("opencode2")).toBeTrue()
    expect(themes.set("opencode2")).toBeTrue()
    expect(theme.background.base.equals(resolveThemeDocument(getOpenCode2Theme(), "dark").background.base)).toBeTrue()

    await config.update((draft) => {
      draft.experimental = { "new-designs": false }
    })
    expect(themes.has("opencode2")).toBeFalse()
    expect(theme.background.base.equals(resolveThemeDocument(getEdHarnessTheme(), "dark").background.base)).toBeTrue()
    expect(themes.selected).toBe("opencode2")
    expect(settings.theme?.name).toBe("opencode2")
  } finally {
    app.renderer.destroy()
  }
})
