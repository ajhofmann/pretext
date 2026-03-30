import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractFrames, probeVideo } from '../shared/mp4toascii/extract.ts'
import { mapFrameMono } from '../shared/mp4toascii/ascii-map.ts'
import { fuseFrameWithText, layoutTextPositions } from '../shared/mp4toascii/fusion.ts'
import type { PretextModule } from '../shared/mp4toascii/fusion.ts'
import {
  asciiFrameToAnsi,
  fusionFrameToAnsi,
  writeHtmlPage,
  writeFusionHtmlPage,
  renderAsciiToMp4,
} from '../shared/mp4toascii/render.ts'
import {
  encodeAsciiFrames,
  encodeFusionFrames,
  writeAscvFile,
  readAscvFile,
  ascvFrameToAnsi,
  ascvToHtml,
} from '../shared/mp4toascii/ascv.ts'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {}
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=')
      if (eq > 0) {
        args[arg.slice(2, eq)] = arg.slice(eq + 1)
      } else {
        args[arg.slice(2)] = 'true'
      }
    }
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
const inputPath = args['input']
const playPath = args['play']

if (playPath) {
  const absolutePlay = resolve(playPath)
  console.log(`Loading: ${absolutePlay}`)
  const ascv = readAscvFile(absolutePlay)
  console.log(`${ascv.header.cols}x${ascv.header.rows} @ ${ascv.header.fps}fps, ${ascv.header.frameCount} frames, mode=${ascv.header.mode}`)

  const output = args['output'] ?? '-'
  if (output === '-') {
    for (let i = 0; i < ascv.frames.length; i++) {
      process.stdout.write('\x1b[H\x1b[2J')
      process.stdout.write(ascvFrameToAnsi(ascv.frames[i]!, ascv.header.color))
      if (i < ascv.frames.length - 1) {
        await new Promise(r => setTimeout(r, 1000 / ascv.header.fps))
      }
    }
    process.stdout.write('\n')
  } else if (output.endsWith('.html')) {
    ascvToHtml(ascv, resolve(output))
    console.log(`Wrote HTML: ${output}`)
  } else {
    const lines = ascv.frames.map(f => ascvFrameToAnsi(f, ascv.header.color))
    const { writeFileSync } = await import('node:fs')
    writeFileSync(resolve(output), lines.join('\n\n---\n\n'), 'utf-8')
    console.log(`Wrote text: ${output}`)
  }
  console.log('Done.')
  process.exit(0)
}

if (!inputPath) {
  console.error(`Usage: mp4toascii --input=<video> [options]
       mp4toascii --play=<file.ascv> [--output=<path>]

Encode a video:
  --input=<path>       Source video file (required)
  --cols=<n>           Character columns (default: 120)
  --rows=<n>           Character rows (auto from aspect ratio if omitted)
  --fps=<n>            Output frame rate (default: source fps, capped at 15)
  --mode=<mode>        mono | fusion (default: fusion)
  --output=<path>      Output: .ascv (shareable), .html, .mp4, .txt, or - for terminal
  --text=<path>        Text file for fusion mode (default: built-in sample)
  --font=<font>        Font for fusion mode (default: 14px Georgia)
  --color              Enable color output
  --invert             Invert brightness
  --max-frames=<n>     Limit number of frames processed

Play back a .ascv file:
  --play=<file.ascv>   Play a previously encoded .ascv file
  --output=<path>      Convert .ascv to .html or .txt (default: terminal playback)
`)
  process.exit(1)
}

const absoluteInput = resolve(inputPath)
const info = probeVideo(absoluteInput)
console.log(`Input: ${absoluteInput}`)
console.log(`  ${info.width}x${info.height} @ ${info.fps.toFixed(1)}fps, ${info.duration.toFixed(1)}s, ~${info.frameCount} frames`)

const cols = Number(args['cols'] ?? 120)
const targetFps = Math.min(Number(args['fps'] ?? info.fps), 15)
const rows = args['rows']
  ? Number(args['rows'])
  : Math.round(cols * (info.height / info.width) * 0.45)
const mode = (args['mode'] ?? 'fusion') as 'mono' | 'fusion'
const output = args['output'] ?? '-'
const invert = args['invert'] === 'true'
const color = args['color'] === 'true'
const maxFrames = args['max-frames'] ? Number(args['max-frames']) : undefined

console.log(`Config: ${cols}x${rows} @ ${targetFps}fps, mode=${mode}, output=${output}`)
console.log('Extracting frames...')

const extractCols = mode === 'fusion' ? cols * 2 : cols
const extractRows = mode === 'fusion' ? rows * 2 : rows

let frames = await extractFrames(absoluteInput, {
  cols: extractCols,
  rows: extractRows,
  fps: targetFps,
})

if (maxFrames !== undefined && frames.length > maxFrames) {
  frames = frames.slice(0, maxFrames)
}

console.log(`Extracted ${frames.length} frames`)

