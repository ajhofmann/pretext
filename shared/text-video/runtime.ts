import { GlobalFonts, createCanvas } from '@napi-rs/canvas'
import { Resvg } from '@resvg/resvg-js'
import { constants } from 'node:fs'
import { access, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gunzipSync, gzipSync } from 'node:zlib'
import {
  textVideoProjectSchema,
  type AnimatedNumber,
  type TextLayer,
  type TextVideoProject,
} from './schema.ts'
import type { LayoutLine, PreparedTextWithSegments } from '../../src/layout.ts'

type PreparedCacheValue = {
  prepared: PreparedTextWithSegments
  text: string
  font: string
  whiteSpace: 'normal' | 'pre-wrap'
}

type EvaluatedTextLayer = {
  layer: TextLayer
  x: number
  y: number
  width: number
  fontSize: number
  lineHeight: number
  opacity: number
  rotation: number
  scale: number
  font: string
}

export type RenderFrameOptions = {
  scale?: number
}

export type RenderFrameResult = {
  svg: string
  width: number
  height: number
}

export type LoadedProject = {
  project: TextVideoProject
  absoluteProjectPath: string
}

type PretextModule = Pick<typeof import('../../src/layout.ts'), 'layoutWithLines' | 'prepareWithSegments'>

const FRAME_MAGIC = 'PTXV1'
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const registeredFontPaths = new Set<string>()
let pretextModulePromise: Promise<PretextModule> | null = null

export function parseProject(input: string): TextVideoProject {
  return textVideoProjectSchema.parse(JSON.parse(input))
}

export function parseProjectJson(input: string): TextVideoProject {
  return parseProject(input)
}

export function serializeProject(project: TextVideoProject): string {
  return `${JSON.stringify(textVideoProjectSchema.parse(project), null, 2)}\n`
}

export function encodeProjectToContainer(project: TextVideoProject): Buffer {
  const payload = Buffer.from(serializeProject(project), 'utf8')
  const compressed = gzipSync(payload, { level: 9 })
  return Buffer.concat([Buffer.from(FRAME_MAGIC, 'utf8'), compressed])
}

export function decodeProjectContainer(buffer: Buffer): TextVideoProject {
  const magic = buffer.subarray(0, FRAME_MAGIC.length).toString('utf8')
  if (magic !== FRAME_MAGIC) {
    throw new Error('Invalid .ptxv file header.')
  }
  const json = gunzipSync(buffer.subarray(FRAME_MAGIC.length)).toString('utf8')
  return parseProject(json)
}

export async function readProjectFromPath(inputPath: string): Promise<LoadedProject> {
  const absoluteProjectPath = path.resolve(process.cwd(), inputPath)
  if (absoluteProjectPath.toLowerCase().endsWith('.ptxv')) {
    const buffer = await readFile(absoluteProjectPath)
    return {
      project: decodeProjectContainer(buffer),
      absoluteProjectPath,
    }
  }

  const json = await readFile(absoluteProjectPath, 'utf8')
  return {
    project: parseProject(json),
    absoluteProjectPath,
  }
}

async function loadPretextModule(): Promise<PretextModule> {
  if (pretextModulePromise !== null) return pretextModulePromise
  const distEntrypoint = path.join(repoRoot, 'dist', 'layout.js')
  await access(distEntrypoint, constants.F_OK).catch(() => {
    throw new Error(
      'Text-video rendering requires a built Pretext package at dist/layout.js. Run `npm run build:package` first.',
    )
  })
  pretextModulePromise = import(pathToFileURL(distEntrypoint).href) as Promise<PretextModule>
  return pretextModulePromise
}

export function ensureNodeMeasurementBackend(): void {
  if (typeof OffscreenCanvas !== 'undefined') return
  class NodeOffscreenCanvas {
    #canvas

    constructor(width: number, height: number) {
      this.#canvas = createCanvas(width, height)
    }

    getContext(kind: string): CanvasRenderingContext2D | null {
      if (kind !== '2d') return null
      return this.#canvas.getContext('2d') as unknown as CanvasRenderingContext2D
    }
  }

  Reflect.set(globalThis, 'OffscreenCanvas', NodeOffscreenCanvas)
}

