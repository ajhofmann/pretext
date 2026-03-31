import { Resvg } from '@resvg/resvg-js'

import { renderAsciiVideoLayerSvg } from './ascii-video.ts'
import {
  collectEmbeddableAssets,
  getResolvedAssetData,
  resolveImageHref,
  resolveProjectAssetMap,
} from './assets.ts'
import { evaluateLayerForRender, evaluateProjectSceneState } from './evaluate.ts'
import { readProjectFromPath } from './project.ts'
import { type AudioAsset, type TextVideoProject, textVideoProjectSchema } from './schema.ts'
import { colorWithOpacity, svgElement, svgVoidElement, xmlEscape } from './svg.ts'
import { ensureNodeMeasurementBackend, layoutTextLayer, loadPretextModule, registerProjectFonts } from './text.ts'
import type {
  EvaluatedAsciiVideoLayer,
  AssetResolutionContext,
  EmbeddedAssetRecord,
  EvaluatedGroupLayer,
  EvaluatedImageLayer,
  EvaluatedLayer,
  EvaluatedShapeLayer,
  EvaluatedTextLayer,
  PreparedTextCache,
  RenderFrameOptions,
  RenderFrameResult,
  SceneRenderState,
} from './types.ts'

type RenderContext = {
  project: TextVideoProject
  assetContext: AssetResolutionContext
  assetMap: ReturnType<typeof resolveProjectAssetMap>
  pretext: Awaited<ReturnType<typeof loadPretextModule>>
  textCache: PreparedTextCache
  defs: string[]
  nextClipId: number
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3)
}

function buildTransform(x: number, y: number, rotation: number, scaleX: number, scaleY: number): string {
  const parts = [`translate(${formatNumber(x)} ${formatNumber(y)})`]
  if (rotation !== 0) parts.push(`rotate(${formatNumber(rotation)})`)
  if (scaleX !== 1 || scaleY !== 1) parts.push(`scale(${formatNumber(scaleX)} ${formatNumber(scaleY)})`)
  return parts.join(' ')
}

function computeAnchorOffset(
  anchorX: 'left' | 'center' | 'right',
  anchorY: 'top' | 'center' | 'bottom',
  width: number,
  height: number,
): { x: number, y: number } {
  return {
    x: anchorX === 'center' ? width / 2 : anchorX === 'right' ? width : 0,
    y: anchorY === 'center' ? height / 2 : anchorY === 'bottom' ? height : 0,
  }
}

function applyTransitionProgress(progress: number, easing: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'step-start' | 'step-end'): number {
  if (easing === 'ease-in') return progress * progress
  if (easing === 'ease-out') return 1 - (1 - progress) * (1 - progress)
  if (easing === 'ease-in-out') {
    return progress < 0.5
      ? 2 * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 2) / 2
  }
  if (easing === 'step-start') return progress <= 0 ? 0 : 1
  if (easing === 'step-end') return progress < 1 ? 0 : 1
  return progress
}

function isTextLayer(layer: EvaluatedLayer): layer is EvaluatedTextLayer {
  return layer.type === 'text'
}

function isShapeLayer(layer: EvaluatedLayer): layer is EvaluatedShapeLayer {
  return layer.type === 'shape'
}

function isImageLayer(layer: EvaluatedLayer): layer is EvaluatedImageLayer {
  return layer.type === 'image'
}

function isGroupLayer(layer: EvaluatedLayer): layer is EvaluatedGroupLayer {
  return layer.type === 'group'
}

function isAsciiVideoLayer(layer: EvaluatedLayer): layer is EvaluatedAsciiVideoLayer {
  return layer.type === 'ascii-video'
}

