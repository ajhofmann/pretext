import { beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  createSampleProject,
  decodeProjectContainer,
  encodeProjectToContainer,
  evaluateLayerForRender,
  parseProjectJson,
  renderFrameSvg,
  type Layer,
  type TextVideoProject,
} from './runtime.ts'

const TEST_ROOT = '/workspace/tmp/text-video-tests'
const SAMPLE_ASSET_FILES = [
  '/workspace/examples/text-video/projects/sample/openai-symbol.svg',
  '/workspace/examples/text-video/projects/sample/claude-symbol.svg',
]

class TestCanvasRenderingContext2D {
  font = ''

  measureText(text: string): { width: number } {
    return { width: text.length * 10 }
  }
}

class TestOffscreenCanvas {
  constructor(_width: number, _height: number) {}

  getContext(_kind: string): TestCanvasRenderingContext2D {
    return new TestCanvasRenderingContext2D()
  }
}

beforeAll(async () => {
  Reflect.set(globalThis, 'OffscreenCanvas', TestOffscreenCanvas)
  await rm(TEST_ROOT, { recursive: true, force: true })
  await mkdir(TEST_ROOT, { recursive: true })
  for (let index = 0; index < SAMPLE_ASSET_FILES.length; index++) {
    const sourcePath = SAMPLE_ASSET_FILES[index]!
    const filename = path.basename(sourcePath)
    await writeFile(path.join(TEST_ROOT, filename), await readFile(sourcePath))
  }
})

describe('text-video engine', () => {
  test('sample project validates and includes richer layer types', () => {
    const project = parseProjectJson(JSON.stringify(createSampleProject()).replaceAll('"openai-symbol.svg"', '"/workspace/pages/assets/openai-symbol.svg"').replaceAll('"claude-symbol.svg"', '"/workspace/pages/assets/claude-symbol.svg"'))
    expect(project.version).toBe(2)
    expect(project.assets.some((asset: TextVideoProject['assets'][number]) => asset.type === 'image')).toBe(true)
    expect(project.scenes.some((scene: TextVideoProject['scenes'][number]) => (scene.layers as Layer[]).some((layer: Layer) => layer.type === 'group'))).toBe(true)
    expect(project.scenes.some((scene: TextVideoProject['scenes'][number]) => (scene.layers as Layer[]).some((layer: Layer) => layer.type === 'shape'))).toBe(true)
  })

  test('encode/decode roundtrip preserves semantic project', async () => {
    const project = parseProjectJson(JSON.stringify(createSampleProject()).replaceAll('"openai-symbol.svg"', '"/workspace/pages/assets/openai-symbol.svg"').replaceAll('"claude-symbol.svg"', '"/workspace/pages/assets/claude-symbol.svg"'))
    const projectPath = path.join(TEST_ROOT, 'project.json')
    await writeFile(projectPath, JSON.stringify(project, null, 2))

    const container = await encodeProjectToContainer(project, projectPath)
    const decoded = decodeProjectContainer(container)

    expect(decoded.version).toBe(2)
    expect(decoded.project.info.name).toBe(project.info.name)
    expect(decoded.project.assets.length).toBe(project.assets.length)
    expect(decoded.assets.length).toBeGreaterThan(0)
  })

  test('rendered first frame contains text, shape, and image primitives', async () => {
    const projectPath = path.join(TEST_ROOT, 'render-project.json')
    const project = parseProjectJson(
      JSON.stringify(createSampleProject())
        .replaceAll('"openai-symbol.svg"', '"/workspace/pages/assets/openai-symbol.svg"')
        .replaceAll('"claude-symbol.svg"', '"/workspace/pages/assets/claude-symbol.svg"'),
    )
    await writeFile(projectPath, JSON.stringify(project, null, 2))

    const svg = await renderFrameSvg(project, 0, { absoluteProjectPath: projectPath, projectPath })

    expect(svg.includes('<text')).toBe(true)
    expect(svg.includes('<rect')).toBe(true)
    expect(svg.includes('<image')).toBe(true)
  })

  test('layer evaluator resolves animated text values', () => {
    const project = createSampleProject()
    const intro = project.scenes[0]!
    const eyebrow = (intro.layers as Layer[]).find(layer => layer.id === 'eyebrow')
    expect(eyebrow?.type).toBe('text')

    if (eyebrow === undefined) throw new Error('Expected eyebrow layer')
    const evaluated = evaluateLayerForRender(eyebrow, 1)
    expect(evaluated.type).toBe('text')
    if (evaluated.type === 'text') {
      expect(evaluated.text).toContain('PRETEXT')
      expect(evaluated.fontSize).toBeGreaterThan(0)
      expect(evaluated.color.length).toBeGreaterThan(0)
    }
  })

  test('parser accepts generated sample project json', async () => {
    const samplePath = '/workspace/examples/text-video/projects/generated-sample/project.json'
    const contents = await readFile(samplePath, 'utf8')
    const project = parseProjectJson(contents)
    expect(project.scenes.length).toBe(2)
    expect(project.video.durationSeconds).toBe(8)
  })
})
