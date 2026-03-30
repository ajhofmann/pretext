import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { copyFile } from 'node:fs/promises'

import { createSampleProject } from '../shared/text-video/runtime.ts'

const args = new Map<string, string>()
for (let index = 2; index < process.argv.length; index++) {
  const part = process.argv[index]!
  if (!part.startsWith('--')) continue
  const [key, value] = part.slice(2).split('=')
  if (key && value !== undefined) args.set(key, value)
}

const outDir = path.resolve(process.cwd(), args.get('out') ?? 'examples/text-video/projects/sample')
await mkdir(outDir, { recursive: true })

const project = createSampleProject()
for (let index = 0; index < project.assets.length; index++) {
  const asset = project.assets[index]!
  if (asset.type === 'image' && typeof asset.src === 'string') {
    asset.src = path.basename(asset.src)
  }
}
const projectPath = path.join(outDir, 'project.json')
await writeFile(projectPath, `${JSON.stringify(project, null, 2)}\n`, 'utf8')

const assetCopies = [
  { source: path.resolve(process.cwd(), 'pages/assets/openai-symbol.svg'), target: path.join(outDir, 'openai-symbol.svg') },
  { source: path.resolve(process.cwd(), 'pages/assets/claude-symbol.svg'), target: path.join(outDir, 'claude-symbol.svg') },
]

for (let index = 0; index < assetCopies.length; index++) {
  const entry = assetCopies[index]!
  await copyFile(entry.source, entry.target)
}

console.log(`Wrote sample text video project: ${projectPath}`)
