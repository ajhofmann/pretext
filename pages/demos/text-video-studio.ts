import { createSampleProject } from '../../shared/text-video/sample.ts'
import type { TextVideoProject } from '../../shared/text-video/schema.ts'
import type { Layer } from '../../shared/text-video/schema.ts'
import openaiSvg from '../assets/openai-symbol.svg'
import claudeSvg from '../assets/claude-symbol.svg'

function getRequiredElement<T extends HTMLElement>(id: string, ctor: { new(): T }): T {
  const element = document.getElementById(id)
  if (!(element instanceof ctor)) throw new Error(`#${id} not found`)
  return element
}

const previewHost = getRequiredElement('preview', HTMLDivElement)
const playPauseButton = getRequiredElement('play-pause', HTMLButtonElement)
const scrubber = getRequiredElement('scrubber', HTMLInputElement)
const timeLabel = getRequiredElement('time-label', HTMLSpanElement)
const sceneSelect = getRequiredElement('scene-select', HTMLSelectElement)
const layerSelect = getRequiredElement('layer-select', HTMLSelectElement)
const layerMeta = getRequiredElement('layer-meta', HTMLPreElement)
const textInput = getRequiredElement('text-input', HTMLTextAreaElement)
const colorInput = getRequiredElement('color-input', HTMLInputElement)
const xInput = getRequiredElement('x-input', HTMLInputElement)
const yInput = getRequiredElement('y-input', HTMLInputElement)
const widthInput = getRequiredElement('width-input', HTMLInputElement)
const opacityInput = getRequiredElement('opacity-input', HTMLInputElement)
const resetButton = getRequiredElement('reset-project', HTMLButtonElement)

const assetUrlMap: Record<string, string> = {
  'openai-mark': openaiSvg,
  'claude-mark': claudeSvg,
}
const baseProject = createSampleProject()
for (const asset of baseProject.assets) {
  if (asset.type === 'image' && asset.id in assetUrlMap) {
    ;(asset as { src: string }).src = assetUrlMap[asset.id]!
  }
}
let project: TextVideoProject = structuredClone(baseProject)
let currentTime = 0
let isPlaying = false
let lastFrameAt = 0

function flattenLayers(layers: Layer[], out: Layer[] = []): Layer[] {
  for (let index = 0; index < layers.length; index++) {
    const layer = layers[index]!
    out.push(layer)
    if (layer.type === 'group') flattenLayers(layer.children as Layer[], out)
  }
  return out
}

function getCurrentScene() {
  return project.scenes.find(scene => currentTime >= scene.start && currentTime < scene.start + scene.duration) ?? project.scenes[0]!
}

function getEditableLayer(): Layer | null {
  const scene = getCurrentScene()
  const layers = flattenLayers(scene.layers as Layer[])
  const layerId = layerSelect.value
  return layers.find(layer => layer.id === layerId) ?? null
}

function setAnimatedNumber(target: { [key: string]: unknown }, key: string, value: number): void {
  target[key] = value
}

function setAnimatedString(target: { [key: string]: unknown }, key: string, value: string): void {
  target[key] = value
}

function updateSceneSelect(): void {
  sceneSelect.replaceChildren()
  for (let index = 0; index < project.scenes.length; index++) {
    const scene = project.scenes[index]!
    const option = document.createElement('option')
    option.value = scene.id
    option.textContent = `${scene.id} (${scene.start.toFixed(1)}s)`
    if (scene === getCurrentScene()) option.selected = true
    sceneSelect.appendChild(option)
  }
}

function updateLayerSelect(): void {
  const scene = getCurrentScene()
  layerSelect.replaceChildren()
  const layers = flattenLayers(scene.layers as Layer[])
  for (let index = 0; index < layers.length; index++) {
    const layer = layers[index]!
    const option = document.createElement('option')
    option.value = layer.id
    option.textContent = `${layer.type}:${layer.id}`
    layerSelect.appendChild(option)
  }
}