async function renderTextLayer(context: RenderContext, layer: EvaluatedTextLayer): Promise<string> {
  const rendered = layoutTextLayer(context.pretext, context.textCache, layer)
  const padding = layer.padding ?? { top: 0, right: 0, bottom: 0, left: 0 }
  const totalWidth = layer.width + padding.left + padding.right
  const totalHeight = rendered.height + padding.top + padding.bottom
  const anchor = computeAnchorOffset(layer.anchorX, layer.anchorY, totalWidth, totalHeight)
  const fragments: string[] = []

  if (layer.background !== undefined) {
    const background = colorWithOpacity(layer.background, 1)
    fragments.push(
      svgVoidElement('rect', {
        x: formatNumber(-anchor.x),
        y: formatNumber(-anchor.y),
        width: formatNumber(totalWidth),
        height: formatNumber(totalHeight),
        rx: formatNumber(layer.cornerRadius),
        ry: formatNumber(layer.cornerRadius),
        fill: background.color,
        'fill-opacity': background.opacity !== undefined ? formatNumber(background.opacity) : undefined,
      }),
    )
  }

  for (let index = 0; index < rendered.lines.length; index++) {
    const line = rendered.lines[index]!
    const alignOffset =
      layer.align === 'center'
        ? (layer.width - line.width) / 2
        : layer.align === 'right'
          ? layer.width - line.width
          : 0
    const x = -anchor.x + padding.left + alignOffset
    const y = -anchor.y + padding.top + index * layer.lineHeight + layer.fontSize
    const strokeAttrs = layer.stroke === undefined
      ? {}
      : {
          stroke: layer.stroke.color,
          'stroke-width': formatNumber(layer.stroke.width),
          'stroke-opacity': layer.stroke.opacity !== undefined ? formatNumber(layer.stroke.opacity) : undefined,
          'paint-order': 'stroke fill',
        }
    const shadowFilter = layer.shadow === undefined
      ? undefined
      : `drop-shadow(${formatNumber(layer.shadow.offsetX)}px ${formatNumber(layer.shadow.offsetY)}px ${formatNumber(layer.shadow.blur)}px ${xmlEscape(layer.shadow.color)})`
    fragments.push(
      svgElement(
        'text',
        {
          x: formatNumber(x),
          y: formatNumber(y),
          fill: layer.color,
          'font-family': layer.fontFamily,
          'font-size': formatNumber(layer.fontSize),
          'font-style': layer.fontStyle,
          'font-weight': layer.fontWeight === undefined ? undefined : String(layer.fontWeight),
          'letter-spacing': layer.letterSpacing === 0 ? undefined : formatNumber(layer.letterSpacing),
          style: shadowFilter === undefined ? undefined : `filter:${shadowFilter}`,
          ...strokeAttrs,
        },
        xmlEscape(line.text),
      ),
    )
  }

  return svgElement(
    'g',
    {
      opacity: layer.opacity < 1 ? formatNumber(layer.opacity) : undefined,
      transform: buildTransform(layer.x, layer.y, layer.rotation, layer.scaleX, layer.scaleY),
    },
    fragments.join(''),
  )
}

