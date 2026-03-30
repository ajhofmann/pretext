import { evaluateLayerForRender, evaluateProjectSceneState } from './evaluate.ts'
import { textVideoProjectSchema } from './schema.ts'
import type { Layer, TextVideoProject } from './schema.ts'
import { colorWithOpacity, svgElement, svgVoidElement, xmlEscape } from './svg.ts'
import type {
  EvaluatedGroupLayer,
  EvaluatedImageLayer,
  EvaluatedLayer,
  EvaluatedShapeLayer,
  EvaluatedTextLayer,
  SceneRenderState,
} from './types.ts'
import type { LayoutLine, PreparedTextWithSegments } from '../../src/layout.ts'

type PretextBrowser = {
  prepareWithSegments: (text: string, font: string, options?: { whiteSpace?: 'normal' | 'pre-wrap' }) => PreparedTextWithSegments
  layoutWithLines: (prepared: PreparedTextWithSegments, width: number, lineHeight: number) => { lines: LayoutLine[] }
}

type BrowserRenderContext = {
  project: TextVideoProject
  pretext: PretextBrowser
  textCache: Map<string, { prepared: PreparedTextWithSegments }>
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

function buildFontString(layer: EvaluatedTextLayer): string {
  const style = layer.fontStyle === 'normal' ? '' : `${layer.fontStyle} `
  const weight = layer.fontWeight === undefined ? '' : `${layer.fontWeight} `
  return `${style}${weight}${layer.fontSize}px ${layer.fontFamily}`.trim()
}

function getPrepared(
  pretext: PretextBrowser,
  cache: Map<string, { prepared: PreparedTextWithSegments }>,
  layer: EvaluatedTextLayer,
): PreparedTextWithSegments {
  const font = buildFontString(layer)
  const cacheKey = JSON.stringify({ text: layer.text, font, whiteSpace: layer.whiteSpace })
  const cached = cache.get(cacheKey)
  if (cached !== undefined) return cached.prepared
  const prepared = pretext.prepareWithSegments(layer.text, font, { whiteSpace: layer.whiteSpace })
  cache.set(cacheKey, { prepared })
  return prepared
}

function layoutTextLayerBrowser(
  pretext: PretextBrowser,
  cache: Map<string, { prepared: PreparedTextWithSegments }>,
  layer: EvaluatedTextLayer,
): { lines: LayoutLine[], width: number, height: number, renderedWidth: number } {
  const prepared = getPrepared(pretext, cache, layer)
  const layout = pretext.layoutWithLines(prepared, layer.width, layer.lineHeight)
  const lines = layer.maxLines === undefined ? layout.lines : layout.lines.slice(0, layer.maxLines)
  const renderedWidth = lines.reduce((max, line) => Math.max(max, line.width), 0)
  return { lines, width: layer.width, height: lines.length * layer.lineHeight, renderedWidth }
}

function renderTextLayer(context: BrowserRenderContext, layer: EvaluatedTextLayer): string {
  const rendered = layoutTextLayerBrowser(context.pretext, context.textCache, layer)
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
        x: 0, y: 0,
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
        x1: 0, y1: 0,
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

function renderImageLayer(context: BrowserRenderContext, layer: EvaluatedImageLayer): string {
  const asset = context.project.assets.find(a => a.id === layer.assetId)
  if (asset === undefined || asset.type !== 'image') return ''
  const href = asset.src
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

function renderGroupLayer(context: BrowserRenderContext, layer: EvaluatedGroupLayer, sceneTime: number): string {
  const children: string[] = []
  for (let index = 0; index < layer.children.length; index++) {
    const child = layer.children[index]!
    children.push(renderEvaluatedLayer(context, child, sceneTime))
  }
  return svgElement('g', {}, children.join(''))
}

function renderEvaluatedLayer(context: BrowserRenderContext, layer: EvaluatedLayer, sceneTime: number): string {
  if (layer.type === 'text') return renderTextLayer(context, layer)
  if (layer.type === 'shape') return renderShapeLayer(layer)
  if (layer.type === 'image') return renderImageLayer(context, layer)
  if (layer.type === 'group') return renderGroupLayer(context, layer, sceneTime)
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
          x: 0, y: 0,
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
          x: formatNumber(project.video.width - visibleWidth), y: 0,
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

export async function renderFrameSvgBrowser(
  project: TextVideoProject,
  timeSeconds: number,
  options: { scale?: number } = {},
): Promise<string> {
  const pretext = await import('../../src/layout.ts') as unknown as PretextBrowser
  const parsed = textVideoProjectSchema.parse(project)
  const state = evaluateProjectSceneState(parsed, timeSeconds)
  const defs: string[] = []
  const context: BrowserRenderContext = {
    project: parsed,
    pretext,
    textCache: new Map(),
    defs,
    nextClipId: 1,
  }

  let body: string
  if (state === null) {
    body = svgVoidElement('rect', {
      width: formatNumber(parsed.video.width),
      height: formatNumber(parsed.video.height),
      fill: parsed.video.background,
    })
  } else {
    const background = state.background ?? parsed.video.background
    const bodyParts: string[] = [
      svgVoidElement('rect', {
        width: formatNumber(parsed.video.width),
        height: formatNumber(parsed.video.height),
        fill: background,
      }),
    ]
    for (let index = 0; index < state.scene.layers.length; index++) {
      const layer = state.scene.layers[index] as Layer
      const evaluated = evaluateLayerForRender(layer, state.sceneTime)
      if (evaluated === null) continue
      bodyParts.push(renderEvaluatedLayer(context, evaluated, state.sceneTime))
    }
    body = renderSceneWithTransition(bodyParts.join(''), state, parsed)
  }

  const scale = options.scale ?? 1
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(parsed.video.width * scale)}" height="${Math.round(parsed.video.height * scale)}" viewBox="0 0 ${parsed.video.width} ${parsed.video.height}">`,
    defs.length > 0 ? `<defs>${defs.join('')}</defs>` : '',
    body,
    '</svg>',
  ].join('')
}
