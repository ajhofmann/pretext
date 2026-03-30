import { createCanvas } from '@napi-rs/canvas'
import type { FramePixels } from './extract.ts'

const MONO_RAMP = ' .`-_\':,;^=+/|)\\!?0oOQ#%@'

export type CharEntry = {
  char: string
  brightness: number
  width: number
  font: string
  weight: number
  style: 'normal' | 'italic'
}

export type AsciiFrame = {
  cols: number
  rows: number
  chars: string[]
  colors: Array<{ r: number, g: number, b: number }> | null
}

export function monoCharForBrightness(brightness: number, invert: boolean): string {
  const b = invert ? 1 - brightness : brightness
  const index = Math.min(MONO_RAMP.length - 1, (b * MONO_RAMP.length) | 0)
  return MONO_RAMP[index]!
}

export function mapFrameMono(
  frame: FramePixels,
  invert: boolean,
  color: boolean,
): AsciiFrame {
  const chars: string[] = []
  const colors: Array<{ r: number, g: number, b: number }> | null = color ? [] : null

  for (let i = 0; i < frame.width * frame.height; i++) {
    const brightness = frame.grayscale[i]! / 255
    chars.push(monoCharForBrightness(brightness, invert))
    if (colors !== null) {
      colors.push({
        r: frame.rgb[i * 3]!,
        g: frame.rgb[i * 3 + 1]!,
        b: frame.rgb[i * 3 + 2]!,
      })
    }
  }

  return { cols: frame.width, rows: frame.height, chars, colors }
}

export function buildProportionalPalette(
  fontFamily: string,
  fontSize: number,
): CharEntry[] {
  const canvas = createCanvas(32, 32)
  const ctx = canvas.getContext('2d')
  const charset = ' .,:;!+-=*#@%&abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const weights = [400, 700] as const
  const styles = ['normal', 'italic'] as const

  const entries: CharEntry[] = []

  for (const style of styles) {
    for (const weight of weights) {
      const font = `${style === 'italic' ? 'italic ' : ''}${weight} ${fontSize}px ${fontFamily}`
      for (const ch of charset) {
        if (ch === ' ') continue
        ctx.clearRect(0, 0, 32, 32)
        ctx.font = font
        ctx.fillStyle = '#fff'
        ctx.textBaseline = 'middle'
        ctx.fillText(ch, 1, 16)

        const data = ctx.getImageData(0, 0, 32, 32).data
        let sum = 0
        for (let j = 3; j < data.length; j += 4) sum += data[j]!
        const brightness = sum / (255 * 32 * 32)

        const metrics = ctx.measureText(ch)
        const width = metrics.width

        if (width > 0 && brightness > 0) {
          entries.push({ char: ch, brightness, width, font, weight, style })
        }
      }
    }
  }

  const maxB = Math.max(...entries.map(e => e.brightness))
  if (maxB > 0) {
    for (const e of entries) e.brightness /= maxB
  }
  entries.sort((a, b) => a.brightness - b.brightness)
  return entries
}

export function findBestChar(
  palette: CharEntry[],
  targetBrightness: number,
  targetWidth: number,
): CharEntry {
  let lo = 0
  let hi = palette.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (palette[mid]!.brightness < targetBrightness) lo = mid + 1
    else hi = mid
  }

  let bestScore = Infinity
  let best = palette[lo]!
  const start = Math.max(0, lo - 12)
  const end = Math.min(palette.length, lo + 12)
  for (let i = start; i < end; i++) {
    const entry = palette[i]!
    const bErr = Math.abs(entry.brightness - targetBrightness) * 2.5
    const wErr = Math.abs(entry.width - targetWidth) / targetWidth
    const score = bErr + wErr
    if (score < bestScore) {
      bestScore = score
      best = entry
    }
  }
  return best
}