function renderShapeLayer(layer: EvaluatedShapeLayer): string {
  const commonAttrs = {
    opacity: layer.opacity < 1 ? formatNumber(layer.opacity) : undefined,
    transform: buildTransform(layer.x, layer.y, layer.rotation, layer.scaleX, layer.scaleY),
  }

  if (layer.shape === 'rect') {
    const { color, opacity } = colorWithOpacity(layer.fill, 1)
    return svgElement(
      'g',
      commonAttrs,
      svgVoidElement('rect', {
        x: 0,
        y: 0,
        width: formatNumber(layer.width),
        height: formatNumber(layer.height),
        rx: formatNumber(layer.radius),
        ry: formatNumber(layer.radius),
        fill: color,
        'fill-opacity': opacity !== undefined ? formatNumber(opacity) : undefined,
        stroke: layer.stroke?.color,
        'stroke-width': layer.stroke === undefined ? undefined : formatNumber(layer.stroke.width),
        'stroke-opacity': layer.stroke?.opacity !== undefined ? formatNumber(layer.stroke.opacity) : undefined,
      }),
    )
  }

  if (layer.shape === 'circle') {
    const { color, opacity } = colorWithOpacity(layer.fill, 1)
    return svgElement(
      'g',
      commonAttrs,
      svgVoidElement('circle', {
        cx: formatNumber(layer.radius),
        cy: formatNumber(layer.radius),
        r: formatNumber(layer.radius),
        fill: color,
        'fill-opacity': opacity !== undefined ? formatNumber(opacity) : undefined,
        stroke: layer.stroke?.color,
        'stroke-width': layer.stroke === undefined ? undefined : formatNumber(layer.stroke.width),
        'stroke-opacity': layer.stroke?.opacity !== undefined ? formatNumber(layer.stroke.opacity) : undefined,
      }),
    )
  }

  if (layer.shape === 'line') {
    return svgElement(
      'g',
      commonAttrs,
      svgVoidElement('line', {
        x1: 0,
        y1: 0,
        x2: formatNumber(layer.x2),
        y2: formatNumber(layer.y2),
        stroke: layer.stroke.color,
        'stroke-width': formatNumber(layer.stroke.width),
        'stroke-opacity': layer.stroke.opacity !== undefined ? formatNumber(layer.stroke.opacity) : undefined,
      }),
    )
  }

  const { color, opacity } = colorWithOpacity(layer.fill, 1)
  const points = layer.points.map(point => `${formatNumber(point.x)},${formatNumber(point.y)}`).join(' ')
  return svgElement(
    'g',
    commonAttrs,
    svgVoidElement('polygon', {
      points,
      fill: color,
      'fill-opacity': opacity !== undefined ? formatNumber(opacity) : undefined,
      stroke: layer.stroke?.color,
      'stroke-width': layer.stroke === undefined ? undefined : formatNumber(layer.stroke.width),
      'stroke-opacity': layer.stroke?.opacity !== undefined ? formatNumber(layer.stroke.opacity) : undefined,
    }),
  )
}

async function renderImageLayer(context: RenderContext, layer: EvaluatedImageLayer): Promise<string> {
  const asset = context.assetMap.get(layer.assetId)
  if (asset === undefined || asset.type !== 'image') {
    throw new Error(`Image layer "${layer.id}" references missing image asset "${layer.assetId}"`)
  }
  const href = await resolveImageHref(asset, context.assetContext)
  const anchor = computeAnchorOffset(layer.anchorX, layer.anchorY, layer.width, layer.height)
  const clipId = layer.clipRadius > 0 ? `text-video-clip-${context.nextClipId++}` : null
  if (clipId !== null) {
    context.defs.push(
      svgElement(
        'clipPath',
        { id: clipId },
        svgVoidElement('rect', {
          x: formatNumber(-anchor.x),
          y: formatNumber(-anchor.y),
          width: formatNumber(layer.width),
          height: formatNumber(layer.height),
          rx: formatNumber(layer.clipRadius),
          ry: formatNumber(layer.clipRadius),
        }),
      ),
    )
  }
  return svgElement(
    'g',
    {
      opacity: layer.opacity < 1 ? formatNumber(layer.opacity) : undefined,
      transform: buildTransform(layer.x, layer.y, layer.rotation, layer.scaleX, layer.scaleY),
      'clip-path': clipId === null ? undefined : `url(#${clipId})`,
    },
    svgVoidElement('image', {
      href,
      x: formatNumber(-anchor.x),
      y: formatNumber(-anchor.y),
      width: formatNumber(layer.width),
      height: formatNumber(layer.height),
      preserveAspectRatio:
        layer.fit === 'contain'
          ? 'xMidYMid meet'
          : layer.fit === 'cover'
            ? 'xMidYMid slice'
            : 'none',
    }),
  )
}

async function renderAsciiVideoLayer(context: RenderContext, layer: EvaluatedAsciiVideoLayer): Promise<string> {
  const asset = context.assetMap.get(layer.assetId)
  if (asset === undefined || asset.type !== 'ascii-video') {
    throw new Error(`ASCII video layer "${layer.id}" references missing asset "${layer.assetId}"`)
  }

  const bytes = await getResolvedAssetData(asset, context.assetContext)
  if (bytes === null) {
    throw new Error(`Unable to resolve ASCII video asset "${asset.id}"`)
  }

  return renderAsciiVideoLayerSvg(
    layer,
    asset,
    bytes,
    layer.currentTimeSeconds,
    context.assetContext,
  )
}

