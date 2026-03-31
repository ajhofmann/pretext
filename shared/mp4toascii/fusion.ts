import type {
  FrameAnalysis,
  FrameMetadata,
  FramePixels,
  GlyphPaletteEntry,
  GlyphStyle,
  LayoutMode,
  LayoutSlot,
  PaletteOptions,
  PositionedTextLine,
  RichFrame,
  RichGlyph,
  RgbColor,
  TextCursor,
} from './types.ts'
import { applyOrderedDither } from './dither.ts'
import { analyzeEdges } from './edge.ts'
import {
  findBestGlyphEntry,
  styleIndexForEntry,
  uniqueGlyphStyles,
} from './palette.ts'
import {
  applyCharacterStability,
  computePulseWidth,
  computeScrollDelta,
  isSceneCut,
  smoothBrightnessSeries,
} from './temporal.ts'

type PreparedLine = {
  text: string
  width: number
  start: TextCursor
  end: TextCursor
}

export type PretextModule = {
  prepareWithSegments: (text: string, font: string, options?: { whiteSpace?: 'normal' | 'pre-wrap' }) => {
    widths: number[]
    segments: string[]
  }
  layoutWithLines: (prepared: unknown, maxWidth: number, lineHeight: number) => {
    lines: Array<PreparedLine>
  }
  layoutNextLine: (prepared: unknown, start: TextCursor, maxWidth: number) => PreparedLine | null
}

export type FusionOptions = {
  text: string
  font: string
  fontSize: number
  lineHeight: number
  maxWidth: number
  invert: boolean
  color: boolean
  frameIndex?: number
  timestampSeconds?: number
  layout?: LayoutMode
}

export type RichFusionOptions = FusionOptions & {
  palette: GlyphPaletteEntry[]
  paletteOptions?: Pick<PaletteOptions, 'targetCellWidth'>
  smoothing?: number
  stability?: number
  scrollStep?: number
  scrollModulation?: 'none' | 'brightness' | 'motion'
  pulseStrength?: number
  cutThreshold?: number
  previousFrame?: RichFrame | null
  previousPixels?: FramePixels | null
  dither?: 'none' | 'bayer2' | 'bayer4' | 'bayer8'
  edgeBias?: number
  frameAnalysis?: FrameAnalysis | null
  styles?: GlyphStyle[]
  slots?: LayoutSlot[]
  background?: RgbColor | null
  metadata?: Partial<FrameMetadata>
}

type CharPosition = {
  char: string
  x: number
  y: number
  lineIndex: number
}

type StabilityCell = {
  brightness: number
  glyph: GlyphPaletteEntry | null
}

function createMeasureContext(): CanvasRenderingContext2D | null {
  const measureCanvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(1, 1)
    : null
  return measureCanvas?.getContext('2d') as CanvasRenderingContext2D | null
}

function glyphColor(frame: FramePixels, pixelIndex: number, color: boolean, brightness: number): RgbColor | null {
  if (!color) return null
  return {
    r: Math.round(frame.rgb[pixelIndex * 3]! * brightness),
    g: Math.round(frame.rgb[pixelIndex * 3 + 1]! * brightness),
    b: Math.round(frame.rgb[pixelIndex * 3 + 2]! * brightness),
  }
}

function sampleFrameBrightness(
  frame: FramePixels,
  x: number,
  y: number,
  maxWidth: number,
  totalTextHeight: number,
  invert: boolean,
): { pixelIndex: number, brightness: number } {
  const normX = maxWidth <= 0 ? 0 : x / maxWidth
  const normY = totalTextHeight <= 0 ? 0 : y / totalTextHeight
  const pixelX = Math.min(frame.width - 1, Math.max(0, Math.round(normX * frame.width)))
  const pixelY = Math.min(frame.height - 1, Math.max(0, Math.round(normY * frame.height)))
  const pixelIndex = pixelY * frame.width + pixelX
  let brightness = frame.grayscale[pixelIndex]! / 255
  if (invert) brightness = 1 - brightness
  return { pixelIndex, brightness }
}

function totalTextHeightFromPositions(charPositions: CharPosition[], lineHeight: number): number {
  return charPositions.length > 0
    ? charPositions[charPositions.length - 1]!.y + lineHeight
    : lineHeight
}

