import type { DitherMode } from './types.ts'

const BAYER_2 = [
  [0, 2],
  [3, 1],
]

const BAYER_4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
]

const BAYER_8 = [
  [0, 48, 12, 60, 3, 51, 15, 63],
  [32, 16, 44, 28, 35, 19, 47, 31],
  [8, 56, 4, 52, 11, 59, 7, 55],
  [40, 24, 36, 20, 43, 27, 39, 23],
  [2, 50, 14, 62, 1, 49, 13, 61],
  [34, 18, 46, 30, 33, 17, 45, 29],
  [10, 58, 6, 54, 9, 57, 5, 53],
  [42, 26, 38, 22, 41, 25, 37, 21],
]

type BayerMatrix = typeof BAYER_2 | typeof BAYER_4 | typeof BAYER_8

function matrixForMode(mode: DitherMode): BayerMatrix | null {
  if (mode === 'bayer2') return BAYER_2
  if (mode === 'bayer4') return BAYER_4
  if (mode === 'bayer8') return BAYER_8
  return null
}

function normalizedThreshold(matrix: BayerMatrix, x: number, y: number): number {
  const size = matrix.length
  const value = matrix[y % size]![x % size]!
  return (value + 0.5) / (size * size)
}

export function applyOrderedDither(
  brightness: number,
  x: number,
  y: number,
  mode: DitherMode,
  strength = 1,
): number {
  const matrix = matrixForMode(mode)
  if (matrix === null || strength <= 0) return brightness
  const threshold = normalizedThreshold(matrix, x, y) - 0.5
  return Math.max(0, Math.min(1, brightness + threshold * (0.18 * strength)))
}

export function applyDitherToBrightness(
  brightness: number,
  mode: DitherMode,
  x: number,
  y: number,
  strength = 1,
): number {
  return applyOrderedDither(brightness, x, y, mode, strength)
}
