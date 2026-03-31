## mp4toascii — roadmap

Video-to-ASCII-text converter built on Pretext's text layout engine. The current implementation (`shared/mp4toascii/`, `scripts/mp4toascii.ts`) supports two modes:

- **Mono**: classic monospace brightness ramp. No layout engine needed.
- **Fusion**: readable text laid out by `prepareWithSegments()` + `layoutWithLines()`, with per-character brightness modulated from the source video. The text is real prose; the image emerges from opacity variation.

Output targets: terminal (ANSI), self-contained HTML with playback controls, MP4 re-render.

This document describes the phased plan for turning the current prototype into a full-featured tool.

---

## What is implemented

| Component | File | Status |
|-----------|------|--------|
| Frame extraction via ffmpeg / raw stdin | `shared/mp4toascii/extract.ts` | Working — `probeVideo()`, `extractFrames()`, `extractFramesFromRawVideo()` |
| Mono ASCII mapping | `shared/mp4toascii/ascii-map.ts` | Working — brightness ramp, optional color |
| Palette + dither + edge scoring | `shared/mp4toascii/palette.ts`, `dither.ts`, `edge.ts` | Working — proportional palette construction, Bayer dithering, Sobel direction analysis |
| Temporal + content helpers | `shared/mp4toascii/temporal.ts`, `content.ts`, `config.ts` | Working — smoothing, stability, cut heuristics, cue/bank selection, CLI config parsing |
| Fusion / routed text layout | `shared/mp4toascii/fusion.ts` | Working — fixed-line fusion, proportional palette mapping, routed silhouette/column/band/depth layouts |
| Output renderers | `shared/mp4toascii/render.ts`, `svg.ts` | Working — terminal ANSI, self-contained HTML, SVG, MP4 re-render |
| CLI | `scripts/mp4toascii.ts` | Working — mono/palette/fusion modes, presets, PTXV/SVG/MP4/ASCV output, stdin input |
| .ascv format | `shared/mp4toascii/ascv.ts` | Working — legacy `ASCV1` plus rich `ASCV2` encode/parse/playback |
| PTXV semantic export | `shared/text-video/ascii-video.ts` + text-video runtime | Working — rich glyph video asset/layer export and render |
| Browser demo | `pages/demos/mp4toascii.*` | Working — upload, playback, presets, split preview, export to HTML/ASCV/PTXV |

Dependencies: `ffmpeg` + `ffprobe` on PATH, `@napi-rs/canvas` for pixel buffer I/O, `dist/layout.js` for fusion mode (run `bun run build:package` first).

### .ascv shareable format

The `.ascv` format is a portable, gzip-compressed text container for ASCII video. Encode a video once, share the tiny `.ascv` file (typically 10–50KB), and anyone can play it back without the source video or any video processing tools.

Format:

- `ASCV1` magic (5 bytes) + gzip payload for classic grid frames
- `ASCV2` magic (5 bytes) + gzip JSON payload for positioned, styled rich glyph frames

`ASCV1` stores line-delimited text with a header line (cols, rows, fps, frame count, mode, color flag), then frame blocks. Each frame stores character lines with tab-separated hex brightness values and optional hex RGB color channels.

`ASCV2` stores the richer proportional/fusion representation: style tables, line buckets, and positioned glyph brightness/color data suitable for HTML/SVG/PTXV renderers.

```sh
bun run mp4toascii -- --input=video.mp4 --mode=mono --output=video.ascv
bun run mp4toascii -- --play=video.ascv
bun run mp4toascii -- --play=video.ascv --output=player.html
```

---

## Phase 1: High-resolution character rendering

Goal: make each frame look dramatically better by exploiting the full typographic palette.

### 1.1 Sub-character brightness via variable font weight

Render each cell as a `<span>` with continuously variable `font-weight` (CSS variable fonts: 1–999) and `opacity`. A single letter at weight 100 / opacity 0.3 looks very different from weight 900 / opacity 1.0. This gives thousands of effective brightness levels per cell instead of the current 25.

