## Pretext text-video engine plan

This repo can support a high-customization text-video renderer by leaning into what Pretext already does unusually well:

- deterministic multiline text layout from cached metrics
- rich line extraction via `prepareWithSegments()` + `layoutWithLines()`
- resolution-independent layout decisions that can feed SVG, Canvas, WebGL, or server-side outputs

The engine is intentionally semantic-first instead of pixel-first.

### Core idea

Represent a video as:

1. a semantic project file describing scenes, text layers, fonts, timings, and animation curves
2. a compressed archive format that stores the semantic source instead of pre-rendered pixels
3. a renderer that expands that semantic source into arbitrarily high-resolution SVG/PNG/MP4 outputs

That gives us:

- extremely high output resolutions without reauthoring
- text that stays editable and compact while stored
- future room for alternate targets like posters, animated SVG, sprite sheets, or real-time previews

## What is now implemented

### Runtime/build dependencies

- `@napi-rs/canvas`
  - headless canvas backend for Node
  - used to provide `OffscreenCanvas`-compatible measurement for Pretext during offline rendering
- `@resvg/resvg-js`
  - SVG to PNG rasterization for arbitrary export scale
  - lets us keep layout/rendering vector-first but still emit raster frames for ffmpeg
- `zod`
  - schema validation for the semantic text-video project format

### Commands

- `npm run text-video:init -- --out=examples/text-video/projects/my-video`
  - creates a starter semantic text-video project
- `npm run text-video:encode -- --input=project.json --output=video.ptxv`
  - compresses a project into a `.ptxv` bundle
- `npm run text-video:decode -- --input=video.ptxv [--output=video.decoded.json]`
  - restores the project JSON from the bundle
- `npm run build:package`
- `npm run text-video:render -- --input=project.(json|ptxv) [--out=out/text-video/sample] [--scale=1] [--svg] [--video]`
  - renders SVG frames, PNG frames, and an `mp4` if `ffmpeg` is available

## Semantic storage format

The current `pretext-text-video` schema supports:

- project metadata
- video dimensions and FPS
- asset manifests for fonts and images
- multi-scene timelines
- scene transitions
- layer unions:
  - `text`
  - `image`
  - `shape`
  - `group`
- keyframe-capable animated values for numeric and string properties

### Why semantic storage matters

If we stored rendered pixels, "high resolution" would explode storage and make tuning painful.

Instead the `.ptxv` format stores:

- JSON metadata
- gzipped UTF-8 payload

The current `.ptxv` container now supports:

- versioned bundle manifests
- embedded local assets referenced by the project
- legacy decode support for older header + gzipped-JSON bundles

Still not implemented in the container:

- audio embedding/mux metadata
- line-layout cache snapshots
- deduplicated symbol dictionaries

## Renderer shape

The current renderer is:

- server-side
- vector-first
- composition focused

For each frame it will:

1. choose the active scene
2. evaluate keyframed properties at the current timestamp
3. register fonts for measurement/rasterization
4. evaluate scene transitions
5. run `prepareWithSegments()` with the resolved font for text layers
6. call `layoutWithLines()` for exact line breaking
7. emit SVG for:
   - text
   - shapes
   - images
   - nested groups
8. rasterize to PNG through Resvg
9. optionally hand the frame sequence to `ffmpeg`

## Why this scales to very high resolution

Pretext computes line decisions from measured text widths, not from DOM layout trees.

That means the high-cost part is semantic layout, not display resolution.

By emitting SVG:

- line placement stays crisp at any size
- export scale can be changed late
- text remains an authored primitive instead of a baked bitmap

PNG and MP4 are derived outputs, not the source of truth.

## Current forced gaps

These gaps remain after the current implementation pass:

- no audio muxing in the render pipeline yet
- no browser-side project import/export beyond the built-in sample/studio state
- no timeline curve editor or richer authoring UI than the basic studio controls
- no dedicated masking/blend-mode/effect stack
- no automated browser UI test for the studio page
- static site build still depends on Bun being present in PATH in the environment

## Near-term next steps

### 1. Richer timeline/composition model

Add:

- per-layer enter/exit transitions
- per-line animation controls
- camera transforms
- scene overlap and compositing
- audio track support

### 2. More layout power from Pretext

Add:

- obstacle-aware text flow using `layoutNextLine()`
- shrink-wrap captions using `walkLineRanges()`
- text on paths / curved baselines
- balanced multiline titles
- multi-column editorial flows
- line-level reveal and karaoke timing

### 3. Better storage/compression

Evolve `.ptxv` into an archive that can:

- embed fonts and assets more selectively
- store reusable symbol dictionaries
- delta-compress repeated captions across frames/scenes
- cache line geometry for low-latency previews

### 4. Preview and authoring

Add:

- browser preview demo under `pages/demos/`
- scrubber and property editor
- import/export of project JSON
- preset packs for lyric videos, motion posters, subtitles, editorial reels

## Validation checkpoints

The current implementation has been exercised with:

1. TypeScript repo-wide typecheck (`npx tsc --pretty false`)
2. package build (`npm run build:package`)
3. sample project scaffolding (`npm run text-video:init`)
4. project bundle encode/decode (`npm run text-video:encode`, `npm run text-video:decode`)
5. frame rendering from JSON and bundled `.ptxv` (`npm run text-video:render`)
6. package smoke test through Bun invoked via `npx --yes bun`

The site build was attempted via `npx --yes bun run scripts/build-demo-site.ts` and currently fails because the build pipeline tries to bundle Node-only `.node` native dependencies into the browser build.

## Example workflow

```sh
npm run text-video:init -- --out=examples/text-video/projects/sample
npm run text-video:encode -- --input=examples/text-video/projects/sample/project.json --output=examples/text-video/projects/sample/project.ptxv
npm run text-video:decode -- --input=examples/text-video/projects/sample/project.ptxv
npm run build:package
npm run text-video:render -- --input=examples/text-video/projects/sample/project.json --out=out/text-video/sample --scale=1 --svg --video
```

## Design constraints to keep

- keep Pretext as the authoritative line-layout engine
- keep storage semantic by default
- keep output vector-first where possible
- avoid baking DOM assumptions into offline rendering
- keep the package export surface unchanged until the internal API settles
