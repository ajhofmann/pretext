import type { RichFrame } from './types.ts'

type SerializedRgbColor = {
  r: number
  g: number
  b: number
}

type SerializedGridFrame = {
  kind: 'grid'
  lines: string[]
  brightness: number[][] | null
  colors: SerializedRgbColor[][] | null
}

type SerializedRichFrame = {
  kind: 'rich'
  lineHeight: number
  styles: Array<{
    fontFamily: string
    fontSize: number
    fontWeight: number
    fontStyle: 'normal' | 'italic'
    lineHeight: number
  }>
  lines: Array<{
    lineIndex: number
    glyphs: Array<{
      char: string
      opacity: number
      brightness: number
      fill?: SerializedRgbColor
      styleIndex: number
    }>
  }>
}

export type SerializedFrame = SerializedGridFrame | SerializedRichFrame

type PlayerOptions = {
  fps: number
  color: boolean
  frames: SerializedFrame[]
  displayId: string
  scrubberId: string
  counterId: string
  playButtonId: string
  resetButtonId: string
}

function createTextNode(text: string): Text {
  return document.createTextNode(text)
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName)
  if (className !== undefined) {
    element.className = className
  }
  return element
}

function clearElement(element: Element): void {
  element.replaceChildren()
}

function toSerializedGlyph(glyph: RichFrame['glyphs'][number]): SerializedRichFrame['lines'][number]['glyphs'][number] {
  const serialized: SerializedRichFrame['lines'][number]['glyphs'][number] = {
    char: glyph.char,
    opacity: glyph.opacity,
    brightness: glyph.brightness,
    styleIndex: glyph.styleIndex,
  }
  if (glyph.fill !== null) {
    serialized.fill = glyph.fill
  }
  return serialized
}

function rgbStyle(color: SerializedRgbColor): string {
  return `rgb(${color.r}, ${color.g}, ${color.b})`
}

function escapeForInlineScript(input: string): string {
  return input
    .replaceAll('\\', '\\\\')
    .replaceAll('`', '\\`')
    .replaceAll('${', '\\${')
    .replaceAll('</script', '<\\/script')
}

function renderGridFrame(
  display: HTMLElement,
  frame: SerializedGridFrame,
  color: boolean,
): void {
  clearElement(display)

  const fragment = document.createDocumentFragment()
  for (let row = 0; row < frame.lines.length; row++) {
    if (row > 0) {
      fragment.appendChild(createElement('br'))
    }

    const line = frame.lines[row]!
    const brightnessRow = frame.brightness?.[row] ?? null
    const colorRow = frame.colors?.[row] ?? null
    for (let col = 0; col < line.length; col++) {
      const brightness = brightnessRow?.[col] ?? 255
      const character = line[col]!
      if (brightness < 13) {
        fragment.appendChild(createTextNode(' '))
        continue
      }

      if (brightnessRow === null && colorRow === null) {
        fragment.appendChild(createTextNode(character))
        continue
      }

      const span = createElement('span')
      if (color && colorRow?.[col] !== undefined) {
        const source = colorRow[col]!
        span.style.color = rgbStyle({
          r: Math.round(source.r * brightness / 255),
          g: Math.round(source.g * brightness / 255),
          b: Math.round(source.b * brightness / 255),
        })
      } else {
        span.style.color = `rgb(${brightness}, ${brightness}, ${brightness})`
      }
      if (brightness > 180) {
        span.style.fontWeight = '700'
      }
      span.textContent = character
      fragment.appendChild(span)
    }
  }

  display.appendChild(fragment)
}

function renderRichFrame(
  display: HTMLElement,
  frame: SerializedRichFrame,
  color: boolean,
): void {
  clearElement(display)

  const fragment = document.createDocumentFragment()
  for (let lineIndex = 0; lineIndex < frame.lines.length; lineIndex++) {
    if (lineIndex > 0) {
      fragment.appendChild(createElement('br'))
    }

    const line = frame.lines[lineIndex]!
    for (let glyphIndex = 0; glyphIndex < line.glyphs.length; glyphIndex++) {
      const glyph = line.glyphs[glyphIndex]!
      if (glyph.opacity < 0.05) {
        fragment.appendChild(createTextNode(' '))
        continue
      }
      const style = frame.styles[glyph.styleIndex]!
      const span = createElement('span')
      span.textContent = glyph.char
      span.style.fontFamily = style.fontFamily
      span.style.fontSize = `${style.fontSize}px`
      span.style.fontWeight = String(style.fontWeight)
      span.style.fontStyle = style.fontStyle
      span.style.lineHeight = `${style.lineHeight}px`
      span.style.opacity = `${glyph.opacity}`
      if (color && glyph.fill !== undefined) {
        span.style.color = rgbStyle(glyph.fill)
      } else {
        const gray = Math.max(0, Math.min(255, Math.round(glyph.brightness * 255)))
        span.style.color = `rgb(${gray}, ${gray}, ${gray})`
      }
      fragment.appendChild(span)
    }
  }

  display.appendChild(fragment)
}

