import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { mapFrameMono } from '../shared/mp4toascii/ascii-map.ts'
import {
  encodeAsciiFrames,
  encodeRichFrames,
  readAscvFile,
  writeAscvFile,
  ascvFrameToAnsi,
  ascvToHtml,
} from '../shared/mp4toascii/ascv.ts'
import { buildConfigFromArgs, spatialRuntimeFromConfig } from '../shared/mp4toascii/config.ts'
import { selectContentText } from '../shared/mp4toascii/content.ts'
import {
  extractFrames,
  extractFramesFromRawVideo,
  probeVideo,
} from '../shared/mp4toascii/extract.ts'
import {
  fuseFrameWithPalette,
  fuseFrameWithRoutedText,
  type PretextModule,
} from '../shared/mp4toascii/fusion.ts'
import { buildGlyphPalette, measureGlyphWidthFromPretext } from '../shared/mp4toascii/palette.ts'
import {
  asciiFrameToAnsi,
  renderAsciiToMp4,
  renderRichFrameToSvg,
  renderRichFramesToMp4,
  writeHtmlPage,
  writeFusionHtmlPage,
} from '../shared/mp4toascii/render.ts'
import type {
  FramePixels,
  Mp4ToAsciiConfig,
  RichFrame,
} from '../shared/mp4toascii/types.ts'
import { encodeAsciiVideoAssetData, frameToAsciiVideoData } from '../shared/text-video/ascii-video.ts'
import { createSampleProject, encodeProjectToContainer } from '../shared/text-video/runtime.ts'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_TEXT = `The future of text layout is not CSS. It is pure computation: measuring fonts, breaking lines, and placing glyphs without ever touching a DOM tree. Pretext proves this by delivering browser-accurate multiline text layout in plain JavaScript. No reflows. No getBoundingClientRect. No layout thrashing. Just arithmetic over cached measurements. This is what happens when you treat text as data instead of markup. Every paragraph becomes a mathematical object you can query instantly: how many lines at this width? What height at that font size? Where does line three break? The answers come back in microseconds because the expensive work — segmenting, measuring, applying Unicode rules — happens once, upfront, in prepare(). After that, layout() is pure math. Resize a container? Pure math. Reflow around an obstacle? Pure math. Shrinkwrap to the tightest bounding box? Pure math. This is text-image fusion: readable content that simultaneously forms a visual.`

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {}
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]!
    if (!argument.startsWith('--')) continue
    const equalsIndex = argument.indexOf('=')
    if (equalsIndex > 0) {
      args[argument.slice(2, equalsIndex)] = argument.slice(equalsIndex + 1)
    } else {
      args[argument.slice(2)] = 'true'
    }
  }
  return args
}

const args = parseArgs(process.argv.slice(2))

async function ensurePretext(): Promise<PretextModule> {
  const distEntry = resolve(repoRoot, 'dist', 'layout.js')
  try {
    await import('node:fs').then(fs => fs.accessSync(distEntry))
  } catch {
    throw new Error('Advanced mp4toascii modes require a built Pretext package. Run: bun run build:package')
  }

  const { ensureNodeMeasurementBackend } = await import('../shared/text-video/text.ts')
  ensureNodeMeasurementBackend()
  return await import(new URL(`file://${distEntry}`).href) as unknown as PretextModule
}

