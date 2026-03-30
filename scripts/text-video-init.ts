import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

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
const projectPath = path.join(outDir, 'project.json')
await writeFile(projectPath, `${JSON.stringify(project, null, 2)}\n`, 'utf8')

console.log(`Wrote sample text video project: ${projectPath}`)
