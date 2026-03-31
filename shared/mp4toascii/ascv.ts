import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'

import type { AsciiFrame } from './ascii-map.ts'
import { createRichPlayerScript, serializeFramesForPlayer } from './html-player.ts'
import type { RichFrame, RgbColor } from './types.ts'

export type AscvHeader = {
  version: 1 | 2
  cols: number
  rows: number
  fps: number
  frameCount: number
  mode: 'mono' | 'palette' | 'fusion'
  color: boolean
}

type LegacyAscvFrame = {
  kind: 'grid'
  lines: string[]
  brightness: number[][] | null
  colors: Array<Array<RgbColor>> | null
}

type RichAscvFrame = {
  kind: 'rich'
  width: number
  height: number
  lineHeight: number
  styles: RichFrame['styles']
  lines: Array<{
    lineIndex: number
    glyphs: Array<{
      char: string
      opacity: number
      brightness: number
      fill: RgbColor | null
      styleIndex: number
    }>
  }>
}

export type AscvFrame = LegacyAscvFrame | RichAscvFrame

export type AscvFile = {
  header: AscvHeader
  frames: AscvFrame[]
}

const MAGIC_V1 = 'ASCV1'
const MAGIC_V2 = 'ASCV2'

export function encodeAsciiFrames(
  asciiFrames: AsciiFrame[],
  fps: number,
  color: boolean,
): AscvFile {
  const first = asciiFrames[0]!
  const frames: AscvFrame[] = []

  for (const frame of asciiFrames) {
    const lines: string[] = []
    const brightness: number[][] = []
    const frameColors: Array<Array<{ r: number, g: number, b: number }>> | null = color && frame.colors !== null ? [] : null

    for (let row = 0; row < frame.rows; row++) {
      let line = ''
      const rowBrightness: number[] = []
      const rowColors: Array<{ r: number, g: number, b: number }> = []

      for (let col = 0; col < frame.cols; col++) {
        const i = row * frame.cols + col
        line += frame.chars[i]!
        rowBrightness.push(frame.chars[i] === ' ' ? 0 : 255)
        if (frame.colors !== null) {
          rowColors.push(frame.colors[i]!)
        }
      }
      lines.push(line)
      brightness.push(rowBrightness)
      if (frameColors !== null) frameColors.push(rowColors)
    }

    frames.push({ kind: 'grid', lines, brightness, colors: frameColors })
  }

  return {
    header: { version: 1, cols: first.cols, rows: first.rows, fps, frameCount: frames.length, mode: 'mono', color },
    frames,
  }
}

export function encodeFusionFrames(
  fusionFrames: RichFrame[],
  cols: number,
  rows: number,
  fps: number,
  color: boolean,
): AscvFile {
  return encodeRichFrames(fusionFrames, cols, rows, fps, color, 'fusion')
}

export function encodeRichFrames(
  richFrames: RichFrame[],
  cols: number,
  rows: number,
  fps: number,
  color: boolean,
  mode: 'palette' | 'fusion',
): AscvFile {
  const serialized = serializeFramesForPlayer(richFrames)
  const frames: AscvFrame[] = serialized.map(frame => {
    if (frame.kind === 'grid') {
      return {
        kind: 'grid',
        lines: frame.lines,
        brightness: frame.brightness,
        colors: frame.colors,
      }
    }

    return {
      kind: 'rich',
      width: cols,
      height: rows,
      lineHeight: frame.lineHeight,
      styles: frame.styles,
      lines: frame.lines.map(line => ({
        lineIndex: line.lineIndex,
        glyphs: line.glyphs.map(glyph => ({
          char: glyph.char,
          opacity: glyph.opacity,
          brightness: glyph.brightness,
          fill: glyph.fill ?? null,
          styleIndex: glyph.styleIndex,
        })),
      })),
    }
  })

  return {
    header: { version: 2, cols, rows, fps, frameCount: frames.length, mode, color },
    frames,
  }
}