function positionsFromPreparedLines(
  lines: PreparedLine[],
  font: string,
  fontSize: number,
  lineHeight: number,
): CharPosition[] {
  const positions: CharPosition[] = []
  const ctx = createMeasureContext()

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]!
    const y = lineIdx * lineHeight
    let x = 0
    for (let charIdx = 0; charIdx < line.text.length; charIdx++) {
      const char = line.text[charIdx]!
      positions.push({ char, x, y, lineIndex: lineIdx })
      if (ctx !== null) {
        ctx.font = font
        x += ctx.measureText(char).width
      } else {
        x += fontSize * 0.6
      }
    }
  }

  return positions
}

function computeFrameAnalysis(
  current: FramePixels,
  previous: FramePixels | null | undefined,
  width: number,
  height: number,
  cutThreshold: number,
): FrameAnalysis {
  let currentSum = 0
  for (let index = 0; index < current.grayscale.length; index++) {
    currentSum += current.grayscale[index]!
  }
  const averageBrightness = current.grayscale.length === 0
    ? 0
    : currentSum / (current.grayscale.length * 255)

  let energy = 0
  let dx = 0
  let dy = 0
  let previousAverageBrightness = averageBrightness
  if (previous !== null && previous !== undefined && previous.grayscale.length === current.grayscale.length) {
    let previousSum = 0
    const gridWidth = Math.max(1, width)
    const gridHeight = Math.max(1, height)
    const sampleStepX = Math.max(1, Math.floor(current.width / gridWidth))
    const sampleStepY = Math.max(1, Math.floor(current.height / gridHeight))
    for (let index = 0; index < previous.grayscale.length; index++) {
      previousSum += previous.grayscale[index]!
      energy += Math.abs(current.grayscale[index]! - previous.grayscale[index]!) / 255
    }
    previousAverageBrightness = previous.grayscale.length === 0
      ? averageBrightness
      : previousSum / (previous.grayscale.length * 255)

    for (let cellY = 0; cellY < gridHeight; cellY++) {
      for (let cellX = 0; cellX < gridWidth; cellX++) {
        const px = Math.min(current.width - 1, cellX * sampleStepX)
        const py = Math.min(current.height - 1, cellY * sampleStepY)
        const currentIndex = py * current.width + px
        const leftX = Math.max(0, px - sampleStepX)
        const upY = Math.max(0, py - sampleStepY)
        const leftIndex = py * current.width + leftX
        const upIndex = upY * current.width + px
        dx += (current.grayscale[currentIndex]! - previous.grayscale[leftIndex]!) / 255
        dy += (current.grayscale[currentIndex]! - previous.grayscale[upIndex]!) / 255
      }
    }
    energy /= current.grayscale.length
  }

  const motion = {
    dx,
    dy,
    magnitude: Math.sqrt(dx * dx + dy * dy),
  }
  const { directions, magnitudes } = analyzeEdges(current)
  return {
    averageBrightness,
    energy,
    motion,
    cut: isSceneCut(previousAverageBrightness, averageBrightness, cutThreshold),
    edgeDirections: directions,
    gradientMagnitudes: magnitudes,
  }
}

function padSlots(maxWidth: number, slots?: LayoutSlot[]): LayoutSlot[] {
  if (slots === undefined || slots.length === 0) {
    return [{ left: 0, right: maxWidth }]
  }
  return slots
}

