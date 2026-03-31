import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { AsciiFrame } from './ascii-map.ts'
import {
  createAsciiPlayerScript,
  createRichFrameHtmlData,
  createRichPlayerScript,
} from './html-player.ts'
import type { RichFrame } from './types.ts'
import { frameToAsciiVideoData, renderAsciiVideoFrameToSvg } from '../text-video/ascii-video.ts'

export function asciiFrameToAnsi(frame: AsciiFrame): string {
  const lines: string[] = []
  for (let row = 0; row < frame.rows; row++) {
    let line = ''
    for (let col = 0; col < frame.cols; col++) {
      const i = row * frame.cols + col
      const ch = frame.chars[i]!
      if (frame.colors !== null) {
        const c = frame.colors[i]!
        line += `\x1b[38;2;${c.r};${c.g};${c.b}m${ch}\x1b[0m`
      } else {
        line += ch
      }
    }
    lines.push(line)
  }
  return lines.join('\n')
}

export function richFrameToAnsi(frame: RichFrame, color: boolean): string {
  const lineMap = new Map<number, typeof frame.glyphs>()
  for (let index = 0; index < frame.glyphs.length; index++) {
    const glyph = frame.glyphs[index]!
    const existing = lineMap.get(glyph.lineIndex)
    if (existing === undefined) {
      lineMap.set(glyph.lineIndex, [glyph])
    } else {
      existing.push(glyph)
    }
  }

  const lines = [...lineMap.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([, glyphs]) => {
      const ordered = [...glyphs].sort((left, right) => left.x - right.x)
      let line = ''
      for (let index = 0; index < ordered.length; index++) {
        const glyph = ordered[index]!
        if (glyph.opacity < 0.05) {
          line += ' '
          continue
        }
        const gray = Math.round(glyph.opacity * 255)
        if (color && glyph.fill !== null) {
          const r = Math.round(glyph.fill.r * glyph.opacity)
          const g = Math.round(glyph.fill.g * glyph.opacity)
          const b = Math.round(glyph.fill.b * glyph.opacity)
          line += `\x1b[38;2;${r};${g};${b}m${glyph.char}\x1b[0m`
        } else {
          line += `\x1b[38;2;${gray};${gray};${gray}m${glyph.char}\x1b[0m`
        }
      }
      return line
    })

  return lines.join('\n')
}

export const fusionFrameToAnsi = richFrameToAnsi

