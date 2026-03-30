import {
  layoutNextLine,
  prepareWithSegments,
  type PrepareOptions,
  type PreparedTextWithSegments,
} from './layout.js'

type CanvasTarget = HTMLCanvasElement | OffscreenCanvas
type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
type Interval = { left: number, right: number }
type FontMetrics = { fontSize: number, ascent: number, descent: number, baselineInset: number }

export type TextVideoTimeRange = {
  start?: number
  end?: number
}

export type TextVideoEasing =
  | 'linear'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  | 'smoothstep'

export type TextVideoKeyframe = {
  time: number
  value: number
  easing?: TextVideoEasing
}

export type TextVideoAnimatedNumber =
  | number
  | {
      keyframes: TextVideoKeyframe[]
      easing?: TextVideoEasing
    }

export type TextVideoColorStop = {
  offset: number
  color: string
}

export type TextVideoBackground =
  | {
      kind: 'solid'
      color: string
    }
  | {
      kind: 'linear-gradient'
      x0: number
      y0: number
      x1: number
      y1: number
      stops: TextVideoColorStop[]
    }
  | {
      kind: 'radial-gradient'
      x0: number
      y0: number
      r0: number
      x1: number
      y1: number
      r1: number
      stops: TextVideoColorStop[]
    }

export type TextVideoShadow = {
  color: string
  blur?: number
  offsetX?: number
  offsetY?: number
}

export type TextVideoStroke = {
  color: string
  width: number
}

export type TextVideoLineBox = {
  fill: string
  paddingX?: number
  paddingY?: number
  radius?: number
  opacity?: number
}

export type TextVideoRegion = {
  x: number
  y: number
  width: number
  height: number
}

export type TextVideoWrapSettings = {
  obstacleIds?: string[]
  minSlotWidth?: number
  slotOrder?: 'left-to-right' | 'right-to-left' | 'widest-first'
}

export type TextVideoReveal = {
  start?: number
  duration: number
  stagger?: number
  fromY?: number
  easing?: TextVideoEasing
}

export type TextVideoClip = {
  id: string
  text: string
  font: string
  lineHeight: number
  fill: string
  regions: TextVideoRegion[]
  align?: 'left' | 'center' | 'right'
  active?: TextVideoTimeRange
  maxLines?: number
  opacity?: TextVideoAnimatedNumber
  shadow?: TextVideoShadow
  stroke?: TextVideoStroke
  lineBox?: TextVideoLineBox
  whiteSpace?: PrepareOptions['whiteSpace']
  wrap?: TextVideoWrapSettings
  reveal?: TextVideoReveal
}

export type TextVideoCircleObstacle = {
  id: string
  kind: 'circle'
  x: TextVideoAnimatedNumber
  y: TextVideoAnimatedNumber
  radius: TextVideoAnimatedNumber
  padding?: TextVideoAnimatedNumber
  fill?: string
  opacity?: TextVideoAnimatedNumber
  blur?: number
  shadow?: TextVideoShadow
  active?: TextVideoTimeRange
}

export type TextVideoRectObstacle = {
  id: string
  kind: 'rect'
  x: TextVideoAnimatedNumber
  y: TextVideoAnimatedNumber
  width: TextVideoAnimatedNumber
  height: TextVideoAnimatedNumber
  padding?: TextVideoAnimatedNumber
  cornerRadius?: number
  fill?: string
  opacity?: TextVideoAnimatedNumber
  blur?: number
  shadow?: TextVideoShadow
  active?: TextVideoTimeRange
}

export type TextVideoObstacle = TextVideoCircleObstacle | TextVideoRectObstacle

export type TextVideoProject = {
  width: number
  height: number
  duration: number
  fps: number
  background?: TextVideoBackground
  obstacles?: TextVideoObstacle[]
  clips: TextVideoClip[]
  debug?: boolean
}

export type TextVideoResolvedObstacle =
  | {
      id: string
      kind: 'circle'
      x: number
      y: number
      radius: number
      padding: number
      fill?: string
      opacity: number
      blur: number
      shadow?: TextVideoShadow
    }
  | {
      id: string
      kind: 'rect'
      x: number
      y: number
      width: number
      height: number
      padding: number
      cornerRadius: number
      fill?: string
      opacity: number
      blur: number
      shadow?: TextVideoShadow
    }