function positionedLineToGlyphs(
  frame: FramePixels,
  line: PositionedTextLine,
  palette: GlyphPaletteEntry[],
  styles: GlyphStyle[],
  options: RichFusionOptions,
  previousGlyphsByIndex: Map<number, RichGlyph>,
  analysis: FrameAnalysis,
  slotWidth: number,
  glyphOffset: number,
): RichGlyph[] {
  const glyphs: RichGlyph[] = []
  const ctx = createMeasureContext()
  let x = line.x
  const previousBrightnessSeries = new Array<number>(line.text.length).fill(0).map((_, index) => (
    previousGlyphsByIndex.get(glyphOffset + index)?.brightness ?? 0
  ))
  const currentBrightnessSeries: number[] = []

  for (let charIndex = 0; charIndex < line.text.length; charIndex++) {
    const { brightness: rawBrightness } = sampleFrameBrightness(
      frame,
      x,
      line.y,
      options.maxWidth,
      Math.max(options.lineHeight, line.y + line.lineHeight),
      options.invert,
    )
    const ditheredBrightness = applyOrderedDither(
      rawBrightness,
      charIndex,
      line.lineIndex,
      options.dither ?? 'none',
    )
    currentBrightnessSeries.push(ditheredBrightness)
  }

  const stableBrightnessSeries = applyCharacterStability(
    new Array<StabilityCell>(line.text.length).fill({
      brightness: 0,
      glyph: null,
    }).map((_, index) => {
      const previousGlyph = previousGlyphsByIndex.get(glyphOffset + index)
      if (previousGlyph === undefined) {
        return {
          brightness: currentBrightnessSeries[index] ?? 0,
          glyph: null,
        }
      }
      return {
        brightness: previousGlyph.brightness,
        glyph: palette.find(entry => entry.char === previousGlyph.char) ?? null,
      }
    }),
    currentBrightnessSeries,
    options.stability ?? 0,
  )
  const smoothedBrightnessSeries = smoothBrightnessSeries(
    previousBrightnessSeries,
    stableBrightnessSeries,
    options.smoothing ?? 0,
  )

  for (let charIndex = 0; charIndex < line.text.length; charIndex++) {
    const { pixelIndex } = sampleFrameBrightness(
      frame,
      x,
      line.y,
      options.maxWidth,
      Math.max(options.lineHeight, line.y + line.lineHeight),
      options.invert,
    )
    const smoothedBrightness = smoothedBrightnessSeries[charIndex]!
    const previousEntry = previousGlyphsByIndex.has(glyphOffset + charIndex)
      ? palette.find(entry => entry.char === previousGlyphsByIndex.get(glyphOffset + charIndex)!.char) ?? null
      : null
    const best = findBestGlyphEntry(
      palette,
      smoothedBrightness,
      slotWidth / Math.max(1, line.text.length),
      {
        edgeDirection: analysis.edgeDirections[(line.lineIndex * Math.max(1, Math.round(slotWidth))) + charIndex] ?? 'flat',
        edgeBias: options.edgeBias ?? 0,
        stabilityBonus: options.stability ?? 0,
        previous: previousEntry,
      },
    )
    const styleIndex = styleIndexForEntry(styles, best)
    glyphs.push({
      char: best.char,
      x,
      y: line.y,
      styleIndex,
      opacity: smoothedBrightness,
      fill: glyphColor(frame, pixelIndex, options.color, smoothedBrightness),
      brightness: smoothedBrightness,
      lineIndex: line.lineIndex,
    })
    if (ctx !== null) {
      ctx.font = best.font
      x += ctx.measureText(best.char).width
    } else {
      x += best.width
    }
  }

  return glyphs
}

export function layoutTextPositions(
  pretext: PretextModule,
  options: FusionOptions,
): CharPosition[] {
  const prepared = pretext.prepareWithSegments(options.text, options.font)
  const layout = pretext.layoutWithLines(prepared, options.maxWidth, options.lineHeight)
  return positionsFromPreparedLines(layout.lines, options.font, options.fontSize, options.lineHeight)
}

export function fuseFrameWithText(
  frame: FramePixels,
  charPositions: CharPosition[],
  options: FusionOptions,
): RichFrame {
  const totalTextHeight = totalTextHeightFromPositions(charPositions, options.lineHeight)
  const styles: GlyphStyle[] = [{
    fontFamily: options.font.split(/\s+/).slice(1).join(' ') || options.font,
    fontSize: options.fontSize,
    fontWeight: 400,
    fontStyle: 'normal',
    lineHeight: options.lineHeight,
  }]
  const glyphs: RichGlyph[] = []

  for (let index = 0; index < charPositions.length; index++) {
    const position = charPositions[index]!
    const { pixelIndex, brightness } = sampleFrameBrightness(
      frame,
      position.x,
      position.y,
      options.maxWidth,
      totalTextHeight,
      options.invert,
    )
    glyphs.push({
      char: position.char,
      x: position.x,
      y: position.y,
      styleIndex: 0,
      opacity: brightness,
      fill: glyphColor(frame, pixelIndex, options.color, brightness),
      brightness,
      lineIndex: position.lineIndex,
    })
  }

  return {
    kind: 'rich',
    width: options.maxWidth,
    height: totalTextHeight,
    lineHeight: options.lineHeight,
    styles,
    glyphs,
    background: null,
    metadata: {
      frameIndex: options.frameIndex ?? 0,
      timestampSeconds: options.timestampSeconds ?? 0,
      mode: 'fusion',
      layout: options.layout ?? 'grid',
      energy: 0,
      averageBrightness: 0,
      motion: { dx: 0, dy: 0, magnitude: 0 },
      cut: false,
      scrollOffset: 0,
    },
  }
}

