import { gunzipSync, gzipSync } from 'node:zlib'

import { richFrameToSvg } from '../mp4toascii/svg.ts'
import type {
  RichFrame,
  RichGlyph,
  RgbColor,
} from '../mp4toascii/types.ts'
import type { AsciiVideoAsset, AsciiVideoLayer } from './schema.ts'
import type {
  AsciiVideoAssetPayload,
  AssetResolutionContext,
  EvaluatedAsciiVideoLayer,
} from './types.ts'

const ASCII_VIDEO_MAGIC = 'PTXA1'

type StoredAsciiVideoPayload = {
  version: 1
  width: number
  height: number
  fps: number
  background: string
  mode: 'mono' | 'palette' | 'fusion'
  color: boolean
  styles: AsciiVideoAssetPayload['styles']
  frames: Array<{ glyphs: RichGlyph[] }>
}

function normalizeFrame(frame: RichFrame): { glyphs: RichGlyph[] } {
  return {
    glyphs: frame.glyphs.map(glyph => ({
      ...glyph,
      fill: glyph.fill === null ? null : { ...glyph.fill },
    })),
  }
}

function denormalizePayload(payload: StoredAsciiVideoPayload): AsciiVideoAssetPayload {
  return {
    version: payload.version,
    width: payload.width,
    height: payload.height,
    fps: payload.fps,
    frameCount: payload.frames.length,
    background: payload.background,
    mode: payload.mode,
    color: payload.color,
    styles: payload.styles.map(style => ({ ...style })),
    frames: payload.frames.map(frame => ({
      kind: 'rich',
      width: payload.width,
      height: payload.height,
      lineHeight: payload.styles[0]?.lineHeight ?? 0,
      styles: payload.styles.map(style => ({ ...style })),
      glyphs: frame.glyphs.map(glyph => ({
        ...glyph,
        fill: glyph.fill === null ? null : { ...(glyph.fill as RgbColor) },
      })),
      background: null,
    })),
  }
}

export function frameToAsciiVideoData(
  frames: RichFrame[],
  options: {
    width: number
    height: number
    fps: number
    background: string
    mode?: 'mono' | 'palette' | 'fusion'
    color?: boolean
  },
): AsciiVideoAssetPayload {
  const styles = frames[0]?.styles ?? []
  return {
    version: 1,
    width: options.width,
    height: options.height,
    fps: options.fps,
    frameCount: frames.length,
    background: options.background,
    mode: options.mode ?? 'fusion',
    color: options.color ?? true,
    styles: styles.map(style => ({ ...style })),
    frames: frames.map(frame => ({
      kind: 'rich',
      width: options.width,
      height: options.height,
      lineHeight: frame.lineHeight,
      styles: frame.styles.map(style => ({ ...style })),
      glyphs: frame.glyphs.map(glyph => ({
        ...glyph,
        fill: glyph.fill === null ? null : { ...glyph.fill },
      })),
      background: frame.background,
    })),
  }
}

export function encodeAsciiVideoAssetData(data: AsciiVideoAssetPayload): Uint8Array {
  const payload: StoredAsciiVideoPayload = {
    version: 1,
    width: data.width,
    height: data.height,
    fps: data.fps,
    background: data.background,
    mode: data.mode,
    color: data.color,
    styles: data.styles.map(style => ({ ...style })),
    frames: data.frames.map(frame => normalizeFrame(frame)),
  }
  const raw = Buffer.from(JSON.stringify(payload), 'utf-8')
  return Buffer.concat([Buffer.from(ASCII_VIDEO_MAGIC), gzipSync(raw)])
}

export function encodeAsciiVideoAsset(
  width: number,
  height: number,
  fps: number,
  frames: RichFrame[],
  background = '#0a0a0a',
  mode: 'mono' | 'palette' | 'fusion' = 'fusion',
  color = true,
): Uint8Array {
  return encodeAsciiVideoAssetData(frameToAsciiVideoData(frames, {
    width,
    height,
    fps,
    background,
    mode,
    color,
  }))
}

