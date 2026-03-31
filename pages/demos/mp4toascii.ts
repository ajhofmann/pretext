import { buildConfigFromArgs, spatialRuntimeFromConfig } from '../../shared/mp4toascii/config.ts'
import { mapFrameMono } from '../../shared/mp4toascii/ascii-map.ts'
import {
  parseDescriptionJson,
  parseSrt,
  parseVtt,
  selectContentText,
} from '../../shared/mp4toascii/content-browser.ts'
import { fuseFrameWithPalette, fuseFrameWithRoutedText } from '../../shared/mp4toascii/fusion.ts'
import {
  createRichFrameHtmlData,
  mountAsciiHtmlPlayer,
  type SerializedFrame,
} from '../../shared/mp4toascii/html-player.ts'
import { buildGlyphPalette, measureGlyphWidthFromPretext } from '../../shared/mp4toascii/palette.ts'
import { MP4TOASCII_PRESETS } from '../../shared/mp4toascii/presets.ts'
import type { ContentCue, FramePixels, Mp4ToAsciiConfig, RichFrame } from '../../shared/mp4toascii/types.ts'
import { encodeAsciiVideoAssetData, frameToAsciiVideoData } from '../../shared/text-video/ascii-video.ts'
import { prepareWithSegments } from '../../src/layout.ts'

function requireElement<T extends HTMLElement>(id: string, ctor: { new(): T }): T {
  const element = document.getElementById(id)
  if (!(element instanceof ctor)) throw new Error(`#${id} not found`)
  return element
}

const videoInput = requireElement('video-input', HTMLInputElement)
const subtitleInput = requireElement('subtitle-input', HTMLInputElement)
const presetGrid = requireElement('preset-grid', HTMLDivElement)
const modeSelect = requireElement('mode-select', HTMLSelectElement)
const layoutSelect = requireElement('layout-select', HTMLSelectElement)
const colsInput = requireElement('cols-input', HTMLInputElement)
const fontSizeInput = requireElement('font-size-input', HTMLInputElement)
const ditherSelect = requireElement('dither-select', HTMLSelectElement)
const smoothingInput = requireElement('smoothing-input', HTMLInputElement)
const stabilityInput = requireElement('stability-input', HTMLInputElement)
const scrollStepInput = requireElement('scroll-step-input', HTMLInputElement)
const edgeBiasInput = requireElement('edge-bias-input', HTMLInputElement)
const silhouetteThresholdInput = requireElement('silhouette-threshold-input', HTMLInputElement)
const maskTextInput = requireElement('mask-text-input', HTMLTextAreaElement)
const renderButton = requireElement('render-button', HTMLButtonElement)
const playButton = requireElement('play-button', HTMLButtonElement)
const stepButton = requireElement('step-button', HTMLButtonElement)
const exportHtmlButton = requireElement('export-html', HTMLButtonElement)
const exportAscvButton = requireElement('export-ascv', HTMLButtonElement)
const exportPtxvButton = requireElement('export-ptxv', HTMLButtonElement)
const statusNode = requireElement('status', HTMLParagraphElement)
const videoMetaNode = requireElement('video-meta', HTMLDivElement)
const previewMetaNode = requireElement('preview-meta', HTMLDivElement)
const sourceVideo = requireElement('source-video', HTMLVideoElement)
const sourceCanvas = requireElement('source-canvas', HTMLCanvasElement)
const asciiStage = requireElement('ascii-stage', HTMLDivElement)

const sourceContext = sourceCanvas.getContext('2d')
if (sourceContext === null) throw new Error('source canvas context unavailable')

let currentVideoFile: File | null = null
let currentCueFile: File | null = null
let currentConfig: Mp4ToAsciiConfig | null = null
let currentRichFrames: RichFrame[] = []
let currentSerializedFrames: SerializedFrame[] = []
let currentFrameIndex = 0
let currentBitmaps: ImageBitmap[] = []

for (let index = 0; index < MP4TOASCII_PRESETS.length; index++) {
  const preset = MP4TOASCII_PRESETS[index]!
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'preset-card'
  button.dataset['presetId'] = preset.id
  const title = document.createElement('strong')
  title.textContent = preset.label
  const description = document.createElement('span')
  description.textContent = preset.description
  button.append(title, description)
  button.addEventListener('click', () => {
    applyPresetToControls(preset.id)
    void rebuildPreview()
  })
  presetGrid.appendChild(button)
}

function setStatus(message: string): void {
  statusNode.textContent = message
}

function updatePresetSelection(presetId: string | null): void {
  const cards = presetGrid.querySelectorAll<HTMLButtonElement>('.preset-card')
  for (let index = 0; index < cards.length; index++) {
    const card = cards[index]!
    card.classList.toggle('active', card.dataset['presetId'] === presetId)
  }
}

