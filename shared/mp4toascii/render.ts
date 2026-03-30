import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { AsciiFrame } from './ascii-map.ts'
import type { FusionFrame } from './fusion.ts'

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

export function fusionFrameToAnsi(frame: FusionFrame, color: boolean): string {
  const lineMap = new Map<number, Array<{ char: string, brightness: number, color: { r: number, g: number, b: number } | null }>>()

  for (const ch of frame.characters) {
    const lineIdx = Math.round(ch.y / frame.lineHeight)
    if (!lineMap.has(lineIdx)) lineMap.set(lineIdx, [])
    lineMap.get(lineIdx)!.push(ch)
  }

  const sortedLines = [...lineMap.entries()].sort((a, b) => a[0] - b[0])
  const lines: string[] = []

  for (const [, chars] of sortedLines) {
    let line = ''
    for (const ch of chars) {
      if (ch.brightness < 0.05) {
        line += ' '
        continue
      }

      const gray = Math.round(ch.brightness * 255)
      if (color && ch.color !== null) {
        const r = Math.round(ch.color.r * ch.brightness)
        const g = Math.round(ch.color.g * ch.brightness)
        const b = Math.round(ch.color.b * ch.brightness)
        line += `\x1b[38;2;${r};${g};${b}m${ch.char}\x1b[0m`
      } else {
        line += `\x1b[38;2;${gray};${gray};${gray}m${ch.char}\x1b[0m`
      }
    }
    lines.push(line)
  }

  return lines.join('\n')
}

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
const display = document.getElementById('display');
const scrub = document.getElementById('scrub');
const counter = document.getElementById('counter');
const playBtn = document.getElementById('play');
let idx = 0, playing = false, timer = null;
function show(i) { idx = i; display.textContent = frames[i]; scrub.value = i; counter.textContent = i + ' / ' + frames.length; }
show(0);
playBtn.addEventListener('click', () => {
  playing = !playing;
  playBtn.textContent = playing ? 'Pause' : 'Play';
  if (playing) { timer = setInterval(() => { idx = (idx + 1) % frames.length; show(idx); }, 1000 / fps); }
  else { clearInterval(timer); }
});
document.getElementById('reset').addEventListener('click', () => { playing = false; playBtn.textContent = 'Play'; clearInterval(timer); show(0); });
scrub.addEventListener('input', () => { show(Number(scrub.value)); });
</script>
</body>
</html>`

  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, html, 'utf-8')
}

export function writeFusionHtmlPage(
  frames: FusionFrame[],
  fps: number,
  outputPath: string,
  options: { title?: string, bgColor?: string, fontFamily?: string, fontSize?: number, color?: boolean } = {},
): void {
  const title = options.title ?? 'mp4toascii — text fusion'
  const bgColor = options.bgColor ?? '#0a0a0a'
  const fontFamily = options.fontFamily ?? '"Georgia", serif'
  const fontSize = options.fontSize ?? 14
  const color = options.color ?? false

  const serialized = frames.map(f => f.characters.map(c => ({
    c: c.char,
    b: Math.round(c.brightness * 255),
    r: c.color !== null ? c.color.r : undefined,
    g: c.color !== null ? c.color.g : undefined,
    bl: c.color !== null ? c.color.b : undefined,
    li: Math.round(c.y / f.lineHeight),
  })))

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: ${bgColor}; color: #e0e0e0; font-family: ${fontFamily}; display: flex; flex-direction: column; align-items: center; min-height: 100vh; padding: 20px; }
h1 { font-size: 18px; margin-bottom: 12px; color: #888; font-family: sans-serif; }
#display { font-size: ${fontSize}px; line-height: ${Math.round(fontSize * 1.4)}px; white-space: pre-wrap; max-width: 90vw; }
.controls { margin: 16px 0; display: flex; gap: 12px; align-items: center; font-family: sans-serif; }
button { background: #222; color: #ccc; border: 1px solid #333; padding: 8px 16px; cursor: pointer; border-radius: 4px; }
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
<input id="scrub" type="range" min="0" max="${serialized.length - 1}" value="0" step="1">
<span id="counter">0 / ${serialized.length}</span>
</div>
<div id="display"></div>
<script>
const frames = ${JSON.stringify(serialized)};
const fps = ${fps};
const useColor = ${color};
const display = document.getElementById('display');
const scrub = document.getElementById('scrub');
const counter = document.getElementById('counter');
const playBtn = document.getElementById('play');
let idx = 0, playing = false, timer = null;
function show(i) {
  idx = i;
  const chars = frames[i];
  let html = '';
  let currentLine = -1;
  for (const c of chars) {
    if (c.li !== currentLine) {
      if (currentLine >= 0) html += '\\n';
      currentLine = c.li;
    }
    if (c.b < 13) { html += ' '; continue; }
    let r, g, b;
    if (useColor && c.r !== undefined) {
      r = Math.round(c.r * c.b / 255);
      g = Math.round(c.g * c.b / 255);
      b = Math.round(c.bl * c.b / 255);
    } else {
      r = g = b = c.b;
    }
    const ch = c.c === '<' ? '&lt;' : c.c === '>' ? '&gt;' : c.c === '&' ? '&amp;' : c.c;
    const fw = c.b > 180 ? 'font-weight:bold;' : '';
    html += '<span style="color:rgb('+r+','+g+','+b+');'+fw+'">'+ch+'</span>';
  }
  display.innerHTML = html;
  scrub.value = i;
  counter.textContent = i + ' / ' + frames.length;
}
show(0);
playBtn.addEventListener('click', () => {
  playing = !playing;
  playBtn.textContent = playing ? 'Pause' : 'Play';
  if (playing) timer = setInterval(() => { idx = (idx + 1) % frames.length; show(idx); }, 1000 / fps);
  else clearInterval(timer);
});
document.getElementById('reset').addEventListener('click', () => { playing = false; playBtn.textContent = 'Play'; clearInterval(timer); show(0); });
scrub.addEventListener('input', () => show(Number(scrub.value)));
</script>
</body>
</html>`

  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, html, 'utf-8')
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
