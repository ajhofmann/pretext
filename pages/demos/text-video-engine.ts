import {
  TextVideoEngine,
  composeTextVideoFrame,
  recordTextVideo,
  type TextVideoAnimatedNumber,
  type TextVideoProject,
} from '../../src/video.ts'

type ControlState = {
  width: number
  height: number
  scale: number
  fps: number
  duration: number
  bodySize: number
  titleSize: number
  lineHeight: number
  padding: number
  obstaclePadding: number
  obstacleRadius: number
  obstacleBlur: number
  titleReveal: number
  bodyRevealStagger: number
}

type DomCache = {
  previewCanvas: HTMLCanvasElement
  exportCanvas: HTMLCanvasElement
  status: HTMLParagraphElement
  metrics: HTMLParagraphElement
  progressBar: HTMLDivElement
  progressLabel: HTMLSpanElement
  timeSlider: HTMLInputElement
  playButton: HTMLButtonElement
  snapshotButton: HTMLButtonElement
  recordButton: HTMLButtonElement
  presetSelect: HTMLSelectElement
  debugToggle: HTMLInputElement
  inputs: Record<string, HTMLInputElement>
  outputs: Record<string, HTMLOutputElement>
}

type PlaybackState = {
  playing: boolean
  rafId: number | null
  lastNow: number | null
  time: number
  recording: boolean
}

const COPY = {
  kicker: 'PRETEXT POWERED VIDEO TYPE',
  title: 'Build cinematic text layouts that stay editable, responsive, and ridiculously sharp.',
  body: `Pretext turns line breaking into cached arithmetic, so text can be treated like a real compositing layer instead of a DOM box you are afraid to touch. That means a video renderer can animate obstacles, retime reveals, shift columns, and reflow paragraphs at poster-sized resolutions without asking layout to measure anything in the hot path.

This demo keeps the scene configurable on purpose. Change the canvas size, oversample multiplier, line spacing, reveal cadence, and obstacle padding, then export a new frame or a live WebM capture. The same project object can drive browser previews, batch rendering, or an offline frame writer.

The interesting part is not just that it renders text onto canvas. The interesting part is that the layout engine stays typographically aware while everything else remains procedural: gradients, glow passes, line boxes, multi-region flow, title cards, and motion curves all update around the same prepared text state.

That is the leverage Pretext gives a video toolchain. Typography stops being a static texture and becomes a controllable system.`
}

const PRESETS = {
  social: {
    width: 1080,
    height: 1350,
    scale: 1,
    fps: 30,
    duration: 10,
    bodySize: 34,
    titleSize: 82,
    lineHeight: 52,
    padding: 72,
    obstaclePadding: 24,
    obstacleRadius: 114,
    obstacleBlur: 10,
    titleReveal: 0.9,
    bodyRevealStagger: 0.045,
  },
  cinema4k: {
    width: 3840,
    height: 2160,
    scale: 0.25,
    fps: 30,
    duration: 12,
    bodySize: 50,
    titleSize: 144,
    lineHeight: 74,
    padding: 164,
    obstaclePadding: 34,
    obstacleRadius: 178,
    obstacleBlur: 16,
    titleReveal: 1.2,
    bodyRevealStagger: 0.032,
  },
  square8k: {
    width: 7680,
    height: 7680,
    scale: 0.12,
    fps: 24,
    duration: 8,
    bodySize: 86,
    titleSize: 240,
    lineHeight: 122,
    padding: 380,
    obstaclePadding: 62,
    obstacleRadius: 420,
    obstacleBlur: 26,
    titleReveal: 1.1,
    bodyRevealStagger: 0.02,
  },
} satisfies Record<string, ControlState>

type PresetName = keyof typeof PRESETS

const state: PlaybackState = {
  playing: true,
  rafId: null,
  lastNow: null,
  time: 0,
  recording: false,
}

const controls = createInitialControls()
const dom = getDom()
const previewEngine = new TextVideoEngine(buildProject(controls, dom.debugToggle.checked), { canvas: dom.previewCanvas })
const exportEngine = new TextVideoEngine(buildProject(controls, dom.debugToggle.checked), { canvas: dom.exportCanvas })

wireControls()
void document.fonts.ready.then(() => {
  setStatus('Fonts ready. Preview is live.')
  render()
  scheduleTick()
})

