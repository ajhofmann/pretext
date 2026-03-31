document.addEventListener('DOMContentLoaded', () => {
  const status = document.getElementById('status')
  if (!(status instanceof HTMLElement)) return
  status.textContent = 'Demo temporarily disabled pending browser-safe runtime follow-up.'
})
import { buildBrowserConfigFromArgs, spatialRuntimeFromConfig } from '../../shared/mp4toascii/config-browser.ts'
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
import { prepareWithSegments } from '../../src/layout.ts'

function requireElement<T extends HTMLElement>(root: Document | HTMLElement, id: string, ctor: { new(): T }): T {
  const element = root instanceof Document ? root.getElementById(id) : root.querySelector<HTMLElement>(`#${id}`)
  if (!(element instanceof ctor)) throw new Error(`#${id} not found`)
  return element
}

type DemoElements = {
  videoInput: HTMLInputElement
  subtitleInput: HTMLInputElement
  presetGrid: HTMLDivElement
  modeSelect: HTMLSelectElement
  layoutSelect: HTMLSelectElement
  colsInput: HTMLInputElement
  fontSizeInput: HTMLInputElement
  ditherSelect: HTMLSelectElement
  smoothingInput: HTMLInputElement
  stabilityInput: HTMLInputElement
  scrollStepInput: HTMLInputElement
  edgeBiasInput: HTMLInputElement
  silhouetteThresholdInput: HTMLInputElement
  maskTextInput: HTMLTextAreaElement
  renderButton: HTMLButtonElement
  playButton: HTMLButtonElement
  stepButton: HTMLButtonElement
  exportHtmlButton: HTMLButtonElement
  exportAscvButton: HTMLButtonElement
  exportPtxvButton: HTMLButtonElement
  statusNode: HTMLParagraphElement
  videoMetaNode: HTMLDivElement
  previewMetaNode: HTMLDivElement
  sourceVideo: HTMLVideoElement
  sourceCanvas: HTMLCanvasElement
  asciiStage: HTMLDivElement
  sourceContext: CanvasRenderingContext2D
}

let elements: DemoElements | null = null
let currentVideoFile: File | null = null
let currentCueFile: File | null = null
let currentConfig: Mp4ToAsciiConfig | null = null
let currentRichFrames: RichFrame[] = []
let currentSerializedFrames: SerializedFrame[] = []
let currentFrameIndex = 0
let currentBitmaps: ImageBitmap[] = []

type BrowserAsciiVideoPayload = {
  version: 1
  width: number
  height: number
  fps: number
  frameCount: number
  background: string
  mode: 'mono' | 'palette' | 'fusion'
  color: boolean
  styles: RichFrame['styles']
  frames: RichFrame[]
}

function setStatus(message: string): void {
  if (elements !== null) {
    elements.statusNode.textContent = message
  }
}

function updatePresetSelection(presetId: string | null): void {
  if (elements === null) return
  const cards = elements.presetGrid.querySelectorAll<HTMLButtonElement>('.preset-card')
  for (let index = 0; index < cards.length; index++) {
    const card = cards[index]!
    card.classList.toggle('active', card.dataset['presetId'] === presetId)
  }
}

function applyPresetToControls(presetId: string): void {
  if (elements === null) return
  const preset = MP4TOASCII_PRESETS.find(entry => entry.id === presetId)
  if (preset === undefined) return
  elements.modeSelect.value = preset.mode
  elements.layoutSelect.value = preset.layout
  if (preset.overrides.palette?.dither !== undefined) elements.ditherSelect.value = preset.overrides.palette.dither
  if (preset.overrides.temporal?.smoothing !== undefined) elements.smoothingInput.value = String(preset.overrides.temporal.smoothing)
  if (preset.overrides.temporal?.stability !== undefined) elements.stabilityInput.value = String(preset.overrides.temporal.stability)
  if (preset.overrides.temporal?.scrollStep !== undefined) elements.scrollStepInput.value = String(preset.overrides.temporal.scrollStep)
  if (preset.overrides.palette?.edgeBias !== undefined) elements.edgeBiasInput.value = String(preset.overrides.palette.edgeBias)
  if (preset.overrides.spatial?.silhouetteThreshold !== undefined) elements.silhouetteThresholdInput.value = String(preset.overrides.spatial.silhouetteThreshold)
  updatePresetSelection(presetId)
}

async function readCueFile(file: File): Promise<ContentCue[]> {
  const contents = await file.text()
  if (file.name.toLowerCase().endsWith('.json')) return parseDescriptionJson(contents)
  if (file.name.toLowerCase().endsWith('.vtt') || contents.trimStart().startsWith('WEBVTT')) return parseVtt(contents)
  return parseSrt(contents)
}

