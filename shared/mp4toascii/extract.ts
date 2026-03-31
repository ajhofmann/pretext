import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import type { ContentCue, FramePixels as SharedFramePixels } from './types.ts'

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

export type SubtitleFormat = 'srt' | 'vtt'

export type RawVideoInput = {
  width: number
  height: number
  pixFmt?: 'gray' | 'rgb24'
  stdin: Buffer
}

export type FramePixels = SharedFramePixels

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

function parseTimestampToSeconds(raw: string): number {
  const normalized = raw.trim().replace(',', '.')
  const parts = normalized.split(':')
  if (parts.length !== 3) return 0
  const [hours, minutes, seconds] = parts
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)
}

function detectSubtitleFormat(contents: string): SubtitleFormat {
  return contents.trimStart().startsWith('WEBVTT') ? 'vtt' : 'srt'
}

function parseCueBlocks(contents: string, format: SubtitleFormat): ContentCue[] {
  const normalized = contents.replace(/\r\n/g, '\n').trim()
  const blocks = normalized.split(/\n{2,}/)
  const cues: ContentCue[] = []

  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
    const block = blocks[blockIndex]!.trim()
    if (block === '' || (format === 'vtt' && block === 'WEBVTT')) continue
    const lines = block.split('\n').map(line => line.trim()).filter(Boolean)
    if (lines.length === 0) continue

    let timingLineIndex = 0
    if (!lines[0]!.includes('-->')) timingLineIndex = 1
    const timingLine = lines[timingLineIndex]
    if (timingLine === undefined || !timingLine.includes('-->')) continue

    const [startRaw, endRawWithSettings] = timingLine.split('-->')
    if (startRaw === undefined || endRawWithSettings === undefined) continue
    const endRaw = endRawWithSettings.trim().split(/\s+/)[0]
    if (endRaw === undefined) continue

    const text = lines.slice(timingLineIndex + 1).join(' ').trim()
    if (text === '') continue

    cues.push({
      startSeconds: parseTimestampToSeconds(startRaw),
      endSeconds: parseTimestampToSeconds(endRaw),
      text,
      source: 'subtitle',
    })
  }

  return cues
}

export function parseSubtitleText(contents: string): ContentCue[] {
  return parseCueBlocks(contents, detectSubtitleFormat(contents))
}

export function readSubtitleFile(inputPath: string): ContentCue[] {
  return parseSubtitleText(readFileSync(inputPath, 'utf-8'))
}

export function extractSubtitles(inputPath: string): ContentCue[] {
  const raw = execFileSync('ffprobe', [
    '-v', 'error',
    '-select_streams', 's',
    '-show_entries', 'stream=index,codec_name',
    '-of', 'csv=p=0',
    inputPath,
  ], { encoding: 'utf-8' }).trim()

  if (raw === '') return []

  const firstStream = raw.split('\n')[0]!.split(',')[0]!.trim()
  const srt = execFileSync('ffmpeg', [
    '-v', 'error',
    '-i', inputPath,
    '-map', `0:s:${firstStream}`,
    '-f', 'srt',
    '-',
  ], { encoding: 'utf-8' })

  return parseSubtitleText(srt)
}

export function extractFramesFromRawVideo(input: RawVideoInput): FramePixels[] {
  const pixFmt = input.pixFmt ?? 'gray'
  const bytesPerPixel = pixFmt === 'rgb24' ? 3 : 1
  const frameBytes = input.width * input.height * bytesPerPixel
  if (frameBytes <= 0) return []
  if (input.stdin.byteLength % frameBytes !== 0) {
    throw new Error('Raw video buffer length is not a whole number of frames.')
  }

  const frameCount = input.stdin.byteLength / frameBytes
  const frames: FramePixels[] = []
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
    const offset = frameIndex * frameBytes
    const grayscale = new Uint8Array(input.width * input.height)
    const rgb = new Uint8Array(input.width * input.height * 3)
    if (pixFmt === 'gray') {
      const source = input.stdin.subarray(offset, offset + frameBytes)
      grayscale.set(source)
      for (let index = 0; index < source.length; index++) {
        const value = source[index]!
        rgb[index * 3] = value
        rgb[index * 3 + 1] = value
        rgb[index * 3 + 2] = value
      }
    } else {
      const source = input.stdin.subarray(offset, offset + frameBytes)
      rgb.set(source)
      for (let index = 0; index < input.width * input.height; index++) {
        const r = source[index * 3]!
        const g = source[index * 3 + 1]!
        const b = source[index * 3 + 2]!
        grayscale[index] = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
      }
    }
    frames.push({
      width: input.width,
      height: input.height,
      grayscale,
      rgb,
    })
  }
  return frames
}
