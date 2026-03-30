import type { FramePixels } from './extract.ts'

export type FusionCharacter = {
  char: string
  x: number
  y: number
  brightness: number
  color: { r: number, g: number, b: number } | null
}

export type FusionFrame = {
  width: number
  height: number
  lineHeight: number
  characters: FusionCharacter[]
}

export type PretextModule = {
  prepareWithSegments: (text: string, font: string) => {
    widths: number[]
    segments: string[]
  }
  layoutWithLines: (prepared: unknown, maxWidth: number, lineHeight: number) => {
    lines: Array<{ text: string, width: number, start: { segmentIndex: number, graphemeIndex: number }, end: { segmentIndex: number, graphemeIndex: number } }>
  }
}

export type FusionOptions = {
  text: string
  font: string
  fontSize: number
  lineHeight: number
  maxWidth: number
  invert: boolean
  color: boolean
}

type CharPosition = {
  char: string
  x: number
  y: number
  lineIndex: number
}

export function layoutTextPositions(
  pretext: PretextModule,
  options: FusionOptions,
): CharPosition[] {
  const prepared = pretext.prepareWithSegments(options.text, options.font)
  const layout = pretext.layoutWithLines(prepared, options.maxWidth, options.lineHeight)

  const positions: CharPosition[] = []
  const measureCanvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(1, 1)
    : null

  const ctx = measureCanvas?.getContext('2d') as CanvasRenderingContext2D | null

  for (let lineIdx = 0; lineIdx < layout.lines.length; lineIdx++) {
    const line = layout.lines[lineIdx]!
    const y = lineIdx * options.lineHeight
    let x = 0

    for (let charIdx = 0; charIdx < line.text.length; charIdx++) {
      const ch = line.text[charIdx]!
      positions.push({ char: ch, x, y, lineIndex: lineIdx })

      if (ctx !== null) {
        ctx.font = options.font
        x += ctx.measureText(ch).width
      } else {
        x += options.fontSize * 0.6
      }
    }
  }

  return positions
}

export function fuseFrameWithText(
  frame: FramePixels,
  charPositions: CharPosition[],
  options: FusionOptions,
): FusionFrame {
  const totalTextHeight = charPositions.length > 0
    ? charPositions[charPositions.length - 1]!.y + options.lineHeight
    : options.lineHeight

  const characters: FusionCharacter[] = []

  for (const pos of charPositions) {
    const normX = pos.x / options.maxWidth
    const normY = pos.y / totalTextHeight

    const pixelX = Math.min(frame.width - 1, Math.max(0, Math.round(normX * frame.width)))
    const pixelY = Math.min(frame.height - 1, Math.max(0, Math.round(normY * frame.height)))
    const pixelIndex = pixelY * frame.width + pixelX

    let brightness = frame.grayscale[pixelIndex]! / 255
    if (options.invert) brightness = 1 - brightness

    let color: { r: number, g: number, b: number } | null = null
    if (options.color) {
      color = {
        r: frame.rgb[pixelIndex * 3]!,
        g: frame.rgb[pixelIndex * 3 + 1]!,
        b: frame.rgb[pixelIndex * 3 + 2]!,
      }
    }

    characters.push({
      char: pos.char,
      x: pos.x,
      y: pos.y,
      brightness,
      color,
    })
  }

  return {
    width: options.maxWidth,
    height: totalTextHeight,
    lineHeight: options.lineHeight,
    characters,
  }
}
