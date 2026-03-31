import type { Mp4ToAsciiConfig, LayoutMode, Mp4ToAsciiMode } from './types.ts'
import {
  DEFAULT_CHARSET,
  DEFAULT_FONT_FAMILIES,
  DEFAULT_STYLES,
  DEFAULT_WEIGHTS,
} from './palette.ts'

export type Mp4ToAsciiPreset = {
  id: string
  label: string
  description: string
  mode: Mp4ToAsciiMode
  layout: LayoutMode
  overrides: Partial<Mp4ToAsciiConfig>
}

const basePalette = {
  fontFamilies: DEFAULT_FONT_FAMILIES,
  fontSize: 14,
  weights: DEFAULT_WEIGHTS,
  styles: DEFAULT_STYLES,
  charset: DEFAULT_CHARSET,
  edgeBias: 0.25,
  dither: 'bayer4' as const,
  targetCellWidth: 8.6,
}

export const MP4TOASCII_PRESETS: Mp4ToAsciiPreset[] = [
  {
    id: 'terminal',
    label: 'Terminal',
    description: 'Classic green phosphor monochrome ASCII.',
    mode: 'mono',
    layout: 'grid',
    overrides: {
      mode: 'mono',
      layout: 'grid',
      color: false,
      palette: {
        ...basePalette,
        dither: 'none',
      },
      temporal: {
        smoothing: 0.55,
        stability: 0.5,
        scrollStep: 0,
        scrollModulation: 'none',
        opticalFlow: false,
        pulseStrength: 0,
        cutThreshold: 0.24,
      },
    },
  },
  {
    id: 'newspaper',
    label: 'Newspaper',
    description: 'Ordered dithering and width-budgeted typographic halftone.',
    mode: 'palette',
    layout: 'grid',
    overrides: {
      mode: 'palette',
      layout: 'grid',
      palette: {
        ...basePalette,
        fontFamilies: ['Georgia', 'DejaVu Serif'],
        edgeBias: 0.4,
        dither: 'bayer8',
      },
      temporal: {
        smoothing: 0.45,
        stability: 0.35,
        scrollStep: 0,
        scrollModulation: 'none',
        opticalFlow: false,
        pulseStrength: 0.1,
        cutThreshold: 0.22,
      },
    },
  },
  {
    id: 'typewriter',
    label: 'Typewriter',
    description: 'Readable prose scrolling through the video frame.',
    mode: 'fusion',
    layout: 'grid',
    overrides: {
      mode: 'fusion',
      layout: 'grid',
      temporal: {
        smoothing: 0.38,
        stability: 0.42,
        scrollStep: 8,
        scrollModulation: 'brightness',
        opticalFlow: false,
        pulseStrength: 0.05,
        cutThreshold: 0.22,
      },
    },
  },
  {
    id: 'concrete-poetry',
    label: 'Concrete Poetry',
    description: 'Silhouette-aware text flowing around the bright subject.',
    mode: 'fusion',
    layout: 'silhouette',
    overrides: {
      mode: 'fusion',
      layout: 'silhouette',
      temporal: {
        smoothing: 0.52,
        stability: 0.58,
        scrollStep: 6,
        scrollModulation: 'motion',
        opticalFlow: true,
        pulseStrength: 0.12,
        cutThreshold: 0.2,
      },
      spatial: {
        layout: 'silhouette',
        silhouetteThreshold: 0.62,
        columns: 'auto',
        bands: 4,
        maskText: '',
        slotPadding: 8,
        depthMinFontSize: 10,
        depthMaxFontSize: 20,
      },
    },
  },
  {
    id: 'editorial',
    label: 'Editorial',
    description: 'Dynamic multi-column flow driven by scene brightness.',
    mode: 'fusion',
    layout: 'columns',
    overrides: {
      mode: 'fusion',
      layout: 'columns',
      temporal: {
        smoothing: 0.5,
        stability: 0.5,
        scrollStep: 4,
        scrollModulation: 'motion',
        opticalFlow: true,
        pulseStrength: 0.18,
        cutThreshold: 0.22,
      },
      spatial: {
        layout: 'columns',
        silhouetteThreshold: 0.55,
        columns: 'auto',
        bands: 4,
        maskText: '',
        slotPadding: 10,
        depthMinFontSize: 10,
        depthMaxFontSize: 20,
      },
    },
  },
  {
    id: 'cipher',
    label: 'Cipher',
    description: 'Unstable glyphs gradually settling into readable text.',
    mode: 'palette',
    layout: 'pulse',
    overrides: {
      mode: 'palette',
      layout: 'pulse',
      palette: {
        ...basePalette,
        edgeBias: 0.15,
        dither: 'bayer2',
      },
      temporal: {
        smoothing: 0.2,
        stability: 0.1,
        scrollStep: 3,
        scrollModulation: 'brightness',
        opticalFlow: true,
        pulseStrength: 0.28,
        cutThreshold: 0.18,
      },
    },
  },
  {
    id: 'matrix-rain',
    label: 'Matrix Rain',
    description: 'Vertical-biased glyphs and motion-reactive flow.',
    mode: 'palette',
    layout: 'bands',
    overrides: {
      mode: 'palette',
      layout: 'bands',
      color: true,
      palette: {
        ...basePalette,
        edgeBias: 0.55,
        dither: 'bayer4',
      },
      temporal: {
        smoothing: 0.6,
        stability: 0.62,
        scrollStep: 10,
        scrollModulation: 'motion',
        opticalFlow: true,
        pulseStrength: 0.08,
        cutThreshold: 0.23,
      },
      spatial: {
        layout: 'bands',
        silhouetteThreshold: 0.55,
        columns: 3,
        bands: 8,
        maskText: '',
        slotPadding: 4,
        depthMinFontSize: 10,
        depthMaxFontSize: 20,
      },
    },
  },
]