function resolveProjectFontPaths(project: TextVideoProject, projectPath?: string): string[] {
  const resolved: string[] = []
  for (let index = 0; index < project.fonts.length; index++) {
    const font = project.fonts[index]!
    if (!font.src) continue
    const absolutePath = projectPath ? path.resolve(path.dirname(projectPath), font.src) : path.resolve(font.src)
    resolved.push(absolutePath)
  }
  return resolved
}

export function registerProjectFonts(project: TextVideoProject, projectPath?: string): string[] {
  const resolved = resolveProjectFontPaths(project, projectPath)
  for (let index = 0; index < project.fonts.length; index++) {
    const font = project.fonts[index]!
    const absolutePath = resolved[index]
    if (!font.src || absolutePath === undefined) continue
    if (registeredFontPaths.has(absolutePath)) continue
    const key = GlobalFonts.registerFromPath(absolutePath, font.family)
    if (key === null) {
      throw new Error(`Failed to register font "${font.family}" from ${absolutePath}`)
    }
    registeredFontPaths.add(absolutePath)
  }
  return resolved
}

function interpolateNumber(value: AnimatedNumber, progress: number): number {
  if (typeof value === 'number') return value
  const t = applyEasing(progress, value.easing ?? 'linear')
  return value.from + (value.to - value.from) * t
}

function applyEasing(progress: number, easing: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'): number {
  if (easing === 'ease-in') return progress * progress
  if (easing === 'ease-out') return 1 - (1 - progress) * (1 - progress)
  if (easing === 'ease-in-out') {
    return progress < 0.5
      ? 2 * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 2) / 2
  }
  return progress
}