function usage(): never {
  console.error(`Usage:
  bun run mp4toascii -- --input=<video> [options]
  bun run mp4toascii -- --stdin --width=<w> --height=<h> [options]
  bun run mp4toascii -- --play=<file.ascv> [--output=<path>]

Options:
  --mode=mono|palette|fusion
  --layout=grid|pulse|silhouette|columns|bands|headline-mask|depth
  --preset=<id>
  --output=<path>       .ascv | .html | .mp4 | .ptxv | directory for SVG frames | - for terminal
  --text=<file-or-text>
  --font=<family>
  --font-size=<n>
  --line-height=<n>
  --cols=<n>
  --rows=<n>
  --fps=<n>
  --invert
  --color
  --max-frames=<n>
  --subtitle-file=<path.srt|path.vtt>
  --description-file=<path.json>
  --banks=<path-or-bank-id,...>
  --extract-subtitles
  --weights=300,500,700
  --styles=normal,italic
  --palette-fonts=<fontA,fontB>
  --dither=none|bayer2|bayer4|bayer8
  --edge-bias=<n>
  --smoothing=<n>
  --stability=<n>
  --scroll-step=<n>
  --scroll-modulation=none|brightness|motion
  --pulse-strength=<n>
  --cut-threshold=<n>
  --silhouette-threshold=<n>
  --columns=<n|auto>
  --bands=<n>
  --mask-text=<text>
  --slot-padding=<n>
  --depth-min-font-size=<n>
  --depth-max-font-size=<n>
`)
  process.exit(1)
}

async function playAscv(playPath: string, output: string): Promise<void> {
  const absolutePlay = resolve(playPath)
  console.log(`Loading: ${absolutePlay}`)
  const ascv = readAscvFile(absolutePlay)
  console.log(`${ascv.header.cols}x${ascv.header.rows} @ ${ascv.header.fps}fps, ${ascv.header.frameCount} frames, mode=${ascv.header.mode}`)

  if (output === '-') {
    for (let index = 0; index < ascv.frames.length; index++) {
      process.stdout.write('\x1b[H\x1b[2J')
      process.stdout.write(ascvFrameToAnsi(ascv.frames[index]!, ascv.header.color))
      if (index < ascv.frames.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000 / ascv.header.fps))
      }
    }
    process.stdout.write('\n')
    return
  }

  if (output.endsWith('.html')) {
    ascvToHtml(ascv, resolve(output))
    console.log(`Wrote HTML: ${output}`)
    return
  }

  const lines = ascv.frames.map(frame => ascvFrameToAnsi(frame, ascv.header.color))
  writeFileSync(resolve(output), lines.join('\n\n---\n\n'), 'utf-8')
  console.log(`Wrote text: ${output}`)
}

function inferExtractSize(config: Mp4ToAsciiConfig): { cols: number, rows: number } {
  const upscale = config.mode === 'mono' ? 1 : 2
  return {
    cols: Math.max(1, config.cols * upscale),
    rows: Math.max(1, config.rows * upscale),
  }
}

async function loadFrames(
  config: Mp4ToAsciiConfig,
  inputPath: string | undefined,
): Promise<FramePixels[]> {
  const maxFrames = args['max-frames'] !== undefined ? Math.max(0, Math.round(Number(args['max-frames']))) : undefined
  const size = inferExtractSize(config)

  const frames = args['stdin'] === 'true'
    ? extractFramesFromRawVideo({
        width: Math.max(1, Number(args['width'] ?? size.cols)),
        height: Math.max(1, Number(args['height'] ?? size.rows)),
        pixFmt: args['pix-fmt'] === 'rgb24' ? 'rgb24' : 'gray',
        stdin: await new Promise<Buffer>((resolve, reject) => {
          const chunks: Buffer[] = []
          process.stdin.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
          process.stdin.on('end', () => resolve(Buffer.concat(chunks)))
          process.stdin.on('error', reject)
          process.stdin.resume()
        }),
      })
    : await extractFrames(resolve(inputPath!), {
        cols: size.cols,
        rows: size.rows,
        fps: config.fps,
      })

  return maxFrames !== undefined ? frames.slice(0, maxFrames) : frames
}

function prepareContentText(config: Mp4ToAsciiConfig): string {
  const baseText = config.content.text.trim().length > 0 ? config.content.text : DEFAULT_TEXT
  return baseText.repeat(4)
}

