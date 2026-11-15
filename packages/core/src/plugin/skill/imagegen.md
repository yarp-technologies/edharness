# Image generation

In EdHarness, always use the native `experimental_image_generate` tool when
the user asks for a new raster image or wants to edit one. For OpenEd, it uses
the active OpenEd authorization and configured OpenEd LLM service. Leave its
`model` unset. Never search for Bifrost or other provider credentials, and
never ask the user for an API key. If the native tool is unavailable for
OpenEd, explain that image generation is not configured on the OpenEd service.

Outside EdHarness, use the provider-hosted `image_generation` tool when it is
available for an OpenAI Codex OAuth Responses model. This path does not require
an API key.

## When to use it

Use it for photographs, illustrations, textures, sprites, product mockups,
wireframes, infographics, transparent cutouts, and visual variants. Prefer the
user's existing SVG, HTML/CSS, or other native project format when the request
is deterministic or specifically asks for vector/code-native output.

## Decide the operation

- Use generation when there is no edit target, or when supplied images are only
  references for style, composition, mood, or subject guidance.
- Use editing when the user wants to preserve an existing image while changing
  a specific part of it.
- For edits, state the invariants explicitly: what must change, what must stay
  unchanged, and what must be avoided.

## Prompting

Collect the prompt, intended use, exact text, constraints, and image roles
before calling the tool. For every supplied image, identify whether it is a
reference, edit target, style input, or compositing insert.

Structure prompts around the details that matter:

```text
Use case: <product-mockup, illustration-story, ui-mockup, ...>
Asset type: <where the image will be used>
Primary request: <the user's request>
Input images: <role of each image, if any>
Scene/backdrop: <environment>
Subject: <main subject>
Style/medium: <photo, illustration, 3D, ...>
Composition/framing: <view and placement>
Lighting/mood: <lighting and mood>
Text (verbatim): "<exact text, if any>"
Constraints: <must keep and must avoid>
```

Normalize a detailed request without inventing extra objects, branding, text,
or narrative. For a generic request, add only composition or polish details
that materially improve the result. Require exact rendering of user-provided
text and no watermark unless the user asks for one.

## Workflow

1. Decide whether this is generation or editing and whether the result is a
   preview or a project asset.
2. Inspect local edit targets with the available image/file inspection tool
   before editing them.
3. In EdHarness, call `experimental_image_generate` with a concise,
   production-ready prompt. Outside EdHarness, call Codex's provider-hosted
   `image_generation` tool when available.
4. Check the returned image against the subject, style, composition, text, and
   invariants. Iterate with one targeted change when necessary.
5. For a project asset, save or move the selected result into the workspace
   without overwriting an existing file unless replacement was requested.

If the applicable native image tool is unavailable, say so clearly. Do not
invent a fallback command or ask for an API key unless the user explicitly
requests a separate API-based workflow.

For transparent output, request a genuinely transparent background and retain
the alpha channel. For multiple distinct assets, make one tool call per asset;
do not use variants as a substitute for separate prompts.
