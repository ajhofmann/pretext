## Pretext text-video engine bootstrap plan

This repo can support a high-customization text-video renderer by leaning into what Pretext already does unusually well:

- deterministic multiline text layout from cached metrics
- rich line extraction via `prepareWithSegments()` + `layoutWithLines()`
- resolution-independent layout decisions that can feed SVG, Canvas, WebGL, or server-side outputs

The bootstrap added in this change is intentionally semantic-first instead of pixel-first.

### Core idea

Represent a video as:

1. a semantic project file describing scenes, text layers, fonts, timings, and animation curves
2. a compressed archive format that stores the semantic source instead of pre-rendered pixels
3. a renderer that expands that semantic source into arbitrarily high-resolution SVG/PNG/MP4 outputs

That gives us:

- extremely high output resolutions without reauthoring
- text that stays editable and compact while stored
- future room for alternate targets like posters, animated SVG, sprite sheets, or real-time previews

## What was initialized

### New dependencies

- `@napi-rs/canvas`
  - headless canvas backend for Node
  - used to provide `OffscreenCanvas`-compatible measurement for Pretext during offline rendering
- `@resvg/resvg-js`
  - SVG to PNG rasterization for arbitrary export scale
  - lets us keep layout/rendering vector-first but still emit raster frames for ffmpeg
- `zod`
  - schema validation for the semantic text-video project format

### New commands

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

The bootstrap defines a simple `pretext-text-video` schema:

- project metadata
- video dimensions and FPS
- font list
- scenes
- text layers
- animated numeric properties (`from`, `to`, `easing`)

### Why semantic storage matters

If we stored rendered pixels, "high resolution" would explode storage and make tuning painful.

Instead the `.ptxv` format stores:

- JSON metadata
- gzipped UTF-8 payload

This is the first step toward a fuller archive format that can later include:

- embedded fonts
- image assets
- audio tracks
- per-scene reusable prepared-text caches
- deduplicated text fragments
- optional line-layout caches for preview acceleration

## Initial renderer shape

The current bootstrap renderer is:

- server-side
- vector-first
- text-layer focused

For each frame:

1. choose the active scene
2. evaluate animated properties at the current timestamp
3. register fonts for measurement/rasterization
4. run `prepareWithSegments()` with the resolved font
5. call `layoutWithLines()` for exact line breaking
6. emit SVG text lines with alignment, transforms, stroke, shadow, and background blocks
7. rasterize to PNG through Resvg
8. optionally hand the frame sequence to `ffmpeg`

## Why this scales to very high resolution

Pretext computes line decisions from measured text widths, not from DOM layout trees.

That means the high-cost part is semantic layout, not display resolution.

By emitting SVG:

- line placement stays crisp at any size
- export scale can be changed late
- text remains an authored primitive instead of a baked bitmap

PNG and MP4 are derived outputs, not the source of truth.

## Near-term next steps

### 1. Richer timeline/composition model

Add:

- layer enter/exit transitions
- keyframe arrays instead of simple `from/to`
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

- embed fonts and assets
- store reusable symbol dictionaries
- delta-compress repeated captions across frames/scenes
- cache line geometry for low-latency previews

### 4. Preview and authoring

Add:

- browser preview demo under `pages/demos/`
- scrubber and property editor
- live reload between project JSON and rendered preview
- preset packs for lyric videos, motion posters, subtitles, editorial reels

## Suggested implementation sequence

1. Keep the semantic project format stable enough for iteration.
2. Add a browser demo/editor for previewing the same project schema.
3. Expand the renderer from plain text layers to grouped compositions and obstacles.
4. Add asset embedding to the `.ptxv` archive.
5. Add tests for schema validation, encode/decode roundtrips, and basic render invariants.

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