function syncEditorFields(): void {
  const layer = getEditableLayer()
  if (layer === null) {
    layerMeta.textContent = 'No editable layer selected.'
    return
  }
  layerMeta.textContent = JSON.stringify(layer, null, 2)
  if (layer.type === 'text') {
    textInput.value = typeof layer.text === 'string' ? layer.text : JSON.stringify(layer.text)
    colorInput.value = typeof layer.color === 'string' && layer.color.startsWith('#') ? layer.color : '#ffffff'
    widthInput.value = String(typeof layer.width === 'number' ? layer.width : ('from' in layer.width ? layer.width.from : layer.width.keyframes[0]!.value))
  } else {
    textInput.value = ''
    colorInput.value = '#ffffff'
    widthInput.value = layer.type === 'image'
      ? String(typeof layer.width === 'number' ? layer.width : ('from' in layer.width ? layer.width.from : layer.width.keyframes[0]!.value))
      : ''
  }
  xInput.value = String(typeof layer.x === 'number' ? layer.x : ('from' in layer.x ? layer.x.from : layer.x.keyframes[0]!.value))
  yInput.value = String(typeof layer.y === 'number' ? layer.y : ('from' in layer.y ? layer.y.from : layer.y.keyframes[0]!.value))
  opacityInput.value = String(typeof layer.opacity === 'number' ? layer.opacity : ('from' in layer.opacity ? layer.opacity.from : layer.opacity.keyframes[0]!.value))
}

async function renderPreview(): Promise<void> {
  const { renderFrameSvgBrowser } = await import('../../shared/text-video/render-browser.ts')
  const svg = await renderFrameSvgBrowser(project, currentTime)
  previewHost.replaceChildren()
  const img = document.createElement('img')
  img.alt = 'text video preview'
  img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`
  previewHost.appendChild(img)
  timeLabel.textContent = `${currentTime.toFixed(2)}s / ${project.video.durationSeconds.toFixed(2)}s`
  scrubber.value = String(currentTime)
  updateSceneSelect()
  updateLayerSelect()
  syncEditorFields()
}

function mutateSelectedLayer(mutator: (layer: Layer) => void): void {
  const layer = getEditableLayer()
  if (layer === null) return
  mutator(layer)
  void renderPreview()
}

playPauseButton.addEventListener('click', () => {
  isPlaying = !isPlaying
  playPauseButton.textContent = isPlaying ? 'Pause' : 'Play'
  if (isPlaying) requestAnimationFrame(tick)
})

scrubber.max = String(project.video.durationSeconds)
scrubber.step = '0.01'
scrubber.addEventListener('input', () => {
  currentTime = Number.parseFloat(scrubber.value)
  void renderPreview()
})

sceneSelect.addEventListener('change', () => {
  const scene = project.scenes.find(candidate => candidate.id === sceneSelect.value)
  if (scene !== undefined) {
    currentTime = scene.start
    void renderPreview()
  }
})

layerSelect.addEventListener('change', () => {
  syncEditorFields()
})

textInput.addEventListener('change', () => {
  mutateSelectedLayer(layer => {
    if (layer.type !== 'text') return
    setAnimatedString(layer as unknown as Record<string, unknown>, 'text', textInput.value)
  })
})

colorInput.addEventListener('input', () => {
  mutateSelectedLayer(layer => {
    if (layer.type !== 'text' && layer.type !== 'shape') return
    const record = layer as unknown as Record<string, unknown>
    if (layer.type === 'text') setAnimatedString(record, 'color', colorInput.value)
    if (layer.type === 'shape' && 'fill' in record) setAnimatedString(record, 'fill', colorInput.value)
  })
})

xInput.addEventListener('change', () => {
  mutateSelectedLayer(layer => {
    setAnimatedNumber(layer as unknown as Record<string, unknown>, 'x', Number.parseFloat(xInput.value))
  })
})

yInput.addEventListener('change', () => {
  mutateSelectedLayer(layer => {
    setAnimatedNumber(layer as unknown as Record<string, unknown>, 'y', Number.parseFloat(yInput.value))
  })
})

widthInput.addEventListener('change', () => {
  mutateSelectedLayer(layer => {
    if (layer.type !== 'text' && layer.type !== 'image' && !(layer.type === 'shape' && layer.shape === 'rect')) return
    setAnimatedNumber(layer as unknown as Record<string, unknown>, 'width', Number.parseFloat(widthInput.value))
  })
})

opacityInput.addEventListener('change', () => {
  mutateSelectedLayer(layer => {
    setAnimatedNumber(layer as unknown as Record<string, unknown>, 'opacity', Number.parseFloat(opacityInput.value))
  })
})

resetButton.addEventListener('click', () => {
  project = structuredClone(baseProject)
  currentTime = 0
  isPlaying = false
  playPauseButton.textContent = 'Play'
  void renderPreview()
})

function tick(now: number): void {
  if (!isPlaying) return
  if (lastFrameAt === 0) lastFrameAt = now
  const delta = (now - lastFrameAt) / 1000
  lastFrameAt = now
  currentTime += delta
  if (currentTime >= project.video.durationSeconds) {
    currentTime = 0
  }
  void renderPreview()
  requestAnimationFrame(tick)
}

void renderPreview()
