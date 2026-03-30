import type { ColorValue, KeyframeTrack, NumericValue, PointValue } from './types.ts'
import type { Easing, Point2D } from './schema.ts'

function clamp01(value: number): number {
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

export function applyEasing(progress: number, easing: Easing): number {
  const t = clamp01(progress)
  switch (easing) {
    case 'linear':
      return t
    case 'ease-in':
      return t * t
    case 'ease-out':
      return 1 - (1 - t) * (1 - t)
    case 'ease-in-out':
      return t < 0.5
        ? 2 * t * t
        : 1 - Math.pow(-2 * t + 2, 2) / 2
    case 'step-start':
      return t <= 0 ? 0 : 1
    case 'step-end':
      return t < 1 ? 0 : 1
    default:
      return t
  }
}

export function parseHexColor(input: string): { r: number, g: number, b: number, a: number } | null {
  const normalized = input.trim().toLowerCase()
  if (!normalized.startsWith('#')) return null
  const hex = normalized.slice(1)
  if (hex.length === 3 || hex.length === 4) {
    const [r, g, b, a = 'f'] = hex.split('')
    return {
      r: Number.parseInt(`${r}${r}`, 16),
      g: Number.parseInt(`${g}${g}`, 16),
      b: Number.parseInt(`${b}${b}`, 16),
      a: Number.parseInt(`${a}${a}`, 16) / 255,
    }
  }
  if (hex.length === 6 || hex.length === 8) {
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
      a: hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1,
    }
  }
  return null
}

function mixNumber(from: number, to: number, progress: number): number {
  return from + (to - from) * progress
}

export function mixColor(from: string, to: string, progress: number): string {
  const parsedFrom = parseHexColor(from)
  const parsedTo = parseHexColor(to)
  if (parsedFrom === null || parsedTo === null) {
    return progress < 0.5 ? from : to
  }
  const r = Math.round(mixNumber(parsedFrom.r, parsedTo.r, progress))
  const g = Math.round(mixNumber(parsedFrom.g, parsedTo.g, progress))
  const b = Math.round(mixNumber(parsedFrom.b, parsedTo.b, progress))
  const a = mixNumber(parsedFrom.a, parsedTo.a, progress)
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(6)})`
}

export function evaluateNumericValue(value: NumericValue, timeSeconds: number): number {
  if (typeof value === 'number') return value
  if ('from' in value) {
    const progress = applyEasing(1, value.easing ?? 'linear')
    return mixNumber(value.from, value.to, progress === 1 ? 1 : progress)
  }
  if (value.keyframes.length === 0) throw new Error('Numeric keyframe track must have at least one keyframe.')
  if (timeSeconds <= value.keyframes[0]!.time) return value.keyframes[0]!.value
  const last = value.keyframes[value.keyframes.length - 1]!
  if (timeSeconds >= last.time) return last.value
  for (let index = 0; index < value.keyframes.length - 1; index++) {
    const start = value.keyframes[index]!
    const end = value.keyframes[index + 1]!
    if (timeSeconds < start.time || timeSeconds > end.time) continue
    const duration = end.time - start.time
    const rawProgress = duration <= 0 ? 1 : (timeSeconds - start.time) / duration
    const eased = applyEasing(rawProgress, start.easing ?? 'linear')
    return mixNumber(start.value, end.value, eased)
  }
  return last.value
}

export function evaluatePointTrack(track: KeyframeTrack<Point2D>, timeSeconds: number): Point2D {
  if (track.keyframes.length === 0) throw new Error('Point keyframe track must have at least one keyframe.')
  if (timeSeconds <= track.keyframes[0]!.time) return track.keyframes[0]!.value
  const last = track.keyframes[track.keyframes.length - 1]!
  if (timeSeconds >= last.time) return last.value
  for (let index = 0; index < track.keyframes.length - 1; index++) {
    const start = track.keyframes[index]!
    const end = track.keyframes[index + 1]!
    if (timeSeconds < start.time || timeSeconds > end.time) continue
    const duration = end.time - start.time
    const rawProgress = duration <= 0 ? 1 : (timeSeconds - start.time) / duration
    const eased = applyEasing(rawProgress, start.easing ?? 'linear')
    return {
      x: mixNumber(start.value.x, end.value.x, eased),
      y: mixNumber(start.value.y, end.value.y, eased),
    }
  }
  return last.value
}

export function evaluatePointValue(value: PointValue, timeSeconds: number): Point2D {
  if ('x' in value && 'y' in value) return value
  return evaluatePointTrack(value, timeSeconds)
}

export function evaluateColorValue(value: ColorValue, timeSeconds: number): string {
  if (typeof value === 'string') return value
  if ('from' in value) {
    const progress = applyEasing(1, value.easing ?? 'linear')
    return mixColor(value.from, value.to, progress === 1 ? 1 : progress)
  }
  if (value.keyframes.length === 0) throw new Error('Color keyframe track must have at least one keyframe.')
  if (timeSeconds <= value.keyframes[0]!.time) return value.keyframes[0]!.value
  const last = value.keyframes[value.keyframes.length - 1]!
  if (timeSeconds >= last.time) return last.value
  for (let index = 0; index < value.keyframes.length - 1; index++) {
    const start = value.keyframes[index]!
    const end = value.keyframes[index + 1]!
    if (timeSeconds < start.time || timeSeconds > end.time) continue
    const duration = end.time - start.time
    const rawProgress = duration <= 0 ? 1 : (timeSeconds - start.time) / duration
    const eased = applyEasing(rawProgress, start.easing ?? 'linear')
    return mixColor(start.value, end.value, eased)
  }
  return last.value
}