function createInitialControls(): ControlState {
  return { ...PRESETS.social }
}

function getDom(): DomCache {
  return {
    previewCanvas: getRequiredCanvas('preview-canvas'),
    exportCanvas: getRequiredCanvas('export-canvas'),
    status: getRequiredParagraph('status'),
    metrics: getRequiredParagraph('metrics'),
    progressBar: getRequiredDiv('recording-progress'),
    progressLabel: getRequiredSpan('progress-label'),
    timeSlider: getRequiredInput('time'),
    playButton: getRequiredButton('play'),
    snapshotButton: getRequiredButton('snapshot'),
    recordButton: getRequiredButton('record'),
    presetSelect: getRequiredSelect('preset'),
    debugToggle: getRequiredInput('debug'),
    inputs: {
      width: getRequiredInput('width'),
      height: getRequiredInput('height'),
      scale: getRequiredInput('scale'),
      fps: getRequiredInput('fps'),
      duration: getRequiredInput('duration'),
      bodySize: getRequiredInput('bodySize'),
      titleSize: getRequiredInput('titleSize'),
      lineHeight: getRequiredInput('lineHeight'),
      padding: getRequiredInput('padding'),
      obstaclePadding: getRequiredInput('obstaclePadding'),
      obstacleRadius: getRequiredInput('obstacleRadius'),
      obstacleBlur: getRequiredInput('obstacleBlur'),
      titleReveal: getRequiredInput('titleReveal'),
      bodyRevealStagger: getRequiredInput('bodyRevealStagger'),
    },
    outputs: {
      width: getRequiredOutput('width-output'),
      height: getRequiredOutput('height-output'),
      scale: getRequiredOutput('scale-output'),
      fps: getRequiredOutput('fps-output'),
      duration: getRequiredOutput('duration-output'),
      bodySize: getRequiredOutput('bodySize-output'),
      titleSize: getRequiredOutput('titleSize-output'),
      lineHeight: getRequiredOutput('lineHeight-output'),
      padding: getRequiredOutput('padding-output'),
      obstaclePadding: getRequiredOutput('obstaclePadding-output'),
      obstacleRadius: getRequiredOutput('obstacleRadius-output'),
      obstacleBlur: getRequiredOutput('obstacleBlur-output'),
      titleReveal: getRequiredOutput('titleReveal-output'),
      bodyRevealStagger: getRequiredOutput('bodyRevealStagger-output'),
    },
  }
}

function wireControls(): void {
  syncInputsFromState()
  dom.presetSelect.addEventListener('change', () => {
    const presetName = dom.presetSelect.value as PresetName
    const preset = PRESETS[presetName]
    if (preset === undefined) return
    Object.assign(controls, preset)
    state.time = 0
    syncInputsFromState()
    rebuildProject()
    setStatus(`Preset switched to ${dom.presetSelect.selectedOptions[0]?.textContent ?? dom.presetSelect.value}.`)
  })

  const numericKeys = Object.keys(dom.inputs) as Array<keyof ControlState>
  for (let index = 0; index < numericKeys.length; index++) {
    const key = numericKeys[index]!
    const input = dom.inputs[key]!
    const output = dom.outputs[key]!
    input.addEventListener('input', () => {
      controls[key] = Number.parseFloat(input.value)
      output.value = formatOutputValue(key, controls[key])
      if (key === 'duration' && state.time > controls.duration) {
        state.time = controls.duration
      }
      rebuildProject()
    })
  }

  dom.debugToggle.addEventListener('change', () => rebuildProject())
  dom.timeSlider.addEventListener('input', () => {
    state.time = Number.parseFloat(dom.timeSlider.value)
    state.lastNow = null
    render()
  })
  dom.playButton.addEventListener('click', () => {
    state.playing = !state.playing
    state.lastNow = null
    dom.playButton.textContent = state.playing ? 'Pause preview' : 'Play preview'
    setStatus(state.playing ? 'Preview playback resumed.' : 'Preview playback paused.')
    scheduleTick()
  })
  dom.snapshotButton.addEventListener('click', () => {
    void exportSnapshot()
  })
  dom.recordButton.addEventListener('click', () => {
    void exportRecording()
  })
}

