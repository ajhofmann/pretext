import { z } from 'zod'

const easingSchema = z.enum(['linear', 'ease-in', 'ease-out', 'ease-in-out'])

const animatedNumberSchema = z.union([
  z.number(),
  z.object({
    from: z.number(),
    to: z.number(),
    easing: easingSchema.optional(),
  }),
])

const strokeSchema = z.object({
  color: z.string(),
  width: z.number().positive(),
})

const shadowSchema = z.object({
  color: z.string(),
  blur: z.number().min(0).default(0),
  offsetX: z.number().default(0),
  offsetY: z.number().default(0),
  opacity: z.number().min(0).max(1).default(1),
})

const textLayerSchema = z.object({
  type: z.literal('text'),
  id: z.string().min(1),
  start: z.number().min(0).default(0),
  duration: z.number().positive().optional(),
  text: z.string(),
  fontFamily: z.string().min(1),
  fontSize: animatedNumberSchema,
  fontWeight: z.union([z.string(), z.number()]).optional(),
  fontStyle: z.enum(['normal', 'italic', 'oblique']).default('normal'),
  lineHeight: animatedNumberSchema,
  width: animatedNumberSchema,
  x: animatedNumberSchema,
  y: animatedNumberSchema,
  color: z.string().default('#ffffff'),
  opacity: animatedNumberSchema.default(1),
  rotation: animatedNumberSchema.default(0),
  scale: animatedNumberSchema.default(1),
  align: z.enum(['left', 'center', 'right']).default('left'),
  anchorX: z.enum(['left', 'center', 'right']).default('left'),
  whiteSpace: z.enum(['normal', 'pre-wrap']).default('normal'),
  letterSpacing: z.number().default(0),
  maxLines: z.number().int().positive().optional(),
  background: z.string().optional(),
  stroke: strokeSchema.optional(),
  shadow: shadowSchema.optional(),
})

const sceneSchema = z.object({
  id: z.string().min(1),
  start: z.number().min(0),
  duration: z.number().positive(),
  background: z.string().optional(),
  layers: z.array(textLayerSchema).min(1),
})

const fontSchema = z.object({
  family: z.string().min(1),
  src: z.string().optional(),
})

export const textVideoProjectSchema = z.object({
  format: z.literal('pretext-text-video'),
  version: z.literal(1),
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
    background: z.string().default('#0b1020'),
  }),
  fonts: z.array(fontSchema).default([]),
  scenes: z.array(sceneSchema).min(1),
})

export type AnimatedNumber = z.infer<typeof animatedNumberSchema>
export type TextStroke = z.infer<typeof strokeSchema>
export type TextShadow = z.infer<typeof shadowSchema>
export type TextLayer = z.infer<typeof textLayerSchema>
export type TextVideoScene = z.infer<typeof sceneSchema>
export type TextVideoFont = z.infer<typeof fontSchema>
export type TextVideoProject = z.infer<typeof textVideoProjectSchema>