function applyPresetToControls(presetId: string): void {
  const preset = MP4TOASCII_PRESETS.find(entry => entry.id === presetId)
  if (preset === undefined) return
  modeSelect.value = preset.mode
  layoutSelect.value = preset.layout
  if (preset.overrides.palette?.dither !== undefined) ditherSelect.value = preset.overrides.palette.dither
  if (preset.overrides.temporal?.smoothing !== undefined) smoothingInput.value = String(preset.overrides.temporal.smoothing)
  if (preset.overrides.temporal?.stability !== undefined) stabilityInput.value = String(preset.overrides.temporal.stability)
  if (preset.overrides.temporal?.scrollStep !== undefined) scrollStepInput.value = String(preset.overrides.temporal.scrollStep)
  if (preset.overrides.palette?.edgeBias !== undefined) edgeBiasInput.value = String(preset.overrides.palette.edgeBias)
  if (preset.overrides.spatial?.silhouetteThreshold !== undefined) silhouetteThresholdInput.value = String(preset.overrides.spatial.silhouetteThreshold)
  updatePresetSelection(presetId)
}

async function readCueFile(file: File): Promise<ContentCue[]> {
  const contents = await file.text()
  if (file.name.toLowerCase().endsWith('.json')) return parseDescriptionJson(contents)
  if (file.name.toLowerCase().endsWith('.vtt') || contents.trimStart().startsWith('WEBVTT')) return parseVtt(contents)
  return parseSrt(contents)
}

function buildConfig(width: number, height: number): Mp4ToAsciiConfig {
  const presetId = presetGrid.querySelector<HTMLButtonElement>('.preset-card.active')?.dataset['presetId'] ?? ''
  const config = buildConfigFromArgs({
    preset: presetId,
    mode: modeSelect.value,
    layout: layoutSelect.value,
    cols: colsInput.value,
    fps: '10',
    'font-size': fontSizeInput.value,
    dither: ditherSelect.value,
    smoothing: smoothingInput.value,
    stability: stabilityInput.value,
    'scroll-step': scrollStepInput.value,
    'edge-bias': edgeBiasInput.value,
    'silhouette-threshold': silhouetteThresholdInput.value,
    'mask-text': maskTextInput.value,
    text: maskTextInput.value,
  }, {
    width,
    height,
    fps: 10,
  })
  config.content.text = maskTextInput.value
  return config
}

function drawSource(bitmap: CanvasImageSource): void {
  const width = (bitmap as { width?: number }).width ?? sourceCanvas.width
  const height = (bitmap as { height?: number }).height ?? sourceCanvas.height
  sourceCanvas.width = width
  sourceCanvas.height = height
  if (sourceContext === null) throw new Error('source canvas context unavailable')
  sourceContext.clearRect(0, 0, width, height)
  sourceContext.drawImage(bitmap, 0, 0, width, height)
}

function framePixelsFromContext(width: number, height: number): FramePixels {
  if (sourceContext === null) throw new Error('source canvas context unavailable')
  const imageData = sourceContext.getImageData(0, 0, width, height)
  const rgba = imageData.data
  const grayscale = new Uint8Array(width * height)
  const rgb = new Uint8Array(width * height * 3)
  for (let index = 0; index < width * height; index++) {
    const r = rgba[index * 4]!
    const g = rgba[index * 4 + 1]!
    const b = rgba[index * 4 + 2]!
    grayscale[index] = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
    rgb[index * 3] = r
    rgb[index * 3 + 1] = g
    rgb[index * 3 + 2] = b
  }
  return { width, height, grayscale, rgb }
}

async function loadPreviewFrames(file: File, width: number, height: number, count: number): Promise<ImageBitmap[]> {
  const url = URL.createObjectURL(file)
  try {
    sourceVideo.src = url
    sourceVideo.classList.remove('hidden')
    await new Promise<void>((resolve, reject) => {
      sourceVideo.onloadedmetadata = () => resolve()
      sourceVideo.onerror = () => reject(new Error('Failed to load the selected video.'))
    })

    const duration = Math.max(sourceVideo.duration || 1, 1)
    const frames: ImageBitmap[] = []
    for (let index = 0; index < count; index++) {
      const time = Math.min(duration - 0.001, (duration * index) / Math.max(1, count))
      sourceVideo.currentTime = time
      await new Promise<void>(resolve => {
        sourceVideo.onseeked = () => resolve()
      })
      sourceCanvas.width = width
      sourceCanvas.height = height
      if (sourceContext === null) throw new Error('source canvas context unavailable')
      sourceContext.clearRect(0, 0, width, height)
      sourceContext.drawImage(sourceVideo, 0, 0, width, height)
      frames.push(await createImageBitmap(sourceCanvas))
    }
    videoMetaNode.textContent = `${file.name} — ${sourceVideo.videoWidth}×${sourceVideo.videoHeight} — ${duration.toFixed(2)}s`
    return frames
  } finally {
    URL.revokeObjectURL(url)
  }
}