function syncInputsFromState(): void {
  const numericKeys = Object.keys(dom.inputs) as Array<keyof ControlState>
  for (let index = 0; index < numericKeys.length; index++) {
    const key = numericKeys[index]!
    const input = dom.inputs[key]!
    const output = dom.outputs[key]!
    input.value = String(controls[key])
    output.value = formatOutputValue(key, controls[key])
  }
  dom.timeSlider.max = controls.duration.toFixed(2)
  dom.timeSlider.value = state.time.toFixed(3)
  dom.playButton.textContent = state.playing ? 'Pause preview' : 'Play preview'
}

function formatOutputValue(key: keyof ControlState, value: number): string {
  switch (key) {
    case 'scale':
      return `${value.toFixed(2)}x`
    case 'duration':
    case 'titleReveal':
    case 'bodyRevealStagger':
      return `${value.toFixed(2)}s`
    case 'fps':
      return `${Math.round(value)} fps`
    default:
      return Number.isInteger(value) ? `${value}` : value.toFixed(2)
  }
}

function rebuildProject(): void {
  previewEngine.setProject(buildProject(controls, dom.debugToggle.checked))
  exportEngine.setProject(buildProject(controls, dom.debugToggle.checked))
  dom.timeSlider.max = controls.duration.toFixed(2)
  render()
}

function buildProject(config: ControlState, debug: boolean): TextVideoProject {
  const titleLineHeight = Math.round(config.titleSize * 0.96)
  const width = Math.max(320, Math.round(config.width))
  const height = Math.max(240, Math.round(config.height))
  const padding = Math.max(12, config.padding)
  const headlineRegion = {
    x: padding,
    y: padding,
    width: width - padding * 2,
    height: Math.max(titleLineHeight * 2.6, height * 0.22),
  }
  const bodyRegionTop = headlineRegion.y + headlineRegion.height + Math.round(config.bodySize * 0.9)
  const bodyRegionHeight = Math.max(config.lineHeight * 4, height - bodyRegionTop - padding)
  const leftColumnWidth = Math.max(80, Math.round((width - padding * 2 - Math.round(config.bodySize * 1.2)) / 2))
  const gap = Math.max(24, Math.round(config.bodySize * 1.2))

  return {
    width,
    height,
    duration: Math.max(1, config.duration),
    fps: Math.max(1, Math.round(config.fps)),
    debug,
    background: {
      kind: 'linear-gradient',
      x0: 0,
      y0: 0,
      x1: width,
      y1: height,
      stops: [
        { offset: 0, color: '#060816' },
        { offset: 0.42, color: '#111a30' },
        { offset: 1, color: '#04050b' },
      ],
    },
    obstacles: [
      {
        id: 'sun',
        kind: 'circle',
        x: animated([
          [0, width * 0.74],
          [config.duration * 0.5, width * 0.68],
          [config.duration, width * 0.76],
        ], 'smoothstep'),
        y: animated([
          [0, height * 0.32],
          [config.duration * 0.4, height * 0.24],
          [config.duration, height * 0.34],
        ], 'ease-in-out'),
        radius: animated([
          [0, config.obstacleRadius],
          [config.duration * 0.55, config.obstacleRadius * 1.18],
          [config.duration, config.obstacleRadius * 0.94],
        ], 'ease-in-out'),
        padding: config.obstaclePadding,
        fill: 'rgba(247, 177, 86, 0.18)',
        opacity: 1,
        blur: config.obstacleBlur,
        shadow: { color: 'rgba(247, 177, 86, 0.35)', blur: config.obstacleBlur * 5, offsetX: 0, offsetY: 0 },
      },
      {
        id: 'panel',
        kind: 'rect',
        x: animated([
          [0, width * 0.1],
          [config.duration, width * 0.14],
        ], 'ease-in-out'),
        y: animated([
          [0, height * 0.61],
          [config.duration, height * 0.53],
        ], 'ease-in-out'),
        width: animated([
          [0, width * 0.2],
          [config.duration, width * 0.25],
        ], 'smoothstep'),
        height: animated([
          [0, height * 0.16],
          [config.duration, height * 0.22],
        ], 'smoothstep'),
        padding: config.obstaclePadding * 0.55,
        cornerRadius: Math.round(config.bodySize * 0.75),
        fill: 'rgba(110, 133, 255, 0.12)',
        opacity: 1,
        blur: Math.max(0, config.obstacleBlur - 2),
        shadow: { color: 'rgba(87, 132, 255, 0.18)', blur: config.obstacleBlur * 2.5, offsetX: 0, offsetY: 0 },
      },
    ],
    clips: [
      {
        id: 'kicker',
        text: COPY.kicker,
        font: `600 ${Math.round(config.bodySize * 0.48)}px Inter, "Helvetica Neue", Helvetica, Arial, sans-serif`,
        lineHeight: Math.round(config.bodySize * 0.72),
        fill: '#8ea3ff',
        regions: [{ x: padding, y: Math.round(padding * 0.58), width: width - padding * 2, height: Math.round(config.bodySize) }],
        reveal: { duration: 0.55, fromY: config.bodySize * 0.4, easing: 'ease-out' },
      },
      {
        id: 'title',
        text: COPY.title,
        font: `700 ${config.titleSize}px Inter, "Helvetica Neue", Helvetica, Arial, sans-serif`,
        lineHeight: titleLineHeight,
        fill: '#f4f6fb',
        regions: [headlineRegion],
        wrap: { obstacleIds: ['sun'], minSlotWidth: Math.round(config.titleSize * 1.4), slotOrder: 'widest-first' },
        shadow: { color: 'rgba(0,0,0,0.35)', blur: config.titleSize * 0.22, offsetX: 0, offsetY: config.titleSize * 0.05 },
        reveal: { duration: config.titleReveal, stagger: config.titleReveal * 0.18, fromY: config.titleSize * 0.32, easing: 'ease-out' },
      },
      {
        id: 'body',
        text: COPY.body,
        font: `500 ${config.bodySize}px "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, serif`,
        lineHeight: config.lineHeight,
        fill: '#dce2f4',
        regions: [
          { x: padding, y: bodyRegionTop, width: leftColumnWidth, height: bodyRegionHeight },
          { x: padding + leftColumnWidth + gap, y: bodyRegionTop, width: leftColumnWidth, height: bodyRegionHeight },
        ],
        wrap: { obstacleIds: ['sun', 'panel'], minSlotWidth: Math.round(config.bodySize * 2.4), slotOrder: 'left-to-right' },
        lineBox: {
          fill: 'rgba(11, 17, 33, 0.18)',
          opacity: 0.85,
          paddingX: Math.round(config.bodySize * 0.28),
          paddingY: Math.round(config.bodySize * 0.12),
          radius: Math.round(config.bodySize * 0.26),
        },
        reveal: { start: 0.4, duration: 0.8, stagger: config.bodyRevealStagger, fromY: config.bodySize * 0.26, easing: 'smoothstep' },
      },
    ],
  }
}