export function serializeAscv(file: AscvFile): Buffer {
  if (file.header.version === 2) {
    const payload = JSON.stringify(file)
    return Buffer.concat([Buffer.from(MAGIC_V2), gzipSync(Buffer.from(payload, 'utf-8'))])
  }

  const headerLine = `${MAGIC_V1} cols=${file.header.cols} rows=${file.header.rows} fps=${file.header.fps} frames=${file.header.frameCount} mode=${file.header.mode} color=${file.header.color ? 1 : 0}`

  const parts: string[] = [headerLine, '']

  for (let i = 0; i < file.frames.length; i++) {
    const frame = file.frames[i]!
    if (frame.kind !== 'grid') {
      throw new Error('ASCV1 serialization only supports grid frames.')
    }
    parts.push(`#F${i}`)

    for (let row = 0; row < frame.lines.length; row++) {
      const line = frame.lines[row]!
      if (frame.brightness !== null && frame.brightness[row] !== undefined) {
        const bRow = frame.brightness[row]!
        const bHex = bRow.map(b => b.toString(16).padStart(2, '0')).join('')
        if (frame.colors !== null && frame.colors[row] !== undefined) {
          const cRow = frame.colors[row]!
          const cHex = cRow.map(c =>
            c.r.toString(16).padStart(2, '0') +
            c.g.toString(16).padStart(2, '0') +
            c.b.toString(16).padStart(2, '0')
          ).join('')
          parts.push(`${line}\t${bHex}\t${cHex}`)
        } else {
          parts.push(`${line}\t${bHex}`)
        }
      } else {
        parts.push(line)
      }
    }
  }

  const raw = parts.join('\n')
  return Buffer.concat([Buffer.from(MAGIC_V1), gzipSync(Buffer.from(raw, 'utf-8'))])
}

export function parseAscv(data: Buffer): AscvFile {
  const magicStr = data.subarray(0, 5).toString('ascii')
  if (magicStr === MAGIC_V2) {
    return JSON.parse(gunzipSync(data.subarray(5)).toString('utf-8')) as AscvFile
  }

  if (magicStr !== MAGIC_V1) {
    throw new Error(`Not an ASCV file (magic: ${magicStr})`)
  }

  const decompressed = gunzipSync(data.subarray(5)).toString('utf-8')
  const allLines = decompressed.split('\n')

  const headerLine = allLines[0]!
  const header = parseHeader(headerLine)

  const frames: AscvFrame[] = []
  let currentFrame: AscvFrame | null = null

  for (let i = 1; i < allLines.length; i++) {
    const line = allLines[i]!
    if (line.startsWith('#F')) {
      if (currentFrame !== null) frames.push(currentFrame)
      currentFrame = { kind: 'grid', lines: [], brightness: [], colors: header.color ? [] : null }
      continue
    }
    if (currentFrame === null) continue
    if (line === '') continue

    const tabs = line.split('\t')
    const text = tabs[0]!
    currentFrame.lines.push(text)

    if (tabs.length >= 2) {
      const bHex = tabs[1]!
      const bRow: number[] = []
      for (let j = 0; j < bHex.length; j += 2) {
        bRow.push(parseInt(bHex.slice(j, j + 2), 16))
      }
      currentFrame.brightness!.push(bRow)

      if (tabs.length >= 3 && currentFrame.colors !== null) {
        const cHex = tabs[2]!
        const cRow: Array<{ r: number, g: number, b: number }> = []
        for (let j = 0; j < cHex.length; j += 6) {
          cRow.push({
            r: parseInt(cHex.slice(j, j + 2), 16),
            g: parseInt(cHex.slice(j + 2, j + 4), 16),
            b: parseInt(cHex.slice(j + 4, j + 6), 16),
          })
        }
        currentFrame.colors.push(cRow)
      }
    }
  }
  if (currentFrame !== null) frames.push(currentFrame)

  return {
    header: { ...header, version: 1 },
    frames,
  }
}

function parseHeader(line: string): AscvHeader {
  const pairs = line.split(' ').slice(1)
  const map = new Map<string, string>()
  for (const pair of pairs) {
    const [k, v] = pair.split('=')
    if (k !== undefined && v !== undefined) map.set(k, v)
  }
  return {
    version: 1,
    cols: Number(map.get('cols') ?? 80),
    rows: Number(map.get('rows') ?? 24),
    fps: Number(map.get('fps') ?? 10),
    frameCount: Number(map.get('frames') ?? 0),
    mode: (map.get('mode') ?? 'mono') as 'mono' | 'palette' | 'fusion',
    color: map.get('color') === '1',
  }
}

