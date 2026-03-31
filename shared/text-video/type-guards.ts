import type { Layer } from './schema.ts'
import type {
  EvaluatedGroupLayer,
  EvaluatedImageLayer,
  EvaluatedLayer,
  EvaluatedShapeLayer,
  EvaluatedTextLayer,
} from './types.ts'

type TypeCarrier = { type: unknown }

export function isTextLayer(layer: Layer): layer is Extract<Layer, { type: 'text' }> {
  return (layer as TypeCarrier).type === 'text'
}

export function isImageLayer(layer: Layer): layer is Extract<Layer, { type: 'image' }> {
  return (layer as TypeCarrier).type === 'image'
}

export function isAsciiVideoLayer(layer: Layer): layer is Extract<Layer, { type: 'ascii-video' }> {
  return (layer as TypeCarrier).type === 'ascii-video'
}

export function isShapeLayer(layer: Layer): layer is Extract<Layer, { type: 'shape' }> {
  return (layer as TypeCarrier).type === 'shape'
}

export function isGroupLayer(layer: Layer): layer is Extract<Layer, { type: 'group' }> {
  return (layer as TypeCarrier).type === 'group'
}

export function isEvaluatedTextLayer(layer: EvaluatedLayer): layer is EvaluatedTextLayer {
  return (layer as TypeCarrier).type === 'text'
}

export function isEvaluatedImageLayer(layer: EvaluatedLayer): layer is EvaluatedImageLayer {
  return (layer as TypeCarrier).type === 'image'
}

export function isEvaluatedAsciiVideoLayer(layer: EvaluatedLayer): layer is import('./types.ts').EvaluatedAsciiVideoLayer {
  return (layer as TypeCarrier).type === 'ascii-video'
}

export function isEvaluatedShapeLayer(layer: EvaluatedLayer): layer is EvaluatedShapeLayer {
  return (layer as TypeCarrier).type === 'shape'
}

export function isEvaluatedGroupLayer(layer: EvaluatedLayer): layer is EvaluatedGroupLayer {
  return (layer as TypeCarrier).type === 'group'
}