function buildConfig(width: number, height: number): Mp4ToAsciiConfig {
  if (elements === null) throw new Error('demo elements not initialized')
  const presetId = elements.presetGrid.querySelector<HTMLButtonElement>('.preset-card.active')?.dataset['presetId'] ?? ''
  const config = buildBrowserConfigFromArgs({
    preset: presetId,
    mode: elements.modeSelect.value,
    layout: elements.layoutSelect.value,
    cols: elements.colsInput.value,
    fps: '10',
    'font-size': elements.fontSizeInput.value,
    dither: elements.ditherSelect.value,
    smoothing: elements.smoothingInput.value,
    stability: elements.stabilityInput.value,
    'scroll-step': elements.scrollStepInput.value,
    'edge-bias': elements.edgeBiasInput.value,
    'silhouette-threshold': elements.silhouetteThresholdInput.value,
    'mask-text': elements.maskTextInput.value,
    text: elements.maskTextInput.value,
  }, {
    width,
    height,
    fps: 10,
  })
  config.content.text = elements.maskTextInput.value
  return config
}

function drawSource(bitmap: CanvasImageSource): void {
  if (elements === null) throw new Error('demo elements not initialized')
  const width = (bitmap as { width?: number }).width ?? elements.sourceCanvas.width
  const height = (bitmap as { height?: number }).height ?? elements.sourceCanvas.height
  elements.sourceCanvas.width = width
  elements.sourceCanvas.height = height
  elements.sourceContext.clearRect(0, 0, width, height)
  elements.sourceContext.drawImage(bitmap, 0, 0, width, height)
}

function framePixelsFromContext(width: number, height: number): FramePixels {
  if (elements === null) throw new Error('demo elements not initialized')
  const imageData = elements.sourceContext.getImageData(0, 0, width, height)
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
  if (elements === null) throw new Error('demo elements not initialized')
  const url = URL.createObjectURL(file)
  try {
    elements.sourceVideo.src = url
    elements.sourceVideo.classList.remove('hidden')
    await new Promise<void>((resolve, reject) => {
      elements!.sourceVideo.onloadedmetadata = () => resolve()
      elements!.sourceVideo.onerror = () => reject(new Error('Failed to load the selected video.'))
    })

    const duration = Math.max(elements.sourceVideo.duration || 1, 1)
    const frames: ImageBitmap[] = []
    for (let index = 0; index < count; index++) {
      const time = Math.min(duration - 0.001, (duration * index) / Math.max(1, count))
      elements.sourceVideo.currentTime = time
      await new Promise<void>(resolve => {
        elements!.sourceVideo.onseeked = () => resolve()
      })
      elements.sourceCanvas.width = width
      elements.sourceCanvas.height = height
      elements.sourceContext.clearRect(0, 0, width, height)
      elements.sourceContext.drawImage(elements.sourceVideo, 0, 0, width, height)
      frames.push(await createImageBitmap(elements.sourceCanvas))
    }
    elements.videoMetaNode.textContent = `${file.name} — ${elements.sourceVideo.videoWidth}×${elements.sourceVideo.videoHeight} — ${duration.toFixed(2)}s`
    return frames
  } finally {
    URL.revokeObjectURL(url)
  }
}

