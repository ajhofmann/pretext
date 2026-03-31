import type {
  EdgeDirection,
  FontStyleVariant,
  GlyphPaletteEntry,
  GlyphStyle,
  PaletteOptions,
} from './types.ts'

export const DEFAULT_CHARSET = ' .,:;!+-=*#@%&abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
export const DEFAULT_FONT_FAMILIES = ['DejaVu Sans', 'Georgia', 'DejaVu Serif']
export const DEFAULT_WEIGHTS = [300, 500, 700, 900]
export const DEFAULT_STYLES: FontStyleVariant[] = ['normal', 'italic']

type WidthMeasurer = (char: string, font: string) => number

export function monoCharForBrightness(brightness: number, invert: boolean): string {
  const monoRamp = ' .`-_\':,;^=+/|)\\!?0oOQ#%@'
  const normalized = invert ? 1 - brightness : brightness
  const index = Math.min(monoRamp.length - 1, Math.max(0, Math.floor(normalized * monoRamp.length)))
  return monoRamp[index]!
}

type ScoringOptions = {
  edgeDirection?: EdgeDirection
  edgeBias?: number
  stabilityBonus?: number
  previous?: GlyphPaletteEntry | null
}

const horizontalGlyphs = ['-', '_', '=', '—', '–', '~']
const verticalGlyphs = ['|', '!', 'I', 'l', '1']
const diagForwardGlyphs = ['/', '>', '7']
const diagBackwardGlyphs = ['\\', '<']

function getMeasureContext(): OffscreenCanvasRenderingContext2D {
  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error('OffscreenCanvas is required to build a glyph palette.')
  }
  const canvas = new OffscreenCanvas(48, 48)
  const context = canvas.getContext('2d')
  if (context === null) {
    throw new Error('Unable to create 2D context for glyph palette measurement.')
  }
  return context
}

function estimateBrightness(context: OffscreenCanvasRenderingContext2D, char: string, font: string): number {
  const size = 48
  context.clearRect(0, 0, size, size)
  context.font = font
  context.fillStyle = '#fff'
  context.textBaseline = 'middle'
  context.textAlign = 'left'
  context.fillText(char, 2, size / 2)
  const data = context.getImageData(0, 0, size, size).data
  let sum = 0
  for (let index = 3; index < data.length; index += 4) {
    sum += data[index]!
  }
  return sum / (255 * size * size)
}

function buildFont(style: FontStyleVariant, weight: number, fontSize: number, family: string): string {
  return `${style === 'italic' ? 'italic ' : ''}${weight} ${fontSize}px ${family}`
}

function directionBonus(char: string, direction: EdgeDirection, edgeBias: number): number {
  if (edgeBias <= 0 || direction === 'flat') return 0

  const glyphs = direction === 'horizontal'
    ? horizontalGlyphs
    : direction === 'vertical'
      ? verticalGlyphs
      : direction === 'diag-forward'
        ? diagForwardGlyphs
        : diagBackwardGlyphs

  return glyphs.includes(char) ? edgeBias : 0
}

function normalizedWidthError(entryWidth: number, targetWidth: number): number {
  if (targetWidth <= 0) return Math.abs(entryWidth)
  return Math.abs(entryWidth - targetWidth) / targetWidth
}

function previousEntryBonus(
  entry: GlyphPaletteEntry,
  previous: GlyphPaletteEntry | null | undefined,
  stabilityBonus: number,
): number {
  if (previous === null || previous === undefined || stabilityBonus <= 0) return 0
  return (
    entry.char === previous.char &&
    entry.fontFamily === previous.fontFamily &&
    entry.fontWeight === previous.fontWeight &&
    entry.fontStyle === previous.fontStyle
  )
    ? stabilityBonus
    : 0
}

