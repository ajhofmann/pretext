import { z } from 'zod'

export const easingSchema = z.enum([
  'linear',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'step-start',
  'step-end',
])

export const colorStringSchema = z.string().min(1)

const numberKeyframeSchema = z.object({
  time: z.number().min(0),
  value: z.number(),
  easing: easingSchema.optional(),
})

const stringKeyframeSchema = z.object({
  time: z.number().min(0),
  value: z.string(),
  easing: easingSchema.optional(),
})

export const vec2Schema = z.object({
  x: z.number(),
  y: z.number(),
})

const animatedNumberLegacySchema = z.object({
  from: z.number(),
  to: z.number(),
  easing: easingSchema.optional(),
})

const animatedStringLegacySchema = z.object({
  from: z.string(),
  to: z.string(),
  easing: easingSchema.optional(),
})

export const animatedNumberSchema = z.union([
  z.number(),
  animatedNumberLegacySchema,
  z.object({ keyframes: z.array(numberKeyframeSchema).min(1) }),
])

export const animatedStringSchema = z.union([
  z.string(),
  animatedStringLegacySchema,
  z.object({ keyframes: z.array(stringKeyframeSchema).min(1) }),
])

export const strokeSchema = z.object({
  color: colorStringSchema,
  width: z.number().nonnegative(),
  opacity: z.number().min(0).max(1).optional(),
})

export const shadowSchema = z.object({
  color: colorStringSchema,
  blur: z.number().min(0).default(0),
  offsetX: z.number().default(0),
  offsetY: z.number().default(0),
  opacity: z.number().min(0).max(1).default(1),
})

export const paddingSchema = z.object({
  top: z.number().default(0),
  right: z.number().default(0),
  bottom: z.number().default(0),
  left: z.number().default(0),
})

const baseLayerShape = {
  id: z.string().min(1),
  start: z.number().min(0).default(0),
  duration: z.number().positive().optional(),
  x: animatedNumberSchema.default(0),
  y: animatedNumberSchema.default(0),
  opacity: animatedNumberSchema.default(1),
  rotation: animatedNumberSchema.default(0),
  scaleX: animatedNumberSchema.default(1),
  scaleY: animatedNumberSchema.default(1),
}

export const textLayerSchema = z.object({
  ...baseLayerShape,
  type: z.literal('text'),
  text: animatedStringSchema,
  fontFamily: z.string().min(1),
  fontSize: animatedNumberSchema,
  fontWeight: z.union([z.string(), z.number()]).optional(),
  fontStyle: z.enum(['normal', 'italic', 'oblique']).default('normal'),
  lineHeight: animatedNumberSchema,
  width: animatedNumberSchema,
  color: animatedStringSchema.default('#ffffff'),
  align: z.enum(['left', 'center', 'right']).default('left'),
  anchorX: z.enum(['left', 'center', 'right']).default('left'),
  anchorY: z.enum(['top', 'center', 'bottom']).default('top'),
  whiteSpace: z.enum(['normal', 'pre-wrap']).default('normal'),
  letterSpacing: animatedNumberSchema.default(0),
  maxLines: z.number().int().positive().optional(),
  padding: paddingSchema.optional(),
  cornerRadius: z.number().min(0).default(8),
  background: animatedStringSchema.optional(),
  stroke: strokeSchema.optional(),
  shadow: shadowSchema.optional(),
})

export const imageLayerSchema = z.object({
  ...baseLayerShape,
  type: z.literal('image'),
  assetId: z.string().min(1),
  width: animatedNumberSchema,
  height: animatedNumberSchema,
  fit: z.enum(['contain', 'cover', 'stretch']).default('contain'),
  anchorX: z.enum(['left', 'center', 'right']).default('left'),
  anchorY: z.enum(['top', 'center', 'bottom']).default('top'),
  clipRadius: z.number().min(0).default(0),
})

export const asciiVideoLayerSchema = z.object({
  ...baseLayerShape,
  type: z.literal('ascii-video'),
  assetId: z.string().min(1),
  width: animatedNumberSchema,
  height: animatedNumberSchema,
  anchorX: z.enum(['left', 'center', 'right']).default('left'),
  anchorY: z.enum(['top', 'center', 'bottom']).default('top'),
  fit: z.enum(['contain', 'cover', 'stretch']).default('contain'),
  showBackground: z.boolean().default(true),
})

export const rectShapeLayerSchema = z.object({
  ...baseLayerShape,
  type: z.literal('shape'),
  shape: z.literal('rect'),
  width: animatedNumberSchema,
  height: animatedNumberSchema,
  fill: animatedStringSchema.default('#ffffff'),
  radius: z.number().min(0).default(0),
  stroke: strokeSchema.optional(),
})

export const circleShapeLayerSchema = z.object({
  ...baseLayerShape,
  type: z.literal('shape'),
  shape: z.literal('circle'),
  radius: animatedNumberSchema,
  fill: animatedStringSchema.default('#ffffff'),
  stroke: strokeSchema.optional(),
})