function mountPreviewPlayer(frames: SerializedFrame[], color: boolean): void {
  if (elements === null) throw new Error('demo elements not initialized')
  elements.asciiStage.replaceChildren()

  const display = document.createElement('div')
  display.id = 'preview-display'
  elements.asciiStage.appendChild(display)

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
  elements.asciiStage.appendChild(controls)

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

function buildBrowserAsciiVideoPayload(config: Mp4ToAsciiConfig, frames: RichFrame[]): BrowserAsciiVideoPayload {
  return {
    version: 1,
    width: frames[0]?.width ?? 0,
    height: frames[0]?.height ?? 0,
    fps: config.fps,
    frameCount: frames.length,
    background: '#0a0a0a',
    mode: config.mode,
    color: config.color,
    styles: frames[0]?.styles ?? [],
    frames: frames.map(frame => {
      const clonedFrame: RichFrame = {
        kind: frame.kind,
        width: frame.width,
        height: frame.height,
        lineHeight: frame.lineHeight,
        styles: frame.styles.map(style => ({ ...style })),
        glyphs: frame.glyphs.map(glyph => ({
          ...glyph,
          fill: glyph.fill === null ? null : { ...glyph.fill },
        })),
        background: frame.background === null ? null : { ...frame.background },
      }
      if (frame.metadata !== undefined) {
        clonedFrame.metadata = { ...frame.metadata }
      }
      return clonedFrame
    }),
  }
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
    if (elements !== null) {
      elements.previewMetaNode.textContent = `Rendered ${currentSerializedFrames.length} preview frames in ${config.mode}/${config.layout} mode. Use the CLI for full-fidelity ASCV/PTXV/SVG/MP4 exports.`
    }
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
  const payload = buildBrowserAsciiVideoPayload(currentConfig, currentRichFrames)
  const blobBytes = new TextEncoder().encode(JSON.stringify(payload))
  downloadBlob('mp4toascii-preview.ascv2.json', new Blob([blobBytes], { type: 'application/json' }))
}

function exportPtxv(): void {
  if (currentConfig === null || currentRichFrames.length === 0) {
    setStatus('Render a rich preview before exporting the PTXV payload.')
    return
  }
  const payload = buildBrowserAsciiVideoPayload(currentConfig, currentRichFrames)
  const blobBytes = new TextEncoder().encode(JSON.stringify({
    format: 'pretext-text-video-bundle-preview',
    version: 1,
    asset: payload,
  }))
  downloadBlob('mp4toascii-preview.ptxv-preview.json', new Blob([blobBytes], { type: 'application/json' }))
}

function stepPreview(): void {
  if (elements === null) return
  if (currentBitmaps.length === 0) return
  currentFrameIndex = (currentFrameIndex + 1) % currentBitmaps.length
  drawSource(currentBitmaps[currentFrameIndex]!)
  const scrubber = elements.asciiStage.querySelector<HTMLInputElement>('#preview-scrubber')
  if (scrubber !== null) {
    scrubber.value = String(currentFrameIndex)
    scrubber.dispatchEvent(new Event('input'))
  }
}

function init(): void {
  if (elements !== null) return
  const root = document
  const sourceContextLocal = requireElement(root, 'source-canvas', HTMLCanvasElement).getContext('2d')
  if (sourceContextLocal === null) throw new Error('source canvas context unavailable')
  elements = {
    videoInput: requireElement(root, 'video-input', HTMLInputElement),
    subtitleInput: requireElement(root, 'subtitle-input', HTMLInputElement),
    presetGrid: requireElement(root, 'preset-grid', HTMLDivElement),
    modeSelect: requireElement(root, 'mode-select', HTMLSelectElement),
    layoutSelect: requireElement(root, 'layout-select', HTMLSelectElement),
    colsInput: requireElement(root, 'cols-input', HTMLInputElement),
    fontSizeInput: requireElement(root, 'font-size-input', HTMLInputElement),
    ditherSelect: requireElement(root, 'dither-select', HTMLSelectElement),
    smoothingInput: requireElement(root, 'smoothing-input', HTMLInputElement),
    stabilityInput: requireElement(root, 'stability-input', HTMLInputElement),
    scrollStepInput: requireElement(root, 'scroll-step-input', HTMLInputElement),
    edgeBiasInput: requireElement(root, 'edge-bias-input', HTMLInputElement),
    silhouetteThresholdInput: requireElement(root, 'silhouette-threshold-input', HTMLInputElement),
    maskTextInput: requireElement(root, 'mask-text-input', HTMLTextAreaElement),
    renderButton: requireElement(root, 'render-button', HTMLButtonElement),
    playButton: requireElement(root, 'play-button', HTMLButtonElement),
    stepButton: requireElement(root, 'step-button', HTMLButtonElement),
    exportHtmlButton: requireElement(root, 'export-html', HTMLButtonElement),
    exportAscvButton: requireElement(root, 'export-ascv', HTMLButtonElement),
    exportPtxvButton: requireElement(root, 'export-ptxv', HTMLButtonElement),
    statusNode: requireElement(root, 'status', HTMLParagraphElement),
    videoMetaNode: requireElement(root, 'video-meta', HTMLDivElement),
    previewMetaNode: requireElement(root, 'preview-meta', HTMLDivElement),
    sourceVideo: requireElement(root, 'source-video', HTMLVideoElement),
    sourceCanvas: requireElement(root, 'source-canvas', HTMLCanvasElement),
    asciiStage: requireElement(root, 'ascii-stage', HTMLDivElement),
    sourceContext: sourceContextLocal,
  }

  elements.videoInput.addEventListener('change', () => {
    currentVideoFile = elements?.videoInput.files?.[0] ?? null
    void rebuildPreview()
  })

  elements.subtitleInput.addEventListener('change', () => {
    currentCueFile = elements?.subtitleInput.files?.[0] ?? null
    void rebuildPreview()
  })

  elements.renderButton.addEventListener('click', () => {
    void rebuildPreview()
  })

  elements.playButton.addEventListener('click', () => {
    elements?.asciiStage.querySelector<HTMLButtonElement>('#preview-play')?.click()
  })

  elements.stepButton.addEventListener('click', stepPreview)
  elements.exportHtmlButton.addEventListener('click', exportHtml)
  elements.exportAscvButton.addEventListener('click', exportAscv)
  elements.exportPtxvButton.addEventListener('click', exportPtxv)

  elements.modeSelect.addEventListener('change', () => void rebuildPreview())
  elements.layoutSelect.addEventListener('change', () => void rebuildPreview())
  elements.colsInput.addEventListener('change', () => void rebuildPreview())
  elements.fontSizeInput.addEventListener('change', () => void rebuildPreview())
  elements.ditherSelect.addEventListener('change', () => void rebuildPreview())
  elements.smoothingInput.addEventListener('change', () => void rebuildPreview())
  elements.stabilityInput.addEventListener('change', () => void rebuildPreview())
  elements.scrollStepInput.addEventListener('change', () => void rebuildPreview())
  elements.edgeBiasInput.addEventListener('change', () => void rebuildPreview())
  elements.silhouetteThresholdInput.addEventListener('change', () => void rebuildPreview())
  elements.maskTextInput.addEventListener('change', () => void rebuildPreview())

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
    elements.presetGrid.appendChild(button)
  }

  setStatus('Select a short video and render a preview.')
}

window.addEventListener('load', init, { once: true })
