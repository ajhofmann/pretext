import { beforeAll, describe, expect, test } from 'bun:test'
import { gzipSync } from 'node:zlib'

import { parseDescriptionJson, parseSrt, parseVtt, selectContentText } from './content.ts'
import { encodeAsciiFrames, encodeRichFrames, parseAscv, serializeAscv } from './ascv.ts'
import { applyOrderedDither } from './dither.ts'
import { analyzeEdges } from './edge.ts'
import { mapFrameMono } from './ascii-map.ts'
import { buildGlyphPalette, findBestGlyphEntry } from './palette.ts'
import { createDefaultMp4ToAsciiConfig } from './presets.ts'
import {
  computePulseWidth,
  computeScrollDelta,
  smoothBrightnessSeries,
} from './temporal.ts'
import type {
  FramePixels,
  GlyphPaletteEntry,
  PaletteOptions,
  RichFrame,
} from './types.ts'

class TestCanvasRenderingContext2D {
  font = ''
  fillStyle = '#fff'
  textBaseline: CanvasTextBaseline = 'alphabetic'
  textAlign: CanvasTextAlign = 'start'

  clearRect(): void {}

  fillText(): void {}

  getImageData(_x: number, _y: number, width: number, height: number): ImageData {
    const data = new Uint8ClampedArray(width * height * 4)
    for (let index = 3; index < data.length; index += 4) {
      data[index] = 255
    }
    return { data } as ImageData
  }

  measureText(text: string): TextMetrics {
    return { width: text.length * 8 } as TextMetrics
  }
}

class TestOffscreenCanvas {
  constructor(_width: number, _height: number) {}

  getContext(kind: string): TestCanvasRenderingContext2D | null {
    return kind === '2d' ? new TestCanvasRenderingContext2D() : null
  }
}

beforeAll(() => {
  Reflect.set(globalThis, 'OffscreenCanvas', TestOffscreenCanvas)
})

function makeFramePixels(
  width: number,
  height: number,
  grayscaleValues: number[],
): FramePixels {
  const grayscale = Uint8Array.from(grayscaleValues)
  const rgb = new Uint8Array(width * height * 3)
  for (let index = 0; index < grayscale.length; index++) {
    const value = grayscale[index]!
    rgb[index * 3] = value
    rgb[index * 3 + 1] = value
    rgb[index * 3 + 2] = value
  }
  return { width, height, grayscale, rgb }
}

function makePalette(): GlyphPaletteEntry[] {
  return [
    {
      char: '.',
      font: '400 14px Test Sans',
      fontFamily: 'Test Sans',
      fontSize: 14,
      fontWeight: 400,
      fontStyle: 'normal',
      lineHeight: 20,
      brightness: 0.2,
      width: 7,
    },
    {
      char: '|',
      font: '400 14px Test Sans',
      fontFamily: 'Test Sans',
      fontSize: 14,
      fontWeight: 400,
      fontStyle: 'normal',
      lineHeight: 20,
      brightness: 0.5,
      width: 8,
    },
    {
      char: '-',
      font: '700 14px Test Sans',
      fontFamily: 'Test Sans',
      fontSize: 14,
      fontWeight: 700,
      fontStyle: 'normal',
      lineHeight: 20,
      brightness: 0.7,
      width: 8,
    },
  ]
}

