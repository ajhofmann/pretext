import type { LayoutLine, PreparedTextWithSegments } from '../../src/layout.ts'
import type {
  AnimatedNumber,
  AnimatedString,
  AudioAsset,
  Easing,
  FontAsset,
  GroupLayer,
  ImageAsset,
  ImageLayer,
  Point2D,
  ShapeLayer,
  TextLayer,
  TextVideoAsset,
  TextVideoProject,
} from './schema.ts'

export type PretextModule = Pick<
  typeof import('../../src/layout.ts'),
  'layoutWithLines' | 'prepareWithSegments'
>

export type RenderFrameOptions = {
  scale?: number
}

export type RenderFrameResult = {
  svg: string
  width: number
  height: number
}

export type EmbeddedAssetRecord = {
  id: string
  fileName: string
  mediaType: string
  encoding: 'base64'
  data: string
}

export type TextVideoBundle = {
  format: 'pretext-text-video-bundle'
  version: 2
  project: string
  assets: EmbeddedAssetRecord[]
}

export type DecodedProjectContainer = {
  version: 1 | 2
  project: TextVideoProject
  assets: EmbeddedAssetRecord[]
  bundle: TextVideoBundle | null
}

export type BundleAssetPayload = {
  key: string
  bytes: Uint8Array
  mimeType: string | undefined
  originalPath: string | undefined
}

export type AssetResolutionContext = {
  absoluteProjectPath?: string
  projectPath?: string
  embeddedAssets?: Map<string, BundleAssetPayload>
}

export type AssetContext = {
  projectPath?: string
  embeddedAssets?: Map<string, BundleAssetPayload>
}

export type ResolvedAssetSource =
  | {
      kind: 'filesystem'
      path: string
      mimeType: string | undefined
    }
  | {
      kind: 'embedded'
      key: string
      data: Uint8Array
      mimeType: string | undefined
    }

export type LoadedProject = {
  project: TextVideoProject
  absoluteProjectPath: string
  container: DecodedProjectContainer | null
}

export type RenderedTextBlock = {
  lines: LayoutLine[]
  width: number
  height: number
  renderedWidth: number
}

export type PreparedTextCache = Map<string, { prepared: PreparedTextWithSegments }>

export type ColorValue = AnimatedString
export type NumericValue = AnimatedNumber
export type KeyframeTrack<T> = { keyframes: Array<{ time: number, value: T, easing?: Easing | undefined }> }
export type PointValue = Point2D | KeyframeTrack<Point2D>

export type ParentTransform = {
  parentOpacity?: number
  parentRotation?: number
  parentScaleX?: number
  parentScaleY?: number
  parentOffsetX?: number
  parentOffsetY?: number
}

export type EvaluatedLayerBase = {
  id: string
  type: string
  opacity: number
  rotation: number
  scaleX: number
  scaleY: number
  x: number
  y: number
}

export type EvaluatedTextLayer = EvaluatedLayerBase & {
  type: 'text'
  source: TextLayer
  text: string
  fontFamily: string
  fontSize: number
  fontWeight: string | number | undefined
  fontStyle: 'normal' | 'italic' | 'oblique'
  lineHeight: number
  width: number
  color: string
  align: 'left' | 'center' | 'right'
  anchorX: 'left' | 'center' | 'right'
  anchorY: 'top' | 'center' | 'bottom'
  whiteSpace: 'normal' | 'pre-wrap'
  letterSpacing: number
  maxLines: number | undefined
  padding: { top: number, right: number, bottom: number, left: number }
  cornerRadius: number
  background: string | undefined
  stroke: TextLayer['stroke']
  shadow: TextLayer['shadow']
}

export type EvaluatedImageLayer = EvaluatedLayerBase & {
  type: 'image'
  source: ImageLayer
  assetId: string
  width: number
  height: number
  fit: 'contain' | 'cover' | 'stretch'
  anchorX: 'left' | 'center' | 'right'
  anchorY: 'top' | 'center' | 'bottom'
  clipRadius: number
}

export type EvaluatedRectShapeLayer = EvaluatedLayerBase & {
  type: 'shape'
  source: Extract<ShapeLayer, { shape: 'rect' }>
  shape: 'rect'
  width: number
  height: number
  fill: string
  radius: number
  stroke: Extract<ShapeLayer, { shape: 'rect' }>['stroke']
}

export type EvaluatedCircleShapeLayer = EvaluatedLayerBase & {
  type: 'shape'
  source: Extract<ShapeLayer, { shape: 'circle' }>
  shape: 'circle'
  radius: number
  fill: string
  stroke: Extract<ShapeLayer, { shape: 'circle' }>['stroke']
}

export type EvaluatedLineShapeLayer = EvaluatedLayerBase & {
  type: 'shape'
  source: Extract<ShapeLayer, { shape: 'line' }>
  shape: 'line'
  x2: number
  y2: number
  stroke: Extract<ShapeLayer, { shape: 'line' }>['stroke']
}

export type EvaluatedPolygonShapeLayer = EvaluatedLayerBase & {
  type: 'shape'
  source: Extract<ShapeLayer, { shape: 'polygon' }>
  shape: 'polygon'
  points: Point2D[]
  fill: string
  stroke: Extract<ShapeLayer, { shape: 'polygon' }>['stroke']
}

export type EvaluatedShapeLayer =
  | EvaluatedRectShapeLayer
  | EvaluatedCircleShapeLayer
  | EvaluatedLineShapeLayer
  | EvaluatedPolygonShapeLayer

export type EvaluatedGroupLayer = EvaluatedLayerBase & {
  type: 'group'
  source: GroupLayer
  children: EvaluatedLayer[]
}

export type EvaluatedLayer =
  | EvaluatedTextLayer
  | EvaluatedImageLayer
  | EvaluatedShapeLayer
  | EvaluatedGroupLayer

export type ActiveScene = {
  scene: TextVideoProject['scenes'][number]
  progress: number
  localTimeSeconds: number
}

export type SceneRenderState = {
  scene: TextVideoProject['scenes'][number]
  sceneTime: number
  transitionInProgress: number
  background: string
}

export type TextVideoProjectLike = TextVideoProject
export type FontAssetLike = FontAsset
export type ImageAssetLike = ImageAsset
export type AudioAssetLike = AudioAsset
export type TextVideoAssetLike = TextVideoAsset
