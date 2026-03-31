import type { RichFrame, RgbColor } from './types.ts'

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function formatColor(color: RgbColor | null | undefined, fallback = '#ffffff'): string {
  if (color === null || color === undefined) return fallback
  return `rgb(${color.r}, ${color.g}, ${color.b})`
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3)
}

function backgroundColor(frame: RichFrame): string {
  return formatColor(frame.background, '#0a0a0a')
}

export function renderRichFrameSvg(
  frame: RichFrame,
  options: {
    padding?: number
    background?: RgbColor | null
  } = {},
): string {
  const padding = options.padding ?? 0
  const width = frame.width + padding * 2
  const height = frame.height + padding * 2

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${formatNumber(width)}" height="${formatNumber(height)}" viewBox="0 0 ${formatNumber(width)} ${formatNumber(height)}">`,
    `<rect width="${formatNumber(width)}" height="${formatNumber(height)}" fill="${escapeXml(formatColor(options.background ?? frame.background, backgroundColor(frame)))}" />`,
  ]

  for (let index = 0; index < frame.glyphs.length; index++) {
    const glyph = frame.glyphs[index]!
    const style = frame.styles[glyph.styleIndex]!
    parts.push(
      `<text x="${formatNumber(glyph.x + padding)}" y="${formatNumber(glyph.y + padding + style.fontSize)}" fill="${escapeXml(formatColor(glyph.fill))}" fill-opacity="${formatNumber(glyph.opacity)}" font-family="${escapeXml(style.fontFamily)}" font-size="${formatNumber(style.fontSize)}" font-style="${style.fontStyle}" font-weight="${style.fontWeight}" line-height="${formatNumber(style.lineHeight)}">${escapeXml(glyph.char)}</text>`,
    )
  }

  parts.push('</svg>')
  return parts.join('')
}

export const richFrameToSvg = renderRichFrameSvg