async function renderGroupLayer(context: RenderContext, layer: EvaluatedGroupLayer, sceneTime: number): Promise<string> {
  const children: string[] = []
  for (let index = 0; index < layer.children.length; index++) {
    const child = layer.children[index]!
    children.push(await renderEvaluatedLayer(context, child, sceneTime))
  }
  return svgElement('g', {}, children.join(''))
}

async function renderEvaluatedLayer(context: RenderContext, layer: EvaluatedLayer, sceneTime: number): Promise<string> {
  if (isTextLayer(layer)) return renderTextLayer(context, layer)
  if (isShapeLayer(layer)) return Promise.resolve(renderShapeLayer(layer))
  if (isImageLayer(layer)) return renderImageLayer(context, layer)
  if (isAsciiVideoLayer(layer)) return renderAsciiVideoLayer(context, layer)
  if (isGroupLayer(layer)) return renderGroupLayer(context, layer, sceneTime)
  return ''
}

function renderSceneWithTransition(
  body: string,
  sceneState: SceneRenderState,
  project: TextVideoProject,
): string {
  if (sceneState.scene.transitionIn === undefined || sceneState.transitionInProgress <= 0) return body
  const duration = sceneState.scene.transitionIn.duration
  if (duration <= 0) return body
  const localProgress = Math.min(1, sceneState.transitionInProgress / duration)
  const progress = applyTransitionProgress(localProgress, sceneState.scene.transitionIn.easing)
  switch (sceneState.scene.transitionIn.type) {
    case 'fade':
      return svgElement('g', { opacity: formatNumber(progress) }, body)
    case 'wipe-left':
      return svgElement(
        'svg',
        {
          x: 0,
          y: 0,
          width: formatNumber(project.video.width * progress),
          height: formatNumber(project.video.height),
          viewBox: `0 0 ${project.video.width} ${project.video.height}`,
          overflow: 'hidden',
        },
        body,
      )
    case 'wipe-right': {
      const visibleWidth = project.video.width * progress
      return svgElement(
        'svg',
        {
          x: formatNumber(project.video.width - visibleWidth),
          y: 0,
          width: formatNumber(visibleWidth),
          height: formatNumber(project.video.height),
          viewBox: `${project.video.width - visibleWidth} 0 ${visibleWidth} ${project.video.height}`,
          overflow: 'hidden',
        },
        body,
      )
    }
    case 'slide-left':
      return svgElement('g', { transform: `translate(${formatNumber((1 - progress) * project.video.width)} 0)` }, body)
    case 'slide-right':
      return svgElement('g', { transform: `translate(${formatNumber((progress - 1) * project.video.width)} 0)` }, body)
    case 'zoom-in': {
      const zoom = 0.8 + 0.2 * progress
      const dx = (project.video.width - project.video.width * zoom) / 2
      const dy = (project.video.height - project.video.height * zoom) / 2
      return svgElement('g', { opacity: formatNumber(progress), transform: `translate(${formatNumber(dx)} ${formatNumber(dy)}) scale(${formatNumber(zoom)})` }, body)
    }
    case 'none':
      return body
    default:
      return body
  }
}

async function renderSceneBody(context: RenderContext, sceneState: SceneRenderState): Promise<string> {
  const background = sceneState.background ?? context.project.video.background
  const body: string[] = [
    svgVoidElement('rect', {
      width: formatNumber(context.project.video.width),
      height: formatNumber(context.project.video.height),
      fill: background,
    }),
  ]
  for (let index = 0; index < sceneState.scene.layers.length; index++) {
    const layer = sceneState.scene.layers[index] as import('./schema.ts').Layer
    const evaluated = evaluateLayerForRender(layer, sceneState.sceneTime)
    if (evaluated === null) continue
    body.push(await renderEvaluatedLayer(context, evaluated, sceneState.sceneTime))
  }
  return renderSceneWithTransition(body.join(''), sceneState, context.project)
}