export function decodeAsciiVideoAsset(data: Uint8Array): AsciiVideoAssetPayload {
  const buffer = Buffer.from(data)
  const magic = buffer.subarray(0, ASCII_VIDEO_MAGIC.length).toString('utf-8')
  if (magic !== ASCII_VIDEO_MAGIC) {
    throw new Error(`Invalid ASCII video payload magic: ${magic}`)
  }
  const payload = JSON.parse(gunzipSync(buffer.subarray(ASCII_VIDEO_MAGIC.length)).toString('utf-8')) as StoredAsciiVideoPayload
  if (payload.version !== 1) {
    throw new Error(`Unsupported ASCII video payload version: ${payload.version}`)
  }
  return denormalizePayload(payload)
}

export function decodeAsciiVideoDataUri(input: string | Uint8Array): AsciiVideoAssetPayload | null {
  if (input instanceof Uint8Array) return decodeAsciiVideoAsset(input)
  if (!input.startsWith('data:')) return null
  const base64 = input.slice(input.indexOf(',') + 1)
  return decodeAsciiVideoAsset(Uint8Array.from(Buffer.from(base64, 'base64')))
}

export function frameIndexForAsciiVideo(
  fps: number,
  frameCount: number,
  timeSeconds: number,
): number {
  if (frameCount <= 0 || fps <= 0) return 0
  const frame = Math.floor(timeSeconds * fps)
  return Math.max(0, Math.min(frameCount - 1, frame))
}

export function ascvFrameAtTime(data: Uint8Array, timeSeconds: number): RichFrame | null {
  const payload = decodeAsciiVideoAsset(data)
  const index = frameIndexForAsciiVideo(payload.fps, payload.frames.length, timeSeconds)
  return payload.frames[index] ?? null
}

export function frameToSvgFragments(
  frame: RichFrame,
  _styles?: AsciiVideoAssetPayload['styles'],
): string[] {
  const svg = richFrameToSvg(frame)
  const body = svg
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>$/, '')
  return body.length === 0 ? [] : [body]
}

export function renderAsciiVideoFrameToSvg(
  payload: AsciiVideoAssetPayload,
  frameIndex: number,
  options: {
    x: number
    y: number
    width: number
    height: number
    opacity: number
    rotation: number
    scaleX: number
    scaleY: number
  },
): string {
  const frame = payload.frames[Math.max(0, Math.min(payload.frames.length - 1, frameIndex))]
  if (frame === undefined) return ''
  const frameSvg = richFrameToSvg(frame)
  const inner = frameSvg
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>$/, '')
  return `<g transform="translate(${options.x} ${options.y}) rotate(${options.rotation}) scale(${options.scaleX} ${options.scaleY})" opacity="${options.opacity}">${inner}</g>`
}

export async function renderAsciiVideoLayerSvg(
  layer: AsciiVideoLayer | EvaluatedAsciiVideoLayer,
  _asset: AsciiVideoAsset,
  bytes: Uint8Array,
  sceneTimeSeconds: number,
  _context: AssetResolutionContext = {},
): Promise<string> {
  const payload = decodeAsciiVideoAsset(bytes)
  const index = frameIndexForAsciiVideo(payload.fps, payload.frames.length, sceneTimeSeconds)
  return renderAsciiVideoFrameToSvg(payload, index, {
    x: typeof layer.x === 'number' ? layer.x : 0,
    y: typeof layer.y === 'number' ? layer.y : 0,
    width: typeof layer.width === 'number' ? layer.width : payload.width,
    height: typeof layer.height === 'number' ? layer.height : payload.height,
    opacity: typeof layer.opacity === 'number' ? layer.opacity : 1,
    rotation: typeof layer.rotation === 'number' ? layer.rotation : 0,
    scaleX: typeof layer.scaleX === 'number' ? layer.scaleX : 1,
    scaleY: typeof layer.scaleY === 'number' ? layer.scaleY : 1,
  })
}
