import { applyPreset, createDefaultMp4ToAsciiConfig } from './presets.ts'
import type {
  LayoutMode,
  Mp4ToAsciiConfig,
  Mp4ToAsciiMode,
  SpatialRuntimeOptions,
} from './types.ts'

type CliArgs = Record<string, string>

type VideoShape = {
  width?: number
  height?: number
  fps?: number
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback
  return value === 'true' || value === '1'
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Math.round(parseNumber(value, fallback))
  return parsed > 0 ? parsed : fallback
}

function parseLayoutMode(value: string | undefined, fallback: LayoutMode): LayoutMode {
  return value === 'grid' ||
    value === 'pulse' ||
    value === 'silhouette' ||
    value === 'columns' ||
    value === 'bands' ||
    value === 'headline-mask' ||
    value === 'depth'
    ? value
    : fallback
}

function parseMode(value: string | undefined, fallback: Mp4ToAsciiMode): Mp4ToAsciiMode {
  return value === 'mono' || value === 'palette' || value === 'fusion'
    ? value
    : fallback
}

function inferRows(cols: number, width?: number, height?: number): number {
  if (width !== undefined && height !== undefined && width > 0 && height > 0) {
    return Math.max(1, Math.round(cols * (height / width) * 0.45))
  }
  return Math.max(1, Math.round(cols * 0.45))
}

export function buildBrowserConfigFromArgs(args: CliArgs, video: VideoShape = {}): Mp4ToAsciiConfig {
  const base = applyPreset(createDefaultMp4ToAsciiConfig(), args['preset'])
  const cols = parsePositiveInt(args['cols'], base.cols)
  const rows = args['rows'] === undefined
    ? inferRows(cols, video.width, video.height)
    : parsePositiveInt(args['rows'], base.rows || inferRows(cols, video.width, video.height))
  const mode = parseMode(args['mode'], base.mode)
  const layout = parseLayoutMode(args['layout'], base.layout)
  const fontFamily = args['font'] ?? args['font-family'] ?? base.fontFamily
  const fontSize = parseNumber(args['font-size'], base.fontSize)
  const lineHeight = parsePositiveInt(args['line-height'], base.lineHeight || Math.round(fontSize * 1.45))

  return {
    ...base,
    mode,
    layout,
    cols,
    rows,
    fps: parseNumber(args['fps'], video.fps ?? base.fps),
    invert: parseBoolean(args['invert'], base.invert),
    color: parseBoolean(args['color'], base.color),
    fontFamily,
    fontSize,
    lineHeight,
    palette: {
      ...base.palette,
      fontFamilies: args['palette-fonts'] !== undefined
        ? args['palette-fonts'].split(',').map(entry => entry.trim()).filter(Boolean)
        : base.palette.fontFamilies,
      fontSize: parseNumber(args['palette-font-size'], fontSize),
      weights: args['weights'] !== undefined
        ? args['weights'].split(',').map(entry => parsePositiveInt(entry, 400)).filter(weight => weight > 0)
        : base.palette.weights,
      styles: args['styles'] !== undefined
        ? args['styles'].split(',').map(entry => entry.trim()).filter((entry): entry is 'normal' | 'italic' => entry === 'normal' || entry === 'italic')
        : base.palette.styles,
      charset: args['charset'] ?? base.palette.charset,
      edgeBias: parseNumber(args['edge-bias'], base.palette.edgeBias),
      dither:
        args['dither'] === 'bayer2' ||
        args['dither'] === 'bayer4' ||
        args['dither'] === 'bayer8' ||
        args['dither'] === 'none'
          ? args['dither']
          : base.palette.dither,
      targetCellWidth: parseNumber(args['target-cell-width'] ?? args['cell-width'], base.palette.targetCellWidth),
    },
    temporal: {
      ...base.temporal,
      smoothing: parseNumber(args['smoothing'], base.temporal.smoothing),
      stability: parseNumber(args['stability'], base.temporal.stability),
      scrollStep: parsePositiveInt(args['scroll-step'], base.temporal.scrollStep),
      scrollModulation:
        args['scroll-modulation'] === 'brightness' ||
        args['scroll-modulation'] === 'motion' ||
        args['scroll-modulation'] === 'none'
          ? args['scroll-modulation']
          : base.temporal.scrollModulation,
      opticalFlow: parseBoolean(args['optical-flow'], base.temporal.opticalFlow),
      pulseStrength: parseNumber(args['pulse-strength'], base.temporal.pulseStrength),
      cutThreshold: parseNumber(args['cut-threshold'], base.temporal.cutThreshold),
    },
    spatial: {
      ...base.spatial,
      layout,
      silhouetteThreshold: parseNumber(args['silhouette-threshold'], base.spatial.silhouetteThreshold),
      columns: args['columns'] === 'auto'
        ? 'auto'
        : parsePositiveInt(args['columns'], typeof base.spatial.columns === 'number' ? base.spatial.columns : 2),
      bands: parsePositiveInt(args['bands'], base.spatial.bands),
      maskText: args['mask-text'] ?? base.spatial.maskText,
      slotPadding: parseNumber(args['slot-padding'], base.spatial.slotPadding),
      depthMinFontSize: parseNumber(args['depth-min-font-size'], base.spatial.depthMinFontSize),
      depthMaxFontSize: parseNumber(args['depth-max-font-size'], base.spatial.depthMaxFontSize),
    },
    content: {
      ...base.content,
      text: args['text-source'] ?? args['text'] ?? base.content.text,
      cues: [],
      descriptions: [],
      banks: [],
      cycleOnCuts: parseBoolean(args['cycle-on-cuts'], base.content.cycleOnCuts),
      scriptMatch: parseBoolean(args['script-match'], base.content.scriptMatch),
    },
    preset: args['preset'] ?? base.preset,
  }
}

export function spatialRuntimeFromConfig(config: Mp4ToAsciiConfig): SpatialRuntimeOptions {
  return {
    silhouetteThreshold: config.spatial.silhouetteThreshold,
    slotPadding: config.spatial.slotPadding,
    columnCount: config.spatial.columns === 'auto' ? 2 : config.spatial.columns,
    bandCount: config.spatial.bands,
    maskText: config.spatial.maskText,
    depthMinFontSize: config.spatial.depthMinFontSize,
    depthMaxFontSize: config.spatial.depthMaxFontSize,
  }
}
