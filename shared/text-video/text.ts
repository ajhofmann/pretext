import { GlobalFonts, createCanvas } from '@napi-rs/canvas'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import type { LayoutLine, PreparedTextWithSegments } from '../../src/layout.ts'
import type {
  AssetResolutionContext,
  EvaluatedTextLayer,
  FontAssetLike,
  PretextModule,
  TextVideoProjectLike,
} from './types.ts'

type PreparedCacheValue = {
  prepared: PreparedTextWithSegments
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const registeredFontPaths = new Set<string>()
let pretextModulePromise: Promise<PretextModule> | null = null

export type RenderedTextBlock = {
  lines: LayoutLine[]
  width: number
  height: number
  renderedWidth: number
}

export async function loadPretextModule(): Promise<PretextModule> {
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

function resolveFontAssetPath(asset: FontAssetLike, context: AssetResolutionContext = {}): string | null {
  if (/^(?:[a-z]+:)?\/\//i.test(asset.src) || asset.src.startsWith('data:')) return null
  if (context.absoluteProjectPath !== undefined) {
    return path.resolve(path.dirname(context.absoluteProjectPath), asset.src)
  }
  return path.resolve(asset.src)
}

export function registerProjectFonts(project: TextVideoProjectLike, context: AssetResolutionContext = {}): string[] {
  const paths: string[] = []
  for (let index = 0; index < project.assets.length; index++) {
    const asset = project.assets[index]
    if (asset?.type !== 'font') continue
    const absolutePath = resolveFontAssetPath(asset, context)
    if (absolutePath === null) continue
    paths.push(absolutePath)
    if (registeredFontPaths.has(absolutePath)) continue
    const key = GlobalFonts.registerFromPath(absolutePath, asset.family)
    if (key === null) {
      throw new Error(`Failed to register font "${asset.family}" from ${absolutePath}`)
    }
    registeredFontPaths.add(absolutePath)
  }
  return paths
}

export function buildFontString(layer: EvaluatedTextLayer): string {
  const style = layer.fontStyle === 'normal' ? '' : `${layer.fontStyle} `
  const weight = layer.fontWeight === undefined ? '' : `${layer.fontWeight} `
  return `${style}${weight}${layer.fontSize}px ${layer.fontFamily}`.trim()
}

function getPrepared(
  pretext: PretextModule,
  cache: Map<string, PreparedCacheValue>,
  layer: EvaluatedTextLayer,
): PreparedTextWithSegments {
  const font = buildFontString(layer)
  const cacheKey = JSON.stringify({
    text: layer.text,
    font,
    whiteSpace: layer.whiteSpace,
  })
  const cached = cache.get(cacheKey)
  if (cached !== undefined) return cached.prepared
  const prepared = pretext.prepareWithSegments(layer.text, font, { whiteSpace: layer.whiteSpace })
  cache.set(cacheKey, { prepared })
  return prepared
}

export function layoutTextLayer(
  pretext: PretextModule,
  cache: Map<string, PreparedCacheValue>,
  layer: EvaluatedTextLayer,
): RenderedTextBlock {
  const prepared = getPrepared(pretext, cache, layer)
  const layout = pretext.layoutWithLines(prepared, layer.width, layer.lineHeight)
  const lines = layer.maxLines === undefined ? layout.lines : layout.lines.slice(0, layer.maxLines)
  const renderedWidth = lines.reduce((max, line) => Math.max(max, line.width), 0)
  return {
    lines,
    width: layer.width,
    height: lines.length * layer.lineHeight,
    renderedWidth,
  }
}
