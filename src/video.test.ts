import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'

type LayoutModule = typeof import('./layout.ts')
type VideoModule = typeof import('./video.ts')

let clearCache: LayoutModule['clearCache']
let setLocale: LayoutModule['setLocale']

let composeTextVideoFrame: VideoModule['composeTextVideoFrame']
let renderTextVideoFrame: VideoModule['renderTextVideoFrame']
let TextVideoEngine: VideoModule['TextVideoEngine']

const FONT = '16px Test Sans'
const LINE_HEIGHT = 20

const emojiPresentationRe = /\p{Emoji_Presentation}/u
const punctuationRe = /[.,!?;:%)\]}'"”’»›…—-]/u

function parseFontSize(font: string): number {
  const match = font.match(/(\d+(?:\.\d+)?)\s*px/)
  return match ? Number.parseFloat(match[1]!) : 16
}

function isWideCharacter(ch: string): boolean {
  const code = ch.codePointAt(0)!
  return (
    (code >= 0x4E00 && code <= 0x9FFF) ||
    (code >= 0x3400 && code <= 0x4DBF) ||
    (code >= 0xF900 && code <= 0xFAFF) ||
    (code >= 0x2F800 && code <= 0x2FA1F) ||
    (code >= 0x20000 && code <= 0x2A6DF) ||
    (code >= 0x2A700 && code <= 0x2B73F) ||
    (code >= 0x2B740 && code <= 0x2B81F) ||
    (code >= 0x2B820 && code <= 0x2CEAF) ||
    (code >= 0x2CEB0 && code <= 0x2EBEF) ||
    (code >= 0x30000 && code <= 0x3134F) ||
    (code >= 0x3000 && code <= 0x303F) ||
    (code >= 0x3040 && code <= 0x309F) ||
    (code >= 0x30A0 && code <= 0x30FF) ||
    (code >= 0xAC00 && code <= 0xD7AF) ||
    (code >= 0xFF00 && code <= 0xFFEF)
  )
}

function measureWidth(text: string, font: string): number {
  const fontSize = parseFontSize(font)
  let width = 0
  for (const ch of text) {
    if (ch === ' ') width += fontSize * 0.33
    else if (ch === '\t') width += fontSize * 1.32
    else if (emojiPresentationRe.test(ch) || ch === '\uFE0F') width += fontSize
    else if (isWideCharacter(ch)) width += fontSize
    else if (punctuationRe.test(ch)) width += fontSize * 0.4
    else width += fontSize * 0.6
  }
  return width
}

class TestCanvasRenderingContext2D {
  font = ''
  fillStyle: string | CanvasGradient | CanvasPattern = '#000'
  strokeStyle: string | CanvasGradient | CanvasPattern = '#000'
  lineWidth = 1
  textBaseline: CanvasTextBaseline = 'alphabetic'
  globalAlpha = 1
  shadowColor = 'transparent'
  shadowBlur = 0
  shadowOffsetX = 0
  shadowOffsetY = 0
  filter = 'none'
  canvas = {} as HTMLCanvasElement
  operations: string[] = []

  save(): void {}
  restore(): void {}
  clearRect(_x: number, _y: number, _w: number, _h: number): void {}
  fillRect(_x: number, _y: number, _w: number, _h: number): void { this.operations.push('fillRect') }
  strokeRect(_x: number, _y: number, _w: number, _h: number): void { this.operations.push('strokeRect') }
  beginPath(): void {}
  moveTo(_x: number, _y: number): void {}
  lineTo(_x: number, _y: number): void {}
  quadraticCurveTo(_cpx: number, _cpy: number, _x: number, _y: number): void {}
  closePath(): void {}
  fill(): void { this.operations.push('fill') }
  arc(_x: number, _y: number, _r: number, _sa: number, _ea: number): void {}
  createLinearGradient(_x0: number, _y0: number, _x1: number, _y1: number): CanvasGradient {
    return { addColorStop() {} } as CanvasGradient
  }
  createRadialGradient(
    _x0: number,
    _y0: number,
    _r0: number,
    _x1: number,
    _y1: number,
    _r1: number,
  ): CanvasGradient {
    return { addColorStop() {} } as CanvasGradient
  }
  fillText(text: string, _x: number, _y: number): void { this.operations.push(`fillText:${text}`) }
  strokeText(text: string, _x: number, _y: number): void { this.operations.push(`strokeText:${text}`) }
  measureText(text: string): TextMetrics {
    return {
      width: measureWidth(text, this.font),
      actualBoundingBoxAscent: parseFontSize(this.font) * 0.78,
      actualBoundingBoxDescent: parseFontSize(this.font) * 0.22,
    } as TextMetrics
  }
}