export const lineShapeLayerSchema = z.object({
  ...baseLayerShape,
  type: z.literal('shape'),
  shape: z.literal('line'),
  x2: animatedNumberSchema,
  y2: animatedNumberSchema,
  stroke: strokeSchema,
})

export const polygonShapeLayerSchema = z.object({
  ...baseLayerShape,
  type: z.literal('shape'),
  shape: z.literal('polygon'),
  points: z.array(vec2Schema).min(3),
  fill: animatedStringSchema.default('#ffffff'),
  stroke: strokeSchema.optional(),
})

export const shapeLayerSchema = z.discriminatedUnion('shape', [
  rectShapeLayerSchema,
  circleShapeLayerSchema,
  lineShapeLayerSchema,
  polygonShapeLayerSchema,
])

export type TextLayer = z.infer<typeof textLayerSchema>
export type ImageLayer = z.infer<typeof imageLayerSchema>
export type AsciiVideoLayer = z.infer<typeof asciiVideoLayerSchema>
export type ShapeLayer = z.infer<typeof shapeLayerSchema>
export type GroupLayer = {
  id: string
  type: 'group'
  start: number
  duration?: number
  x: z.infer<typeof animatedNumberSchema>
  y: z.infer<typeof animatedNumberSchema>
  opacity: z.infer<typeof animatedNumberSchema>
  rotation: z.infer<typeof animatedNumberSchema>
  scaleX: z.infer<typeof animatedNumberSchema>
  scaleY: z.infer<typeof animatedNumberSchema>
  children: Layer[]
}
export type Layer = TextLayer | ImageLayer | AsciiVideoLayer | ShapeLayer | GroupLayer

export const groupLayerSchema: z.ZodTypeAny = z.lazy(() =>
  z.object({
    ...baseLayerShape,
    type: z.literal('group'),
    children: z.array(layerSchema).min(1),
  }),
)

export const layerSchema: z.ZodTypeAny = z.lazy(() =>
  z.union([textLayerSchema, imageLayerSchema, asciiVideoLayerSchema, shapeLayerSchema, groupLayerSchema]),
)

export const assetSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string().min(1),
    type: z.literal('font'),
    family: z.string().min(1),
    src: z.string().min(1),
    embed: z.boolean().optional(),
    mimeType: z.string().optional(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('image'),
    src: z.string().min(1),
    embed: z.boolean().optional(),
    mimeType: z.string().optional(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('audio'),
    src: z.string().min(1),
    embed: z.boolean().optional(),
    mimeType: z.string().optional(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('ascii-video'),
    src: z.string().min(1),
    embed: z.boolean().optional(),
    mimeType: z.string().optional(),
  }),
])

export const sceneTransitionSchema = z.object({
  type: z.enum([
    'none',
    'fade',
    'wipe-left',
    'wipe-right',
    'slide-left',
    'slide-right',
    'zoom-in',
  ]).default('fade'),
  duration: z.number().min(0).default(0),
  easing: easingSchema.default('ease-in-out'),
})

export const sceneSchema = z.object({
  id: z.string().min(1),
  start: z.number().min(0),
  duration: z.number().positive(),
  background: animatedStringSchema.optional(),
  transitionIn: sceneTransitionSchema.optional(),
  transitionOut: sceneTransitionSchema.optional(),
  layers: z.array(layerSchema).min(1),
})

export const textVideoProjectSchema = z.object({
  format: z.literal('pretext-text-video'),
  version: z.literal(2),
  info: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    author: z.string().optional(),
  }),
  video: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().positive(),
    durationSeconds: z.number().positive(),
    background: colorStringSchema.default('#0b1020'),
  }),
  assets: z.array(assetSchema).default([]),
  scenes: z.array(sceneSchema).min(1),
})

export type Easing = z.infer<typeof easingSchema>
export type Point2D = z.infer<typeof vec2Schema>
export type AnimatedNumber = z.infer<typeof animatedNumberSchema>
export type AnimatedString = z.infer<typeof animatedStringSchema>
export type TextStroke = z.infer<typeof strokeSchema>
export type TextShadow = z.infer<typeof shadowSchema>
export type TextPadding = z.infer<typeof paddingSchema>
export type FontAsset = Extract<z.infer<typeof assetSchema>, { type: 'font' }>
export type ImageAsset = Extract<z.infer<typeof assetSchema>, { type: 'image' }>
export type AudioAsset = Extract<z.infer<typeof assetSchema>, { type: 'audio' }>
export type AsciiVideoAsset = Extract<z.infer<typeof assetSchema>, { type: 'ascii-video' }>
export type TextVideoAsset = z.infer<typeof assetSchema>
export type SceneTransition = z.infer<typeof sceneTransitionSchema>
export type TextVideoScene = z.infer<typeof sceneSchema>
export type TextVideoProject = z.infer<typeof textVideoProjectSchema>