export function mountAsciiHtmlPlayer(options: PlayerOptions): void {
  const display = document.getElementById(options.displayId)
  const scrubber = document.getElementById(options.scrubberId)
  const counter = document.getElementById(options.counterId)
  const playButton = document.getElementById(options.playButtonId)
  const resetButton = document.getElementById(options.resetButtonId)

  if (
    !(display instanceof HTMLElement) ||
    !(scrubber instanceof HTMLInputElement) ||
    !(counter instanceof HTMLElement) ||
    !(playButton instanceof HTMLButtonElement) ||
    !(resetButton instanceof HTMLButtonElement)
  ) {
    throw new Error('mp4toascii player root elements not found')
  }

  let frameIndex = 0
  let isPlaying = false
  let timer: number | null = null

  const renderFrame = (nextFrameIndex: number): void => {
    frameIndex = nextFrameIndex
    const frame = options.frames[frameIndex]!
    if (frame.kind === 'grid') {
      renderGridFrame(display, frame, options.color)
    } else {
      renderRichFrame(display, frame, options.color)
    }
    scrubber.value = String(frameIndex)
    counter.textContent = `${frameIndex} / ${options.frames.length}`
  }

  const stopPlayback = (): void => {
    if (timer !== null) {
      window.clearInterval(timer)
      timer = null
    }
    isPlaying = false
    playButton.textContent = 'Play'
  }

  playButton.addEventListener('click', () => {
    if (isPlaying) {
      stopPlayback()
      return
    }
    isPlaying = true
    playButton.textContent = 'Pause'
    timer = window.setInterval(() => {
      renderFrame((frameIndex + 1) % options.frames.length)
    }, 1000 / options.fps)
  })

  resetButton.addEventListener('click', () => {
    stopPlayback()
    renderFrame(0)
  })

  scrubber.addEventListener('input', () => {
    renderFrame(Number(scrubber.value))
  })

  renderFrame(0)
}

export function createAsciiPlayerScript(): string {
  return escapeForInlineScript(`
${createTextNode.toString()}
${createElement.toString()}
${clearElement.toString()}
${rgbStyle.toString()}
${renderGridFrame.toString()}
${renderRichFrame.toString()}
${mountAsciiHtmlPlayer.toString()}
mountAsciiHtmlPlayer({
  fps,
  color: false,
  frames: frames.map(frame => ({ kind: 'grid', lines: frame.split('\\n'), brightness: null, colors: null })),
  displayId: 'display',
  scrubberId: 'scrub',
  counterId: 'counter',
  playButtonId: 'play',
  resetButtonId: 'reset',
})
`)
}

export function createRichFrameHtmlData(frames: RichFrame[]): SerializedRichFrame[] {
  return frames.map(frame => {
    const lineMap = new Map<number, SerializedRichFrame['lines'][number]>()
    for (let index = 0; index < frame.glyphs.length; index++) {
      const glyph = frame.glyphs[index]!
      const existing = lineMap.get(glyph.lineIndex)
      const serializedGlyph = toSerializedGlyph(glyph)
      if (existing === undefined) {
        lineMap.set(glyph.lineIndex, { lineIndex: glyph.lineIndex, glyphs: [serializedGlyph] })
      } else {
        existing.glyphs.push(serializedGlyph)
      }
    }

    return {
      kind: 'rich',
      lineHeight: frame.lineHeight,
      styles: frame.styles.map(style => ({
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        fontStyle: style.fontStyle,
        lineHeight: style.lineHeight,
      })),
      lines: [...lineMap.values()].sort((left, right) => left.lineIndex - right.lineIndex),
    }
  })
}

export function createRichPlayerScript(): string {
  return escapeForInlineScript(`
${createTextNode.toString()}
${createElement.toString()}
${clearElement.toString()}
${rgbStyle.toString()}
${renderGridFrame.toString()}
${renderRichFrame.toString()}
${mountAsciiHtmlPlayer.toString()}
mountAsciiHtmlPlayer({
  fps,
  color: useColor,
  frames,
  displayId: 'display',
  scrubberId: 'scrub',
  counterId: 'counter',
  playButtonId: 'play',
  resetButtonId: 'reset',
})
`)
}

export function serializeFramesForPlayer(frames: RichFrame[]): SerializedFrame[] {
  return createRichFrameHtmlData(frames)
}
