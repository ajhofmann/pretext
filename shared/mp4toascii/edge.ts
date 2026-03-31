import type { EdgeDirection, FramePixels } from './types.ts'

export type EdgeAnalysis = {
  directions: EdgeDirection[]
  magnitudes: number[]
}

const sobelKernelX = [
  [-1, 0, 1],
  [-2, 0, 2],
  [-1, 0, 1],
]

const sobelKernelY = [
  [-1, -2, -1],
  [0, 0, 0],
  [1, 2, 1],
]

function sampleBrightness(frame: FramePixels, x: number, y: number): number {
  const clampedX = Math.min(frame.width - 1, Math.max(0, x))
  const clampedY = Math.min(frame.height - 1, Math.max(0, y))
  return frame.grayscale[clampedY * frame.width + clampedX]! / 255
}

export function classifyEdgeDirection(gx: number, gy: number, magnitude: number): EdgeDirection {
  if (magnitude < 0.08) return 'flat'

  const angle = Math.atan2(gy, gx)
  const absX = Math.abs(Math.cos(angle))
  const absY = Math.abs(Math.sin(angle))

  if (absX > 0.9239) return 'vertical'
  if (absY > 0.9239) return 'horizontal'
  return gx * gy >= 0 ? 'diag-backward' : 'diag-forward'
}

export function analyzeEdges(frame: FramePixels): EdgeAnalysis {
  const directions: EdgeDirection[] = new Array(frame.width * frame.height).fill('flat')
  const magnitudes = new Array<number>(frame.width * frame.height).fill(0)

  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      let gx = 0
      let gy = 0
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const value = sampleBrightness(frame, x + kx, y + ky)
          gx += value * sobelKernelX[ky + 1]![kx + 1]!
          gy += value * sobelKernelY[ky + 1]![kx + 1]!
        }
      }

      const magnitude = Math.min(1, Math.sqrt(gx * gx + gy * gy) / 4)
      const index = y * frame.width + x
      magnitudes[index] = magnitude
      directions[index] = classifyEdgeDirection(gx, gy, magnitude)
    }
  }

  return { directions, magnitudes }
}