function mountPreviewPlayer(frames: SerializedFrame[], color: boolean): void {
  asciiStage.replaceChildren()

  const display = document.createElement('div')
  display.id = 'preview-display'
  asciiStage.appendChild(display)

  const controls = document.createElement('div')
  controls.style.display = 'grid'
  controls.style.gap = '8px'
  controls.style.width = '100%'
  controls.style.marginTop = '12px'

  const scrubber = document.createElement('input')
  scrubber.id = 'preview-scrubber'
  scrubber.type = 'range'
  scrubber.min = '0'
  scrubber.max = String(Math.max(0, frames.length - 1))
  scrubber.value = '0'
  scrubber.step = '1'

  const counter = document.createElement('span')
  counter.id = 'preview-counter'
  counter.className = 'meta'

  const play = document.createElement('button')
  play.id = 'preview-play'
  play.type = 'button'
  play.className = 'secondary'
  play.textContent = 'Play'

  const reset = document.createElement('button')
  reset.id = 'preview-reset'
  reset.type = 'button'
  reset.className = 'secondary'
  reset.textContent = 'Reset'

  const buttonRow = document.createElement('div')
  buttonRow.className = 'button-row'
  buttonRow.append(play, reset)

  controls.append(scrubber, counter, buttonRow)
  asciiStage.appendChild(controls)

  mountAsciiHtmlPlayer({
    fps: 10,
    color,
    frames,
    displayId: 'preview-display',
    scrubberId: 'preview-scrubber',
    counterId: 'preview-counter',
    playButtonId: 'preview-play',
    resetButtonId: 'preview-reset',
  })
}

async function rebuildPreview(): Promise<void> {
  if (currentVideoFile === null) {
    setStatus('Select a video to begin.')
    return
  }

  try {
    setStatus('Building preview…')
    currentBitmaps = await loadPreviewFrames(currentVideoFile, 176, 96, 8)
    if (currentBitmaps.length === 0) {
      setStatus('No preview frames could be decoded from the selected video.')
      return
    }

    drawSource(currentBitmaps[0]!)
    const config = buildConfig(currentBitmaps[0]!.width, currentBitmaps[0]!.height)
    if (currentCueFile !== null) {
      const cues = await readCueFile(currentCueFile)
      if (currentCueFile.name.toLowerCase().endsWith('.json')) {
        config.content.descriptions = cues
      } else {
        config.content.cues = cues
      }
    } else {
      config.content.cues = []
      config.content.descriptions = []
    }

    const framePixels = currentBitmaps.map(bitmap => {
      drawSource(bitmap)
      return framePixelsFromContext(bitmap.width, bitmap.height)
    })

    const richFrames: RichFrame[] = []
    if (config.mode !== 'mono') {
      const palette = buildGlyphPalette(config.palette, (char, font) => measureGlyphWidthFromPretext(prepareWithSegments, char, font))
      const pretext = await import('../../src/layout.ts')
      let previousFrame: RichFrame | null = null
      let previousPixels: FramePixels | null = null

      for (let index = 0; index < framePixels.length; index++) {
        const frame = framePixels[index]!
        const selection = selectContentText(config.content, index / config.fps, index, previousFrame?.metadata?.cut ?? false)
        const richOptions: Parameters<typeof fuseFrameWithPalette>[2] = {
          text: selection.text.trim().length > 0 ? selection.text : config.content.text,
          font: `${config.fontSize}px ${config.fontFamily}`,
          fontSize: config.fontSize,
          lineHeight: config.lineHeight,
          maxWidth: config.cols * config.palette.targetCellWidth,
          invert: config.invert,
          color: config.color,
          frameIndex: index,
          timestampSeconds: index / config.fps,
          layout: config.layout,
          palette,
          paletteOptions: { targetCellWidth: config.palette.targetCellWidth },
          previousFrame,
          previousPixels,
          smoothing: config.temporal.smoothing,
          stability: config.temporal.stability,
          scrollStep: config.temporal.scrollStep,
          scrollModulation: config.temporal.scrollModulation,
          pulseStrength: config.temporal.pulseStrength,
          cutThreshold: config.temporal.cutThreshold,
          dither: config.palette.dither,
          edgeBias: config.palette.edgeBias,
          ...spatialRuntimeFromConfig(config),
        }
        const richFrame = config.mode === 'palette'
          ? fuseFrameWithPalette(frame, pretext as never, richOptions)
          : fuseFrameWithRoutedText(frame, pretext as never, richOptions)
        richFrames.push(richFrame)
        previousFrame = richFrame
        previousPixels = frame
      }
    }

    currentConfig = config
    currentRichFrames = richFrames
    currentSerializedFrames = config.mode === 'mono'
      ? framePixels.map(frame => {
          const ascii = mapFrameMono(frame, config.invert, config.color)
          const lines: string[] = []
          for (let row = 0; row < ascii.rows; row++) {
            lines.push(ascii.chars.slice(row * ascii.cols, (row + 1) * ascii.cols).join(''))
          }
          return {
            kind: 'grid',
            lines,
            brightness: null,
            colors: null,
          } satisfies SerializedFrame
        })
      : createRichFrameHtmlData(richFrames)

    mountPreviewPlayer(currentSerializedFrames, config.color)
    updatePresetSelection(config.preset)
    currentFrameIndex = 0
    previewMetaNode.textContent = `Rendered ${currentSerializedFrames.length} preview frames in ${config.mode}/${config.layout} mode. Use the CLI for full-fidelity ASCV/PTXV/SVG/MP4 exports.`
    setStatus('Preview ready.')
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error))
  }
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function exportHtml(): void {
  if (currentRichFrames.length === 0) {
    setStatus('Render a rich preview before exporting HTML.')
    return
  }
  const html = `<!doctype html><html><head><meta charset="UTF-8"><title>mp4toascii preview</title></head><body><pre>${JSON.stringify(createRichFrameHtmlData(currentRichFrames), null, 2)}</pre></body></html>`
  downloadBlob('mp4toascii-preview.html', new Blob([html], { type: 'text/html' }))
}