export function buildGlyphPalette(
  options: PaletteOptions,
  measureWidth: WidthMeasurer,
): GlyphPaletteEntry[] {
  const context = getMeasureContext()
  const entries: GlyphPaletteEntry[] = []

  for (let familyIndex = 0; familyIndex < options.fontFamilies.length; familyIndex++) {
    const fontFamily = options.fontFamilies[familyIndex]!
    for (let styleIndex = 0; styleIndex < options.styles.length; styleIndex++) {
      const fontStyle = options.styles[styleIndex]!
      for (let weightIndex = 0; weightIndex < options.weights.length; weightIndex++) {
        const fontWeight = options.weights[weightIndex]!
        const font = buildFont(fontStyle, fontWeight, options.fontSize, fontFamily)
        for (const char of options.charset) {
          if (char === ' ') continue
          const width = measureWidth(char, font)
          if (!(width > 0)) continue
          const brightness = estimateBrightness(context, char, font)
          if (!(brightness > 0)) continue
          entries.push({
            char,
            font,
            fontFamily,
            fontSize: options.fontSize,
            fontWeight,
            fontStyle,
            lineHeight: Math.round(options.fontSize * 1.4),
            brightness,
            width,
          })
        }
      }
    }
  }

  const maxBrightness = entries.reduce((max, entry) => Math.max(max, entry.brightness), 0)
  if (maxBrightness > 0) {
    for (let index = 0; index < entries.length; index++) {
      entries[index]!.brightness /= maxBrightness
    }
  }

  entries.sort((left, right) => left.brightness - right.brightness)
  return entries
}

export function measureGlyphWidthFromPretext(
  prepareWithSegments: (text: string, font: string) => { widths: number[] },
  char: string,
  font: string,
): number {
  const prepared = prepareWithSegments(char, font)
  return prepared.widths.length > 0 ? prepared.widths[0]! : 0
}

export function findBestGlyphEntry(
  palette: GlyphPaletteEntry[],
  targetBrightness: number,
  targetWidth: number,
  options: ScoringOptions = {},
): GlyphPaletteEntry {
  if (palette.length === 0) {
    throw new Error('Cannot select a glyph from an empty palette.')
  }

  let lower = 0
  let upper = palette.length - 1
  while (lower < upper) {
    const mid = (lower + upper) >> 1
    if (palette[mid]!.brightness < targetBrightness) {
      lower = mid + 1
    } else {
      upper = mid
    }
  }

  let best = palette[lower]!
  let bestScore = Number.POSITIVE_INFINITY
  const start = Math.max(0, lower - 18)
  const end = Math.min(palette.length, lower + 18)
  for (let index = start; index < end; index++) {
    const entry = palette[index]!
    const brightnessError = Math.abs(entry.brightness - targetBrightness) * 2.5
    const widthError = normalizedWidthError(entry.width, targetWidth)
    const directionScore = directionBonus(entry.char, options.edgeDirection ?? 'flat', options.edgeBias ?? 0)
    const stabilityScore = previousEntryBonus(entry, options.previous, options.stabilityBonus ?? 0)
    const score = brightnessError + widthError - directionScore - stabilityScore
    if (score < bestScore) {
      bestScore = score
      best = entry
    }
  }

  return best
}

export function uniqueGlyphStyles(palette: GlyphPaletteEntry[]): GlyphStyle[] {
  const styles: GlyphStyle[] = []
  const seen = new Set<string>()
  for (let index = 0; index < palette.length; index++) {
    const entry = palette[index]!
    const key = JSON.stringify({
      fontFamily: entry.fontFamily,
      fontSize: entry.fontSize,
      fontWeight: entry.fontWeight,
      fontStyle: entry.fontStyle,
      lineHeight: entry.lineHeight,
    })
    if (seen.has(key)) continue
    seen.add(key)
    styles.push({
      fontFamily: entry.fontFamily,
      fontSize: entry.fontSize,
      fontWeight: entry.fontWeight,
      fontStyle: entry.fontStyle,
      lineHeight: entry.lineHeight,
    })
  }
  return styles
}

export function styleIndexForEntry(styles: GlyphStyle[], entry: GlyphPaletteEntry): number {
  const style = styles.findIndex(candidate => (
    candidate.fontFamily === entry.fontFamily &&
    candidate.fontSize === entry.fontSize &&
    candidate.fontWeight === entry.fontWeight &&
    candidate.fontStyle === entry.fontStyle &&
    candidate.lineHeight === entry.lineHeight
  ))
  if (style < 0) {
    throw new Error(`Missing style table entry for glyph "${entry.char}".`)
  }
  return style
}
