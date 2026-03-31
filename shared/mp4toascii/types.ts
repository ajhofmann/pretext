export type RgbColor = {
  r: number
  g: number
  b: number
}

export type FramePixels = {
  width: number
  height: number
  grayscale: Uint8Array
  rgb: Uint8Array
}

export type Mp4ToAsciiMode = 'mono' | 'palette' | 'fusion'

export type LayoutMode =
  | 'grid'
  | 'pulse'
  | 'silhouette'
  | 'columns'
  | 'bands'
  | 'headline-mask'
  | 'depth'

export type DitherMode = 'none' | 'bayer2' | 'bayer4' | 'bayer8'

export type FontStyleVariant = 'normal' | 'italic'

export type EdgeDirection =
  | 'flat'
  | 'horizontal'
  | 'vertical'
  | 'diag-forward'
  | 'diag-backward'

export type MotionVector = {
  dx: number
  dy: number
  magnitude: number
}

export type TextCursor = {
  segmentIndex: number
  graphemeIndex: number
}

export type GlyphStyle = {
  fontFamily: string
  fontSize: number
  fontWeight: number
  fontStyle: FontStyleVariant
  lineHeight: number
}

export type GlyphPaletteEntry = GlyphStyle & {
  char: string
  brightness: number
  width: number
  font: string
}

export type GridFrame = {
  kind: 'grid'
  cols: number
  rows: number
  chars: string[]
  colors: RgbColor[] | null
  brightness: number[] | null
  metadata?: FrameMetadata
}

export type RichGlyph = {
  char: string
  x: number
  y: number
  styleIndex: number
  opacity: number
  fill: RgbColor | null
  brightness: number
  lineIndex: number
}

export type RichFrame = {
  kind: 'rich'
  width: number
  height: number
  lineHeight: number
  styles: GlyphStyle[]
  glyphs: RichGlyph[]
  background: RgbColor | null
  metadata?: FrameMetadata
}

export type LegacyFusionGlyph = {
  char: string
  x: number
  y: number
  brightness: number
  color: RgbColor | null
}

export type LegacyFusionFrame = {
  width: number
  height: number
  lineHeight: number
  characters: LegacyFusionGlyph[]
}

export type AsciiRenderableFrame = GridFrame | RichFrame

export type FrameMetadata = {
  frameIndex: number
  timestampSeconds: number
  mode: Mp4ToAsciiMode
  layout: LayoutMode
  energy: number
  averageBrightness: number
  motion: MotionVector
  cut: boolean
  scrollOffset: number
}

export type FrameAnalysis = {
  averageBrightness: number
  energy: number
  motion: MotionVector
  cut: boolean
  edgeDirections: EdgeDirection[]
  gradientMagnitudes: number[]
}

export type ContentCueSource = 'text' | 'subtitle' | 'bank' | 'description'

export type ContentCue = {
  startSeconds: number
  endSeconds: number
  text: string
  source: ContentCueSource
  script?: string
  payload?: Record<string, unknown>
}

export type ContentBank = {
  id: string
  text: string
  script?: string
}

export type PaletteOptions = {
  fontFamilies: string[]
  fontSize: number
  weights: number[]
  styles: FontStyleVariant[]
  charset: string
  edgeBias: number
  dither: DitherMode
  targetCellWidth: number
}

export type TemporalOptions = {
  smoothing: number
  stability: number
  scrollStep: number
  scrollModulation: 'none' | 'brightness' | 'motion'
  opticalFlow: boolean
  pulseStrength: number
  cutThreshold: number
}

export type SpatialOptions = {
  layout: LayoutMode
  silhouetteThreshold: number
  columns: number | 'auto'
  bands: number
  maskText: string
  slotPadding: number
  depthMinFontSize: number
  depthMaxFontSize: number
}

export type ContentOptions = {
  text: string
  cues: ContentCue[]
  banks: ContentBank[]
  descriptions: ContentCue[]
  cycleOnCuts: boolean
  scriptMatch: boolean
}

export type Mp4ToAsciiConfig = {
  mode: Mp4ToAsciiMode
  layout: LayoutMode
  cols: number
  rows: number
  fps: number
  invert: boolean
  color: boolean
  fontFamily: string
  fontSize: number
  lineHeight: number
  palette: PaletteOptions
  temporal: TemporalOptions
  spatial: SpatialOptions
  content: ContentOptions
  preset: string | null
}

export type RichFusionRuntimeOptions = {
  smoothing: number
  stability: number
  scrollStep: number
  scrollModulation: 'none' | 'brightness' | 'motion'
  cutThreshold: number
}

export type SpatialRuntimeOptions = {
  silhouetteThreshold: number
  slotPadding: number
  columnCount: number
  bandCount: number
  maskText: string
  depthMinFontSize: number
  depthMaxFontSize: number
}

export type LayoutSlot = {
  left: number
  right: number
}

export type SlotRow = {
  y: number
  height: number
  slots: LayoutSlot[]
}

export type PositionedTextLine = GlyphStyle & {
  text: string
  x: number
  y: number
  width: number
  lineIndex: number
  start: TextCursor
  end: TextCursor
}
