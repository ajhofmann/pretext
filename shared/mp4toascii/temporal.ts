import type {
  FrameAnalysis,
  GlyphPaletteEntry,
  MotionVector,
  FramePixels,
} from './types.ts'

type CellSelection = {
  brightness: number
  glyph: GlyphPaletteEntry | null
}

function clamp01(value: number): number {
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

export function smoothBrightnessSeries(
  previous: number[] | null,
  current: number[],
  alpha: number,
): number[] {
  const smoothing = clamp01(alpha)
  if (previous === null || previous.length !== current.length) {
    return [...current]
  }
  const output = new Array<number>(current.length)
  for (let index = 0; index < current.length; index++) {
    output[index] = smoothing * current[index]! + (1 - smoothing) * previous[index]!
  }
  return output
}

export function applyCharacterStability(
  previous: CellSelection[] | null,
  currentBrightness: number[],
  threshold: number,
): number[] {
  if (previous === null || previous.length !== currentBrightness.length) {
    return [...currentBrightness]
  }
  const output = new Array<number>(currentBrightness.length)
  for (let index = 0; index < currentBrightness.length; index++) {
    const prev = previous[index]
    const next = currentBrightness[index]!
    if (prev === undefined || prev.glyph === null) {
      output[index] = next
      continue
    }
    const delta = Math.abs(prev.brightness - next)
    output[index] = delta < threshold ? prev.brightness : next
  }
  return output
}

export function estimateDominantMotion(analyses: FrameAnalysis[]): MotionVector {
  if (analyses.length === 0) return { dx: 0, dy: 0, magnitude: 0 }
  let dx = 0
  let dy = 0
  for (let index = 0; index < analyses.length; index++) {
    dx += analyses[index]!.motion.dx
    dy += analyses[index]!.motion.dy
  }
  dx /= analyses.length
  dy /= analyses.length
  return {
    dx,
    dy,
    magnitude: Math.sqrt(dx * dx + dy * dy),
  }
}

export function computeScrollDelta(
  baseStep: number,
  modulation: 'none' | 'brightness' | 'motion',
  analysis: FrameAnalysis | null,
): number {
  if (analysis === null) return baseStep
  if (modulation === 'brightness') {
    return baseStep + Math.round(analysis.averageBrightness * baseStep)
  }
  if (modulation === 'motion') {
    return baseStep + Math.round(analysis.motion.magnitude * baseStep)
  }
  return baseStep
}

export function computePulseWidth(
  baseWidth: number,
  pulseStrength: number,
  energy: number,
): number {
  const normalizedStrength = clamp01(pulseStrength)
  const energyFactor = clamp01(energy)
  const widthReduction = baseWidth * normalizedStrength * energyFactor * 0.35
  return Math.max(16, baseWidth - widthReduction)
}

export function isSceneCut(previousBrightness: number, currentBrightness: number, threshold: number): boolean {
  return Math.abs(previousBrightness - currentBrightness) >= clamp01(threshold)
}

export function smoothBrightness(
  current: number,
  previous: number | null,
  alpha: number,
): number {
  if (previous === null) return current
  const smoothing = clamp01(alpha)
  return smoothing * current + (1 - smoothing) * previous
}

export function analyzeFramePair(
  current: FramePixels,
  previous: FramePixels | null,
  sampleWidth: number,
  sampleHeight: number,
  cutThreshold: number,
): {
  averageBrightness: number
  energy: number
  motion: MotionVector
  cut: boolean
} {
  const width = Math.max(1, Math.min(sampleWidth, current.width))
  const height = Math.max(1, Math.min(sampleHeight, current.height))
  let brightnessSum = 0
  let energySum = 0
  let motionX = 0
  let motionY = 0
  let sampleCount = 0

  for (let y = 0; y < height; y++) {
    const sampleY = Math.min(current.height - 1, Math.round((y / height) * (current.height - 1)))
    for (let x = 0; x < width; x++) {
      const sampleX = Math.min(current.width - 1, Math.round((x / width) * (current.width - 1)))
      const index = sampleY * current.width + sampleX
      const currentBrightness = current.grayscale[index]! / 255
      brightnessSum += currentBrightness
      if (previous !== null) {
        const previousBrightness = previous.grayscale[index]! / 255
        const delta = currentBrightness - previousBrightness
        energySum += Math.abs(delta)
        motionX += delta * (x - width / 2)
        motionY += delta * (y - height / 2)
      }
      sampleCount++
    }
  }

  const averageBrightness = sampleCount === 0 ? 0 : brightnessSum / sampleCount
  const energy = sampleCount === 0 ? 0 : energySum / sampleCount
  const dx = sampleCount === 0 ? 0 : motionX / sampleCount
  const dy = sampleCount === 0 ? 0 : motionY / sampleCount

  return {
    averageBrightness,
    energy,
    motion: {
      dx,
      dy,
      magnitude: Math.sqrt(dx * dx + dy * dy),
    },
    cut: previous === null ? false : isSceneCut(
      brightnessSum / Math.max(1, sampleCount),
      previous.grayscale.reduce((sum, value) => sum + value / 255, 0) / Math.max(1, previous.grayscale.length),
      cutThreshold,
    ),
  }
}

export function nextScrollOffset(
  previousOffset: number,
  baseStep: number,
  modulation: 'none' | 'brightness' | 'motion',
  brightness: number,
  motion: MotionVector,
): number {
  const delta = modulation === 'brightness'
    ? baseStep + Math.round(brightness * baseStep)
    : modulation === 'motion'
      ? baseStep + Math.round(motion.magnitude * baseStep)
      : baseStep
  return Math.max(0, previousOffset + delta)
}
