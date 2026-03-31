import type { FramePixels, GridFrame, RgbColor } from './types.ts'
import { monoCharForBrightness } from './palette.ts'

export type AsciiFrame = GridFrame

export function mapFrameMono(
  frame: FramePixels,
  invert: boolean,
  color: boolean,
): AsciiFrame {
  const chars: string[] = []
  const colors: RgbColor[] | null = color ? [] : null
  const brightnessValues: number[] = []

  for (let i = 0; i < frame.width * frame.height; i++) {
    const brightness = frame.grayscale[i]! / 255
    chars.push(monoCharForBrightness(brightness, invert))
    brightnessValues.push(Math.round(brightness * 255))
    if (colors !== null) {
      colors.push({
        r: frame.rgb[i * 3]!,
        g: frame.rgb[i * 3 + 1]!,
        b: frame.rgb[i * 3 + 2]!,
      })
    }
  }

  return {
    kind: 'grid',
    cols: frame.width,
    rows: frame.height,
    chars,
    colors,
    brightness: brightnessValues,
  }
}