Pretext role: `prepareWithSegments()` measures character widths at each weight so we can keep cell widths stable as weight changes frame-to-frame.

### 1.2 Proportional-font rendering with width budgeting

Replace the fixed monospace grid with a proportional layout where each cell has a width budget (e.g. 8.6px). For each cell, pick the character + weight + style combination that best fills both the brightness target and the width budget.

This generalizes what `pages/demos/variable-typographic-ascii.ts` already does for live particle simulation to arbitrary video input.

Pretext role: `prepareWithSegments()` gives exact widths for every candidate glyph. `layoutWithLines()` ensures lines break correctly with variable-width characters. Without Pretext, proportional ASCII art requires per-frame DOM measurement.

### 1.3 Multi-style palettes

Expand the character palette to include italic, bold-italic, small-caps, and multiple font families. Each variant has different ink density at the same font size. More typographic range means finer brightness resolution.

Pretext role: measures all variants so we can freely mix them within a single line without breaking layout.

### 1.4 Ordered dithering

Apply Bayer-matrix or blue-noise dithering before the character lookup. This breaks up banding artifacts and creates the illusion of more tonal range, similar to newspaper halftone.

No Pretext dependency — pure pixel-space math applied before character selection.

### 1.5 Edge-directed character selection

Run a Sobel filter on each frame. Strong horizontal edges → `—` or `_`. Vertical → `|` or `!`. Diagonal → `/` or `\`. Flat areas → density-based characters. This makes edges in the video much crisper.

Pretext role: width-aware selection ensures edge characters fit the cell budget without misalignment.

---

## Phase 2: Temporal coherence and motion

Goal: smooth, natural animation instead of per-frame flickering.

### 2.1 Temporal brightness smoothing

Per-cell exponential moving average across frames: `smoothed[i] = α * current + (1−α) * previous`. Eliminates single-frame flicker where a cell jumps between characters at a brightness threshold boundary. The smoothing factor `α` is user-tunable.

### 2.2 Character stability scoring

When selecting a character for a cell, add a stability bonus if the same character appeared in the previous frame. The cell stays with its current character unless the brightness change exceeds a threshold. Lower threshold = smoother but less responsive; higher = more responsive but flickery.

### 2.3 Scrolling text fusion

In fusion mode, advance the text window by a configurable number of characters per frame so the prose scrolls while the brightness pattern evolves with the video. Scroll speed can be constant or modulated by the video's global brightness or motion energy.

Pretext role: `layoutWithLines()` is called each frame with a shifted text window. Because `prepare()` caches segment measurements, re-layout with shifted text is cheap — the expensive work is amortized.

### 2.4 Optical flow-guided text direction

Compute coarse block-matching optical flow between consecutive frames at the cell grid resolution. Use flow vectors to:

- Bias character selection toward directional glyphs matching the motion (rightward → prefer `>`, `/`)
- In fusion mode, shift text scroll direction to match dominant motion

### 2.5 Beat/energy-driven layout pulsing

Analyze frame-to-frame brightness variance as a proxy for visual energy. On high-energy frames (cuts, flashes), briefly tighten the layout width so text reflows into more lines, creating a visual pulse. On calm frames, relax the width.

Pretext role: `layout()` is the resize hot path — no DOM, no canvas, pure arithmetic. Changing width per-frame is exactly the use case it is optimized for.

---

## Phase 3: Layout-driven spatial composition

Goal: use Pretext's variable-width and obstacle-aware layout to create spatially interesting text flows that follow the video's visual structure.

### 3.1 Silhouette masking with `layoutNextLine()`

Run edge detection + thresholding to extract a binary silhouette from each frame (e.g. a person's outline). Convert the silhouette into per-row available widths. Feed those widths to `layoutNextLine()` so text flows around the silhouette — text fills the negative space and the subject appears as a void.

This is the single most Pretext-native feature in the roadmap. No other ASCII art tool can flow proportional text around per-line variable-width obstacles because none of them have a streaming line-by-line layout engine.

### 3.2 Multi-column flow

Split the frame into 2–4 columns whose widths are derived from video content (e.g. a vertical bright region becomes a column separator). Route text through columns using `layoutNextLine()` with per-column widths. As the video changes, columns resize and text reflows.

Pretext role: `layoutNextLine()` handles the variable-width routing. `walkLineRanges()` pre-measures whether text fits before committing to a column split.

### 3.3 Gravity/density-based text clustering

Compute a brightness centroid per frame. Cluster text toward bright regions by tightening the layout width (packing text denser) in bright areas and loosening it (spreading text sparser) in dark areas. This creates a density map where text congregates around the interesting parts of the frame.

Implementation: divide the frame into horizontal bands, compute average brightness per band, map brightness → layout width via `layoutNextLine()`.

### 3.4 Text-shaped masks

Reverse the flow: use Pretext to lay out a large headline (e.g. "PRETEXT") and use the character positions as a mask. Only cells inside the headline's glyph outlines get the video brightness treatment; everything else is blank. The video plays through the text shape.

Pretext role: `layoutWithLines()` gives line positions; per-character x-offsets from `prepareWithSegments()` define the mask boundaries.

### 3.5 Depth-aware font sizing

Given a depth map (monocular estimator or stereo pair), map depth to font size: closer objects get larger characters, distant objects get smaller ones. Each row can have a different effective font size, and `layoutNextLine()` handles the variable-metric layout.

---

## Phase 4: Content-aware text sourcing

Goal: make the text content meaningful and related to the video.

### 4.1 Subtitle extraction and sync

Extract subtitles from the video via ffmpeg or Whisper-based transcription. Use the transcribed text as the fusion source, synced to the timeline. The viewer reads the dialogue while the text visually forms the video's image.

### 4.2 Script-matched text selection

Detect the dominant script/language in the video. Select source text in the matching script — Japanese for anime, Arabic for Arabic-language video, Devanagari for Hindi content. CJK characters are denser and more visually varied than Latin, producing higher-resolution ASCII art.

Pretext role: full multi-script layout support including CJK grapheme splitting, kinsoku rules, bidi, and Southeast Asian segmentation.

### 4.3 Semantic text cycling

Maintain a library of thematically related texts and cycle through them on scene cuts. Detect cuts via frame-difference thresholding and swap the text source at each cut.

### 4.4 Generative text from frame description

Feed keyframes to an image captioning model. Use the generated descriptions as the fusion text source. The text describes what is happening in the video while simultaneously forming the image of it.

---

## Phase 5: High-fidelity output pipeline

Goal: production-quality output at arbitrary resolution.

### 5.1 SVG frame output

Render each ASCII frame as SVG using the text-video engine's helpers (`svgElement()`, `svgVoidElement()`). Each character is an SVG `<text>` element with exact positioning, color, weight, and opacity. Resolution-independent.

### 5.2 PTXV encoding

Encode the entire ASCII video as a `.ptxv` text-video project:

- Each source video frame maps to a scene or keyframe
- Each character becomes a text layer with animated opacity/color
- The `.ptxv` bundle stores semantic representation, not pixels
- Re-render at 4K, 8K, or any resolution from the same source

This is the ultimate Pretext integration: the ASCII art is a text-video project.

### 5.3 High-resolution MP4 re-render

Render SVG frames through Resvg at 2x–4x scale, then stitch with ffmpeg. Because the source is vector SVG with real font rendering, the output looks crisp at 4K even though the grid is 120×30 characters.

### 5.4 WebGL real-time renderer

WebGL shader that renders pre-computed character grid + brightness arrays as textured quads with real-time post-processing: bloom, scanlines, CRT curvature, chromatic aberration.

### 5.5 Streaming terminal mode

Pipe ffmpeg raw frame output directly into the ASCII mapper without intermediate files:

```sh
ffmpeg -i input.mp4 -f rawvideo -pix_fmt gray - | mp4toascii --stdin --cols=120
```

---

## Phase 6: Interactive browser experience

Goal: a polished browser demo showcasing every capability.

### 6.1 Drop-target video upload

Browser page at `/demos/mp4toascii` where users drag-and-drop a video. Frames extracted client-side via `<video>` + `<canvas>`, mapped to ASCII using Pretext in the browser. No server needed.

### 6.2 Live parameter tuning

Sliders for: columns, font size, font weight range, dithering intensity, temporal smoothing, scroll speed, edge detection threshold, silhouette masking threshold. Changes apply immediately; playback shows the effect over time.

### 6.3 Split-screen comparison

Original video alongside ASCII output. Optionally show multiple modes side-by-side (mono vs. fusion vs. silhouette flow).

### 6.4 Text input editor

Let the user paste their own text for fusion mode. Pretext re-lays-out on input and the preview updates live.

### 6.5 Export controls

Export the current configuration as:

- Self-contained HTML file (current capability, polished)
- `.ptxv` bundle (download, re-render offline at higher resolution)
- GIF (via client-side gif.js or similar)
- MP4 (via ffmpeg.wasm or server-side render endpoint)

---

## Phase 7: Artistic presets

Goal: one-click artistic styles combining the above capabilities.

| Preset | Description | Key techniques |
|--------|-------------|----------------|
| Typewriter | Text appears character-by-character, synced to video | Scrolling fusion + temporal reveal |
| Matrix rain | Vertical cascading green characters | Column flow + directional bias + WebGL scanlines |
| Newspaper | Halftone dot simulation using character density | Ordered dithering + proportional width budgeting |
| Concrete poetry | Text flows around subjects, fills negative space | Silhouette masking + `layoutNextLine()` |
| Karaoke | Lyrics highlighted in sync with audio beats | Subtitle extraction + beat detection + per-char color |
| Terminal | Classic green phosphor CRT | Mono + temporal smoothing + WebGL CRT shader |
| Editorial | Multi-column magazine layout reflowing with video | Multi-column flow + depth-aware sizing |
| Cipher | Random characters gradually resolving into readable text | Character stability scoring with time-varying threshold |

---

## Dependency map

```
Phase 1 (resolution)
    │