export function layoutPositionedTextLines(
  pretext: PretextModule,
  text: string,
  font: string,
  fontSize: number,
  lineHeight: number,
  slots: LayoutSlot[],
): PositionedTextLine[] {
  const prepared = pretext.prepareWithSegments(text, font)
  const lines: PositionedTextLine[] = []
  let cursor: TextCursor = { segmentIndex: 0, graphemeIndex: 0 }
  let lineIndex = 0
  const paddedSlots = padSlots(Math.max(...slots.map(slot => slot.right)), slots)

  while (true) {
    const slot = paddedSlots[lineIndex % paddedSlots.length]!
    const width = Math.max(0, slot.right - slot.left)
    const line = pretext.layoutNextLine(prepared, cursor, width)
    if (line === null) break
    lines.push({
      text: line.text,
      x: slot.left,
      y: lineIndex * lineHeight,
      width: line.width,
      lineIndex,
      start: line.start,
      end: line.end,
      fontFamily: font.split(/\s+/).slice(1).join(' ') || font,
      fontSize,
      fontWeight: 400,
      fontStyle: 'normal',
      lineHeight,
    })
    cursor = line.end
    lineIndex++
  }

  return lines
}

export function fuseFrameWithPalette(
  frame: FramePixels,
  pretext: PretextModule,
  options: RichFusionOptions,
): RichFrame {
  const styles = options.styles ?? uniqueGlyphStyles(options.palette)
  const previousMetadata = options.previousFrame?.metadata
  const previousFrameAnalysis = options.frameAnalysis ?? computeFrameAnalysis(
    frame,
    options.previousPixels ?? null,
    Math.max(1, Math.round(options.maxWidth / Math.max(1, options.paletteOptions?.targetCellWidth ?? options.fontSize))),
    Math.max(1, Math.round(frame.height / Math.max(1, options.lineHeight))),
    options.cutThreshold ?? 0.35,
  )
  const scrollOffset = (previousMetadata?.scrollOffset ?? 0) + computeScrollDelta(
    options.scrollStep ?? 0,
    options.scrollModulation ?? 'none',
    previousFrameAnalysis,
  )
  const visibleText = scrollOffset > 0 && scrollOffset < options.text.length
    ? `${options.text.slice(scrollOffset)} ${options.text}`
    : options.text
  const pulsedWidth = computePulseWidth(
    options.maxWidth,
    options.pulseStrength ?? 0,
    previousFrameAnalysis.energy,
  )
  const slotDefinitions = padSlots(options.maxWidth, options.slots)
  const lines = layoutPositionedTextLines(
    pretext,
    visibleText,
    options.font,
    options.fontSize,
    options.lineHeight,
    slotDefinitions.map(slot => ({
      left: slot.left,
      right: Math.min(slot.right, slot.left + pulsedWidth),
    })),
  )
  const analysis = previousFrameAnalysis
  const previousGlyphsByIndex = new Map<number, RichGlyph>()
  if (options.previousFrame?.kind === 'rich') {
    for (let index = 0; index < options.previousFrame.glyphs.length; index++) {
      previousGlyphsByIndex.set(index, options.previousFrame.glyphs[index]!)
    }
  }

  const glyphs: RichGlyph[] = []
  let glyphOffset = 0
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]!
    const slot = slotDefinitions[lineIndex % slotDefinitions.length]!
    glyphs.push(
      ...positionedLineToGlyphs(
        frame,
        line,
        options.palette,
        styles,
        options,
        previousGlyphsByIndex,
        analysis,
        slot.right - slot.left,
        glyphOffset,
      ),
    )
    glyphOffset += line.text.length
  }

  return {
    kind: 'rich',
    width: options.maxWidth,
    height: Math.max(options.lineHeight, lines.length * options.lineHeight),
    lineHeight: options.lineHeight,
    styles,
    glyphs,
    background: options.background ?? null,
    metadata: {
      frameIndex: options.frameIndex ?? 0,
      timestampSeconds: options.timestampSeconds ?? 0,
      mode: 'palette',
      layout: options.layout ?? 'grid',
      energy: analysis.energy,
      averageBrightness: analysis.averageBrightness,
      motion: analysis.motion,
      cut: analysis.cut,
      scrollOffset,
      ...options.metadata,
    },
  }
}