export function writeHtmlPage(
  frames: string[],
  fps: number,
  outputPath: string,
  options: { title?: string, bgColor?: string, textColor?: string, fontFamily?: string, fontSize?: number } = {},
): void {
  const title = options.title ?? 'mp4toascii'
  const bgColor = options.bgColor ?? '#0a0a0a'
  const textColor = options.textColor ?? '#00ff41'
  const fontFamily = options.fontFamily ?? '"Courier New", Courier, monospace'
  const fontSize = options.fontSize ?? 10

  const escaped = frames.map(f =>
    f.replace(/\x1b\[\d+(?:;\d+)*m/g, '')
  )

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: ${bgColor}; color: ${textColor}; font-family: ${fontFamily}; display: flex; flex-direction: column; align-items: center; min-height: 100vh; padding: 20px; }
h1 { font-size: 18px; margin-bottom: 12px; color: #888; }
#display { white-space: pre; font-size: ${fontSize}px; line-height: 1.2; letter-spacing: 0; }
.controls { margin: 16px 0; display: flex; gap: 12px; align-items: center; }
button { background: #222; color: #0f0; border: 1px solid #333; padding: 8px 16px; cursor: pointer; font-family: inherit; border-radius: 4px; }
button:hover { background: #333; }
input[type=range] { width: 300px; }
span { color: #666; font-size: 13px; }
</style>
</head>
<body>
<h1>${title}</h1>
<div class="controls">
<button id="play">Play</button>
<button id="reset">Reset</button>
<input id="scrub" type="range" min="0" max="${escaped.length - 1}" value="0" step="1">
<span id="counter">0 / ${escaped.length}</span>
</div>
<pre id="display"></pre>
<script>
const frames = ${JSON.stringify(escaped)};
const fps = ${fps};
${createAsciiPlayerScript()}
</script>
</body>
</html>`

  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, html, 'utf-8')
}

export function writeFusionHtmlPage(
  frames: RichFrame[],
  fps: number,
  outputPath: string,
  options: { title?: string, bgColor?: string, fontFamily?: string, fontSize?: number, color?: boolean } = {},
): void {
  const title = options.title ?? 'mp4toascii — text fusion'
  const bgColor = options.bgColor ?? '#0a0a0a'
  const fontSize = options.fontSize ?? 14
  const color = options.color ?? false

  const serialized = createRichFrameHtmlData(frames)

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: ${bgColor}; color: #e0e0e0; font-family: sans-serif; display: flex; flex-direction: column; align-items: center; min-height: 100vh; padding: 20px; }
h1 { font-size: 18px; margin-bottom: 12px; color: #888; font-family: sans-serif; }
#display { font-family: "Courier New", Courier, monospace; font-size: ${fontSize}px; line-height: ${Math.round(fontSize * 1.4)}px; white-space: pre; max-width: 90vw; letter-spacing: 0; }
#display span { font-family: inherit !important; }
.controls { margin: 16px 0; display: flex; gap: 12px; align-items: center; font-family: sans-serif; }
button { background: #222; color: #ccc; border: 1px solid #333; padding: 8px 16px; cursor: pointer; border-radius: 4px; }
button:hover { background: #333; }
input[type=range] { width: 300px; }
.controls span { color: #666; font-size: 13px; }
</style>
</head>
<body>
<h1>${title}</h1>
<div class="controls">
<button id="play">Play</button>
<button id="reset">Reset</button>
<input id="scrub" type="range" min="0" max="${serialized.length - 1}" value="0" step="1">
<span id="counter">0 / ${serialized.length}</span>
</div>
<div id="display"></div>
<script>
const frames = ${JSON.stringify(serialized)};
const fps = ${fps};
const useColor = ${color};
${createRichPlayerScript()}
</script>
</body>
</html>`

  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, html, 'utf-8')
}

export function renderRichFrameToSvg(
  frame: RichFrame,
  options: {
    width?: number
    height?: number
    background?: string
  } = {},
): string {
  const width = options.width ?? Math.max(1, Math.round(frame.width))
  const height = options.height ?? Math.max(1, Math.round(frame.height))
  const asciiVideo = frameToAsciiVideoData([frame], {
    width,
    height,
    fps: 1,
    background: options.background ?? '#0a0a0a',
  })
  return renderAsciiVideoFrameToSvg(asciiVideo, 0, {
    x: 0,
    y: 0,
    width,
    height,
    opacity: 1,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
  })
}

export function renderRichFramesToMp4(
  frames: RichFrame[],
  fps: number,
  outputPath: string,
  options: {
    width?: number
    height?: number
    background?: string
  } = {},
): void {
  const { writeFileSync: writePngSync, rmSync } = require('node:fs') as typeof import('node:fs')
  const { Resvg } = require('@resvg/resvg-js') as typeof import('@resvg/resvg-js')
  const { tmpdir } = require('node:os') as typeof import('node:os')
  const width = options.width ?? Math.max(...frames.map(frame => Math.max(1, Math.round(frame.width))), 1)
  const height = options.height ?? Math.max(...frames.map(frame => Math.max(1, Math.round(frame.height))), 1)
  const background = options.background ?? '#0a0a0a'
  const tempDir = join(tmpdir(), `mp4toascii-rich-render-${Date.now()}`)
  mkdirSync(tempDir, { recursive: true })

  try {
    for (let index = 0; index < frames.length; index++) {
      const svg = renderRichFrameToSvg(frames[index]!, { width, height, background })
      const png = new Resvg(svg, {
        fitTo: { mode: 'width', value: width },
      }).render().asPng()
      writePngSync(join(tempDir, `${String(index).padStart(5, '0')}.png`), png)
    }

    execFileSync('ffmpeg', [
      '-y',
      '-framerate', String(fps),
      '-i', join(tempDir, '%05d.png'),
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      outputPath,
    ], { stdio: 'pipe' })
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

export function renderAsciiToMp4(
  frames: string[],
  fps: number,
  outputPath: string,
  options: { width?: number, height?: number, bgColor?: string, textColor?: string, fontSize?: number, fontFamily?: string } = {},
): void {
  const { createCanvas: makeCanvas } = require('@napi-rs/canvas') as typeof import('@napi-rs/canvas')
  const width = options.width ?? 1920
  const height = options.height ?? 1080
  const bgColor = options.bgColor ?? '#0a0a0a'
  const textColor = options.textColor ?? '#00ff41'
  const fontSize = options.fontSize ?? 14
  const fontFamily = options.fontFamily ?? 'DejaVu Sans Mono'

  const tempDir = join(require('node:os').tmpdir(), `mp4toascii-render-${Date.now()}`)
  mkdirSync(tempDir, { recursive: true })

  try {
    for (let i = 0; i < frames.length; i++) {
      const canvas = makeCanvas(width, height)
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = bgColor
      ctx.fillRect(0, 0, width, height)
      ctx.font = `${fontSize}px ${fontFamily}`
      ctx.fillStyle = textColor
      ctx.textBaseline = 'top'

      const plainLines = frames[i]!.replace(/\x1b\[\d+(?:;\d+)*m/g, '').split('\n')
      const lineHeight = fontSize * 1.3
      const startY = Math.max(10, (height - plainLines.length * lineHeight) / 2)
      const startX = 20

      for (let l = 0; l < plainLines.length; l++) {
        ctx.fillText(plainLines[l]!, startX, startY + l * lineHeight)
      }

      const buffer = canvas.toBuffer('image/png')
      writeFileSync(join(tempDir, `${String(i).padStart(5, '0')}.png`), buffer)
    }

    execFileSync('ffmpeg', [
      '-y',
      '-framerate', String(fps),
      '-i', join(tempDir, '%05d.png'),
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      outputPath,
    ], { stdio: 'pipe' })
  } finally {
    const { rmSync: rm } = require('node:fs') as typeof import('node:fs')
    rm(tempDir, { recursive: true, force: true })
  }
}
