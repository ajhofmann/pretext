import { evaluateColorValue, evaluateNumericValue } from './animation.ts'
import type {
  GroupLayer,
  ImageLayer,
  Layer,
  SceneTransition,
  ShapeLayer,
  TextLayer,
  TextPadding,
  TextVideoProject,
  TextVideoScene,
} from './schema.ts'
import { isImageLayer, isShapeLayer, isTextLayer } from './type-guards.ts'
import type {
  ActiveScene,
  EvaluatedImageLayer,
  EvaluatedLayer,
  EvaluatedLayerBase,
  EvaluatedShapeLayer,
  EvaluatedTextLayer,
  ParentTransform,
  SceneRenderState,
} from './types.ts'

const DEFAULT_PADDING: TextPadding = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
}

function clamp01(value: number): number {
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

function isLayerActive(layer: Layer, sceneStart: number, timeSeconds: number): boolean {
  const start = sceneStart + layer.start
  const end = start + (layer.duration ?? Number.POSITIVE_INFINITY)
  return timeSeconds >= start && timeSeconds < end
}

function getLayerEvaluationTime(layer: Layer, sceneStart: number, timeSeconds: number): number {
  const localTime = timeSeconds - sceneStart
  if (layer.duration === undefined) return localTime
  const layerStart = sceneStart + layer.start
  const progress = clamp01((timeSeconds - layerStart) / layer.duration)
  return progress * layer.duration
}

function mergeTransforms(parent: ParentTransform, child: EvaluatedLayerBase): EvaluatedLayerBase {
  return {
    ...child,
    x: (parent.parentOffsetX ?? 0) + child.x,
    y: (parent.parentOffsetY ?? 0) + child.y,
    opacity: (parent.parentOpacity ?? 1) * child.opacity,
    rotation: (parent.parentRotation ?? 0) + child.rotation,
    scaleX: (parent.parentScaleX ?? 1) * child.scaleX,
    scaleY: (parent.parentScaleY ?? 1) * child.scaleY,
  }
}

function evaluateBaseTransform(
  layer: TextLayer | ImageLayer | ShapeLayer | GroupLayer,
  sceneStart: number,
  timeSeconds: number,
): EvaluatedLayerBase {
  const evaluationTime = getLayerEvaluationTime(layer, sceneStart, timeSeconds)
  return {
    id: layer.id,
    type: layer.type,
    x: evaluateNumericValue(layer.x, evaluationTime),
    y: evaluateNumericValue(layer.y, evaluationTime),
    opacity: evaluateNumericValue(layer.opacity, evaluationTime),
    rotation: evaluateNumericValue(layer.rotation, evaluationTime),
    scaleX: evaluateNumericValue(layer.scaleX, evaluationTime),
    scaleY: evaluateNumericValue(layer.scaleY, evaluationTime),
  }
}

function evaluateTextLayer(layer: TextLayer, sceneStart: number, timeSeconds: number): EvaluatedTextLayer {
  const base = evaluateBaseTransform(layer, sceneStart, timeSeconds)
  const evaluationTime = getLayerEvaluationTime(layer, sceneStart, timeSeconds)
  return {
    ...base,
    type: 'text',
    source: layer,
    text: evaluateColorValue(layer.text, evaluationTime),
    fontFamily: layer.fontFamily,
    fontSize: evaluateNumericValue(layer.fontSize, evaluationTime),
    fontWeight: layer.fontWeight,
    fontStyle: layer.fontStyle,
    lineHeight: evaluateNumericValue(layer.lineHeight, evaluationTime),
    width: evaluateNumericValue(layer.width, evaluationTime),
    color: evaluateColorValue(layer.color, evaluationTime),
    align: layer.align,
    anchorX: layer.anchorX,
    anchorY: layer.anchorY,
    whiteSpace: layer.whiteSpace,
    letterSpacing: evaluateNumericValue(layer.letterSpacing, evaluationTime),
    maxLines: layer.maxLines,
    padding: layer.padding ?? DEFAULT_PADDING,
    cornerRadius: layer.cornerRadius,
    background: layer.background === undefined ? undefined : evaluateColorValue(layer.background, evaluationTime),
    stroke: layer.stroke,
    shadow: layer.shadow,
  }
}

function evaluateImageLayer(layer: ImageLayer, sceneStart: number, timeSeconds: number): EvaluatedImageLayer {
  const base = evaluateBaseTransform(layer, sceneStart, timeSeconds)
  const evaluationTime = getLayerEvaluationTime(layer, sceneStart, timeSeconds)
  return {
    ...base,
    type: 'image',
    source: layer,
    assetId: layer.assetId,
    width: evaluateNumericValue(layer.width, evaluationTime),
    height: evaluateNumericValue(layer.height, evaluationTime),
    fit: layer.fit,
    anchorX: layer.anchorX,
    anchorY: layer.anchorY,
    clipRadius: layer.clipRadius,
  }
}

function evaluateShapeLayer(layer: ShapeLayer, sceneStart: number, timeSeconds: number): EvaluatedShapeLayer {
  const base = evaluateBaseTransform(layer, sceneStart, timeSeconds)
  const evaluationTime = getLayerEvaluationTime(layer, sceneStart, timeSeconds)

  if (layer.shape === 'rect') {
    return {
      ...base,
      type: 'shape',
      source: layer,
      shape: 'rect',
      width: evaluateNumericValue(layer.width, evaluationTime),
      height: evaluateNumericValue(layer.height, evaluationTime),
      fill: evaluateColorValue(layer.fill, evaluationTime),
      radius: layer.radius,
      stroke: layer.stroke,
    }
  }
  if (layer.shape === 'circle') {
    return {
      ...base,
      type: 'shape',
      source: layer,
      shape: 'circle',
      radius: evaluateNumericValue(layer.radius, evaluationTime),
      fill: evaluateColorValue(layer.fill, evaluationTime),
      stroke: layer.stroke,
    }
  }
  if (layer.shape === 'line') {
    return {
      ...base,
      type: 'shape',
      source: layer,
      shape: 'line',
      x2: evaluateNumericValue(layer.x2, evaluationTime),
      y2: evaluateNumericValue(layer.y2, evaluationTime),
      stroke: layer.stroke,
    }
  }
  return {
    ...base,
    type: 'shape',
    source: layer,
    shape: 'polygon',
    points: layer.points,
    fill: evaluateColorValue(layer.fill, evaluationTime),
    stroke: layer.stroke,
  }
}

export function evaluateLayerForRender(
  layer: Layer,
  sceneTimeSeconds: number,
  parent: ParentTransform = {},
): EvaluatedLayer {
  if (isTextLayer(layer)) {
    return mergeTransforms(parent, evaluateTextLayer(layer, 0, sceneTimeSeconds)) as EvaluatedTextLayer
  }
  if (isImageLayer(layer)) {
    return mergeTransforms(parent, evaluateImageLayer(layer, 0, sceneTimeSeconds)) as EvaluatedImageLayer
  }
  if (isShapeLayer(layer)) {
    return mergeTransforms(parent, evaluateShapeLayer(layer, 0, sceneTimeSeconds)) as EvaluatedShapeLayer
  }

  const groupLayer = layer as GroupLayer
  const mergedBase = mergeTransforms(parent, evaluateBaseTransform(groupLayer, 0, sceneTimeSeconds))
  const children: EvaluatedLayer[] = []
  for (let index = 0; index < groupLayer.children.length; index++) {
    const child = groupLayer.children[index]!
    if (!isLayerVisibleAtSceneTime(child, sceneTimeSeconds)) continue
    children.push(
      evaluateLayerForRender(child, sceneTimeSeconds, {
        parentOpacity: mergedBase.opacity,
        parentRotation: mergedBase.rotation,
        parentScaleX: mergedBase.scaleX,
        parentScaleY: mergedBase.scaleY,
        parentOffsetX: mergedBase.x,
        parentOffsetY: mergedBase.y,
      }),
    )
  }
  return {
    ...mergedBase,
    type: 'group',
    source: groupLayer,
    children,
  }
}

export function isLayerVisibleAtSceneTime(layer: Layer, sceneTimeSeconds: number): boolean {
  return isLayerActive(layer, 0, sceneTimeSeconds)
}

export function getActiveScene(project: TextVideoProject, timeSeconds: number): ActiveScene | null {
  const scene = project.scenes.find(candidate => (
    timeSeconds >= candidate.start && timeSeconds < candidate.start + candidate.duration
  ))
  if (scene === undefined) return null
  const localTimeSeconds = timeSeconds - scene.start
  return {
    scene,
    progress: clamp01(localTimeSeconds / scene.duration),
    localTimeSeconds,
  }
}

export function getSceneProgress(scene: TextVideoScene, timeSeconds: number): number {
  return clamp01((timeSeconds - scene.start) / scene.duration)
}

export function evaluateSceneBackground(scene: TextVideoScene, timeSeconds: number): string | undefined {
  if (scene.background === undefined) return undefined
  return evaluateColorValue(scene.background, timeSeconds - scene.start)
}

export function evaluateSceneLayers(scene: TextVideoScene, timeSeconds: number): EvaluatedLayer[] {
  const evaluated: EvaluatedLayer[] = []
  for (let index = 0; index < scene.layers.length; index++) {
    const layer = scene.layers[index] as Layer
    if (!isLayerActive(layer, scene.start, timeSeconds)) continue
    evaluated.push(evaluateLayerForRender(layer, timeSeconds - scene.start))
  }
  return evaluated
}

export function getSceneBackground(
  scene: TextVideoScene,
  project: TextVideoProject,
  timeSeconds: number,
): string {
  return evaluateSceneBackground(scene, timeSeconds) ?? project.video.background
}

export function getTransitionProgress(
  transition: SceneTransition | undefined,
  scene: TextVideoScene,
  timeSeconds: number,
): number | null {
  if (transition === undefined || transition.duration <= 0 || transition.type === 'none') return null
  const elapsed = timeSeconds - scene.start
  if (elapsed < 0 || elapsed > transition.duration) return null
  return clamp01(elapsed / transition.duration)
}

export function evaluateProjectSceneState(
  project: TextVideoProject,
  timeSeconds: number,
): SceneRenderState | null {
  const active = getActiveScene(project, timeSeconds)
  if (active === null) return null
  const transitionInProgress = getTransitionProgress(active.scene.transitionIn, active.scene, timeSeconds)
  return {
    scene: active.scene,
    sceneTime: active.localTimeSeconds,
    transitionInProgress: transitionInProgress ?? 0,
    background: getSceneBackground(active.scene, project, timeSeconds),
  }
}
