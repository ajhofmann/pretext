import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createCanvas, loadImage } from '@napi-rs/canvas'

export type VideoInfo = {
  width: number
  height: number
  fps: number
  duration: number
  frameCount: number
}

export type ExtractOptions = {
  cols: number
  rows: number
  fps?: number
}

export type FramePixels = {
  width: number
  height: number
  grayscale: Uint8Array
  rgb: Uint8Array
}

export function probeVideo(inputPath: string): VideoInfo {
  const raw = execFileSync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate,duration,nb_frames',
    '-show_entries', 'format=duration',
    '-of', 'json',
    inputPath,
  ], { encoding: 'utf-8' })

  const data = JSON.parse(raw) as {
    streams: Array<{ width: number, height: number, r_frame_rate: string, duration?: string, nb_frames?: string }>
    format?: { duration?: string }
  }
  const stream = data.streams[0]!
  const [num, den] = stream.r_frame_rate.split('/').map(Number)
  const fps = den !== undefined && den > 0 ? num! / den : num!
  const duration = Number(stream.duration ?? data.format?.duration ?? '0')
  const frameCount = stream.nb_frames !== undefined
    ? Number(stream.nb_frames)
    : Math.round(duration * fps)

  return { width: stream.width, height: stream.height, fps, duration, frameCount }
}

export async function extractFrames(
  inputPath: string,
  options: ExtractOptions,
): Promise<FramePixels[]> {
  const info = probeVideo(inputPath)
  const targetFps = options.fps ?? info.fps
  const tempDir = join(tmpdir(), `mp4toascii-${Date.now()}`)
  mkdirSync(tempDir, { recursive: true })

  try {
    const filters = [`scale=${options.cols}:${options.rows}:flags=lanczos`]
    if (targetFps !== info.fps) {
      filters.push(`fps=${targetFps}`)
    }

    execFileSync('ffmpeg', [
      '-i', inputPath,
      '-vf', filters.join(','),
      '-pix_fmt', 'rgb24',
      join(tempDir, '%05d.png'),
    ], { stdio: 'pipe' })

    const files = readdirSync(tempDir)
      .filter(f => f.endsWith('.png'))
      .sort()

    const frames: FramePixels[] = []
    for (const file of files) {
      const img = await loadImage(readFileSync(join(tempDir, file)))
      const canvas = createCanvas(options.cols, options.rows)
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, options.cols, options.rows)
      const imageData = ctx.getImageData(0, 0, options.cols, options.rows)
      const rgba = imageData.data

      const pixelCount = options.cols * options.rows
      const grayscale = new Uint8Array(pixelCount)
      const rgb = new Uint8Array(pixelCount * 3)

      for (let i = 0; i < pixelCount; i++) {
        const r = rgba[i * 4]!
        const g = rgba[i * 4 + 1]!
        const b = rgba[i * 4 + 2]!
        grayscale[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
        rgb[i * 3] = r
        rgb[i * 3 + 1] = g
        rgb[i * 3 + 2] = b
      }

      frames.push({ width: options.cols, height: options.rows, grayscale, rgb })
    }
    return frames
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}
