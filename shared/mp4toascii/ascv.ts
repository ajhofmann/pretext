import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'

import type { AsciiFrame } from './ascii-map.ts'
import type { FusionFrame } from './fusion.ts'

export type AscvHeader = {
  cols: number
  rows: number
  fps: number
  frameCount: number
  mode: 'mono' | 'fusion'
  color: boolean
}

export type AscvFrame = {
  lines: string[]
  brightness: number[][] | null
  colors: Array<Array<{ r: number, g: number, b: number }>> | null
}

export type AscvFile = {
  header: AscvHeader
  frames: AscvFrame[]
}

const MAGIC = 'ASCV1'

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

    frames.push({ lines, brightness, colors: frameColors })
  }

  return {
    header: { cols: first.cols, rows: first.rows, fps, frameCount: frames.length, mode: 'mono', color },
    frames,
  }
}

export function encodeFusionFrames(
  fusionFrames: FusionFrame[],
  cols: number,
  rows: number,
  fps: number,
  color: boolean,
): AscvFile {
  const frames: AscvFrame[] = []

  for (const frame of fusionFrames) {
    const lineMap = new Map<number, Array<{ char: string, brightness: number, color: { r: number, g: number, b: number } | null }>>()

    for (const ch of frame.characters) {
      const lineIdx = Math.round(ch.y / frame.lineHeight)
      if (!lineMap.has(lineIdx)) lineMap.set(lineIdx, [])
      lineMap.get(lineIdx)!.push(ch)
    }

    const sortedKeys = [...lineMap.keys()].sort((a, b) => a - b)
    const lines: string[] = []
    const brightness: number[][] = []
    const frameColors: Array<Array<{ r: number, g: number, b: number }>> | null = color ? [] : null

    for (const key of sortedKeys) {
      const chars = lineMap.get(key)!
      let line = ''
      const rowBrightness: number[] = []
      const rowColors: Array<{ r: number, g: number, b: number }> = []

      for (const ch of chars) {
        line += ch.char
        rowBrightness.push(Math.round(ch.brightness * 255))
        if (ch.color !== null) {
          rowColors.push(ch.color)
        } else {
          const g = Math.round(ch.brightness * 255)
          rowColors.push({ r: g, g, b: g })
        }
      }

      lines.push(line)
      brightness.push(rowBrightness)
      if (frameColors !== null) frameColors.push(rowColors)
    }

    frames.push({ lines, brightness, colors: frameColors })
  }

  return {
    header: { cols, rows, fps, frameCount: frames.length, mode: 'fusion', color },
    frames,
  }
}

export function serializeAscv(file: AscvFile): Buffer {
  const headerLine = `${MAGIC} cols=${file.header.cols} rows=${file.header.rows} fps=${file.header.fps} frames=${file.header.frameCount} mode=${file.header.mode} color=${file.header.color ? 1 : 0}`

  const parts: string[] = [headerLine, '']

  for (let i = 0; i < file.frames.length; i++) {
    const frame = file.frames[i]!
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
  return Buffer.concat([Buffer.from(MAGIC), gzipSync(Buffer.from(raw, 'utf-8'))])
}

export function parseAscv(data: Buffer): AscvFile {
  const magicStr = data.subarray(0, 5).toString('ascii')
  if (magicStr !== MAGIC) {
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
      currentFrame = { lines: [], brightness: [], colors: header.color ? [] : null }
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

  return { header, frames }
}

function parseHeader(line: string): AscvHeader {
  const pairs = line.split(' ').slice(1)
  const map = new Map<string, string>()
  for (const pair of pairs) {
    const [k, v] = pair.split('=')
    if (k !== undefined && v !== undefined) map.set(k, v)
  }
  return {
    cols: Number(map.get('cols') ?? 80),
    rows: Number(map.get('rows') ?? 24),
    fps: Number(map.get('fps') ?? 10),
    frameCount: Number(map.get('frames') ?? 0),
    mode: (map.get('mode') ?? 'mono') as 'mono' | 'fusion',
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
  const isFusion = file.header.mode === 'fusion'
  const fontFamily = isFusion ? '"Georgia", "DejaVu Serif", serif' : '"Courier New", Courier, monospace'
  const fontSize = isFusion ? 14 : 10
  const textColor = isFusion ? '#e0e0e0' : '#00ff41'

  const serialized = file.frames.map(f => ({
    lines: f.lines,
    b: f.brightness,
    c: f.colors,
  }))

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
<pre id="display"></pre>
<script>
const data=${JSON.stringify(serialized)};
const fps=${file.header.fps};
const hasB=data[0].b&&data[0].b.length>0;
const hasC=${file.header.color}&&data[0].c&&data[0].c.length>0;
const d=document.getElementById('display');
const s=document.getElementById('scrub');
const ct=document.getElementById('counter');
const pb=document.getElementById('play');
let idx=0,playing=false,timer=null;
function show(i){
  idx=i;s.value=i;ct.textContent=i+' / '+data.length;
  const f=data[i];
  if(!hasB){d.textContent=f.lines.join('\\n');return}
  let h='';
  for(let r=0;r<f.lines.length;r++){
    if(r>0)h+='\\n';
    const t=f.lines[r],br=f.b[r],cr=hasC?f.c[r]:null;
    for(let c=0;c<t.length;c++){
      const b=br&&br[c]!==undefined?br[c]:255;
      if(b<13){h+=' ';continue}
      const ch=t[c]==='<'?'&lt;':t[c]==='>'?'&gt;':t[c]==='&'?'&amp;':t[c];
      let r2,g,bl;
      if(cr&&cr[c]){r2=Math.round(cr[c].r*b/255);g=Math.round(cr[c].g*b/255);bl=Math.round(cr[c].b*b/255)}
      else{r2=g=bl=b}
      const fw=b>180?'font-weight:bold;':'';
      h+='<span style="color:rgb('+r2+','+g+','+bl+');'+fw+'">'+ch+'</span>';
    }
  }
  d.innerHTML=h;
}
show(0);
pb.addEventListener('click',()=>{
  playing=!playing;pb.textContent=playing?'Pause':'Play';
  if(playing)timer=setInterval(()=>{idx=(idx+1)%data.length;show(idx)},1000/fps);
  else clearInterval(timer);
});
document.getElementById('reset').addEventListener('click',()=>{playing=false;pb.textContent='Play';clearInterval(timer);show(0)});
s.addEventListener('input',()=>show(Number(s.value)));
</script>
</body>
</html>`

  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, html, 'utf-8')
}