class TestOffscreenCanvas {
  width: number
  height: number
  #context = new TestCanvasRenderingContext2D()

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
  }

  getContext(_kind: string): TestCanvasRenderingContext2D {
    return this.#context
  }
}

type MinimalCanvasTarget = ConstructorParameters<VideoModule['TextVideoEngine']>[1] extends { canvas?: infer T } ? T : never

beforeAll(async () => {
  Reflect.set(globalThis, 'OffscreenCanvas', TestOffscreenCanvas)
  const layoutMod = await import('./layout.ts')
  const videoMod = await import('./video.ts')
  ;({ clearCache, setLocale } = layoutMod)
  ;({ composeTextVideoFrame, renderTextVideoFrame, TextVideoEngine } = videoMod)
})

beforeEach(() => {
  setLocale(undefined)
  clearCache()
})

describe('text video engine', () => {
  test('routes text around obstacles within a region', () => {
    const project = {
      width: 320,
      height: 180,
      duration: 4,
      fps: 30,
      obstacles: [
        { id: 'orb', kind: 'circle', x: 150, y: 54, radius: 28, padding: 10 },
      ],
      clips: [
        {
          id: 'body',
          text: 'Pretext lets text flow around moving obstacles without querying DOM layout in the hot path.',
          font: FONT,
          lineHeight: LINE_HEIGHT,
          fill: '#fff',
          regions: [{ x: 20, y: 20, width: 280, height: 120 }],
          wrap: { obstacleIds: ['orb'], minSlotWidth: 24 },
        },
      ],
    } satisfies ConstructorParameters<VideoModule['TextVideoEngine']>[0]

    const frame = composeTextVideoFrame(project, 0)
    expect(frame.obstacles).toHaveLength(1)
    expect(frame.lines.length).toBeGreaterThan(1)
    const impactedLines = frame.lines.filter(line => line.y < 74 && line.y + line.lineHeight > 34)
    expect(impactedLines.length).toBeGreaterThan(0)
    expect(impactedLines.some(line => line.slot.right < 300)).toBe(true)
  })

  test('continues flowing across multiple regions', () => {
    const project = {
      width: 360,
      height: 260,
      duration: 3,
      fps: 24,
      clips: [
        {
          id: 'columns',
          text: 'One continuous paragraph should exhaust the first column and resume in the second without duplicating or dropping words.',
          font: FONT,
          lineHeight: LINE_HEIGHT,
          fill: '#fff',
          regions: [
            { x: 20, y: 20, width: 120, height: 60 },
            { x: 180, y: 20, width: 120, height: 80 },
          ],
        },
      ],
    } satisfies ConstructorParameters<VideoModule['TextVideoEngine']>[0]

    const frame = composeTextVideoFrame(project, 0)
    expect(frame.lines.length).toBeGreaterThan(2)
    expect(frame.lines.some(line => line.regionIndex === 0)).toBe(true)
    expect(frame.lines.some(line => line.regionIndex === 1)).toBe(true)
    expect(frame.lines[0]!.text).not.toBe(frame.lines[frame.lines.length - 1]!.text)
  })

  test('renders planned frames to a canvas target', () => {
    const canvas = new TestOffscreenCanvas(1, 1)
    const canvasTarget = canvas as unknown as MinimalCanvasTarget
    const engine = new TextVideoEngine({
      width: 300,
      height: 160,
      duration: 2,
      fps: 30,
      background: { kind: 'solid', color: '#111' },
      clips: [
        {
          id: 'title',
          text: 'High resolution text video',
          font: '700 20px Test Sans',
          lineHeight: 26,
          fill: '#faf7ef',
          regions: [{ x: 24, y: 24, width: 220, height: 80 }],
          lineBox: { fill: 'rgba(255,255,255,0.08)', paddingX: 10, paddingY: 4, radius: 10 },
        },
      ],
    }, { canvas: canvasTarget })

    const result = engine.renderFrame(0.4, canvasTarget)
    expect(result.lineCount).toBeGreaterThan(0)
    const context = canvas.getContext('2d')
    expect(context.operations.some(op => op === 'fillRect')).toBe(true)
    expect(context.operations.some(op => op.startsWith('fillText:'))).toBe(true)

    renderTextVideoFrame(context as unknown as Parameters<VideoModule['renderTextVideoFrame']>[0], engine.planFrame(0.8))
    expect(context.operations.filter(op => op.startsWith('fillText:')).length).toBeGreaterThan(1)
  })
})