async function renderMono(config: Mp4ToAsciiConfig, frames: FramePixels[], output: string): Promise<void> {
  const asciiFrames = frames.map(frame => mapFrameMono(frame, config.invert, config.color))
  const ansiFrames = asciiFrames.map(frame => asciiFrameToAnsi(frame))

  if (output.endsWith('.ascv')) {
    writeAscvFile(encodeAsciiFrames(asciiFrames, config.fps, config.color), resolve(output))
    console.log(`Wrote ASCV: ${output}`)
    return
  }

  if (output === '-') {
    for (let index = 0; index < ansiFrames.length; index++) {
      process.stdout.write('\x1b[H\x1b[2J')
      process.stdout.write(ansiFrames[index]!)
      if (index < ansiFrames.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000 / config.fps))
      }
    }
    process.stdout.write('\n')
    return
  }

  if (output.endsWith('.html')) {
    writeHtmlPage(ansiFrames, config.fps, resolve(output), {
      fontFamily: '"Courier New", Courier, monospace',
      fontSize: Math.max(8, Math.round(config.fontSize * 0.75)),
    })
    console.log(`Wrote HTML: ${output}`)
    return
  }

  if (output.endsWith('.mp4')) {
    renderAsciiToMp4(ansiFrames, config.fps, resolve(output))
    console.log(`Wrote MP4: ${output}`)
    return
  }

  if (output.endsWith('.txt')) {
    writeFileSync(resolve(output), ansiFrames.join('\n\n---\n\n'), 'utf-8')
    console.log(`Wrote text: ${output}`)
    return
  }

  usage()
}

