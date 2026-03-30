import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { readProjectFromPath, renderFrameSvg, renderSvgToPng } from '../shared/text-video/runtime.ts'

const args = new Map<string, string>()
let writeSvg = false
let outputVideo = false

for (let index = 2; index < process.argv.length; index++) {
  const part = process.argv[index]!
  if (part === '--svg') {
    writeSvg = true
    continue
  }
  if (part === '--video') {
    outputVideo = true
    continue
  }
  if (!part.startsWith('--')) continue
  const [key, value] = part.slice(2).split('=')
  if (key && value !== undefined) args.set(key, value)
}

const inputPath = args.get('input')
if (!inputPath) {
  console.error('Usage: npm run text-video:render -- --input=examples/text-video/projects/sample/project.json [--out=out/text-video/sample] [--scale=1] [--svg] [--video]')
  process.exit(1)
}

const outDir = path.resolve(args.get('out') ?? 'out/text-video/render')
const scale = Number.parseFloat(args.get('scale') ?? '1')
if (!Number.isFinite(scale) || scale <= 0) {
  throw new Error(`Invalid --scale value: ${String(args.get('scale'))}`)
}

const loaded = await readProjectFromPath(inputPath)
const assetContext = { absoluteProjectPath: loaded.absoluteProjectPath }
const frameCount = Math.max(1, Math.round(loaded.project.video.durationSeconds * loaded.project.video.fps))
await mkdir(outDir, { recursive: true })

const framesDir = path.join(outDir, 'frames')
await mkdir(framesDir, { recursive: true })

for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
  const timeSeconds = frameIndex / loaded.project.video.fps
  const svg = await renderFrameSvg(loaded.project, timeSeconds, assetContext)
  if (writeSvg) {
    const svgPath = path.join(framesDir, `${String(frameIndex).padStart(5, '0')}.svg`)
    await writeFile(svgPath, svg)
  }
  const png = renderSvgToPng(svg, loaded.project, assetContext, scale)
  const pngPath = path.join(framesDir, `${String(frameIndex).padStart(5, '0')}.png`)
  await writeFile(pngPath, png)
}

if (outputVideo) {
  const ffmpeg = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-framerate',
      String(loaded.project.video.fps),
      '-i',
      path.join(framesDir, '%05d.png'),
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      path.join(outDir, 'video.mp4'),
    ],
    {
      stdio: 'inherit',
    },
  )
  if (ffmpeg.status !== 0) {
    throw new Error(`ffmpeg failed with exit code ${ffmpeg.status ?? -1}`)
  }
}

console.log(`Rendered ${frameCount} frames to ${outDir}`)