export type TextVideoFrameLine = {
  clipId: string
  text: string
  font: string
  lineHeight: number
  fill: string
  width: number
  x: number
  y: number
  baselineY: number
  opacity: number
  regionIndex: number
  lineIndex: number
  slot: Interval
  shadow?: TextVideoShadow
  stroke?: TextVideoStroke
  lineBox?: TextVideoLineBox
}

export type TextVideoFrame = {
  width: number
  height: number
  duration: number
  fps: number
  time: number
  background?: TextVideoBackground
  obstacles: TextVideoResolvedObstacle[]
  lines: TextVideoFrameLine[]
  debug: boolean
}

export type TextVideoRenderResult = TextVideoFrame & {
  lineCount: number
  renderMs: number
}

export type TextVideoRecordProgress = {
  frame: number
  totalFrames: number
  time: number
  duration: number
}

export type TextVideoRecordOptions = {
  engine: TextVideoEngine
  canvas: HTMLCanvasElement
  mimeType?: string
  videoBitsPerSecond?: number
  onProgress?: (progress: TextVideoRecordProgress) => void
}

let sharedMeasureContext: Canvas2D | null = null
const fontMetricsCache = new Map<string, FontMetrics>()

function getMeasureContext(): Canvas2D {
  if (sharedMeasureContext !== null) return sharedMeasureContext
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(16, 16)
    const context = canvas.getContext('2d')
    if (context !== null) {
      sharedMeasureContext = context
      return context
    }
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (context !== null) {
      sharedMeasureContext = context
      return context
    }
  }
  throw new Error('2d canvas context unavailable')
}

function getTargetContext(canvas: CanvasTarget): Canvas2D {
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('2d canvas context unavailable')
  return context as Canvas2D
}

function sizeCanvas(canvas: CanvasTarget, width: number, height: number): void {
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
}