export function createDefaultMp4ToAsciiConfig(): Mp4ToAsciiConfig {
  return {
    mode: 'fusion',
    layout: 'grid',
    cols: 120,
    rows: 0,
    fps: 10,
    invert: false,
    color: false,
    fontFamily: 'DejaVu Sans',
    fontSize: 14,
    lineHeight: 20,
    palette: {
      ...basePalette,
    },
    temporal: {
      smoothing: 0.35,
      stability: 0.25,
      scrollStep: 0,
      scrollModulation: 'none',
      opticalFlow: false,
      pulseStrength: 0,
      cutThreshold: 0.22,
    },
    spatial: {
      layout: 'grid',
      silhouetteThreshold: 0.55,
      columns: 'auto',
      bands: 4,
      maskText: '',
      slotPadding: 6,
      depthMinFontSize: 10,
      depthMaxFontSize: 20,
    },
    content: {
      text: '',
      cues: [],
      banks: [],
      descriptions: [],
      cycleOnCuts: true,
      scriptMatch: true,
    },
    preset: null,
  }
}

export function getPresetById(id: string | null | undefined): Mp4ToAsciiPreset | null {
  if (id === null || id === undefined || id === '') return null
  return MP4TOASCII_PRESETS.find(preset => preset.id === id) ?? null
}

export function applyPreset(
  base: Mp4ToAsciiConfig,
  presetId: string | null | undefined,
): Mp4ToAsciiConfig {
  const preset = getPresetById(presetId)
  if (preset === null) return base
  return {
    ...base,
    ...preset.overrides,
    mode: preset.mode,
    layout: preset.layout,
    palette: {
      ...base.palette,
      ...preset.overrides.palette,
    },
    temporal: {
      ...base.temporal,
      ...preset.overrides.temporal,
    },
    spatial: {
      ...base.spatial,
      ...preset.overrides.spatial,
    },
    content: {
      ...base.content,
      ...preset.overrides.content,
    },
    preset: preset.id,
  }
}