export function writeAscvFile(file: AscvFile, outputPath: string): void {
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, serializeAscv(file))
}

export function readAscvFile(inputPath: string): AscvFile {
  return parseAscv(readFileSync(inputPath))
}

export function ascvFrameToAnsi(frame: AscvFrame, color: boolean): string {
  if (frame.kind === 'rich') {
    return frame.lines
      .sort((left, right) => left.lineIndex - right.lineIndex)
      .map(line => {
        let output = ''
        for (let index = 0; index < line.glyphs.length; index++) {
          const glyph = line.glyphs[index]!
          const brightness = Math.round(glyph.brightness * 255)
          if (brightness < 13) {
            output += ' '
            continue
          }
          if (color && glyph.fill !== null) {
            output += `\x1b[38;2;${glyph.fill.r};${glyph.fill.g};${glyph.fill.b}m${glyph.char}\x1b[0m`
          } else {
            output += `\x1b[38;2;${brightness};${brightness};${brightness}m${glyph.char}\x1b[0m`
          }
        }
        return output
      })
      .join('\n')
  }

  const lines: string[] = []

  for (let row = 0; row < frame.lines.length; row++) {
    const text = frame.lines[row]!
    const bRow = frame.brightness !== null ? frame.brightness[row] : null
    const cRow = frame.colors !== null ? frame.colors[row] : null

    if (bRow === null && cRow === null) {
      lines.push(text)
      continue
    }

    let line = ''
    for (let col = 0; col < text.length; col++) {
      const ch = text[col]!
      const b = bRow !== null && bRow !== undefined && bRow[col] !== undefined ? bRow[col]! : 255

      if (b < 13) {
        line += ' '
        continue
      }

      if (color && cRow !== null && cRow !== undefined && cRow[col] !== undefined) {
        const c = cRow[col]!
        const r = Math.round(c.r * b / 255)
        const g = Math.round(c.g * b / 255)
        const bl = Math.round(c.b * b / 255)
        line += `\x1b[38;2;${r};${g};${bl}m${ch}\x1b[0m`
      } else {
        line += `\x1b[38;2;${b};${b};${b}m${ch}\x1b[0m`
      }
    }
    lines.push(line)
  }

  return lines.join('\n')
}

export function ascvToHtml(
  file: AscvFile,
  outputPath: string,
  options: { title?: string } = {},
): void {
  const title = options.title ?? 'mp4toascii player'
  const isFusion = file.header.mode !== 'mono'
  const fontFamily = isFusion ? '"Georgia", "DejaVu Serif", serif' : '"Courier New", Courier, monospace'
  const fontSize = isFusion ? 14 : 10
  const textColor = isFusion ? '#e0e0e0' : '#00ff41'

  const serialized = file.frames

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0a0a0a;color:${textColor};font-family:${fontFamily};display:flex;flex-direction:column;align-items:center;min-height:100vh;padding:20px}
h1{font-size:18px;margin-bottom:8px;color:#888;font-family:sans-serif}
.meta{font-size:12px;color:#555;margin-bottom:12px;font-family:sans-serif}
#display{white-space:pre;font-size:${fontSize}px;line-height:1.3;letter-spacing:0}
.controls{margin:12px 0;display:flex;gap:12px;align-items:center;font-family:sans-serif}
button{background:#222;color:#ccc;border:1px solid #333;padding:8px 16px;cursor:pointer;border-radius:4px;font-family:sans-serif}
button:hover{background:#333}
input[type=range]{width:300px}
.info{color:#666;font-size:13px;font-family:sans-serif}
</style>
</head>
<body>
<h1>${title}</h1>
<div class="meta">${file.header.cols}x${file.header.rows} @ ${file.header.fps}fps — ${file.header.frameCount} frames — ${file.header.mode} mode</div>
<div class="controls">
<button id="play">Play</button>
<button id="reset">Reset</button>
<input id="scrub" type="range" min="0" max="${file.frames.length - 1}" value="0" step="1">
<span class="info" id="counter">0 / ${file.frames.length}</span>
</div>
<div id="display"></div>
<script>
const frames = ${JSON.stringify(serialized)};
const fps = ${file.header.fps};
const useColor = ${file.header.color};
${createRichPlayerScript()}
</script>
</body>
</html>`

  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, html, 'utf-8')
}