function parseFontSize(font: string): number {
  const match = font.match(/(\d+(?:\.\d+)?)\s*px/)
  return match ? Number.parseFloat(match[1]!) : 16
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function ease(progress: number, easing: TextVideoEasing): number {
  switch (easing) {
    case 'linear':
      return progress
    case 'ease-in':
      return progress * progress
    case 'ease-out':
      return 1 - (1 - progress) * (1 - progress)
    case 'ease-in-out':
      return progress < 0.5
        ? 2 * progress * progress
        : 1 - ((-2 * progress + 2) ** 2) / 2
    case 'smoothstep':
      return progress * progress * (3 - 2 * progress)
  }
}

function resolveAnimatedNumber(
  animated: TextVideoAnimatedNumber | undefined,
  time: number,
  fallback: number,
): number {
  if (animated === undefined) return fallback
  if (typeof animated === 'number') return animated
  const keyframes = animated.keyframes
  if (keyframes.length === 0) return fallback
  if (time <= keyframes[0]!.time) return keyframes[0]!.value
  for (let index = 0; index + 1 < keyframes.length; index++) {
    const current = keyframes[index]!
    const next = keyframes[index + 1]!
    if (time > next.time) continue
    const span = next.time - current.time
    if (span <= 0) return next.value
    const t = clamp((time - current.time) / span, 0, 1)
    const eased = ease(t, next.easing ?? current.easing ?? animated.easing ?? 'linear')
    return current.value + (next.value - current.value) * eased
  }
  return keyframes[keyframes.length - 1]!.value
}

function isTimeActive(range: TextVideoTimeRange | undefined, time: number): boolean {
  if (range?.start !== undefined && time < range.start) return false
  if (range?.end !== undefined && time > range.end) return false
  return true
}

function getFontMetrics(font: string, lineHeight: number): FontMetrics {
  const cacheKey = `${font}::${lineHeight}`
  const cached = fontMetricsCache.get(cacheKey)
  if (cached !== undefined) return cached
  const fontSize = parseFontSize(font)
  const measureContext = getMeasureContext()
  measureContext.font = font
  const metrics = measureContext.measureText('Hg')
  const ascent = metrics.actualBoundingBoxAscent || fontSize * 0.78
  const descent = metrics.actualBoundingBoxDescent || fontSize * 0.22
  const baselineInset = Math.max(0, (lineHeight - (ascent + descent)) / 2) + ascent
  const resolved = { fontSize, ascent, descent, baselineInset }
  fontMetricsCache.set(cacheKey, resolved)
  return resolved
}

function normalizeStops(stops: TextVideoColorStop[]): TextVideoColorStop[] {
  if (stops.length === 0) return [{ offset: 0, color: '#000' }, { offset: 1, color: '#fff' }]
  return stops.slice().sort((a, b) => a.offset - b.offset)
}

function fillBackground(context: Canvas2D, width: number, height: number, background: TextVideoBackground | undefined): void {
  context.clearRect(0, 0, width, height)
  if (background === undefined) return
  switch (background.kind) {
    case 'solid':
      context.fillStyle = background.color
      break
    case 'linear-gradient': {
      const gradient = context.createLinearGradient(background.x0, background.y0, background.x1, background.y1)
      const stops = normalizeStops(background.stops)
      for (let index = 0; index < stops.length; index++) {
        const stop = stops[index]!
        gradient.addColorStop(stop.offset, stop.color)
      }
      context.fillStyle = gradient
      break
    }
    case 'radial-gradient': {
      const gradient = context.createRadialGradient(
        background.x0,
        background.y0,
        background.r0,
        background.x1,
        background.y1,
        background.r1,
      )
      const stops = normalizeStops(background.stops)
      for (let index = 0; index < stops.length; index++) {
        const stop = stops[index]!
        gradient.addColorStop(stop.offset, stop.color)
      }
      context.fillStyle = gradient
      break
    }
  }
  context.fillRect(0, 0, width, height)
}

function withShadow(context: Canvas2D, shadow: TextVideoShadow | undefined): void {
  if (shadow === undefined) {
    context.shadowColor = 'transparent'
    context.shadowBlur = 0
    context.shadowOffsetX = 0
    context.shadowOffsetY = 0
    return
  }
  context.shadowColor = shadow.color
  context.shadowBlur = shadow.blur ?? 0
  context.shadowOffsetX = shadow.offsetX ?? 0
  context.shadowOffsetY = shadow.offsetY ?? 0
}

function roundedRectPath(
  context: Canvas2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const clampedRadius = clamp(radius, 0, Math.min(width, height) / 2)
  context.beginPath()
  context.moveTo(x + clampedRadius, y)
  context.lineTo(x + width - clampedRadius, y)
  context.quadraticCurveTo(x + width, y, x + width, y + clampedRadius)
  context.lineTo(x + width, y + height - clampedRadius)
  context.quadraticCurveTo(x + width, y + height, x + width - clampedRadius, y + height)
  context.lineTo(x + clampedRadius, y + height)
  context.quadraticCurveTo(x, y + height, x, y + height - clampedRadius)
  context.lineTo(x, y + clampedRadius)
  context.quadraticCurveTo(x, y, x + clampedRadius, y)
  context.closePath()
}

function resolveReveal(
  reveal: TextVideoReveal | undefined,
  time: number,
  lineIndex: number,
): { opacity: number, offsetY: number } {
  if (reveal === undefined) return { opacity: 1, offsetY: 0 }
  const start = (reveal.start ?? 0) + lineIndex * (reveal.stagger ?? 0)
  if (time <= start) return { opacity: 0, offsetY: reveal.fromY ?? 0 }
  const duration = Math.max(0.0001, reveal.duration)
  const progress = clamp((time - start) / duration, 0, 1)
  const eased = ease(progress, reveal.easing ?? 'ease-out')
  return {
    opacity: eased,
    offsetY: (reveal.fromY ?? 0) * (1 - eased),
  }
}

function getPrepared(
  cache: Map<string, PreparedTextWithSegments>,
  text: string,
  font: string,
  whiteSpace: PrepareOptions['whiteSpace'] | undefined,
): PreparedTextWithSegments {
  const cacheKey = `${font}::${whiteSpace ?? 'normal'}::${text}`
  const cached = cache.get(cacheKey)
  if (cached !== undefined) return cached
  const prepared = prepareWithSegments(text, font, whiteSpace === undefined ? undefined : { whiteSpace })
  cache.set(cacheKey, prepared)
  return prepared
}

function circleIntervalForBand(
  x: number,
  y: number,
  radius: number,
  bandTop: number,
  bandBottom: number,
  padding: number,
): Interval | null {
  const top = bandTop - padding
  const bottom = bandBottom + padding
  if (top >= y + radius || bottom <= y - radius) return null
  const minDy = y >= top && y <= bottom ? 0 : y < top ? top - y : y - bottom
  if (minDy >= radius) return null
  const maxDx = Math.sqrt(radius * radius - minDy * minDy)
  return { left: x - maxDx - padding, right: x + maxDx + padding }
}

function rectIntervalForBand(
  x: number,
  y: number,
  width: number,
  height: number,
  bandTop: number,
  bandBottom: number,
  padding: number,
): Interval | null {
  if (bandBottom <= y - padding || bandTop >= y + height + padding) return null
  return { left: x - padding, right: x + width + padding }
}

function carveTextLineSlots(base: Interval, blocked: Interval[], minSlotWidth: number): Interval[] {
  let slots: Interval[] = [base]
  for (let blockedIndex = 0; blockedIndex < blocked.length; blockedIndex++) {
    const interval = blocked[blockedIndex]!
    const next: Interval[] = []
    for (let slotIndex = 0; slotIndex < slots.length; slotIndex++) {
      const slot = slots[slotIndex]!
      if (interval.right <= slot.left || interval.left >= slot.right) {
        next.push(slot)
        continue
      }
      if (interval.left > slot.left) next.push({ left: slot.left, right: interval.left })
      if (interval.right < slot.right) next.push({ left: interval.right, right: slot.right })
    }
    slots = next
  }
  return slots.filter(slot => slot.right - slot.left >= minSlotWidth)
}

function sortSlots(
  slots: Interval[],
  order: NonNullable<TextVideoWrapSettings['slotOrder']>,
): Interval[] {
  const sorted = slots.slice()
  switch (order) {
    case 'left-to-right':
      sorted.sort((a, b) => a.left - b.left)
      return sorted
    case 'right-to-left':
      sorted.sort((a, b) => b.right - a.right)
      return sorted
    case 'widest-first':
      sorted.sort((a, b) => {
        const widthDelta = (b.right - b.left) - (a.right - a.left)
        if (widthDelta !== 0) return widthDelta
        return a.left - b.left
      })
      return sorted
  }
}

function getObstacleIntervals(
  obstacle: TextVideoResolvedObstacle,
  bandTop: number,
  bandBottom: number,
): Interval[] {
  switch (obstacle.kind) {
    case 'circle': {
      const interval = circleIntervalForBand(
        obstacle.x,
        obstacle.y,
        obstacle.radius,
        bandTop,
        bandBottom,
        obstacle.padding,
      )
      return interval === null ? [] : [interval]
    }
    case 'rect': {
      const interval = rectIntervalForBand(
        obstacle.x,
        obstacle.y,
        obstacle.width,
        obstacle.height,
        bandTop,
        bandBottom,
        obstacle.padding,
      )
      return interval === null ? [] : [interval]
    }
  }
}

function resolveObstacle(obstacle: TextVideoObstacle, time: number): TextVideoResolvedObstacle | null {
  if (!isTimeActive(obstacle.active, time)) return null
  const padding = Math.max(0, resolveAnimatedNumber(obstacle.padding, time, 0))
  const opacity = clamp(resolveAnimatedNumber(obstacle.opacity, time, 1), 0, 1)
  const blur = Math.max(0, obstacle.blur ?? 0)
  switch (obstacle.kind) {
    case 'circle': {
      const resolved: TextVideoResolvedObstacle = {
        id: obstacle.id,
        kind: 'circle',
        x: resolveAnimatedNumber(obstacle.x, time, 0),
        y: resolveAnimatedNumber(obstacle.y, time, 0),
        radius: Math.max(0, resolveAnimatedNumber(obstacle.radius, time, 0)),
        padding,
        opacity,
        blur,
      }
      if (obstacle.fill !== undefined) resolved.fill = obstacle.fill
      if (obstacle.shadow !== undefined) resolved.shadow = obstacle.shadow
      return resolved
    }
    case 'rect': {
      const resolved: TextVideoResolvedObstacle = {
        id: obstacle.id,
        kind: 'rect',
        x: resolveAnimatedNumber(obstacle.x, time, 0),
        y: resolveAnimatedNumber(obstacle.y, time, 0),
        width: Math.max(0, resolveAnimatedNumber(obstacle.width, time, 0)),
        height: Math.max(0, resolveAnimatedNumber(obstacle.height, time, 0)),
        padding,
        cornerRadius: Math.max(0, obstacle.cornerRadius ?? 0),
        opacity,
        blur,
      }
      if (obstacle.fill !== undefined) resolved.fill = obstacle.fill
      if (obstacle.shadow !== undefined) resolved.shadow = obstacle.shadow
      return resolved
    }
  }
}

function resolveClipObstacles(
  clip: TextVideoClip,
  obstacles: TextVideoResolvedObstacle[],
): TextVideoResolvedObstacle[] {
  const obstacleIds = clip.wrap?.obstacleIds
  if (obstacleIds === undefined || obstacleIds.length === 0) return obstacles
  const visibleIds = new Set(obstacleIds)
  return obstacles.filter(obstacle => visibleIds.has(obstacle.id))
}

function alignLine(
  slot: Interval,
  lineWidth: number,
  align: NonNullable<TextVideoClip['align']>,
): number {
  switch (align) {
    case 'left':
      return slot.left
    case 'center':
      return slot.left + (slot.right - slot.left - lineWidth) / 2
    case 'right':
      return slot.right - lineWidth
  }
}

function composeClipLines(
  clip: TextVideoClip,
  prepared: PreparedTextWithSegments,
  time: number,
  obstacles: TextVideoResolvedObstacle[],
): TextVideoFrameLine[] {
  const clipOpacity = clamp(resolveAnimatedNumber(clip.opacity, time, 1), 0, 1)
  if (clipOpacity <= 0) return []
  const fontMetrics = getFontMetrics(clip.font, clip.lineHeight)
  const minSlotWidth = Math.max(1, clip.wrap?.minSlotWidth ?? Math.ceil(fontMetrics.fontSize * 0.75))
  const slotOrder = clip.wrap?.slotOrder ?? 'left-to-right'
  const align = clip.align ?? 'left'
  const lines: TextVideoFrameLine[] = []
  let cursor = { segmentIndex: 0, graphemeIndex: 0 }
  let lineIndex = 0

  for (let regionIndex = 0; regionIndex < clip.regions.length; regionIndex++) {
    const region = clip.regions[regionIndex]!
    let lineTop = region.y
    while (lineTop + clip.lineHeight <= region.y + region.height + 0.001) {
      if (clip.maxLines !== undefined && lineIndex >= clip.maxLines) return lines
      const blocked: Interval[] = []
      const bandTop = lineTop
      const bandBottom = lineTop + clip.lineHeight
      for (let obstacleIndex = 0; obstacleIndex < obstacles.length; obstacleIndex++) {
        const obstacle = obstacles[obstacleIndex]!
        const intervals = getObstacleIntervals(obstacle, bandTop, bandBottom)
        for (let intervalIndex = 0; intervalIndex < intervals.length; intervalIndex++) {
          blocked.push(intervals[intervalIndex]!)
        }
      }
      const slots = sortSlots(
        carveTextLineSlots(
          { left: region.x, right: region.x + region.width },
          blocked,
          minSlotWidth,
        ),
        slotOrder,
      )

      if (slots.length === 0) {
        lineTop += clip.lineHeight
        continue
      }

      for (let slotIndex = 0; slotIndex < slots.length; slotIndex++) {
        if (clip.maxLines !== undefined && lineIndex >= clip.maxLines) return lines
        const slot = slots[slotIndex]!
        const line = layoutNextLine(prepared, cursor, slot.right - slot.left)
        if (line === null) return lines
        const reveal = resolveReveal(clip.reveal, time, lineIndex)
        const x = alignLine(slot, line.width, align)
        const y = lineTop + reveal.offsetY
        const frameLine: TextVideoFrameLine = {
          clipId: clip.id,
          text: line.text,
          font: clip.font,
          lineHeight: clip.lineHeight,
          fill: clip.fill,
          width: line.width,
          x,
          y,
          baselineY: y + fontMetrics.baselineInset,
          opacity: clipOpacity * reveal.opacity,
          regionIndex,
          lineIndex,
          slot,
        }
        if (clip.shadow !== undefined) frameLine.shadow = clip.shadow
        if (clip.stroke !== undefined) frameLine.stroke = clip.stroke
        if (clip.lineBox !== undefined) frameLine.lineBox = clip.lineBox
        lines.push(frameLine)
        cursor = line.end
        lineIndex++
      }
      lineTop += clip.lineHeight
    }
  }
  return lines
}

export function composeTextVideoFrame(
  project: TextVideoProject,
  time: number,
  preparedCache: Map<string, PreparedTextWithSegments> = new Map(),
): TextVideoFrame {
  const clampedTime = clamp(time, 0, project.duration)
  const resolvedObstacles: TextVideoResolvedObstacle[] = []
  const obstacleSpecs = project.obstacles ?? []
  for (let index = 0; index < obstacleSpecs.length; index++) {
    const resolved = resolveObstacle(obstacleSpecs[index]!, clampedTime)
    if (resolved !== null) resolvedObstacles.push(resolved)
  }

  const lines: TextVideoFrameLine[] = []
  for (let clipIndex = 0; clipIndex < project.clips.length; clipIndex++) {
    const clip = project.clips[clipIndex]!
    if (!isTimeActive(clip.active, clampedTime)) continue
    const prepared = getPrepared(preparedCache, clip.text, clip.font, clip.whiteSpace)
    const clipLines = composeClipLines(
      clip,
      prepared,
      clampedTime,
      resolveClipObstacles(clip, resolvedObstacles),
    )
    for (let lineIndex = 0; lineIndex < clipLines.length; lineIndex++) {
      const line = clipLines[lineIndex]!
      if (line.opacity <= 0) continue
      lines.push(line)
    }
  }

  const frame: TextVideoFrame = {
    width: project.width,
    height: project.height,
    duration: project.duration,
    fps: project.fps,
    time: clampedTime,
    obstacles: resolvedObstacles,
    lines,
    debug: project.debug ?? false,
  }
  if (project.background !== undefined) frame.background = project.background
  return frame
}

function drawObstacles(context: Canvas2D, obstacles: TextVideoResolvedObstacle[]): void {
  for (let index = 0; index < obstacles.length; index++) {
    const obstacle = obstacles[index]!
    if (obstacle.fill === undefined || obstacle.opacity <= 0) continue
    context.save()
    context.globalAlpha = obstacle.opacity
    withShadow(context, obstacle.shadow)
    if (obstacle.blur > 0) context.filter = `blur(${obstacle.blur}px)`
    context.fillStyle = obstacle.fill
    switch (obstacle.kind) {
      case 'circle':
        context.beginPath()
        context.arc(obstacle.x, obstacle.y, obstacle.radius, 0, Math.PI * 2)
        context.fill()
        break
      case 'rect':
        roundedRectPath(context, obstacle.x, obstacle.y, obstacle.width, obstacle.height, obstacle.cornerRadius)
        context.fill()
        break
    }
    context.restore()
  }
}

function drawLineBox(context: Canvas2D, line: TextVideoFrameLine): void {
  if (line.lineBox === undefined) return
  const paddingX = line.lineBox.paddingX ?? 0
  const paddingY = line.lineBox.paddingY ?? 0
  const baselineInset = getFontMetrics(line.font, line.lineHeight).baselineInset
  const boxTop = line.baselineY - baselineInset - paddingY
  const boxHeight = Math.max(1, line.lineHeight + paddingY * 2)
  context.save()
  context.globalAlpha = line.opacity * (line.lineBox.opacity ?? 1)
  context.fillStyle = line.lineBox.fill
  roundedRectPath(
    context,
    line.x - paddingX,
    boxTop,
    line.width + paddingX * 2,
    boxHeight,
    line.lineBox.radius ?? 0,
  )
  context.fill()
  context.restore()
}

function drawLineText(context: Canvas2D, line: TextVideoFrameLine): void {
  context.save()
  context.globalAlpha = line.opacity
  context.font = line.font
  context.fillStyle = line.fill
  context.textBaseline = 'alphabetic'
  withShadow(context, line.shadow)
  if (line.stroke !== undefined) {
    context.lineWidth = line.stroke.width
    context.strokeStyle = line.stroke.color
    context.strokeText(line.text, line.x, line.baselineY)
  }
  context.fillText(line.text, line.x, line.baselineY)
  context.restore()
}

function drawDebugOverlay(context: Canvas2D, frame: TextVideoFrame): void {
  context.save()
  context.lineWidth = 1
  for (let index = 0; index < frame.lines.length; index++) {
    const line = frame.lines[index]!
    context.strokeStyle = 'rgba(255,255,255,0.12)'
    context.strokeRect(
      line.slot.left,
      line.y,
      line.slot.right - line.slot.left,
      Math.max(1, line.baselineY - line.y + 4),
    )
  }
  context.restore()
}

export function renderTextVideoFrame(context: Canvas2D, frame: TextVideoFrame): void {
  context.save()
  fillBackground(context, frame.width, frame.height, frame.background)
  drawObstacles(context, frame.obstacles)
  for (let index = 0; index < frame.lines.length; index++) drawLineBox(context, frame.lines[index]!)
  for (let index = 0; index < frame.lines.length; index++) drawLineText(context, frame.lines[index]!)
  if (frame.debug) drawDebugOverlay(context, frame)
  context.restore()
}

export class TextVideoEngine {
  #project: TextVideoProject
  #canvas: CanvasTarget | null
  #preparedCache = new Map<string, PreparedTextWithSegments>()

  constructor(project: TextVideoProject, options?: { canvas?: CanvasTarget }) {
    this.#project = project
    this.#canvas = options?.canvas ?? null
  }

  attachCanvas(canvas: CanvasTarget): void {
    this.#canvas = canvas
  }

  setProject(project: TextVideoProject): void {
    this.#project = project
  }

  getProject(): TextVideoProject {
    return this.#project
  }

  clearPreparedCache(): void {
    this.#preparedCache.clear()
  }

  planFrame(time: number): TextVideoFrame {
    return composeTextVideoFrame(this.#project, time, this.#preparedCache)
  }

  renderFrame(time: number, target?: CanvasTarget): TextVideoRenderResult {
    const canvas = target ?? this.#canvas
    if (canvas === null) throw new Error('No target canvas attached to TextVideoEngine')
    sizeCanvas(canvas, this.#project.width, this.#project.height)
    const context = getTargetContext(canvas)
    const start = performance.now()
    const frame = this.planFrame(time)
    renderTextVideoFrame(context, frame)
    const renderMs = performance.now() - start
    return {
      ...frame,
      lineCount: frame.lines.length,
      renderMs,
    }
  }
}

export async function recordTextVideo(options: TextVideoRecordOptions): Promise<Blob> {
  const project = options.engine.getProject()
  if (project.duration <= 0) throw new Error('Text video duration must be greater than zero')
  if (project.fps <= 0) throw new Error('Text video fps must be greater than zero')
  if (typeof MediaRecorder === 'undefined') throw new Error('MediaRecorder is unavailable in this environment')

  options.engine.attachCanvas(options.canvas)
  options.engine.renderFrame(0, options.canvas)

  const stream = options.canvas.captureStream(project.fps)
  const recorderOptions: MediaRecorderOptions = {}
  if (options.mimeType !== undefined && MediaRecorder.isTypeSupported(options.mimeType)) {
    recorderOptions.mimeType = options.mimeType
  }
  if (options.videoBitsPerSecond !== undefined) {
    recorderOptions.videoBitsPerSecond = options.videoBitsPerSecond
  }

  const recorder = new MediaRecorder(stream, recorderOptions)
  const chunks: BlobPart[] = []
  const totalFrames = Math.max(1, Math.round(project.duration * project.fps))

  return await new Promise<Blob>((resolve, reject) => {
    let rafId = 0
    let stopped = false
    const startedAt = performance.now()

    function cleanup(): void {
      if (rafId !== 0) cancelAnimationFrame(rafId)
      const tracks = stream.getTracks()
      for (let index = 0; index < tracks.length; index++) tracks[index]!.stop()
    }

    function finishWithError(error: Event | DOMException): void {
      if (stopped) return
      stopped = true
      cleanup()
      reject(error)
    }

    function step(now: number): void {
      const elapsedMs = now - startedAt
      const time = clamp(elapsedMs / 1000, 0, project.duration)
      options.engine.renderFrame(time, options.canvas)
      const frame = Math.min(totalFrames - 1, Math.floor(time * project.fps))
      options.onProgress?.({ frame, totalFrames, time, duration: project.duration })
      if (time >= project.duration) {
        if (!stopped && recorder.state !== 'inactive') recorder.stop()
        return
      }
      rafId = requestAnimationFrame(step)
    }

    recorder.addEventListener('dataavailable', event => {
      if (event.data.size > 0) chunks.push(event.data)
    })
    recorder.addEventListener('stop', () => {
      if (stopped) return
      stopped = true
      cleanup()
      const type = recorder.mimeType || options.mimeType || 'video/webm'
      resolve(new Blob(chunks, { type }))
    })
    recorder.addEventListener('error', event => {
      finishWithError(event)
    })

    try {
      recorder.start()
      rafId = requestAnimationFrame(step)
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}