function clamp01(value: number): number {
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

function buildFontString(layer: TextLayer, fontSize: number): string {
  const style = layer.fontStyle === 'normal' ? '' : `${layer.fontStyle} `
  const weight = layer.fontWeight === undefined ? '' : `${layer.fontWeight} `
  return `${style}${weight}${fontSize}px ${layer.fontFamily}`.trim()
}

function isLayerActive(layer: TextLayer, sceneStart: number, sceneTime: number): boolean {
  const layerStart = sceneStart + layer.start
  const layerEnd = layerStart + (layer.duration ?? Number.POSITIVE_INFINITY)
  return sceneTime >= layerStart && sceneTime < layerEnd
}

function getLayerProgress(layer: TextLayer, sceneStart: number, sceneTime: number): number {
  const layerStart = sceneStart + layer.start
  if (layer.duration === undefined) return clamp01(sceneTime >= layerStart ? 1 : 0)
  return clamp01((sceneTime - layerStart) / layer.duration)
}

function evaluateLayer(layer: TextLayer, sceneStart: number, sceneTime: number): EvaluatedTextLayer {
  const progress = getLayerProgress(layer, sceneStart, sceneTime)
  const fontSize = interpolateNumber(layer.fontSize, progress)
  return {
    layer,
    x: interpolateNumber(layer.x, progress),
    y: interpolateNumber(layer.y, progress),
    width: interpolateNumber(layer.width, progress),
    fontSize,
    lineHeight: interpolateNumber(layer.lineHeight, progress),
    opacity: interpolateNumber(layer.opacity, progress),
    rotation: interpolateNumber(layer.rotation, progress),
    scale: interpolateNumber(layer.scale, progress),
    font: buildFontString(layer, fontSize),
  }
}

function xmlEscape(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function computeAnchorOffset(layer: TextLayer, width: number): number {
  if (layer.anchorX === 'center') return width / 2
  if (layer.anchorX === 'right') return width
  return 0
}

function computeTextX(layer: TextLayer, boxX: number, width: number, line: LayoutLine): number {
  if (layer.align === 'center') return boxX + width / 2 - line.width / 2
  if (layer.align === 'right') return boxX + width - line.width
  return boxX
}

function getPrepared(
  prepareWithSegmentsImpl: PretextModule['prepareWithSegments'],
  cache: Map<string, PreparedCacheValue>,
  layer: EvaluatedTextLayer,
): PreparedTextWithSegments {
  const cacheKey = JSON.stringify({
    text: layer.layer.text,
    font: layer.font,
    whiteSpace: layer.layer.whiteSpace,
  })
  const cached = cache.get(cacheKey)
  if (cached) return cached.prepared
  const prepared = prepareWithSegmentsImpl(layer.layer.text, layer.font, { whiteSpace: layer.layer.whiteSpace })
  cache.set(cacheKey, {
    prepared,
    text: layer.layer.text,
    font: layer.font,
    whiteSpace: layer.layer.whiteSpace,
  })
  return prepared
}

function renderLayerToSvg(
  evaluated: EvaluatedTextLayer,
  lines: LayoutLine[],
): string {
  const { layer, width, x, y, lineHeight, opacity, rotation, scale, fontSize } = evaluated
  const visibleLines = layer.maxLines ? lines.slice(0, layer.maxLines) : lines
  const boxHeight = visibleLines.length * lineHeight
  const anchorOffset = computeAnchorOffset(layer, width)
  const transformParts = [
    `translate(${x.toFixed(3)} ${y.toFixed(3)})`,
    rotation !== 0 ? `rotate(${rotation.toFixed(3)})` : '',
    scale !== 1 ? `scale(${scale.toFixed(5)})` : '',
    `translate(${(-anchorOffset).toFixed(3)} 0)`,
  ].filter(Boolean)
  const fragments: string[] = []
  if (layer.background) {
    fragments.push(
      `<rect x="0" y="0" width="${width.toFixed(3)}" height="${boxHeight.toFixed(3)}" fill="${xmlEscape(layer.background)}" rx="8" ry="8" />`,
    )
  }
  for (let index = 0; index < visibleLines.length; index++) {
    const line = visibleLines[index]!
    const lineX = computeTextX(layer, 0, width, line)
    const baseline = index * lineHeight + fontSize
    const shadowStyle = layer.shadow
      ? ` style="filter:drop-shadow(${layer.shadow.offsetX}px ${layer.shadow.offsetY}px ${layer.shadow.blur}px ${layer.shadow.color});"`
      : ''
    const strokeAttrs = layer.stroke
      ? ` stroke="${xmlEscape(layer.stroke.color)}" stroke-width="${layer.stroke.width}" paint-order="stroke fill"`
      : ''
    const letterSpacing = layer.letterSpacing === 0 ? '' : ` letter-spacing="${layer.letterSpacing}"`
    fragments.push(
      `<text x="${lineX.toFixed(3)}" y="${baseline.toFixed(3)}" fill="${xmlEscape(layer.color)}"${strokeAttrs}${letterSpacing}${shadowStyle}>${xmlEscape(line.text)}</text>`,
    )
  }
  return `<g opacity="${opacity.toFixed(5)}" transform="${transformParts.join(' ')}">${fragments.join('')}</g>`
}

export async function renderFrame(
  project: TextVideoProject,
  timeSeconds: number,
  projectPath?: string,
  options: RenderFrameOptions = {},
): Promise<RenderFrameResult> {
  ensureNodeMeasurementBackend()
  registerProjectFonts(project, projectPath)
  const pretext = await loadPretextModule()
  const width = project.video.width
  const height = project.video.height
  const scale = options.scale ?? 1
  const preparedCache = new Map<string, PreparedCacheValue>()
  const scene = project.scenes.find(
    candidate => timeSeconds >= candidate.start && timeSeconds < candidate.start + candidate.duration,
  )
  const background = scene?.background ?? project.video.background
  const body: string[] = []

  if (scene) {
    for (let index = 0; index < scene.layers.length; index++) {
      const layer = scene.layers[index]!
      if (!isLayerActive(layer, scene.start, timeSeconds)) continue
      const evaluated = evaluateLayer(layer, scene.start, timeSeconds)
      const prepared = getPrepared(pretext.prepareWithSegments, preparedCache, evaluated)
      const layout = pretext.layoutWithLines(prepared, evaluated.width, evaluated.lineHeight)
      body.push(renderLayerToSvg(evaluated, layout.lines))
    }
  }

  const svg = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${(width * scale).toFixed(0)}" height="${(height * scale).toFixed(0)}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="${xmlEscape(background)}" />`,
    body.join(''),
    `</svg>`,
  ].join('')

  return {
    svg,
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  }
}

export async function renderFrameSvg(
  project: TextVideoProject,
  timeSeconds: number,
  projectPath?: string,
  options: RenderFrameOptions = {},
): Promise<string> {
  const frame = await renderFrame(project, timeSeconds, projectPath, options)
  return frame.svg
}

export function renderSvgToPng(
  svg: string,
  project: TextVideoProject,
  projectPath?: string,
  scale = 1,
): Buffer {
  const fontFiles = resolveProjectFontPaths(project, projectPath)
  const resvg = new Resvg(svg, {
    fitTo: scale === 1 ? { mode: 'original' } : { mode: 'zoom', value: scale },
    font: {
      loadSystemFonts: true,
      fontFiles,
      defaultFontFamily: project.fonts[0]?.family ?? 'sans-serif',
    },
  })
  return resvg.render().asPng()
}

export async function decodeProjectBundle(inputPath: string): Promise<TextVideoProject> {
  const absolutePath = path.resolve(process.cwd(), inputPath)
  const buffer = await readFile(absolutePath)
  return decodeProjectContainer(buffer)
}

export function createSampleProject(): TextVideoProject {
  return textVideoProjectSchema.parse({
    format: 'pretext-text-video',
    version: 1,
    info: {
      name: 'sample-text-video',
      description: 'A vector-first text video sample driven by Pretext line layout.',
      author: 'Adam Hofmann',
    },
    video: {
      width: 1920,
      height: 1080,
      fps: 30,
      durationSeconds: 6,
      background: '#081120',
    },
    fonts: [
      {
        family: 'DejaVu Sans',
        src: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      },
      {
        family: 'DejaVu Serif',
        src: '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf',
      },
    ],
    scenes: [
      {
        id: 'intro',
        start: 0,
        duration: 6,
        background: '#081120',
        layers: [
          {
            type: 'text',
            id: 'eyebrow',
            start: 0,
            duration: 6,
            text: 'PRETEXT POWERED TEXT VIDEO',
            fontFamily: 'DejaVu Sans',
            fontSize: 34,
            lineHeight: 42,
            fontWeight: 700,
            width: 820,
            x: { from: 120, to: 160, easing: 'ease-out' },
            y: 112,
            color: '#7dd3fc',
            opacity: { from: 0.15, to: 1, easing: 'ease-in' },
            letterSpacing: 4,
          },
          {
            type: 'text',
            id: 'headline',
            start: 0.2,
            duration: 5.8,
            text: 'Render semantic text at poster-scale resolution without turning it into pixels first.',
            fontFamily: 'DejaVu Serif',
            fontSize: { from: 78, to: 94, easing: 'ease-in-out' },
            lineHeight: { from: 92, to: 106, easing: 'ease-in-out' },
            fontWeight: 700,
            width: { from: 1100, to: 1260, easing: 'ease-out' },
            x: 120,
            y: 220,
            color: '#f8fafc',
            shadow: {
              color: '#020617',
              blur: 16,
              offsetX: 0,
              offsetY: 8,
              opacity: 0.65,
            },
          },
          {
            type: 'text',
            id: 'body',
            start: 0.8,
            duration: 5.2,
            text: 'Pretext prepares the text once, then frame rendering becomes line placement over cached widths. That makes high-resolution text video practical: animate copy, typography, composition, and timing while keeping storage semantic and compression friendly.',
            fontFamily: 'DejaVu Sans',
            fontSize: 34,
            lineHeight: 50,
            width: 980,
            x: 124,
            y: { from: 680, to: 620, easing: 'ease-out' },
            color: '#cbd5e1',
            opacity: { from: 0, to: 1, easing: 'ease-in' },
            background: 'rgba(15, 23, 42, 0.55)',
          },
          {
            type: 'text',
            id: 'tagline',
            start: 2.2,
            duration: 3.8,
            text: 'Encode the timeline, not the raster.',
            fontFamily: 'DejaVu Sans',
            fontSize: { from: 30, to: 42, easing: 'ease-in-out' },
            lineHeight: 48,
            fontWeight: 700,
            width: 760,
            x: 124,
            y: 960,
            color: '#f59e0b',
            opacity: { from: 0, to: 1, easing: 'ease-out' },
          },
        ],
      },
    ],
  })
}

export async function writeProjectFile(pathname: string, project: TextVideoProject): Promise<void> {
  await writeFile(pathname, serializeProject(project), 'utf8')
}