async function renderRich(config: Mp4ToAsciiConfig, frames: FramePixels[], output: string): Promise<void> {
  const pretext = await ensurePretext()
  const contentText = prepareContentText(config)
  const sourceText = config.content.text.trim().length > 0 ? contentText : DEFAULT_TEXT.repeat(4)
  const palette = buildGlyphPalette(config.palette, (char, font) => measureGlyphWidthFromPretext(pretext.prepareWithSegments, char, font))

  let previousFrame: RichFrame | null = null
  let previousPixels: FramePixels | null = null
  const richFrames: RichFrame[] = []

  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index]!
    const content = selectContentText(config.content, index / config.fps, index, previousFrame?.metadata?.cut ?? false)
    const frameText = content.text.trim().length > 0 ? content.text : sourceText
    const richOptions: Parameters<typeof fuseFrameWithPalette>[2] = {
      text: frameText,
      font: `${config.fontSize}px ${config.fontFamily}`,
      fontSize: config.fontSize,
      lineHeight: config.lineHeight,
      maxWidth: config.cols * config.palette.targetCellWidth,
      invert: config.invert,
      color: config.color,
      frameIndex: index,
      timestampSeconds: index / config.fps,
      layout: config.layout,
      previousFrame,
      previousPixels,
      palette,
      paletteOptions: { targetCellWidth: config.palette.targetCellWidth },
      smoothing: config.temporal.smoothing,
      stability: config.temporal.stability,
      scrollStep: config.temporal.scrollStep,
      scrollModulation: config.temporal.scrollModulation,
      pulseStrength: config.temporal.pulseStrength,
      cutThreshold: config.temporal.cutThreshold,
      dither: config.palette.dither,
      edgeBias: config.palette.edgeBias,
      ...spatialRuntimeFromConfig(config),
    }

    const richFrame: RichFrame = config.mode === 'palette'
      ? fuseFrameWithPalette(frame, pretext, richOptions)
      : fuseFrameWithRoutedText(frame, pretext, richOptions)

    richFrames.push(richFrame)
    previousFrame = richFrame
    previousPixels = frame
  }

  if (output.endsWith('.ascv')) {
    const richMode = config.mode === 'palette' ? 'palette' : 'fusion'
    writeAscvFile(encodeRichFrames(richFrames, config.cols, config.rows, config.fps, config.color, richMode), resolve(output))
    console.log(`Wrote ASCV: ${output}`)
    return
  }

  if (output === '-') {
    for (let index = 0; index < richFrames.length; index++) {
      process.stdout.write('\x1b[H\x1b[2J')
      process.stdout.write(asciiFrameToAnsi(mapFrameMono(frames[index]!, config.invert, config.color)))
      if (index < richFrames.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000 / config.fps))
      }
    }
    process.stdout.write('\n')
    return
  }

  if (output.endsWith('.html')) {
    writeFusionHtmlPage(richFrames, config.fps, resolve(output), {
      fontFamily: config.fontFamily,
      fontSize: config.fontSize,
      color: config.color,
    })
    console.log(`Wrote HTML: ${output}`)
    return
  }

  if (output.endsWith('.mp4')) {
    renderRichFramesToMp4(richFrames, config.fps, resolve(output), {
      background: '#0a0a0a',
    })
    console.log(`Wrote MP4: ${output}`)
    return
  }

  if (output.endsWith('.ptxv')) {
    const project = createSampleProject()
    project.info.name = 'mp4toascii-export'
    project.info.description = `mp4toascii ${config.mode} export`
    project.video.width = Math.max(1, Math.round(richFrames[0]?.width ?? config.cols * config.palette.targetCellWidth))
    project.video.height = Math.max(1, Math.round(richFrames[0]?.height ?? config.rows * config.lineHeight))
    project.video.fps = config.fps
    project.video.durationSeconds = Math.max(1 / config.fps, richFrames.length / config.fps)
    project.assets = project.assets.filter(asset => asset.type === 'font')

    const payload = frameToAsciiVideoData(richFrames, {
      width: project.video.width,
      height: project.video.height,
      fps: config.fps,
      background: '#0a0a0a',
      mode: config.mode,
      color: config.color,
    })
    const bytes = encodeAsciiVideoAssetData(payload)
    project.assets.push({
      id: 'mp4toascii-ascii-video',
      type: 'ascii-video',
      src: 'mp4toascii-ascii-video.bin',
      embed: true,
      mimeType: 'application/octet-stream',
    })
    project.scenes = [{
      id: 'ascii-video-scene',
      start: 0,
      duration: project.video.durationSeconds,
      layers: [{
        id: 'ascii-video-layer',
        type: 'ascii-video',
        assetId: 'mp4toascii-ascii-video',
        x: 0,
        y: 0,
        width: project.video.width,
        height: project.video.height,
        opacity: 1,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        start: 0,
      }],
    }]
    const bundle = await encodeProjectToContainer(project, undefined, new Map([
      ['mp4toascii-ascii-video', {
        key: 'mp4toascii-ascii-video',
        bytes,
        mimeType: 'application/octet-stream',
        originalPath: 'mp4toascii-ascii-video.bin',
      }],
    ]))
    writeFileSync(resolve(output), bundle)
    console.log(`Wrote PTXV: ${output}`)
    return
  }

  if (output.endsWith('.svg') || !output.includes('.')) {
    const directory = output.endsWith('.svg') ? output.slice(0, -4) : output
    mkdirSync(resolve(directory), { recursive: true })
    for (let index = 0; index < richFrames.length; index++) {
      writeFileSync(
        resolve(directory, `${String(index).padStart(5, '0')}.svg`),
        renderRichFrameToSvg(richFrames[index]!, { background: '#0a0a0a' }),
        'utf-8',
      )
    }
    console.log(`Wrote SVG frames: ${directory}`)
    return
  }

  usage()
}

async function main(): Promise<void> {
  if (args['play']) {
    await playAscv(args['play']!, args['output'] ?? '-')
    return
  }

  if (!args['input'] && args['stdin'] !== 'true') {
    usage()
  }

  const videoInfo = args['stdin'] === 'true'
    ? {
        width: Math.max(1, Number(args['width'] ?? 0)),
        height: Math.max(1, Number(args['height'] ?? 0)),
        fps: Math.max(1, Number(args['fps'] ?? 10)),
      }
    : probeVideo(resolve(args['input']!))

  const config = buildConfigFromArgs(args, videoInfo)
  const output = args['output'] ?? '-'
  const frames = await loadFrames(config, args['input'])

  console.log(`Config: ${config.cols}x${config.rows} @ ${config.fps}fps, mode=${config.mode}, layout=${config.layout}, output=${output}`)
  console.log(`Extracted ${frames.length} frames`)

  if (config.mode === 'mono') {
    await renderMono(config, frames, output)
    return
  }

  await renderRich(config, frames, output)
}

await main()