export async function renderFrame(
  project: TextVideoProject,
  timeSeconds: number,
  assetContext: AssetResolutionContext = {},
  options: RenderFrameOptions = {},
): Promise<RenderFrameResult> {
  ensureNodeMeasurementBackend()
  registerProjectFonts(project, assetContext)
  const pretext = await loadPretextModule()
  const defs: string[] = []
  const state = evaluateProjectSceneState(textVideoProjectSchema.parse(project), timeSeconds)
  const context: RenderContext = {
    project,
    assetContext,
    assetMap: resolveProjectAssetMap(project),
    pretext,
    textCache: new Map(),
    defs,
    nextClipId: 1,
  }

  const body = state === null
    ? svgVoidElement('rect', {
        width: formatNumber(project.video.width),
        height: formatNumber(project.video.height),
        fill: project.video.background,
      })
    : await renderSceneBody(context, state)

  const scale = options.scale ?? 1
  const svg = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(project.video.width * scale)}" height="${Math.round(project.video.height * scale)}" viewBox="0 0 ${project.video.width} ${project.video.height}">`,
    defs.length > 0 ? `<defs>${defs.join('')}</defs>` : '',
    body,
    '</svg>',
  ].join('')

  return {
    svg,
    width: Math.round(project.video.width * scale),
    height: Math.round(project.video.height * scale),
  }
}

export async function renderFrameSvg(
  project: TextVideoProject,
  timeSeconds: number,
  assetContext: AssetResolutionContext = {},
  options: RenderFrameOptions = {},
): Promise<string> {
  return (await renderFrame(project, timeSeconds, assetContext, options)).svg
}

export async function encodeProjectToContainer(
  project: TextVideoProject,
  absoluteProjectPath?: string,
  extraEmbeddedAssets?: Map<string, { key: string, bytes: Uint8Array, mimeType: string | undefined, originalPath: string | undefined }>,
): Promise<Buffer> {
  const { encodeProjectBundle } = await import('./container.ts')
  const embeddedAssets = await collectEmbeddableAssets(project, absoluteProjectPath)
  if (extraEmbeddedAssets !== undefined) {
    for (const [id, payload] of extraEmbeddedAssets) {
      embeddedAssets.set(id, payload)
    }
  }
  const assets: EmbeddedAssetRecord[] = []
  for (const [id, payload] of embeddedAssets) {
    assets.push({
      id,
      fileName: payload.originalPath ?? id,
      mediaType: payload.mimeType ?? 'application/octet-stream',
      encoding: 'base64',
      data: Buffer.from(payload.bytes).toString('base64'),
    })
  }
  return encodeProjectBundle(project, assets)
}

export function renderSvgToPng(
  svg: string,
  project: TextVideoProject,
  assetContext: AssetResolutionContext = {},
  scale = 1,
): Buffer {
  const fontFiles = project.assets
    .filter((asset): asset is Extract<TextVideoProject['assets'][number], { type: 'font' }> => asset.type === 'font')
    .map(asset => {
      const absolute = assetContext.absoluteProjectPath === undefined
        ? asset.src
        : new URL(asset.src, `file://${assetContext.absoluteProjectPath}`).pathname
      return absolute
    })
  const resvg = new Resvg(svg, {
    fitTo: scale === 1 ? { mode: 'original' } : { mode: 'zoom', value: scale },
    font: {
      loadSystemFonts: true,
      fontFiles,
      defaultFontFamily: project.assets.find(asset => asset.type === 'font')?.family ?? 'sans-serif',
    },
  })
  return resvg.render().asPng()
}

export function getPrimaryAudioAsset(project: TextVideoProject): AudioAsset | null {
  const audio = project.assets.find((asset): asset is AudioAsset => asset.type === 'audio')
  return audio ?? null
}

export async function loadProjectForRender(inputPath: string) {
  return readProjectFromPath(inputPath)
}
