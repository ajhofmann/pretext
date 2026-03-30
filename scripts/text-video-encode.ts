import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { encodeProjectToContainer, parseProjectJson } from '../shared/text-video/runtime.ts'

const args = new Map<string, string>()
for (const arg of process.argv.slice(2)) {
  if (!arg.startsWith('--')) continue
  const [key, value] = arg.slice(2).split('=')
  if (key && value) args.set(key, value)
}

const inputPath = args.get('input')
const outputPath = args.get('output')

if (!inputPath || !outputPath) {
  console.error('Usage: npm run text-video:encode -- --input <project.json> --output <video.ptxv>')
  process.exit(1)
}

const projectJson = await readFile(path.resolve(process.cwd(), inputPath), 'utf8')
const project = parseProjectJson(projectJson)
const payload = encodeProjectToContainer(project)

await writeFile(path.resolve(process.cwd(), outputPath), payload)
console.log(`Encoded ${inputPath} -> ${outputPath} (${payload.byteLength} bytes)`)