function exportAscv(): void {
  if (currentConfig === null || currentRichFrames.length === 0) {
    setStatus('Render a rich preview before exporting the ASCII video payload.')
    return
  }
  const payload = frameToAsciiVideoData(currentRichFrames, {
    width: currentRichFrames[0]!.width,
    height: currentRichFrames[0]!.height,
    fps: currentConfig.fps,
    background: '#0a0a0a',
    mode: currentConfig.mode,
    color: currentConfig.color,
  })
  const bytes = encodeAsciiVideoAssetData(payload)
  const blobBytes = new Uint8Array(bytes)
  downloadBlob('mp4toascii-preview.ptxa', new Blob([blobBytes], { type: 'application/octet-stream' }))
}

function exportPtxv(): void {
  if (currentConfig === null || currentRichFrames.length === 0) {
    setStatus('Render a rich preview before exporting the PTXV payload.')
    return
  }
  const payload = frameToAsciiVideoData(currentRichFrames, {
    width: currentRichFrames[0]!.width,
    height: currentRichFrames[0]!.height,
    fps: currentConfig.fps,
    background: '#0a0a0a',
    mode: currentConfig.mode,
    color: currentConfig.color,
  })
  const bytes = encodeAsciiVideoAssetData(payload)
  const blobBytes = new Uint8Array(bytes)
  downloadBlob('mp4toascii-preview-asset.bin', new Blob([blobBytes], { type: 'application/octet-stream' }))
}

function stepPreview(): void {
  if (currentBitmaps.length === 0) return
  currentFrameIndex = (currentFrameIndex + 1) % currentBitmaps.length
  drawSource(currentBitmaps[currentFrameIndex]!)
  const scrubber = asciiStage.querySelector<HTMLInputElement>('#preview-scrubber')
  if (scrubber !== null) {
    scrubber.value = String(currentFrameIndex)
    scrubber.dispatchEvent(new Event('input'))
  }
}

videoInput.addEventListener('change', () => {
  currentVideoFile = videoInput.files?.[0] ?? null
  void rebuildPreview()
})

subtitleInput.addEventListener('change', () => {
  currentCueFile = subtitleInput.files?.[0] ?? null
  void rebuildPreview()
})

renderButton.addEventListener('click', () => {
  void rebuildPreview()
})

playButton.addEventListener('click', () => {
  asciiStage.querySelector<HTMLButtonElement>('#preview-play')?.click()
})

stepButton.addEventListener('click', stepPreview)
exportHtmlButton.addEventListener('click', exportHtml)
exportAscvButton.addEventListener('click', exportAscv)
exportPtxvButton.addEventListener('click', exportPtxv)

modeSelect.addEventListener('change', () => void rebuildPreview())
layoutSelect.addEventListener('change', () => void rebuildPreview())
colsInput.addEventListener('change', () => void rebuildPreview())
fontSizeInput.addEventListener('change', () => void rebuildPreview())
ditherSelect.addEventListener('change', () => void rebuildPreview())
smoothingInput.addEventListener('change', () => void rebuildPreview())
stabilityInput.addEventListener('change', () => void rebuildPreview())
scrollStepInput.addEventListener('change', () => void rebuildPreview())
edgeBiasInput.addEventListener('change', () => void rebuildPreview())
silhouetteThresholdInput.addEventListener('change', () => void rebuildPreview())
maskTextInput.addEventListener('change', () => void rebuildPreview())

setStatus('Select a short video and render a preview.')