describe('mp4toascii engine helpers', () => {
  test('ordered dithering perturbs brightness deterministically', () => {
    const base = 0.5
    expect(applyOrderedDither(base, 0, 0, 'none')).toBe(base)
    expect(applyOrderedDither(base, 0, 0, 'bayer4')).not.toBe(base)
    expect(applyOrderedDither(base, 1, 1, 'bayer4')).not.toBe(applyOrderedDither(base, 0, 0, 'bayer4'))
  })

  test('edge analysis classifies strong horizontal and vertical fields', () => {
    const horizontal = makeFramePixels(3, 3, [
      0, 0, 0,
      127, 127, 127,
      255, 255, 255,
    ])
    const vertical = makeFramePixels(3, 3, [
      0, 127, 255,
      0, 127, 255,
      0, 127, 255,
    ])

    const horizontalResult = analyzeEdges(horizontal)
    const verticalResult = analyzeEdges(vertical)

    expect(horizontalResult.directions.some(direction => direction === 'horizontal')).toBe(true)
    expect(verticalResult.directions.some(direction => direction === 'vertical')).toBe(true)
  })

  test('brightness smoothing blends previous and current frames', () => {
    expect(smoothBrightnessSeries([0, 1], [1, 0], 0.25)).toEqual([0.25, 0.75])
  })

  test('scroll delta and pulse width react to analysis', () => {
    expect(computeScrollDelta(4, 'brightness', {
      averageBrightness: 0.5,
      energy: 0.1,
      motion: { dx: 0, dy: 0, magnitude: 0 },
      cut: false,
      edgeDirections: [],
      gradientMagnitudes: [],
    })).toBe(6)

    expect(computePulseWidth(100, 0.5, 1)).toBeLessThan(100)
  })

  test('subtitle parsers handle srt and vtt', () => {
    const srt = `1
00:00:00,000 --> 00:00:01,500
Hello world

2
00:00:01,500 --> 00:00:03,000
Another line
`
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:01.500
Hello world
`

    expect(parseSrt(srt).map(cue => cue.text)).toEqual(['Hello world', 'Another line'])
    expect(parseVtt(vtt).map(cue => cue.text)).toEqual(['Hello world'])
  })

  test('description json parser and content selection prefer timed cues', () => {
    const descriptions = parseDescriptionJson(JSON.stringify([
      { startSeconds: 0, endSeconds: 2, text: 'Opening image' },
    ]))

    const selection = selectContentText({
      text: 'Fallback text',
      cues: [],
      banks: [{ id: 'bank', text: 'Bank text', script: 'latin' }],
      descriptions,
      cycleOnCuts: false,
      scriptMatch: false,
    }, 1, 0, false)

    expect(selection.text).toBe('Opening image')
    expect(selection.cue?.source).toBe('description')
  })

  test('glyph palette selection can favor directional glyphs', () => {
    const palette = makePalette()
    const result = findBestGlyphEntry(palette, 0.7, 8, {
      edgeDirection: 'horizontal',
      edgeBias: 0.5,
    })
    expect(result.char).toBe('-')
  })

  test('glyph palette builds with a fake measurement backend', () => {
    const options: PaletteOptions = {
      ...createDefaultMp4ToAsciiConfig().palette,
      fontFamilies: ['Test Sans'],
      charset: '.-|',
      weights: [400],
      styles: ['normal'],
      targetCellWidth: 8,
    }
    const palette = buildGlyphPalette(options, () => 8)
    expect(palette.length).toBeGreaterThan(0)
  })

  test('legacy ASCV v1 roundtrip stays readable', () => {
    const frame = mapFrameMono(
      makeFramePixels(2, 2, [0, 255, 255, 0]),
      false,
      false,
    )
    const encoded = encodeAsciiFrames([frame], 10, false)
    const roundtrip = parseAscv(serializeAscv(encoded))
    expect(roundtrip.header.version).toBe(1)
    expect(roundtrip.frames[0]).toMatchObject({ kind: 'grid' })
  })

  test('rich ASCV v2 roundtrip preserves styled frames', () => {
    const richFrame: RichFrame = {
      kind: 'rich',
      width: 100,
      height: 40,
      lineHeight: 20,
      background: null,
      styles: [{
        fontFamily: 'Test Sans',
        fontSize: 14,
        fontWeight: 400,
        fontStyle: 'normal',
        lineHeight: 20,
      }],
      glyphs: [{
        char: 'A',
        x: 0,
        y: 0,
        styleIndex: 0,
        opacity: 0.9,
        fill: { r: 200, g: 180, b: 160 },
        brightness: 0.9,
        lineIndex: 0,
      }],
      metadata: {
        frameIndex: 0,
        timestampSeconds: 0,
        mode: 'fusion',
        layout: 'grid',
        energy: 0,
        averageBrightness: 0.5,
        motion: { dx: 0, dy: 0, magnitude: 0 },
        cut: false,
        scrollOffset: 0,
      },
    }

    const encoded = encodeRichFrames([richFrame], 12, 4, 12, true, 'fusion')
    const serialized = serializeAscv(encoded)
    const parsed = parseAscv(serialized)

    expect(parsed.header.version).toBe(2)
    expect(parsed.frames[0]).toMatchObject({
      kind: 'rich',
      styles: [{ fontFamily: 'Test Sans' }],
    })
  })

  test('v2 header magic is gzip backed json', () => {
    const payload = {
      header: { version: 2, cols: 1, rows: 1, fps: 1, frameCount: 0, mode: 'mono', color: false },
      frames: [],
    }
    const serialized = Buffer.concat([
      Buffer.from('ASCV2'),
      gzipSync(Buffer.from(JSON.stringify(payload), 'utf-8')),
    ])
    const parsed = parseAscv(serialized)
    expect(parsed.header.version).toBe(2)
    expect(parsed.frames).toEqual([])
  })
})