if (mode === 'mono') {
  const asciiFrames = frames.map(f => mapFrameMono(f, invert, color))
  const ansiStrings = asciiFrames.map(f => asciiFrameToAnsi(f))

  if (output.endsWith('.ascv')) {
    const ascv = encodeAsciiFrames(asciiFrames, targetFps, color)
    writeAscvFile(ascv, resolve(output))
    console.log(`Wrote ASCV: ${output} (${ascv.header.frameCount} frames)`)
  } else if (output === '-') {
    for (let i = 0; i < ansiStrings.length; i++) {
      process.stdout.write('\x1b[H\x1b[2J')
      process.stdout.write(ansiStrings[i]!)
      if (i < ansiStrings.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000 / targetFps))
      }
    }
    process.stdout.write('\n')
  } else if (output.endsWith('.html')) {
    writeHtmlPage(ansiStrings, targetFps, resolve(output))
    console.log(`Wrote HTML: ${output}`)
  } else if (output.endsWith('.mp4')) {
    console.log('Rendering MP4...')
    renderAsciiToMp4(ansiStrings, targetFps, resolve(output))
    console.log(`Wrote MP4: ${output}`)
  } else {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(resolve(output), ansiStrings.join('\n\n---\n\n'), 'utf-8')
    console.log(`Wrote text: ${output}`)
  }
} else {
  const distEntry = resolve(repoRoot, 'dist', 'layout.js')
  try {
    await import('node:fs').then(fs => fs.accessSync(distEntry))
  } catch {
    console.error('Fusion mode requires built Pretext package. Run: bun run build:package')
    process.exit(1)
  }
  const pretext = await import(new URL(`file://${distEntry}`).href) as unknown as PretextModule

  const { ensureNodeMeasurementBackend } = await import('../shared/text-video/text.ts')
  ensureNodeMeasurementBackend()

  const fontFamily = args['font'] ?? 'DejaVu Sans'
  const fontSize = 14
  const lineHeight = Math.round(fontSize * 1.5)
  const font = `${fontSize}px ${fontFamily}`
  const maxWidth = cols * fontSize * 0.62

  let sourceText: string
  if (args['text']) {
    sourceText = readFileSync(resolve(args['text']), 'utf-8')
  } else {
    sourceText = `The future of text layout is not CSS. It is pure computation: measuring fonts, breaking lines, and placing glyphs without ever touching a DOM tree. Pretext proves this by delivering browser-accurate multiline text layout in plain JavaScript. No reflows. No getBoundingClientRect. No layout thrashing. Just arithmetic over cached measurements. This is what happens when you treat text as data instead of markup. Every paragraph becomes a mathematical object you can query instantly: how many lines at this width? What height at that font size? Where does line three break? The answers come back in microseconds because the expensive work — segmenting, measuring, applying Unicode rules — happens once, upfront, in prepare(). After that, layout() is pure math. Resize a container? Pure math. Reflow around an obstacle? Pure math. Shrinkwrap to the tightest bounding box? Pure math. The text you are reading right now is being mapped onto a video frame. Each character occupies a position determined by Pretext's line-breaking algorithm. The brightness of each character is sampled from the video — dark regions dim the text, bright regions make it glow. The text is real. The layout is real. The image emerges from modulating what was already there. This is text-image fusion: readable content that simultaneously forms a visual. Not ASCII art with arbitrary symbols, but actual prose whose typographic weight carries the picture. Pretext makes this possible because it knows exactly where every character lands — the x-offset, the line, the width — without rendering anything to a screen first. That positional certainty is what lets us sample the video at each character's coordinates and apply the brightness as opacity. The result is something that works at any resolution, in any font, at any size, because the layout engine adapts and the mapping follows. `
  }

  sourceText = sourceText.repeat(Math.ceil((rows * cols) / sourceText.length) + 1)

  console.log('Computing text layout with Pretext...')
  const charPositions = layoutTextPositions(pretext, {
    text: sourceText,
    font,
    fontSize,
    lineHeight,
    maxWidth,
    invert,
    color,
  })

  console.log(`Layout: ${charPositions.length} characters across text`)

  const fusionFrames = frames.map((f, i) => {
    if (i % 50 === 0) process.stdout.write(`\rMapping frame ${i + 1}/${frames.length}...`)
    return fuseFrameWithText(f, charPositions, {
      text: sourceText,
      font,
      fontSize,
      lineHeight,
      maxWidth,
      invert,
      color,
    })
  })
  process.stdout.write('\n')

  if (output.endsWith('.ascv')) {
    const ascv = encodeFusionFrames(fusionFrames, cols, rows, targetFps, color)
    writeAscvFile(ascv, resolve(output))
    console.log(`Wrote ASCV: ${output} (${ascv.header.frameCount} frames)`)
  } else if (output === '-') {
    for (let i = 0; i < fusionFrames.length; i++) {
      process.stdout.write('\x1b[H\x1b[2J')
      process.stdout.write(fusionFrameToAnsi(fusionFrames[i]!, color))
      if (i < fusionFrames.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000 / targetFps))
      }
    }
    process.stdout.write('\n')
  } else if (output.endsWith('.html')) {
    writeFusionHtmlPage(fusionFrames, targetFps, resolve(output), {
      fontFamily,
      fontSize,
      color,
    })
    console.log(`Wrote HTML: ${output}`)
  } else if (output.endsWith('.mp4')) {
    console.log('Rendering MP4...')
    const ansiStrings = fusionFrames.map(f => fusionFrameToAnsi(f, color))
    renderAsciiToMp4(ansiStrings, targetFps, resolve(output), {
      fontSize: 12,
      fontFamily: 'DejaVu Sans',
    })
    console.log(`Wrote MP4: ${output}`)
  } else {
    const ansiStrings = fusionFrames.map(f => fusionFrameToAnsi(f, color))
    const { writeFileSync } = await import('node:fs')
    writeFileSync(resolve(output), ansiStrings.join('\n\n---\n\n'), 'utf-8')
    console.log(`Wrote text: ${output}`)
  }
}

console.log('Done.')