Phase 2 (temporal) ─── requires Phase 1 palettes
    │
Phase 3 (spatial) ──── requires Phase 2 smoothing
    │
Phase 4 (content) ──── independent, can parallel 2–3
    │
Phase 5 (output) ───── requires Phase 1+2+3 features
    │
Phase 6 (browser) ──── requires Phase 5 output formats
    │
Phase 7 (presets) ──── requires everything above
```

Phases 1–3 are the core engine work. Phase 4 is mostly about sourcing and can happen in parallel. Phase 5 is the output quality multiplier. Phase 6 and 7 are user-facing polish.

## Features that most uniquely leverage Pretext

These are the capabilities no competing ASCII art tool can replicate because they do not have a text layout engine:

1. **3.1 Silhouette masking** — text flowing around video-derived obstacles via `layoutNextLine()`
2. **1.2 Proportional width budgeting** — variable-width characters properly laid out by `layoutWithLines()`
3. **2.5 Beat-driven reflow pulsing** — per-frame width changes via `layout()`
4. **5.2 PTXV semantic encoding** — ASCII art stored as a re-renderable text-video project
5. **3.2 Multi-column flow** — dynamic column widths routed through `layoutNextLine()`
6. **4.2 Script-matched text** — multi-script layout with CJK, bidi, and Southeast Asian segmentation

Prioritize these when the goal is to differentiate from existing tools.

## Design constraints

- Keep `layout()` out of the per-cell inner loop. Use it at the frame level, not the character level.
- Keep fusion mode's Pretext calls to `prepareWithSegments()` + `layoutWithLines()` (or `layoutNextLine()` for spatial modes). Do not introduce new public API surface on the core library just for mp4toascii.
- Frame extraction stays in ffmpeg. Do not add a JS video decoder dependency.
- Keep the CLI stateless — no daemon, no server, no persistent process.
- HTML output should stay self-contained (single file, inline JS, no external dependencies).