function animated(points: Array<[number, number]>, easing: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'smoothstep'): TextVideoAnimatedNumber {
  return {
    easing,
    keyframes: points.map(([time, value]) => ({ time, value })),
  }
}

function render(): void {
  const project = previewEngine.getProject()
  const previewWidth = Math.max(200, Math.round(project.width * controls.scale))
  const previewHeight = Math.max(160, Math.round(project.height * controls.scale))
  const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2))
  dom.previewCanvas.width = Math.round(previewWidth * dpr)
  dom.previewCanvas.height = Math.round(previewHeight * dpr)
  dom.previewCanvas.style.width = `${previewWidth}px`
  dom.previewCanvas.style.height = `${previewHeight}px`
  const context = dom.previewCanvas.getContext('2d')
  if (context === null) throw new Error('preview canvas context unavailable')
  context.setTransform(dpr, 0, 0, dpr, 0, 0)
  context.scale(controls.scale, controls.scale)
  const result = previewEngine.renderFrame(state.time, dom.previewCanvas)
  context.setTransform(1, 0, 0, 1, 0, 0)
  updateUiMetrics(result)
}

function updateUiMetrics(result: ReturnType<TextVideoEngine['renderFrame']>): void {
  dom.timeSlider.value = state.time.toFixed(3)
  const rawFrame = composeTextVideoFrame(previewEngine.getProject(), state.time)
  const clipCounts = new Map<string, number>()
  for (let index = 0; index < rawFrame.lines.length; index++) {
    const line = rawFrame.lines[index]!
    clipCounts.set(line.clipId, (clipCounts.get(line.clipId) ?? 0) + 1)
  }
  dom.metrics.textContent =
    `${previewEngine.getProject().width.toLocaleString()}x${previewEngine.getProject().height.toLocaleString()} ` +
    `@ ${previewEngine.getProject().fps}fps · ${result.lineCount} visible lines ` +
    `(${Array.from(clipCounts.entries()).map(([id, count]) => `${id}:${count}`).join(', ')}) · ` +
    `${result.renderMs.toFixed(2)}ms plan+draw`
}

