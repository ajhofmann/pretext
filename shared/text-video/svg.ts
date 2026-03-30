export function xmlEscape(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function attrsToString(attrs: Record<string, string | number | undefined | null | false>): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue
    parts.push(`${key}="${xmlEscape(String(value))}"`)
  }
  return parts.length === 0 ? '' : ` ${parts.join(' ')}`
}

export function svgElement(
  tag: string,
  attrs: Record<string, string | number | undefined | null | false>,
  body = '',
): string {
  return `<${tag}${attrsToString(attrs)}>${body}</${tag}>`
}

export function svgVoidElement(
  tag: string,
  attrs: Record<string, string | number | undefined | null | false>,
): string {
  return `<${tag}${attrsToString(attrs)} />`
}

export function colorWithOpacity(color: string, opacity: number): { color: string, opacity: number | undefined } {
  if (opacity >= 0.9999) return { color, opacity: undefined }
  return { color, opacity }
}