function scheduleTick(): void {
  if (state.rafId !== null || !state.playing || state.recording) return
  state.rafId = requestAnimationFrame(tick)
}

function tick(now: number): void {
  state.rafId = null
  if (!state.playing || state.recording) return
  if (state.lastNow !== null) {
    const elapsed = (now - state.lastNow) / 1000
    state.time += elapsed
    if (state.time > controls.duration) state.time -= controls.duration
  }
  state.lastNow = now
  render()
  scheduleTick()
}

async function exportSnapshot(): Promise<void> {
  setStatus('Rendering full-resolution snapshot...')
  await document.fonts.ready
  const project = exportEngine.getProject()
  const result = exportEngine.renderFrame(state.time, dom.exportCanvas)
  const blob = await canvasToBlob(dom.exportCanvas, 'image/png')
  downloadBlob(blob, `pretext-video-frame-${project.width}x${project.height}-${state.time.toFixed(2)}s.png`)
  setStatus(
    `Snapshot exported at ${project.width.toLocaleString()}x${project.height.toLocaleString()} with ${result.lineCount} lines.`
  )
}

async function exportRecording(): Promise<void> {
  if (state.recording) return
  if (typeof MediaRecorder === 'undefined') {
    setStatus('Recording is unavailable in this browser. Snapshot export still works.')
    return
  }
  state.recording = true
  state.playing = false
  state.lastNow = null
  dom.playButton.textContent = 'Play preview'
  dom.recordButton.disabled = true
  dom.snapshotButton.disabled = true
  dom.progressBar.style.width = '0%'
  dom.progressLabel.textContent = '0%'
  setStatus('Recording high-resolution WebM...')

  try {
    await document.fonts.ready
    const blob = await recordTextVideo({
      engine: exportEngine,
      canvas: dom.exportCanvas,
      mimeType: 'video/webm;codecs=vp9',
      videoBitsPerSecond: 18_000_000,
      onProgress(progress) {
        const ratio = progress.totalFrames <= 1 ? 1 : progress.frame / (progress.totalFrames - 1)
        dom.progressBar.style.width = `${(ratio * 100).toFixed(1)}%`
        dom.progressLabel.textContent = `${Math.round(ratio * 100)}%`
      },
    })
    const project = exportEngine.getProject()
    downloadBlob(blob, `pretext-video-${project.width}x${project.height}-${project.fps}fps.webm`)
    setStatus(`Recording complete at ${project.width.toLocaleString()}x${project.height.toLocaleString()}.`)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Recording failed.'
    setStatus(message)
  } finally {
    state.recording = false
    dom.recordButton.disabled = false
    dom.snapshotButton.disabled = false
    render()
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob === null) {
        reject(new Error('Canvas export failed'))
        return
      }
      resolve(blob)
    }, type)
  })
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function setStatus(text: string): void {
  dom.status.textContent = text
}

function getRequiredCanvas(id: string): HTMLCanvasElement {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLCanvasElement)) throw new Error(`#${id} not found`)
  return element
}

function getRequiredDiv(id: string): HTMLDivElement {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLDivElement)) throw new Error(`#${id} not found`)
  return element
}

function getRequiredParagraph(id: string): HTMLParagraphElement {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLParagraphElement)) throw new Error(`#${id} not found`)
  return element
}

function getRequiredSpan(id: string): HTMLSpanElement {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLSpanElement)) throw new Error(`#${id} not found`)
  return element
}

function getRequiredOutput(id: string): HTMLOutputElement {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLOutputElement)) throw new Error(`#${id} not found`)
  return element
}

function getRequiredInput(id: string): HTMLInputElement {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLInputElement)) throw new Error(`#${id} not found`)
  return element
}

function getRequiredButton(id: string): HTMLButtonElement {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLButtonElement)) throw new Error(`#${id} not found`)
  return element
}

function getRequiredSelect(id: string): HTMLSelectElement {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLSelectElement)) throw new Error(`#${id} not found`)
  return element
}
